import type { OrbitDatabase } from '../db/database.js'
import { log } from '../log.js'

/**
 * Preferences that belong to the PERSON and therefore live inside the vault,
 * so they follow them to a new computer.
 *
 * The counterpart is DeviceStore, which holds preferences belonging to the
 * MACHINE (window size, notification permission, which vault was open last).
 * Getting this split wrong is how a product ends up losing someone's currency
 * setting the moment they move to a new laptop.
 */

export interface PortableSettings {
  locale: string
  currency: string
  dateFormat: 'auto' | 'dmy' | 'mdy' | 'ymd'
  weekStartsOn: 0 | 1
  timezone: string
  theme: 'system' | 'light' | 'dark'
  density: 'comfortable' | 'compact'
  /** Which Life areas the user has switched on. Everything else stays hidden. */
  modules: string[]
  /** Dashboard widgets, in order. */
  dashboard: string[]
  lowClutter: boolean
  /** Never enabled by default, and there is nothing to send even when it is. */
  diagnosticsOptIn: boolean
  /** Optional AI adapters. Off, with no key, unless the user configures one. */
  aiEnabled: boolean
  aiProvider: string
  onboardingComplete: boolean
  vaultOwnerName: string
}

export const ALL_MODULES = [
  { key: 'home', label: 'Home', blurb: 'Utilities, appliances, repairs, rooms and household routines.' },
  { key: 'vehicles', label: 'Vehicles', blurb: 'Servicing, mileage, fuel, insurance and running costs.' },
  { key: 'health', label: 'Health', blurb: 'Appointments, medication, measurements and a private journal.' },
  { key: 'family', label: 'Family', blurb: 'Household members, chores, school, childcare and care routines.' },
  { key: 'pets', label: 'Pets', blurb: 'Vaccinations, vet visits, insurance and sitter instructions.' },
  { key: 'food', label: 'Food', blurb: 'Meal plans, pantry, shopping lists and dietary needs.' },
  { key: 'travel', label: 'Travel', blurb: 'Trips, bookings, packing lists and travel credits.' },
  { key: 'work', label: 'Work', blurb: 'Shifts, leave, qualifications, courses and job applications.' },
  { key: 'relationships', label: 'Relationships', blurb: 'Birthdays, gift ideas, occasions and memories.' },
  { key: 'goals', label: 'Goals & hobbies', blurb: 'Bucket list, reading, collections and volunteering.' },
  { key: 'digital', label: 'Digital life', blurb: 'Devices, backups, domains and an account inventory.' }
] as const

const DEFAULTS: PortableSettings = {
  locale: 'en-GB',
  currency: 'GBP',
  dateFormat: 'auto',
  weekStartsOn: 1,
  timezone: 'Europe/London',
  theme: 'system',
  density: 'comfortable',
  modules: ['home', 'vehicles'],
  dashboard: ['attention', 'agenda', 'tasks', 'money', 'habits', 'capture'],
  lowClutter: false,
  diagnosticsOptIn: false,
  aiEnabled: false,
  aiProvider: '',
  onboardingComplete: false,
  vaultOwnerName: ''
}

export class SettingsService {
  constructor(private readonly db: OrbitDatabase) {}

  all(): PortableSettings {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const out: Record<string, unknown> = { ...DEFAULTS }
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value)
      } catch {
        // A single unreadable setting must not blank the rest.
        log.warn('settings', `ignoring an unreadable setting: ${row.key}`)
      }
    }
    return this.normalise(out)
  }

  private normalise(input: Record<string, unknown>): PortableSettings {
    const merged = { ...DEFAULTS, ...input } as PortableSettings
    const known = new Set(ALL_MODULES.map((m) => m.key))
    merged.modules = Array.isArray(merged.modules) ? merged.modules.filter((m) => known.has(m as never)) : DEFAULTS.modules
    merged.weekStartsOn = merged.weekStartsOn === 0 ? 0 : 1
    if (!['system', 'light', 'dark'].includes(merged.theme)) merged.theme = 'system'
    if (!['comfortable', 'compact'].includes(merged.density)) merged.density = 'comfortable'
    if (!['auto', 'dmy', 'mdy', 'ymd'].includes(merged.dateFormat)) merged.dateFormat = 'auto'
    merged.currency = String(merged.currency || 'GBP').toUpperCase().slice(0, 8)
    merged.locale = String(merged.locale || 'en-GB').slice(0, 20)
    if (!Array.isArray(merged.dashboard)) merged.dashboard = DEFAULTS.dashboard
    return merged
  }

  get<K extends keyof PortableSettings>(key: K): PortableSettings[K] {
    return this.all()[key]
  }

  set(values: Partial<PortableSettings>): PortableSettings {
    const now = new Date().toISOString()
    const allowed = new Set(Object.keys(DEFAULTS))
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!allowed.has(key)) continue
        this.db.run(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          [key, JSON.stringify(value), now]
        )
      }
    })
    return this.all()
  }

  ensureDefaults(): void {
    const count = Number(this.db.scalar<number>('SELECT COUNT(*) FROM settings') ?? 0)
    if (count === 0) this.set(DEFAULTS)
  }

  moduleEnabled(module: string): boolean {
    if (!module) return true
    return this.all().modules.includes(module)
  }
}
