import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from './state.js'
import { callOr, onEvent } from '../lib/api.js'
import { Icon, type IconName } from '../components/Icon.js'
import { Toasts } from '../components/ui.js'
import { FirstRun } from './FirstRun.js'
import { CommandPalette } from './CommandPalette.js'
import { SearchPanel } from './SearchPanel.js'
import { RecordDetail } from '../components/RecordDetail.js'
import { QuickCapture } from '../modules/QuickCapture.js'
import { TodayPage } from '../modules/Today.js'
import { PlanPage } from '../modules/Plan.js'
import { MoneyPage } from '../modules/Money.js'
import { LifePage } from '../modules/Life.js'
import { InboxPage } from '../modules/Inbox.js'
import { SettingsPage } from '../modules/Settings.js'

/**
 * The shell.
 *
 * Five places, exactly as the specification asks: Today, Plan, Money, Life and
 * Inbox, with search, quick capture and settings always reachable. Navigation
 * is state rather than a router, because a desktop application has no address
 * bar and no back button to honour — and one fewer dependency is one fewer
 * thing to keep patched.
 */

export type Route =
  | { page: 'today' }
  | { page: 'plan'; view?: string }
  | { page: 'money'; view?: string }
  | { page: 'life'; module?: string; type?: string; filter?: Record<string, string>; title?: string }
  | { page: 'inbox' }
  | { page: 'settings'; section?: string }

export interface Navigator {
  go: (route: Route) => void
  openRecord: (type: string, id: string) => void
  route: Route
}

export function App(): ReactNode {
  const { ready, vault, settings, saveState, saveError, toast } = useApp()
  const [route, setRoute] = useState<Route>({ page: 'today' })
  const [palette, setPalette] = useState(false)
  const [search, setSearch] = useState(false)
  const [capture, setCapture] = useState(false)
  const [detail, setDetail] = useState<{ type: string; id: string } | null>(null)

  const go = useCallback((next: Route) => {
    setRoute(next)
    setPalette(false)
    setSearch(false)
    // Return the scroll position to the top of the new page.
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }, [])

  const openRecord = useCallback((type: string, id: string) => {
    setDetail({ type, id })
    setPalette(false)
    setSearch(false)
  }, [])

  const nav = useMemo<Navigator>(() => ({ go, openRecord, route }), [go, openRecord, route])

  // Keyboard shortcuts. Deliberately few, and the ones people already know.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      const target = event.target as HTMLElement | null
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (meta && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearch(true)
        return
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setCapture(true)
        return
      }
      if (event.key === '/' && !typing && !meta) {
        event.preventDefault()
        setSearch(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Menu items in the main process send commands through this event.
  useEffect(() => {
    return onEvent('background.tick', (payload) => {
      const command = typeof payload === 'object' && payload && 'command' in payload ? String((payload as { command: unknown }).command) : ''
      if (command === 'palette') setPalette(true)
      else if (command === 'search') setSearch(true)
      else if (command === 'quick-capture') setCapture(true)
      else if (command === 'close-vault') go({ page: 'settings', section: 'vault' })
      else if (command === 'show-vault-location') {
        toast({
          tone: 'info',
          title: 'Your vault',
          detail: vault?.path ?? 'No vault is open at the moment.'
        })
      }
    })
  }, [go, toast, vault?.path])

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
        <div style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
          <Icon name="orbit" size={34} strokeWidth={1.4} />
          <span>Starting Orbit…</span>
        </div>
      </div>
    )
  }

  if (!vault?.open) {
    return (
      <>
        <FirstRun />
        <Toasts />
      </>
    )
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>

      <Sidebar nav={nav} onOpenSettings={() => go({ page: 'settings' })} />

      <section className="workspace">
        <header className="topbar">
          <button className="searchbox" onClick={() => setSearch(true)} aria-label="Search everything">
            <Icon name="search" size={15} />
            <span>Search everything…</span>
            <kbd>{navigatorIsMac() ? '⌘' : 'Ctrl'} F</kbd>
          </button>
          <div className="spacer" />
          <SaveIndicator state={saveState} error={saveError} />
          <div className="top-actions">
            <button className="btn small" onClick={() => setCapture(true)}>
              <Icon name="plus" size={14} />
              Capture
            </button>
            <button className="btn icon ghost" onClick={() => setPalette(true)} aria-label="Command palette" title={`${navigatorIsMac() ? '⌘' : 'Ctrl'} K`}>
              <Icon name="grid" size={16} />
            </button>
            <button
              className="btn icon ghost"
              onClick={() => go({ page: 'settings' })}
              aria-label="Settings"
              aria-current={route.page === 'settings' ? 'page' : undefined}
            >
              <Icon name="settings" size={16} />
            </button>
          </div>
        </header>

        {vault.manifest?.isDemo ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 20px',
              background: 'var(--warn-soft)',
              color: 'var(--warn)',
              borderBottom: '1px solid color-mix(in srgb, var(--warn) 26%, transparent)',
              fontSize: 12,
              fontWeight: 560
            }}
            role="status"
          >
            <Icon name="info" size={14} />
            This is the demonstration vault. Everything in it is invented, and it is kept entirely separate from your
            real records.
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => go({ page: 'settings', section: 'vault' })}>
              Switch to my own vault
            </button>
          </div>
        ) : null}

        <main className="content" id="main" tabIndex={-1}>
          <div className="content-inner">
            {route.page === 'today' ? (
              <TodayPage nav={nav} />
            ) : route.page === 'plan' ? (
              <PlanPage nav={nav} />
            ) : route.page === 'money' ? (
              <MoneyPage nav={nav} />
            ) : route.page === 'life' ? (
              <LifePage nav={nav} />
            ) : route.page === 'inbox' ? (
              <InboxPage nav={nav} />
            ) : (
              <SettingsPage nav={nav} />
            )}
          </div>
        </main>
      </section>

      {palette ? <CommandPalette nav={nav} onClose={() => setPalette(false)} onCapture={() => setCapture(true)} /> : null}
      {search ? <SearchPanel onClose={() => setSearch(false)} onOpen={openRecord} /> : null}
      {capture ? <QuickCapture onClose={() => setCapture(false)} /> : null}
      {detail ? (
        <RecordDetail
          type={detail.type}
          id={detail.id}
          onClose={() => setDetail(null)}
          onNavigate={(type, id) => setDetail({ type, id })}
        />
      ) : null}

      <Toasts />
      {settings?.lowClutter ? null : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Sidebar({ nav, onOpenSettings }: { nav: Navigator; onOpenSettings: () => void }): ReactNode {
  const { vault, settings, entities } = useApp()
  const [counts, setCounts] = useState<{ inbox: number; attention: number }>({ inbox: 0, attention: 0 })
  const { revision } = useApp()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const brief = await callOr<{ counts: { overdue: number; today: number; inbox: number } }>(
        'today.brief',
        { horizonDays: 14 },
        { counts: { overdue: 0, today: 0, inbox: 0 } }
      )
      if (cancelled) return
      setCounts({ inbox: brief.counts.inbox, attention: brief.counts.overdue + brief.counts.today })
    })()
    return () => {
      cancelled = true
    }
  }, [revision])

  const modules = settings?.modules ?? []
  const moduleLinks = useMemo(() => {
    const labels: Record<string, { label: string; icon: IconName }> = {
      home: { label: 'Home', icon: 'home' },
      vehicles: { label: 'Vehicles', icon: 'car' },
      health: { label: 'Health', icon: 'heart' },
      family: { label: 'Family', icon: 'people' },
      pets: { label: 'Pets', icon: 'paw' },
      food: { label: 'Food', icon: 'basket' },
      travel: { label: 'Travel', icon: 'plane' },
      work: { label: 'Work', icon: 'briefcase' },
      relationships: { label: 'Relationships', icon: 'gift' },
      goals: { label: 'Goals', icon: 'flag' },
      digital: { label: 'Digital', icon: 'laptop' }
    }
    return modules.map((key) => ({ key, ...(labels[key] ?? { label: key, icon: 'grid' as IconName }) }))
  }, [modules])

  const current = nav.route

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">
          <Icon name="orbit" size={18} strokeWidth={1.6} />
        </span>
        <span className="name">
          <b>ORBIT</b>
          <small>{vault?.manifest?.name ?? 'Vault'}</small>
        </span>
      </div>

      <nav className="nav" aria-label="Main">
        <NavButton
          icon="today"
          label="Today"
          active={current.page === 'today'}
          onClick={() => nav.go({ page: 'today' })}
          {...(counts.attention > 0 ? { count: counts.attention, alert: true } : {})}
        />
        <NavButton icon="plan" label="Plan" active={current.page === 'plan'} onClick={() => nav.go({ page: 'plan' })} />
        <NavButton icon="money" label="Money" active={current.page === 'money'} onClick={() => nav.go({ page: 'money' })} />
        <NavButton
          icon="inbox"
          label="Inbox"
          active={current.page === 'inbox'}
          onClick={() => nav.go({ page: 'inbox' })}
          {...(counts.inbox > 0 ? { count: counts.inbox } : {})}
        />

        <div className="nav-title">Life</div>
        <NavButton
          icon="life"
          label="Everything"
          active={current.page === 'life' && !current.module}
          onClick={() => nav.go({ page: 'life' })}
        />
        {moduleLinks.map((item) => (
          <NavButton
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={current.page === 'life' && current.module === item.key}
            onClick={() => nav.go({ page: 'life', module: item.key })}
          />
        ))}
        {moduleLinks.length === 0 ? (
          <button className="nav-title" style={{ textAlign: 'left' }} onClick={() => nav.go({ page: 'settings', section: 'modules' })}>
            Choose your areas →
          </button>
        ) : null}

        <div className="nav-title">Records</div>
        <NavButton
          icon="people"
          label="People"
          active={current.page === 'life' && current.type === 'person'}
          onClick={() => nav.go({ page: 'life', type: 'person' })}
        />
        <NavButton
          icon="document"
          label="Documents"
          active={current.page === 'life' && current.type === 'document'}
          onClick={() => nav.go({ page: 'life', type: 'document' })}
        />
        <NavButton
          icon="shield"
          label="Insurance"
          active={current.page === 'life' && current.type === 'policy'}
          onClick={() => nav.go({ page: 'life', type: 'policy' })}
        />
        <NavButton
          icon="bag"
          label="Purchases"
          active={current.page === 'life' && current.type === 'purchase'}
          onClick={() => nav.go({ page: 'life', type: 'purchase' })}
        />
        {entities.length === 0 ? null : null}
      </nav>

      <button className="vault-badge" onClick={onOpenSettings}>
        <Icon name="lock" size={15} />
        <span className="body">
          <b>{vault?.manifest?.name ?? 'Vault'}</b>
          <small>{vault?.folderName ?? ''}</small>
        </span>
        {vault?.manifest?.isDemo ? <span className="demo-flag">Demo</span> : null}
      </button>
    </aside>
  )
}

function NavButton({
  icon,
  label,
  active,
  onClick,
  count,
  alert
}: {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
  count?: number
  alert?: boolean
}): ReactNode {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="ico">
        <Icon name={icon} size={16} />
      </span>
      <span className="label">{label}</span>
      {count ? <span className={`count${alert ? ' alert' : ''}`}>{count > 99 ? '99+' : count}</span> : null}
    </button>
  )
}

function SaveIndicator({ state, error }: { state: string; error: string }): ReactNode {
  if (state === 'idle') return null
  return (
    <div className={`save-state ${state}`} role="status" aria-live="polite">
      {state === 'saving' ? (
        <>
          <Icon name="clock" size={13} />
          Saving…
        </>
      ) : state === 'saved' ? (
        <>
          <Icon name="check" size={13} />
          Saved
        </>
      ) : (
        <>
          <Icon name="alert" size={13} />
          {error || 'Not saved'}
        </>
      )}
    </div>
  )
}

export function navigatorIsMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
}
