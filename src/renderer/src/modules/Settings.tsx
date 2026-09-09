import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BackupEntry, TransferReadiness, VaultIntegrityReport } from '@shared/vault.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { ALL_LOCALES } from '../lib/locales.js'
import { bytes as fmtBytes, date as fmtDate, humanise } from '../lib/format.js'
import { CurrencySelect } from '../components/Form.js'
import { Icon, type IconName } from '../components/Icon.js'
import { OrbitMark } from '../components/Brand.js'
import { Chip, EmptyState, Loading, Modal, Notice, useConfirm } from '../components/ui.js'
import type { Navigator } from '../app/App.js'

/**
 * Settings.
 *
 * Split the way the data is split: what belongs to the person and travels with
 * the vault, and what belongs to this computer and does not. That distinction
 * is stated on the screen, because "why did my currency reset when I moved to
 * the new laptop?" is a question no product should ever cause.
 */

type Section = 'vault' | 'modules' | 'preferences' | 'privacy' | 'about'

const SECTIONS: [Section, string, IconName][] = [
  ['vault', 'Vault, backups & transfer', 'lock'],
  ['modules', 'Areas of life', 'grid'],
  ['preferences', 'Preferences', 'settings'],
  ['privacy', 'Privacy & security', 'shield'],
  ['about', 'About Orbit', 'info']
]

export function SettingsPage({ nav }: { nav: Navigator }): ReactNode {
  const initial = nav.route.page === 'settings' && nav.route.section ? (nav.route.section as Section) : 'vault'
  const [section, setSection] = useState<Section>(initial)

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <p className="kicker">Settings</p>
          <h1>{SECTIONS.find((s) => s[0] === section)?.[1]}</h1>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 'var(--gap)' }}>
        {SECTIONS.map(([key, label, icon]) => (
          <button key={key} className={`btn small${section === key ? ' primary' : ''}`} onClick={() => setSection(key)}>
            <Icon name={icon} size={13} />
            {label}
          </button>
        ))}
      </div>

      {section === 'vault' ? (
        <VaultSection />
      ) : section === 'modules' ? (
        <ModulesSection />
      ) : section === 'preferences' ? (
        <PreferencesSection />
      ) : section === 'privacy' ? (
        <PrivacySection />
      ) : (
        <AboutSection />
      )}
    </>
  )
}

// -- Vault -------------------------------------------------------------------

function VaultSection(): ReactNode {
  const { vault, format, toast, refreshVault, bumpRevision } = useApp()
  const { confirm, dialog } = useConfirm()
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)
  const [integrity, setIntegrity] = useState<VaultIntegrityReport | null>(null)
  const [transfer, setTransfer] = useState<TransferReadiness | null>(null)
  const [busy, setBusy] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(vault?.manifest?.name ?? '')

  const loadBackups = useCallback(async () => {
    const result = await call<BackupEntry[]>('vault.listBackups', {})
    setBackups(result.ok ? result.data : [])
  }, [])

  useEffect(() => {
    void loadBackups()
  }, [loadBackups])

  const runIntegrity = async (): Promise<void> => {
    setBusy('integrity')
    const result = await call<VaultIntegrityReport>('vault.integrity', {})
    setBusy('')
    if (result.ok) {
      setIntegrity(result.data)
      toast({
        tone: result.data.healthy ? 'good' : 'bad',
        title: result.data.healthy ? 'Everything checks out' : 'The check found problems',
        detail: result.data.healthy ? undefined : 'See the report below.'
      })
    }
  }

  const takeBackup = async (includeAttachments: boolean): Promise<void> => {
    setBusy('backup')
    const result = await call<BackupEntry>('vault.backup', { includeAttachments, note: 'Taken by hand' })
    setBusy('')
    if (!result.ok) {
      toast({ tone: 'bad', title: 'The backup failed', detail: result.error })
      return
    }
    toast({ tone: 'good', title: 'Backup taken', detail: fmtBytes(result.data.bytes) })
    void loadBackups()
  }

  const restore = async (backup: BackupEntry): Promise<void> => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: (
        <>
          <p>
            Everything in your vault will be replaced with the contents of the backup taken on{' '}
            <b>{fmtDate(backup.createdAt.slice(0, 10), format)}</b>. Anything added since then will be gone.
          </p>
          <p style={{ marginTop: 8 }}>
            Orbit takes a fresh backup of the current state first, so this itself can be undone.
          </p>
        </>
      ),
      confirmLabel: 'Restore',
      tone: 'danger',
      requireWord: 'restore'
    })
    if (!ok) return
    setBusy('restore')
    const result = await call<{ ok: boolean; message?: string }>('vault.restore', { id: backup.id })
    setBusy('')
    if (!result.ok || !result.data.ok) {
      toast({ tone: 'bad', title: 'The restore did not complete', detail: result.ok ? result.data.message : result.error })
      return
    }
    toast({ tone: 'good', title: 'Restored' })
    bumpRevision()
    void loadBackups()
  }

  const prepare = async (): Promise<void> => {
    setBusy('transfer')
    const result = await call<TransferReadiness>('vault.prepareTransfer', {})
    setBusy('')
    if (result.ok) setTransfer(result.data)
  }

  const closeVault = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Close this vault?',
      message: 'Orbit will flush everything to disk and return to the opening screen. Nothing is lost.',
      confirmLabel: 'Close it'
    })
    if (!ok) return
    await call('vault.close', {})
    await refreshVault()
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{vault?.manifest?.name}</h2>
            <p className="sub" style={{ overflowWrap: 'anywhere' }}>{vault?.path}</p>
          </div>
          <div className="btn-row">
            <button className="btn small" onClick={() => void call('vault.reveal', {})}>
              <Icon name="folder" size={13} />
              Open the folder
            </button>
            <button className="btn small" onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button className="btn small" onClick={() => void closeVault()}>
              Close vault
            </button>
          </div>
        </div>
        <div className="card-body">
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 30%) 1fr', gap: '8px 16px', margin: 0, fontSize: 12.5 }}>
            <dt style={{ color: 'var(--muted)' }}>Vault format</dt>
            <dd style={{ margin: 0 }}>{vault?.manifest?.formatVersion}</dd>
            <dt style={{ color: 'var(--muted)' }}>Database format</dt>
            <dd style={{ margin: 0 }}>{vault?.manifest?.schemaVersion}</dd>
            <dt style={{ color: 'var(--muted)' }}>Created</dt>
            <dd style={{ margin: 0 }}>{vault?.manifest ? fmtDate(vault.manifest.createdAt.slice(0, 10), format) : '—'}</dd>
            <dt style={{ color: 'var(--muted)' }}>Encryption at rest</dt>
            <dd style={{ margin: 0 }}>
              <Chip tone="warn">Not enabled</Chip>
            </dd>
          </dl>
          <Notice tone="info" title="About encryption" icon="lock">
            Orbit does not encrypt the vault, and does not pretend to. The database is a plain SQLite file and the
            attachments are plain files. If the contents matter, use your operating system's full-disk encryption —
            FileVault on a Mac, BitLocker on Windows — which is stronger than anything an application can do on its own.
            An encrypted-vault option is designed but not built; see the documentation.
          </Notice>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Moving to another computer</h2>
              <p className="sub">Windows or Mac, Intel or Apple Silicon — the same folder works on all of them</p>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
              Orbit flushes everything to disk and checks the vault is complete, then tells you what to copy and what
              will not come with it.
            </p>
            <button className="btn primary" onClick={() => void prepare()} disabled={busy === 'transfer'}>
              {busy === 'transfer' ? 'Checking…' : 'Prepare for transfer'}
            </button>
            {transfer ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {transfer.ready ? (
                  <Notice tone="good" title="Ready to copy">
                    The database has been flushed and everything is present. Close Orbit, then copy the whole vault
                    folder.
                  </Notice>
                ) : (
                  <Notice tone="bad" title="Not ready yet">
                    <ul style={{ marginTop: 5 }}>
                      {transfer.problems.map((problem) => (
                        <li key={problem} style={{ fontSize: 12.5 }}>
                          • {problem}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                )}
                <div style={{ display: 'flex', gap: 14, color: 'var(--muted)', fontSize: 12 }}>
                  <span>Database {fmtBytes(transfer.databaseBytes)}</span>
                  <span>
                    {transfer.attachmentCount} file{transfer.attachmentCount === 1 ? '' : 's'} ({fmtBytes(transfer.attachmentBytes)})
                  </span>
                </div>
                <div>
                  <h4 style={{ marginBottom: 6, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Worth knowing
                  </h4>
                  <ul style={{ display: 'grid', gap: 4 }}>
                    {transfer.notes.map((note) => (
                      <li key={note} style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>
                        • {note}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Check the vault</h2>
              <p className="sub">Database integrity, links and attachments</p>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            <div className="btn-row">
              <button className="btn" onClick={() => void runIntegrity()} disabled={busy === 'integrity'}>
                {busy === 'integrity' ? 'Checking…' : 'Run a check'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  void (async () => {
                    setBusy('hashes')
                    const result = await call<{ checked: number; mismatched: { filename: string }[] }>(
                      'vault.verifyAttachments',
                      {}
                    )
                    setBusy('')
                    if (!result.ok) return
                    toast({
                      tone: result.data.mismatched.length === 0 ? 'good' : 'bad',
                      title:
                        result.data.mismatched.length === 0
                          ? `All ${result.data.checked} files verified`
                          : `${result.data.mismatched.length} file(s) do not match their checksum`,
                      detail: result.data.mismatched.map((m) => m.filename).slice(0, 3).join(', ') || undefined
                    })
                  })()
                }}
                disabled={busy === 'hashes'}
              >
                {busy === 'hashes' ? 'Verifying…' : 'Verify every file'}
              </button>
            </div>
            {integrity ? (
              <div style={{ display: 'grid', gap: 7, fontSize: 12.5 }}>
                <CheckRow label="Database" ok={integrity.databaseIntegrity === 'ok'} detail={integrity.databaseIntegrityDetail} />
                <CheckRow label="Links between records" ok={integrity.foreignKeyViolations === 0} detail={`${integrity.foreignKeyViolations} broken`} />
                <CheckRow
                  label="Attached files"
                  ok={integrity.attachmentsMissing.length === 0}
                  detail={`${integrity.attachmentsPresent} of ${integrity.attachmentsExpected} present`}
                />
                {integrity.attachmentsOrphaned.length > 0 ? (
                  <span style={{ color: 'var(--muted)' }}>
                    {integrity.attachmentsOrphaned.length} file(s) in the vault that no record claims.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Backups</h2>
            <p className="sub">Taken with SQLite's own snapshot mechanism, so they are always consistent</p>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => void takeBackup(false)} disabled={busy === 'backup'}>
              Back up now
            </button>
            <button className="btn" onClick={() => void takeBackup(true)} disabled={busy === 'backup'}>
              Back up with files
            </button>
          </div>
        </div>
        <div className="card-body flush">
          {!backups ? (
            <div style={{ padding: 16 }}>
              <Loading rows={3} label="Loading backups" />
            </div>
          ) : backups.length === 0 ? (
            <EmptyState
              icon="folder"
              title="No backups yet"
              message="Orbit takes one automatically before any upgrade. Taking one by hand before a big change is a good habit."
            />
          ) : (
            <ul>
              {backups.map((backup) => (
                <li
                  key={backup.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}
                >
                  <span style={{ color: 'var(--muted)' }}>
                    <Icon name="history" size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 12.5, fontWeight: 560 }}>
                      {fmtDate(backup.createdAt.slice(0, 10), format)} at {backup.createdAt.slice(11, 16)}
                    </b>
                    <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                      {humanise(backup.reason)} · {fmtBytes(backup.bytes)}
                      {backup.includesAttachments ? ' · includes files' : ''}
                      {backup.note ? ` · ${backup.note}` : ''}
                    </small>
                  </div>
                  <button className="btn small" onClick={() => void restore(backup)} disabled={busy === 'restore'}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {renaming ? (
        <Modal
          title="Rename this vault"
          onClose={() => setRenaming(false)}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void (async () => {
                    const result = await call('vault.rename', { name: newName.trim() })
                    setRenaming(false)
                    if (result.ok) {
                      await refreshVault()
                      toast({ tone: 'good', title: 'Renamed' })
                    }
                  })()
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="rename-vault">Name</label>
            <input id="rename-vault" type="text" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <span className="help">This is just a label. The folder on disk keeps its own name.</span>
          </div>
        </Modal>
      ) : null}

      {dialog}
    </div>
  )
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }): ReactNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ color: ok ? 'var(--good)' : 'var(--bad)' }}>
        <Icon name={ok ? 'check' : 'alert'} size={14} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--muted)' }}>{detail}</span>
    </div>
  )
}

// -- Modules -----------------------------------------------------------------

function ModulesSection(): ReactNode {
  const { settings, setSettings } = useApp()
  const [available, setAvailable] = useState<{ key: string; label: string; blurb: string }[]>([])

  useEffect(() => {
    void (async () => {
      const result = await call<{ available: { key: string; label: string; blurb: string }[] }>('life.modules', {})
      if (result.ok) setAvailable(result.data.available)
    })()
  }, [])

  const enabled = settings?.modules ?? []

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <Notice tone="info" title="Turning an area off hides it — it never deletes anything">
        If you switch Vehicles off, your car and all its history stay exactly where they are. Switch it back on and
        everything is there.
      </Notice>
      <div className="grid two">
        {available.map((module) => {
          const on = enabled.includes(module.key)
          return (
            <button
              key={module.key}
              className="card"
              style={{
                display: 'flex',
                gap: 13,
                padding: 16,
                textAlign: 'left',
                alignItems: 'flex-start',
                borderColor: on ? 'var(--accent)' : 'var(--line)'
              }}
              aria-pressed={on}
              onClick={() => {
                const next = on ? enabled.filter((m) => m !== module.key) : [...enabled, module.key]
                void setSettings({ modules: next })
              }}
            >
              <span
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 22,
                  height: 22,
                  flex: '0 0 auto',
                  marginTop: 1,
                  borderRadius: 6,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`,
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? 'var(--accent-ink)' : 'transparent'
                }}
              >
                <Icon name="check" size={13} />
              </span>
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontSize: 13.5, marginBottom: 3 }}>{module.label}</b>
                <small style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.55 }}>{module.blurb}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// -- Preferences -------------------------------------------------------------

function PreferencesSection(): ReactNode {
  const { settings, device, setSettings, setDevice } = useApp()
  if (!settings || !device) return <Loading rows={5} label="Loading your preferences" />

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Yours, and they travel with you</h2>
            <p className="sub">Stored inside the vault, so they follow you to another computer</p>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pref-name">What should Orbit call you?</label>
              <input
                id="pref-name"
                type="text"
                value={settings.vaultOwnerName}
                onChange={(event) => void setSettings({ vaultOwnerName: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="pref-currency">Main currency</label>
              <CurrencySelect id="pref-currency" value={settings.currency} onChange={(value) => void setSettings({ currency: value })} />
            </div>
            <div className="field">
              <label htmlFor="pref-locale">Region and language</label>
              <select
                id="pref-locale"
                value={settings.locale}
                onChange={(event) => void setSettings({ locale: event.target.value })}
              >
                {ALL_LOCALES.map((locale) => (
                  <option key={locale.code} value={locale.code}>
                    {locale.label}
                  </option>
                ))}
              </select>
              <span className="help">Sets how dates and numbers are written.</span>
            </div>
            <div className="field">
              <label htmlFor="pref-week">Weeks start on</label>
              <select
                id="pref-week"
                value={String(settings.weekStartsOn)}
                onChange={(event) => void setSettings({ weekStartsOn: event.target.value === '0' ? 0 : 1 })}
              >
                <option value="1">Monday</option>
                <option value="0">Sunday</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pref-theme">Theme</label>
              <select
                id="pref-theme"
                value={settings.theme}
                onChange={(event) => void setSettings({ theme: event.target.value as 'system' | 'light' | 'dark' })}
              >
                <option value="system">Follow the computer</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pref-density">Density</label>
              <select
                id="pref-density"
                value={settings.density}
                onChange={(event) => void setSettings({ density: event.target.value as 'comfortable' | 'compact' })}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.lowClutter}
                onChange={(event) => void setSettings({ lowClutter: event.target.checked })}
              />
              <span>Low-clutter mode — hide secondary detail until asked for</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>This computer only</h2>
            <p className="sub">These stay behind when you move the vault, which is deliberate</p>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="dev-theme">Override the theme on this computer</label>
              <select
                id="dev-theme"
                value={device.themeOverride}
                onChange={(event) => void setDevice({ themeOverride: event.target.value as '' | 'light' | 'dark' | 'system' })}
              >
                <option value="">Use the vault's setting</option>
                <option value="system">Follow this computer</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="dev-lock">Lock the vault after</label>
              <select
                id="dev-lock"
                value={String(device.autoLockMinutes)}
                onChange={(event) => void setDevice({ autoLockMinutes: Number(event.target.value) })}
              >
                <option value="0">Never</option>
                <option value="5">5 minutes of inactivity</option>
                <option value="15">15 minutes of inactivity</option>
                <option value="30">30 minutes of inactivity</option>
                <option value="60">1 hour of inactivity</option>
                <option value="240">4 hours of inactivity</option>
              </select>
              <p className="help">
                Locking closes the vault and returns you to the opening screen. There is no passphrase to type — Orbit
                does not have one — so this hides your records and releases the vault, it does not encrypt anything.
              </p>
            </div>
            <div className="field">
              <label htmlFor="dev-scale">Text size</label>
              <select
                id="dev-scale"
                value={String(device.textScale)}
                onChange={(event) => void setDevice({ textScale: Number(event.target.value) })}
              >
                <option value="0.9">Small</option>
                <option value="1">Normal</option>
                <option value="1.15">Large</option>
                <option value="1.3">Larger</option>
                <option value="1.5">Largest</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 4 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={device.reduceMotion}
                onChange={(event) => void setDevice({ reduceMotion: event.target.checked })}
              />
              <span>Reduce motion</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={device.osNotificationsEnabled}
                onChange={(event) => void setDevice({ osNotificationsEnabled: event.target.checked })}
              />
              <span>Allow desktop notifications on this computer</span>
            </label>
            <p className="help" style={{ marginLeft: 24 }}>
              Permission is granted per computer, so you will be asked again after moving your vault. Notifications only
              appear while Orbit is running.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// -- Privacy -----------------------------------------------------------------

function PrivacySection(): ReactNode {
  const { vault, info, settings, setSettings } = useApp()
  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Network</h2>
            <p className="sub">What Orbit sends, and to whom</p>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <Notice tone="good" title="Orbit makes no network requests" icon="lock">
            This is enforced, not merely intended: every outgoing request is cancelled by the application itself before
            it leaves. There is no account, no sync, no telemetry, no analytics, no crash reporting and no automatic
            update check. Even the fonts are the ones already on your computer.
          </Notice>
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 40%) 1fr', gap: '8px 16px', margin: 0, fontSize: 12.5 }}>
            <dt style={{ color: 'var(--muted)' }}>Network access</dt>
            <dd style={{ margin: 0 }}>
              <Chip tone="good">Blocked at the application level</Chip>
            </dd>
            <dt style={{ color: 'var(--muted)' }}>Requests blocked this session</dt>
            <dd style={{ margin: 0 }} className="num">
              {vault?.security.blockedRequests ?? 0}
              {vault?.security.lastBlocked ? ` (last: ${vault.security.lastBlocked})` : ''}
            </dd>
            <dt style={{ color: 'var(--muted)' }}>Telemetry</dt>
            <dd style={{ margin: 0 }}>
              <Chip tone="good">None, and none to opt into</Chip>
            </dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Where things are kept</h2>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10, fontSize: 12.5, lineHeight: 1.65 }}>
          <p>
            <b>Your records</b> are in the vault folder you chose, in a standard SQLite database that any SQLite tool
            can read. Your attached files are ordinary files beside it, named by the checksum of their contents.
          </p>
          <p>
            <b>Logs</b> go to this computer's application folder, never into the vault, and are stripped of anything
            identifying before they are written. A vault copied to another computer carries no trace of this one.
          </p>
          <p>
            <b>Passwords</b> are not stored anywhere in Orbit. The online-account inventory deliberately records where
            your credentials live rather than what they are — use a proper password manager for that.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Optional assistance</h2>
            <p className="sub">Off, with nothing configured</p>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={settings?.aiEnabled ?? false}
              disabled
              onChange={(event) => void setSettings({ aiEnabled: event.target.checked })}
            />
            <span>Use an AI assistant for natural-language questions</span>
          </label>
          <Notice tone="info" title="Not built in this version">
            The place for it exists and the setting is stored, but no adapter is implemented, so switching it on would do
            nothing. When it is built it will be off by default, will name the provider before a single word of your data
            is sent anywhere, and every core feature will keep working without it. Orbit will not quietly acquire a
            network connection to make a feature work.
          </Notice>
        </div>
      </div>

      {info ? (
        <p className="help" style={{ padding: '0 4px' }}>
          Orbit {info.version} · Electron {info.electron} · Chromium {info.chrome} · Node {info.node} · SQLite{' '}
          {info.sqlite}
        </p>
      ) : null}
    </div>
  )
}

// -- About -------------------------------------------------------------------

function AboutSection(): ReactNode {
  const { info, vault } = useApp()
  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="card">
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <OrbitMark size={54} title="Orbit" />
            <div>
              <h2 style={{ fontSize: 18 }}>Orbit {info?.version ?? ''}</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Life orbits around it.</p>
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7, maxWidth: '70ch' }}>
            Orbit connects everything you own, owe, plan, pay for, care for and need to remember. Its point is not the
            individual lists — plenty of applications keep a list — but the connections between them: a car that shows
            its insurance, its MOT, its service history and its running costs on one screen, or a return that is not
            marked refunded until the money has actually arrived.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Honest limitations</h2>
        </div>
        <div className="card-body">
          <ul style={{ display: 'grid', gap: 9, fontSize: 12.5, lineHeight: 1.6 }}>
            <li>
              • <b>Reminders need Orbit running.</b> There is no background service, so a reminder for Tuesday is seen
              when you next open the application.
            </li>
            <li>
              • <b>No bank connections.</b> Transactions are entered by you or imported from a file you export yourself.
            </li>
            <li>
              • <b>No parcel tracking integration.</b> Parcel status is whatever you set it to.
            </li>
            <li>
              • <b>No OCR.</b> Orbit indexes the text of plain-text and CSV attachments. It does not read the text inside
              a PDF or a photograph, and does not claim to.
            </li>
            <li>
              • <b>The vault is not encrypted.</b> Use full-disk encryption; see Privacy &amp; security.
            </li>
            <li>
              • <b>One computer at a time.</b> Copy the vault between machines; do not open the same one from two at
              once, and do not keep it in a folder a sync client is actively watching while Orbit is running.
            </li>
            <li>
              • <b>Payroll figures are estimates.</b> They use published UK rates for the stated tax year. Your payslip
              is the authority.
            </li>
          </ul>
        </div>
      </div>

      {vault?.distributionDirectory ? (
        <p className="help" style={{ padding: '0 4px', overflowWrap: 'anywhere' }}>
          Running from {vault.distributionDirectory}
          {vault.portable ? ` · portable vault convention found at ${vault.portable.path}` : ''}
        </p>
      ) : null}
    </div>
  )
}
