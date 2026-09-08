import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from '../../src/main/vault/manager.js'
import { Repository } from '../../src/main/db/repository.js'
import { ENTITIES } from '../../src/shared/contracts/entities/index.js'
import type { EntityDescriptor } from '../../src/shared/contracts/fields.js'

/**
 * Every record type must be creatable through the same path the interface uses.
 *
 * The entity descriptors drive the forms, the validation and the lists, while
 * the SQL schema enforces the constraints. This test is the thing that stops
 * those two drifting apart: it builds a minimal valid record for every declared
 * type from its own descriptor and checks the database accepts it. A field
 * renamed in one place and not the other fails here rather than in front of a
 * user with a form that will not save.
 */

let workspace: string
let manager: VaultManager
let repo: Repository

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'orbit-records-'))
  manager = new VaultManager('0.1.0-test')
  const result = manager.create(join(workspace, 'Vault'))
  if (!result.ok) throw new Error(`could not create the test vault: ${result.error.message}`)
  repo = new Repository(result.session.db)
})

afterEach(() => {
  try {
    manager.close()
  } catch {
    /* already closed */
  }
  rmSync(workspace, { recursive: true, force: true })
})

/**
 * Build the smallest record the descriptor says is valid. References are
 * satisfied by creating the record they point at first, recursively.
 */
function minimalRecord(entity: EntityDescriptor, made: Map<string, string>, depth = 0): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const field of entity.fields) {
    if (!field.required) continue
    switch (field.type) {
      case 'money':
      case 'number':
        data[field.name] = 100
        break
      case 'date':
        data[field.name] = '2026-06-15'
        break
      case 'time':
        data[field.name] = '09:30'
        break
      case 'boolean':
        data[field.name] = 1
        break
      case 'select':
        data[field.name] = field.options?.find((o) => o.value)?.value ?? ''
        break
      case 'ref': {
        if (depth > 3) {
          data[field.name] = null
          break
        }
        const targetType = field.refType as string
        let id = made.get(targetType)
        if (!id) {
          const target = ENTITIES.find((e) => e.type === targetType)
          if (target) {
            const created = repo.create(target.type, minimalRecord(target, made, depth + 1), { silent: true })
            if (created.ok) {
              id = created.id
              made.set(targetType, id)
            }
          }
        }
        data[field.name] = id ?? null
        break
      }
      default:
        data[field.name] = `Test ${field.label}`
    }
  }
  // A currency column is NOT NULL in several tables even where the descriptor
  // does not mark it required, because an amount without a currency is
  // meaningless. Supply one whenever the record has the column.
  if (entity.fields.some((f) => f.name === 'currency')) data.currency ??= 'GBP'
  return data
}

describe('every declared record type', () => {
  it('can be created through the repository', () => {
    const made = new Map<string, string>()
    const failures: { type: string; message: string }[] = []

    for (const entity of ENTITIES) {
      const data = minimalRecord(entity, made)
      const result = repo.create(entity.type, data, { silent: true })
      if (!result.ok) {
        failures.push({ type: entity.type, message: result.errors.map((e) => `${e.field}: ${e.message}`).join('; ') })
      } else {
        made.set(entity.type, result.id)
      }
    }

    expect(failures.map((f) => `${f.type} — ${f.message}`)).toEqual([])
  })

  it('can be listed, read back and deleted', () => {
    const made = new Map<string, string>()
    const problems: string[] = []

    for (const entity of ENTITIES) {
      const created = repo.create(entity.type, minimalRecord(entity, made), { silent: true })
      if (!created.ok) continue
      made.set(entity.type, created.id)

      const listed = repo.list(entity.type, { limit: 5 })
      if (listed.rows.length === 0) problems.push(`${entity.type}: created but the list is empty`)

      const fetched = repo.get(entity.type, created.id)
      if (!fetched) problems.push(`${entity.type}: created but could not be read back`)
    }

    // Delete in reverse so children go before the parents they reference.
    for (const entity of [...ENTITIES].reverse()) {
      const id = made.get(entity.type)
      if (!id) continue
      const removed = repo.remove(entity.type, id)
      if (!removed.ok && !/still depends on it/.test(removed.message)) {
        problems.push(`${entity.type}: could not be deleted — ${removed.message}`)
      }
    }

    expect(problems).toEqual([])
  })

  it('names a real table with a matching column for every declared field', () => {
    const { db } = manager.require()
    const problems: string[] = []

    for (const entity of ENTITIES) {
      const columns = db.all<{ name: string }>(`PRAGMA table_info("${entity.table}")`)
      if (columns.length === 0) {
        problems.push(`${entity.type}: table "${entity.table}" does not exist`)
        continue
      }
      const names = new Set(columns.map((c) => c.name))
      if (!names.has(entity.titleField)) {
        problems.push(`${entity.type}: title field "${entity.titleField}" is not a column of ${entity.table}`)
      }
      if (entity.dateField && !names.has(entity.dateField)) {
        problems.push(`${entity.type}: date field "${entity.dateField}" is not a column of ${entity.table}`)
      }
      for (const field of entity.fields) {
        if (!names.has(field.name)) {
          problems.push(`${entity.type}: field "${field.name}" is not a column of ${entity.table}`)
        }
      }
      for (const column of entity.searchFields) {
        if (!names.has(column)) {
          problems.push(`${entity.type}: search field "${column}" is not a column of ${entity.table}`)
        }
      }
      for (const rollup of entity.costRollup ?? []) {
        const target = db.all<{ name: string }>(`PRAGMA table_info("${rollup.table}")`)
        const targetNames = new Set(target.map((c) => c.name))
        if (target.length === 0) problems.push(`${entity.type}: cost rollup table "${rollup.table}" does not exist`)
        else {
          for (const column of [rollup.foreignKey, rollup.amountColumn, rollup.dateColumn]) {
            if (!targetNames.has(column)) {
              problems.push(`${entity.type}: cost rollup column "${column}" missing from ${rollup.table}`)
            }
          }
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('refuses values outside a declared select list', () => {
    const result = repo.create('task', { title: 'Bad status', status: 'not-a-real-status' }, { silent: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/not one of the available choices/)
  })

  it('refuses a date that is not a date', () => {
    const result = repo.create('task', { title: 'Bad date', due_date: '31/02/2026' }, { silent: true })
    expect(result.ok).toBe(false)
  })

  it('refuses a link that would point at nothing', () => {
    const result = repo.create('transaction', {
      account_id: 'no-such-account',
      date: '2026-01-01',
      description: 'Orphan',
      amount_minor: -100,
      currency: 'GBP',
      kind: 'expense'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/no longer exists|still depends|refers to a record/)
  })

  it('keeps a snapshot so a delete can be undone', () => {
    const created = repo.create('note', { title: 'Bin day', body: 'Tuesday' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(repo.remove('note', created.id).ok).toBe(true)
    expect(repo.get('note', created.id)).toBeNull()

    const history = repo.history('note', created.id, 5)
    const deletion = history.find((h) => h.action === 'deleted')
    expect(deletion).toBeDefined()

    const restored = repo.restore(String(deletion?.id))
    expect(restored.ok).toBe(true)
    const back = repo.get<Record<string, unknown>>('note', created.id)
    expect(back?.title).toBe('Bin day')
    expect(back?.body).toBe('Tuesday')
  })

  it('records what changed when a record is edited', () => {
    const created = repo.create('note', { title: 'Before', body: 'x' })
    if (!created.ok) throw new Error('setup failed')
    repo.update('note', created.id, { title: 'After' })
    const history = repo.history('note', created.id, 10)
    const update = history.find((h) => h.action === 'updated')
    expect(update).toBeDefined()
    expect(String(update?.summary)).toMatch(/Title/)
  })
})
