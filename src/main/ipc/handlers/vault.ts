import { app, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION, VAULT_FORMAT_VERSION } from '@shared/vault.js'
import type { AppInfo } from '@shared/contracts/ipc.js'
import { safeFileName } from '@shared/domain/ids.js'
import type { AppContext } from '../../context.js'
import { broadcast, Empty, FsPath, handle } from '../router.js'
import { portableCandidate, distributionDirectory } from '../../vault/portable.js'
import { probeWritable } from '../../vault/paths.js'
import { handleExternalLink, securityState } from '../../security.js'
import { seedDemoVault } from '../../services/demo.js'
import { log } from '../../log.js'

/**
 * Vault lifecycle: create, open, move, check, back up, restore and hand over.
 *
 * Every failure here is answered with a plain sentence and something the user
 * can actually do, because a vault that will not open is the most frightening
 * thing this application can do to somebody.
 */
export function registerVaultHandlers(ctx: AppContext): void {
  const sqliteVersion = (): string => {
    try {
      const db = new DatabaseSync(':memory:')
      const row = db.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined
      db.close()
      return String(row?.v ?? 'unknown')
    } catch {
      return 'unknown'
    }
  }

  handle('app.info', Empty, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    sqlite: sqliteVersion(),
    isPackaged: app.isPackaged,
    // Not a setting. Orbit blocks every network request at the session level;
    // this reports the fact so Settings can show it rather than assert it.
    networkEnabled: false
  }))

  handle('app.openExternal', z.object({ url: z.string().max(2000) }), async ({ url }) => {
    return handleExternalLink(url)
  })

  handle('app.revealPath', z.object({ path: FsPath }), ({ path }) => {
    // Only ever a path inside the currently open vault, resolved and checked.
    const session = ctx.vaults.current
    if (!session) throw new Error('No vault is open.')
    const absolute = session.paths.resolveInside(path)
    if (!existsSync(absolute)) throw new Error('That file is not there any more.')
    shell.showItemInFolder(absolute)
    return { revealed: true }
  })

  // -- Status and discovery -------------------------------------------------

  handle('vault.status', Empty, () => {
    const session = ctx.vaults.current
    const security = { blockedRequests: securityState.blockedRequests, lastBlocked: securityState.lastBlocked }
    if (!session) {
      return {
        open: false as const,
        recents: ctx.device.recentVaults(),
        portable: portableCandidate(),
        distributionDirectory: distributionDirectory(),
        formatVersion: VAULT_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        security
      }
    }
    return {
      open: true as const,
      path: session.root,
      manifest: session.manifest,
      folderName: basename(session.root),
      recents: ctx.device.recentVaults(),
      portable: portableCandidate(),
      distributionDirectory: distributionDirectory(),
      formatVersion: VAULT_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      security
    }
  })

  handle('vault.recents', Empty, () => ctx.device.recentVaults())

  handle('vault.forget', z.object({ path: FsPath }), ({ path }) => {
    ctx.device.forgetVault(path)
    return { recents: ctx.device.recentVaults() }
  })

  handle('vault.portableCandidate', Empty, () => portableCandidate())

  handle(
    'vault.chooseFolder',
    z.object({ mode: z.enum(['create', 'open']) }),
    async ({ mode }, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options =
        mode === 'create'
          ? {
              title: 'Choose where to keep your Orbit vault',
              buttonLabel: 'Create vault here',
              properties: ['openDirectory', 'createDirectory'] as const
            }
          : {
              title: 'Choose your Orbit vault folder',
              buttonLabel: 'Open this vault',
              properties: ['openDirectory'] as const
            }
      const result = window
        ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
        : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const }
      const chosen = result.filePaths[0] as string
      const writable = probeWritable(chosen)
      return {
        cancelled: false as const,
        path: chosen,
        writable: writable.writable,
        writableReason: writable.reason,
        isVault: existsSync(join(chosen, 'orbit-vault.json'))
      }
    }
  )

  // -- Opening and creating -------------------------------------------------

  const openResultToPayload = (
    result: ReturnType<AppContext['vaults']['open']>
  ): Record<string, unknown> => {
    if (!result.ok) {
      return {
        opened: false,
        error: result.error,
        lockHolder: result.lockHolder ? { deviceLabel: result.lockHolder.deviceLabel, since: result.lockHolder.acquiredAt } : null,
        lockStale: Boolean(result.lockStale)
      }
    }
    ctx.attach(result.session)
    ctx.device.rememberVault({
      path: result.session.root,
      vaultId: result.session.manifest.vaultId,
      name: result.session.manifest.name,
      lastOpenedAt: new Date().toISOString(),
      isDemo: result.session.manifest.isDemo
    })
    broadcast('vault.changed', { path: result.session.root, name: result.session.manifest.name })
    return {
      opened: true,
      path: result.session.root,
      manifest: result.session.manifest,
      migrated: result.migrated,
      integrity: result.integrity
    }
  }

  handle(
    'vault.create',
    z.object({ path: FsPath, name: z.string().max(120).optional() }),
    ({ path, name }) => {
      if (ctx.isOpen) ctx.closeVault()
      const result = ctx.vaults.create(path, name ? { name } : {})
      return openResultToPayload(result)
    }
  )

  handle(
    'vault.open',
    z.object({ path: FsPath, takeOver: z.boolean().optional() }),
    ({ path, takeOver }) => {
      if (ctx.isOpen && ctx.vaults.current?.root === path) {
        return { opened: true, path, manifest: ctx.vaults.current.manifest, migrated: null, integrity: null }
      }
      if (ctx.isOpen) ctx.closeVault()
      const result = ctx.vaults.open(path, takeOver ? { takeOver: true } : {})
      return openResultToPayload(result)
    }
  )

  handle('vault.close', Empty, () => {
    ctx.closeVault()
    broadcast('vault.closed', {})
    return { closed: true }
  })

  handle('vault.rename', z.object({ name: z.string().min(1).max(120) }), ({ name }) => {
    const manifest = ctx.vaults.rename(name)
    broadcast('vault.changed', { path: ctx.vaults.require().root, name: manifest.name })
    return { manifest }
  })

  /**
   * The demonstration vault.
   *
   * Created in its own folder, flagged `isDemo` in its manifest, and shown with
   * a permanent banner in the interface. It is never mixed with a real vault
   * and never seeded into one.
   */
  handle(
    'vault.createDemo',
    z.object({ path: FsPath.optional() }),
    ({ path }) => {
      if (ctx.isOpen) ctx.closeVault()
      const target = path ?? join(app.getPath('documents'), safeFileName('Orbit Demo Vault'))
      if (existsSync(join(target, 'orbit-vault.json'))) {
        const opened = ctx.vaults.open(target)
        return openResultToPayload(opened)
      }
      const created = ctx.vaults.create(target, { name: 'Orbit demonstration', isDemo: true })
      if (!created.ok) return openResultToPayload(created)
      const payload = openResultToPayload(created)
      try {
        const services = ctx.require()
        seedDemoVault(services.repository, services.settings, services.attachments, services.session.db)
        services.search.rebuild()
      } catch (err) {
        log.error('vault', 'could not fill the demonstration vault', err)
        return { ...payload, demoSeedFailed: true }
      }
      return payload
    }
  )

  // -- Health, backup and transfer ------------------------------------------

  handle('vault.integrity', Empty, () => ctx.vaults.checkIntegrity())

  handle('vault.verifyAttachments', Empty, async () => ctx.vaults.verifyAttachmentHashes())

  handle(
    'vault.backup',
    z.object({ note: z.string().max(300).optional(), includeAttachments: z.boolean().optional() }),
    async ({ note, includeAttachments }) =>
      ctx.vaults.backup({
        reason: 'manual',
        note: note ?? '',
        includeAttachments: Boolean(includeAttachments)
      })
  )

  handle('vault.listBackups', Empty, () => ctx.vaults.listBackups())

  handle('vault.restore', z.object({ id: z.string().min(1).max(200) }), async ({ id }) => {
    const result = await ctx.vaults.restore(id)
    if (result.ok) {
      const session = ctx.vaults.require()
      ctx.attach(session)
      // The index is rebuilt because the restored database has its own, which
      // may be older than the attachments now sitting beside it.
      ctx.require().search.rebuild()
      broadcast('vault.changed', { path: session.root, name: session.manifest.name })
    }
    return result
  })

  handle('vault.prepareTransfer', Empty, () => ctx.vaults.prepareForTransfer())

  handle('vault.reveal', Empty, () => {
    const session = ctx.vaults.require()
    shell.openPath(session.root).catch((err) => log.warn('vault', 'could not open the vault folder', err))
    return { revealed: true }
  })

  // -- Preferences ----------------------------------------------------------

  handle('device.get', Empty, () => ctx.device.all)

  handle(
    'device.set',
    z
      .object({
        themeOverride: z.enum(['', 'light', 'dark', 'system']).optional(),
        osNotificationsEnabled: z.boolean().optional(),
        diagnosticsOptIn: z.boolean().optional(),
        autoLockMinutes: z.number().int().min(0).max(480).optional(),
        reduceMotion: z.boolean().optional(),
        textScale: z.number().min(0.8).max(2).optional(),
        completedFirstRun: z.boolean().optional()
      })
      .strict(),
    (values) => {
      const updated = ctx.device.patch(values)
      securityState.notificationsAllowed = updated.osNotificationsEnabled
      return updated
    }
  )
}
