import { formatMoney, toDecimalString } from '@shared/domain/money.js'
import { daysBetween, today, type CalendarDate } from '@shared/domain/time.js'

/**
 * Presentation helpers.
 *
 * All of them take the user's locale and currency rather than assuming, and
 * all of them cope with the missing, empty and malformed values that real data
 * contains. A dashboard should never show "Invalid Date" or "NaN".
 */

export interface FormatContext {
  locale: string
  currency: string
  dateFormat: 'auto' | 'dmy' | 'mdy' | 'ymd'
  weekStartsOn: 0 | 1
}

export const DEFAULT_FORMAT: FormatContext = {
  locale: 'en-GB',
  currency: 'GBP',
  dateFormat: 'auto',
  weekStartsOn: 1
}

export function money(minor: number | null | undefined, ctx: FormatContext, currency?: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '—'
  return formatMoney(Number(minor), currency || ctx.currency, { locale: ctx.locale })
}

export function moneyCompact(minor: number | null | undefined, ctx: FormatContext, currency?: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '—'
  return formatMoney(Number(minor), currency || ctx.currency, { locale: ctx.locale, compact: true })
}

export function moneyInput(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return ''
  return toDecimalString(Number(minor), currency)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A date the way this user writes dates. Empty and rubbish become an em dash. */
export function date(value: string | null | undefined, ctx: FormatContext, style: 'short' | 'long' | 'medium' = 'medium'): string {
  if (!value || !DATE_PATTERN.test(value)) return '—'
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  // Constructed as a UTC date and formatted in UTC, so a calendar date is never
  // shifted by the machine's timezone.
  const asDate = new Date(Date.UTC(y, m - 1, d))
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
      : style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
  try {
    if (ctx.dateFormat === 'ymd') return value
    return new Intl.DateTimeFormat(ctx.locale, options).format(asDate)
  } catch {
    return value
  }
}

export function time(value: string | null | undefined): string {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return ''
  return value.slice(0, 5)
}

/** "in 3 days", "yesterday", "in 2 months" — with the plain date beside it. */
export function relativeDays(value: string | null | undefined, ctx: FormatContext, from?: CalendarDate): string {
  if (!value || !DATE_PATTERN.test(value)) return '—'
  const days = daysBetween(from ?? today(), value)
  return relative(days, ctx)
}

export function relative(days: number, ctx: FormatContext): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  try {
    const rtf = new Intl.RelativeTimeFormat(ctx.locale, { numeric: 'auto' })
    const absolute = Math.abs(days)
    if (absolute < 28) return rtf.format(days, 'day')
    if (absolute < 365) return rtf.format(Math.round(days / 30.44), 'month')
    return rtf.format(Math.round(days / 365.25), 'year')
  } catch {
    return days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`
  }
}

export function dayAndRelative(value: string | null | undefined, ctx: FormatContext): string {
  if (!value || !DATE_PATTERN.test(value)) return '—'
  return `${date(value, ctx)} · ${relativeDays(value, ctx)}`
}

export function number(value: number | null | undefined, ctx: FormatContext, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  try {
    return new Intl.NumberFormat(ctx.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
      Number(value)
    )
  } catch {
    return String(value)
  }
}

export function percentFromBp(bp: number | null | undefined, ctx: FormatContext, digits = 0): string {
  if (bp === null || bp === undefined || !Number.isFinite(Number(bp))) return '—'
  try {
    return new Intl.NumberFormat(ctx.locale, {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(bp) / 10000)
  } catch {
    return `${Math.round(Number(bp) / 100)}%`
  }
}

export function bytes(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '0 bytes'
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let size = n
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${index === 0 ? Math.round(size) : size.toFixed(size < 10 ? 1 : 0)} ${units[index]}`
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`)
}

export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`
}

/** Title-case a machine value like 'salary-sacrifice' for display. */
export function humanise(value: string | null | undefined): string {
  const text = String(value ?? '').replace(/[-_]/g, ' ').trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function initials(name: string): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase()
  const first = (parts[0] as string).charAt(0)
  const last = (parts[parts.length - 1] as string).charAt(0)
  return (first + last).toUpperCase()
}

export function truncate(text: string, max = 90): string {
  const value = String(text ?? '')
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}
