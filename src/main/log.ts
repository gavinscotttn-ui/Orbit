/**
 * Logging that is safe to leave switched on.
 *
 * Orbit's log holds only what is needed to diagnose a fault: what happened,
 * where, and how long it took. It must never contain the contents of a record,
 * an amount of money, a person's name, a file's contents, or a path inside the
 * user's vault. Log lines are written to the app's per-machine folder — never
 * into the vault — so a vault copied to a colleague's machine carries no trace
 * of the previous computer.
 *
 * Values passed to the logger are redacted defensively rather than trusted,
 * because the alternative is one careless call site leaking a bank balance into
 * a text file the user later emails to support.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let minimumLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
let sink: ((line: string) => void) | null = null

/** Patterns that must never reach a log line, whatever a call site passes. */
const REDACTIONS: { re: RegExp; with: string }[] = [
  { re: /(?:password|passphrase|secret|token|apikey|api[_-]?key|recovery)\s*[=:]\s*\S+/gi, with: '[redacted]' },
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, with: '[email]' },
  { re: /\b(?:\d[ -]?){13,19}\b/g, with: '[card]' },
  // Long digit runs are account numbers, sort codes, NI numbers and the like.
  // Short ones (row counts, durations, versions) are left alone deliberately.
  { re: /\b\d{8,}\b/g, with: '[number]' }
]

function redact(value: unknown): string {
  let text: string
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}`
  } else if (typeof value === 'string') {
    text = value
  } else if (value === null || value === undefined) {
    return String(value)
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length > 800) text = text.slice(0, 800) + '…'
  for (const rule of REDACTIONS) text = text.replace(rule.re, rule.with)
  return text
}

function emit(level: LogLevel, scope: string, message: string, extra: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`, redact(message)]
  for (const item of extra) parts.push(redact(item))
  const line = parts.join(' ')
  if (sink) {
    try {
      sink(line)
    } catch {
      /* a failing log sink must never take the app down */
    }
  }
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  target(line)
}

export const log = {
  setLevel(level: LogLevel): void {
    minimumLevel = level
  },
  setSink(fn: ((line: string) => void) | null): void {
    sink = fn
  },
  debug: (scope: string, message: string, ...extra: unknown[]): void => emit('debug', scope, message, extra),
  info: (scope: string, message: string, ...extra: unknown[]): void => emit('info', scope, message, extra),
  warn: (scope: string, message: string, ...extra: unknown[]): void => emit('warn', scope, message, extra),
  error: (scope: string, message: string, ...extra: unknown[]): void => emit('error', scope, message, extra)
}

/** Errors crossing IPC are stripped to a message and a code — never a stack. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 400 ? err.message.slice(0, 400) + '…' : err.message
  }
  return 'An unexpected error occurred.'
}
