import type { Migration } from '../types.js'
import { migration001 } from './001-core.js'
import { migration002 } from './002-planning.js'
import { migration003 } from './003-finance.js'
import { migration004 } from './004-documents.js'
import { migration005 } from './005-things.js'
import { migration006 } from './006-purchases.js'
import { migration007 } from './007-people-care.js'
import { migration008 } from './008-living.js'
import { migration009 } from './009-capture.js'
import { migration010 } from './010-search.js'

/**
 * Ordered, gapless list of schema migrations.
 *
 * Rules that must never be broken:
 *  - A published migration is immutable. Fix a mistake with a NEW migration.
 *  - Every migration runs inside a transaction and is recorded in
 *    `schema_migrations` before `PRAGMA user_version` is bumped.
 *  - A backup is taken before the first migration of any upgrade run.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0
