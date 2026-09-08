import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { EntityDescriptor } from '@shared/contracts/fields.js'
import type { AppInfo } from '@shared/contracts/ipc.js'
import type { RecentVaultEntry, VaultManifest } from '@shared/vault.js'
import { call, callOr, onEvent } from '../lib/api.js'
import { DEFAULT_FORMAT, type FormatContext } from '../lib/format.js'

/**
 * The application's shared state.
 *
 * Deliberately small: which vault is open, the user's preferences, the record
 * type descriptors, and the toast queue. Everything else is fetched by the
 * screen that needs it, so no cache can go stale behind the user's back.
 */

export interface PortableSettings {
  locale: string
  currency: string
  dateFormat: 'auto' | 'dmy' | 'mdy' | 'ymd'
  weekStartsOn: 0 | 1
  timezone: string
  theme: 'system' | 'light' | 'dark'
  density: 'comfortable' | 'compact'
  modules: string[]
  dashboard: string[]
  lowClutter: boolean
  diagnosticsOptIn: boolean
  aiEnabled: boolean
  aiProvider: string
  onboardingComplete: boolean
  vaultOwnerName: string
}

export interface DevicePreferences {
  lastVaultPath: string
  recentVaults: RecentVaultEntry[]
  themeOverride: '' | 'light' | 'dark' | 'system'
  osNotificationsEnabled: boolean
  diagnosticsOptIn: boolean
  autoLockMinutes: number
  reduceMotion: boolean
  textScale: number
  completedFirstRun: boolean
}

export interface VaultStatus {
  open: boolean
  path?: string
  manifest?: VaultManifest
  folderName?: string
  recents: RecentVaultEntry[]
  portable: { path: string; exists: boolean; reason: string } | null
  distributionDirectory: string
  formatVersion: number
  schemaVersion: number
  security: { blockedRequests: number; lastBlocked: string }
}

export interface Toast {
  id: number
  tone: 'good' | 'bad' | 'info'
  title: string
  detail?: string
  /** A single action, for undo and "show me". */
  action?: { label: string; run: () => void }
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface AppState {
  ready: boolean
  info: AppInfo | null
  vault: VaultStatus | null
  settings: PortableSettings | null
  device: DevicePreferences | null
  entities: EntityDescriptor[]
  format: FormatContext
  toasts: Toast[]
  saveState: SaveState
  saveError: string

  refreshVault: () => Promise<void>
  refreshSettings: () => Promise<void>
  setSettings: (values: Partial<PortableSettings>) => Promise<void>
  setDevice: (values: Partial<DevicePreferences>) => Promise<void>
  toast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  reportSaving: () => void
  reportSaved: () => void
  reportSaveError: (message: string) => void
  /** Bumps whenever any record changes, so screens can re-fetch. */
  revision: number
  bumpRevision: () => void
}

const Context = createContext<AppState | null>(null)

export function useApp(): AppState {
  const value = useContext(Context)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [settings, setSettingsState] = useState<PortableSettings | null>(null)
  const [device, setDeviceState] = useState<DevicePreferences | null>(null)
  const [entities, setEntities] = useState<EntityDescriptor[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [revision, setRevision] = useState(0)
  const savedTimer = useRef<number | null>(null)

  const refreshVault = useCallback(async () => {
    const status = await callOr<VaultStatus>('vault.status', {}, {
      open: false,
      recents: [],
      portable: null,
      distributionDirectory: '',
      formatVersion: 0,
      schemaVersion: 0,
      security: { blockedRequests: 0, lastBlocked: '' }
    })
    setVault(status)
    if (status.open) {
      const [prefs, described] = await Promise.all([
        call<PortableSettings>('settings.get', {}),
        call<{ entities: EntityDescriptor[] }>('records.describe', {})
      ])
      if (prefs.ok) setSettingsState(prefs.data)
      if (described.ok) setEntities(described.data.entities)
    } else {
      setSettingsState(null)
      setEntities([])
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    const result = await call<PortableSettings>('settings.get', {})
    if (result.ok) setSettingsState(result.data)
  }, [])

  const toast = useCallback((next: Omit<Toast, 'id'>) => {
    const id = ++toastId
    setToasts((current) => [...current.slice(-3), { ...next, id }])
    // Errors stay until dismissed; anything else clears itself.
    if (next.tone !== 'bad') {
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
    }
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const setSettings = useCallback(
    async (values: Partial<PortableSettings>) => {
      const result = await call<PortableSettings>('settings.set', values)
      if (result.ok) setSettingsState(result.data)
      else toast({ tone: 'bad', title: 'That setting could not be saved', detail: result.error })
    },
    [toast]
  )

  const setDevice = useCallback(
    async (values: Partial<DevicePreferences>) => {
      const result = await call<DevicePreferences>('device.set', values)
      if (result.ok) setDeviceState(result.data)
      else toast({ tone: 'bad', title: 'That setting could not be saved', detail: result.error })
    },
    [toast]
  )

  const bumpRevision = useCallback(() => setRevision((n) => n + 1), [])

  const reportSaving = useCallback(() => {
    setSaveState('saving')
    setSaveError('')
  }, [])

  const reportSaved = useCallback(() => {
    setSaveState('saved')
    if (savedTimer.current) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaveState('idle'), 2400)
  }, [])

  const reportSaveError = useCallback((message: string) => {
    setSaveState('error')
    setSaveError(message)
  }, [])

  // First load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [appInfo, devicePrefs] = await Promise.all([
        call<AppInfo>('app.info', {}),
        call<DevicePreferences>('device.get', {})
      ])
      if (cancelled) return
      if (appInfo.ok) setInfo(appInfo.data)
      if (devicePrefs.ok) setDeviceState(devicePrefs.data)
      await refreshVault()
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshVault])

  // Main-process events.
  useEffect(() => {
    const offChanged = onEvent('vault.changed', () => {
      void refreshVault()
      bumpRevision()
    })
    const offClosed = onEvent('vault.closed', () => {
      void refreshVault()
    })
    const offRecords = onEvent('records.changed', () => bumpRevision())
    const offWarning = onEvent('vault.warning', (payload) => {
      const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as { message: unknown }).message) : ''
      if (message) toast({ tone: 'bad', title: 'Orbit needs your attention', detail: message })
    })
    return () => {
      offChanged()
      offClosed()
      offRecords()
      offWarning()
    }
  }, [refreshVault, bumpRevision, toast])

  /**
   * Theme, density, text size and motion are applied to the document root, so
   * a single source of truth drives every screen. The device override wins over
   * the vault's preference, because "this laptop is used in a dark room" is a
   * property of the laptop.
   */
  useEffect(() => {
    const root = document.documentElement
    const preference = device?.themeOverride || settings?.theme || 'system'
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)')

    const apply = (): void => {
      const dark = preference === 'dark' || (preference === 'system' && Boolean(systemDark?.matches))
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    systemDark?.addEventListener?.('change', apply)

    root.setAttribute('data-density', settings?.density ?? 'comfortable')
    root.setAttribute('data-clutter', settings?.lowClutter ? 'low' : 'normal')
    root.setAttribute('data-reduce-motion', device?.reduceMotion ? 'true' : 'false')
    root.style.fontSize = `${Math.round((device?.textScale ?? 1) * 100)}%`

    return () => systemDark?.removeEventListener?.('change', apply)
  }, [settings?.theme, settings?.density, settings?.lowClutter, device?.themeOverride, device?.reduceMotion, device?.textScale])

  const format = useMemo<FormatContext>(
    () =>
      settings
        ? {
            locale: settings.locale,
            currency: settings.currency,
            dateFormat: settings.dateFormat,
            weekStartsOn: settings.weekStartsOn
          }
        : DEFAULT_FORMAT,
    [settings]
  )

  const value = useMemo<AppState>(
    () => ({
      ready,
      info,
      vault,
      settings,
      device,
      entities,
      format,
      toasts,
      saveState,
      saveError,
      refreshVault,
      refreshSettings,
      setSettings,
      setDevice,
      toast,
      dismissToast,
      reportSaving,
      reportSaved,
      reportSaveError,
      revision,
      bumpRevision
    }),
    [
      ready,
      info,
      vault,
      settings,
      device,
      entities,
      format,
      toasts,
      saveState,
      saveError,
      refreshVault,
      refreshSettings,
      setSettings,
      setDevice,
      toast,
      dismissToast,
      reportSaving,
      reportSaved,
      reportSaveError,
      revision,
      bumpRevision
    ]
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** Look up a record type descriptor by its type name. */
export function useEntity(type: string): EntityDescriptor | undefined {
  const { entities } = useApp()
  return useMemo(() => entities.find((e) => e.type === type), [entities, type])
}
