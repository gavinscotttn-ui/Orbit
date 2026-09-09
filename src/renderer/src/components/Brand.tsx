import type { ReactNode } from 'react'

/**
 * The Orbit mark.
 *
 * A chrome ringed planet: the planet drawn as an annulus, the ring as a band
 * whose far edge falls into deep navy and whose near sweep catches the light.
 * It is vector, so it stays crisp at 18px in the sidebar and at 1024px as the
 * application icon, and it carries no external file — nothing to fail to load
 * in an application that refuses to make network requests.
 *
 * The gradient stops are CSS custom properties, so the mark is genuinely
 * theme-aware rather than a light-mode PNG dropped onto a dark sidebar. The
 * `tone` prop pins it when the surrounding surface does not match the theme —
 * the sidebar is dark in both themes, so the sidebar mark is always 'light'
 * (that is, drawn for a dark ground).
 *
 * Gradient ids are suffixed per instance: two marks on one page with the same
 * id would make the second borrow the first one's colours.
 */

let seq = 0

export function OrbitMark({
  size = 24,
  tone = 'auto',
  title
}: {
  size?: number
  /** 'auto' follows the theme; 'light' is drawn for a dark ground, 'dark' for a pale one. */
  tone?: 'auto' | 'light' | 'dark'
  title?: string
}): ReactNode {
  const id = `orbit-mark-${++seq}`
  const planet = `${id}-p`
  const band = `${id}-b`
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={`orbit-mark tone-${tone}`}
      role={title ? 'img' : 'presentation'}
      {...(title ? { 'aria-label': title } : { 'aria-hidden': true })}
      focusable="false"
    >
      <defs>
        <linearGradient id={planet} x1="0.15" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--mark-1)" />
          <stop offset="30%" stopColor="var(--mark-2)" />
          <stop offset="58%" stopColor="var(--mark-3)" />
          <stop offset="100%" stopColor="var(--mark-4)" />
        </linearGradient>
        <linearGradient id={band} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--mark-shadow)" />
          <stop offset="22%" stopColor="var(--mark-shadow-2)" />
          <stop offset="46%" stopColor="var(--mark-3)" />
          <stop offset="68%" stopColor="var(--mark-1)" />
          <stop offset="100%" stopColor="var(--mark-4)" />
        </linearGradient>
      </defs>
      <g transform="translate(128 128)">
        <circle r="72" fill="none" stroke={`url(#${planet})`} strokeWidth="13" />
        <g transform="rotate(-20)">
          <ellipse rx="124" ry="33" fill="none" stroke={`url(#${band})`} strokeWidth="13" />
        </g>
      </g>
    </svg>
  )
}

/**
 * Mark plus wordmark. The word is set in the interface face, tracked wide and
 * filled with the same chrome ramp as the mark, so the two read as one object.
 */
export function OrbitLockup({
  size = 22,
  subtitle,
  tone = 'auto'
}: {
  size?: number
  subtitle?: string
  tone?: 'auto' | 'light' | 'dark'
}): ReactNode {
  return (
    <span className={`orbit-lockup tone-${tone}`}>
      <OrbitMark size={size * 1.55} tone={tone} title="Orbit" />
      <span className="lockup-text">
        <b style={{ fontSize: size }}>ORBIT</b>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </span>
  )
}
