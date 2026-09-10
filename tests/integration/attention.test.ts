import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from '../../src/main/vault/manager.js'
import { Repository } from '../../src/main/db/repository.js'
import { SettingsService } from '../../src/main/services/settings.js'
import { RemindersService, nearestPerThing, nextAnniversary } from '../../src/main/services/reminders.js'
import type { AttentionItem } from '../../src/shared/contracts/ipc.js'
import { addDays, today } from '../../src/shared/domain/time.js'

/**
 * The attention engine: what Orbit says needs doing.
 *
 * This is the most load-bearing derived view in the product, and the one where
 * being wrong is most damaging — a missed MOT or a bill reported as overdue
 * when it was paid both destroy trust immediately. It is derived from the
 * records themselves every time it is asked for, so these tests check the
 * derivation rather than a stored notification table.
 */

let workspace: string
let manager: VaultManager
let repo: Repository
let reminders: RemindersService
const now = today()

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'orbit-attention-'))
  manager = new VaultManager('0.1.0-test')
  const result = manager.create(join(workspace, 'Vault'))
  if (!result.ok) throw new Error('setup failed')
  repo = new Repository(result.session.db)
  const settings = new SettingsService(result.session.db)
  settings.ensureDefaults()
  // Everything on, so a module filter cannot hide a failure.
  settings.set({
    modules: ['home', 'vehicles', 'health', 'family', 'pets', 'food', 'travel', 'work', 'relationships', 'goals', 'digital']
  })
  reminders = new RemindersService(result.session.db, repo, settings)
})

afterEach(() => {
  try {
    manager.close()
  } catch {
    /* already closed */
  }
  rmSync(workspace, { recursive: true, force: true })
})

function make(type: string, data: Record<string, unknown>): string {
  const result = repo.create(type, data, { silent: true, defaultCurrency: 'GBP' })
  if (!result.ok) throw new Error(`${type}: ${result.errors.map((e) => e.message).join('; ')}`)
  return result.id
}

describe('bills', () => {
  it('reports a bill that is due', () => {
    make('bill', {
      name: 'Broadband',
      amount_minor: 3499,
      currency: 'GBP',
      anchor_date: addDays(now, 5),
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      status: 'active'
    })
    const items = reminders.attention({ today: now, horizonDays: 30 })
    const bill = items.find((i) => i.title === 'Broadband')
    expect(bill).toBeDefined()
    expect(bill?.amountMinor).toBe(3499)
    expect(bill?.action).toBe('Pay')
  })

  it('stops reporting a bill once that period is recorded as paid', () => {
    const { db } = manager.require()
    const billId = make('bill', {
      name: 'Electricity',
      amount_minor: 11400,
      currency: 'GBP',
      anchor_date: addDays(now, 3),
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      status: 'active'
    })
    expect(reminders.attention({ today: now, horizonDays: 20 }).some((i) => i.title === 'Electricity')).toBe(true)

    const dueDate = addDays(now, 3)
    const stamp = new Date().toISOString()
    db.run(
      `INSERT INTO bill_payments (id, bill_id, period_key, due_date, amount_minor, currency, paid_on, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'GBP', ?, 'paid', '', ?, ?)`,
      ['bp1', billId, dueDate.slice(0, 7), dueDate, 11400, dueDate, stamp, stamp]
    )
    expect(reminders.attention({ today: now, horizonDays: 20 }).some((i) => i.title === 'Electricity')).toBe(false)
  })

  it('does not claim you missed payments from before the bill was recorded', () => {
    // A bill anchored six months ago, added today. Orbit must not report six
    // months of missed payments it has no reason to think were missed.
    make('bill', {
      name: 'Gym',
      amount_minor: 3200,
      currency: 'GBP',
      anchor_date: addDays(now, -180),
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      status: 'active'
    })
    const overdue = reminders.attention({ today: now, horizonDays: 30 }).filter((i) => i.title === 'Gym' && i.severity === 'overdue')
    expect(overdue).toEqual([])
  })

  it('ignores a cancelled bill', () => {
    make('bill', {
      name: 'Cancelled thing',
      amount_minor: 500,
      currency: 'GBP',
      anchor_date: addDays(now, 2),
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      status: 'cancelled'
    })
    expect(reminders.attention({ today: now }).some((i) => i.title === 'Cancelled thing')).toBe(false)
  })

  it('warns about a free trial before it starts charging', () => {
    make('bill', {
      name: 'Streaming',
      amount_minor: 1099,
      currency: 'GBP',
      anchor_date: addDays(now, 30),
      status: 'active',
      trial_ends_on: addDays(now, 6)
    })
    const trial = reminders.attention({ today: now }).find((i) => i.detail.includes('Free trial'))
    expect(trial).toBeDefined()
    expect(trial?.severity).toBe('soon')
  })

  it('counts back from the end of a contract to when notice must be given', () => {
    make('bill', {
      name: 'Broadband contract',
      amount_minor: 3499,
      currency: 'GBP',
      anchor_date: addDays(now, 400),
      status: 'active',
      contract_ends_on: addDays(now, 40),
      notice_period_days: 30
    })
    const notice = reminders.attention({ today: now, horizonDays: 30 }).find((i) => i.action === 'Give notice')
    expect(notice).toBeDefined()
    // 40 days until it ends, 30 days' notice, so the deadline is 10 days away.
    expect(notice?.daysAway).toBe(10)
  })
})

describe('consumer admin', () => {
  it('chases a refund that has not arrived, and never marks it received', () => {
    const purchase = make('purchase', {
      title: 'Headphones',
      purchased_on: addDays(now, -40),
      total_minor: 12999,
      currency: 'GBP'
    })
    make('return', {
      purchase_id: purchase,
      item_name: 'Headphones',
      opened_on: addDays(now, -25),
      status: 'sent',
      sent_on: addDays(now, -21),
      refund_expected_minor: 12999,
      currency: 'GBP'
    })
    const chase = reminders.attention({ today: now }).find((i) => i.action === 'Chase')
    expect(chase).toBeDefined()
    expect(chase?.detail).toMatch(/refund has not arrived/)
  })

  it('says nothing once the refund is recorded as received', () => {
    make('return', {
      item_name: 'Headphones',
      opened_on: addDays(now, -25),
      status: 'refunded',
      sent_on: addDays(now, -21),
      refund_received_on: addDays(now, -3),
      refund_received_minor: 12999,
      currency: 'GBP'
    })
    expect(reminders.attention({ today: now }).some((i) => i.entityType === 'return' && i.action === 'Chase')).toBe(false)
  })

  it('warns before a return deadline passes', () => {
    make('return', {
      item_name: 'Kettle',
      opened_on: now,
      deadline_on: addDays(now, 4),
      status: 'planned',
      currency: 'GBP'
    })
    const deadline = reminders.attention({ today: now }).find((i) => i.detail === 'Return deadline')
    expect(deadline).toBeDefined()
    expect(deadline?.severity).toBe('soon')
  })

  it('warns before a gift card expires', () => {
    make('voucher', { label: 'Bookshop card', kind: 'gift-card', balance_minor: 2500, currency: 'GBP', expires_on: addDays(now, 20) })
    expect(reminders.attention({ today: now, horizonDays: 45 }).some((i) => i.action === 'Spend')).toBe(true)
  })
})

describe('vehicles and the home', () => {
  it('reports servicing due on a date', () => {
    const car = make('asset', { name: 'The car', asset_type: 'vehicle', currency: 'GBP' })
    make('maintenance_schedule', {
      title: 'MOT',
      asset_id: car,
      kind: 'test',
      next_due_on: addDays(now, 14),
      distance_unit: 'mi'
    })
    const mot = reminders.attention({ today: now, horizonDays: 30 }).find((i) => i.title === 'MOT')
    expect(mot).toBeDefined()
    expect(mot?.detail).toBe('The car')
  })

  it('reports servicing due on mileage, from the latest odometer reading', () => {
    const car = make('asset', { name: 'The car', asset_type: 'vehicle', currency: 'GBP' })
    make('maintenance_schedule', {
      title: 'Full service',
      asset_id: car,
      kind: 'service',
      next_due_distance: 80000,
      distance_unit: 'mi'
    })
    // Well short: nothing to say yet.
    make('odometer_reading', { asset_id: car, on_date: addDays(now, -60), distance: 68000, unit: 'mi' })
    expect(reminders.attention({ today: now }).some((i) => i.id.startsWith('maintenance_distance:'))).toBe(false)

    // Close enough to matter.
    make('odometer_reading', { asset_id: car, on_date: now, distance: 79500, unit: 'mi' })
    const due = reminders.attention({ today: now }).find((i) => i.id.startsWith('maintenance_distance:'))
    expect(due).toBeDefined()
    expect(due?.detail).toMatch(/500 miles to go/)
    expect(due?.severity).toBe('soon')
  })

  it('reports mileage servicing as overdue once it is past', () => {
    const car = make('asset', { name: 'The car', asset_type: 'vehicle', currency: 'GBP' })
    make('maintenance_schedule', { title: 'Service', asset_id: car, next_due_distance: 70000, distance_unit: 'mi' })
    make('odometer_reading', { asset_id: car, on_date: now, distance: 71200, unit: 'mi' })
    const due = reminders.attention({ today: now }).find((i) => i.id.startsWith('maintenance_distance:'))
    expect(due?.severity).toBe('overdue')
  })

  it('reports a consumable that is due for replacement', () => {
    make('consumable', { name: 'Smoke alarm batteries', interval_days: 365, next_due_on: addDays(now, 5), currency: 'GBP' })
    expect(reminders.attention({ today: now }).some((i) => i.action === 'Replace')).toBe(true)
  })
})

describe('people and documents', () => {
  it('reminds you to get in touch, once there is something to count from', () => {
    const id = make('person', { display_name: 'Aunt Marjorie', catch_up_days: 30 })
    // No last-contact date: nothing to count from, so Orbit stays quiet rather
    // than inventing one.
    expect(reminders.attention({ today: now }).some((i) => i.entityId === id)).toBe(false)

    repo.update('person', id, { last_contact_on: addDays(now, -28) }, { silent: true })
    const catchUp = reminders.attention({ today: now, horizonDays: 30 }).find((i) => i.entityId === id)
    expect(catchUp).toBeDefined()
    expect(catchUp?.action).toBe('Get in touch')
  })

  it('warns before a document expires', () => {
    make('document', { title: 'Passport', doc_type: 'passport', expires_on: addDays(now, 25) })
    expect(reminders.attention({ today: now, horizonDays: 45 }).some((i) => i.title === 'Passport')).toBe(true)
  })

  it('warns before an insurance policy runs out', () => {
    make('policy', { name: 'Home insurance', kind: 'home-contents', ends_on: addDays(now, 21), currency: 'GBP' })
    expect(reminders.attention({ today: now, horizonDays: 45 }).some((i) => i.title === 'Home insurance')).toBe(true)
  })

  it('orders the worst problem first', () => {
    make('document', { title: 'Expired thing', doc_type: 'passport', expires_on: addDays(now, -5) })
    make('document', { title: 'Later thing', doc_type: 'passport', expires_on: addDays(now, 30) })
    const items = reminders.attention({ today: now, horizonDays: 45 })
    const overdueIndex = items.findIndex((i) => i.title === 'Expired thing')
    const laterIndex = items.findIndex((i) => i.title === 'Later thing')
    expect(overdueIndex).toBeGreaterThanOrEqual(0)
    expect(overdueIndex).toBeLessThan(laterIndex)
  })
})

describe('module filtering', () => {
  it('hides items belonging to an area the user has switched off', () => {
    const { db } = manager.require()
    const settings = new SettingsService(db)
    settings.set({ modules: [] })
    const service = new RemindersService(db, repo, settings)

    make('medication', {
      name: 'Tablets',
      person_id: make('person', { display_name: 'Me' }),
      active: 1,
      next_refill_on: addDays(now, 3)
    })
    expect(service.attention({ today: now }).some((i) => i.title === 'Tablets')).toBe(false)

    settings.set({ modules: ['health'] })
    const withHealth = new RemindersService(db, repo, settings)
    expect(withHealth.attention({ today: now }).some((i) => i.title === 'Tablets')).toBe(true)
  })
})

describe('anniversaries', () => {
  it('rolls a birthday forward to its next occurrence', () => {
    expect(nextAnniversary('1985-06-15', '2026-01-01')).toBe('2026-06-15')
    expect(nextAnniversary('1985-06-15', '2026-06-15')).toBe('2026-06-15')
    expect(nextAnniversary('1985-06-15', '2026-06-16')).toBe('2027-06-15')
  })

  it('falls 29 February back to the 28th in a non-leap year', () => {
    expect(nextAnniversary('2000-02-29', '2026-01-01')).toBe('2026-02-28')
    expect(nextAnniversary('2000-02-29', '2028-01-01')).toBe('2028-02-29')
  })

  it('ignores something that is not a date', () => {
    expect(nextAnniversary('not a date', '2026-01-01')).toBeNull()
  })
})

describe('reminder records', () => {
  it('moves a scheduled reminder to due once its date arrives', () => {
    make('reminder', { label: 'Ring the vet', remind_on: addDays(now, -1), state: 'scheduled' })
    expect(reminders.refreshDue(now)).toBeGreaterThan(0)
    const items = reminders.attention({ today: now })
    expect(items.some((i) => i.title === 'Ring the vet')).toBe(true)
  })

  it('reschedules a repeating reminder rather than closing it', () => {
    const id = make('reminder', {
      label: 'Water the plants',
      remind_on: now,
      state: 'due',
      recurrence: JSON.stringify({ freq: 'weekly', interval: 1 })
    })
    reminders.acknowledge(id)
    const after = repo.get<Record<string, unknown>>('reminder', id)
    expect(after?.state).toBe('scheduled')
    expect(after?.remind_on).toBe(addDays(now, 7))
  })

  it('closes a one-off reminder when acknowledged', () => {
    const id = make('reminder', { label: 'One-off', remind_on: now, state: 'due' })
    reminders.acknowledge(id)
    expect(repo.get<Record<string, unknown>>('reminder', id)?.state).toBe('acknowledged')
  })

  it('snoozes to a date in the future', () => {
    const id = make('reminder', { label: 'Later', remind_on: now, state: 'due' })
    reminders.snooze(id, 3)
    const after = repo.get<Record<string, unknown>>('reminder', id)
    expect(after?.state).toBe('snoozed')
    expect(after?.snoozed_until).toBe(addDays(now, 3))
  })
})

describe('robustness', () => {
  it('produces a briefing from an empty vault without complaining', () => {
    expect(reminders.attention({ today: now })).toEqual([])
  })

  it('survives a record with a malformed recurrence rule', () => {
    make('bill', {
      name: 'Broken cadence',
      amount_minor: 100,
      currency: 'GBP',
      anchor_date: addDays(now, 2),
      cadence: '',
      status: 'active'
    })
    // An empty cadence falls back to monthly rather than throwing.
    expect(() => reminders.attention({ today: now })).not.toThrow()
  })
})

describe('nearestPerThing', () => {
  const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
    id: 'x',
    severity: 'upcoming',
    daysAway: 10,
    date: addDays(now, 10),
    title: 'Vehicle tax',
    detail: '',
    entityType: 'bill',
    entityId: 'bill-1',
    module: 'money',
    ...overrides
  })

  it('keeps one row per thing and counts what it folded away', () => {
    // A monthly bill produces an item per occurrence. Against one record that
    // is the same answer printed twelve times.
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ id: `bill-1:${i}`, daysAway: 21 + i * 30 })
    )
    const collapsed = nearestPerThing(items)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.daysAway).toBe(21)
    expect(collapsed[0]?.laterOccurrences).toBe(11)
  })

  it('keeps genuinely different things apart', () => {
    const collapsed = nearestPerThing([
      item({ id: 'a', title: 'Vehicle tax', entityId: 'bill-1', daysAway: 21 }),
      item({ id: 'b', title: 'MOT test', entityType: 'maintenance_schedule', entityId: 'sched-1', daysAway: 24 }),
      item({ id: 'c', title: 'Car insurance', entityType: 'insurance_policy', entityId: 'pol-1', daysAway: 240 })
    ])
    expect(collapsed.map((c) => c.title)).toEqual(['Vehicle tax', 'MOT test', 'Car insurance'])
    expect(collapsed.every((c) => c.laterOccurrences === 0)).toBe(true)
  })

  it('keeps the soonest even when the input is out of order', () => {
    const collapsed = nearestPerThing([
      item({ id: 'later', daysAway: 200 }),
      item({ id: 'soonest', daysAway: -4, severity: 'overdue' }),
      item({ id: 'middle', daysAway: 30 })
    ])
    expect(collapsed[0]?.daysAway).toBe(-4)
    expect(collapsed[0]?.severity).toBe('overdue')
    expect(collapsed[0]?.laterOccurrences).toBe(2)
  })

  it('does not merge two different records that happen to share a title', () => {
    // Two cars, both with an "MOT test". Folding them together would hide one.
    const collapsed = nearestPerThing([
      item({ id: 'a', title: 'MOT test', entityId: 'sched-1', daysAway: 24 }),
      item({ id: 'b', title: 'MOT test', entityId: 'sched-2', daysAway: 90 })
    ])
    expect(collapsed).toHaveLength(2)
  })

  it('returns nothing for nothing', () => {
    expect(nearestPerThing([])).toEqual([])
  })
})
