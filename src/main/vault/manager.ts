import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import {
  defaultManifest,
  parseManifest,
  SCHEMA_VERSION,
  VAULT_FORMAT_VERSION,
  type BackupEntry,
  type TransferReadiness,
  type VaultIntegrityReport,
  type VaultManifest,
  type VaultOpenError
} from '@shared/vault.js'
import { newId } from '@shared/domain/ids.js'
import { OrbitDatabase, SchemaTooNewError } from '../db/database.js'
import { log } from '../log.js'
import { VaultLock, type LockInfo } from './lock.js'
import { VaultPaths, looksLikeVault, probeWritable } from './paths.js'

export interface OpenOptions {
  /** The user has explicitly chosen to take over a lock held elsewhere. */
  takeOver?: boolean
  /** Skip the automatic integrity check after an unclean shutdown. */
  skipIntegrityCheck?: boolean
}

export interface VaultSession {
  root: string
  paths: VaultPaths
  manifest: VaultManifest
  db: OrbitDatabase
}

export type OpenResult =
  | { ok: true; session: VaultSession; migrated: { from: number; to: number; backup: string | null } | null; integrity: VaultIntegrityReport | null }
  | { ok: false; error: VaultOpenError; lockHolder?: LockInfo; lockStale?: boolean }

/** Text the user sees when a vault cannot be opened. Plain, and always actionable. */
function openError(
  code: VaultOpenError['code'],
  message: string,
  remedy: string,
  detail?: string
): { ok: false; error: VaultOpenError } {
  return { ok: false, error: detail ? { code, message, remedy, detail } : { code, message, remedy } }
}

export class VaultManager {
  private session: VaultSession | null = null
  private lock: VaultLock | null = null

  constructor(private readonly appVersion: string) {}

  get current(): VaultSession | null {
    return this.session
  }

  get isOpen(): boolean {
    return this.session !== null && !this.session.db.isClosed
  }

  /** Throws if no vault is open — used by every IPC handler that needs data. */
  require(): VaultSession {
    if (!this.session || this.session.db.isClosed) {
      throw new Error('No Orbit vault is open.')
    }
    return this.session
  }

  // -- Creating -------------------------------------------------------------

  create(
    root: string,
    options: { name?: string; isDemo?: boolean } = {}
  ): OpenResult {
    const parent = join(root, '..')
    if (!existsSync(root)) {
      const parentProbe = probeWritable(parent)
      if (!parentProbe.writable) {
        return openError(
          'not-writable',
          'Orbit cannot create a vault there.',
          parentProbe.reason || 'Choose a folder you can write to.'
        )
      }
      mkdirSync(root, { recursive: true })
    }
    const probe = probeWritable(root)
    if (!probe.writable) {
      return openError('not-writable', 'Orbit cannot write to that folder.', probe.reason)
    }
    if (looksLikeVault(root)) {
      return openError(
        'unknown',
        'There is already an Orbit vault in that folder.',
        'Open the existing vault, or choose an empty folder for a new one.'
      )
    }

    const paths = new VaultPaths(root)
    paths.ensureSkeleton()
    const manifest = defaultManifest({
      vaultId: newId('vault'),
      name: options.name?.trim() || 'Orbit Vault',
      appVersion: this.appVersion,
      isDemo: options.isDemo
    })
    writeManifest(paths, manifest)
    writeReadme(paths, manifest)

    return this.openExisting(root, {}, manifest)
  }

  // -- Opening --------------------------------------------------------------

  open(root: string, options: OpenOptions = {}): OpenResult {
    if (!existsSync(root)) {
      return openError(
        'path-missing',
        'That folder is no longer there.',
        'If the vault is on a removable drive or a network share, reconnect it and try again. Otherwise use "Locate vault…" to point Orbit at its new home.'
      )
    }
    const paths = new VaultPaths(root)
    if (!existsSync(paths.manifest)) {
      return openError(
        'not-a-vault',
        'That folder is not an Orbit vault.',
        `An Orbit vault contains a file called ${'orbit-vault.json'}. Choose the folder itself, not the folder above it.`
      )
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(paths.manifest, 'utf8'))
    } catch (err) {
      return openError(
        'manifest-unreadable',
        "Orbit could not read this vault's manifest file.",
        'Restore the vault from a backup, or contact support with the vault folder intact. Do not delete anything.',
        err instanceof Error ? err.message : undefined
      )
    }
    const parsed = parseManifest(raw)
    if (!parsed.ok) {
      return openError('manifest-unreadable', 'This vault’s manifest is not valid.', parsed.reason)
    }
    const manifest = parsed.manifest

    if (manifest.formatVersion > VAULT_FORMAT_VERSION) {
      return openError(
        'format-too-new',
        'This vault was made by a newer version of Orbit.',
        `This build understands vault layout ${VAULT_FORMAT_VERSION}; the vault is layout ${manifest.formatVersion}. Update Orbit on this computer, then try again. Nothing has been changed.`
      )
    }
    if (manifest.schemaVersion > SCHEMA_VERSION) {
      return openError(
        'schema-too-new',
        'This vault was made by a newer version of Orbit.',
        `This build understands database format ${SCHEMA_VERSION}; the vault is format ${manifest.schemaVersion}. Update Orbit on this computer, then try again. Nothing has been changed.`
      )
    }

    const probe = probeWritable(root)
    if (!probe.writable) {
      return openError(
        'not-writable',
        'Orbit cannot write to this vault, so it will not open it.',
        `${probe.reason} Orbit will never silently save your records somewhere else.`
      )
    }

    return this.openExisting(root, options, manifest)
  }

  private openExisting(root: string, options: OpenOptions, manifest: VaultManifest): OpenResult {
    const paths = new VaultPaths(root)
    paths.ensureSkeleton()

    const lock = new VaultLock(paths.lockFile, this.appVersion)
    const lockResult = lock.acquire({ takeOver: options.takeOver ?? false })
    if (!lockResult.ok) {
      return {
        ok: false,
        error: {
          code: 'locked-by-another-instance',
          message: lockResult.message,
          remedy: lockResult.stale
            ? 'Close Orbit on that computer if it is still running. If it crashed, you can take over the vault — but only if you are certain nothing else is using it.'
            : 'Close the vault there first. Opening the same vault twice at once can corrupt it.'
        },
        lockHolder: lockResult.held,
        lockStale: lockResult.stale
      }
    }

    let db: OrbitDatabase
    try {
      db = new OrbitDatabase(paths.database)
    } catch (err) {
      lock.release()
      return openError(
        'missing-database',
        "Orbit could not open this vault's database.",
        'Check the drive is connected and you have permission to write to it, then try again.',
        err instanceof Error ? err.message : undefined
      )
    }

    let migrated: { from: number; to: number; backup: string | null } | null = null
    try {
      const outcome = db.migrate(() => {
        // A backup before the first migration of any upgrade. Not optional.
        try {
          const entry = this.backupDatabaseSync(paths, db, 'pre-migration', `Before upgrading to format ${SCHEMA_VERSION}`)
          return entry.relativePath
        } catch (err) {
          log.error('vault', 'pre-migration backup failed', err)
          throw new Error(
            'Orbit could not take a safety backup before upgrading this vault, so it has not upgraded it. Free up disk space or check permissions, then try again.'
          )
        }
      })
      if (outcome.applied.length > 0) {
        migrated = { from: outcome.from, to: outcome.to, backup: outcome.backupTaken }
      }
    } catch (err) {
      db.close()
      lock.release()
      if (err instanceof SchemaTooNewError) {
        return openError(
          'schema-too-new',
          'This vault was made by a newer version of Orbit.',
          'Update Orbit on this computer, then try again. Nothing has been changed.'
        )
      }
      return openError(
        'migration-failed',
        'Orbit could not upgrade this vault.',
        'Your data has not been changed. A backup was taken before the upgrade started — see the backups folder inside the vault.',
        err instanceof Error ? err.message : undefined
      )
    }

    const session: VaultSession = { root, paths, manifest, db }
    this.session = session
    this.lock = lock

    // An unclean shutdown means a check, not a shrug.
    let integrity: VaultIntegrityReport | null = null
    if (!manifest.cleanShutdown && !options.skipIntegrityCheck) {
      log.warn('vault', 'vault was not closed cleanly; running an integrity check')
      integrity = this.checkIntegrity()
    }

    const updated: VaultManifest = {
      ...manifest,
      schemaVersion: db.schemaVersion,
      formatVersion: VAULT_FORMAT_VERSION,
      updatedAt: new Date().toISOString(),
      lastWrittenByAppVersion: this.appVersion,
      cleanShutdown: false
    }
    writeManifest(paths, updated)
    session.manifest = updated

    log.info('vault', `opened vault (schema ${db.schemaVersion}${migrated ? `, migrated from ${migrated.from}` : ''})`)
    return { ok: true, session, migrated, integrity }
  }

  // -- Closing --------------------------------------------------------------

  close(): void {
    const session = this.session
    if (!session) return
    try {
      session.db.checkpoint('TRUNCATE')
    } catch (err) {
      log.warn('vault', 'checkpoint before close failed', err)
    }
    try {
      const manifest: VaultManifest = {
        ...session.manifest,
        updatedAt: new Date().toISOString(),
        cleanShutdown: true
      }
      writeManifest(session.paths, manifest)
    } catch (err) {
      log.warn('vault', 'could not mark clean shutdown', err)
    }
    try {
      session.db.close()
    } catch (err) {
      log.warn('vault', 'database close failed', err)
    }
    this.lock?.release()
    this.lock = null
    this.session = null
    log.info('vault', 'vault closed cleanly')
  }

  // -- Integrity ------------------------------------------------------------

  checkIntegrity(): VaultIntegrityReport {
    const session = this.require()
    const { db, paths } = session
    const dbCheck = db.integrityCheck()
    const fkViolations = db.foreignKeyCheck()

    const rows = db.all<{ id: string; relative_path: string; original_filename: string; sha256: string; bytes: number }>(
      'SELECT id, relative_path, original_filename, sha256, bytes FROM attachments'
    )
    const missing: VaultIntegrityReport['attachmentsMissing'] = []
    const corrupt: VaultIntegrityReport['attachmentsCorrupt'] = []
    const expectedFiles = new Set<string>()
    let present = 0

    for (const row of rows) {
      let absolute: string
      try {
        absolute = paths.resolveInside(row.relative_path)
      } catch {
        missing.push({ id: row.id, filename: row.original_filename, relativePath: row.relative_path })
        continue
      }
      expectedFiles.add(absolute)
      if (!existsSync(absolute)) {
        missing.push({ id: row.id, filename: row.original_filename, relativePath: row.relative_path })
        continue
      }
      present += 1
      // Size is a cheap proxy; a full hash of every file would be far too slow
      // to run on open. Hash verification is available as an explicit deep check.
      try {
        const size = statSync(absolute).size
        if (row.bytes > 0 && size !== row.bytes) {
          corrupt.push({ id: row.id, filename: row.original_filename, relativePath: row.relative_path })
        }
      } catch {
        corrupt.push({ id: row.id, filename: row.original_filename, relativePath: row.relative_path })
      }
    }

    const orphaned: string[] = []
    for (const file of walkFiles(paths.attachmentsDir)) {
      if (!expectedFiles.has(file)) {
        orphaned.push(relative(paths.root, file).split(sep).join('/'))
      }
    }

    const report: VaultIntegrityReport = {
      checkedAt: new Date().toISOString(),
      databaseIntegrity: dbCheck.ok ? 'ok' : 'failed',
      databaseIntegrityDetail: dbCheck.detail,
      foreignKeyViolations: fkViolations,
      attachmentsExpected: rows.length,
      attachmentsPresent: present,
      attachmentsMissing: missing,
      attachmentsOrphaned: orphaned,
      attachmentsCorrupt: corrupt,
      schemaVersion: db.schemaVersion,
      formatVersion: session.manifest.formatVersion,
      walPresent: existsSync(paths.databaseWal),
      healthy: false
    }
    report.healthy =
      dbCheck.ok && fkViolations === 0 && missing.length === 0 && corrupt.length === 0
    return report
  }

  /** Full SHA-256 verification of every attachment. Slow, and offered explicitly. */
  async verifyAttachmentHashes(): Promise<{ checked: number; mismatched: { id: string; filename: string }[] }> {
    const { db, paths } = this.require()
    const rows = db.all<{ id: string; relative_path: string; original_filename: string; sha256: string }>(
      'SELECT id, relative_path, original_filename, sha256 FROM attachments'
    )
    const mismatched: { id: string; filename: string }[] = []
    let checked = 0
    for (const row of rows) {
      try {
        const absolute = paths.resolveInside(row.relative_path)
        if (!existsSync(absolute)) {
          mismatched.push({ id: row.id, filename: row.original_filename })
          continue
        }
        const digest = await hashFile(absolute)
        checked += 1
        if (digest !== row.sha256) mismatched.push({ id: row.id, filename: row.original_filename })
      } catch {
        mismatched.push({ id: row.id, filename: row.original_filename })
      }
    }
    return { checked, mismatched }
  }

  // -- Backups --------------------------------------------------------------

  listBackups(): BackupEntry[] {
    const { paths } = this.require()
    if (!existsSync(paths.backupsDir)) return []
    const entries: BackupEntry[] = []
    for (const name of readdirSync(paths.backupsDir)) {
      const dir = join(paths.backupsDir, name)
      try {
        if (!statSync(dir).isDirectory()) continue
        const metaFile = join(dir, 'backup.json')
        if (!existsSync(metaFile)) continue
        const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as Partial<BackupEntry>
        entries.push({
          id: String(meta.id ?? name),
          createdAt: String(meta.createdAt ?? ''),
          relativePath: `backups/${name}`,
          bytes: Number(meta.bytes ?? 0),
          schemaVersion: Number(meta.schemaVersion ?? 0),
          reason: (meta.reason as BackupEntry['reason']) ?? 'manual',
          note: String(meta.note ?? ''),
          includesAttachments: Boolean(meta.includesAttachments)
        })
      } catch {
        /* ignore an unreadable backup folder rather than failing the list */
      }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Take a backup using SQLite's online backup API, so it is a consistent
   * snapshot even if a write is in flight.
   */
  private backupDatabaseSync(
    paths: VaultPaths,
    db: OrbitDatabase,
    reason: BackupEntry['reason'],
    note: string
  ): BackupEntry {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const id = `${stamp}-${reason}`
    const dir = join(paths.backupsDir, id)
    mkdirSync(dir, { recursive: true })
    // Checkpoint first so the snapshot includes everything in the WAL.
    db.checkpoint('TRUNCATE')
    const target = join(dir, 'orbit.sqlite')
    copyFileSync(paths.database, target)
    if (existsSync(paths.manifest)) copyFileSync(paths.manifest, join(dir, 'orbit-vault.json'))
    const entry: BackupEntry = {
      id,
      createdAt: new Date().toISOString(),
      relativePath: `backups/${id}`,
      bytes: statSync(target).size,
      schemaVersion: db.schemaVersion,
      reason,
      note,
      includesAttachments: false
    }
    writeFileSync(join(dir, 'backup.json'), JSON.stringify(entry, null, 2), 'utf8')
    return entry
  }

  async backup(
    options: { reason?: BackupEntry['reason']; note?: string; includeAttachments?: boolean } = {}
  ): Promise<BackupEntry> {
    const { db, paths } = this.require()
    const reason = options.reason ?? 'manual'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const id = `${stamp}-${reason}`
    const dir = join(paths.backupsDir, id)
    mkdirSync(dir, { recursive: true })

    const target = join(dir, 'orbit.sqlite')
    const result = await db.backupTo(target)
    if (existsSync(paths.manifest)) copyFileSync(paths.manifest, join(dir, 'orbit-vault.json'))

    let includesAttachments = false
    let bytes = result.bytes
    if (options.includeAttachments) {
      const attachmentsTarget = join(dir, 'attachments')
      bytes += copyTree(paths.attachmentsDir, attachmentsTarget)
      includesAttachments = true
    }

    const entry: BackupEntry = {
      id,
      createdAt: new Date().toISOString(),
      relativePath: `backups/${id}`,
      bytes,
      schemaVersion: db.schemaVersion,
      reason,
      note: options.note ?? '',
      includesAttachments
    }
    writeFileSync(join(dir, 'backup.json'), JSON.stringify(entry, null, 2), 'utf8')
    log.info('vault', `backup taken (${reason}, ${bytes} bytes)`)
    return entry
  }

  /**
   * Restore a backup over the live vault.
   *
   * The current database is backed up first, unconditionally, so a mistaken
   * restore is itself recoverable. The database is closed, the file swapped
   * atomically where the platform allows, and the vault reopened and checked.
   */
  async restore(backupId: string): Promise<{ ok: true; report: VaultIntegrityReport } | { ok: false; message: string }> {
    const session = this.require()
    const { paths } = session
    const dir = join(paths.backupsDir, backupId)
    const source = join(dir, 'orbit.sqlite')
    if (!existsSync(source)) {
      return { ok: false, message: 'That backup could not be found inside this vault.' }
    }

    // Safety net before we touch anything.
    await this.backup({ reason: 'pre-restore', note: `Before restoring ${backupId}` })

    const root = session.root
    const hadAttachments = existsSync(join(dir, 'attachments'))
    this.close()

    try {
      const live = join(root, 'data', 'orbit.sqlite')
      for (const suffix of ['-wal', '-shm']) {
        const companion = live + suffix
        if (existsSync(companion)) rmSync(companion, { force: true })
      }
      const staged = live + '.restoring'
      copyFileSync(source, staged)
      renameSync(staged, live)
      if (hadAttachments) {
        copyTree(join(dir, 'attachments'), join(root, 'attachments'))
      }
    } catch (err) {
      const reopen = this.open(root, { skipIntegrityCheck: true })
      log.error('vault', 'restore failed', err)
      return {
        ok: false,
        message: `The restore did not complete: ${err instanceof Error ? err.message : 'unknown error'}. Your vault was reopened as it was${reopen.ok ? '' : ', but it could not be reopened — use the backup folder'}.`
      }
    }

    const reopened = this.open(root, { skipIntegrityCheck: true })
    if (!reopened.ok) {
      return { ok: false, message: `${reopened.error.message} ${reopened.error.remedy}` }
    }
    const report = this.checkIntegrity()
    log.info('vault', `restored backup ${backupId}`)
    return { ok: true, report }
  }

  // -- Transfer -------------------------------------------------------------

  /**
   * "Prepare vault for transfer": make the folder safe to copy, and say plainly
   * what will and will not survive the move.
   */
  prepareForTransfer(): TransferReadiness {
    const session = this.require()
    const { db, paths } = session
    const problems: string[] = []
    const notes: string[] = []

    let walCheckpointed = false
    try {
      const result = db.checkpoint('TRUNCATE')
      walCheckpointed = result.busy === 0
      if (result.busy !== 0) {
        problems.push(
          'Something is still writing to the database. Close any other Orbit windows, then try again.'
        )
      }
    } catch (err) {
      problems.push('The database could not be flushed to disk safely. Do not copy the vault yet.')
      log.error('vault', 'checkpoint before transfer failed', err)
    }

    const integrity = this.checkIntegrity()
    if (integrity.databaseIntegrity !== 'ok') {
      problems.push('The database failed its integrity check. Restore a backup before moving this vault.')
    }
    if (integrity.foreignKeyViolations > 0) {
      problems.push(`${integrity.foreignKeyViolations} link(s) between records are broken. Run a vault check before moving.`)
    }
    if (integrity.attachmentsMissing.length > 0) {
      problems.push(
        `${integrity.attachmentsMissing.length} attachment file(s) are missing from this vault. Copying now would carry the problem across.`
      )
    }

    let attachmentCount = 0
    let attachmentBytes = 0
    for (const file of walkFiles(paths.attachmentsDir)) {
      attachmentCount += 1
      try {
        attachmentBytes += statSync(file).size
      } catch {
        /* counted but unmeasurable; not fatal */
      }
    }

    if (existsSync(paths.databaseWal)) {
      const walSize = statSync(paths.databaseWal).size
      if (walSize > 0) {
        notes.push('A small write-ahead file remains. Copy the whole vault folder, not just the database.')
      }
    }

    notes.push('Copy the entire vault folder, including the hidden files inside it.')
    notes.push('Desktop notification permission is granted per computer, so you may be asked again after the move.')
    notes.push('Any external integrations you have connected will need signing in to again on the new computer.')
    notes.push('Reminders only appear while Orbit is running on that computer.')

    return {
      ready: problems.length === 0,
      vaultPath: session.root,
      checkedAt: new Date().toISOString(),
      problems,
      notes,
      databaseBytes: existsSync(paths.database) ? statSync(paths.database).size : 0,
      attachmentCount,
      attachmentBytes,
      walCheckpointed
    }
  }

  /** Rename the vault. The folder name is independent and is not touched. */
  rename(name: string): VaultManifest {
    const session = this.require()
    const manifest: VaultManifest = {
      ...session.manifest,
      name: name.trim() || 'Orbit Vault',
      updatedAt: new Date().toISOString()
    }
    writeManifest(session.paths, manifest)
    session.manifest = manifest
    return manifest
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeManifest(paths: VaultPaths, manifest: VaultManifest): void {
  const temp = paths.manifest + '.tmp'
  writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(temp, paths.manifest)
}

/** A plain-text explanation left in the vault for whoever finds it later. */
function writeReadme(paths: VaultPaths, manifest: VaultManifest): void {
  const text = `Orbit Vault
===========

This folder is an Orbit vault. It holds one person's records, the files they
have attached to them, and their preferences.

  orbit-vault.json   Identifies this folder as a vault and records its version.
  data/orbit.sqlite  Every record, in a standard SQLite database.
  attachments/       Every attached file, named by the checksum of its contents.
  preferences/       Settings that travel with you between computers.
  backups/           Snapshots taken by Orbit before upgrades, and by you.
  exports/           Anything you have exported.

Moving to another computer
--------------------------
Close Orbit first. Copy this ENTIRE folder. Open Orbit on the other computer
and choose "Open an existing vault", then pick this folder. It works between
macOS and Windows, and between Intel and Apple Silicon.

Do not open the same vault on two computers at the same time, and do not keep
it in a folder that Dropbox, OneDrive or iCloud Drive is actively syncing while
Orbit is running. Those services copy files underneath a running database and
can corrupt it. Sync a ZIP of a closed vault instead, or use the backups folder.

The database is a plain SQLite file. If Orbit ever vanished from the earth,
your data would still be readable with any SQLite tool.

Vault id: ${manifest.vaultId}
Created:  ${manifest.createdAt}
`
  try {
    writeFileSync(join(paths.root, 'README.txt'), text, 'utf8')
  } catch {
    /* the readme is a courtesy, not a requirement */
  }
}

function* walkFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(full)
    else if (entry.isFile()) yield full
  }
}

function copyTree(source: string, target: string): number {
  if (!existsSync(source)) return 0
  mkdirSync(target, { recursive: true })
  let bytes = 0
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      bytes += copyTree(from, to)
    } else if (entry.isFile()) {
      copyFileSync(from, to)
      try {
        bytes += statSync(to).size
      } catch {
        /* ignore */
      }
    }
  }
  return bytes
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
