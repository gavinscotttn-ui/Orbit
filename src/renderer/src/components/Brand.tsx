import type { ReactNode } from 'react'

/**
 * The Orbit mark.
 *
 * A solid letter O — the first letter of the wordmark, not a picture of
 * anything — with a single body orbiting it, punched cleanly out of the ring.
 *
 * Three shapes were tried and rejected by looking at them at the size they
 * actually have to work, which is 18px in the sidebar:
 *
 *   a ringed planet   reads as the emoji, and is mush below about 32px
 *   a broken ring     reads as a loading spinner, at every size
 *   a tilted ellipse  reads as an eye, which is a poor thing for an
 *                     application whose main promise is privacy
 *
 * The notch around the body is a real hole in the geometry rather than a
 * stroke painted in the background colour, so the mark composites correctly on
 * any surface — a sidebar, a tinted panel, a printed page — rather than only on the
 * one background it was drawn against.
 *
 * It is flat on purpose. Gloss, bevels and chrome gradients are what make a
 * mark read as an emoji; the form has to carry it.
 *
 * Mask ids are per instance: two marks on one page sharing an id would make
 * the second borrow the first one's hole.
 */

const OUTER = 50
const INNER = 31
const BODY = 18
const CLEAR = 8
const ANGLE = 45

const rad = (ANGLE * Math.PI) / 180
const BX = Number((64 + OUTER * Math.sin(rad)).toFixed(2))
const BY = Number((64 - OUTER * Math.cos(rad)).toFixed(2))

/** A ring drawn as two half-arcs; one arc returning to its own start is undefined. */
const ring = (r: number): string =>
  `M ${64 - r} 64 A ${r} ${r} 0 1 0 ${64 + r} 64 A ${r} ${r} 0 1 0 ${64 - r} 64 Z`

let seq = 0

export function OrbitMark({
  size = 24,
  tone = 'auto',
  mono = false,
  title
}: {
  size?: number
  /** 'auto' follows the theme; 'light' is drawn for a dark ground, 'dark' for a pale one. */
  tone?: 'auto' | 'light' | 'dark'
  /** One colour throughout, for places that cannot carry the accent. */
  mono?: boolean
  title?: string
}): ReactNode {
  const maskId = `orbit-mark-${++seq}`
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={`orbit-mark tone-${tone}${mono ? ' mono' : ''}`}
      role={title ? 'img' : 'presentation'}
      {...(title ? { 'aria-label': title } : { 'aria-hidden': true })}
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
        <rect width="128" height="128" fill="#fff" />
        <circle cx={BX} cy={BY} r={BODY + CLEAR} fill="#000" />
      </mask>
      <path
        mask={`url(#${maskId})`}
        fillRule="evenodd"
        fill="var(--mark-ink)"
        d={`${ring(OUTER)} ${ring(INNER)}`}
      />
      <circle cx={BX} cy={BY} r={BODY} fill="var(--mark-body)" />
    </svg>
  )
}

/**
 * Mark plus wordmark.
 *
 * The word is tracked wide — that spacing is the wordmark's whole character —
 * and set flat in a single colour. The gradient it used to carry was the same
 * mistake as the gloss on the old mark.
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
      <OrbitMark size={size * 1.5} tone={tone} title="Orbit" />
      <span className="lockup-text">
        <b style={{ fontSize: size }}>ORBIT</b>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </span>
  )
}
