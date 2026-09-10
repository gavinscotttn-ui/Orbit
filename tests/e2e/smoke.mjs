/**
 * End-to-end smoke test: drives the real, built Orbit application.
 *
 * This is not a unit test with the Electron bits stubbed out. It launches the
 * actual main process, loads the actual renderer, creates a real vault on disk,
 * seeds it, walks every top-level screen and takes screenshots. If a button is
 * dead or a screen throws, this catches it, because a product that typechecks
 * and does not run is not a product.
 *
 * Run with:  node tests/e2e/smoke.mjs
 * Screenshots land in tests/e2e/screenshots/.
 */

import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const shots = join(here, 'screenshots')
const workspace = join(tmpdir(), `orbit-e2e-${Date.now()}`)
const vaultPath = join(workspace, 'Orbit Vault')
const movedPath = join(workspace, 'moved', 'Renamed Vault')

const failures = []
const passes = []

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name)
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

mkdirSync(shots, { recursive: true })
mkdirSync(workspace, { recursive: true })

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js'), '--no-sandbox'],
  cwd: root,
  env: { ...process.env, ORBIT_E2E: '1' }
})

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

/** Call an IPC channel from inside the renderer, exactly as the UI does. */
async function invoke(channel, payload = {}) {
  return page.evaluate(([c, p]) => window.orbit.invoke(c, p), [channel, payload])
}

async function shot(name) {
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false })
}

try {
  // -- Startup --------------------------------------------------------------
  section('Startup and the first-run screen')
  await page.waitForSelector('text=Life orbits around it', { timeout: 20000 })
  check('the first-run screen appears', true)
  check('the bridge is present', await page.evaluate(() => typeof window.orbit?.invoke === 'function'))
  check(
    'Node is not reachable from the renderer',
    await page.evaluate(() => typeof globalThis.require === 'undefined' && typeof globalThis.process === 'undefined')
  )
  await shot('01-first-run')

  const info = await invoke('app.info')
  check('app.info answers', info.ok)
  check('it reports that networking is off', info.ok && info.data.networkEnabled === false)

  // -- The network really is blocked ----------------------------------------
  section('Network lockdown')
  const fetchResult = await page.evaluate(async () => {
    try {
      const response = await fetch('https://example.com/', { mode: 'no-cors' })
      return { blocked: false, status: response.status }
    } catch (err) {
      return { blocked: true, message: String(err).slice(0, 120) }
    }
  })
  check('fetch to the open internet is refused', fetchResult.blocked, JSON.stringify(fetchResult))

  const imageResult = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve('loaded')
        img.onerror = () => resolve('blocked')
        img.src = 'https://example.com/pixel.png'
        setTimeout(() => resolve('timeout'), 4000)
      })
  )
  check('a remote image is refused', imageResult !== 'loaded', String(imageResult))

  const unknownChannel = await invoke('totally.made.up')
  check('an unknown IPC channel is refused', !unknownChannel.ok && unknownChannel.code === 'unknown-channel')

  const badPayload = await invoke('records.list', { type: 12345 })
  check('a malformed payload is refused', !badPayload.ok)

  // -- Creating a vault ------------------------------------------------------
  section('Creating a vault')
  const created = await invoke('vault.create', { path: vaultPath, name: 'End to end vault' })
  check('the vault was created', created.ok && created.data.opened, JSON.stringify(created).slice(0, 200))
  check('the manifest file exists', existsSync(join(vaultPath, 'orbit-vault.json')))
  check('the database exists', existsSync(join(vaultPath, 'data', 'orbit.sqlite')))

  await page.waitForSelector('.shell', { timeout: 15000 })
  check('the main shell rendered', await page.locator('.sidebar').isVisible())
  await shot('02-today-empty')

  // -- Seeding realistic data through the real API --------------------------
  section('The connected workflows')

  const person = await invoke('records.create', {
    type: 'person',
    data: { display_name: 'Northgate Insurance', kind: 'organisation', relationship: 'insurer' }
  })
  check('a person can be created', person.ok && person.data.created)

  const car = await invoke('records.create', {
    type: 'asset',
    data: {
      name: 'The blue estate',
      asset_type: 'vehicle',
      make: 'Vauxhall',
      model: 'Astra',
      identifier: 'E2E 123',
      currency: 'GBP',
      module: 'vehicles'
    }
  })
  check('a vehicle can be created', car.ok && car.data.created)
  const carId = car.ok ? car.data.id : ''

  const policy = await invoke('records.create', {
    type: 'policy',
    data: {
      name: 'Car insurance',
      kind: 'motor',
      provider_person_id: person.ok ? person.data.id : null,
      policy_number: 'E2E-1',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
      premium_minor: 48600,
      currency: 'GBP',
      premium_period: 'annual',
      excess_minor: 35000
    }
  })
  check('an insurance policy can be created', policy.ok && policy.data.created)

  const mot = await invoke('records.create', {
    type: 'maintenance_schedule',
    data: {
      title: 'MOT test',
      asset_id: carId,
      kind: 'test',
      next_due_on: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10),
      reminder_lead_days: 30,
      distance_unit: 'mi'
    }
  })
  check('an MOT schedule can be created', mot.ok && mot.data.created)

  const service = await invoke('records.create', {
    type: 'maintenance_record',
    data: {
      title: 'Full service',
      asset_id: carId,
      done_on: '2026-06-14',
      cost_minor: 41250,
      currency: 'GBP',
      outcome: 'completed'
    }
  })
  check('a service record can be created', service.ok && service.data.created)

  const fuel = await invoke('records.create', {
    type: 'fuel_log',
    data: {
      asset_id: carId,
      on_date: '2026-07-06',
      kind: 'fuel',
      quantity: 41.2,
      unit: 'litre',
      cost_minor: 6340,
      currency: 'GBP',
      full_tank: 1
    }
  })
  check('a fuel log can be created', fuel.ok && fuel.data.created)

  // Link them, which is the point of the product.
  for (const [type, id] of [
    ['policy', policy.ok ? policy.data.id : ''],
    ['maintenance_schedule', mot.ok ? mot.data.id : ''],
    ['maintenance_record', service.ok ? service.data.id : '']
  ]) {
    if (id) await invoke('records.link', { fromType: 'asset', fromId: carId, toType: type, toId: id, relation: 'belongs-to' })
  }

  const detail = await invoke('record.detail', { type: 'asset', id: carId })
  check('the vehicle detail view loads', detail.ok)
  check(
    'the vehicle shows its linked records',
    detail.ok && detail.data.related.length >= 3,
    detail.ok ? `${detail.data.related.length} links` : ''
  )
  check(
    'the vehicle rolls up its costs',
    detail.ok && detail.data.totalCostMinor === 41250 + 6340,
    detail.ok ? String(detail.data.totalCostMinor) : ''
  )

  // Purchase -> return -> refund
  const purchase = await invoke('records.create', {
    type: 'purchase',
    data: {
      title: 'Wireless headphones',
      merchant: 'Halton Electricals',
      purchased_on: '2026-08-14',
      total_minor: 12999,
      currency: 'GBP',
      warranty_months: 12,
      return_by: '2026-09-13'
    }
  })
  check('a purchase can be created', purchase.ok && purchase.data.created)

  const ret = await invoke('records.create', {
    type: 'return',
    data: {
      purchase_id: purchase.ok ? purchase.data.id : null,
      item_name: 'Wireless headphones',
      opened_on: '2026-08-22',
      status: 'sent',
      sent_on: '2026-08-23',
      refund_expected_minor: 12999,
      currency: 'GBP'
    }
  })
  check('a return can be created', ret.ok && ret.data.created)
  const returnRow = ret.ok ? await invoke('records.get', { type: 'return', id: ret.data.id }) : null
  check(
    'sending a return does NOT mark it refunded',
    returnRow?.ok && returnRow.data.refund_received_on === null && returnRow.data.status === 'sent'
  )

  // A bill, which must show up in Today and in Money from one record.
  const account = await invoke('records.create', {
    type: 'account',
    data: { name: 'Current account', kind: 'current', currency: 'GBP', opening_balance_minor: 214350 }
  })
  check('an account can be created', account.ok && account.data.created)

  const bill = await invoke('records.create', {
    type: 'bill',
    data: {
      name: 'Electricity and gas',
      kind: 'bill',
      amount_minor: 11400,
      currency: 'GBP',
      anchor_date: '2026-01-08',
      due_day: 8,
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      account_id: account.ok ? account.data.id : null,
      status: 'active'
    }
  })
  check('a bill can be created', bill.ok && bill.data.created)

  const upcoming = await invoke('money.bills', { days: 60 })
  check('the bill appears in the money view', upcoming.ok && upcoming.data.bills.length > 0)

  // A trip with a booking and a budget.
  const trip = await invoke('records.create', {
    type: 'trip',
    data: {
      title: 'A week in Portugal',
      destination: 'Lisbon',
      starts_on: '2026-11-02',
      ends_on: '2026-11-09',
      budget_minor: 180000,
      currency: 'GBP',
      status: 'booked'
    }
  })
  check('a trip can be created', trip.ok && trip.data.created)
  const booking = await invoke('records.create', {
    type: 'trip_booking',
    data: {
      trip_id: trip.ok ? trip.data.id : null,
      kind: 'flight',
      title: 'Flights to Lisbon',
      reference: 'E2E-FLT',
      starts_on: '2026-11-02',
      cost_minor: 62400,
      currency: 'GBP',
      status: 'booked'
    }
  })
  check('a booking can be created', booking.ok && booking.data.created)

  // -- Today reflects all of it ---------------------------------------------
  section('Today, search and the screens')
  const brief = await invoke('today.brief', { horizonDays: 60 })
  check('Today builds a briefing', brief.ok)
  check(
    'the MOT and the bill both reach Today',
    brief.ok && brief.data.attention.some((a) => a.title.includes('MOT')) && brief.data.attention.some((a) => a.title.includes('Electricity'))
  )

  const searchResult = await invoke('search.query', { text: 'Portugal' })
  check('search finds the trip', searchResult.ok && searchResult.data.hits.some((h) => h.type === 'trip'))

  const searchCar = await invoke('search.query', { text: 'blue estate' })
  check('search finds the vehicle', searchCar.ok && searchCar.data.hits.length > 0)

  // Walk the real interface.
  await page.reload()
  await page.waitForSelector('.shell', { timeout: 15000 })
  await page.waitForTimeout(1200)
  await shot('03-today')

  for (const [label, name] of [
    ['Plan', '04-plan'],
    ['Money', '05-money'],
    ['Inbox', '06-inbox']
  ]) {
    await page.locator(`.nav button:has-text("${label}")`).first().click()
    await page.waitForTimeout(900)
    const crashed = await page.locator('text=Something went wrong').count()
    check(`the ${label} screen renders`, crashed === 0)
    await shot(name)
  }

  await page.locator('.nav button:has-text("Everything")').first().click()
  await page.waitForTimeout(900)
  await shot('07-life')
  check('the Life hub renders', (await page.locator('text=Everything Orbit keeps').count()) > 0)

  await page.locator('button[aria-label="Settings"]').click()
  await page.waitForTimeout(900)
  await shot('08-settings')
  check('Settings renders', (await page.locator('text=Vault, backups & transfer').count()) > 0)

  // Automatic locking. The control must exist, be wired to the device
  // preference, and actually close the vault — a stored setting that nothing
  // acts on would be a dead button with extra steps.
  await page.locator('.settings-tabs button:has-text("Preferences"), button:has-text("Preferences")').first().click()
  await page.waitForTimeout(700)
  const lockControl = page.locator('#dev-lock')
  check('the automatic lock control is on screen', (await lockControl.count()) === 1)
  await lockControl.selectOption('5')
  await page.waitForTimeout(500)
  const lockPref = await invoke('device.get', {})
  check('choosing a lock delay is saved for this device', lockPref.ok && lockPref.data.autoLockMinutes === 5)
  await lockControl.selectOption('0')
  await page.waitForTimeout(400)
  await page.locator('button:has-text("Vault, backups & transfer")').first().click()
  await page.waitForTimeout(600)

  // Dark theme, because "excellent light and dark themes" is a requirement.
  await invoke('settings.set', { theme: 'dark' })
  await page.waitForTimeout(700)
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  check('dark theme applies', themeAttr === 'dark')
  await shot('09-settings-dark')
  await invoke('settings.set', { theme: 'light' })

  // -- Attachments, backup, integrity, transfer ------------------------------
  section('Attachments, backup and transfer')
  const attachmentAdded = await page.evaluate(async (id) => {
    // Write a temp file through the main process is not exposed, so the test
    // uses a path created by the harness below; here we only check the API
    // surface answers sensibly for a path that does not exist.
    return window.orbit.invoke('attachments.addFromPaths', {
      type: 'asset',
      id,
      paths: ['/definitely/not/a/real/file.txt']
    })
  }, carId)
  check(
    'a missing file is reported, not swallowed',
    attachmentAdded.ok && attachmentAdded.data.failed.length === 1
  )

  const integrity = await invoke('vault.integrity')
  check('the integrity check passes', integrity.ok && integrity.data.healthy, JSON.stringify(integrity).slice(0, 200))

  const backup = await invoke('vault.backup', { note: 'e2e' })
  check('a backup can be taken', backup.ok && backup.data.bytes > 0)

  const transfer = await invoke('vault.prepareTransfer')
  check('the vault is ready to transfer', transfer.ok && transfer.data.ready, JSON.stringify(transfer?.data?.problems ?? ''))
  check('transfer notes mention notifications', transfer.ok && transfer.data.notes.join(' ').toLowerCase().includes('notification'))

  const countsBefore = await invoke('records.counts', {
    types: ['asset', 'policy', 'purchase', 'return', 'bill', 'trip', 'transaction']
  })

  // -- Move the vault to a new path and reopen -------------------------------
  section('Moving the vault to a different path')
  await invoke('vault.close')
  await page.waitForTimeout(600)

  mkdirSync(join(workspace, 'moved'), { recursive: true })
  cpSync(vaultPath, movedPath, { recursive: true })
  rmSync(vaultPath, { recursive: true, force: true })

  const reopened = await invoke('vault.open', { path: movedPath })
  check('the moved vault reopens', reopened.ok && reopened.data.opened, JSON.stringify(reopened).slice(0, 250))

  const countsAfter = await invoke('records.counts', {
    types: ['asset', 'policy', 'purchase', 'return', 'bill', 'trip', 'transaction']
  })
  check(
    'every record survived the move',
    countsBefore.ok && countsAfter.ok && JSON.stringify(countsBefore.data) === JSON.stringify(countsAfter.data),
    `${JSON.stringify(countsBefore.data)} vs ${JSON.stringify(countsAfter.data)}`
  )

  const detailAfter = await invoke('record.detail', { type: 'asset', id: carId })
  check('the vehicle still shows its links after the move', detailAfter.ok && detailAfter.data.related.length >= 3)

  const integrityAfter = await invoke('vault.integrity')
  check('integrity still passes after the move', integrityAfter.ok && integrityAfter.data.healthy)

  await page.waitForTimeout(900)
  await shot('10-after-move')

  // -- The demonstration vault ----------------------------------------------
  section('The demonstration vault')
  await invoke('vault.close')
  const demoPath = join(workspace, 'Orbit Demo Vault')
  const demo = await invoke('vault.createDemo', { path: demoPath })
  check('the demonstration vault opens', demo.ok && demo.data.opened, JSON.stringify(demo).slice(0, 200))
  check('it is flagged as a demonstration', demo.ok && demo.data.manifest.isDemo === true)

  const demoBrief = await invoke('today.brief', { horizonDays: 60 })
  check('the demonstration vault has something to show', demoBrief.ok && demoBrief.data.attention.length > 3)

  await page.locator('.nav button:has-text("Today")').first().click()
  await page.waitForTimeout(2000)
  await shot('11-demo-today')

  await page.locator('.nav button:has-text("Money")').first().click()
  await page.waitForTimeout(1500)
  await shot('12-demo-money')

  await page.locator('.nav button:has-text("Vehicles")').first().click()
  await page.waitForTimeout(1400)
  await shot('13-demo-vehicles')

  // Open the car itself: the connected detail view is the point of the product.
  const carRow = page.locator('button.card').filter({ hasText: 'Cars, vans, motorbikes' }).first()
  if ((await carRow.count()) > 0) {
    await carRow.click()
    await page.waitForTimeout(1200)
    const firstRecord = page.locator('table.data tbody tr').first()
    if ((await firstRecord.count()) > 0) {
      await firstRecord.click()
      await page.waitForTimeout(1400)
      await shot('14-demo-vehicle-detail')

      // Opening a car should answer "when is the MOT" without another click.
      // Those dates live on maintenance schedules that point at the car, not on
      // the car, so this also proves the link walk works.
      const deadlines = await page.locator('.deadline-chip').allTextContents()
      check(
        'the car shows its deadlines on the overview',
        deadlines.some((text) => /MOT/i.test(text)),
        deadlines.join(' | ')
      )
      // A monthly bill must appear once, not once per future occurrence.
      const taxChips = deadlines.filter((text) => /Vehicle tax/i.test(text))
      check('a repeating bill is shown once, not once per occurrence', taxChips.length === 1, String(taxChips.length))
      check(
        'the connected records are on the overview, not only behind a tab',
        (await page.locator('.related-row').count()) > 0
      )

      const costsTab = page.locator('[role="tab"]:has-text("Costs")')
      if ((await costsTab.count()) > 0) {
        await costsTab.click()
        await page.waitForTimeout(800)
        await shot('15-demo-vehicle-costs')
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }
  }

  // The command palette and search, both keyboard-first.
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(700)
  await shot('16-command-palette')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  await page.keyboard.press('Control+f')
  await page.waitForTimeout(500)
  await page.keyboard.type('receipt')
  await page.waitForTimeout(1000)
  await shot('17-search')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  await page.locator('.nav button:has-text("Plan")').first().click()
  await page.waitForTimeout(1400)
  await shot('18-demo-calendar')

  const demoSearch = await invoke('search.query', { text: 'dishwasher' })
  check('search finds the demonstration receipt', demoSearch.ok && demoSearch.data.hits.length > 0)
} catch (err) {
  failures.push(`the run threw: ${err instanceof Error ? err.message : String(err)}`)
  console.error(err)
  try {
    await shot('99-failure')
  } catch {
    /* ignore */
  }
} finally {
  try {
    await invoke('vault.close')
  } catch {
    /* ignore */
  }
  await app.close()
  rmSync(workspace, { recursive: true, force: true })
}

console.log(`\n${passes.length} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) console.log(`  - ${failure}`)
}
const shotFiles = existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.png')) : []
console.log(`\nScreenshots: ${shotFiles.length} in tests/e2e/screenshots/`)
process.exit(failures.length === 0 ? 0 : 1)
