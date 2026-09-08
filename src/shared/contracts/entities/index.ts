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

export * from '../fields.js'
