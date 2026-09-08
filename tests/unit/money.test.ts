import { describe, it, expect } from 'vitest'
import {
  convertMinor,
  currencyOf,
  formatMoney,
  parseAmount,
  scaleMinor,
  splitByWeights,
  splitEvenly,
  sumMinor,
  toDecimalString
} from '@shared/domain/money.js'

describe('parseAmount', () => {
  it('parses plain decimals into minor units', () => {
    expect(parseAmount('12.34')).toEqual({ ok: true, value: 1234 })
    expect(parseAmount('12')).toEqual({ ok: true, value: 1200 })
    expect(parseAmount('0.05')).toEqual({ ok: true, value: 5 })
  })

  it('strips currency symbols and thousands separators', () => {
    expect(parseAmount('£1,234.56')).toEqual({ ok: true, value: 123456 })
    expect(parseAmount('$ 1 234.56')).toEqual({ ok: true, value: 123456 })
    expect(parseAmount('1,234')).toEqual({ ok: true, value: 123400 })
  })

  it('handles European decimal commas', () => {
    // Both separators present: the last one is the decimal point, unambiguously.
    expect(parseAmount('1.234,56', 'EUR')).toEqual({ ok: true, value: 123456 })
    // Only one separator: the caller's locale decides what it means.
    expect(parseAmount('12,34', 'EUR', { decimalSeparator: ',' })).toEqual({ ok: true, value: 1234 })
    expect(parseAmount('1.234', 'EUR', { decimalSeparator: ',' })).toEqual({ ok: true, value: 123400 })
  })

  it('treats parentheses and leading minus as negative', () => {
    expect(parseAmount('(12.34)')).toEqual({ ok: true, value: -1234 })
    expect(parseAmount('-12.34')).toEqual({ ok: true, value: -1234 })
    expect(parseAmount('-£12.34')).toEqual({ ok: true, value: -1234 })
  })

  it('refuses more precision than the currency has, rather than rounding it away', () => {
    const result = parseAmount('12.345')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/2 decimal places/)
  })

  it('handles zero-decimal currencies', () => {
    expect(parseAmount('1200', 'JPY')).toEqual({ ok: true, value: 1200 })
    const bad = parseAmount('12.5', 'JPY')
    expect(bad.ok).toBe(false)
  })

  it('rejects nonsense without throwing', () => {
    expect(parseAmount('').ok).toBe(false)
    expect(parseAmount('abc').ok).toBe(false)
    expect(parseAmount('1.2.3.4').ok).toBe(false)
    expect(parseAmount('12.34.56').ok).toBe(false)
  })
})

describe('formatting', () => {
  it('formats minor units as currency', () => {
    expect(formatMoney(123456, 'GBP')).toBe('£1,234.56')
    expect(formatMoney(-500, 'GBP')).toBe('-£5.00')
    expect(formatMoney(1200, 'JPY')).toBe('JP¥1,200') // en-GB disambiguates the yen sign
  })

  it('round-trips through a decimal string', () => {
    for (const value of [0, 1, 99, 100, -1, -99, 123456789]) {
      const text = toDecimalString(value, 'GBP')
      const parsed = parseAmount(text, 'GBP')
      expect(parsed).toEqual({ ok: true, value })
    }
  })

  it('knows minor-unit exponents', () => {
    expect(currencyOf('GBP').exponent).toBe(2)
    expect(currencyOf('JPY').exponent).toBe(0)
    expect(currencyOf('ZZZ').exponent).toBe(2)
  })
})

describe('arithmetic', () => {
  it('sums without floating point drift', () => {
    const pennies = Array.from({ length: 1000 }, () => 1)
    expect(sumMinor(pennies)).toBe(1000)
    expect(sumMinor([10, 20, -5])).toBe(25)
  })

  it('rounds half away from zero symmetrically', () => {
    expect(scaleMinor(100, 0.125)).toBe(13)
    expect(scaleMinor(-100, 0.125)).toBe(-13)
    expect(scaleMinor(1000, 0.2)).toBe(200)
  })

  it('splits evenly without losing a penny', () => {
    const parts = splitEvenly(1000, 3)
    expect(parts).toEqual([334, 333, 333])
    expect(sumMinor(parts)).toBe(1000)
  })

  it('splits negatives without losing a penny', () => {
    const parts = splitEvenly(-1000, 3)
    expect(sumMinor(parts)).toBe(-1000)
  })

  it('splits by weights preserving the total', () => {
    const parts = splitByWeights(10000, [1, 1, 2])
    expect(sumMinor(parts)).toBe(10000)
    expect(parts).toEqual([2500, 2500, 5000])
  })

  it('splits an awkward total by weights and still balances', () => {
    const parts = splitByWeights(10001, [1, 1, 1])
    expect(sumMinor(parts)).toBe(10001)
  })

  it('falls back to an even split when all weights are zero', () => {
    const parts = splitByWeights(900, [0, 0, 0])
    expect(sumMinor(parts)).toBe(900)
  })
})

describe('currency conversion', () => {
  it('carries the rate and its date with the result', () => {
    const note = { from: 'GBP', to: 'EUR', rate: 1.17, rateDate: '2026-03-01', source: 'entered by hand' }
    const result = convertMinor(10000, note)
    expect(result.minor).toBe(11700)
    expect(result.note.rateDate).toBe('2026-03-01')
    expect(result.note.source).toBe('entered by hand')
  })

  it('handles differing minor-unit exponents', () => {
    const note = { from: 'GBP', to: 'JPY', rate: 190, rateDate: '2026-03-01', source: 'test' }
    // £10.00 at 190 -> ¥1900, which in JPY minor units (exponent 0) is 1900.
    expect(convertMinor(1000, note).minor).toBe(1900)
  })
})
