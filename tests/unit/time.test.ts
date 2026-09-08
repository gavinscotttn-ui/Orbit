import { describe, it, expect } from 'vitest'
import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  dateTimeToInstant,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  endOfMonth,
  instantToZonedDate,
  instantToZonedTime,
  isCalendarDate,
  startOfWeek,
  toCalendarDate,
  wallClockIn,
  zonedToInstant
} from '@shared/domain/time.js'

describe('calendar dates', () => {
  it('validates real dates and rejects impossible ones', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true) // leap year
    expect(isCalendarDate('2026-02-29')).toBe(false) // not a leap year
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(isCalendarDate('not a date')).toBe(false)
  })

  it('does days-between without timezone drift', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30)
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1)
    // Across the UK clock change, which is where naive Date maths loses a day.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('knows days in a month, including February', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29) // divisible by 400
    expect(daysInMonth(1900, 2)).toBe(28) // divisible by 100 but not 400
    expect(daysInMonth(2026, 4)).toBe(30)
  })

  it('computes the weekday without constructing a Date', () => {
    expect(dayOfWeek('2026-01-01')).toBe(4) // a Thursday
    expect(dayOfWeek('2026-01-04')).toBe(0) // a Sunday
  })

  it('finds the start of a week for either week-start convention', () => {
    expect(startOfWeek('2026-01-01', 1)).toBe('2025-12-29') // Monday
    expect(startOfWeek('2026-01-01', 0)).toBe('2025-12-28') // Sunday
  })
})

describe('month arithmetic', () => {
  it('clamps to the end of a short month rather than spilling over', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('recovers the intended day using an anchor', () => {
    // A bill on the 31st: Jan, Feb (clamped), then back to 31 in March.
    expect(addMonthsClamped('2026-01-31', 1, 31)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-01-31', 2, 31)).toBe('2026-03-31')
    expect(addMonthsClamped('2026-01-31', 3, 31)).toBe('2026-04-30')
  })

  it('handles negative months and year rollover', () => {
    expect(addMonthsClamped('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonthsClamped('2026-01-15', -13)).toBe('2024-12-15')
  })

  it('clamps 29 February when adding a year', () => {
    expect(addYearsClamped('2024-02-29', 1)).toBe('2025-02-28')
    expect(addYearsClamped('2024-02-29', 4)).toBe('2028-02-29')
  })

  it('finds the end of a month', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
  })
})

describe('timezones and daylight saving', () => {
  it('converts a London wall clock to the right UTC instant in winter and summer', () => {
    // GMT: 09:00 London is 09:00 UTC.
    expect(dateTimeToInstant('2026-01-15', '09:00', 'Europe/London')).toBe('2026-01-15T09:00:00.000Z')
    // BST: 09:00 London is 08:00 UTC.
    expect(dateTimeToInstant('2026-07-15', '09:00', 'Europe/London')).toBe('2026-07-15T08:00:00.000Z')
  })

  it('keeps a recurring 09:00 meeting at 09:00 either side of the clock change', () => {
    const before = dateTimeToInstant('2026-03-28', '09:00', 'Europe/London')
    const after = dateTimeToInstant('2026-03-30', '09:00', 'Europe/London')
    expect(instantToZonedTime(before, 'Europe/London')).toBe('09:00')
    expect(instantToZonedTime(after, 'Europe/London')).toBe('09:00')
    // And they are genuinely a different number of hours apart in UTC.
    expect(Date.parse(after) - Date.parse(before)).toBe(47 * 3600 * 1000)
  })

  it('shifts a non-existent local time forward out of the spring-forward gap', () => {
    // 01:30 on 29 March 2026 does not exist in London; the clock jumps 01:00 -> 02:00.
    const instant = dateTimeToInstant('2026-03-29', '01:30', 'Europe/London')
    const readBack = instantToZonedTime(instant, 'Europe/London')
    expect(readBack).not.toBe('01:30')
    expect(Date.parse(instant)).toBeGreaterThanOrEqual(Date.parse('2026-03-29T01:00:00.000Z'))
  })

  it('resolves an ambiguous autumn time to the first occurrence', () => {
    // 01:30 on 25 October 2026 happens twice in London (BST then GMT).
    const instant = dateTimeToInstant('2026-10-25', '01:30', 'Europe/London')
    expect(instant).toBe('2026-10-25T00:30:00.000Z') // the BST one, i.e. the earlier
    expect(instantToZonedTime(instant, 'Europe/London')).toBe('01:30')
  })

  it('handles southern-hemisphere and half-hour zones', () => {
    expect(dateTimeToInstant('2026-01-15', '09:00', 'Australia/Sydney')).toBe('2026-01-14T22:00:00.000Z')
    expect(dateTimeToInstant('2026-01-15', '09:00', 'Asia/Kolkata')).toBe('2026-01-15T03:30:00.000Z')
    expect(dateTimeToInstant('2026-01-15', '09:00', 'Pacific/Chatham')).toBe('2026-01-14T19:15:00.000Z')
  })

  it('reads a UTC instant back as the right local date on the other side of midnight', () => {
    // 23:30 UTC on the 14th is already the 15th in Sydney.
    expect(instantToZonedDate('2026-01-14T23:30:00.000Z', 'Australia/Sydney')).toBe('2026-01-15')
    expect(instantToZonedDate('2026-01-14T23:30:00.000Z', 'America/Los_Angeles')).toBe('2026-01-14')
  })

  it('round-trips a wall clock through an instant', () => {
    const wc = { year: 2026, month: 6, day: 1, hour: 14, minute: 45, second: 0 }
    const instant = zonedToInstant(wc, 'America/New_York')
    expect(wallClockIn(instant, 'America/New_York')).toEqual(wc)
  })

  it('formats a local Date as a calendar date without UTC shifting it', () => {
    const d = new Date(2026, 0, 1, 0, 30) // 00:30 local on 1 January
    expect(toCalendarDate(d)).toBe('2026-01-01')
  })
})
