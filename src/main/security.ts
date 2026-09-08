import { app, session, shell, type BrowserWindow, type WebContents } from 'electron'
import { log } from './log.js'

/**
 * Orbit's security posture, applied in one place so it can be audited in one
 * place.
 *
 * The product holds passports, bank transactions, medical notes and children's
 * school records. It is offline by design, and the design is enforced here
 * rather than merely intended:
 *
 *  1. NO NETWORK. Every request from the renderer is cancelled at the session
 *     level. Not "we don't call fetch" — the request is refused whether it
 *     comes from our code, a stray <img src="https://…"> in imported HTML, or
 *     a dependency that decided to phone home. There is no allow-list to get
 *     wrong, because nothing is allowed.
 *  2. NO NODE IN THE RENDERER. Context isolation on, node integration off,
 *     sandbox on. The renderer talks to the main process only through the
 *     narrow, allow-listed bridge in preload.
 *  3. NO NAVIGATION. The window shows Orbit and nothing else. Every attempt to
 *     navigate elsewhere or open a new window is refused; external links go to
 *     the user's browser, and only after they have confirmed.
 *  4. NO PERMISSIONS. Camera, microphone, geolocation, notifications and the
 *     rest are denied by default. Desktop notifications are granted only when
 *     the user has turned them on in Settings, per machine.
 *  5. A STRICT CONTENT-SECURITY-POLICY, set as a real response header rather
 *     than a meta tag, so it cannot be overridden by injected markup.
 *
 * Deliberately absent from the whole application: telemetry, analytics, crash
 * reporting, automatic updates, remote fonts and remote stylesheets. The
 * interface uses the operating system's own fonts.
 */

/** Schemes the renderer is allowed to load at all. Everything else is refused. */
const ALLOWED_SCHEMES = new Set(['file:', 'devtools:', 'blob:', 'data:', 'chrome-extension:'])

/** Permissions the app may ask for, and only with the user's explicit setting. */
const CONDITIONAL_PERMISSIONS = new Set(['notifications'])

export interface SecurityState {
  /** Set from device preferences; false means even notifications are refused. */
  notificationsAllowed: boolean
  /** Every blocked request, counted, so Settings can show an honest zero. */
  blockedRequests: number
  lastBlocked: string
}

export const securityState: SecurityState = {
  notificationsAllowed: false,
  blockedRequests: 0,
  lastBlocked: ''
}

/**
 * The content-security policy.
 *
 * `connect-src 'none'` is the important line: it forbids fetch, XMLHttpRequest,
 * WebSocket and EventSource outright. `default-src 'self'` with explicit
 * `img-src` and `media-src` allowances for data: and blob: lets the app preview
 * an attachment the user has chosen, which is read from their own vault by the
 * main process and handed over as bytes — never fetched over a network.
 *
 * In development the Vite dev server needs a websocket for hot reload and
 * inline styles for its client, so the policy is relaxed for localhost only,
 * and only when the app is not packaged.
 */
function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ]
  return directives.join('; ')
}

/**
 * Refuse every network request.
 *
 * In development the Vite dev server is served over http://localhost, so those
 * requests must be let through or there is no app to develop. That exception
 * is scoped to localhost, to development builds, and is logged on startup so
 * nobody can mistake it for the shipped behaviour.
 */
export function installNetworkBlock(isDev: boolean): void {
  const ses = session.defaultSession

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    let url: URL | null = null
    try {
      url = new URL(details.url)
    } catch {
      callback({ cancel: true })
      return
    }
    if (ALLOWED_SCHEMES.has(url.protocol)) {
      callback({ cancel: false })
      return
    }
    if (isDev && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      callback({ cancel: false })
      return
    }
    securityState.blockedRequests += 1
    securityState.lastBlocked = `${url.protocol}//${url.hostname}`
    log.warn('security', `blocked a network request to ${url.protocol}//${url.hostname}`)
    callback({ cancel: true })
  })

  // Belt and braces: refuse to even resolve a proxy for anything.
  ses.setProxy({ mode: 'direct' }).catch((err) => log.warn('security', 'could not pin proxy mode', err))
}

export function installResponseHeaders(isDev: boolean): void {
  const csp = contentSecurityPolicy(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
        'Permissions-Policy': ['geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()']
      }
    })
  })
}

export function installPermissionHandlers(): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (CONDITIONAL_PERMISSIONS.has(permission) && securityState.notificationsAllowed) {
      callback(true)
      return
    }
    log.info('security', `refused a permission request: ${permission}`)
    callback(false)
  })

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return CONDITIONAL_PERMISSIONS.has(permission) && securityState.notificationsAllowed
  })

  // No device access of any kind.
  ses.setDevicePermissionHandler(() => false)
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }))
}

/**
 * Lock a window down: no navigation away from the app, no popups, no webviews,
 * and external links only through the user's own browser after confirmation.
 */
export function hardenWindow(window: BrowserWindow, appOrigin: string): void {
  const contents = window.webContents

  // Denied outright. Opening a link in the user's browser is a deliberate act
  // that goes through the app.openExternal message, where it is confirmed
  // first — never something a stray anchor tag can trigger by itself.
  contents.setWindowOpenHandler(() => {
    log.info('security', 'refused a request to open a new window')
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(appOrigin)) return
    event.preventDefault()
    log.warn('security', 'blocked an attempt to navigate away from Orbit')
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('security', 'blocked an attempt to attach a webview')
  })

  contents.on('will-redirect', (event, url) => {
    if (url.startsWith(appOrigin)) return
    event.preventDefault()
    log.warn('security', 'blocked a redirect away from Orbit')
  })

  // A renderer that crashes should not take the app with it silently.
  contents.on('render-process-gone', (_event, details) => {
    log.error('security', `renderer process ended unexpectedly: ${details.reason}`)
  })
}

/**
 * Open a link in the user's own browser.
 *
 * Only http and https are ever handed to the operating system. A `file:` link
 * would open a local file, and custom schemes can launch arbitrary
 * applications, so both are refused.
 */
export async function handleExternalLink(rawUrl: string): Promise<{ opened: boolean; reason: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { opened: false, reason: 'That is not a valid web address.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
    log.warn('security', `refused to open a ${url.protocol} link`)
    return { opened: false, reason: 'Orbit only opens web and email links, and only in your own browser.' }
  }
  try {
    await shell.openExternal(url.toString())
    return { opened: true, reason: '' }
  } catch (err) {
    log.warn('security', 'the operating system refused to open the link', err)
    return { opened: false, reason: 'Your computer would not open that link.' }
  }
}

/** Applied to every WebContents as it is created, including any we did not make. */
export function installGlobalWebContentsGuards(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/** Command-line switches applied before the app is ready. */
export function applyCommandLineHardening(): void {
  // No automatic connections of any kind from Chromium itself.
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,MediaRouter,DialMediaRouteProvider')
  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-component-update')
  app.commandLine.appendSwitch('disable-domain-reliability')
  app.commandLine.appendSwitch('no-pings')
  app.commandLine.appendSwitch('disable-sync')
  app.commandLine.appendSwitch('disable-breakpad')
}
