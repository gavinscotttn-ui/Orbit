import { dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireEntity } from '@shared/contracts/entities/index.js'
import { parseAmount } from '@shared/domain/money.js'
import { addDays, isCalendarDate, today as todayDate } from '@shared/domain/time.js'
import { newId, safeFileName } from '@shared/domain/ids.js'
import type { AppContext } from '../../context.js'
import { broadcast, CalendarDateSchema, Empty, EntityType, FsPath, handle, RecordId } from '../router.js'
import { LIFE_EVENT_TEMPLATES, applyLifeEventTemplate, previewLifeEventTemplate } from '../../services/life-events.js'
import { seedDemoVault } from '../../services/demo.js'
import { log } from '../../log.js'

/**
 * Capture, import, export and the life-event templates.
 *
 * The rule that runs through all of it: extraction proposes, the user decides.
 * Nothing dropped on Orbit becomes a record until somebody has looked at what
 * Orbit thinks it is.
 */
export function registerExtraHandlers(ctx: AppContext): void {
  // -- Inbox ----------------------------------------------------------------

  handle('inbox.list', z.object({ status: z.enum(['new', 'triaged', 'converted', 'archived']).optional() }), ({ status }) => {
    const { session } = ctx.require()
    const rows = session.db.all<Record<string, unknown>>(
      'SELECT * FROM inbox_items WHERE status = ? ORDER BY captured_at DESC LIMIT 300',
      [status ?? 'new']
    )
    return {
      items: rows.map((row) => ({
        ...row,
        suggestions: safeJsonArray(String(row.suggestions ?? '[]'))
      }))
    }
  })

  handle(
    'inbox.capture',
    z.object({
      kind: z.enum(['text', 'file', 'receipt', 'document', 'image', 'link', 'voice', 'email']).optional(),
      title: z.string().max(300).optional(),
      body: z.string().max(20_000).optional(),
      paths: z.array(FsPath).max(30).optional(),
      source: z.enum(['quick-capture', 'drag-drop', 'import', 'automation', 'file-menu']).optional()
    }),
    ({ kind, title, body, paths, source }) => {
      const { session, attachments } = ctx.require()
      const now = new Date().toISOString()
      const created: string[] = []

      const insert = (item: {
        kind: string
        title: string
        body: string
        attachmentId: string | null
        suggestions: unknown[]
      }): string => {
        const id = newId('inb')
        session.db.run(
          `INSERT INTO inbox_items (id, kind, title, body, attachment_id, captured_at, source, status, converted_type, converted_id, suggestions, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', '', '', ?, ?, ?)`,
          [
            id,
            item.kind,
            item.title.slice(0, 300),
            item.body.slice(0, 20_000),
            item.attachmentId,
            now,
            source ?? 'quick-capture',
            JSON.stringify(item.suggestions),
            now,
            now
          ]
        )
        created.push(id)
        return id
      }

      if (paths?.length) {
        for (const path of paths) {
          try {
            const result = attachments.addFile(path)
            const id = insert({
              kind: guessKind(result.attachment.extension),
              title: result.attachment.originalFilename,
              body: '',
              attachmentId: result.attachment.id,
              suggestions: suggestFromFilename(result.attachment.originalFilename)
            })
            attachments.link(result.attachment.id, { entityType: 'inbox_item', entityId: id })
          } catch (err) {
            log.warn('inbox', 'a captured file could not be stored', err)
          }
        }
      }
      if (title || body) {
        insert({
          kind: kind ?? 'text',
          title: title ?? firstLine(body ?? ''),
          body: body ?? '',
          attachmentId: null,
          suggestions: suggestFromText(`${title ?? ''}\n${body ?? ''}`)
        })
      }
      broadcast('records.changed', { type: 'inbox_item', id: '', action: 'created' })
      return { captured: created.length, ids: created }
    }
  )

  /**
   * Turn an inbox item into a real record. The proposed values are shown to the
   * user first and arrive here already reviewed — this handler does not re-run
   * any extraction, it simply writes what was confirmed.
   */
  handle(
    'inbox.convert',
    z.object({ id: RecordId, type: EntityType, data: z.record(z.string().max(80), z.unknown()) }),
    ({ id, type, data }) => {
      const { session, repository, attachments } = ctx.require()
      const item = session.db.get<Record<string, unknown>>('SELECT * FROM inbox_items WHERE id = ?', [id])
      if (!item) throw new Error('That inbox item is no longer there.')

      const created = repository.create(type, data, { summary: 'Created from the inbox' })
      if (!created.ok) return { converted: false as const, errors: created.errors }

      if (item.attachment_id) {
        attachments.link(String(item.attachment_id), { entityType: type, entityId: created.id })
      }
      session.db.run(
        "UPDATE inbox_items SET status = 'converted', converted_type = ?, converted_id = ?, updated_at = ? WHERE id = ?",
        [type, created.id, new Date().toISOString(), id]
      )
      broadcast('records.changed', { type, id: created.id, action: 'created' })
      return { converted: true as const, id: created.id, type }
    }
  )

  handle('inbox.archive', z.object({ id: RecordId }), ({ id }) => {
    const { session } = ctx.require()
    session.db.run("UPDATE inbox_items SET status = 'archived', updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      id
    ])
    broadcast('records.changed', { type: 'inbox_item', id, action: 'updated' })
    return { archived: true }
  })

  // -- CSV import ------------------------------------------------------------

  /**
   * Preview a bank statement before anything is written.
   *
   * Duplicate detection uses a hash of account, date, amount and description,
   * which is the same key the unique index uses. A row already present is shown
   * as a duplicate rather than silently skipped, because "why are 40 of my 200
   * transactions missing?" is a worse experience than being told.
   */
  handle(
    'import.previewCsv',
    z.object({ accountId: RecordId, path: FsPath.optional(), text: z.string().max(5_000_000).optional() }),
    async ({ accountId, path, text }, event) => {
      const { session, repository } = ctx.require()
      const account = repository.get<Record<string, unknown>>('account', accountId)
      if (!account) throw new Error('Choose an account to import into first.')

      let contents = text ?? ''
      let filename = 'pasted text'
      if (!contents) {
        let chosen = path
        if (!chosen) {
          const window = BrowserWindow.fromWebContents(event.sender)
          const options = {
            title: 'Choose a statement to import',
            filters: [{ name: 'Statements', extensions: ['csv', 'txt'] }],
            properties: ['openFile'] as ('openFile')[]
          }
          const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
          if (result.canceled || !result.filePaths[0]) return { cancelled: true as const }
          chosen = result.filePaths[0]
        }
        contents = readFileSync(chosen, 'utf8')
        filename = safeFileName(chosen.split(/[\\/]/).pop() ?? 'statement.csv')
      }

      const parsed = parseCsv(contents)
      if (parsed.rows.length === 0) {
        return { cancelled: false as const, filename, headers: parsed.headers, rows: [], mapping: {}, duplicates: 0, problems: ['That file had no rows Orbit could read.'] }
      }
      const mapping = guessMapping(parsed.headers)
      const currency = String(account.currency ?? 'GBP')

      const rows = parsed.rows.slice(0, 2000).map((cells, index) => {
        const get = (key: string): string => {
          const column = mapping[key]
          if (column === undefined) return ''
          return cells[column] ?? ''
        }
        const rawDate = get('date')
        const date = normaliseDate(rawDate)
        const description = get('description').slice(0, 300)
        const amountText = get('amount')
        const debit = get('debit')
        const credit = get('credit')

        let amountMinor: number | null = null
        let problem = ''
        if (amountText) {
          const result = parseAmount(amountText, currency)
          if (result.ok) amountMinor = result.value
          else problem = result.error
        } else if (debit || credit) {
          const debitResult = debit ? parseAmount(debit, currency) : null
          const creditResult = credit ? parseAmount(credit, currency) : null
          if (debitResult?.ok && debitResult.value !== 0) amountMinor = -Math.abs(debitResult.value)
          else if (creditResult?.ok && creditResult.value !== 0) amountMinor = Math.abs(creditResult.value)
          else problem = 'No amount could be read from this row.'
        } else {
          problem = 'No amount column was found.'
        }
        if (!date) problem = problem || `"${rawDate}" is not a date Orbit recognises.`

        const importHash =
          date && amountMinor !== null
            ? createHash('sha256').update(`${accountId}|${date}|${amountMinor}|${description.toLowerCase()}`).digest('hex').slice(0, 32)
            : ''
        const duplicate = importHash
          ? Boolean(
              session.db.get('SELECT id FROM transactions WHERE account_id = ? AND import_hash = ?', [accountId, importHash])
            )
          : false

        return {
          index,
          date: date ?? '',
          description,
          amountMinor,
          currency,
          kind: amountMinor !== null && amountMinor > 0 ? 'income' : 'expense',
          importHash,
          duplicate,
          problem,
          raw: cells.slice(0, 20)
        }
      })

      return {
        cancelled: false as const,
        filename,
        headers: parsed.headers,
        mapping,
        rows,
        duplicates: rows.filter((r) => r.duplicate).length,
        problems: rows.filter((r) => r.problem).length ? ['Some rows could not be read and will be skipped.'] : []
      }
    }
  )

  handle(
    'import.commitCsv',
    z.object({
      accountId: RecordId,
      rows: z
        .array(
          z.object({
            date: CalendarDateSchema,
            description: z.string().max(300),
            amountMinor: z.number().int(),
            kind: z.enum(['income', 'expense', 'transfer']),
            categoryId: RecordId.optional(),
            importHash: z.string().max(64)
          })
        )
        .min(1)
        .max(5000)
    }),
    ({ accountId, rows }) => {
      const { session, repository } = ctx.require()
      const account = repository.get<Record<string, unknown>>('account', accountId)
      if (!account) throw new Error('That account is not in this vault.')
      const currency = String(account.currency ?? 'GBP')
      const batchId = newId('imp')
      let imported = 0
      let skipped = 0

      session.db.transaction(() => {
        for (const row of rows) {
          const existing = row.importHash
            ? session.db.get('SELECT id FROM transactions WHERE account_id = ? AND import_hash = ?', [accountId, row.importHash])
            : null
          if (existing) {
            skipped += 1
            continue
          }
          const result = repository.create(
            'transaction',
            {
              account_id: accountId,
              date: row.date,
              description: row.description,
              amount_minor: row.kind === 'expense' ? -Math.abs(row.amountMinor) : Math.abs(row.amountMinor),
              currency,
              kind: row.kind,
              status: 'actual',
              category_id: row.categoryId ?? null,
              import_hash: row.importHash,
              import_batch_id: batchId
            },
            { silent: true, source: 'import' }
          )
          if (result.ok) imported += 1
          else skipped += 1
        }
      })
      broadcast('records.changed', { type: 'transaction', id: '', action: 'imported' })
      return { imported, skipped, batchId }
    }
  )

  // -- Export ----------------------------------------------------------------

  /**
   * Export to CSV or JSON. No lock-in: everything a person has typed in can be
   * taken out in a format any other tool can read.
   */
  handle(
    'export.records',
    z.object({ type: EntityType, format: z.enum(['csv', 'json']) }),
    async ({ type, format }, event) => {
      const { repository } = ctx.require()
      const entity = requireEntity(type)
      const { rows } = repository.list<Record<string, unknown>>(type, { limit: 2000, includeArchived: true })

      const window = BrowserWindow.fromWebContents(event.sender)
      const defaultPath = safeFileName(`orbit-${entity.plural.toLowerCase()}-${todayDate()}.${format}`)
      const options = { title: 'Export', defaultPath, buttonLabel: 'Export' }
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { cancelled: true as const }

      if (format === 'json') {
        writeFileSync(result.filePath, JSON.stringify({ type, exportedAt: new Date().toISOString(), rows }, null, 2), 'utf8')
      } else {
        writeFileSync(result.filePath, toCsv(rows), 'utf8')
      }
      return { cancelled: false as const, path: result.filePath, count: rows.length }
    }
  )

  // -- Life events -----------------------------------------------------------

  handle('lifeEvents.templates', Empty, () => ({ templates: LIFE_EVENT_TEMPLATES }))

  handle(
    'lifeEvents.preview',
    z.object({ key: z.string().max(60), startDate: CalendarDateSchema.optional(), title: z.string().max(160).optional() }),
    ({ key, startDate, title }) => previewLifeEventTemplate(key, startDate ?? todayDate(), title)
  )

  handle(
    'lifeEvents.apply',
    z.object({
      key: z.string().max(60),
      startDate: CalendarDateSchema.optional(),
      title: z.string().max(160).optional(),
      include: z.array(z.string().max(120)).max(400).optional()
    }),
    ({ key, startDate, title, include }) => {
      const { repository, session } = ctx.require()
      const result = applyLifeEventTemplate(repository, session.db, key, startDate ?? todayDate(), title, include)
      broadcast('records.changed', { type: 'project', id: result.projectId, action: 'created' })
      return result
    }
  )

  // -- Demonstration data ----------------------------------------------------

  handle('demo.seed', Empty, () => {
    const { session, repository, settings, attachments, search } = ctx.require()
    if (!session.manifest.isDemo) {
      // The one thing that must never happen: demonstration records appearing
      // in somebody's real vault.
      throw new Error('Demonstration data can only be added to a demonstration vault.')
    }
    const result = seedDemoVault(repository, settings, attachments, session.db)
    search.rebuild()
    broadcast('records.changed', { type: '', id: '', action: 'imported' })
    return result
  })
}

// ---------------------------------------------------------------------------

function firstLine(text: string): string {
  return String(text ?? '').split('\n')[0]?.slice(0, 120) ?? ''
}

function guessKind(extension: string): string {
  if (['png', 'jpg', 'jpeg', 'heic', 'webp', 'gif'].includes(extension)) return 'image'
  if (extension === 'pdf') return 'document'
  if (['mp3', 'm4a', 'wav'].includes(extension)) return 'voice'
  return 'file'
}

interface Suggestion {
  field: string
  label: string
  value: string
  confidence: 'high' | 'medium' | 'low'
  /** Where the suggestion came from, so the user can judge it. */
  because: string
}

/**
 * Suggestions from a filename or some text.
 *
 * Deliberately simple and local: dates, amounts and a few obvious keywords. No
 * model, no network, no pretending to understand a receipt. Everything found is
 * shown as a proposal with its reason, and nothing is applied automatically.
 */
export function suggestFromText(text: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const source = String(text ?? '').slice(0, 4000)

  const isoDate = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(source)
  const ukDate = /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/.exec(source)
  if (isoDate) {
    const value = `${isoDate[1]}-${String(isoDate[2]).padStart(2, '0')}-${String(isoDate[3]).padStart(2, '0')}`
    if (isCalendarDate(value)) {
      suggestions.push({ field: 'date', label: 'Date', value, confidence: 'high', because: `found "${isoDate[0]}"` })
    }
  } else if (ukDate) {
    const value = `${ukDate[3]}-${String(ukDate[2]).padStart(2, '0')}-${String(ukDate[1]).padStart(2, '0')}`
    if (isCalendarDate(value)) {
      suggestions.push({ field: 'date', label: 'Date', value, confidence: 'medium', because: `found "${ukDate[0]}" — read as day/month/year` })
    }
  }

  const amount = /(?:£|\$|€)\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/.exec(source)
  if (amount?.[1]) {
    const parsed = parseAmount(amount[1])
    if (parsed.ok) {
      suggestions.push({
        field: 'amount_minor',
        label: 'Amount',
        value: String(parsed.value),
        confidence: 'medium',
        because: `found "${amount[0].trim()}"`
      })
    }
  }

  const lowered = source.toLowerCase()
  const typeHints: [RegExp, string, string][] = [
    [/\b(receipt|invoice|order confirmation)\b/, 'purchase', 'it mentions a receipt or invoice'],
    [/\b(policy|insurance|cover note)\b/, 'policy', 'it mentions insurance'],
    [/\b(mot|service|garage)\b/, 'maintenance_record', 'it mentions servicing'],
    [/\b(return|refund|rma)\b/, 'return', 'it mentions a return or refund'],
    [/\b(prescription|appointment|surgery)\b/, 'health_record', 'it mentions a health appointment'],
    [/\b(booking|itinerary|flight|hotel)\b/, 'trip_booking', 'it mentions a booking']
  ]
  for (const [pattern, type, because] of typeHints) {
    if (pattern.test(lowered)) {
      suggestions.push({ field: '__type', label: 'Looks like', value: type, confidence: 'low', because })
      break
    }
  }
  return suggestions
}

function suggestFromFilename(filename: string): Suggestion[] {
  return suggestFromText(filename.replace(/[_-]/g, ' '))
}

// -- CSV -------------------------------------------------------------------

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

function guessMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  const find = (patterns: RegExp[]): number | undefined => {
    for (const pattern of patterns) {
      const index = headers.findIndex((h) => pattern.test(h.toLowerCase().trim()))
      if (index >= 0) return index
    }
    return undefined
  }
  const date = find([/^date$/, /transaction date/, /^posted/, /value date/, /^date /])
  const description = find([/description/, /details/, /narrative/, /reference/, /^memo/, /payee/])
  const amount = find([/^amount$/, /^value$/, /^amount \(/])
  const debit = find([/debit/, /money out/, /paid out/, /withdraw/])
  const credit = find([/credit/, /money in/, /paid in/, /deposit/])

  if (date !== undefined) mapping.date = date
  if (description !== undefined) mapping.description = description
  if (amount !== undefined) mapping.amount = amount
  if (debit !== undefined) mapping.debit = debit
  if (credit !== undefined) mapping.credit = credit
  return mapping
}

/** Accept the date formats real statements actually use. */
export function normaliseDate(input: string): string | null {
  const text = String(input ?? '').trim()
  if (!text) return null
  if (isCalendarDate(text)) return text

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text)
  if (iso) {
    const value = `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
    return isCalendarDate(value) ? value : null
  }
  // Day-first, which is what UK banks export. Ambiguous with US month-first,
  // so anything above 12 in the first position confirms day-first; otherwise
  // day-first is assumed and the import preview shows the interpretation.
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(text)
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    const value = `${year}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`
    return isCalendarDate(value) ? value : null
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const named = /^(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{2,4})/i.exec(text)
  if (named) {
    const monthIndex = months.indexOf(String(named[2]).toLowerCase())
    if (monthIndex >= 0) {
      const year = Number(named[3]) < 100 ? 2000 + Number(named[3]) : Number(named[3])
      const value = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(named[1]).padStart(2, '0')}`
      return isCalendarDate(value) ? value : null
    }
  }
  return null
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','))
  return lines.join('\n') + '\n'
}

function safeJsonArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export { addDays }
