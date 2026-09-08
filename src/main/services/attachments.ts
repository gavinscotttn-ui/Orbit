import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { newId, fileExtension, safeFileName } from '@shared/domain/ids.js'
import type { OrbitDatabase } from '../db/database.js'
import type { VaultPaths } from '../vault/paths.js'
import { log } from '../log.js'

/**
 * Attachment storage.
 *
 * Files are CONTENT-ADDRESSED: the name on disk is the SHA-256 of the bytes,
 * split into two directory levels to keep any one folder small.
 *
 *   attachments/3f/a9/3fa9c1…e7.pdf
 *
 * This is not cleverness for its own sake. It removes, by construction, every
 * cross-platform filename problem that would otherwise break a vault the moment
 * it crossed from macOS to Windows:
 *
 *   - Windows reserved names (CON, PRN, LPT1) cannot occur.
 *   - Characters Windows forbids (: * ? " < > |) cannot occur.
 *   - Case-insensitive collisions cannot occur — "Receipt.PDF" and "receipt.pdf"
 *     are two different records but the same or different content, decided by
 *     the bytes, not the name.
 *   - Unicode normalisation cannot bite: macOS stores "é" decomposed and Windows
 *     composed, so the *same* filename can fail to match across platforms. Hex
 *     digits have no such ambiguity.
 *   - Path length limits are predictable.
 *
 * The user's original filename is preserved in the database and is what they
 * see, what search matches on, and what they get when they export.
 *
 * A useful side effect: attaching the same photo to five records stores it once.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  eml: 'message/rfc822',
  ics: 'text/calendar',
  ofx: 'application/x-ofx',
  qif: 'application/qif'
}

/** Extensions whose text Orbit can index without any external dependency. */
const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml', 'html', 'ics', 'qif', 'ofx', 'log'])

/** 250 MB. Large enough for a video of the boiler; small enough to catch mistakes. */
export const MAX_ATTACHMENT_BYTES = 250 * 1024 * 1024

export interface AttachmentRecord {
  id: string
  sha256: string
  relativePath: string
  originalFilename: string
  extension: string
  mimeType: string
  bytes: number
  textStatus: string
  createdAt: string
}

export interface AttachmentLink {
  entityType: string
  entityId: string
  role?: string
}

function mapRow(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: String(row.id),
    sha256: String(row.sha256),
    relativePath: String(row.relative_path),
    originalFilename: String(row.original_filename),
    extension: String(row.extension ?? ''),
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    bytes: Number(row.bytes ?? 0),
    textStatus: String(row.text_status ?? 'none'),
    createdAt: String(row.created_at ?? '')
  }
}

export class AttachmentService {
  constructor(
    private readonly db: OrbitDatabase,
    private readonly paths: VaultPaths
  ) {}

  private storagePath(sha256: string, extension: string): string {
    const a = sha256.slice(0, 2)
    const b = sha256.slice(2, 4)
    const name = extension ? `${sha256}.${extension}` : sha256
    return `attachments/${a}/${b}/${name}`
  }

  /** Absolute path for an attachment, checked to be inside the vault. */
  absolutePath(relativePath: string): string {
    return this.paths.resolveInside(relativePath)
  }

  find(id: string): AttachmentRecord | null {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM attachments WHERE id = ?', [id])
    return row ? mapRow(row) : null
  }

  findByHash(sha256: string): AttachmentRecord | null {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM attachments WHERE sha256 = ?', [sha256])
    return row ? mapRow(row) : null
  }

  /**
   * Store bytes in the vault and return the attachment record.
   *
   * Identical content is stored once. The returned `deduplicated` flag lets the
   * import UI tell the user "you already have this receipt" instead of silently
   * creating a duplicate record.
   */
  addBuffer(
    data: Uint8Array,
    originalFilename: string,
    options: { link?: AttachmentLink; importedNote?: string; mimeType?: string } = {}
  ): { attachment: AttachmentRecord; deduplicated: boolean } {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `That file is ${(data.byteLength / 1024 / 1024).toFixed(0)} MB, which is larger than the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit for a single attachment.`
      )
    }
    const sha256 = createHash('sha256').update(data).digest('hex')
    const cleanName = safeFileName(basename(String(originalFilename || 'attachment')))
    const extension = fileExtension(cleanName)
    const existing = this.findByHash(sha256)

    if (existing) {
      // The bytes are already here. Make sure the file really is on disk — a
      // vault restored from a database-only backup may have the row but not
      // the file — and then just add the new link.
      const absolute = this.absolutePath(existing.relativePath)
      if (!existsSync(absolute)) {
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, data)
        log.info('attachments', 'restored a missing attachment file from re-imported content')
      }
      if (options.link) this.link(existing.id, options.link)
      return { attachment: existing, deduplicated: true }
    }

    const relativePath = this.storagePath(sha256, extension)
    const absolute = this.paths.resolveInside(relativePath)
    mkdirSync(dirname(absolute), { recursive: true })
    // Write to a temporary name then rename, so an interrupted write never
    // leaves a truncated file sitting at a hash that claims to be complete.
    const temp = `${absolute}.partial-${process.pid}`
    writeFileSync(temp, data)
    try {
      renameSync(temp, absolute)
    } catch (err) {
      try {
        rmSync(temp, { force: true })
      } catch {
        /* best effort */
      }
      throw err
    }

    const now = new Date().toISOString()
    const id = newId('att')
    const mimeType = options.mimeType || MIME_BY_EXTENSION[extension] || 'application/octet-stream'
    const textStatus = PLAIN_TEXT_EXTENSIONS.has(extension) ? 'pending' : extension === 'pdf' ? 'unsupported' : 'none'

    this.db.run(
      `INSERT INTO attachments
         (id, sha256, relative_path, original_filename, extension, mime_type, bytes, text_content, text_status, imported_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      [id, sha256, relativePath, cleanName, extension, mimeType, data.byteLength, textStatus, options.importedNote ?? '', now, now]
    )
    if (options.link) this.link(id, options.link)

    const attachment: AttachmentRecord = {
      id,
      sha256,
      relativePath,
      originalFilename: cleanName,
      extension,
      mimeType,
      bytes: data.byteLength,
      textStatus,
      createdAt: now
    }
    return { attachment, deduplicated: false }
  }

  /** Copy a file from anywhere on disk into the vault. */
  addFile(
    sourcePath: string,
    options: { link?: AttachmentLink; importedNote?: string; originalFilename?: string } = {}
  ): { attachment: AttachmentRecord; deduplicated: boolean } {
    if (!existsSync(sourcePath)) throw new Error('That file no longer exists.')
    const info = statSync(sourcePath)
    if (!info.isFile()) throw new Error('That is a folder, not a file.')
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `That file is ${(info.size / 1024 / 1024).toFixed(0)} MB, which is larger than the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit for a single attachment.`
      )
    }
    const data = readFileSync(sourcePath)
    return this.addBuffer(data, options.originalFilename ?? basename(sourcePath), {
      ...(options.link ? { link: options.link } : {}),
      importedNote: options.importedNote ?? ''
    })
  }

  link(attachmentId: string, link: AttachmentLink): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT OR IGNORE INTO attachment_links (id, attachment_id, entity_type, entity_id, role, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [newId('atl'), attachmentId, link.entityType, link.entityId, link.role ?? 'attachment', now]
    )
  }

  unlink(attachmentId: string, link: AttachmentLink): void {
    this.db.run(
      `DELETE FROM attachment_links
        WHERE attachment_id = ? AND entity_type = ? AND entity_id = ? AND role = ?`,
      [attachmentId, link.entityType, link.entityId, link.role ?? 'attachment']
    )
  }

  listFor(entityType: string, entityId: string): AttachmentRecord[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT a.* FROM attachments a
         JOIN attachment_links l ON l.attachment_id = a.id
        WHERE l.entity_type = ? AND l.entity_id = ?
        ORDER BY l.sort_order, a.created_at`,
      [entityType, entityId]
    )
    return rows.map(mapRow)
  }

  referenceCount(attachmentId: string): number {
    return Number(
      this.db.scalar<number>('SELECT COUNT(*) FROM attachment_links WHERE attachment_id = ?', [attachmentId]) ?? 0
    )
  }

  /**
   * Delete an attachment and its bytes.
   *
   * Refuses while anything still points at it, unless forced. Content-addressed
   * storage means one file may be shared by many records, and deleting the
   * bytes because one record let go would silently empty the others.
   */
  remove(attachmentId: string, options: { force?: boolean } = {}): { removed: boolean; reason: string } {
    const record = this.find(attachmentId)
    if (!record) return { removed: false, reason: 'That attachment is not in this vault.' }
    const refs = this.referenceCount(attachmentId)
    if (refs > 0 && !options.force) {
      return { removed: false, reason: `That file is still attached to ${refs} record${refs === 1 ? '' : 's'}.` }
    }
    this.db.transaction(() => {
      this.db.run('DELETE FROM attachment_links WHERE attachment_id = ?', [attachmentId])
      this.db.run('DELETE FROM attachments WHERE id = ?', [attachmentId])
    })
    try {
      const absolute = this.absolutePath(record.relativePath)
      if (existsSync(absolute)) rmSync(absolute, { force: true })
    } catch (err) {
      log.warn('attachments', 'row removed but file could not be deleted', err)
    }
    return { removed: true, reason: '' }
  }

  /**
   * Find attachment rows nothing points at any more.
   *
   * Returned rather than deleted: destructive tidying is always the user's
   * decision, shown with a count and a total size first.
   */
  findUnreferenced(): AttachmentRecord[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT a.* FROM attachments a
        WHERE NOT EXISTS (SELECT 1 FROM attachment_links l WHERE l.attachment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM document_versions d WHERE d.attachment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM people p WHERE p.avatar_attachment_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM inbox_items i WHERE i.attachment_id = a.id)
        ORDER BY a.created_at`
    )
    return rows.map(mapRow)
  }

  /** Export a copy out of the vault under its original, human-readable name. */
  exportTo(attachmentId: string, destinationPath: string): { path: string } {
    const record = this.find(attachmentId)
    if (!record) throw new Error('That attachment is not in this vault.')
    const source = this.absolutePath(record.relativePath)
    if (!existsSync(source)) {
      throw new Error(`The file for "${record.originalFilename}" is missing from this vault.`)
    }
    mkdirSync(dirname(destinationPath), { recursive: true })
    copyFileSync(source, destinationPath)
    return { path: destinationPath }
  }

  /** Suggested on-disk name when exporting: readable, and safe on any platform. */
  suggestedExportName(record: AttachmentRecord): string {
    return safeFileName(record.originalFilename, `attachment.${record.extension || 'bin'}`)
  }

  /** Read an attachment's bytes, for previewing inside the app. */
  read(attachmentId: string): { data: Buffer; record: AttachmentRecord } {
    const record = this.find(attachmentId)
    if (!record) throw new Error('That attachment is not in this vault.')
    const absolute = this.absolutePath(record.relativePath)
    if (!existsSync(absolute)) {
      throw new Error(`The file for "${record.originalFilename}" is missing from this vault.`)
    }
    return { data: readFileSync(absolute), record }
  }

  /**
   * Extract indexable text from plain-text attachments.
   *
   * PDFs and images are marked 'unsupported' rather than 'failed', because
   * Orbit has no bundled OCR engine and will not claim to have read something
   * it has not. See docs/FEATURE-STATUS.md.
   */
  extractPendingText(limit = 20): number {
    const rows = this.db.all<Record<string, unknown>>(
      "SELECT * FROM attachments WHERE text_status = 'pending' LIMIT ?",
      [limit]
    )
    let done = 0
    for (const row of rows) {
      const record = mapRow(row)
      try {
        const absolute = this.absolutePath(record.relativePath)
        if (!existsSync(absolute)) {
          this.db.run("UPDATE attachments SET text_status = 'failed', updated_at = ? WHERE id = ?", [
            new Date().toISOString(),
            record.id
          ])
          continue
        }
        // Cap what goes into the index; a 40 MB CSV should not bloat the vault.
        const raw = readFileSync(absolute, 'utf8').slice(0, 200_000)
        this.db.run(
          "UPDATE attachments SET text_content = ?, text_status = 'done', updated_at = ? WHERE id = ?",
          [raw, new Date().toISOString(), record.id]
        )
        done += 1
      } catch (err) {
        log.warn('attachments', 'text extraction failed for one attachment', err)
        this.db.run("UPDATE attachments SET text_status = 'failed', updated_at = ? WHERE id = ?", [
          new Date().toISOString(),
          record.id
        ])
      }
    }
    return done
  }

  totalBytes(): number {
    return Number(this.db.scalar<number>('SELECT COALESCE(SUM(bytes), 0) FROM attachments') ?? 0)
  }

  count(): number {
    return Number(this.db.scalar<number>('SELECT COUNT(*) FROM attachments') ?? 0)
  }

  /** Where exports land by default, inside the vault so they travel with it. */
  get exportsDirectory(): string {
    const dir = this.paths.exportsDir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  defaultExportPath(name: string): string {
    return join(this.exportsDirectory, safeFileName(name))
  }
}
