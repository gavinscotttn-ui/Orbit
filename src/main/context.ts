import { app } from 'electron'
import { VaultManager, type VaultSession } from './vault/manager.js'
import { DeviceStore } from './device-store.js'
import { Repository } from './db/repository.js'
import { AttachmentService } from './services/attachments.js'
import { SearchService } from './services/search.js'
import { SettingsService } from './services/settings.js'
import { RemindersService } from './services/reminders.js'
import { log } from './log.js'

/**
 * The main process's single source of truth for what is currently open.
 *
 * Services are rebuilt whenever a vault opens, because every one of them is
 * bound to that vault's database and folder. Nothing survives a vault switch,
 * which is precisely the point: opening a different vault must not leave a
 * single cached row from the last one.
 */
export class AppContext {
  readonly vaults: VaultManager
  readonly device: DeviceStore

  private services: {
    repository: Repository
    attachments: AttachmentService
    search: SearchService
    settings: SettingsService
    reminders: RemindersService
  } | null = null

  private backgroundTimer: NodeJS.Timeout | null = null

  constructor(readonly appVersion: string) {
    this.vaults = new VaultManager(appVersion)
    this.device = new DeviceStore(app.getPath('userData'))
  }

  get session(): VaultSession | null {
    return this.vaults.current
  }

  get isOpen(): boolean {
    return this.vaults.isOpen && this.services !== null
  }

  /** Throws with a plain message when no vault is open. */
  require(): {
    session: VaultSession
    repository: Repository
    attachments: AttachmentService
    search: SearchService
    settings: SettingsService
    reminders: RemindersService
  } {
    const session = this.vaults.require()
    if (!this.services) throw new Error('No Orbit vault is open.')
    return { session, ...this.services }
  }

  attach(session: VaultSession): void {
    const repository = new Repository(session.db)
    const attachments = new AttachmentService(session.db, session.paths)
    const search = new SearchService(session.db)
    const settings = new SettingsService(session.db)
    const reminders = new RemindersService(session.db, repository, settings)
    this.services = { repository, attachments, search, settings, reminders }
    settings.ensureDefaults()
    this.startBackgroundWork()
  }

  detach(): void {
    this.stopBackgroundWork()
    this.services = null
  }

  closeVault(): void {
    this.detach()
    this.vaults.close()
  }

  /**
   * Periodic work that must not block a save: draining the search queue,
   * extracting text from newly attached files, and rolling reminders forward.
   *
   * Deliberately modest — a personal application has no business burning a
   * core in the background.
   */
  private startBackgroundWork(): void {
    this.stopBackgroundWork()
    this.backgroundTimer = setInterval(() => {
      if (!this.services) return
      try {
        const extracted = this.services.attachments.extractPendingText(5)
        const queue = this.services.search.processQueue(100)
        if (extracted > 0 || queue.failed > 0) {
          log.debug('background', `indexed ${queue.indexed}, extracted ${extracted}, failed ${queue.failed}`)
        }
        this.services.reminders.refreshDue()
      } catch (err) {
        log.warn('background', 'a background pass failed', err)
      }
    }, 4000)
    this.backgroundTimer.unref?.()
  }

  private stopBackgroundWork(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer)
      this.backgroundTimer = null
    }
  }
}
