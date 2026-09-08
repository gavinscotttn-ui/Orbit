import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '../../src/shared/domain/csv.js'

/**
 * The CSV reader and writer.
 *
 * Bank statements are the messiest text a person will ever hand this
 * application, and a CSV file is also the most likely thing they will send on
 * to somebody else — so both directions get tested.
 */

describe('parseCsv', () => {
  it('reads a plain file', () => {
    const { headers, rows } = parseCsv('Date,Description,Amount\n2026-01-04,Coffee,-3.20\n')
    expect(headers).toEqual(['Date', 'Description', 'Amount'])
    expect(rows).toEqual([['2026-01-04', 'Coffee', '-3.20']])
  })

  it('handles quoted fields containing commas', () => {
    const { rows } = parseCsv('a,b\n"Smith, John",2\n')
    expect(rows[0]).toEqual(['Smith, John', '2'])
  })

  it('handles doubled quotes inside a quoted field', () => {
    const { rows } = parseCsv('a\n"He said ""hello"""\n')
    expect(rows[0]).toEqual(['He said "hello"'])
  })

  it('handles a newline inside a quoted field', () => {
    const { rows } = parseCsv('a,b\n"line one\nline two",2\n')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.[0]).toBe('line one\nline two')
  })

  it('copes with CRLF line endings, as exported by Windows banking sites', () => {
    const { headers, rows } = parseCsv('Date,Amount\r\n2026-02-01,10.00\r\n')
    expect(headers).toEqual(['Date', 'Amount'])
    expect(rows).toEqual([['2026-02-01', '10.00']])
  })

  it('strips a UTF-8 byte order mark from the first header', () => {
    const { headers } = parseCsv('﻿Date,Amount\n2026-02-01,1.00\n')
    expect(headers[0]).toBe('Date')
  })

  it('drops entirely blank rows rather than importing them as empty transactions', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n,\n3,4\n')
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('returns nothing useful, rather than throwing, for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })

  it('trims header whitespace so " Amount " maps like "Amount"', () => {
    const { headers } = parseCsv(' Date , Amount \n1,2\n')
    expect(headers).toEqual(['Date', 'Amount'])
  })
})

describe('toCsv', () => {
  it('writes headers from the first row', () => {
    expect(toCsv([{ a: 1, b: 'two' }])).toBe('a,b\n1,two\n')
  })

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('quotes fields containing commas, quotes or newlines', () => {
    expect(toCsv([{ a: 'x,y' }])).toBe('a\n"x,y"\n')
    expect(toCsv([{ a: 'he said "hi"' }])).toBe('a\n"he said ""hi"""\n')
    expect(toCsv([{ a: 'one\ntwo' }])).toBe('a\n"one\ntwo"\n')
  })

  it('writes empty cells for null and undefined', () => {
    expect(toCsv([{ a: null, b: undefined }])).toBe('a,b\n,\n')
  })

  it('neutralises cells a spreadsheet would run as a formula', () => {
    expect(toCsv([{ a: '=1+1' }])).toBe("a\n'=1+1\n")
    expect(toCsv([{ a: '+44 7700 900000' }])).toBe("a\n'+44 7700 900000\n")
    expect(toCsv([{ a: '@SUM(A1)' }])).toBe("a\n'@SUM(A1)\n")
    // The classic one, which also needs quoting because it contains a comma.
    expect(toCsv([{ a: '=cmd|\' /c calc\'!A1' }])).toBe("a\n'=cmd|' /c calc'!A1\n")
  })

  it('leaves ordinary negative numbers alone, because a finance export is full of them', () => {
    expect(toCsv([{ amount: '-12.34' }])).toBe('amount\n-12.34\n')
    expect(toCsv([{ amount: -12.34 }])).toBe('amount\n-12.34\n')
  })

  it('still neutralises a leading minus that is not a number', () => {
    expect(toCsv([{ a: '-cmd|calc' }])).toBe("a\n'-cmd|calc\n")
  })

  it('survives a round trip through the reader', () => {
    const rows = [
      { name: 'Smith, John', note: 'said "hello"\nthen left', amount: '-3.20' },
      { name: 'Ólafur Þórðarson', note: '日本語', amount: '1000.00' }
    ]
    const { headers, rows: read } = parseCsv(toCsv(rows))
    expect(headers).toEqual(['name', 'note', 'amount'])
    expect(read[0]).toEqual(['Smith, John', 'said "hello"\nthen left', '-3.20'])
    expect(read[1]).toEqual(['Ólafur Þórðarson', '日本語', '1000.00'])
  })
})
