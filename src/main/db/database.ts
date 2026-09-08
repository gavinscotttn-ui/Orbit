import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations/index.js'
import type { Row, SqlValue } from './types.js'
import { log } from '../log.js'

export interface MigrationOutcome {
  from: number
  to: number
  applied: { version: number; name: string; ms: number }[]
  backupTaken: string | null
}

export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(
      `This vault was written by a newer version of Orbit (database format ${found}; this build understands up to ${supported}).`
    )
    this.name = 'SchemaTooNewError'
  }
}

/**
 * A thin, honest wrapper over node:sqlite.
 *
 * Deliberate choices:
 *  - WAL journalling, because it survives a crash mid-write far better than the
 *    rollback journal and allows a reader while a write is in flight.
 *  - `synchronous = NORMAL` under WAL: durable against application crashes, and
 *    the one failure mode it does not cover (power loss between checkpoints) is
 *    covered by the pre-migration and manual backups.
 *  - `foreign_keys = ON`, always. Referential integrity is the whole point of a
 *    product built on connections between records.
 *  - `busy_timeout`, so a second process contending for the file waits rather
 *    than failing instantly.
 */
export class OrbitDatabase {
  private db: DatabaseSync
  private txDepth = 0
  private closed = false

  constructor(readonly file: string) {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(file)
    this.applyPragmas()
  }

  private applyPragmas(): void {
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA temp_store = MEMORY')
    // 64 MiB page cache; enough for large reports without being greedy.
    this.db.exec('PRAGMA cache_size = -65536')
  }

  get raw(): DatabaseSync {
    return this.db
  }

  get isClosed(): boolean {
    return this.closed
  }

  // -- Query helpers --------------------------------------------------------

  all<T = Row>(sql: string, params: SqlValue[] | Record<string, SqlValue> = []): T[] {
    const stmt = this.db.prepare(sql)
    const rows = Array.isArray(params) ? stmt.all(...params) : stmt.all(params)
    // node:sqlite returns null-prototype objects; copy so consumers can spread.
    return rows.map((r) => ({ ...(r as object) })) as T[]
  }

  get<T = Row>(sql: string, params: SqlValue[] | Record<string, SqlValue> = []): T | undefined {
    const stmt = this.db.prepare(sql)
    const row = Array.isArray(params) ? stmt.get(...params) : stmt.get(params)
    return row === undefined ? undefined : ({ ...(row as object) } as T)
  }

  run(
    sql: string,
    params: SqlValue[] | Record<string, SqlValue> = []
  ): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(sql)
    const result = Array.isArray(params) ? stmt.run(...params) : stmt.run(params)
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0)
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  scalar<T = SqlValue>(sql: string, params: SqlValue[] = []): T | undefined {
    const row = this.get<Record<string, SqlValue>>(sql, params)
    if (!row) return undefined
    const first = Object.values(row)[0]
    return first as T
  }

  /**
   * Run `fn` in a transaction. Nested calls join the outer transaction via
   * SAVEPOINT, so a repository method can be transactional on its own and still
   * compose into a larger unit of work.
   */
  transaction<T>(fn: () => T): T {
    const name = `sp_${this.txDepth}`
    if (this.txDepth === 0) this.db.exec('BEGIN IMMEDIATE')
    else this.db.exec(`SAVEPOINT ${name}`)
    this.txDepth += 1
    try {
      const result = fn()
      this.txDepth -= 1
      if (this.txDepth === 0) this.db.exec('COMMIT')
      else this.db.exec(`RELEASE ${name}`)
      return result
    } catch (err) {
      this.txDepth -= 1
      try {
        if (this.txDepth === 0) this.db.exec('ROLLBACK')
        else this.db.exec(`ROLLBACK TO ${name}`)
      } catch (rollbackErr) {
        log.error('db', 'rollback failed', rollbackErr)
      }
      throw err
    }
  }

  // -- Schema ---------------------------------------------------------------

  get schemaVersion(): number {
    return Number(this.scalar<number>('PRAGMA user_version') ?? 0)
  }

  /**
   * Bring the database up to the latest schema version.
   *
   * `onBeforeFirstMigration` is called only when there is real work to do on an
   * existing database, so the caller can take a consistent backup first. A
   * brand-new database has nothing worth backing up.
   */
  migrate(onBeforeFirstMigration?: () => string | null): MigrationOutcome {
    const from = this.schemaVersion
    if (from > LATEST_SCHEMA_VERSION) {
      throw new SchemaTooNewError(from, LATEST_SCHEMA_VERSION)
    }

    const pending = MIGRATIONS.filter((m) => m.version > from)
    const outcome: MigrationOutcome = { from, to: from, applied: [], backupTaken: null }
    if (pending.length === 0) return outcome

    const isExisting = from > 0
    if (isExisting && onBeforeFirstMigration) {
      outcome.backupTaken = onBeforeFirstMigration()
    }

    this.ensureMigrationLedger()

    for (const migration of pending) {
      const started = Date.now()
      // Foreign keys must be off while tables are being created or rebuilt, and
      // the toggle is a no-op inside a transaction — hence outside.
      this.db.exec('PRAGMA foreign_keys = OFF')
      try {
        this.transaction(() => {
          if (migration.sql) this.db.exec(migration.sql)
          if (migration.run) migration.run(this.db)
          this.run(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
            [migration.version, migration.name, new Date().toISOString()]
          )
        })
        // user_version cannot be parameterised.
        this.db.exec(`PRAGMA user_version = ${Number(migration.version)}`)
      } finally {
        this.db.exec('PRAGMA foreign_keys = ON')
      }
      const ms = Date.now() - started
      outcome.applied.push({ version: migration.version, name: migration.name, ms })
      outcome.to = migration.version
      log.info('db', `migration ${migration.version} (${migration.name}) applied in ${ms}ms`)
    }

    const violations = this.all('PRAGMA foreign_key_check')
    if (violations.length > 0) {
      throw new Error(
        `Migration left ${violations.length} foreign key violation(s); the vault was not changed on disk beyond the last committed migration.`
      )
    }
    return outcome
  }

  private ensureMigrationLedger(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`)
  }

  // -- Maintenance ----------------------------------------------------------

  /**
   * Flush the write-ahead log into the main database file.
   *
   * TRUNCATE (rather than PASSIVE) is used before a transfer or backup so that
   * `orbit.sqlite` alone is a complete, consistent database and the -wal file is
   * emptied. Copying a database without doing this is exactly how people lose
   * their most recent changes.
   */
  checkpoint(mode: 'PASSIVE' | 'FULL' | 'TRUNCATE' = 'TRUNCATE'): { busy: number; log: number; checkpointed: number } {
    const row = this.get<Record<string, number>>(`PRAGMA wal_checkpoint(${mode})`)
    const values = row ? Object.values(row) : []
    return {
      busy: Number(values[0] ?? 0),
      log: Number(values[1] ?? 0),
      checkpointed: Number(values[2] ?? 0)
    }
  }

  /**
   * A consistent snapshot using SQLite's own online backup API.
   *
   * This is the ONLY safe way to copy a live database. A plain file copy of an
   * open SQLite database — with or without its -wal and -shm companions — can
   * capture a torn state.
   */
  async backupTo(destination: string): Promise<{ path: string; bytes: number; pages: number }> {
    const dir = dirname(destination)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const pages = await sqliteBackup(this.db, destination)
    const bytes = existsSync(destination) ? statSync(destination).size : 0
    return { path: destination, bytes, pages: Number(pages ?? 0) }
  }

  integrityCheck(): { ok: boolean; detail: string } {
    try {
      const rows = this.all<Record<string, string>>('PRAGMA integrity_check')
      const messages = rows.map((r) => String(Object.values(r)[0] ?? '')).filter(Boolean)
      const ok = messages.length === 1 && messages[0] === 'ok'
      return { ok, detail: ok ? 'ok' : messages.join('; ') }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  foreignKeyCheck(): number {
    return this.all('PRAGMA foreign_key_check').length
  }

  vacuum(): void {
    this.db.exec('VACUUM')
  }

  analyse(): void {
    this.db.exec('PRAGMA optimize')
  }

  close(): void {
    if (this.closed) return
    try {
      this.checkpoint('TRUNCATE')
    } catch (err) {
      log.warn('db', 'checkpoint on close failed', err)
    }
    try {
      this.db.close()
    } finally {
      this.closed = true
    }
  }
}
