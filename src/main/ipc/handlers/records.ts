import { dialog, BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { z } from 'zod'
import { ENTITIES, requireEntity } from '@shared/contracts/entities/index.js'
import { safeFileName } from '@shared/domain/ids.js'
import { today } from '@shared/domain/time.js'
import { nextFromCompletion, nextOccurrence, normaliseRule } from '@shared/domain/recurrence.js'
import type { AppContext } from '../../context.js'
import { broadcast, EntityType, FsPath, Empty, handle, RecordData, RecordId } from '../router.js'
import { nearestPerThing } from '../../services/reminders.js'
import { log } from '../../log.js'

const ListQuerySchema = z.object({
  type: EntityType,
  where: z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.null()])).optional(),
  search: z.string().max(200).optional(),
  isNull: z.array(z.string().max(60)).max(10).optional(),
  notNull: z.array(z.string().max(60)).max(10).optional(),
  range: z.object({ column: z.string().max(60), from: z.string().max(40).optional(), to: z.string().max(40).optional() }).optional(),
  orderBy: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  includeArchived: z.boolean().optional()
})

export function registerRecordHandlers(ctx: AppContext): void {
  /**
   * The interface asks for the shape of a record type rather than hard-coding
   * it, so a field added to a descriptor appears in the form and the list
   * without touching the renderer.
   */
  handle('records.describe', z.object({ type: EntityType.optional() }), ({ type }) => {
    if (type) return { entities: [requireEntity(type)] }
    return { entities: ENTITIES }
  })

  handle('records.list', ListQuerySchema, ({ type, ...query }) => {
    const { repository } = ctx.require()
    return repository.list(type, query)
  })

  handle('records.get', z.object({ type: EntityType, id: RecordId }), ({ type, id }) => {
    const { repository } = ctx.require()
    const row = repository.get(type, id)
    if (!row) throw new Error('That record is not in this vault.')
    return row
  })

  handle('records.counts', z.object({ types: z.array(EntityType).max(120) }), ({ types }) => {
    const { repository } = ctx.require()
    const counts: Record<string, number> = {}
    for (const type of types) {
      try {
        counts[type] = repository.count(type)
      } catch {
        counts[type] = 0
      }
    }
    return counts
  })

  handle('records.create', z.object({ type: EntityType, data: RecordData }), ({ type, data }) => {
    const { repository, settings } = ctx.require()
    const result = repository.create(type, data, { defaultCurrency: settings.all().currency })
    if (!result.ok) return { created: false as const, errors: result.errors }
    broadcast('records.changed', { type, id: result.id, action: 'created' })
    return { created: true as const, id: result.id, row: result.row }
  })

  handle(
    'records.update',
    z.object({ type: EntityType, id: RecordId, data: RecordData }),
    ({ type, id, data }) => {
      const { repository } = ctx.require()
      const result = repository.update(type, id, data)
      if (!result.ok) return { updated: false as const, errors: result.errors }
      broadcast('records.changed', { type, id, action: 'updated' })
      return { updated: true as const, row: result.row }
    }
  )

  handle('records.delete', z.object({ type: EntityType, id: RecordId }), ({ type, id }) => {
    const { repository } = ctx.require()
    const result = repository.remove(type, id)
    if (result.ok) broadcast('records.changed', { type, id, action: 'deleted' })
    return result
  })

  handle('records.restore', z.object({ activityId: RecordId }), ({ activityId }) => {
    const { repository } = ctx.require()
    const result = repository.restore(activityId)
    if (result.ok) broadcast('records.changed', { type: result.type, id: result.id, action: 'restored' })
    return result
  })

  handle(
    'records.link',
    z.object({
      fromType: EntityType,
      fromId: RecordId,
      toType: EntityType,
      toId: RecordId,
      relation: z.string().max(60).optional(),
      note: z.string().max(300).optional()
    }),
    ({ fromType, fromId, toType, toId, relation, note }) => {
      const { repository } = ctx.require()
      repository.link(fromType, fromId, toType, toId, relation ?? 'related', note ?? '')
      broadcast('records.changed', { type: fromType, id: fromId, action: 'linked' })
      return { linked: true }
    }
  )

  handle(
    'records.unlink',
    z.object({
      fromType: EntityType,
      fromId: RecordId,
      toType: EntityType,
      toId: RecordId,
      relation: z.string().max(60).optional()
    }),
    ({ fromType, fromId, toType, toId, relation }) => {
      const { repository } = ctx.require()
      repository.unlink(fromType, fromId, toType, toId, relation ?? 'related')
      broadcast('records.changed', { type: fromType, id: fromId, action: 'unlinked' })
      return { unlinked: true }
    }
  )

  handle('records.related', z.object({ type: EntityType, id: RecordId }), ({ type, id }) => {
    const { repository } = ctx.require()
    const links = repository.linkedRecords(type, id)
    // Resolve each link to something displayable, skipping anything whose
    // target has since gone.
    const resolved = links
      .map((link) => {
        try {
          const entity = requireEntity(link.type)
          const row = repository.get<Record<string, unknown>>(link.type, link.id)
          if (!row) return null
          return {
            type: link.type,
            id: link.id,
            relation: link.relation,
            direction: link.direction,
            label: entity.label,
            title: String(row[entity.titleField] ?? '(untitled)'),
            date: entity.dateField ? String(row[entity.dateField] ?? '') : ''
          }
        } catch {
          return null
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    return { links: resolved }
  })

  /**
   * What this record wants doing about it, and when.
   *
   * The attention engine already works all of this out for Today; this asks it
   * the same question narrowed to one record. The subtlety is that a car's MOT
   * is not stored on the car — it is a maintenance schedule that points at it —
   * so the record's own links are walked one step and anything hanging off them
   * counts too. That is why opening a vehicle shows its MOT and its insurance
   * renewal rather than only the fields typed into the vehicle itself.
   */
  handle('records.attention', z.object({ type: EntityType, id: RecordId, horizonDays: z.number().int().min(1).max(730).optional() }), ({ type, id, horizonDays }) => {
    const { repository, reminders } = ctx.require()
    const own = new Set<string>([`${type}:${id}`])
    for (const link of repository.linkedRecords(type, id)) own.add(`${link.type}:${link.id}`)
    const relevant = reminders
      .attention({ horizonDays: horizonDays ?? 365 })
      .filter((item) => own.has(`${item.entityType}:${item.entityId}`))
    return { items: nearestPerThing(relevant) }
  })

  handle('records.history', z.object({ type: EntityType, id: RecordId, limit: z.number().int().min(1).max(200).optional() }), ({ type, id, limit }) => {
    const { repository } = ctx.require()
    return { entries: repository.history(type, id, limit ?? 50) }
  })

  // -- Attachments -----------------------------------------------------------

  handle('attachments.listFor', z.object({ type: EntityType, id: RecordId }), ({ type, id }) => {
    const { attachments } = ctx.require()
    return { attachments: attachments.listFor(type, id) }
  })

  handle(
    'attachments.addFiles',
    z.object({ type: EntityType, id: RecordId, role: z.string().max(40).optional() }),
    async ({ type, id, role }, event) => {
      const { attachments } = ctx.require()
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Choose files to attach',
        buttonLabel: 'Attach',
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[]
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const, added: [] }
      return addPaths(ctx, result.filePaths, type, id, role)
    }
  )

  /**
   * Files dropped onto a record. The renderer can only supply paths the user
   * physically dragged in, and each one is read by the main process — the
   * renderer never gets filesystem access of its own.
   */
  handle(
    'attachments.addFromPaths',
    z.object({ type: EntityType, id: RecordId, paths: z.array(FsPath).min(1).max(50), role: z.string().max(40).optional() }),
    ({ type, id, paths, role }) => addPaths(ctx, paths, type, id, role)
  )

  handle('attachments.read', z.object({ id: RecordId }), ({ id }) => {
    const { attachments } = ctx.require()
    const { data, record } = attachments.read(id)
    // Sent as bytes over IPC, never as a path the renderer could reach.
    return {
      record,
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      mimeType: record.mimeType
    }
  })

  handle('attachments.remove', z.object({ id: RecordId, force: z.boolean().optional() }), ({ id, force }) => {
    const { attachments } = ctx.require()
    return attachments.remove(id, force ? { force: true } : {})
  })

  handle('attachments.export', z.object({ id: RecordId }), async ({ id }, event) => {
    const { attachments } = ctx.require()
    const record = attachments.find(id)
    if (!record) throw new Error('That attachment is not in this vault.')
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Save a copy',
      defaultPath: attachments.suggestedExportName(record),
      buttonLabel: 'Save'
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { cancelled: true as const }
    attachments.exportTo(id, result.filePath)
    return { cancelled: false as const, path: result.filePath, name: basename(result.filePath) }
  })

  handle('attachments.unreferenced', Empty, () => {
    const { attachments } = ctx.require()
    const rows = attachments.findUnreferenced()
    return {
      attachments: rows,
      totalBytes: rows.reduce((sum, r) => sum + r.bytes, 0)
    }
  })

  // -- Search ---------------------------------------------------------------

  handle(
    'search.query',
    z.object({
      text: z.string().max(300),
      types: z.array(EntityType).max(60).optional(),
      modules: z.array(z.string().max(40)).max(20).optional(),
      limit: z.number().int().min(1).max(200).optional()
    }),
    ({ text, types, modules, limit }) => {
      const { search } = ctx.require()
      // Anything queued but not yet indexed is flushed first, so a record saved
      // a second ago is findable rather than mysteriously absent.
      search.processQueue(300)
      return { hits: search.search(text, { ...(types ? { types } : {}), ...(modules ? { modules } : {}), ...(limit ? { limit } : {}) }) }
    }
  )

  handle('search.rebuild', Empty, () => {
    const { search } = ctx.require()
    const result = search.rebuild((done, total) => {
      if (done % 500 === 0) broadcast('search.progress', { done, total })
    })
    broadcast('search.progress', { done: result.indexed, total: result.indexed })
    return result
  })

  handle('search.stats', Empty, () => {
    const { search } = ctx.require()
    return search.stats()
  })

  // -- Task shortcuts --------------------------------------------------------

  /**
   * Completing a task is not just a status change. A repeating task creates its
   * next occurrence, and a completion-relative one counts from today rather
   * than from when it was due.
   */
  handle('tasks.complete', z.object({ id: RecordId, done: z.boolean() }), ({ id, done }) => {
    const { repository } = ctx.require()
    const task = repository.get<Record<string, unknown>>('task', id)
    if (!task) throw new Error('That task is not in this vault.')
    const now = new Date().toISOString()
    const onDate = today()

    if (!done) {
      repository.update('task', id, { status: 'todo', completed_at: null, completed_on: null }, { summary: 'Reopened' })
      broadcast('records.changed', { type: 'task', id, action: 'updated' })
      return { updated: true, createdNext: null }
    }

    repository.update('task', id, { status: 'done' }, { summary: 'Completed' })
    ctx.require().session.db.run('UPDATE tasks SET completed_at = ?, completed_on = ? WHERE id = ?', [now, onDate, id])

    let createdNext: string | null = null
    const rule = normaliseRule(safeJson(String(task.recurrence ?? '')))
    if (rule) {
      const anchor = String(task.recurrence_anchor || task.due_date || onDate)
      const nextDate = rule.fromCompletion
        ? nextFromCompletion(onDate, rule)
        : nextOccurrence(anchor, rule, String(task.due_date || onDate))
      if (nextDate) {
        const copy: Record<string, unknown> = { ...task }
        delete copy.id
        copy.status = 'todo'
        copy.completed_at = null
        copy.completed_on = null
        copy.due_date = nextDate
        copy.recurrence_anchor = rule.fromCompletion ? nextDate : anchor
        copy.series_id = String(task.series_id || id)
        const result = repository.create('task', copy, { summary: 'Next in the series' })
        if (result.ok) createdNext = result.id
      }
    }
    broadcast('records.changed', { type: 'task', id, action: 'updated' })
    return { updated: true, createdNext }
  })

  handle(
    'tasks.reschedule',
    z.object({ ids: z.array(RecordId).min(1).max(500), days: z.number().int().min(-3650).max(3650) }),
    ({ ids, days }) => {
      const { repository, session } = ctx.require()
      let moved = 0
      session.db.transaction(() => {
        for (const id of ids) {
          const task = repository.get<{ due_date: string | null }>('task', id)
          if (!task?.due_date) continue
          const shifted = shiftDate(task.due_date, days)
          const result = repository.update('task', id, { due_date: shifted }, { summary: `Rescheduled by ${days} days` })
          if (result.ok) moved += 1
        }
      })
      broadcast('records.changed', { type: 'task', id: '', action: 'updated' })
      return { moved }
    }
  )
}

function addPaths(
  ctx: AppContext,
  paths: string[],
  type: string,
  id: string,
  role?: string
): { cancelled: false; added: unknown[]; duplicates: number; failed: { name: string; reason: string }[] } {
  const { attachments } = ctx.require()
  const added: unknown[] = []
  const failed: { name: string; reason: string }[] = []
  let duplicates = 0
  for (const path of paths) {
    try {
      const result = attachments.addFile(path, { link: { entityType: type, entityId: id, ...(role ? { role } : {}) } })
      if (result.deduplicated) duplicates += 1
      added.push(result.attachment)
    } catch (err) {
      failed.push({
        name: safeFileName(basename(path)),
        reason: err instanceof Error ? err.message : 'That file could not be attached.'
      })
      log.warn('attachments', 'a file could not be attached')
    }
  }
  broadcast('records.changed', { type, id, action: 'updated' })
  return { cancelled: false, added, duplicates, failed }
}

function safeJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function shiftDate(date: string, days: number): string {
  const base = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10))
  )
  const shifted = new Date(base + days * 86400000)
  return shifted.toISOString().slice(0, 10)
}
