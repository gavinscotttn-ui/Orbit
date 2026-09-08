import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  /** Monotonic, gapless from 1. Recorded in `PRAGMA user_version`. */
  version: number
  /** Short identifier used in logs and the migration audit table. */
  name: string
  /** Declarative DDL applied inside a transaction. */
  sql?: string
  /** Imperative step for data transformations SQL alone cannot express. */
  run?: (db: DatabaseSync) => void
}

export type SqlValue = string | number | bigint | null | Uint8Array
export type Row = Record<string, SqlValue>
