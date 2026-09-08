import { existsSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { newId } from '@shared/domain/ids.js'
import { log } from '../log.js'

/**
 * Guarding a vault against two Orbits writing to it at once.
 *
 * This is not academic. The realistic case is a vault on a USB stick, a
 * Dropbox folder or a network share that someone opens on a laptop while it is
 * still open on a desktop. SQLite's own locking protects a single filesystem
 * with working advisory locks; it does NOT protect a vault reached over SMB,
 * and it does not protect against a cloud-sync client copying a half-written
 * database underneath you.
 *
 * So Orbit keeps its own lock file with a heartbeat:
 *  - Same lock object -> reentrant, no problem.
 *  - Same machine, dead process -> stale, reclaimed automatically.
 *  - Live heartbeat  -> refused, and the user is told where it is open.
 *  - Stale heartbeat -> refused, but the user may deliberately take over.
 */

const HEARTBEAT_INTERVAL_MS = 30_000
const STALE_AFTER_MS = 5 * 60_000

export interface LockInfo {
  instanceId: string
  pid: number
  /** Best-effort human label so the user can tell which computer holds it. */
  deviceLabel: string
  appVersion: string
  acquiredAt: string
  heartbeatAt: string
}

export type LockResult =
  | { ok: true; reclaimed: boolean }
  | { ok: false; held: LockInfo; stale: boolean; message: string }

function readLock(file: string): LockInfo | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockInfo>
    if (!raw || typeof raw.instanceId !== 'string') return null
    return {
      instanceId: raw.instanceId,
      pid: Number(raw.pid) || 0,
      deviceLabel: typeof raw.deviceLabel === 'string' ? raw.deviceLabel : 'another computer',
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'unknown',
      acquiredAt: typeof raw.acquiredAt === 'string' ? raw.acquiredAt : '',
      heartbeatAt: typeof raw.heartbeatAt === 'string' ? raw.heartbeatAt : ''
    }
  } catch {
    return null
  }
}

function processAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function heartbeatAgeMs(info: LockInfo, file: string): number {
  const stamp = Date.parse(info.heartbeatAt)
  if (Number.isFinite(stamp)) return Date.now() - stamp
  try {
    return Date.now() - statSync(file).mtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export class VaultLock {
  private timer: NodeJS.Timeout | null = null
  private readonly instanceId = newId('inst')
  private held = false

  constructor(
    private readonly file: string,
    private readonly appVersion: string
  ) {}

  get isHeld(): boolean {
    return this.held
  }

  private write(info: LockInfo): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(info, null, 2), 'utf8')
  }

  acquire(options: { takeOver?: boolean } = {}): LockResult {
    const existing = existsSync(this.file) ? readLock(this.file) : null
    if (existing) {
      const sameDevice = existing.deviceLabel === deviceLabel()
      const age = heartbeatAgeMs(existing, this.file)
      const stale = age > STALE_AFTER_MS

      // Reentrant only for THIS lock object. The same operating-system process
      // holding the vault through a different VaultLock is a genuine
      // double-open, not a re-entry, and is refused like any other.
      if (existing.instanceId === this.instanceId) {
        this.held = true
        this.startHeartbeat()
        return { ok: true, reclaimed: false }
      }
      const deadOnThisMachine = sameDevice && !processAlive(existing.pid)
      if (!deadOnThisMachine && !stale && !options.takeOver) {
        return {
          ok: false,
          held: existing,
          stale: false,
          message: sameDevice
            ? 'This vault is already open in another Orbit window on this computer.'
            : `This vault appears to be open on ${existing.deviceLabel}. Opening it in two places at once can corrupt it.`
        }
      }
      if (!deadOnThisMachine && stale && !options.takeOver) {
        return {
          ok: false,
          held: existing,
          stale: true,
          message: `This vault was left open by ${existing.deviceLabel}, which has not responded for ${Math.round(age / 60000)} minutes. It may have crashed, or it may still be running.`
        }
      }
      log.info('vault', deadOnThisMachine ? 'reclaiming stale lock from a dead process' : 'taking over a lock at the user request')
    }

    const info: LockInfo = {
      instanceId: this.instanceId,
      pid: process.pid,
      deviceLabel: deviceLabel(),
      appVersion: this.appVersion,
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString()
    }
    this.write(info)
    this.held = true
    this.startHeartbeat()
    return { ok: true, reclaimed: Boolean(existing) }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.timer = setInterval(() => {
      if (!this.held) return
      try {
        const current = readLock(this.file)
        if (!current || current.instanceId !== this.instanceId) {
          // Somebody took the lock from under us. Stop claiming we hold it.
          log.warn('vault', 'lock was taken over by another instance')
          this.held = false
          this.stopHeartbeat()
          return
        }
        current.heartbeatAt = new Date().toISOString()
        this.write(current)
        const now = new Date()
        utimesSync(this.file, now, now)
      } catch (err) {
        log.warn('vault', 'lock heartbeat failed', err)
      }
    }, HEARTBEAT_INTERVAL_MS)
    this.timer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  release(): void {
    this.stopHeartbeat()
    if (!this.held) return
    this.held = false
    try {
      const current = readLock(this.file)
      // Only remove a lock we still own — never another instance's.
      if (!current || current.instanceId === this.instanceId) {
        if (existsSync(this.file)) unlinkSync(this.file)
      }
    } catch (err) {
      log.warn('vault', 'could not remove lock file', err)
    }
  }
}

/**
 * A short, human-meaningful machine label. Used only inside the transient lock
 * file, which is deleted on a clean close, so it never travels with the data.
 */
export function deviceLabel(): string {
  try {
    const name = hostname()
    return name ? name.split('.')[0] || 'this computer' : 'this computer'
  } catch {
    return 'this computer'
  }
}
