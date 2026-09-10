import { addDays, today as todayDate, daysBetween, type CalendarDate } from '@shared/domain/time.js'
import { normaliseRule, nextOccurrence } from '@shared/domain/recurrence.js'
import { billOccurrences } from '@shared/domain/finance.js'
import type { AttentionItem, AttentionSeverity } from '@shared/contracts/ipc.js'
import type { OrbitDatabase } from '../db/database.js'
import type { Repository } from '../db/repository.js'
import type { SettingsService } from './settings.js'
import { log } from './../log.js'

/**
 * What needs the user's attention.
 *
 * Orbit deliberately does not keep a separate "notification" table that has to
 * be kept in step with reality. Instead this service asks the actual records
 * every time: which bills are due, which documents expire, which MOT is
 * approaching, which return deadline is running out, which refund has not
 * arrived. A record edited in one place cannot leave a stale alert behind
 * somewhere else, because there is no stale alert to leave.
 *
 * An honest limitation, stated in the interface as well as here: these are
 * computed while Orbit is running. Orbit does not install a background service
 * on the user's computer, so a reminder for Tuesday is seen when Orbit is next
 * opened, not while it is closed.
 */

interface SourceRow {
  id: string
  title: string
  date: string | null
  detail?: string
  amount_minor?: number | null
  currency?: string | null
}

function severityFor(daysAway: number, soonDays: number): AttentionSeverity {
  if (daysAway < 0) return 'overdue'
  if (daysAway === 0) return 'today'
  if (daysAway <= soonDays) return 'soon'
  return 'upcoming'
}

export class RemindersService {
  constructor(
    private readonly db: OrbitDatabase,
    private readonly repository: Repository,
    private readonly settings: SettingsService
  ) {}

  /**
   * Everything currently wanting attention, newest problem first.
   * `horizonDays` controls how far ahead to look.
   */
  attention(options: { horizonDays?: number; today?: CalendarDate } = {}): AttentionItem[] {
    const now = options.today ?? todayDate()
    const horizon = options.horizonDays ?? 45
    const limit = addDays(now, horizon)
    const enabled = new Set(this.settings.all().modules)
    const items: AttentionItem[] = []

    const push = (
      row: SourceRow,
      config: {
        entityType: string
        module: string
        soonDays: number
        action?: string
        detail?: string
      }
    ): void => {
      if (!row.date) return
      if (config.module && !enabled.has(config.module)) return
      if (row.date > limit) return
      const daysAway = daysBetween(now, row.date)
      items.push({
        // The date is part of the key because one record can be due more than
        // once inside the window — a monthly bill, for instance.
        id: `${config.entityType}:${row.id}:${row.date}`,
        severity: severityFor(daysAway, config.soonDays),
        daysAway,
        date: row.date,
        title: row.title || '(untitled)',
        detail: config.detail ?? row.detail ?? '',
        entityType: config.entityType,
        entityId: row.id,
        module: config.module,
        ...(config.action ? { action: config.action } : {}),
        ...(row.amount_minor != null ? { amountMinor: Number(row.amount_minor) } : {}),
        ...(row.currency ? { currency: String(row.currency) } : {})
      })
    }

    const safely = (label: string, fn: () => void): void => {
      try {
        fn()
      } catch (err) {
        // One broken source must not empty the whole briefing.
        log.warn('reminders', `could not gather ${label}`, err)
      }
    }

    // --- Bills and subscriptions ---------------------------------------------
    /*
     * Bills that are due are DERIVED from each bill's own schedule, not read
     * from a payments table. A bill_payments row only exists once a payment has
     * been recorded, so reading from it would mean a bill never appeared until
     * after it had been paid — precisely backwards.
     */
    safely('bills due', () => {
      const bills = this.db.all<{
        id: string
        name: string
        amount_minor: number
        currency: string
        cadence: string
        anchor_date: string
        due_day: number | null
        status: string
        created_at: string
      }>(
        `SELECT id, name, amount_minor, currency, cadence, anchor_date, due_day, status, created_at
           FROM bills WHERE status = 'active'`
      )
      if (bills.length === 0) return

      const paid = new Set(
        this.db
          .all<{ bill_id: string; period_key: string }>(
            "SELECT bill_id, period_key FROM bill_payments WHERE status IN ('paid','skipped')"
          )
          .map((row) => `${row.bill_id}:${row.period_key}`)
      )

      // Look back a little as well as forward, so a bill missed last week is
      // still shown as overdue rather than quietly disappearing.
      const from = addDays(now, -60)
      for (const bill of bills) {
        const occurrences = billOccurrences(
          {
            id: bill.id,
            name: bill.name,
            amountMinor: bill.amount_minor,
            currency: bill.currency,
            cadence: bill.cadence,
            anchorDate: bill.anchor_date,
            dueDay: bill.due_day,
            status: bill.status
          },
          from,
          limit
        )
        // A bill added today cannot have been missed last August. Only periods
        // that fell due after the record existed are Orbit's business.
        const recordedFrom = String(bill.created_at ?? '').slice(0, 10)
        for (const occurrence of occurrences) {
          if (paid.has(`${bill.id}:${occurrence.periodKey}`)) continue
          if (recordedFrom && occurrence.dueDate < recordedFrom) continue
          // Only complain about the recent past, not every month since the
          // bill was first set up.
          if (occurrence.dueDate < now && daysBetween(occurrence.dueDate, now) > 45) continue
          push(
            {
              id: bill.id,
              title: bill.name,
              date: occurrence.dueDate,
              amount_minor: occurrence.amountMinor,
              currency: occurrence.currency
            },
            { entityType: 'bill', module: '', soonDays: 7, action: 'Pay', detail: 'Bill due' }
          )
        }
      }
    })

    safely('free trials', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, trial_ends_on AS date, amount_minor, currency
           FROM bills WHERE status = 'active' AND trial_ends_on IS NOT NULL AND trial_ends_on <= ?`,
        [limit]
      )
      for (const row of rows) {
        push(row, {
          entityType: 'bill',
          module: '',
          soonDays: 14,
          action: 'Decide',
          detail: 'Free trial ends — you start paying after this'
        })
      }
    })

    safely('contract notice periods', () => {
      const rows = this.db.all<SourceRow & { notice_period_days: number }>(
        `SELECT id, name AS title, contract_ends_on AS date, notice_period_days, amount_minor, currency
           FROM bills WHERE status = 'active' AND contract_ends_on IS NOT NULL`
      )
      for (const row of rows) {
        const notice = Number(row.notice_period_days) || 0
        if (!row.date) continue
        // The date that actually matters is when notice must be GIVEN.
        const noticeBy = notice > 0 ? addDays(row.date, -notice) : row.date
        if (noticeBy > limit) continue
        push(
          { ...row, date: noticeBy },
          {
            entityType: 'bill',
            module: '',
            soonDays: 21,
            action: 'Give notice',
            detail: notice > 0 ? `${notice} days' notice needed before it ends on ${row.date}` : 'Contract ends'
          }
        )
      }
    })

    safely('renewals', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, renewal_date AS date, amount_minor, currency
           FROM bills WHERE status = 'active' AND renewal_date IS NOT NULL AND renewal_date <= ?`,
        [limit]
      )
      for (const row of rows) {
        push(row, { entityType: 'bill', module: '', soonDays: 21, action: 'Review', detail: 'Renews' })
      }
    })

    // --- Documents, policies and qualifications ------------------------------
    safely('document expiry', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, expires_on AS date FROM documents
          WHERE expires_on IS NOT NULL AND expires_on <= ? AND archived_at IS NULL`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'document', module: '', soonDays: 30, action: 'Renew', detail: 'Expires' })
    })

    safely('policy expiry', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, ends_on AS date, premium_minor AS amount_minor, currency
           FROM policies WHERE ends_on IS NOT NULL AND ends_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'policy', module: '', soonDays: 30, action: 'Renew', detail: 'Cover ends' })
    })

    safely('qualification expiry', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, expires_on AS date FROM qualifications WHERE expires_on IS NOT NULL AND expires_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'qualification', module: 'work', soonDays: 60, action: 'Renew', detail: 'Expires' })
    })

    // --- Servicing and the home ----------------------------------------------
    safely('servicing', () => {
      const rows = this.db.all<SourceRow & { asset_name: string }>(
        `SELECT m.id, m.title, m.next_due_on AS date, a.name AS asset_name
           FROM maintenance_schedules m JOIN assets a ON a.id = m.asset_id
          WHERE m.active = 1 AND m.next_due_on IS NOT NULL AND m.next_due_on <= ?`,
        [limit]
      )
      for (const row of rows) {
        push(row, { entityType: 'maintenance_schedule', module: 'home', soonDays: 21, action: 'Book', detail: row.asset_name })
      }
    })

    safely('consumables', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, next_due_on AS date, cost_minor AS amount_minor, currency
           FROM consumables WHERE active = 1 AND next_due_on IS NOT NULL AND next_due_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'consumable', module: 'home', soonDays: 14, action: 'Replace', detail: 'Due for replacement' })
    })

    // --- Consumer admin -------------------------------------------------------
    safely('return deadlines', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, item_name AS title, deadline_on AS date, refund_expected_minor AS amount_minor, currency
           FROM returns WHERE status IN ('planned','sent') AND deadline_on IS NOT NULL AND deadline_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'return', module: '', soonDays: 7, action: 'Send back', detail: 'Return deadline' })
    })

    safely('refunds not arrived', () => {
      const rows = this.db.all<SourceRow & { sent_on: string }>(
        `SELECT id, item_name AS title, sent_on, refund_expected_minor AS amount_minor, currency
           FROM returns
          WHERE status IN ('sent','received') AND refund_received_on IS NULL AND sent_on IS NOT NULL`
      )
      for (const row of rows) {
        const waitingDays = daysBetween(row.sent_on, now)
        if (waitingDays < 14) continue
        items.push({
          id: `refund:${row.id}`,
          severity: waitingDays > 30 ? 'overdue' : 'soon',
          daysAway: -waitingDays,
          date: row.sent_on,
          title: row.title,
          detail: `Sent back ${waitingDays} days ago and the refund has not arrived`,
          entityType: 'return',
          entityId: row.id,
          module: '',
          action: 'Chase',
          ...(row.amount_minor != null ? { amountMinor: Number(row.amount_minor) } : {}),
          ...(row.currency ? { currency: String(row.currency) } : {})
        })
      }
    })

    safely('warranties', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, warranty_ends_on AS date FROM purchases
          WHERE warranty_ends_on IS NOT NULL AND warranty_ends_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'purchase', module: '', soonDays: 30, action: 'Note', detail: 'Warranty ends' })
    })

    safely('vouchers', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, label AS title, expires_on AS date, balance_minor AS amount_minor, currency
           FROM vouchers WHERE used_on IS NULL AND expires_on IS NOT NULL AND expires_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'voucher', module: '', soonDays: 30, action: 'Spend', detail: 'Expires' })
    })

    safely('travel credits', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, provider AS title, expires_on AS date, amount_minor, currency
           FROM travel_credits WHERE used_on IS NULL AND expires_on IS NOT NULL AND expires_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'travel_credit', module: 'travel', soonDays: 45, action: 'Use', detail: 'Travel credit expires' })
    })

    safely('parcels', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, description AS title, expected_on AS date FROM parcels
          WHERE status IN ('expected','in-transit','out-for-delivery') AND expected_on IS NOT NULL AND expected_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'parcel', module: '', soonDays: 3, detail: 'Parcel expected' })
    })

    safely('replies promised', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, subject AS title, response_due_by AS date FROM correspondence
          WHERE resolved_on IS NULL AND response_due_by IS NOT NULL AND response_due_by <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'correspondence', module: '', soonDays: 3, action: 'Chase', detail: 'They said they would reply by now' })
    })

    // --- Health, pets and family ---------------------------------------------
    safely('medication refills', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, next_refill_on AS date FROM medications
          WHERE active = 1 AND next_refill_on IS NOT NULL AND next_refill_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'medication', module: 'health', soonDays: 7, action: 'Order', detail: 'Prescription needs reordering' })
    })

    safely('health follow-ups', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, next_due_on AS date FROM health_records
          WHERE next_due_on IS NOT NULL AND next_due_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'health_record', module: 'health', soonDays: 21, action: 'Book', detail: 'Due again' })
    })

    safely('pet care', () => {
      const rows = this.db.all<SourceRow & { pet_name: string }>(
        `SELECT r.id, r.title, r.next_due_on AS date, p.name AS pet_name
           FROM pet_records r JOIN pets p ON p.id = r.pet_id
          WHERE r.next_due_on IS NOT NULL AND r.next_due_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'pet_record', module: 'pets', soonDays: 21, action: 'Book', detail: row.pet_name })
    })

    safely('school deadlines', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, due_by AS date, amount_minor, currency FROM school_records
          WHERE done = 0 AND due_by IS NOT NULL AND due_by <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'school_record', module: 'family', soonDays: 5, action: 'Reply', detail: 'School deadline' })
    })

    // --- Digital life ---------------------------------------------------------
    safely('domains', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, expires_on AS date, cost_minor AS amount_minor, currency FROM domains
          WHERE expires_on IS NOT NULL AND expires_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'domain', module: 'digital', soonDays: 30, action: 'Renew', detail: 'Domain expires' })
    })

    safely('device backups', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, name AS title, next_backup_on AS date FROM devices
          WHERE next_backup_on IS NOT NULL AND next_backup_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'device', module: 'digital', soonDays: 7, action: 'Back up', detail: 'Backup due' })
    })

    // --- Occasions ------------------------------------------------------------
    safely('occasions', () => {
      const rows = this.db.all<{ id: string; title: string; on_date: string; lead_days: number }>(
        'SELECT id, title, on_date, lead_days FROM occasions'
      )
      for (const row of rows) {
        const next = nextAnniversary(row.on_date, now)
        if (!next || next > limit) continue
        push(
          { id: row.id, title: row.title, date: next },
          { entityType: 'occasion', module: 'relationships', soonDays: Math.max(1, Number(row.lead_days) || 14), action: 'Plan' }
        )
      }
    })

    // --- Servicing that is due on distance rather than a date ----------------
    /*
     * "Every 12 months or 12,000 miles, whichever comes first." The date half is
     * handled above; this is the mileage half, compared against the most recent
     * odometer reading for that vehicle.
     */
    safely('servicing due on mileage', () => {
      const rows = this.db.all<{
        id: string
        title: string
        asset_id: string
        asset_name: string
        next_due_distance: number | null
        distance_unit: string
        latest: number | null
        latest_on: string | null
      }>(
        `SELECT m.id, m.title, m.asset_id, a.name AS asset_name, m.next_due_distance, m.distance_unit,
                (SELECT o.distance FROM odometer_readings o WHERE o.asset_id = m.asset_id ORDER BY o.on_date DESC LIMIT 1) AS latest,
                (SELECT o.on_date  FROM odometer_readings o WHERE o.asset_id = m.asset_id ORDER BY o.on_date DESC LIMIT 1) AS latest_on
           FROM maintenance_schedules m JOIN assets a ON a.id = m.asset_id
          WHERE m.active = 1 AND m.next_due_distance IS NOT NULL`
      )
      for (const row of rows) {
        if (row.latest == null || row.next_due_distance == null) continue
        const remaining = row.next_due_distance - row.latest
        // Warn inside the last 750 miles, or immediately once it is past.
        if (remaining > 750) continue
        const unit = row.distance_unit === 'km' ? 'km' : 'miles'
        items.push({
          id: `maintenance_distance:${row.id}`,
          severity: remaining <= 0 ? 'overdue' : 'soon',
          // Distance is not time, so this is reported as an unscheduled item
          // rather than pretending to know which day it will fall on.
          daysAway: remaining <= 0 ? -1 : 0,
          date: null,
          title: `${row.title} — ${row.asset_name}`,
          detail:
            remaining <= 0
              ? `Due at ${row.next_due_distance.toLocaleString('en-GB')} ${unit}; last reading was ${row.latest.toLocaleString('en-GB')}`
              : `About ${remaining.toLocaleString('en-GB')} ${unit} to go (last reading ${row.latest.toLocaleString('en-GB')}${row.latest_on ? ` on ${row.latest_on}` : ''})`,
          entityType: 'maintenance_schedule',
          entityId: row.id,
          module: 'vehicles',
          action: 'Book'
        })
      }
    })

    // --- People you meant to stay in touch with ------------------------------
    safely('catch-ups', () => {
      const rows = this.db.all<{ id: string; display_name: string; catch_up_days: number; last_contact_on: string | null }>(
        `SELECT id, display_name, catch_up_days, last_contact_on FROM people
          WHERE archived_at IS NULL AND catch_up_days IS NOT NULL AND catch_up_days > 0`
      )
      for (const row of rows) {
        // With no recorded contact there is nothing to count from, so Orbit
        // waits rather than inventing a date.
        if (!row.last_contact_on) continue
        const due = addDays(row.last_contact_on, Math.max(1, Number(row.catch_up_days) || 0))
        if (due > limit) continue
        push(
          { id: row.id, title: row.display_name, date: due },
          {
            entityType: 'person',
            module: 'relationships',
            soonDays: 7,
            action: 'Get in touch',
            detail: `Last in touch ${row.last_contact_on}`
          }
        )
      }
    })

    // --- Explicit reminders and tasks ----------------------------------------
    safely('reminders', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, label AS title, remind_on AS date, detail FROM reminders
          WHERE state IN ('scheduled','due') AND remind_on <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'reminder', module: '', soonDays: 3 })
    })

    safely('tasks', () => {
      const rows = this.db.all<SourceRow>(
        `SELECT id, title, due_date AS date FROM tasks
          WHERE status NOT IN ('done','cancelled') AND due_date IS NOT NULL AND due_date <= ?`,
        [limit]
      )
      for (const row of rows) push(row, { entityType: 'task', module: '', soonDays: 3, action: 'Do' })
    })

    // Worst first, then soonest.
    const rank: Record<AttentionSeverity, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3, info: 4 }
    return items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.daysAway - b.daysAway || a.title.localeCompare(b.title))
  }

  /** Move scheduled reminders whose date has arrived into the 'due' state. */
  refreshDue(now: CalendarDate = todayDate()): number {
    try {
      const result = this.db.run(
        "UPDATE reminders SET state = 'due', last_fired_at = ? WHERE state = 'scheduled' AND remind_on <= ?",
        [new Date().toISOString(), now]
      )
      // A snoozed reminder whose snooze has run out becomes due again.
      this.db.run(
        "UPDATE reminders SET state = 'due' WHERE state = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?",
        [now]
      )
      return result.changes
    } catch (err) {
      log.warn('reminders', 'could not refresh due reminders', err)
      return 0
    }
  }

  acknowledge(id: string): void {
    const reminder = this.db.get<{ recurrence: string; remind_on: string }>(
      'SELECT recurrence, remind_on FROM reminders WHERE id = ?',
      [id]
    )
    if (!reminder) return
    const rule = reminder.recurrence ? normaliseRule(safeJson(reminder.recurrence)) : null
    if (rule) {
      const next = nextOccurrence(reminder.remind_on, rule, todayDate())
      if (next) {
        this.db.run("UPDATE reminders SET state = 'scheduled', remind_on = ?, updated_at = ? WHERE id = ?", [
          next,
          new Date().toISOString(),
          id
        ])
        return
      }
    }
    this.db.run("UPDATE reminders SET state = 'acknowledged', updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      id
    ])
  }

  snooze(id: string, days: number): void {
    const until = addDays(todayDate(), Math.max(1, Math.min(365, Math.round(days))))
    this.db.run("UPDATE reminders SET state = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?", [
      until,
      new Date().toISOString(),
      id
    ])
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The next occurrence of a day-and-month, ignoring the original year. */
export function nextAnniversary(originalDate: string, from: CalendarDate): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(originalDate)) return null
  const monthDay = originalDate.slice(5)
  const year = Number(from.slice(0, 4))
  const candidate = `${year}-${monthDay}`
  // 29 February in a non-leap year falls back to the 28th.
  const valid = (d: string): boolean => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    return new Date(Date.UTC(y, m - 1, day)).getUTCDate() === day
  }
  const fix = (d: string): string => (valid(d) ? d : d.replace(/-02-29$/, '-02-28'))
  const thisYear = fix(candidate)
  if (thisYear >= from) return thisYear
  return fix(`${year + 1}-${monthDay}`)
}

/**
 * Keep only the soonest occurrence of each repeating thing.
 *
 * A recurring bill produces one attention item per future occurrence. On Today
 * that is a forward list and reads correctly. Against a single record it is the
 * same answer printed five times — "when is the vehicle tax due" has one
 * answer, the next one — so the rest are folded away and counted.
 */
export function nearestPerThing(
  items: AttentionItem[]
): (AttentionItem & { laterOccurrences: number })[] {
  const seen = new Map<string, AttentionItem & { laterOccurrences: number }>()
  for (const item of [...items].sort((a, b) => a.daysAway - b.daysAway)) {
    const key = `${item.entityType}:${item.entityId}:${item.title}`
    const existing = seen.get(key)
    if (existing) existing.laterOccurrences += 1
    else seen.set(key, { ...item, laterOccurrences: 0 })
  }
  return [...seen.values()].sort((a, b) => a.daysAway - b.daysAway)
}
