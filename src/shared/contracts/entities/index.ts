import type { EntityDescriptor } from '../fields.js'
import { coreEntities } from './core.js'
import { planEntities } from './plan.js'
import { moneyEntities } from './money.js'
import { lifeEntities } from './life.js'

export const ENTITIES: readonly EntityDescriptor[] = [
  ...coreEntities,
  ...planEntities,
  ...moneyEntities,
  ...lifeEntities
]

const BY_TYPE = new Map(ENTITIES.map((e) => [e.type, e]))
const BY_TABLE = new Map(ENTITIES.map((e) => [e.table, e]))

export function entityFor(type: string): EntityDescriptor | undefined {
  return BY_TYPE.get(type)
}

export function requireEntity(type: string): EntityDescriptor {
  const entity = BY_TYPE.get(type)
  if (!entity) throw new Error(`Unknown record type: ${String(type).slice(0, 40)}`)
  return entity
}

export function entityForTable(table: string): EntityDescriptor | undefined {
  return BY_TABLE.get(table)
}

export function entitiesForModule(module: string): EntityDescriptor[] {
  return ENTITIES.filter((e) => e.module === module)
}

export const ENTITY_TYPES: readonly string[] = ENTITIES.map((e) => e.type)


/**
 * How the record types that belong to no life area are grouped for display.
 *
 * `module: ''` means "always available, cannot be switched off" — that is a
 * real property and the right one for tasks, accounts and people. It is not,
 * however, a heading: putting tasks, transactions, budgets, insurance claims
 * and habits under one word ("Core") is a list, not an index.
 *
 * These sections are presentation only. They take their membership from the
 * files the descriptors are already declared in, so there is nothing to keep in
 * step by hand.
 */
export interface EntitySection {
  key: string
  label: string
  blurb: string
  types: readonly string[]
}

export const ENTITY_SECTIONS: readonly EntitySection[] = [
  {
    key: 'core',
    label: 'People, documents and cover',
    blurb: 'The records everything else hangs off.',
    types: coreEntities.map((e) => e.type)
  },
  {
    key: 'plan',
    label: 'Planning',
    blurb: 'Also reachable from Plan, where they have their own screens.',
    types: planEntities.map((e) => e.type)
  },
  {
    key: 'money',
    label: 'Money',
    blurb: 'Also reachable from Money, where they have their own screens.',
    types: moneyEntities.map((e) => e.type)
  }
]

/** Which display section a record type belongs to, or '' for a life area. */
export function sectionFor(type: string): string {
  return ENTITY_SECTIONS.find((section) => section.types.includes(type))?.key ?? ''
}

export * from '../fields.js'
