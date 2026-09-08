import { accessSync, constants, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { VAULT_PATHS, MANIFEST_FILENAME } from '@shared/vault.js'
import { isPathTraversal } from '@shared/domain/ids.js'

/**
 * Every path Orbit touches inside a vault is derived here, from the vault root,
 * and nowhere else. Nothing in the database stores an absolute path, so moving
 * the folder — to another drive, another user account, another operating
 * system — changes only the value of `root`.
 */
export class VaultPaths {
  constructor(readonly root: string) {}

  private child(relative: string): string {
    return join(this.root, ...relative.split('/'))
  }

  get manifest(): string {
    return this.child(VAULT_PATHS.manifest)
  }
  get dataDir(): string {
    return this.child(VAULT_PATHS.dataDir)
  }
  get database(): string {
    return this.child(VAULT_PATHS.database)
  }
  get databaseWal(): string {
    return this.database + '-wal'
  }
  get databaseShm(): string {
    return this.database + '-shm'
  }
  get attachmentsDir(): string {
    return this.child(VAULT_PATHS.attachmentsDir)
  }
  get preferencesDir(): string {
    return this.child(VAULT_PATHS.preferencesDir)
  }
  get portablePreferences(): string {
    return this.child(VAULT_PATHS.portablePreferences)
  }
  get backupsDir(): string {
    return this.child(VAULT_PATHS.backupsDir)
  }
  get exportsDir(): string {
    return this.child(VAULT_PATHS.exportsDir)
  }
  get lockFile(): string {
    return this.child(VAULT_PATHS.lock)
  }

  /**
   * Resolve a vault-relative path to an absolute one, refusing anything that
   * would escape the vault. This is the single choke point for attachment
   * paths, imported archive entries and anything else that arrives as a string.
   */
  resolveInside(relative: string): string {
    if (isPathTraversal(relative)) {
      throw new Error('Refusing a path that points outside the vault.')
    }
    const absolute = resolve(this.root, normalize(relative))
    const rootWithSep = resolve(this.root) + sep
    if (absolute !== resolve(this.root) && !absolute.startsWith(rootWithSep)) {
      throw new Error('Refusing a path that points outside the vault.')
    }
    return absolute
  }

  ensureSkeleton(): void {
    for (const dir of [this.dataDir, this.attachmentsDir, this.preferencesDir, this.backupsDir, this.exportsDir]) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

export function looksLikeVault(folder: string): boolean {
  try {
    return existsSync(join(folder, MANIFEST_FILENAME))
  } catch {
    return false
  }
}

export interface WritabilityResult {
  writable: boolean
  reason: string
}

/**
 * Prove a folder is writable by actually writing to it.
 *
 * `fs.access(W_OK)` is not enough: a read-only network share, a full disk, a
 * disconnected USB stick and a macOS quarantine restriction can all pass the
 * permission check and then fail the write. Orbit must never discover this
 * *after* accepting a user's data, so the probe happens before the vault opens
 * and again before anything is written on a removable volume.
 */
export function probeWritable(folder: string): WritabilityResult {
  try {
    if (!existsSync(folder)) {
      return { writable: false, reason: 'The folder does not exist. It may be on a drive that is disconnected.' }
    }
    const info = statSync(folder)
    if (!info.isDirectory()) {
      return { writable: false, reason: 'That path is a file, not a folder.' }
    }
    accessSync(folder, constants.W_OK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      return { writable: false, reason: 'Orbit does not have permission to write to this folder.' }
    }
    if (code === 'ENOENT') {
      return { writable: false, reason: 'The folder is not there. If it is on a removable drive, reconnect the drive.' }
    }
    return { writable: false, reason: 'The folder could not be reached.' }
  }
  // The real test.
  const probe = join(folder, `.orbit-write-test-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(probe, 'orbit', { flag: 'wx' })
    unlinkSync(probe)
    return { writable: true, reason: '' }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    try {
      if (existsSync(probe)) unlinkSync(probe)
    } catch {
      /* best effort */
    }
    if (code === 'EROFS') return { writable: false, reason: 'This location is read-only.' }
    if (code === 'ENOSPC') return { writable: false, reason: 'There is no free space left on this drive.' }
    if (code === 'EACCES' || code === 'EPERM') {
      return { writable: false, reason: 'Orbit does not have permission to write to this folder.' }
    }
    return { writable: false, reason: 'A test write to this folder failed, so Orbit will not open it.' }
  }
}
