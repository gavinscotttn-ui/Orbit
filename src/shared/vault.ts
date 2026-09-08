/**
 * The Orbit vault format.
 *
 * A vault is an ordinary folder. Everything a person owns in Orbit — records,
 * attachments, portable preferences, backups — lives inside it, addressed by
 * paths relative to the vault root. Nothing outside the folder is required to
 * read it, and nothing inside it names the computer that wrote it.
 *
 * Close Orbit, copy the folder to a USB stick, open it on a different computer
 * with a different operating system, and everything is there. That is the whole
 * design goal, and every decision below serves it.
 *
 * See docs/VAULT-FORMAT.md for the normative description.
 */

/** Bumped when the on-disk *layout* changes (not the SQL schema). */
export const VAULT_FORMAT_VERSION = 1

/**
 * The SQL schema version this build writes. An older Orbit opening a vault with
 * a higher schemaVersion must refuse, clearly, rather than corrupt it.
 */
export const SCHEMA_VERSION = 10

export const MANIFEST_FILENAME = 'orbit-vault.json'
export const LOCK_FILENAME = '.orbit-lock'

export const VAULT_PATHS = {
  manifest: MANIFEST_FILENAME,
  dataDir: 'data',
  database: 'data/orbit.sqlite',
  attachmentsDir: 'attachments',
  preferencesDir: 'preferences',
  portablePreferences: 'preferences/portable.json',
  backupsDir: 'backups',
  exportsDir: 'exports',
  lock: LOCK_FILENAME
} as const

export type VaultEncryption = 'none' | 'sqlcipher-not-implemented'

export interface VaultManifest {
  /** Constant marker so a folder can be identified as a vault without parsing more. */
  readonly kind: 'orbit-vault'
  /** Stable random identity for this vault. Survives moves and renames. */
  vaultId: string
  /** On-disk layout version. */
  formatVersion: number
  /** SQL schema version of the database currently in `data/`. */
  schemaVersion: number
  /** User-facing name. Purely cosmetic; the folder may be renamed freely. */
  name: string
  createdAt: string
  updatedAt: string
  /** Orbit version that created the vault, for support and diagnostics. */
  createdByAppVersion: string
  /** Orbit version that last wrote to it. */
  lastWrittenByAppVersion: string
  /** True for the isolated demonstration vault. Never mixed with real data. */
  isDemo: boolean
  /** Encryption at rest. `none` today — see docs; never claimed unless real. */
  encryption: VaultEncryption
  /**
   * Whether this vault was last closed cleanly. A vault left `false` prompts an
   * integrity check on next open rather than silently continuing.
   */
  cleanShutdown: boolean
  /**
   * Deliberately absent: any absolute path, hostname, username, or machine id.
   * Device-specific state lives in the app's per-machine settings, not here.
   */
}

export interface VaultSummary {
  path: string
  manifest: VaultManifest
}

export interface RecentVaultEntry {
  path: string
  vaultId: string
  name: string
  lastOpenedAt: string
  isDemo: boolean
  /** False when the folder is gone — the UI offers "Locate…" rather than erroring. */
  available: boolean
}

export type VaultOpenErrorCode =
  | 'not-a-vault'
  | 'manifest-unreadable'
  | 'schema-too-new'
  | 'format-too-new'
  | 'locked-by-another-instance'
  | 'not-writable'
  | 'missing-database'
  | 'path-missing'
  | 'integrity-failed'
  | 'migration-failed'
  | 'unknown'

export interface VaultOpenError {
  code: VaultOpenErrorCode
  message: string
  /** What the user can actually do about it, in plain words. */
  remedy: string
  detail?: string
}

export interface VaultIntegrityReport {
  checkedAt: string
  databaseIntegrity: 'ok' | 'failed'
  databaseIntegrityDetail: string
  foreignKeyViolations: number
  attachmentsExpected: number
  attachmentsPresent: number
  attachmentsMissing: { id: string; filename: string; relativePath: string }[]
  attachmentsOrphaned: string[]
  attachmentsCorrupt: { id: string; filename: string; relativePath: string }[]
  schemaVersion: number
  formatVersion: number
  walPresent: boolean
  /** True when nothing needs the user's attention. */
  healthy: boolean
}

export interface BackupEntry {
  id: string
  createdAt: string
  relativePath: string
  bytes: number
  schemaVersion: number
  reason: 'manual' | 'pre-migration' | 'scheduled' | 'pre-restore'
  note: string
  includesAttachments: boolean
}

export interface TransferReadiness {
  ready: boolean
  vaultPath: string
  checkedAt: string
  /** Blocking problems that must be resolved before copying. */
  problems: string[]
  /** Things the user should know but which do not block the copy. */
  notes: string[]
  databaseBytes: number
  attachmentCount: number
  attachmentBytes: number
  walCheckpointed: boolean
}

export function defaultManifest(params: {
  vaultId: string
  name: string
  appVersion: string
  isDemo?: boolean
}): VaultManifest {
  const now = new Date().toISOString()
  return {
    kind: 'orbit-vault',
    vaultId: params.vaultId,
    formatVersion: VAULT_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    name: params.name,
    createdAt: now,
    updatedAt: now,
    createdByAppVersion: params.appVersion,
    lastWrittenByAppVersion: params.appVersion,
    isDemo: Boolean(params.isDemo),
    encryption: 'none',
    cleanShutdown: true
  }
}

/** Tolerant manifest parse: repairs what it safely can, rejects what it cannot. */
export function parseManifest(raw: unknown): { ok: true; manifest: VaultManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'The manifest file is not a JSON object.' }
  const m = raw as Record<string, unknown>
  if (m.kind !== 'orbit-vault') return { ok: false, reason: 'This folder is not an Orbit vault.' }
  const vaultId = typeof m.vaultId === 'string' && m.vaultId ? m.vaultId : ''
  if (!vaultId) return { ok: false, reason: 'The manifest has no vault identifier.' }
  const formatVersion = Number(m.formatVersion)
  const schemaVersion = Number(m.schemaVersion)
  if (!Number.isFinite(formatVersion) || !Number.isFinite(schemaVersion)) {
    return { ok: false, reason: 'The manifest has no usable version numbers.' }
  }
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  return {
    ok: true,
    manifest: {
      kind: 'orbit-vault',
      vaultId,
      formatVersion,
      schemaVersion,
      name: str(m.name, 'Orbit Vault'),
      createdAt: str(m.createdAt, new Date().toISOString()),
      updatedAt: str(m.updatedAt, new Date().toISOString()),
      createdByAppVersion: str(m.createdByAppVersion, 'unknown'),
      lastWrittenByAppVersion: str(m.lastWrittenByAppVersion, 'unknown'),
      isDemo: Boolean(m.isDemo),
      encryption: m.encryption === 'sqlcipher-not-implemented' ? 'sqlcipher-not-implemented' : 'none',
      cleanShutdown: m.cleanShutdown !== false
    }
  }
}
