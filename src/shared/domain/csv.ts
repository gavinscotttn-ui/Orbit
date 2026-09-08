/**
 * Reading and writing CSV.
 *
 * Kept out of the main process deliberately: it is pure text handling with no
 * filesystem or Electron dependency, so it can be — and is — unit tested.
 */

/** A small, correct CSV reader: quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const source = String(text ?? '').replace(/^﻿/, '')

  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim())
  return { headers, rows: nonEmpty }
}


/**
 * Cells a spreadsheet would treat as a formula rather than as text.
 *
 * Somebody types "=cmd|' /c calc'!A1" into a note, exports to CSV, and opens it
 * in Excel — that is a real attack, and the fact that the data came from the
 * user's own vault does not help if the file is then sent to somebody else.
 * The mitigation is to prefix the cell with an apostrophe so the spreadsheet
 * reads it as text.
 *
 * A plain number is left alone, because "-12.34" is a perfectly ordinary
 * amount and mangling every negative figure in a finance export to guard
 * against a formula would be a poor trade.
 */
const FORMULA_START = /^[=+@\t\r]|^-(?![0-9])/

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const escape = (value: unknown): string => {
    const raw = value === null || value === undefined ? '' : String(value)
    const text = FORMULA_START.test(raw) ? `'${raw}` : raw
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','))
  return lines.join('\n') + '\n'
}
