import { newId } from '@shared/domain/ids.js'
import { isCalendarDate } from '@shared/domain/time.js'
import { requireEntity } from '@shared/contracts/entities/index.js'
import type { EntityDescriptor, FieldSpec } from '@shared/contracts/fields.js'
import type { OrbitDatabase } from './database.js'
import type { SqlValue } from './types.js'
import { log } from '../log.js'

/**
 * One CRUD path for every record type, driven by the entity descriptors.
 *
 * Every value is checked against the descriptor before it reaches SQL:
 * unknown columns are dropped rather than passed through, select values must
 * be one of the declared options, dates must be real dates, money must be a
 * whole number of minor units, and required fields must be present. The
 * database's own CHECK constraints are the second line of defence, not the
 * first.
 *
 * Column and table names never come from user input — they come from the
 * descriptors, which are code. Values are always bound parameters. There is no
 * string concatenation of user data into SQL anywhere in this file.
 */

export interface ListQuery {
  /** Equality filters, keyed by column name. */
  where?: Record<string, string | number | null>
  /** Columns matched with LIKE, for cheap in-list filtering. */
  search?: string
  /** IS NULL / IS NOT NULL filters. */
  isNull?: string[]
  notNull?: string[]
  /** Range filters on a single column. */
  range?: { column: string; from?: string; to?: string }
  orderBy?: string
  limit?: number
  offset?: number
  /** Include archived / soft-hidden rows. */
  includeArchived?: boolean
}

export interface ListResult<T = Record<string, unknown>> {
  rows: T[]
  total: number
}

export type WriteSource = 'ui' | 'import' | 'automation' | 'migration' | 'demo' | 'system'

export interface WriteOptions {
  source?: WriteSource
  /** Suppress the activity entry, for bulk seeding. */
  silent?: boolean
  summary?: string
}

const ALWAYS_ALLOWED = new Set(['module'])

function isPlainDate(value: unknown): boolean {
  return typeof value === 'string' && (value === '' || isCalendarDate(value))
}

export class Repository {
  constructor(private readonly db: OrbitDatabase) {}

  // -- Validation -----------------------------------------------------------

  /**
   * Reduce arbitrary input to the columns this record type actually has, with
   * each value coerced to the right SQL type. Returns the problems rather than
   * throwing on the first one, so a form can show every error at once.
   */
  private coerce(
    entity: EntityDescriptor,
    input: Record<string, unknown>,
    mode: 'create' | 'update'
  ): { values: Record<string, SqlValue>; errors: { field: string; message: string }[] } {
    const values: Record<string, SqlValue> = {}
    const errors: { field: string; message: string }[] = []
    const byName = new Map(entity.fields.map((f) => [f.name, f]))

    for (const [key, raw] of Object.entries(input)) {
      const spec = byName.get(key)
      if (!spec) {
        if (ALWAYS_ALLOWED.has(key)) values[key] = raw == null ? '' : String(raw)
        // Anything else is dropped in silence: a renamed column in an old
        // client must not be able to write a field this build knows nothing of.
        continue
      }
      const result = this.coerceField(spec, raw)
      if ('error' in result) errors.push({ field: key, message: result.error })
      else values[key] = result.value
    }

    if (mode === 'create') {
      for (const spec of entity.fields) {
        if (spec.name in values) continue
        if (spec.defaultValue !== undefined && spec.defaultValue !== null) {
          const coerced = this.coerceField(spec, spec.defaultValue)
          if (!('error' in coerced)) values[spec.name] = coerced.value
        }
      }
    }

    for (const spec of entity.fields) {
      if (!spec.required) continue
      if (mode === 'update' && !(spec.name in values)) continue
      const value = values[spec.name]
      if (value === undefined || value === null || value === '') {
        errors.push({ field: spec.name, message: `${spec.label} is needed.` })
      }
    }

    return { values, errors }
  }

  private coerceField(spec: FieldSpec, raw: unknown): { value: SqlValue } | { error: string } {
    if (raw === null || raw === undefined) {
      // Nullable columns take null; text columns declared NOT NULL take ''.
      return { value: spec.type === 'number' || spec.type === 'money' || spec.type === 'date' ? null : '' }
    }
    switch (spec.type) {
      case 'boolean':
        return { value: raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0 }
      case 'number': {
        if (raw === '') return { value: null }
        const n = Number(raw)
        if (!Number.isFinite(n)) return { error: `${spec.label} must be a number.` }
        if (spec.min !== undefined && n < spec.min) return { error: `${spec.label} cannot be less than ${spec.min}.` }
        if (spec.max !== undefined && n > spec.max) return { error: `${spec.label} cannot be more than ${spec.max}.` }
        return { value: spec.step && spec.step < 1 ? n : Math.round(n) }
      }
      case 'money': {
        if (raw === '') return { value: null }
        const n = Number(raw)
        if (!Number.isFinite(n)) return { error: `${spec.label} must be an amount.` }
        if (!Number.isSafeInteger(Math.round(n))) return { error: `${spec.label} is too large.` }
        // Amounts arrive already converted to minor units by the renderer's
        // money input, which is the only place a decimal string is parsed.
        return { value: Math.round(n) }
      }
      case 'date': {
        const text = String(raw).trim()
        if (text === '') return { value: null }
        if (!isPlainDate(text)) return { error: `${spec.label} is not a valid date.` }
        return { value: text }
      }
      case 'time': {
        const text = String(raw).trim()
        if (text === '') return { value: '' }
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return { error: `${spec.label} must be a time like 09:30.` }
        return { value: text }
      }
      case 'select': {
        const text = String(raw)
        if (spec.options && !spec.options.some((o) => o.value === text)) {
          return { error: `${spec.label} is not one of the available choices.` }
        }
        return { value: text }
      }
      case 'recurrence':
      case 'json': {
        if (raw === '' || raw === null) return { value: '' }
        if (typeof raw === 'string') {
          try {
            JSON.parse(raw)
            return { value: raw }
          } catch {
            return { error: `${spec.label} is not valid.` }
          }
        }
        try {
          return { value: JSON.stringify(raw) }
        } catch {
          return { error: `${spec.label} could not be saved.` }
        }
      }
      case 'ref': {
        const text = String(raw).trim()
        return { value: text }
      }
      case 'url': {
        const text = String(raw).trim()
        if (text === '') return { value: '' }
        // Only http(s) and mailto are ever stored, so nothing can smuggle a
        // javascript: or file: URL into a link the user might click.
        if (!/^(https?:\/\/|mailto:)/i.test(text)) {
          return { error: `${spec.label} must start with https://, http:// or mailto:.` }
        }
        if (text.length > 2000) return { error: `${spec.label} is too long.` }
        return { value: text }
      }
      case 'longtext':
        return { value: String(raw).slice(0, 100_000) }
      default:
        return { value: String(raw).slice(0, 2000) }
    }
  }

  // -- Reading --------------------------------------------------------------

  list<T = Record<string, unknown>>(type: string, query: ListQuery = {}): ListResult<T> {
    const entity = requireEntity(type)
    const columns = new Set(entity.fields.map((f) => f.name))
    const clauses: string[] = []
    const params: SqlValue[] = []

    if (query.where) {
      for (const [key, value] of Object.entries(query.where)) {
        if (!columns.has(key) && key !== 'id') continue
        if (value === null) {
          clauses.push(`"${key}" IS NULL`)
        } else {
          clauses.push(`"${key}" = ?`)
          params.push(value as SqlValue)
        }
      }
    }
    for (const key of query.isNull ?? []) {
      if (columns.has(key)) clauses.push(`"${key}" IS NULL`)
    }
    for (const key of query.notNull ?? []) {
      if (columns.has(key)) clauses.push(`"${key}" IS NOT NULL`)
    }
    if (query.range && columns.has(query.range.column)) {
      if (query.range.from) {
        clauses.push(`"${query.range.column}" >= ?`)
        params.push(query.range.from)
      }
      if (query.range.to) {
        clauses.push(`"${query.range.column}" <= ?`)
        params.push(query.range.to)
      }
    }
    if (query.search && entity.searchFields.length) {
      const pattern = `%${query.search.replace(/[%_]/g, (c) => '\\' + c)}%`
      const parts = entity.searchFields
        .filter((c) => columns.has(c))
        .map((c) => `"${c}" LIKE ? ESCAPE '\\'`)
      if (parts.length) {
        clauses.push(`(${parts.join(' OR ')})`)
        for (let i = 0; i < parts.length; i++) params.push(pattern)
      }
    }
    if (!query.includeArchived && this.hasColumn(entity.table, 'archived_at')) {
      clauses.push('archived_at IS NULL')
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = Number(
      this.db.scalar<number>(`SELECT COUNT(*) FROM "${entity.table}" ${where}`, params) ?? 0
    )
    // The order clause comes from the descriptor (code) or is validated against
    // the known column list; it is never taken raw from the caller.
    const orderBy = this.safeOrderBy(entity, query.orderBy)
    const limit = Math.min(Math.max(1, query.limit ?? 200), 2000)
    const offset = Math.max(0, query.offset ?? 0)
    const rows = this.db.all<T>(
      `SELECT * FROM "${entity.table}" ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    return { rows, total }
  }

  private safeOrderBy(entity: EntityDescriptor, requested?: string): string {
    if (!requested) return entity.defaultOrder
    const columns = new Set([...entity.fields.map((f) => f.name), 'created_at', 'updated_at', 'id'])
    const parts = requested.split(',').map((p) => p.trim())
    const safe: string[] = []
    for (const part of parts) {
      const match = /^([a-z0-9_]+)(\s+(ASC|DESC))?$/i.exec(part)
      if (!match) continue
      const column = match[1] as string
      if (!columns.has(column)) continue
      safe.push(`"${column}" ${match[3]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`)
    }
    return safe.length ? safe.join(', ') : entity.defaultOrder
  }

  private tableColumnCache = new Map<string, Set<string>>()

  hasColumn(table: string, column: string): boolean {
    let columns = this.tableColumnCache.get(table)
    if (!columns) {
      const rows = this.db.all<{ name: string }>(`PRAGMA table_info("${table}")`)
      columns = new Set(rows.map((r) => String(r.name)))
      this.tableColumnCache.set(table, columns)
    }
    return columns.has(column)
  }

  get<T = Record<string, unknown>>(type: string, id: string): T | null {
    const entity = requireEntity(type)
    const row = this.db.get<T>(`SELECT * FROM "${entity.table}" WHERE id = ?`, [id])
    return row ?? null
  }

  count(type: string, query: ListQuery = {}): number {
    return this.list(type, { ...query, limit: 1 }).total
  }

  // -- Writing --------------------------------------------------------------

  create(
    type: string,
    input: Record<string, unknown>,
    options: WriteOptions = {}
  ): { ok: true; id: string; row: Record<string, unknown> } | { ok: false; errors: { field: string; message: string }[] } {
    const entity = requireEntity(type)
    const { values, errors } = this.coerce(entity, input, 'create')
    if (errors.length) return { ok: false, errors }

    const id = typeof input.id === 'string' && input.id ? input.id : newId()
    const now = new Date().toISOString()
    values.id = id
    if (this.hasColumn(entity.table, 'created_at')) values.created_at = now
    if (this.hasColumn(entity.table, 'updated_at')) values.updated_at = now

    const columns = Object.keys(values)
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT INTO "${entity.table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`

    return this.db.transaction(() => {
      try {
        this.db.run(sql, columns.map((c) => values[c] as SqlValue))
      } catch (err) {
        return { ok: false as const, errors: [{ field: '', message: describeSqlError(err) }] }
      }
      const row = this.get(type, id) as Record<string, unknown>
      if (!options.silent) {
        this.recordActivity(entity, id, 'created', options.summary || String(row[entity.titleField] ?? ''), null, options.source)
      }
      this.queueReindex(entity.type, id, 'upsert')
      return { ok: true as const, id, row }
    })
  }

  update(
    type: string,
    id: string,
    input: Record<string, unknown>,
    options: WriteOptions = {}
  ): { ok: true; row: Record<string, unknown> } | { ok: false; errors: { field: string; message: string }[] } {
    const entity = requireEntity(type)
    const before = this.get(type, id)
    if (!before) return { ok: false, errors: [{ field: '', message: 'That record no longer exists.' }] }

    const { values, errors } = this.coerce(entity, input, 'update')
    if (errors.length) return { ok: false, errors }
    delete values.id
    if (Object.keys(values).length === 0) return { ok: true, row: before as Record<string, unknown> }

    if (this.hasColumn(entity.table, 'updated_at')) values.updated_at = new Date().toISOString()
    const columns = Object.keys(values)
    const sql = `UPDATE "${entity.table}" SET ${columns.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`

    return this.db.transaction(() => {
      try {
        this.db.run(sql, [...columns.map((c) => values[c] as SqlValue), id])
      } catch (err) {
        return { ok: false as const, errors: [{ field: '', message: describeSqlError(err) }] }
      }
      const row = this.get(type, id) as Record<string, unknown>
      if (!options.silent) {
        const changes = diff(before as Record<string, unknown>, row)
        this.recordActivity(
          entity,
          id,
          'updated',
          options.summary || describeChanges(entity, changes),
          before as Record<string, unknown>,
          options.source,
          changes
        )
      }
      this.queueReindex(entity.type, id, 'upsert')
      return { ok: true as const, row }
    })
  }

  /**
   * Delete a record, keeping a full snapshot in the activity log so it can be
   * put back. Nothing in Orbit is destroyed without a way home.
   */
  remove(type: string, id: string, options: WriteOptions = {}): { ok: boolean; message: string } {
    const entity = requireEntity(type)
    const before = this.get(type, id)
    if (!before) return { ok: false, message: 'That record no longer exists.' }

    return this.db.transaction(() => {
      try {
        this.db.run(`DELETE FROM "${entity.table}" WHERE id = ?`, [id])
      } catch (err) {
        return { ok: false, message: describeSqlError(err) }
      }
      this.db.run('DELETE FROM links WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)', [
        entity.type,
        id,
        entity.type,
        id
      ])
      this.db.run('DELETE FROM taggings WHERE entity_type = ? AND entity_id = ?', [entity.type, id])
      this.recordActivity(
        entity,
        id,
        'deleted',
        options.summary || String((before as Record<string, unknown>)[entity.titleField] ?? ''),
        before as Record<string, unknown>,
        options.source,
        {},
        true
      )
      this.queueReindex(entity.type, id, 'delete')
      return { ok: true, message: '' }
    })
  }

  /** Put back a record deleted earlier, from its activity snapshot. */
  restore(activityId: string): { ok: boolean; message: string; type?: string; id?: string } {
    const entry = this.db.get<{ entity_type: string; entity_id: string; snapshot: string; action: string }>(
      'SELECT entity_type, entity_id, snapshot, action FROM activity WHERE id = ?',
      [activityId]
    )
    if (!entry) return { ok: false, message: 'That history entry is not in this vault.' }
    if (!entry.snapshot) return { ok: false, message: 'There is nothing recorded to restore from.' }
    let snapshot: Record<string, unknown>
    try {
      snapshot = JSON.parse(entry.snapshot) as Record<string, unknown>
    } catch {
      return { ok: false, message: 'The saved copy of that record could not be read.' }
    }
    const entity = requireEntity(entry.entity_type)
    const existing = this.get(entity.type, entry.entity_id)
    if (existing) {
      const result = this.update(entity.type, entry.entity_id, snapshot, { summary: 'Restored an earlier version' })
      if (!result.ok) return { ok: false, message: result.errors[0]?.message ?? 'The record could not be restored.' }
    } else {
      const result = this.create(entity.type, { ...snapshot, id: entry.entity_id }, { summary: 'Restored' })
      if (!result.ok) return { ok: false, message: result.errors[0]?.message ?? 'The record could not be restored.' }
    }
    this.recordActivity(entity, entry.entity_id, 'restored', 'Restored from history', null, 'ui')
    return { ok: true, message: '', type: entity.type, id: entry.entity_id }
  }

  // -- Links, tags and history ----------------------------------------------

  link(fromType: string, fromId: string, toType: string, toId: string, relation = 'related', note = ''): void {
    requireEntity(fromType)
    requireEntity(toType)
    this.db.run(
      `INSERT OR IGNORE INTO links (id, from_type, from_id, to_type, to_id, relation, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('lnk'), fromType, fromId, toType, toId, relation, note, new Date().toISOString()]
    )
  }

  unlink(fromType: string, fromId: string, toType: string, toId: string, relation = 'related'): void {
    this.db.run(
      'DELETE FROM links WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND relation = ?',
      [fromType, fromId, toType, toId, relation]
    )
  }

  /** Everything explicitly linked to a record, in both directions. */
  linkedRecords(type: string, id: string): { type: string; id: string; relation: string; direction: 'from' | 'to' }[] {
    const out: { type: string; id: string; relation: string; direction: 'from' | 'to' }[] = []
    for (const row of this.db.all<{ to_type: string; to_id: string; relation: string }>(
      'SELECT to_type, to_id, relation FROM links WHERE from_type = ? AND from_id = ?',
      [type, id]
    )) {
      out.push({ type: row.to_type, id: row.to_id, relation: row.relation, direction: 'from' })
    }
    for (const row of this.db.all<{ from_type: string; from_id: string; relation: string }>(
      'SELECT from_type, from_id, relation FROM links WHERE to_type = ? AND to_id = ?',
      [type, id]
    )) {
      out.push({ type: row.from_type, id: row.from_id, relation: row.relation, direction: 'to' })
    }
    return out
  }

  history(type: string, id: string, limit = 50): Record<string, unknown>[] {
    return this.db.all(
      'SELECT id, at, action, summary, changes, source, undoable FROM activity WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT ?',
      [type, id, Math.min(limit, 500)]
    )
  }

  recordActivity(
    entity: EntityDescriptor,
    id: string,
    action: string,
    summary: string,
    snapshot: Record<string, unknown> | null,
    source: WriteSource = 'ui',
    changes: Record<string, unknown> = {},
    undoable = false
  ): void {
    try {
      this.db.run(
        `INSERT INTO activity (id, at, entity_type, entity_id, action, summary, changes, snapshot, source, undoable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('act'),
          new Date().toISOString(),
          entity.type,
          id,
          action,
          summary.slice(0, 300),
          JSON.stringify(changes),
          snapshot ? JSON.stringify(snapshot) : '',
          source,
          undoable ? 1 : 0
        ]
      )
    } catch (err) {
      // History is valuable, but never valuable enough to fail a user's save.
      log.warn('repository', 'could not write an activity entry', err)
    }
  }

  private queueReindex(type: string, id: string, operation: 'upsert' | 'delete'): void {
    try {
      this.db.run(
        `INSERT OR REPLACE INTO search_queue (id, entity_type, entity_id, operation, queued_at, attempts, last_error)
         VALUES (?, ?, ?, ?, ?, 0, '')`,
        [newId('sq'), type, id, operation, new Date().toISOString()]
      )
    } catch (err) {
      log.warn('repository', 'could not queue a search index update', err)
    }
  }
}

// ---------------------------------------------------------------------------

function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(after)) {
    if (key === 'updated_at') continue
    if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] }
  }
  return changes
}

function describeChanges(entity: EntityDescriptor, changes: Record<string, unknown>): string {
  const labels = new Map(entity.fields.map((f) => [f.name, f.label]))
  const names = Object.keys(changes)
    .map((k) => labels.get(k) ?? k)
    .filter(Boolean)
  if (names.length === 0) return 'No visible change'
  if (names.length <= 3) return `Changed ${names.join(', ')}`
  return `Changed ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** Turn a raw SQLite error into something a person can act on. */
export function describeSqlError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/UNIQUE constraint failed/i.test(message)) {
    return 'There is already a record with those details.'
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return 'That refers to a record that no longer exists, or something else still depends on it.'
  }
  if (/CHECK constraint failed/i.test(message)) {
    const which = /CHECK constraint failed:\s*(\S+)/i.exec(message)?.[1]
    return which
      ? `One of the values is not allowed (${which}).`
      : 'One of the values is not allowed.'
  }
  if (/NOT NULL constraint failed:\s*\S+\.(\S+)/i.test(message)) {
    const column = /NOT NULL constraint failed:\s*\S+\.(\S+)/i.exec(message)?.[1]
    return `${column ?? 'A required field'} cannot be empty.`
  }
  if (/no such table|no such column/i.test(message)) {
    return 'This vault does not have that yet. It may need upgrading.'
  }
  if (/database is locked/i.test(message)) {
    return 'The vault is busy. Try again in a moment, and check it is not open elsewhere.'
  }
  if (/disk I\/O error|readonly database|attempt to write a readonly/i.test(message)) {
    return 'Orbit could not write to the vault. Check the drive is connected and not read-only.'
  }
  log.warn('repository', 'unmapped database error', message)
  return 'That could not be saved.'
}
