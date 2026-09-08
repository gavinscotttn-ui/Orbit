import { ENTITIES, entityFor } from '@shared/contracts/entities/index.js'
import type { OrbitDatabase } from '../db/database.js'
import { log } from '../log.js'

/**
 * Full-text search across every record type, plus the text of attachments
 * Orbit can read.
 *
 * The index is maintained from a queue rather than by triggers. Saving a
 * record enqueues it and returns immediately; a background tick drains the
 * queue. That keeps a save fast when a single edit touches several records,
 * and it means a failure to index can be retried and reported rather than
 * rolling back the user's edit.
 */

export interface SearchHit {
  type: string
  id: string
  title: string
  snippet: string
  module: string
  /** FTS5 rank; lower is better. Exposed so the UI can group by confidence. */
  score: number
  entityLabel: string
}

export interface SearchOptions {
  types?: string[]
  modules?: string[]
  limit?: number
}

/**
 * Turn what a person types into an FTS5 query they cannot get wrong.
 *
 * FTS5's query language has operators (AND, OR, NOT, NEAR, *, ", -, :) that
 * throw a syntax error on unbalanced input. A search box must never show a
 * syntax error, so every token is quoted as a literal and the last one gets a
 * prefix wildcard for as-you-type matching.
 */
export function toFtsQuery(input: string): string {
  const tokens = String(input ?? '')
    .replace(/["*^:()\-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12)
  if (tokens.length === 0) return ''
  return tokens
    .map((token, index) => {
      const quoted = `"${token.replace(/"/g, '')}"`
      return index === tokens.length - 1 && token.length >= 2 ? `${quoted}*` : quoted
    })
    .join(' AND ')
}

export class SearchService {
  constructor(private readonly db: OrbitDatabase) {}

  /** Drain up to `limit` queued index updates. Safe to call repeatedly. */
  processQueue(limit = 200): { indexed: number; removed: number; failed: number } {
    const rows = this.db.all<{ id: string; entity_type: string; entity_id: string; operation: string; attempts: number }>(
      'SELECT id, entity_type, entity_id, operation, attempts FROM search_queue ORDER BY queued_at LIMIT ?',
      [limit]
    )
    let indexed = 0
    let removed = 0
    let failed = 0
    for (const row of rows) {
      try {
        if (row.operation === 'delete') {
          this.removeFromIndex(row.entity_type, row.entity_id)
          removed += 1
        } else {
          this.indexRecord(row.entity_type, row.entity_id)
          indexed += 1
        }
        this.db.run('DELETE FROM search_queue WHERE id = ?', [row.id])
      } catch (err) {
        failed += 1
        const attempts = row.attempts + 1
        if (attempts >= 5) {
          // Give up on this one rather than blocking the queue forever.
          log.warn('search', `dropping an index job after ${attempts} failures`, err)
          this.db.run('DELETE FROM search_queue WHERE id = ?', [row.id])
        } else {
          this.db.run('UPDATE search_queue SET attempts = ?, last_error = ? WHERE id = ?', [
            attempts,
            err instanceof Error ? err.message.slice(0, 200) : 'unknown',
            row.id
          ])
        }
      }
    }
    return { indexed, removed, failed }
  }

  indexRecord(type: string, id: string): void {
    const entity = entityFor(type)
    if (!entity) return
    const row = this.db.get<Record<string, unknown>>(`SELECT * FROM "${entity.table}" WHERE id = ?`, [id])
    if (!row) {
      this.removeFromIndex(type, id)
      return
    }
    const title = String(row[entity.titleField] ?? '').slice(0, 300)
    const bodyParts: string[] = []
    for (const column of entity.searchFields) {
      const value = row[column]
      if (typeof value === 'string' && value) bodyParts.push(value)
    }
    // Attached files that Orbit was able to read contribute their text too, so
    // "dishwasher receipt" can find a text receipt attached to a purchase.
    const attachmentText = this.db.all<{ text_content: string; original_filename: string }>(
      `SELECT a.text_content, a.original_filename FROM attachments a
         JOIN attachment_links l ON l.attachment_id = a.id
        WHERE l.entity_type = ? AND l.entity_id = ? AND a.text_status = 'done'`,
      [type, id]
    )
    for (const att of attachmentText) {
      bodyParts.push(att.original_filename)
      if (att.text_content) bodyParts.push(att.text_content.slice(0, 20_000))
    }
    const filenames = this.db.all<{ original_filename: string }>(
      `SELECT a.original_filename FROM attachments a
         JOIN attachment_links l ON l.attachment_id = a.id
        WHERE l.entity_type = ? AND l.entity_id = ?`,
      [type, id]
    )
    for (const file of filenames) bodyParts.push(file.original_filename)

    const tags = this.db.all<{ name: string }>(
      'SELECT t.name FROM tags t JOIN taggings g ON g.tag_id = t.id WHERE g.entity_type = ? AND g.entity_id = ?',
      [type, id]
    )
    const meta = [entity.label, ...tags.map((t) => t.name)].join(' ')
    const body = bodyParts.join('\n').slice(0, 60_000)

    this.db.transaction(() => {
      this.removeFromIndex(type, id)
      this.db.run(
        'INSERT INTO search_index (entity_type, entity_id, module, title, body, meta) VALUES (?, ?, ?, ?, ?, ?)',
        [type, id, entity.module, title, body, meta]
      )
      const rowid = Number(this.db.scalar<number>('SELECT last_insert_rowid()') ?? 0)
      this.db.run(
        'INSERT OR REPLACE INTO search_docs (entity_type, entity_id, rowid_ref, indexed_at) VALUES (?, ?, ?, ?)',
        [type, id, rowid, new Date().toISOString()]
      )
    })
  }

  removeFromIndex(type: string, id: string): void {
    const doc = this.db.get<{ rowid_ref: number }>(
      'SELECT rowid_ref FROM search_docs WHERE entity_type = ? AND entity_id = ?',
      [type, id]
    )
    if (doc) {
      this.db.run('DELETE FROM search_index WHERE rowid = ?', [doc.rowid_ref])
      this.db.run('DELETE FROM search_docs WHERE entity_type = ? AND entity_id = ?', [type, id])
    }
  }

  search(text: string, options: SearchOptions = {}): SearchHit[] {
    const query = toFtsQuery(text)
    if (!query) return []
    const limit = Math.min(Math.max(1, options.limit ?? 40), 200)
    const clauses = ['search_index MATCH ?']
    const params: (string | number)[] = [query]
    if (options.types?.length) {
      clauses.push(`entity_type IN (${options.types.map(() => '?').join(',')})`)
      params.push(...options.types)
    }
    if (options.modules?.length) {
      clauses.push(`module IN (${options.modules.map(() => '?').join(',')})`)
      params.push(...options.modules)
    }
    let rows: { entity_type: string; entity_id: string; title: string; module: string; snippet: string; rank: number }[]
    try {
      rows = this.db.all(
        `SELECT entity_type, entity_id, title, module,
                snippet(search_index, 4, '[', ']', '…', 12) AS snippet,
                rank
           FROM search_index
          WHERE ${clauses.join(' AND ')}
          ORDER BY rank
          LIMIT ?`,
        [...params, limit]
      )
    } catch (err) {
      // A malformed query should never surface as a database error.
      log.warn('search', 'full-text query failed', err)
      return []
    }
    return rows.map((row) => {
      const entity = entityFor(row.entity_type)
      return {
        type: row.entity_type,
        id: row.entity_id,
        title: row.title || '(untitled)',
        snippet: row.snippet ?? '',
        module: row.module ?? '',
        score: Number(row.rank ?? 0),
        entityLabel: entity?.label ?? row.entity_type
      }
    })
  }

  /**
   * Rebuild the whole index. Offered in Settings for when something has gone
   * wrong, and used after a restore.
   */
  rebuild(onProgress?: (done: number, total: number) => void): { indexed: number } {
    this.db.exec('DELETE FROM search_index')
    this.db.exec('DELETE FROM search_docs')
    this.db.exec('DELETE FROM search_queue')
    let total = 0
    for (const entity of ENTITIES) {
      total += Number(this.db.scalar<number>(`SELECT COUNT(*) FROM "${entity.table}"`) ?? 0)
    }
    let done = 0
    for (const entity of ENTITIES) {
      const ids = this.db.all<{ id: string }>(`SELECT id FROM "${entity.table}"`)
      for (const { id } of ids) {
        try {
          this.indexRecord(entity.type, id)
        } catch (err) {
          log.warn('search', `could not index a ${entity.type}`, err)
        }
        done += 1
        if (onProgress && done % 200 === 0) onProgress(done, total)
      }
    }
    onProgress?.(done, total)
    return { indexed: done }
  }

  stats(): { indexed: number; queued: number } {
    return {
      indexed: Number(this.db.scalar<number>('SELECT COUNT(*) FROM search_docs') ?? 0),
      queued: Number(this.db.scalar<number>('SELECT COUNT(*) FROM search_queue') ?? 0)
    }
  }
}
