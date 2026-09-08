import type { JSX } from 'react'

/**
 * Icons drawn inline as SVG.
 *
 * Not an icon font and not an image sprite, because both would mean either a
 * network request or a binary asset. These are paths, they inherit
 * `currentColor`, and they are marked `aria-hidden` — the accessible name for
 * a control always comes from its text or its aria-label, never from the icon.
 */

export type IconName =
  | 'orbit'
  | 'today'
  | 'plan'
  | 'money'
  | 'life'
  | 'inbox'
  | 'search'
  | 'settings'
  | 'plus'
  | 'close'
  | 'check'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'alert'
  | 'clock'
  | 'calendar'
  | 'task'
  | 'bill'
  | 'document'
  | 'shield'
  | 'car'
  | 'home'
  | 'heart'
  | 'paw'
  | 'plane'
  | 'basket'
  | 'people'
  | 'gift'
  | 'laptop'
  | 'book'
  | 'star'
  | 'link'
  | 'paperclip'
  | 'download'
  | 'upload'
  | 'trash'
  | 'edit'
  | 'history'
  | 'moon'
  | 'sun'
  | 'lock'
  | 'folder'
  | 'note'
  | 'tag'
  | 'repeat'
  | 'undo'
  | 'external'
  | 'info'
  | 'spanner'
  | 'bag'
  | 'parcel'
  | 'chart'
  | 'briefcase'
  | 'flag'
  | 'grid'
  | 'filter'

const PATHS: Record<IconName, JSX.Element> = {
  orbit: (
    <>
      <circle cx="12" cy="12" r="5.2" />
      <ellipse cx="12" cy="12" rx="10.4" ry="4.2" transform="rotate(-22 12 12)" />
    </>
  ),
  today: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  plan: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
      <circle cx="12" cy="12.25" r="2.6" />
      <path d="M6 12.25h.01M18 12.25h.01" />
    </>
  ),
  life: (
    <>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />
      <path d="M12 12v8.5M20 8l-8 4-8-4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5V6.8A2.3 2.3 0 0 1 5.8 4.5h12.4a2.3 2.3 0 0 1 2.3 2.3v6.7" />
      <path d="M3.5 13.5h4l1.6 2.6h5.8l1.6-2.6h4v3.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.1 4.1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  alert: (
    <>
      <path d="M12 3.8 21 19.5H3z" />
      <path d="M12 9.5v4.2M12 16.8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.6 2.6L16 9.5" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M9.5 8.5h5M9.5 12.5h5" />
    </>
  ),
  document: (
    <>
      <path d="M13.5 3.5H7.2A2.2 2.2 0 0 0 5 5.7v12.6a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V9z" />
      <path d="M13.5 3.5V9H19" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19.5 6v6.2c0 4.4-3.1 7.4-7.5 8.6-4.4-1.2-7.5-4.2-7.5-8.6V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5h14M6.5 16.5V19H4.8v-2.5M19.2 16.5V19h-1.7v-2.5" />
      <path d="M4.2 16.5v-3.7l1.9-4.6A2 2 0 0 1 8 7h8a2 2 0 0 1 1.9 1.2l1.9 4.6v3.7z" />
      <path d="M7.5 13.2h.01M16.5 13.2h.01" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
      <path d="M9.5 20.5v-6h5v6" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6c0 5-7.5 9.4-7.5 9.4z" />,
  paw: (
    <>
      <ellipse cx="7.5" cy="9" rx="1.9" ry="2.4" />
      <ellipse cx="16.5" cy="9" rx="1.9" ry="2.4" />
      <ellipse cx="10.2" cy="5.6" rx="1.7" ry="2.1" />
      <ellipse cx="13.8" cy="5.6" rx="1.7" ry="2.1" />
      <path d="M12 12.4c2.8 0 4.8 1.9 4.8 4 0 1.7-1.3 2.8-3 2.8-.8 0-1.3-.3-1.8-.3s-1 .3-1.8.3c-1.7 0-3-1.1-3-2.8 0-2.1 2-4 4.8-4z" />
    </>
  ),
  plane: <path d="M20.5 4.5c-.8-.8-2.4-.5-3.6.7l-2.6 2.6-8-2.3-1.8 1.8 6.4 3.9-2.8 2.8-3.2-.6-1.3 1.3 3.1 1.8 1.8 3.1 1.3-1.3-.6-3.2 2.8-2.8 3.9 6.4 1.8-1.8-2.3-8 2.6-2.6c1.2-1.2 1.5-2.8.5-3.8z" />,
  basket: (
    <>
      <path d="M3.5 8.5h17l-1.6 10a2 2 0 0 1-2 1.7H7.1a2 2 0 0 1-2-1.7z" />
      <path d="m8 8.5 2-5M16 8.5l-2-5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c0-3.3 2.8-5.6 6.2-5.6s6.2 2.3 6.2 5.6" />
      <path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.6M17.5 14.8c2.2.6 3.7 2.5 3.7 5.2" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="9" width="17" height="11.5" rx="1.8" />
      <path d="M2.5 9h19v3.5h-19zM12 9v11.5" />
      <path d="M12 9S9 3.5 6.8 5.2 12 9 12 9zM12 9s3-5.5 5.2-3.8S12 9 12 9z" />
    </>
  ),
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10" rx="1.8" />
      <path d="M2.5 18.5h19" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z" />
      <path d="M17 19.5h2v-15h-2" />
    </>
  ),
  star: <path d="m12 4 2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />,
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.7-1.7" />
    </>
  ),
  paperclip: <path d="M20 11.5 12.3 19a4.7 4.7 0 0 1-6.6-6.6l8-8a3.1 3.1 0 1 1 4.4 4.4l-8 8a1.6 1.6 0 1 1-2.2-2.2l7.2-7.2" />,
  download: (
    <>
      <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17v2.2A1.3 1.3 0 0 0 5.3 20.5h13.4A1.3 1.3 0 0 0 20 19.2V17" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5v-11M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 17v2.2A1.3 1.3 0 0 0 5.3 20.5h13.4A1.3 1.3 0 0 0 20 19.2V17" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
    </>
  ),
  edit: <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 6l3 3" />,
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9L3.5 8.8" />
      <path d="M3.5 4.5v4.3h4.3M12 7.8V12l3 1.8" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
    </>
  ),
  lock: (
    <>
      <rect x="4.8" y="10.5" width="14.4" height="10" rx="2.2" />
      <path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" />
    </>
  ),
  folder: <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4l2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v8.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />,
  note: (
    <>
      <path d="M5 4.5h14v11l-4.5 4.5H5z" />
      <path d="M19 15.5h-4.5V20M8.5 9h7M8.5 12.5h5" />
    </>
  ),
  tag: (
    <>
      <path d="M3.8 11.2V4.5h6.7l9.7 9.7-6.7 6.7z" />
      <path d="M7.5 8h.01" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 9.5A4.5 4.5 0 0 1 8.5 5h11M16 2l3.5 3-3.5 3" />
      <path d="M20 14.5A4.5 4.5 0 0 1 15.5 19h-11M8 22l-3.5-3L8 16" />
    </>
  ),
  undo: (
    <>
      <path d="M3.5 8.5h7v-5" />
      <path d="M3.9 8.5A8.5 8.5 0 1 1 4.4 15" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.5H19.5v6" />
      <path d="M19.5 4.5 11 13M18 14v5.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 19.2V7.8a1.3 1.3 0 0 1 1.3-1.3H10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  spanner: <path d="M20 5.5a5 5 0 0 1-6.6 6.6L6.5 19a2.1 2.1 0 0 1-3-3l6.9-6.9A5 5 0 0 1 17 2.5l-3 3 1.5 1.5 1.5 1.5z" />,
  bag: (
    <>
      <path d="M4.5 7.5h15l-1.2 12a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z" />
      <path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10" />
    </>
  ),
  parcel: (
    <>
      <path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4z" />
      <path d="M3.5 8 12 12l8.5-4M12 12v8" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M8.5 7.5V5.8A1.8 1.8 0 0 1 10.3 4h3.4a1.8 1.8 0 0 1 1.8 1.8v1.7M3 12.5h18" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4M5.5 5h12l-2.2 4L17.5 13h-12" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  filter: <path d="M3.5 5.5h17l-6.5 7.5V19l-4 1.5v-7.5z" />
}

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 17, strokeWidth = 1.7, className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(className ? { className } : {})}
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  )
}

/** Maps an entity descriptor's icon name to one that exists here. */
export function iconForEntity(name: string): IconName {
  const map: Record<string, IconName> = {
    person: 'people',
    note: 'note',
    document: 'document',
    shield: 'shield',
    claim: 'shield',
    mail: 'note',
    tracker: 'grid',
    task: 'task',
    project: 'flag',
    calendar: 'calendar',
    bell: 'clock',
    repeat: 'repeat',
    account: 'money',
    tag: 'tag',
    transaction: 'money',
    budget: 'chart',
    bill: 'bill',
    handshake: 'people',
    piggy: 'money',
    chart: 'chart',
    receipt: 'bill',
    star: 'star',
    'gift-card': 'gift',
    box: 'home',
    spanner: 'spanner',
    gauge: 'chart',
    fuel: 'car',
    parking: 'car',
    room: 'home',
    brush: 'home',
    meter: 'chart',
    filter: 'filter',
    archive: 'folder',
    recycle: 'trash',
    bag: 'bag',
    undo: 'undo',
    parcel: 'parcel',
    compare: 'chart',
    heart: 'heart',
    pill: 'heart',
    ruler: 'chart',
    journal: 'note',
    paw: 'paw',
    broom: 'home',
    school: 'book',
    care: 'heart',
    child: 'people',
    pot: 'basket',
    fridge: 'home',
    basket: 'basket',
    alert: 'alert',
    plane: 'plane',
    ticket: 'document',
    suitcase: 'bag',
    voucher: 'gift',
    clock: 'clock',
    beach: 'plane',
    certificate: 'document',
    briefcase: 'briefcase',
    cake: 'gift',
    gift: 'gift',
    photo: 'star',
    mountain: 'flag',
    grid: 'grid',
    hands: 'people',
    laptop: 'laptop',
    globe: 'external',
    key: 'lock',
    payslip: 'money',
    history: 'history',
    flag: 'flag'
  }
  return map[name] ?? 'grid'
}
