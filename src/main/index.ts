import { app, BrowserWindow, Menu, shell, dialog, nativeTheme } from 'electron'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppContext } from './context.js'
import { registerAllHandlers } from './ipc/handlers/index.js'
import { setBroadcastTargets, broadcast } from './ipc/router.js'
import {
  applyCommandLineHardening,
  hardenWindow,
  installGlobalWebContentsGuards,
  installNetworkBlock,
  installPermissionHandlers,
  installResponseHeaders,
  securityState
} from './security.js'
import { log } from './log.js'

const isDev = !app.isPackaged
const APP_VERSION = app.getVersion()

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null

applyCommandLineHardening()

/**
 * One instance only.
 *
 * A second Orbit would fight the first for the vault's lock file and confuse
 * the user. Launching again simply brings the existing window forward, which is
 * what people expect a desktop application to do.
 */
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()

  setUpFileLogging()
  log.info('app', `Orbit ${APP_VERSION} starting on ${process.platform}/${process.arch}`)
  if (isDev) {
    log.warn('security', 'development build: requests to localhost are permitted for the dev server. Packaged builds block every network request.')
  }

  installNetworkBlock(isDev)
  installResponseHeaders(isDev)
  installPermissionHandlers()
  installGlobalWebContentsGuards()

  context = new AppContext(APP_VERSION)
  securityState.notificationsAllowed = context.device.get('osNotificationsEnabled')
  registerAllHandlers(context)

  createWindow()
  buildMenu()

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open reopens one.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): void {
  const bounds = context?.device.get('windowBounds')
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 900,
    ...(bounds?.x !== undefined && bounds?.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Orbit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#f4f5f8',
    // Native conventions: an inset traffic-light bar on macOS, a normal frame
    // on Windows, because pretending otherwise never looks right on either.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(dirnameOf(import.meta.url), '../preload/index.js'),
      // The three that matter, and they are not negotiable.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
      // No remote content of any kind, so this can stay on.
      webSecurity: true
    }
  })

  if (context?.device.get('windowMaximised')) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
    hardenWindow(mainWindow, rendererUrl)
  } else {
    const file = join(dirnameOf(import.meta.url), '../renderer/index.html')
    void mainWindow.loadFile(file)
    hardenWindow(mainWindow, 'file://')
  }

  const saveBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || !context) return
    context.device.set('windowMaximised', mainWindow.isMaximized())
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      const { width, height, x, y } = mainWindow.getBounds()
      context.device.set('windowBounds', { width, height, x, y })
    }
  }
  mainWindow.on('resize', debounce(saveBounds, 500))
  mainWindow.on('move', debounce(saveBounds, 500))
  mainWindow.on('close', saveBounds)

  mainWindow.on('closed', () => {
    mainWindow = null
    setBroadcastTargets([])
  })

  setBroadcastTargets([mainWindow])
}

/**
 * The application menu.
 *
 * Built rather than left to Electron's default, because the default menu on
 * Windows includes items that make no sense here, and because the keyboard
 * shortcuts people expect (a command palette, quick capture, search) belong in
 * the menu as well as in the interface.
 */
function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const send = (event: 'background.tick', payload: unknown): void => broadcast(event, payload)

  const menu = Menu.buildFromTemplate([
    ...(isMac
      ? ([
          {
            label: 'Orbit',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Quick capture…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('background.tick', { command: 'quick-capture' })
        },
        {
          label: 'Search everything…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('background.tick', { command: 'search' })
        },
        {
          label: 'Command palette…',
          accelerator: 'CmdOrCtrl+K',
          click: () => send('background.tick', { command: 'palette' })
        },
        { type: 'separator' },
        {
          label: 'Close vault',
          click: () => send('background.tick', { command: 'close-vault' })
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? ([{ role: 'toggleDevTools' as const }] as Electron.MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' as const }] : [])]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Where is my data?',
          click: () => send('background.tick', { command: 'show-vault-location' })
        },
        {
          label: 'Open the vault folder',
          click: () => {
            const root = context?.vaults.current?.root
            if (root) void shell.openPath(root)
          }
        },
        { type: 'separator' },
        {
          label: 'About Orbit',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Orbit',
              message: `Orbit ${APP_VERSION}`,
              detail: [
                'Life orbits around it.',
                '',
                'Orbit works entirely offline. It makes no network requests, sends no telemetry and has no account.',
                `Network requests blocked so far this session: ${securityState.blockedRequests}.`,
                '',
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`
              ].join('\n'),
              buttons: ['Close']
            })
          }
        }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}

/**
 * Closing the vault cleanly matters more than closing quickly: the manifest's
 * clean-shutdown flag, the WAL checkpoint and the lock file all depend on it.
 */
function shutdown(): void {
  try {
    context?.closeVault()
  } catch (err) {
    log.error('app', 'the vault did not close cleanly', err)
  }
}

app.on('window-all-closed', () => {
  // On macOS an application conventionally stays running with no windows.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)

process.on('exit', shutdown)
process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

process.on('uncaughtException', (err) => {
  log.error('app', 'uncaught exception', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('app', 'unhandled rejection', reason)
})

// ---------------------------------------------------------------------------

function dirnameOf(url: string): string {
  return join(fileURLToPath(url), '..')
}

/**
 * Logs go to the per-machine application folder, never into the vault, so a
 * vault carries no trace of the computer it was used on.
 */
function setUpFileLogging(): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, `orbit-${new Date().toISOString().slice(0, 10)}.log`)
    log.setSink((line) => {
      try {
        appendFileSync(file, line + '\n', 'utf8')
      } catch {
        /* logging must never be the thing that breaks */
      }
    })
  } catch {
    /* no file logging is survivable */
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | null = null
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}
