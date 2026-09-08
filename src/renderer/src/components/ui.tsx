import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon.js'
import { useApp } from '../app/state.js'

/**
 * The shared interface pieces.
 *
 * Each one takes accessibility seriously rather than as an afterthought:
 * dialogs trap focus and restore it on close, destructive actions require a
 * deliberate confirmation, and every state a screen can be in — loading, empty,
 * failed — has a real component rather than a blank area.
 */

// -- Modal -------------------------------------------------------------------

export interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Prevents closing on Escape or backdrop click while a save is in flight. */
  busy?: boolean
}

export function Modal({ title, subtitle, onClose, children, footer, wide, busy }: ModalProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const node = panel.current
    // Focus the first sensible control, or the panel itself.
    const focusable = node?.querySelector<HTMLElement>(
      'input:not([type=hidden]), textarea, select, button:not([data-skip-autofocus])'
    )
    ;(focusable ?? node)?.focus()
    return () => previouslyFocused.current?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab inside the dialog.
      const node = panel.current
      if (!node) return
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0] as HTMLElement
      const last = items[items.length - 1] as HTMLElement
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="sub">{subtitle}</p> : null}
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close" disabled={busy} data-skip-autofocus>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

// -- Confirmation ------------------------------------------------------------

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'normal' | 'danger'
  /** Typing this word is required. Reserved for genuinely irreversible things. */
  requireWord?: string
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  dialog: ReactNode
} {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)
  const [typed, setTyped] = useState('')

  const confirm = useCallback((options: ConfirmOptions) => {
    setTyped('')
    return new Promise<boolean>((resolve) => setPending({ options, resolve }))
  }, [])

  const close = (result: boolean): void => {
    pending?.resolve(result)
    setPending(null)
  }

  const dialog = pending ? (
    <Modal
      title={pending.options.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            {pending.options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn ${pending.options.tone === 'danger' ? 'danger' : 'primary'}`}
            onClick={() => close(true)}
            disabled={Boolean(pending.options.requireWord) && typed.trim() !== pending.options.requireWord}
          >
            {pending.options.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14, fontSize: 13.5, lineHeight: 1.6 }}>
        <div>{pending.options.message}</div>
        {pending.options.requireWord ? (
          <div className="field">
            <label htmlFor="confirm-word">
              Type <b>{pending.options.requireWord}</b> to confirm
            </label>
            <input
              id="confirm-word"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  ) : null

  return { confirm, dialog }
}

// -- States ------------------------------------------------------------------

export function EmptyState({
  icon = 'grid',
  title,
  message,
  action
}: {
  icon?: IconName
  title: string
  message?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      <div className="glyph">
        <Icon name={icon} size={20} />
      </div>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  )
}

export function Loading({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }): ReactNode {
  return (
    <div style={{ display: 'grid', gap: 9, padding: 4 }} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: index === 0 ? 22 : 15, width: index === 0 ? '46%' : '100%' }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="notice bad">
      <Icon name="alert" size={17} />
      <div className="body">
        <strong>Something went wrong</strong>
        {message}
        {onRetry ? (
          <div style={{ marginTop: 9 }}>
            <button className="btn small" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
  icon
}: {
  tone?: 'info' | 'good' | 'warn' | 'bad'
  title?: string
  children: ReactNode
  icon?: IconName
}): ReactNode {
  const fallback: Record<string, IconName> = { info: 'info', good: 'check', warn: 'alert', bad: 'alert' }
  return (
    <div className={`notice ${tone}`}>
      <Icon name={icon ?? fallback[tone] ?? 'info'} size={16} />
      <div className="body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  )
}

// -- Toasts ------------------------------------------------------------------

export function Toasts(): ReactNode {
  const { toasts, dismissToast } = useApp()
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <span className="ico">
            <Icon name={toast.tone === 'bad' ? 'alert' : toast.tone === 'good' ? 'check' : 'info'} size={16} />
          </span>
          <div className="body">
            <b>{toast.title}</b>
            {toast.detail ? <span>{toast.detail}</span> : null}
            {toast.action ? (
              <div style={{ marginTop: 7 }}>
                <button
                  className="btn small"
                  onClick={() => {
                    toast.action?.run()
                    dismissToast(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              </div>
            ) : null}
          </div>
          <button className="btn icon ghost small" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// -- Small pieces ------------------------------------------------------------

export function Chip({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'
  children: ReactNode
}): ReactNode {
  return <span className={`chip${tone === 'neutral' ? '' : ' ' + tone}`}>{children}</span>
}

export function StatCard({
  label,
  value,
  detail,
  tone,
  onClick
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'good' | 'warn' | 'bad' | 'info'
  onClick?: () => void
}): ReactNode {
  const body = (
    <>
      <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        className="num"
        style={{
          marginTop: 6,
          fontSize: 23,
          fontWeight: 660,
          letterSpacing: '-0.02em',
          color: tone ? `var(--${tone})` : 'var(--ink)'
        }}
      >
        {value}
      </div>
      {detail ? <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>{detail}</div> : null}
    </>
  )
  if (onClick) {
    return (
      <button className="card" style={{ padding: '15px 16px', textAlign: 'left', width: '100%' }} onClick={onClick}>
        {body}
      </button>
    )
  }
  return (
    <div className="card" style={{ padding: '15px 16px' }}>
      {body}
    </div>
  )
}

/** A horizontal proportion bar. Used for budgets and progress. */
export function Meter({
  value,
  max,
  tone = 'accent',
  label
}: {
  value: number
  max: number
  tone?: 'accent' | 'good' | 'warn' | 'bad'
  label?: string
}): ReactNode {
  const ratio = max > 0 ? Math.min(1.25, Math.max(0, value / max)) : 0
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(label ? { 'aria-label': label } : {})}
      style={{ height: 7, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}
    >
      <div
        style={{
          width: `${Math.min(100, ratio * 100)}%`,
          height: '100%',
          borderRadius: 999,
          background: `var(--${tone})`,
          transition: 'width 0.3s ease'
        }}
      />
    </div>
  )
}

export function SectionHeading({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }): ReactNode {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  )
}
