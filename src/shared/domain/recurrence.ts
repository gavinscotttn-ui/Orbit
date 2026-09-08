/**
 * Recurrence for tasks, events, bills and reminders.
 *
 * Rules are expanded over CALENDAR DATES, never over UTC timestamps, so a
 * daily 09:00 routine stays at 09:00 through a daylight-saving change. The
 * time-of-day is applied afterwards by `time.ts` in the record's own timezone.
 *
 * Two distinct scheduling models are supported, and the difference matters:
 *
 *  - **Fixed schedule** — "the 1st of every month". Missing one does not move
 *    the others. Bills and appointments work this way.
 *  - **Completion-relative** — "six weeks after I last did it". The next date is
 *    computed from the completion date. Gutters, haircuts, boiler services and
 *    descaling the kettle work this way.
 */

import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  daysInMonth,
  dateToSerial,
  dayOfWeek,
  parseCalendarDate,
  serialToDate,
  type CalendarDate
} from './time.js'

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  freq: Frequency
  /** Every N periods. Must be >= 1. */
  interval: number
  /** Weekly: which days (0 = Sunday … 6 = Saturday). Empty means "same day as the anchor". */
  byWeekday?: number[]
  /** Monthly: days of the month. -1 means the last day of the month. */
  byMonthDay?: number[]
  /** Monthly by position, e.g. { weekday: 2, position: 3 } = third Tuesday; position -1 = last. */
  byPosition?: { weekday: number; position: number }
  /** Stop after this many occurrences (counted from the anchor). */
  count?: number
  /** Stop on or before this date. */
  until?: CalendarDate
  /** Individual dates the user has removed from the series. */
  exceptions?: CalendarDate[]
  /** Shift occurrences that land on a weekend. */
  workdayAdjust?: 'none' | 'next' | 'previous'
  /** Schedule from the completion date instead of the fixed series. */
  fromCompletion?: boolean
}

export const DEFAULT_RULE: RecurrenceRule = { freq: 'monthly', interval: 1 }

export function normaliseRule(input: Partial<RecurrenceRule> | null | undefined): RecurrenceRule | null {
  if (!input || !input.freq) return null
  const freq: Frequency = (['daily', 'weekly', 'monthly', 'yearly'] as const).includes(
    input.freq as Frequency
  )
    ? (input.freq as Frequency)
    : 'monthly'
  const rule: RecurrenceRule = {
    freq,
    interval: Math.max(1, Math.floor(Number(input.interval) || 1))
  }
  if (Array.isArray(input.byWeekday) && input.byWeekday.length) {
    rule.byWeekday = [...new Set(input.byWeekday.map((n) => Math.max(0, Math.min(6, Math.floor(n)))))].sort()
  }
  if (Array.isArray(input.byMonthDay) && input.byMonthDay.length) {
    rule.byMonthDay = [...new Set(input.byMonthDay.map((n) => Math.floor(n)).filter((n) => n === -1 || (n >= 1 && n <= 31)))].sort(
      (a, b) => a - b
    )
  }
  if (input.byPosition && Number.isFinite(input.byPosition.weekday)) {
    rule.byPosition = {
      weekday: Math.max(0, Math.min(6, Math.floor(input.byPosition.weekday))),
      position: Math.max(-1, Math.min(5, Math.floor(input.byPosition.position) || 1)) || 1
    }
  }
  if (Number.isFinite(input.count) && (input.count as number) > 0) rule.count = Math.floor(input.count as number)
  if (typeof input.until === 'string' && input.until) rule.until = input.until
  if (Array.isArray(input.exceptions) && input.exceptions.length) rule.exceptions = [...new Set(input.exceptions)]
  if (input.workdayAdjust && input.workdayAdjust !== 'none') rule.workdayAdjust = input.workdayAdjust
  if (input.fromCompletion) rule.fromCompletion = true
  return rule
}

function applyWorkdayAdjust(date: CalendarDate, mode: RecurrenceRule['workdayAdjust']): CalendarDate {
  if (!mode || mode === 'none') return date
  let d = date
  for (let guard = 0; guard < 7; guard++) {
    const dow = dayOfWeek(d)
    if (dow !== 0 && dow !== 6) return d
    d = addDays(d, mode === 'previous' ? -1 : 1)
  }
  return d
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, position: number): CalendarDate | null {
  const firstSerial = dateToSerial(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  )
  const firstDow = (((firstSerial + 4) % 7) + 7) % 7
  const dim = daysInMonth(year, month)
  if (position > 0) {
    const offset = (weekday - firstDow + 7) % 7
    const day = 1 + offset + (position - 1) * 7
    if (day > dim) return null
    return serialToDate(firstSerial + offset + (position - 1) * 7)
  }
  // position === -1: last matching weekday in the month
  const lastSerial = firstSerial + dim - 1
  const lastDow = (((lastSerial + 4) % 7) + 7) % 7
  const back = (lastDow - weekday + 7) % 7
  return serialToDate(lastSerial - back)
}

/**
 * Generate occurrence dates for a fixed-schedule rule.
 *
 * `anchor` is the first occurrence of the series. Generation walks forward from
 * the anchor so that "every 3 months from 15 Jan" cannot drift, and stops at
 * whichever of `count`, `until` or `rangeEnd` comes first.
 */
export function expandRecurrence(
  anchor: CalendarDate,
  rule: RecurrenceRule | null,
  rangeStart: CalendarDate,
  rangeEnd: CalendarDate,
  limit = 500
): CalendarDate[] {
  if (!rule) {
    return anchor >= rangeStart && anchor <= rangeEnd ? [anchor] : []
  }
  const out: CalendarDate[] = []
  const exceptions = new Set(rule.exceptions ?? [])
  const hardStop = rule.until && rule.until < rangeEnd ? rule.until : rangeEnd
  const anchorParts = parseCalendarDate(anchor)
  let produced = 0

  const emit = (date: CalendarDate): boolean => {
    // Returns false when generation should stop entirely.
    if (rule.count !== undefined && produced >= rule.count) return false
    produced += 1
    if (rule.until && date > rule.until) return false
    const adjusted = applyWorkdayAdjust(date, rule.workdayAdjust)
    if (exceptions.has(date) || exceptions.has(adjusted)) return true
    if (adjusted >= rangeStart && adjusted <= hardStop) out.push(adjusted)
    return out.length < limit
  }

  if (rule.freq === 'daily') {
    let d = anchor
    let guard = 0
    while (d <= hardStop && guard++ < 20000) {
      if (!emit(d)) break
      d = addDays(d, rule.interval)
    }
  } else if (rule.freq === 'weekly') {
    const weekdays = rule.byWeekday?.length ? rule.byWeekday : [dayOfWeek(anchor)]
    // Walk week blocks from the anchor's week.
    let weekStartSerial = dateToSerial(anchor) - ((dayOfWeek(anchor) - 0 + 7) % 7)
    let guard = 0
    outer: while (guard++ < 6000) {
      const weekStart = serialToDate(weekStartSerial)
      if (weekStart > hardStop) break
      for (const wd of weekdays) {
        const date = serialToDate(weekStartSerial + wd)
        if (date < anchor) continue
        if (date > hardStop) break outer
        if (!emit(date)) break outer
      }
      weekStartSerial += 7 * rule.interval
    }
  } else if (rule.freq === 'monthly') {
    let cursorMonth = 0
    let guard = 0
    outer2: while (guard++ < 2400) {
      const base = addMonthsClamped(anchor, cursorMonth * rule.interval, 1)
      const { year, month } = parseCalendarDate(base)
      if (base > hardStop && !(rule.byMonthDay || rule.byPosition)) break
      const dates: CalendarDate[] = []
      if (rule.byPosition) {
        const d = nthWeekdayOfMonth(year, month, rule.byPosition.weekday, rule.byPosition.position)
        if (d) dates.push(d)
      } else if (rule.byMonthDay?.length) {
        for (const md of rule.byMonthDay) {
          const dim = daysInMonth(year, month)
          const day = md === -1 ? dim : Math.min(md, dim)
          dates.push(
            `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          )
        }
      } else {
        dates.push(addMonthsClamped(anchor, cursorMonth * rule.interval, anchorParts.day))
      }
      dates.sort()
      for (const date of dates) {
        if (date < anchor) continue
        if (date > hardStop) break outer2
        if (!emit(date)) break outer2
      }
      const probe = addMonthsClamped(anchor, (cursorMonth + 1) * rule.interval, 1)
      if (probe > hardStop) break
      cursorMonth += 1
    }
  } else {
    let i = 0
    let guard = 0
    while (guard++ < 400) {
      const date = addYearsClamped(anchor, i * rule.interval, anchorParts.day)
      if (date > hardStop) break
      if (date >= anchor && !emit(date)) break
      i += 1
    }
  }
  return out
}

/** The next occurrence strictly after `after`, or null if the series has ended. */
export function nextOccurrence(
  anchor: CalendarDate,
  rule: RecurrenceRule | null,
  after: CalendarDate,
  lookaheadDays = 3660
): CalendarDate | null {
  if (!rule) return anchor > after ? anchor : null
  const from = addDays(after, 1)
  const to = addDays(after, lookaheadDays)
  const dates = expandRecurrence(anchor, rule, from, to, 1)
  return dates[0] ?? null
}

/**
 * Next date for a completion-relative rule: measured from when the job was
 * actually finished, not from when it was due.
 */
export function nextFromCompletion(completedOn: CalendarDate, rule: RecurrenceRule): CalendarDate {
  const { day } = parseCalendarDate(completedOn)
  switch (rule.freq) {
    case 'daily':
      return addDays(completedOn, rule.interval)
    case 'weekly':
      return addDays(completedOn, 7 * rule.interval)
    case 'monthly':
      return addMonthsClamped(completedOn, rule.interval, day)
    case 'yearly':
    default:
      return addYearsClamped(completedOn, rule.interval, day)
  }
}

/** A short human sentence for a rule, used throughout the UI. */
export function describeRule(rule: RecurrenceRule | null): string {
  if (!rule) return 'Does not repeat'
  const n = rule.interval
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const positions: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' }
  let base: string
  switch (rule.freq) {
    case 'daily':
      base = n === 1 ? 'Every day' : `Every ${n} days`
      break
    case 'weekly':
      if (rule.byWeekday?.length) {
        const days = rule.byWeekday.map((d) => dayNames[d]).join(', ')
        base = n === 1 ? `Every week on ${days}` : `Every ${n} weeks on ${days}`
      } else {
        base = n === 1 ? 'Every week' : `Every ${n} weeks`
      }
      break
    case 'monthly':
      if (rule.byPosition) {
        base = `Every ${n === 1 ? '' : n + ' '}month${n === 1 ? '' : 's'} on the ${positions[rule.byPosition.position] ?? rule.byPosition.position + 'th'} ${dayNames[rule.byPosition.weekday]}`
      } else if (rule.byMonthDay?.length) {
        const days = rule.byMonthDay.map((d) => (d === -1 ? 'last day' : ordinal(d))).join(', ')
        base = `Every ${n === 1 ? '' : n + ' '}month${n === 1 ? '' : 's'} on the ${days}`
      } else {
        base = n === 1 ? 'Every month' : `Every ${n} months`
      }
      break
    default:
      base = n === 1 ? 'Every year' : `Every ${n} years`
  }
  if (rule.fromCompletion) base += ', counted from completion'
  if (rule.workdayAdjust === 'next') base += ', moved to the next working day'
  if (rule.workdayAdjust === 'previous') base += ', moved to the previous working day'
  if (rule.count) base += `, ${rule.count} times`
  else if (rule.until) base += `, until ${rule.until}`
  return base
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th')
}
