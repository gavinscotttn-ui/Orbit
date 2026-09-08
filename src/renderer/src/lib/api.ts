import type { IpcChannel, IpcEvent, IpcResult } from '@shared/contracts/ipc.js'

/**
 * The interface's view of the main process.
 *
 * Every call returns a result envelope rather than throwing, so a component
 * never has to wrap a data fetch in a try/catch to avoid a white screen. When
 * something fails, there is always a sentence to show the user.
 */

export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly fields?: FieldError[]
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function bridge(): Window['orbit'] | null {
  return typeof window !== 'undefined' && window.orbit ? window.orbit : null
}

/** Call the main process. Returns the envelope; never throws. */
export async function call<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<IpcResult<T>> {
  const api = bridge()
  if (!api) {
    return { ok: false, error: 'Orbit is not running in its desktop shell.', code: 'no-bridge' }
  }
  return api.invoke<T>(channel, payload)
}

/** Call and unwrap, throwing an ApiError on failure. For use inside try/catch. */
export async function callOrThrow<T = unknown>(channel: IpcChannel, payload?: unknown): Promise<T> {
  const result = await call<T>(channel, payload)
  if (!result.ok) throw new ApiError(result.error, result.code, result.fields)
  return result.data
}

/** Call, and fall back to a default on failure. For non-critical panels. */
export async function callOr<T>(channel: IpcChannel, payload: unknown, fallback: T): Promise<T> {
  const result = await call<T>(channel, payload)
  return result.ok ? result.data : fallback
}

export function onEvent(event: IpcEvent, listener: (payload: unknown) => void): () => void {
  const api = bridge()
  if (!api) return () => undefined
  return api.on(event, listener)
}

export function pathForDroppedFile(file: File): string {
  const api = bridge()
  if (!api) return ''
  return api.pathForDroppedFile(file)
}

export function hasBridge(): boolean {
  return bridge() !== null
}
