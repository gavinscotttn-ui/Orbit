import { ipcMain, type IpcMainInvokeEvent, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEvent, type IpcResult } from '@shared/contracts/ipc.js'
import { log, safeErrorMessage } from '../log.js'

/**
 * The single door between the interface and everything that can touch a user's
 * data.
 *
 * Rules enforced here, once, for every message:
 *  - The channel must be on the allow-list. An unknown channel is refused
 *    before any handler code runs.
 *  - The payload must match a schema. A handler never sees unvalidated input,
 *    so no handler needs to defend itself against a malformed message.
 *  - Nothing throws across the boundary. Every reply is a result envelope, and
 *    an unexpected failure becomes a plain sentence, never a stack trace —
 *    stack traces leak file paths, and file paths leak the user's name.
 */

export type Handler<TIn, TOut> = (input: TIn, event: IpcMainInvokeEvent) => Promise<TOut> | TOut

interface Registration {
  schema: z.ZodType<unknown>
  handler: Handler<never, unknown>
}

const registry = new Map<IpcChannel, Registration>()
const CHANNEL_SET = new Set<string>(IPC_CHANNELS)

export function handle<TSchema extends z.ZodType<unknown>, TOut>(
  channel: IpcChannel,
  schema: TSchema,
  handler: Handler<z.infer<TSchema>, TOut>
): void {
  if (!CHANNEL_SET.has(channel)) {
    throw new Error(`Refusing to register an unknown IPC channel: ${channel}`)
  }
  if (registry.has(channel)) {
    throw new Error(`IPC channel registered twice: ${channel}`)
  }
  registry.set(channel, { schema, handler: handler as Handler<never, unknown> })
}

/**
 * `errors` on a validation failure is deliberately field-shaped, so a form can
 * highlight the offending inputs rather than showing one opaque message.
 */
export function installRouter(): void {
  ipcMain.handle('orbit:invoke', async (event, rawChannel: unknown, rawPayload: unknown): Promise<IpcResult<unknown>> => {
    const channel = String(rawChannel ?? '')
    if (!CHANNEL_SET.has(channel)) {
      log.warn('ipc', `refused an unknown channel: ${channel.slice(0, 60)}`)
      return { ok: false, error: 'That request is not something Orbit understands.', code: 'unknown-channel' }
    }
    const registration = registry.get(channel as IpcChannel)
    if (!registration) {
      return { ok: false, error: 'That part of Orbit is not available.', code: 'not-registered' }
    }

    const parsed = registration.schema.safeParse(rawPayload ?? {})
    if (!parsed.success) {
      const fields = parsed.error.issues.slice(0, 12).map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
      log.warn('ipc', `rejected a malformed payload on ${channel}`)
      return { ok: false, error: 'Some of those details were not valid.', code: 'invalid-payload', fields }
    }

    const started = Date.now()
    try {
      const data = await registration.handler(parsed.data as never, event)
      const elapsed = Date.now() - started
      if (elapsed > 750) log.debug('ipc', `${channel} took ${elapsed}ms`)
      return { ok: true, data }
    } catch (err) {
      log.error('ipc', `${channel} failed`, err)
      return { ok: false, error: safeErrorMessage(err), code: 'handler-failed' }
    }
  })
}

let broadcastTargets: BrowserWindow[] = []

export function setBroadcastTargets(windows: BrowserWindow[]): void {
  broadcastTargets = windows
}

const EVENT_SET = new Set<string>(IPC_EVENTS)

/** Push an event to the interface. Only allow-listed event names are sent. */
export function broadcast(event: IpcEvent, payload: unknown): void {
  if (!EVENT_SET.has(event)) {
    log.warn('ipc', `refused to broadcast an unknown event: ${String(event).slice(0, 60)}`)
    return
  }
  for (const window of broadcastTargets) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send('orbit:event', event, payload)
    } catch (err) {
      log.warn('ipc', 'could not deliver an event to a window', err)
    }
  }
}

// -- Reusable schema fragments ----------------------------------------------

export const Empty = z.object({}).strict().or(z.undefined()).transform(() => ({}))

/** Record ids are opaque strings; bound anyway so a huge one cannot be sent. */
export const RecordId = z.string().min(1).max(120)
export const EntityType = z.string().min(1).max(60)
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-04')

/** A filesystem path chosen by the user through a native dialog. */
export const FsPath = z.string().min(1).max(4096)

export const RecordData = z.record(z.string().max(80), z.unknown())
