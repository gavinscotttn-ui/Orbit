import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { looksLikeVault } from './paths.js'

/**
 * Where the running application actually lives on disk.
 *
 * On macOS `process.execPath` is buried inside `Orbit.app/Contents/MacOS/`, so
 * the folder a user sees is three levels up. On Windows and Linux it is simply
 * the folder containing the executable. In development it is the project root.
 *
 * This matters for portable mode, and it is exactly the sort of thing that
 * silently breaks on one platform if you assume the other.
 */
export function distributionDirectory(): string {
  if (!app.isPackaged) return process.cwd()
  const exe = process.execPath
  if (process.platform === 'darwin') {
    // …/Orbit.app/Contents/MacOS/Orbit  ->  the folder containing Orbit.app
    const macOsDir = dirname(exe)
    const contents = dirname(macOsDir)
    const appBundle = dirname(contents)
    if (appBundle.endsWith('.app')) return dirname(appBundle)
    return macOsDir
  }
  return dirname(exe)
}

export interface PortableCandidate {
  path: string
  exists: boolean
  /** Why Orbit thinks this is the portable vault. Shown to the user. */
  reason: string
}

/**
 * Portable mode: a vault folder sitting next to the executable.
 *
 * Two conventions are supported, and neither is applied silently — the first
 * launch screen shows what was found and the user confirms.
 *
 *   1. A folder named "Orbit Vault" beside the application.
 *   2. A file named "orbit-portable.txt" beside the application whose first
 *      non-empty line is a path relative to the application folder.
 *
 * On macOS this deliberately resolves NEXT TO the .app bundle and never inside
 * it: writing user data into a signed bundle breaks the signature, and on a
 * quarantined or read-only volume it would fail outright.
 */
export function portableCandidate(): PortableCandidate | null {
  const base = distributionDirectory()
  try {
    const pointer = join(base, 'orbit-portable.txt')
    if (existsSync(pointer)) {
      const line = readFileSync(pointer, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'))
      if (line) {
        // The pointer file is deliberate local configuration written by the
        // person who set up the portable drive, so an absolute path or a
        // relative one that steps up a level are both legitimate here.
        const absolute = isAbsolute(line) ? resolve(line) : resolve(base, line)
        return {
          path: absolute,
          exists: looksLikeVault(absolute),
          reason: 'named in orbit-portable.txt beside the application'
        }
      }
    }
  } catch {
    /* a malformed pointer file must not stop the app starting */
  }
  const adjacent = join(base, 'Orbit Vault')
  if (looksLikeVault(adjacent)) {
    return { path: adjacent, exists: true, reason: 'found beside the application' }
  }
  return null
}

/** Per-machine application folder. Never holds records — only device settings. */
export function deviceDataDirectory(): string {
  return app.getPath('userData')
}
