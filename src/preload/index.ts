import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEvent, type IpcResult } from '@shared/contracts/ipc.js'

/**
 * The bridge, and the only thing the interface can reach.
 *
 * The renderer has no Node, no filesystem, no network and no `require`. It has
 * exactly this object. Both the channel list and the event list are checked
 * here as well as in the main process, so a compromised renderer cannot invent
 * a channel name, and a compromised main process message cannot invent an event
 * the interface will act on.
 *
 * `webUtils.getPathForFile` is the one deliberate exception to "no filesystem":
 * it turns a File the user physically dragged into the window into a path the
 * MAIN process can read. The renderer still cannot open it — it can only hand
 * the path back across the bridge, where it is validated and read by privileged
 * code. This replaces the old `File.path` property, which Electron removed.
 */

const CHANNELS = new Set<string>(IPC_CHANNELS)
const EVENTS = new Set<string>(IPC_EVENTS)

type Listener = (payload: unknown) => void
const listeners = new Map<IpcEvent, Set<Listener>>()

ipcRenderer.on('orbit:event', (_event, name: unknown, payload: unknown) => {
  const eventName = String(name ?? '')
  if (!EVENTS.has(eventName)) return
  const set = listeners.get(eventName as IpcEvent)
  if (!set) return
  for (const listener of set) {
    try {
      listener(payload)
    } catch {
      // A misbehaving listener must not stop the others being told.
    }
  }
})

const api = {
  async invoke<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<IpcResult<T>> {
    if (!CHANNELS.has(channel)) {
      return { ok: false, error: 'That request is not something Orbit understands.', code: 'unknown-channel' }
    }
    try {
      return (await ipcRenderer.invoke('orbit:invoke', channel, payload ?? {})) as IpcResult<T>
    } catch {
      // The main process is gone or the message could not be delivered.
      return { ok: false, error: 'Orbit could not reach its own engine. Try restarting the app.', code: 'ipc-unreachable' }
    }
  },

  on(event: IpcEvent, listener: Listener): () => void {
    if (!EVENTS.has(event)) return () => undefined
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
    }
  },

  /**
   * The real path of a dropped file, for the main process to read.
   * Returns '' when the object is not a file the browser will identify.
   */
  pathForDroppedFile(file: File): string {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  channels: IPC_CHANNELS as readonly string[],
  events: IPC_EVENTS as readonly string[]
}

export type OrbitApi = typeof api

contextBridge.exposeInMainWorld('orbit', api)
