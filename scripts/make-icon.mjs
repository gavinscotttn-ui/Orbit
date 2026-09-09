/**
 * Renders build/icon.svg to build/icon.png at 1024×1024.
 *
 * electron-builder turns that single PNG into the .icns and .ico each platform
 * needs, so the vector is the source of truth and the raster is generated —
 * rather than a binary nobody can edit sitting in version control forever.
 *
 * Chromium does the rasterising because it is already here for the end-to-end
 * tests, and it renders the gradients exactly as the application will.
 *
 *   node scripts/make-icon.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pw from 'playwright'

const SIZE = 1024
const source = resolve('build/icon.svg')
const target = resolve('build/icon.png')

const svg = readFileSync(source, 'utf8')

const launch = {}
// The sandboxed CI image pins a browser build that may not match Playwright's
// expected revision; use the one that is actually installed when it is named.
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH

const browser = await pw.chromium.launch(launch)
try {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1
  })
  await page.setContent(
    `<body style="margin:0"><div style="width:${SIZE}px;height:${SIZE}px">${svg}</div></body>`
  )
  await page.screenshot({ path: target, omitBackground: true })
} finally {
  await browser.close()
}

console.log(`Wrote ${target} (${SIZE}×${SIZE})`)
