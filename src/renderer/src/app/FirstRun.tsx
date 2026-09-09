import { useEffect, useState, type ReactNode } from 'react'
import type { RecentVaultEntry, VaultOpenError } from '@shared/vault.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate } from '../lib/format.js'
import { Icon } from '../components/Icon.js'
import { OrbitMark } from '../components/Brand.js'
import { Modal, Notice, useConfirm } from '../components/ui.js'

/**
 * The first thing anyone sees.
 *
 * Three doors, exactly as the specification asks: make a new vault, open an
 * existing one, or have a look round a demonstration vault that is kept
 * entirely separate from real data.
 *
 * The important thing this screen does is tell the truth about where the data
 * will live. People are rightly suspicious of an application that asks for
 * their passport and their bank statements, so the answer — "a folder you
 * choose, on this computer, and nowhere else" — is on the screen rather than
 * buried in a settings page.
 */

interface OpenResponse {
  opened: boolean
  path?: string
  error?: VaultOpenError
  lockHolder?: { deviceLabel: string; since: string } | null
  lockStale?: boolean
  migrated?: { from: number; to: number; backup: string | null } | null
  demoSeedFailed?: boolean
}

export function FirstRun(): ReactNode {
  const { vault, refreshVault, toast, format, info } = useApp()
  const { confirm, dialog } = useConfirm()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<VaultOpenError | null>(null)
  const [lockPrompt, setLockPrompt] = useState<{ path: string; holder: string; stale: boolean } | null>(null)
  const [naming, setNaming] = useState<{ path: string } | null>(null)
  const [vaultName, setVaultName] = useState('My Orbit vault')
  const [showAllRecents, setShowAllRecents] = useState(false)

  const allRecents = vault?.recents ?? []
  const portable = vault?.portable ?? null

  // Vaults Orbit can still find come first. A column of "Missing" rows above
  // the thing you actually came here to do is a poor greeting, and a vault on
  // an unplugged drive is not urgent — it is just not here today.
  const missing = allRecents.filter((entry) => !entry.available)
  const present = allRecents.filter((entry) => entry.available)
  // A long tail of vaults on drives that are not plugged in is worth keeping —
  // people do come back to them — but not worth pushing the three things you
  // came here to do below the fold.
  const hiddenMissing = showAllRecents ? 0 : Math.max(0, missing.length - 3)
  const recents = [...present, ...(showAllRecents ? missing : missing.slice(0, 3))]

  const handleResult = async (result: OpenResponse, context: string): Promise<void> => {
    if (result.opened) {
      if (result.migrated) {
        toast({
          tone: 'good',
          title: 'Vault upgraded',
          detail: `Updated from format ${result.migrated.from} to ${result.migrated.to}. A backup was taken first.`
        })
      }
      if (result.demoSeedFailed) {
        toast({ tone: 'bad', title: 'The demonstration data could not be added', detail: 'The vault itself is fine.' })
      }
      await refreshVault()
      return
    }
    if (result.error?.code === 'locked-by-another-instance' && result.lockHolder) {
      setLockPrompt({
        path: context,
        holder: result.lockHolder.deviceLabel,
        stale: Boolean(result.lockStale)
      })
      return
    }
    setError(result.error ?? { code: 'unknown', message: 'That did not work.', remedy: 'Try again.' })
  }

  const openPath = async (path: string, takeOver = false): Promise<void> => {
    setBusy(path)
    setError(null)
    const result = await call<OpenResponse>('vault.open', { path, ...(takeOver ? { takeOver: true } : {}) })
    setBusy('')
    if (!result.ok) {
      setError({ code: 'unknown', message: result.error, remedy: 'Try again, or choose a different folder.' })
      return
    }
    await handleResult(result.data, path)
  }

  const chooseAndOpen = async (): Promise<void> => {
    setBusy('open')
    setError(null)
    const chosen = await call<{ cancelled: boolean; path?: string; isVault?: boolean; writable?: boolean; writableReason?: string }>(
      'vault.chooseFolder',
      { mode: 'open' }
    )
    setBusy('')
    if (!chosen.ok || chosen.data.cancelled || !chosen.data.path) return
    if (!chosen.data.isVault) {
      setError({
        code: 'not-a-vault',
        message: 'That folder is not an Orbit vault.',
        remedy: 'An Orbit vault contains a file called orbit-vault.json. Pick the vault folder itself, not the folder above it.'
      })
      return
    }
    await openPath(chosen.data.path)
  }

  const chooseAndCreate = async (): Promise<void> => {
    setBusy('create')
    setError(null)
    const chosen = await call<{ cancelled: boolean; path?: string; isVault?: boolean; writable?: boolean; writableReason?: string }>(
      'vault.chooseFolder',
      { mode: 'create' }
    )
    setBusy('')
    if (!chosen.ok || chosen.data.cancelled || !chosen.data.path) return
    if (chosen.data.isVault) {
      const ok = await confirm({
        title: 'There is already a vault there',
        message: 'That folder already contains an Orbit vault. Would you like to open it instead?',
        confirmLabel: 'Open it'
      })
      if (ok) await openPath(chosen.data.path)
      return
    }
    if (chosen.data.writable === false) {
      setError({
        code: 'not-writable',
        message: 'Orbit cannot write to that folder.',
        remedy: chosen.data.writableReason ?? 'Choose somewhere you can write to.'
      })
      return
    }
    setNaming({ path: chosen.data.path })
  }

  const createVault = async (): Promise<void> => {
    if (!naming) return
    setBusy('create')
    const result = await call<OpenResponse>('vault.create', { path: naming.path, name: vaultName.trim() })
    setBusy('')
    setNaming(null)
    if (!result.ok) {
      setError({ code: 'unknown', message: result.error, remedy: 'Try a different folder.' })
      return
    }
    await handleResult(result.data, naming.path)
  }

  const openDemo = async (): Promise<void> => {
    setBusy('demo')
    setError(null)
    const result = await call<OpenResponse>('vault.createDemo', {})
    setBusy('')
    if (!result.ok) {
      setError({ code: 'unknown', message: result.error, remedy: 'Try again.' })
      return
    }
    await handleResult(result.data, 'demo')
  }

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'radial-gradient(circle at 50% -10%, color-mix(in srgb, var(--accent) 12%, var(--bg)) 0%, var(--bg) 55%)'
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px 72px' }}>
        <header style={{ textAlign: 'center', marginBottom: 34 }}>
          <div style={{ margin: '0 auto 14px', lineHeight: 0 }}>
            <OrbitMark size={96} />
          </div>
          <h1 style={{ fontSize: 26, letterSpacing: '0.24em', textIndent: '0.24em', fontWeight: 650 }}>ORBIT</h1>
          <p style={{ marginTop: 7, color: 'var(--muted)', fontSize: 14 }}>Life orbits around it.</p>
        </header>

        <div className="card" style={{ padding: 20, marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>Where your information lives</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.65 }}>
            Orbit keeps everything in a single folder you choose, called a vault. There is no account, no cloud and no
            sign-in. Copy that folder to another computer — Windows or Mac — and open it there, and everything comes with
            it, attachments and all.
          </p>
          <p style={{ marginTop: 9, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.65 }}>
            Orbit makes no network requests whatsoever
            {info ? ` (version ${info.version}, ${info.platform}/${info.arch})` : ''}.
          </p>
        </div>

        {error ? (
          <div style={{ marginBottom: 18 }}>
            <Notice tone="bad" title={error.message}>
              {error.remedy}
              {error.detail ? (
                <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.85 }}>{error.detail}</div>
              ) : null}
            </Notice>
          </div>
        ) : null}

        {portable?.exists ? (
          <div className="card" style={{ padding: 16, marginBottom: 14, borderColor: 'var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: 'var(--accent)' }}>
                <Icon name="folder" size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 13.5 }}>A vault was found beside the application</b>
                <small style={{ color: 'var(--muted)', fontSize: 12, overflowWrap: 'anywhere' }}>
                  {portable.path} — {portable.reason}
                </small>
              </div>
              <button className="btn primary" disabled={Boolean(busy)} onClick={() => void openPath(portable.path)}>
                Open it
              </button>
            </div>
          </div>
        ) : null}

        {recents.length > 0 ? (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <div>
                <h2>Recent vaults</h2>
                {missing.length > 0 ? (
                  <p className="sub">
                    {missing.length} of these {missing.length === 1 ? 'is' : 'are'} not where Orbit last saw{' '}
                    {missing.length === 1 ? 'it' : 'them'}
                  </p>
                ) : null}
              </div>
              {missing.length > 1 ? (
                <button
                  className="btn small"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void (async () => {
                      // Forgetting a vault removes it from this list only. The
                      // folder, wherever it is, is not touched.
                      for (const entry of missing) await call('vault.forget', { path: entry.path })
                      await refreshVault()
                    })()
                  }}
                >
                  Forget the missing ones
                </button>
              ) : null}
            </div>
            <ul>
              {recents.map((entry) => (
                <RecentRow
                  key={entry.path}
                  entry={entry}
                  busy={busy === entry.path}
                  disabled={Boolean(busy)}
                  locale={format.locale}
                  onOpen={() => void openPath(entry.path)}
                  onForget={() => {
                    void (async () => {
                      await call('vault.forget', { path: entry.path })
                      await refreshVault()
                    })()
                  }}
                />
              ))}
            </ul>
            {hiddenMissing > 0 ? (
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
                <button className="btn small ghost" onClick={() => setShowAllRecents(true)}>
                  Show {hiddenMissing} more Orbit cannot find
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid three">
          <Choice
            icon="plus"
            title="Create a new vault"
            body="Choose an empty folder. Orbit sets it up and everything you add goes there."
            action="Choose a folder"
            busy={busy === 'create'}
            disabled={Boolean(busy)}
            onClick={() => void chooseAndCreate()}
            primary
          />
          <Choice
            icon="folder"
            title="Open an existing vault"
            body="Point Orbit at a vault folder — including one you have just copied from another computer."
            action="Find my vault"
            busy={busy === 'open'}
            disabled={Boolean(busy)}
            onClick={() => void chooseAndOpen()}
          />
          <Choice
            icon="star"
            title="Have a look round"
            body="A separate demonstration vault filled with invented records. It never touches your real data."
            action="Open the demo"
            busy={busy === 'demo'}
            disabled={Boolean(busy)}
            onClick={() => void openDemo()}
          />
        </div>
      </div>

      {naming ? (
        <Modal
          title="Name this vault"
          subtitle={naming.path}
          onClose={() => setNaming(null)}
          footer={
            <>
              <button className="btn" onClick={() => setNaming(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void createVault()} disabled={busy === 'create'}>
                {busy === 'create' ? 'Creating…' : 'Create the vault'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="vault-name">What would you like to call it?</label>
            <input
              id="vault-name"
              type="text"
              value={vaultName}
              onChange={(event) => setVaultName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createVault()
              }}
            />
            <span className="help">
              Only a label inside Orbit. The folder keeps whatever name you gave it, and you can rename either later.
            </span>
          </div>
        </Modal>
      ) : null}

      {lockPrompt ? (
        <Modal
          title="This vault is open somewhere else"
          onClose={() => setLockPrompt(null)}
          footer={
            <>
              <button className="btn" onClick={() => setLockPrompt(null)}>
                Cancel
              </button>
              {lockPrompt.stale ? (
                <button
                  className="btn danger"
                  onClick={() => {
                    const path = lockPrompt.path
                    setLockPrompt(null)
                    void openPath(path, true)
                  }}
                >
                  I am certain — open it anyway
                </button>
              ) : null}
            </>
          }
        >
          <Notice tone="warn" title={`It appears to be open on ${lockPrompt.holder}.`}>
            {lockPrompt.stale
              ? 'That computer has not checked in for a while, so it may have crashed. If Orbit really is still running there, opening the vault here as well can corrupt it. Close it there first if you possibly can.'
              : 'Close it there first. Two copies of Orbit writing to one vault at the same time can corrupt it — this is especially likely on a network drive or a folder that Dropbox, OneDrive or iCloud Drive is syncing.'}
          </Notice>
        </Modal>
      ) : null}

      {dialog}
    </div>
  )
}

function Choice({
  icon,
  title,
  body,
  action,
  onClick,
  busy,
  disabled,
  primary
}: {
  icon: 'plus' | 'folder' | 'star'
  title: string
  body: string
  action: string
  onClick: () => void
  busy: boolean
  disabled: boolean
  primary?: boolean
}): ReactNode {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          borderRadius: 11,
          background: 'var(--accent-soft)',
          color: 'var(--accent)'
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      <h3 style={{ fontSize: 14 }}>{title}</h3>
      <p style={{ flex: 1, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>{body}</p>
      <button className={`btn${primary ? ' primary' : ''}`} onClick={onClick} disabled={disabled}>
        {busy ? 'Working…' : action}
      </button>
    </div>
  )
}

function RecentRow({
  entry,
  onOpen,
  onForget,
  busy,
  disabled,
  locale
}: {
  entry: RecentVaultEntry
  onOpen: () => void
  onForget: () => void
  busy: boolean
  disabled: boolean
  locale: string
}): ReactNode {
  const [showPath, setShowPath] = useState(false)
  useEffect(() => setShowPath(false), [entry.path])

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 16px',
        borderBottom: '1px solid var(--line)'
      }}
    >
      <span style={{ color: entry.available ? 'var(--accent)' : 'var(--muted-2)' }}>
        <Icon name={entry.available ? 'folder' : 'alert'} size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 13, fontWeight: 570 }}>
          {entry.name}
          {entry.isDemo ? (
            <span className="chip warn" style={{ marginLeft: 8 }}>
              Demo
            </span>
          ) : null}
        </b>
        <button
          onClick={() => setShowPath((v) => !v)}
          style={{
            color: 'var(--muted)',
            fontSize: 11.5,
            textAlign: 'left',
            overflowWrap: 'anywhere',
            padding: 0
          }}
          title="Show or hide the full path"
        >
          {entry.available
            ? showPath
              ? entry.path
              : `Last opened ${entry.lastOpenedAt ? fmtDate(entry.lastOpenedAt.slice(0, 10), { locale, currency: 'GBP', dateFormat: 'auto', weekStartsOn: 1 }) : 'recently'} · show location`
            : 'That folder is no longer there — it may be on a drive that is disconnected'}
        </button>
      </div>
      {entry.available ? (
        <button className="btn small" onClick={onOpen} disabled={disabled}>
          {busy ? 'Opening…' : 'Open'}
        </button>
      ) : (
        <span className="chip warn">Missing</span>
      )}
      <button className="btn small ghost" onClick={onForget} aria-label={`Forget ${entry.name}`} title="Remove from this list">
        <Icon name="close" size={13} />
      </button>
    </li>
  )
}
