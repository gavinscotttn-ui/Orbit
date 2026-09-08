import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecentVaultEntry } from '@shared/vault.js'
import { looksLikeVault } from './vault/paths.js'
import { log } from './log.js'

/**
 * Settings that belong to THIS COMPUTER and must not travel with a vault.
 *
 * The split matters. Window size, which vault was open last, and whether this
 * machine is allowed to show desktop notifications are properties of the
 * machine. Currency, date format, week start and which Life modules are enabled
 * are properties of the person, and those live inside the vault so they follow
 * them to a new computer.
 *
 * Nothing here is a record. Deleting this file loses a window position and a
 * recent-vaults list; it loses no user data whatsoever.
 */
export interface DevicePreferences {
  lastVaultPath: string
  recentVaults: RecentVaultEntry[]
  windowBounds: { width: number; height: number; x?: number; y?: number } | null
  windowMaximised: boolean
  /** Overrides the vault's theme on this machine only. '' means "follow vault". */
  themeOverride: '' | 'light' | 'dark' | 'system'
  /** OS notification permission is per-machine and must be granted again after a move. */
  osNotificationsEnabled: boolean
  /** Opt-in, default off, and there is nothing to send even when on. */
  diagnosticsOptIn: boolean
  /** Minutes of inactivity before the vault auto-locks. 0 disables. */
  autoLockMinutes: number
  reduceMotion: boolean
  textScale: number
  completedFirstRun: boolean
}

const DEFAULTS: DevicePreferences = {
  lastVaultPath: '',
  recentVaults: [],
  windowBounds: null,
  windowMaximised: false,
  themeOverride: '',
  osNotificationsEnabled: false,
  diagnosticsOptIn: false,
  autoLockMinutes: 0,
  reduceMotion: false,
  textScale: 1,
  completedFirstRun: false
}

const MAX_RECENTS = 12

export class DeviceStore {
  private data: DevicePreferences = { ...DEFAULTS }
  private readonly file: string

  constructor(directory: string) {
    this.file = join(directory, 'device-preferences.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DevicePreferences>
      this.data = {
        ...DEFAULTS,
        ...parsed,
        recentVaults: Array.isArray(parsed.recentVaults)
          ? parsed.recentVaults
              .filter((r) => r && typeof r.path === 'string' && r.path)
              .slice(0, MAX_RECENTS)
              .map((r) => ({
                path: String(r.path),
                vaultId: String(r.vaultId ?? ''),
                name: String(r.name ?? 'Orbit Vault'),
                lastOpenedAt: String(r.lastOpenedAt ?? ''),
                isDemo: Boolean(r.isDemo),
                available: false
              }))
          : []
      }
    } catch (err) {
      // A corrupt preferences file must never stop Orbit starting.
      log.warn('device', 'device preferences unreadable; starting from defaults', err)
      this.data = { ...DEFAULTS }
    }
  }

  /** Atomic write: temp file then rename, so a crash cannot truncate settings. */
  private persist(): void {
    try {
      const dir = dirname(this.file)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const temp = `${this.file}.tmp`
      writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(temp, this.file)
    } catch (err) {
      log.warn('device', 'could not save device preferences', err)
    }
  }

  get all(): DevicePreferences {
    return { ...this.data, recentVaults: this.recentVaults() }
  }

  get<K extends keyof DevicePreferences>(key: K): DevicePreferences[K] {
    return this.data[key]
  }

  set<K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]): void {
    this.data[key] = value
    this.persist()
  }

  patch(values: Partial<DevicePreferences>): DevicePreferences {
    this.data = { ...this.data, ...values }
    this.persist()
    return this.all
  }

  /** Recent vaults, each re-checked for existence so the UI can offer "Locate…". */
  recentVaults(): RecentVaultEntry[] {
    return this.data.recentVaults.map((entry) => ({
      ...entry,
      available: looksLikeVault(entry.path)
    }))
  }

  rememberVault(entry: Omit<RecentVaultEntry, 'available'>): void {
    const others = this.data.recentVaults.filter(
      (r) => r.path !== entry.path && (!entry.vaultId || r.vaultId !== entry.vaultId)
    )
    this.data.recentVaults = [{ ...entry, available: true }, ...others].slice(0, MAX_RECENTS)
    this.data.lastVaultPath = entry.path
    this.persist()
  }

  forgetVault(path: string): void {
    this.data.recentVaults = this.data.recentVaults.filter((r) => r.path !== path)
    if (this.data.lastVaultPath === path) this.data.lastVaultPath = ''
    this.persist()
  }

  /** Update a remembered vault's path after the user locates a moved folder. */
  relocateVault(vaultId: string, newPath: string, name: string): void {
    const others = this.data.recentVaults.filter((r) => r.vaultId !== vaultId && r.path !== newPath)
    this.data.recentVaults = [
      { path: newPath, vaultId, name, lastOpenedAt: new Date().toISOString(), isDemo: false, available: true },
      ...others
    ].slice(0, MAX_RECENTS)
    this.persist()
  }
}
