/**
 * Identifiers and safe file naming.
 *
 * Record ids are opaque, sortable and generated without any machine-identifying
 * information (no MAC address, no hostname), so a vault carries nothing about
 * the computer it was created on.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Crypto-quality random suffix; falls back to Math.random only if unavailable. */
function randomPart(length: number): string {
  const g = globalThis as { crypto?: Crypto }
  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length)
    g.crypto.getRandomValues(bytes)
    let out = ''
    for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
    return out
  }
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/**
 * Lexicographically sortable id: base-36 milliseconds, then 14 random chars.
 * Sorting by id therefore approximates sorting by creation time, which keeps
 * list ordering stable without an extra index.
 */
export function newId(prefix = ''): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const id = `${time}${randomPart(14)}`
  return prefix ? `${prefix}_${id}` : id
}

// ---------------------------------------------------------------------------
// Cross-platform safe filenames
// ---------------------------------------------------------------------------

/** Names Windows refuses, with or without an extension, in any letter case. */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

/** Characters Windows forbids outright, plus ASCII control codes. */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g

/** Zero-width and bidirectional-override characters used to disguise filenames. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/**
 * Make a user-supplied filename safe on Windows, macOS (case-insensitive by
 * default) and Linux at once.
 *
 * Note: Orbit does NOT use this for the names of stored attachments — those are
 * content-addressed hex, which sidesteps the problem entirely. This is used for
 * export and "prepare for transfer" filenames the user will actually see.
 */
export function safeFileName(input: string, fallback = 'untitled'): string {
  // NFC-normalise so that macOS's decomposed "e + combining acute" and Windows's
  // composed "é" are the same name, rather than two files that look identical.
  let name = String(input ?? '').normalize('NFC')
  name = name.replace(ILLEGAL, '-')
  name = name.replace(INVISIBLE, '')
  name = name.replace(/\s+/g, ' ').trim()
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '') // no leading/trailing dots or spaces
  if (!name) name = fallback

  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  if (WINDOWS_RESERVED.has(stem.toLowerCase())) name = `_${name}`

  // 180 bytes keeps us clear of 255-byte filesystem limits once a suffix is added.
  const encoder = new TextEncoder()
  if (encoder.encode(name).length > 180) {
    let trimmed = stem
    while (encoder.encode(trimmed + ext).length > 180 && trimmed.length > 1) {
      trimmed = trimmed.slice(0, -1)
    }
    name = trimmed + ext
  }
  return name || fallback
}

/** Extension, lowercased, without the dot; '' when there isn't a sane one. */
export function fileExtension(filename: string): string {
  const base = String(filename ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : ''
}

/**
 * Reject any relative path that would escape its base directory once resolved.
 * Used on every archive entry and every imported file path.
 */
export function isPathTraversal(relative: string): boolean {
  const value = String(relative ?? '')
  if (value === '') return true
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) return true
  if (/^[a-zA-Z]:/.test(value)) return true // Windows drive-absolute
  if (value.startsWith('/') || value.startsWith('\\')) return true // POSIX or UNC absolute
  const parts = value.split(/[\\/]/)
  let depth = 0
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      depth -= 1
      if (depth < 0) return true
      continue
    }
    depth += 1
  }
  return false
}

/** Case-folded key used to detect collisions that only Windows/macOS would see. */
export function caseFoldKey(name: string): string {
  return String(name ?? '')
    .normalize('NFC')
    .toLowerCase()
}
