/**
 * The complete list of messages the interface may send to the main process.
 *
 * This is an allow-list, not documentation. The preload bridge refuses any
 * channel not named here, and the main process validates every payload against
 * a schema before a handler sees it. A renderer that has been compromised by,
 * say, a malicious string inside an imported file therefore cannot reach the
 * filesystem, the database, or anything else — it can only send these messages,
 * with these shapes.
 */

export const IPC_CHANNELS = [
  // Application and window
  'app.info',
  'app.openExternal',
  'app.revealPath',

  // Vault lifecycle
  'vault.status',
  'vault.chooseFolder',
  'vault.create',
  'vault.open',
  'vault.close',
  'vault.recents',
  'vault.forget',
  'vault.rename',
  'vault.portableCandidate',
  'vault.createDemo',
  'vault.integrity',
  'vault.verifyAttachments',
  'vault.backup',
  'vault.listBackups',
  'vault.restore',
  'vault.prepareTransfer',
  'vault.reveal',

  // Device (per-machine) preferences
  'device.get',
  'device.set',

  // Portable settings (inside the vault)
  'settings.get',
  'settings.set',

  // Records
  'records.list',
  'records.get',
  'records.create',
  'records.update',
  'records.delete',
  'records.restore',
  'records.link',
  'records.unlink',
  'records.related',
  'records.history',
  'records.describe',
  'records.counts',

  // Attachments
  'attachments.listFor',
  'attachments.addFiles',
  'attachments.addFromPaths',
  'attachments.read',
  'attachments.remove',
  'attachments.export',
  'attachments.unreferenced',

  // Search
  'search.query',
  'search.rebuild',
  'search.stats',

  // Dashboards and derived views
  'today.brief',
  'plan.calendar',
  'plan.workload',
  'money.overview',
  'money.budgets',
  'money.bills',
  'money.payroll',
  'money.netWorth',
  'money.repaymentPlan',
  'life.modules',
  'life.setModules',
  'record.detail',

  // Inbox and capture
  'inbox.list',
  'inbox.capture',
  'inbox.convert',
  'inbox.archive',

  // Bills and reminders engine
  'bills.markPaid',
  'bills.upcoming',
  'reminders.due',
  'reminders.acknowledge',
  'reminders.snooze',

  // Tasks
  'tasks.complete',
  'tasks.reschedule',

  // Import and export
  'import.previewCsv',
  'import.commitCsv',
  'export.records',

  // Life event templates
  'lifeEvents.templates',
  'lifeEvents.preview',
  'lifeEvents.apply',

  // Demonstration data
  'demo.seed'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

/** Every handler returns this envelope. Errors never cross as exceptions. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; fields?: { field: string; message: string }[] }

/** Events the main process pushes to the interface, also allow-listed. */
export const IPC_EVENTS = [
  'vault.changed',
  'vault.closed',
  'vault.warning',
  'records.changed',
  'reminders.fired',
  'search.progress',
  'background.tick'
] as const

export type IpcEvent = (typeof IPC_EVENTS)[number]

export interface AppInfo {
  version: string
  platform: NodeJS.Platform | string
  arch: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  isPackaged: boolean
  /**
   * Always false in this build, and shown in Settings. Orbit makes no network
   * requests at all: the main process blocks every one at the session level.
   */
  networkEnabled: boolean
}
