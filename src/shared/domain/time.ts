/**
 * Orbit keeps two distinct kinds of time and never confuses them:
 *
 *  - A **CalendarDate** ("2026-03-29") is a floating civil date. Birthdays, due
 *    dates, MOT expiry and all-day events use it. It has no timezone and must
 *    never be round-tripped through a UTC Date, because that silently shifts the
 *    day for anyone east or west of Greenwich.
 *
 *  - An **Instant** (ISO-8601 UTC, "2026-03-29T01:30:00.000Z") is an exact
 *    moment. Timed appointments and reminders use it, always paired with the
 *    IANA timezone the user scheduled it in, so a recurring 09:00 meeting stays
 *    at 09:00 across a daylight-saving change instead of drifting to 08:00.
 */

export type CalendarDate = string // YYYY-MM-DD
export type Instant = string // ISO-8601 with Z

export interface WallClock {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12) return false
  return d >= 1 && d <= daysInMonth(y, m)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toCalendarDate(d: Date): CalendarDate {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

/** Today in the machine's local calendar. */
export function today(now: Date = new Date()): CalendarDate {
  return toCalendarDate(now)
}

export function parseCalendarDate(date: CalendarDate): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { year: y, month: m, day: d }
}

/** Serial day number, used for date arithmetic without any timezone involvement. */
export function dateToSerial(date: CalendarDate): number {
  const { year, month, day } = parseCalendarDate(date)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

export function serialToDate(serial: number): CalendarDate {
  const d = new Date(serial * 86400000)
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  )
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return serialToDate(dateToSerial(date) + Math.trunc(days))
}

/** Whole days between two calendar dates (to - from). Negative if `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dateToSerial(to) - dateToSerial(from)
}

/**
 * Add months, clamping the day to the end of the target month so that
 * 31 January + 1 month is 28/29 February rather than spilling into March.
 * `anchorDay` lets a monthly series recover the intended day-of-month: a series
 * anchored on the 31st yields 31 Jan, 28 Feb, 31 Mar.
 */
export function addMonthsClamped(date: CalendarDate, months: number, anchorDay?: number): CalendarDate {
  const { year, month, day } = parseCalendarDate(date)
  const wanted = anchorDay ?? day
  const total = (year * 12 + (month - 1)) + Math.trunc(months)
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const clamped = Math.min(wanted, daysInMonth(ty, tm))
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

export function addYearsClamped(date: CalendarDate, years: number, anchorDay?: number): CalendarDate {
  return addMonthsClamped(date, years * 12, anchorDay)
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parseCalendarDate(date)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parseCalendarDate(date)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`
}

export function monthKey(date: CalendarDate): string {
  return date.slice(0, 7)
}

/** 0 = Sunday … 6 = Saturday. Computed from the serial day, timezone-free. */
export function dayOfWeek(date: CalendarDate): number {
  return (((dateToSerial(date) + 4) % 7) + 7) % 7
}

export function startOfWeek(date: CalendarDate, weekStartsOn = 1): CalendarDate {
  const diff = (dayOfWeek(date) - weekStartsOn + 7) % 7
  return addDays(date, -diff)
}

// ---------------------------------------------------------------------------
// Timezone handling
// ---------------------------------------------------------------------------

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    offsetFormatters.set(timeZone, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatterFor(tz).format(new Date())
    return true
  } catch {
    return false
  }
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The wall-clock reading in `timeZone` at a given instant. */
export function wallClockIn(instantMs: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const hour = get('hour')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines report midnight as hour 24 under h23; normalise it.
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second')
  }
}

/** Offset in ms such that `localWallClockAsUTC = instant + offset`. */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000
  const wc = wallClockIn(whole, timeZone)
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second)
  return asUtc - whole
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  )
}

/**
 * Convert a wall-clock reading in `timeZone` to a UTC instant.
 *
 * Two candidate instants are produced using the zone's offset a day either
 * side, which brackets any transition. Then:
 *
 *  - Both candidates read back as the requested time  -> AMBIGUOUS. This is the
 *    hour that repeats when the clocks go back. Orbit picks the FIRST
 *    occurrence, which is what calendars conventionally do.
 *  - Exactly one reads back correctly -> that is the answer, the ordinary case.
 *  - Neither reads back correctly -> NON-EXISTENT. This is the hour skipped
 *    when the clocks go forward. Orbit shifts forward out of the gap, so an
 *    01:30 alarm on the morning the clocks change fires at 02:30 rather than
 *    vanishing or firing an hour early.
 */
export function zonedToInstant(wc: WallClock, timeZone: string): number {
  const naive = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second)
  const DAY = 86400000
  const offsetBefore = zoneOffsetMs(naive - DAY, timeZone)
  const offsetAfter = zoneOffsetMs(naive + DAY, timeZone)

  const candidates = [naive - offsetBefore, naive - offsetAfter]
  const valid = candidates.filter((c) => sameWallClock(wallClockIn(c, timeZone), wc))

  if (valid.length === 2) return Math.min(valid[0] as number, valid[1] as number)
  if (valid.length === 1) return valid[0] as number
  return Math.max(candidates[0] as number, candidates[1] as number)
}

export function dateTimeToInstant(
  date: CalendarDate,
  time: string,
  timeZone: string
): Instant {
  const [h, m, s] = (time || '00:00').split(':').map((n) => Number(n) || 0)
  const { year, month, day } = parseCalendarDate(date)
  const ms = zonedToInstant(
    { year, month, day, hour: h ?? 0, minute: m ?? 0, second: s ?? 0 },
    timeZone
  )
  return new Date(ms).toISOString()
}

export function instantToZonedDate(instant: Instant, timeZone: string): CalendarDate {
  const wc = wallClockIn(Date.parse(instant), timeZone)
  return `${String(wc.year).padStart(4, '0')}-${String(wc.month).padStart(2, '0')}-${String(wc.day).padStart(2, '0')}`
}

export function instantToZonedTime(instant: Instant, timeZone: string): string {
  const wc = wallClockIn(Date.parse(instant), timeZone)
  return `${String(wc.hour).padStart(2, '0')}:${String(wc.minute).padStart(2, '0')}`
}

export function nowInstant(): Instant {
  return new Date().toISOString()
}
