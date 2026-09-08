/**
 * Money is always stored and moved around Orbit as an integer number of MINOR
 * UNITS (pence, cents, øre …) together with an ISO-4217 currency code.
 *
 * Floating point never touches a stored amount. Parsing and formatting are the
 * only places a decimal string exists, and both are total functions that report
 * failure rather than silently rounding.
 *
 * This carries over the convention used by the Amethyst finance prototype, which
 * stored every amount as an integer number of pence.
 */

export interface Currency {
  readonly code: string
  readonly exponent: number
  readonly symbol: string
}

/** Currencies Orbit knows the minor-unit exponent for. */
const CURRENCIES: Record<string, Currency> = {
  GBP: { code: 'GBP', exponent: 2, symbol: '£' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€' },
  USD: { code: 'USD', exponent: 2, symbol: '$' },
  AUD: { code: 'AUD', exponent: 2, symbol: 'A$' },
  CAD: { code: 'CAD', exponent: 2, symbol: 'C$' },
  NZD: { code: 'NZD', exponent: 2, symbol: 'NZ$' },
  CHF: { code: 'CHF', exponent: 2, symbol: 'CHF' },
  SEK: { code: 'SEK', exponent: 2, symbol: 'kr' },
  NOK: { code: 'NOK', exponent: 2, symbol: 'kr' },
  DKK: { code: 'DKK', exponent: 2, symbol: 'kr' },
  PLN: { code: 'PLN', exponent: 2, symbol: 'zł' },
  INR: { code: 'INR', exponent: 2, symbol: '₹' },
  ZAR: { code: 'ZAR', exponent: 2, symbol: 'R' },
  JPY: { code: 'JPY', exponent: 0, symbol: '¥' },
  KRW: { code: 'KRW', exponent: 0, symbol: '₩' }
}

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES).sort()

export function currencyOf(code: string): Currency {
  const upper = String(code || 'GBP').toUpperCase()
  return CURRENCIES[upper] ?? { code: upper, exponent: 2, symbol: upper + ' ' }
}

export function minorUnitFactor(code: string): number {
  return Math.pow(10, currencyOf(code).exponent)
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Which character a locale uses for the decimal point. */
export function decimalSeparatorForLocale(locale: string): '.' | ',' {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.1)
    const found = parts.find((p) => p.type === 'decimal')?.value
    return found === ',' ? ',' : '.'
  } catch {
    return '.'
  }
}

export interface ParseAmountOptions {
  /**
   * Which character the user's locale treats as the decimal point. This is not
   * a nicety: "1.234" means one thousand two hundred and thirty four in Berlin
   * and an over-precise one pound twenty-three in Bristol, and guessing wrong
   * is a thousand-fold error in somebody's money.
   */
  decimalSeparator?: '.' | ','
}

/**
 * Parse a human-typed amount ("1,234.56", "-£12", "(4.20)") into minor units.
 *
 * Rules, in order:
 *  1. Both separators present -> the LAST one is the decimal point. This is
 *     unambiguous in every locale and overrides the hint.
 *  2. One kind present, and it is the locale's decimal point -> it is the
 *     decimal point, and appearing twice is an error rather than a guess.
 *  3. One kind present, and it is not the locale's decimal point -> it is a
 *     thousands separator.
 *
 * Anything with more precision than the currency supports is REJECTED, never
 * silently rounded. Losing a user's half-penny quietly is how ledgers stop
 * balancing six months later.
 */
export function parseAmount(
  input: string,
  currencyCode = 'GBP',
  opts: ParseAmountOptions = {}
): ParseResult<number> {
  const currency = currencyOf(currencyCode)
  const decimalSep = opts.decimalSeparator ?? '.'
  const groupSep = decimalSep === '.' ? ',' : '.'

  let raw = String(input ?? '').trim()
  if (raw === '') return { ok: false, error: 'Enter an amount.' }

  let negative = false
  if (/^\(.*\)$/.test(raw)) {
    negative = true
    raw = raw.slice(1, -1).trim()
  }

  // Keep only characters that can be part of a number. This removes currency
  // symbols and codes wherever they appear, including before a minus sign.
  raw = raw.replace(/[^0-9.,+-]/g, '')
  if (raw === '') return { ok: false, error: 'That is not a valid amount.' }

  // A sign may lead or trail (some statement exports use a trailing minus).
  if (raw.startsWith('-') || raw.endsWith('-')) negative = !negative
  raw = raw.replace(/[+-]/g, '')
  if (raw === '') return { ok: false, error: 'That is not a valid amount.' }

  const hasDecimalSep = raw.includes(decimalSep)
  const hasGroupSep = raw.includes(groupSep)

  let whole: string
  let fraction = ''

  if (hasDecimalSep && hasGroupSep) {
    const lastDecimal = raw.lastIndexOf(decimalSep)
    const lastGroup = raw.lastIndexOf(groupSep)
    const sep = lastDecimal > lastGroup ? decimalSep : groupSep
    const idx = raw.lastIndexOf(sep)
    whole = raw.slice(0, idx)
    fraction = raw.slice(idx + 1)
  } else if (hasDecimalSep) {
    const occurrences = raw.split(decimalSep).length - 1
    if (occurrences > 1) {
      return { ok: false, error: 'That amount has more than one decimal point.' }
    }
    const idx = raw.indexOf(decimalSep)
    whole = raw.slice(0, idx)
    fraction = raw.slice(idx + 1)
  } else {
    whole = raw
  }

  whole = whole.replace(/[.,]/g, '')
  if (whole === '') whole = '0'
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    return { ok: false, error: 'That is not a valid amount.' }
  }
  if (fraction.length > currency.exponent) {
    return {
      ok: false,
      error:
        currency.exponent === 0
          ? `${currency.code} amounts cannot have decimal places.`
          : `${currency.code} amounts support at most ${currency.exponent} decimal place${currency.exponent === 1 ? '' : 's'}.`
    }
  }
  const padded = (fraction + '0'.repeat(currency.exponent)).slice(0, currency.exponent)
  const digits = whole + padded
  if (digits.length > 15) return { ok: false, error: 'That amount is too large.' }
  const value = Number(digits)
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'That amount is too large.' }
  return { ok: true, value: negative && value !== 0 ? -value : value }
}

/** Format minor units for display. */
export function formatMoney(
  minor: number,
  currencyCode = 'GBP',
  opts: { locale?: string; signDisplay?: 'auto' | 'always' | 'never'; compact?: boolean } = {}
): string {
  const currency = currencyOf(currencyCode)
  const locale = opts.locale || 'en-GB'
  const amount = (Number.isFinite(minor) ? minor : 0) / Math.pow(10, currency.exponent)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: opts.compact ? 0 : currency.exponent,
      maximumFractionDigits: opts.compact ? 0 : currency.exponent,
      signDisplay: opts.signDisplay === 'never' ? 'never' : opts.signDisplay === 'always' ? 'always' : 'auto'
    }).format(opts.signDisplay === 'never' ? Math.abs(amount) : amount)
  } catch {
    return currency.symbol + amount.toFixed(currency.exponent)
  }
}

/** Format minor units as a plain editable decimal string (no symbol). */
export function toDecimalString(minor: number, currencyCode = 'GBP'): string {
  const currency = currencyOf(currencyCode)
  const negative = minor < 0
  const abs = Math.abs(Math.round(minor))
  const factor = Math.pow(10, currency.exponent)
  const whole = Math.floor(abs / factor)
  const frac = abs % factor
  const body = currency.exponent === 0 ? String(whole) : `${whole}.${String(frac).padStart(currency.exponent, '0')}`
  return negative ? '-' + body : body
}

export function sumMinor(values: readonly number[]): number {
  let total = 0
  for (const v of values) total += Math.round(v) || 0
  return total
}

/**
 * Multiply minor units by a rate, rounding half away from zero — deterministic
 * and symmetric for negatives, unlike Math.round.
 */
export function scaleMinor(minor: number, rate: number): number {
  const product = minor * rate
  return product < 0 ? -Math.round(-product) : Math.round(product)
}

/**
 * Split an amount into n parts that always sum back to the original. Remainder
 * pennies are handed out one at a time from the start, so a £10 three-way split
 * is 3.34 / 3.33 / 3.33 and never 3.33 / 3.33 / 3.33 with a penny lost.
 */
export function splitEvenly(minor: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts))
  const sign = minor < 0 ? -1 : 1
  const abs = Math.abs(Math.round(minor))
  const base = Math.floor(abs / n)
  let remainder = abs - base * n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const extra = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder -= 1
    out.push(sign * (base + extra))
  }
  return out
}

/** Split by integer weights (e.g. shares of a bill), preserving the total. */
export function splitByWeights(minor: number, weights: readonly number[]): number[] {
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const totalWeight = safe.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) return splitEvenly(minor, Math.max(1, weights.length))
  const sign = minor < 0 ? -1 : 1
  const abs = Math.abs(Math.round(minor))
  const raw = safe.map((w) => (abs * w) / totalWeight)
  const floors = raw.map((r) => Math.floor(r))
  let remainder = abs - floors.reduce((a, b) => a + b, 0)
  // Hand remaining minor units to the largest fractional parts first.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  const out = floors.slice()
  for (const { i } of order) {
    if (remainder <= 0) break
    out[i] = (out[i] ?? 0) + 1
    remainder -= 1
  }
  return out.map((v) => sign * v)
}

export interface ConversionNote {
  from: string
  to: string
  rate: number
  /** ISO date the rate was recorded — conversions are never presented undated. */
  rateDate: string
  source: string
}

/**
 * Convert between currencies using an explicitly dated rate. Orbit never invents
 * an exchange rate: the caller must supply one, and the note travels with the
 * result so the UI can always show the assumption.
 */
export function convertMinor(
  minor: number,
  note: ConversionNote
): { minor: number; note: ConversionNote } {
  const fromExp = currencyOf(note.from).exponent
  const toExp = currencyOf(note.to).exponent
  const major = minor / Math.pow(10, fromExp)
  const converted = major * note.rate * Math.pow(10, toExp)
  return { minor: converted < 0 ? -Math.round(-converted) : Math.round(converted), note }
}
