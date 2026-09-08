import { describe, it, expect } from 'vitest'
import {
  describeRule,
  expandRecurrence,
  nextFromCompletion,
  nextOccurrence,
  normaliseRule,
  type RecurrenceRule
} from '@shared/domain/recurrence.js'

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => normaliseRule(r) as RecurrenceRule

describe('daily and weekly', () => {
  it('expands every day within a range', () => {
    const dates = expandRecurrence('2026-01-01', rule({ freq: 'daily', interval: 1 }), '2026-01-01', '2026-01-05')
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'])
  })

  it('honours an interval', () => {
    const dates = expandRecurrence('2026-01-01', rule({ freq: 'daily', interval: 3 }), '2026-01-01', '2026-01-10')
    expect(dates).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10'])
  })

  it('expands specific weekdays', () => {
    // Mondays and Fridays through January 2026.
    const dates = expandRecurrence(
      '2026-01-01',
      rule({ freq: 'weekly', interval: 1, byWeekday: [1, 5] }),
      '2026-01-01',
      '2026-01-14'
    )
    expect(dates).toEqual(['2026-01-02', '2026-01-05', '2026-01-09', '2026-01-12'])
  })

  it('expands fortnightly on one weekday', () => {
    const dates = expandRecurrence(
      '2026-01-05',
      rule({ freq: 'weekly', interval: 2, byWeekday: [1] }),
      '2026-01-01',
      '2026-02-28'
    )
    expect(dates).toEqual(['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16'])
  })
})

describe('monthly across awkward month boundaries', () => {
  it('keeps a 31st bill on the last day of short months and returns to the 31st after', () => {
    const dates = expandRecurrence('2026-01-31', rule({ freq: 'monthly', interval: 1 }), '2026-01-01', '2026-06-30')
    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30'
    ])
  })

  it('handles 29 February in a leap year', () => {
    const dates = expandRecurrence('2024-01-29', rule({ freq: 'monthly', interval: 1 }), '2024-01-01', '2024-04-30')
    expect(dates).toEqual(['2024-01-29', '2024-02-29', '2024-03-29', '2024-04-29'])
  })

  it('expands a specific day of the month', () => {
    const dates = expandRecurrence(
      '2026-01-15',
      rule({ freq: 'monthly', interval: 1, byMonthDay: [1, 15] }),
      '2026-01-01',
      '2026-03-31'
    )
    expect(dates).toEqual(['2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01', '2026-03-15'])
  })

  it('expands the last day of every month', () => {
    const dates = expandRecurrence(
      '2026-01-31',
      rule({ freq: 'monthly', interval: 1, byMonthDay: [-1] }),
      '2026-01-01',
      '2026-04-30'
    )
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('expands the third Tuesday of each month', () => {
    const dates = expandRecurrence(
      '2026-01-20',
      rule({ freq: 'monthly', interval: 1, byPosition: { weekday: 2, position: 3 } }),
      '2026-01-01',
      '2026-04-30'
    )
    expect(dates).toEqual(['2026-01-20', '2026-02-17', '2026-03-17', '2026-04-21'])
  })

  it('expands the last Friday of each month', () => {
    const dates = expandRecurrence(
      '2026-01-30',
      rule({ freq: 'monthly', interval: 1, byPosition: { weekday: 5, position: -1 } }),
      '2026-01-01',
      '2026-03-31'
    )
    expect(dates).toEqual(['2026-01-30', '2026-02-27', '2026-03-27'])
  })

  it('expands quarterly', () => {
    const dates = expandRecurrence('2026-01-15', rule({ freq: 'monthly', interval: 3 }), '2026-01-01', '2026-12-31')
    expect(dates).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
  })
})

describe('yearly', () => {
  it('expands an annual renewal', () => {
    const dates = expandRecurrence('2026-06-01', rule({ freq: 'yearly', interval: 1 }), '2026-01-01', '2029-12-31')
    expect(dates).toEqual(['2026-06-01', '2027-06-01', '2028-06-01', '2029-06-01'])
  })

  it('clamps a 29 February anniversary in non-leap years', () => {
    const dates = expandRecurrence('2024-02-29', rule({ freq: 'yearly', interval: 1 }), '2024-01-01', '2028-12-31')
    expect(dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })
})

describe('limits and exceptions', () => {
  it('stops after `count` occurrences', () => {
    const dates = expandRecurrence('2026-01-01', rule({ freq: 'daily', interval: 1, count: 3 }), '2026-01-01', '2026-12-31')
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
  })

  it('stops on `until`', () => {
    const dates = expandRecurrence(
      '2026-01-01',
      rule({ freq: 'weekly', interval: 1, until: '2026-01-20' }),
      '2026-01-01',
      '2026-12-31'
    )
    expect(dates).toEqual(['2026-01-01', '2026-01-08', '2026-01-15'])
  })

  it('skips exception dates', () => {
    const dates = expandRecurrence(
      '2026-01-01',
      rule({ freq: 'daily', interval: 1, exceptions: ['2026-01-03'] }),
      '2026-01-01',
      '2026-01-05'
    )
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05'])
  })

  it('moves weekend occurrences to the next working day', () => {
    // 1 Feb 2026 is a Sunday; the payment should land on Monday the 2nd.
    const dates = expandRecurrence(
      '2026-02-01',
      rule({ freq: 'monthly', interval: 1, workdayAdjust: 'next' }),
      '2026-01-01',
      '2026-04-30'
    )
    expect(dates[0]).toBe('2026-02-02')
    expect(dates).toEqual(['2026-02-02', '2026-03-02', '2026-04-01'])
  })

  it('only returns occurrences inside the requested window', () => {
    const dates = expandRecurrence('2026-01-01', rule({ freq: 'monthly', interval: 1 }), '2026-03-01', '2026-05-31')
    expect(dates).toEqual(['2026-03-01', '2026-04-01', '2026-05-01'])
  })
})

describe('next occurrence', () => {
  it('finds the next date after a given day', () => {
    expect(nextOccurrence('2026-01-31', rule({ freq: 'monthly', interval: 1 }), '2026-02-01')).toBe('2026-02-28')
    expect(nextOccurrence('2026-01-01', rule({ freq: 'daily', interval: 1 }), '2026-06-15')).toBe('2026-06-16')
  })

  it('returns null once a finite series has ended', () => {
    expect(nextOccurrence('2026-01-01', rule({ freq: 'daily', interval: 1, count: 2 }), '2026-01-05')).toBeNull()
  })
})

describe('completion-relative recurrence', () => {
  it('counts from when the job was actually done, not when it was due', () => {
    // "Every six weeks" done three weeks late still means six weeks from now.
    expect(nextFromCompletion('2026-03-15', rule({ freq: 'weekly', interval: 6 }))).toBe('2026-04-26')
    expect(nextFromCompletion('2026-01-31', rule({ freq: 'monthly', interval: 1 }))).toBe('2026-02-28')
    expect(nextFromCompletion('2026-03-15', rule({ freq: 'yearly', interval: 1 }))).toBe('2027-03-15')
  })
})

describe('descriptions', () => {
  it('describes rules in plain words', () => {
    expect(describeRule(null)).toBe('Does not repeat')
    expect(describeRule(rule({ freq: 'daily', interval: 1 }))).toBe('Every day')
    expect(describeRule(rule({ freq: 'weekly', interval: 2, byWeekday: [1] }))).toBe('Every 2 weeks on Monday')
    expect(describeRule(rule({ freq: 'monthly', interval: 1, byMonthDay: [-1] }))).toBe(
      'Every month on the last day'
    )
    expect(describeRule(rule({ freq: 'monthly', interval: 1, byPosition: { weekday: 2, position: 3 } }))).toBe(
      'Every month on the third Tuesday'
    )
    expect(describeRule(rule({ freq: 'weekly', interval: 6, fromCompletion: true }))).toBe(
      'Every 6 weeks, counted from completion'
    )
  })
})

describe('normalisation', () => {
  it('rejects rubbish and clamps out-of-range values', () => {
    expect(normaliseRule(null)).toBeNull()
    expect(normaliseRule({})).toBeNull()
    const r = normaliseRule({ freq: 'weekly', interval: -5, byWeekday: [9, 1, 1] })
    expect(r?.interval).toBe(1)
    expect(r?.byWeekday).toEqual([1, 6])
  })
})
