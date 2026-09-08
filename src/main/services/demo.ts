import { addDays, addMonthsClamped, monthKey, startOfMonth, today as todayDate } from '@shared/domain/time.js'
import type { Repository } from '../db/repository.js'
import type { OrbitDatabase } from '../db/database.js'
import type { SettingsService } from './settings.js'
import type { AttachmentService } from './attachments.js'
import { billOccurrences } from '@shared/domain/finance.js'
import { newId } from '@shared/domain/ids.js'
import { log } from '../log.js'

/**
 * The demonstration vault.
 *
 * Written into its own folder, flagged in the manifest, and never mixed with a
 * real one. The point is to show the CONNECTIONS, because a list of empty
 * screens does not explain what Orbit is for. Every one of the connected
 * workflows in the specification is represented:
 *
 *   1. A car, with its insurance, its MOT reminder, its service receipt and
 *      its running costs, all visible together.
 *   2. A purchase, its receipt, its warranty and a return, tracked through to
 *      the refund actually arriving.
 *   3. A trip with bookings, preparation tasks and a budget.
 *   4. A household bill that appears in Today and in Money.
 *   5. Enough attachments to make "prepare for transfer" meaningful.
 *
 * The people are invented. Dates are relative to today so the demonstration
 * never looks stale.
 */

export interface DemoResult {
  created: Record<string, number>
  notes: string[]
}

export function seedDemoVault(
  repository: Repository,
  settings: SettingsService,
  attachments: AttachmentService,
  db: OrbitDatabase
): DemoResult {
  const now = todayDate()
  const created: Record<string, number> = {}
  const count = (type: string): void => {
    created[type] = (created[type] ?? 0) + 1
  }

  const make = (type: string, data: Record<string, unknown>): string => {
    const result = repository.create(type, data, { silent: true, source: 'demo' })
    if (!result.ok) {
      log.warn('demo', `could not create a demonstration ${type}: ${result.errors[0]?.message ?? 'unknown'}`)
      return ''
    }
    count(type)
    return result.id
  }

  settings.set({
    modules: ['home', 'vehicles', 'travel', 'family', 'health', 'food', 'digital', 'relationships'],
    currency: 'GBP',
    locale: 'en-GB',
    vaultOwnerName: 'Sam',
    onboardingComplete: true
  })

  const attachText = (name: string, body: string, entityType: string, entityId: string): void => {
    if (!entityId) return
    try {
      attachments.addBuffer(new TextEncoder().encode(body), name, {
        link: { entityType, entityId },
        importedNote: 'Demonstration file'
      })
      count('attachment')
    } catch (err) {
      log.warn('demo', 'could not attach a demonstration file', err)
    }
  }

  // -- People ----------------------------------------------------------------

  const me = make('person', { display_name: 'Sam Whitfield', kind: 'person', is_me: 1, household_member: 1, relationship: 'me' })
  const partner = make('person', {
    display_name: 'Jo Whitfield',
    kind: 'person',
    household_member: 1,
    relationship: 'partner',
    birthday: addMonthsClamped(now, 2, 14)
  })
  const child = make('person', {
    display_name: 'Robin Whitfield',
    kind: 'person',
    household_member: 1,
    relationship: 'child',
    birthday: addDays(now, 40)
  })
  const insurer = make('person', { display_name: 'Northgate Insurance', kind: 'organisation', relationship: 'insurer' })
  const garage = make('person', { display_name: 'Bellweather Motors', kind: 'organisation', relationship: 'tradesperson', phone: '01632 960123' })
  const retailer = make('person', { display_name: 'Halton Electricals', kind: 'organisation', relationship: 'supplier' })
  const energy = make('person', { display_name: 'Riverstone Energy', kind: 'organisation', relationship: 'supplier' })

  // -- Accounts and categories ----------------------------------------------

  const current = make('account', {
    name: 'Everyday current account',
    kind: 'current',
    institution: 'Marlow Bank',
    currency: 'GBP',
    opening_balance_minor: 214_350,
    opening_balance_date: startOfMonth(addMonthsClamped(now, -6, 1))
  })
  const savings = make('account', {
    name: 'Rainy day savings',
    kind: 'savings',
    institution: 'Marlow Bank',
    currency: 'GBP',
    opening_balance_minor: 380_000,
    opening_balance_date: startOfMonth(addMonthsClamped(now, -6, 1))
  })
  const card = make('account', {
    name: 'Credit card',
    kind: 'credit-card',
    institution: 'Marlow Bank',
    currency: 'GBP',
    opening_balance_minor: -42_000,
    interest_rate_bp: 2199
  })

  const categories: Record<string, string> = {}
  for (const [name, kind] of [
    ['Salary', 'income'],
    ['Groceries', 'expense'],
    ['Housing', 'expense'],
    ['Utilities', 'expense'],
    ['Transport', 'expense'],
    ['Vehicle', 'expense'],
    ['Eating out', 'expense'],
    ['Subscriptions', 'expense'],
    ['Health', 'expense'],
    ['Home', 'expense'],
    ['Travel', 'expense'],
    ['Shopping', 'expense']
  ] as [string, string][]) {
    categories[name] = make('category', { name, kind })
  }

  // -- Workflow 4: a household bill that shows up in Today and in Money ------

  const energyBill = make('bill', {
    name: 'Electricity and gas',
    kind: 'bill',
    provider_person_id: energy,
    category_id: categories.Utilities,
    account_id: current,
    amount_minor: 11_400,
    currency: 'GBP',
    amount_varies: 1,
    anchor_date: addMonthsClamped(now, -6, 8),
    due_day: 8,
    cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
    payment_method: 'Direct Debit',
    reminder_lead_days: 5,
    notes: 'Variable — the amount changes with usage.'
  })
  const broadband = make('bill', {
    name: 'Broadband',
    kind: 'contract',
    category_id: categories.Utilities,
    account_id: current,
    amount_minor: 3_499,
    currency: 'GBP',
    anchor_date: addMonthsClamped(now, -6, 18),
    due_day: 18,
    cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
    contract_ends_on: addDays(now, 47),
    notice_period_days: 30,
    renewal_date: addDays(now, 47),
    notes: 'Price rises to £41.99 after the contract ends.'
  })

  const streaming = make('bill', {
    name: 'Streaming service',
    kind: 'subscription',
    category_id: categories.Subscriptions,
    account_id: current,
    amount_minor: 1_099,
    currency: 'GBP',
    anchor_date: addMonthsClamped(now, -3, 22),
    due_day: 22,
    cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
    trial_ends_on: addDays(now, 9),
    usage_target_per_month: 8,
    notes: 'Free trial — decide before it starts charging.'
  })

  const gym = make('bill', {
    name: 'Gym membership',
    kind: 'membership',
    category_id: categories.Health,
    account_id: current,
    amount_minor: 3_200,
    currency: 'GBP',
    anchor_date: addMonthsClamped(now, -8, 1),
    due_day: 1,
    cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
    usage_target_per_month: 12,
    notes: 'Worth checking how often it actually gets used.'
  })

  // -- Workflow 1: the car and everything attached to it ---------------------

  const car = make('asset', {
    name: 'The blue estate',
    asset_type: 'vehicle',
    make: 'Vauxhall',
    model: 'Astra Sports Tourer',
    identifier: 'DEMO 123',
    acquired_on: addMonthsClamped(now, -30, 12),
    purchase_price_minor: 780_000,
    currency: 'GBP',
    current_value_minor: 610_000,
    value_as_of: addMonthsClamped(now, -2, 1),
    module: 'vehicles',
    notes: 'Timing belt done at 62,000 miles.'
  })

  const carPolicyDoc = make('document', {
    title: 'Motor insurance certificate',
    doc_type: 'policy',
    issuer_person_id: insurer,
    issued_on: addMonthsClamped(now, -4, 1),
    expires_on: addMonthsClamped(now, 8, 1),
    emergency_pack: 1,
    notes: 'Keep a copy in the car.'
  })
  attachText(
    'motor-insurance-certificate.txt',
    'CERTIFICATE OF MOTOR INSURANCE\nPolicy NG-4471-DEMO\nVehicle DEMO 123\nCover: Comprehensive\nExcess: £350\nThis is a demonstration file.',
    'document',
    carPolicyDoc
  )

  const carPolicy = make('policy', {
    name: 'Car insurance',
    kind: 'motor',
    provider_person_id: insurer,
    policy_number: 'NG-4471-DEMO',
    starts_on: addMonthsClamped(now, -4, 1),
    ends_on: addMonthsClamped(now, 8, 1),
    premium_minor: 48_600,
    currency: 'GBP',
    premium_period: 'annual',
    excess_minor: 35_000,
    document_id: carPolicyDoc,
    auto_renews: 1,
    notice_days: 14,
    cover_summary: 'Comprehensive, one named driver, 8,000 miles a year, £350 excess.'
  })

  const motSchedule = make('maintenance_schedule', {
    title: 'MOT test',
    asset_id: car,
    kind: 'test',
    interval_rule: JSON.stringify({ freq: 'yearly', interval: 1 }),
    last_done_on: addMonthsClamped(now, -11, 3),
    next_due_on: addDays(now, 24),
    reminder_lead_days: 30,
    notes: 'Book a fortnight early — the garage gets busy.'
  })
  const serviceSchedule = make('maintenance_schedule', {
    title: 'Full service',
    asset_id: car,
    kind: 'service',
    interval_rule: JSON.stringify({ freq: 'yearly', interval: 1 }),
    interval_distance: 12000,
    distance_unit: 'mi',
    last_done_on: addMonthsClamped(now, -3, 14),
    last_done_distance: 68_420,
    next_due_on: addMonthsClamped(now, 9, 14),
    next_due_distance: 80_420,
    notes: 'Whichever comes first.'
  })

  const serviceRecord = make('maintenance_record', {
    title: 'Full service and two front tyres',
    asset_id: car,
    schedule_id: serviceSchedule,
    done_on: addMonthsClamped(now, -3, 14),
    distance: 68_420,
    cost_minor: 41_250,
    currency: 'GBP',
    provider_person_id: garage,
    outcome: 'completed',
    summary: 'Oil, filters, brake fluid. Two front tyres replaced. Advisory on rear pads.'
  })
  attachText(
    'bellweather-service-invoice.txt',
    'BELLWEATHER MOTORS\nInvoice 20418\nVehicle: DEMO 123\nFull service .......... £185.00\nFront tyres x2 ........ £198.00\nBrake fluid ........... £29.50\nTOTAL ................. £412.50\nAdvisory: rear pads at 40%.\nThis is a demonstration file.',
    'maintenance_record',
    serviceRecord
  )

  for (const [monthsAgo, litres, cost, odo] of [
    [0, 41.2, 6_340, 71_050],
    [1, 44.8, 6_890, 70_420],
    [2, 39.6, 6_020, 69_680],
    [3, 43.1, 6_610, 68_950]
  ] as [number, number, number, number][]) {
    make('fuel_log', {
      asset_id: car,
      on_date: addMonthsClamped(now, -monthsAgo, 6),
      kind: 'fuel',
      quantity: litres,
      unit: 'litre',
      cost_minor: cost,
      currency: 'GBP',
      odometer: odo,
      full_tank: 1,
      location: 'Motorway services'
    })
  }
  make('odometer_reading', { asset_id: car, on_date: now, distance: 71_320, unit: 'mi', note: 'Read off the dash today' })

  const carTax = make('bill', {
    name: 'Vehicle tax',
    kind: 'bill',
    category_id: categories.Vehicle,
    account_id: current,
    amount_minor: 1_950,
    currency: 'GBP',
    anchor_date: addMonthsClamped(now, -6, 1),
    due_day: 1,
    cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
    notes: 'Paid monthly by Direct Debit.'
  })

  // Every one of these is linked to the car, which is what makes the vehicle
  // detail screen show a real total cost of ownership.
  for (const [type, id] of [
    ['policy', carPolicy],
    ['document', carPolicyDoc],
    ['maintenance_schedule', motSchedule],
    ['maintenance_schedule', serviceSchedule],
    ['maintenance_record', serviceRecord],
    ['bill', carTax]
  ] as [string, string][]) {
    if (id) repository.link('asset', car, type, id, 'belongs-to')
  }

  make('task', {
    title: 'Book the MOT',
    due_date: addDays(now, 10),
    start_date: addDays(now, 3),
    priority: 3,
    module: 'vehicles',
    effort: 'quick',
    notes: 'Bellweather Motors, 01632 960123.'
  })

  // -- Workflow 2: purchase, receipt, warranty, return, refund ---------------

  const dishwasherPurchase = make('purchase', {
    title: 'Dishwasher',
    merchant: 'Halton Electricals',
    merchant_person_id: retailer,
    purchased_on: addDays(now, -38),
    total_minor: 42_900,
    currency: 'GBP',
    order_reference: 'HE-773401',
    payment_method: 'Credit card',
    warranty_months: 24,
    warranty_ends_on: addMonthsClamped(addDays(now, -38), 24, undefined),
    return_window_days: 30,
    return_by: addDays(now, -8)
  })
  attachText(
    'halton-dishwasher-receipt.txt',
    'HALTON ELECTRICALS\nOrder HE-773401\n1 x Freestanding dishwasher ... £429.00\nPaid by credit card\n2 year manufacturer warranty\nThis is a demonstration file.',
    'purchase',
    dishwasherPurchase
  )
  const dishwasher = make('asset', {
    name: 'Dishwasher',
    asset_type: 'appliance',
    make: 'Bosch-alike',
    model: 'SMS-DEMO',
    acquired_on: addDays(now, -38),
    purchase_price_minor: 42_900,
    currency: 'GBP',
    warranty_ends_on: addMonthsClamped(addDays(now, -38), 24, undefined),
    location: 'Kitchen',
    module: 'home'
  })
  if (dishwasher && dishwasherPurchase) repository.link('purchase', dishwasherPurchase, 'asset', dishwasher, 'became')

  const headphonesPurchase = make('purchase', {
    title: 'Wireless headphones',
    merchant: 'Halton Electricals',
    merchant_person_id: retailer,
    purchased_on: addDays(now, -26),
    total_minor: 12_999,
    currency: 'GBP',
    order_reference: 'HE-778220',
    warranty_months: 12,
    warranty_ends_on: addMonthsClamped(addDays(now, -26), 12, undefined),
    return_window_days: 30,
    return_by: addDays(now, 4)
  })
  attachText(
    'halton-headphones-receipt.txt',
    'HALTON ELECTRICALS\nOrder HE-778220\n1 x Wireless headphones ... £129.99\nReturns accepted within 30 days.\nThis is a demonstration file.',
    'purchase',
    headphonesPurchase
  )

  const headphonesReturn = make('return', {
    purchase_id: headphonesPurchase,
    item_name: 'Wireless headphones',
    reason: 'Right earcup crackles.',
    opened_on: addDays(now, -19),
    deadline_on: addDays(now, 4),
    method: 'post',
    sent_on: addDays(now, -17),
    received_by_merchant_on: addDays(now, -14),
    refund_expected_minor: 12_999,
    currency: 'GBP',
    status: 'received',
    reference: 'RMA-88213',
    notes: 'Sent back tracked. The refund has NOT arrived yet — Orbit will keep saying so until it does.'
  })
  const returnParcel = make('parcel', {
    description: 'Headphones going back',
    carrier: 'Postal service',
    tracking_number: 'DEMO9911223344GB',
    direction: 'outbound',
    dispatched_on: addDays(now, -17),
    delivered_on: addDays(now, -14),
    status: 'delivered',
    purchase_id: headphonesPurchase,
    return_id: headphonesReturn
  })
  const chase = make('correspondence', {
    subject: 'Chasing the headphone refund',
    direction: 'sent',
    person_id: retailer,
    on_date: addDays(now, -5),
    channel: 'email',
    reference: 'RMA-88213',
    summary: 'Asked when the refund would be processed. They said within five working days.',
    response_due_by: addDays(now, 0)
  })
  if (headphonesReturn && chase) repository.link('return', headphonesReturn, 'correspondence', chase, 'about')
  if (headphonesReturn && returnParcel) repository.link('return', headphonesReturn, 'parcel', returnParcel, 'shipped-as')

  make('task', {
    title: 'Chase the headphone refund again',
    status: 'waiting',
    waiting_kind: 'refund',
    waiting_person_id: retailer,
    waiting_since: addDays(now, -17),
    waiting_expected_by: addDays(now, -3),
    waiting_chased_on: addDays(now, -5),
    due_date: addDays(now, 1),
    priority: 3
  })

  // -- Workflow 3: a trip with bookings, tasks and a budget ------------------

  const trip = make('trip', {
    title: 'A week in Portugal',
    destination: 'Lisbon and the Algarve',
    country: 'Portugal',
    starts_on: addDays(now, 63),
    ends_on: addDays(now, 70),
    purpose: 'leisure',
    budget_minor: 180_000,
    currency: 'GBP',
    status: 'booked',
    notes: 'Two adults and one child.'
  })
  const flight = make('trip_booking', {
    trip_id: trip,
    kind: 'flight',
    title: 'Flights to Lisbon',
    reference: 'DEMO-FLT-4417',
    provider: 'Iberian Air (demo)',
    starts_on: addDays(now, 63),
    starts_time: '07:20',
    ends_on: addDays(now, 63),
    ends_time: '10:05',
    timezone: 'Europe/London',
    from_place: 'Bristol',
    to_place: 'Lisbon',
    cost_minor: 62_400,
    currency: 'GBP',
    status: 'booked'
  })
  const hotel = make('trip_booking', {
    trip_id: trip,
    kind: 'hotel',
    title: 'Apartment in Lagos',
    reference: 'DEMO-STAY-8891',
    provider: 'Costa Stays (demo)',
    starts_on: addDays(now, 64),
    ends_on: addDays(now, 70),
    cost_minor: 71_000,
    currency: 'GBP',
    status: 'booked'
  })
  attachText(
    'lisbon-flight-confirmation.txt',
    'BOOKING CONFIRMATION DEMO-FLT-4417\nBristol to Lisbon\n2 adults, 1 child\nTotal £624.00\nThis is a demonstration file.',
    'trip_booking',
    flight
  )
  for (const item of ['Passports', 'Travel adaptors', 'Sun cream', "Robin's swimming things", 'Insurance documents']) {
    make('packing_item', { trip_id: trip, name: item, category: 'Essentials', quantity: 1 })
  }
  make('task', { title: 'Check the passports are in date', due_date: addDays(now, 14), priority: 4, module: 'travel', notes: 'Some countries want six months left on them.' })
  make('task', { title: 'Arrange travel insurance', due_date: addDays(now, 21), priority: 3, module: 'travel' })
  make('task', { title: 'Order euros', due_date: addDays(now, 55), module: 'travel', effort: 'quick' })
  make('task', { title: 'Book airport parking', due_date: addDays(now, 40), module: 'travel' })

  // -- The rest of a life ----------------------------------------------------

  const passport = make('document', {
    title: "Sam's passport",
    doc_type: 'passport',
    person_id: me,
    issued_on: addMonthsClamped(now, -80, 4),
    expires_on: addMonthsClamped(now, 34, 4),
    emergency_pack: 1,
    sensitive: 1
  })
  make('document', {
    title: 'Boiler service certificate',
    doc_type: 'certificate',
    issued_on: addMonthsClamped(now, -7, 12),
    expires_on: addMonthsClamped(now, 5, 12),
    notes: 'Annual service due again in the spring.'
  })

  const boiler = make('asset', {
    name: 'Boiler',
    asset_type: 'appliance',
    make: 'Worcester-alike',
    acquired_on: addMonthsClamped(now, -60, 1),
    location: 'Airing cupboard',
    module: 'home'
  })
  make('maintenance_schedule', {
    title: 'Annual boiler service',
    asset_id: boiler,
    kind: 'service',
    interval_rule: JSON.stringify({ freq: 'yearly', interval: 1, fromCompletion: true }),
    last_done_on: addMonthsClamped(now, -7, 12),
    next_due_on: addMonthsClamped(now, 5, 12),
    reminder_lead_days: 30
  })
  make('consumable', {
    name: 'Smoke alarm batteries',
    asset_id: boiler,
    interval_days: 365,
    last_replaced_on: addMonthsClamped(now, -11, 2),
    next_due_on: addMonthsClamped(now, 1, 2),
    spec: '9V PP3 x3'
  })

  const kitchen = make('room', { name: 'Kitchen', floor: 'Ground', area_sqm: 14.5, dimensions: '4.2m x 3.4m' })
  make('decor_record', {
    room_id: kitchen,
    surface: 'Walls',
    brand: 'Farrow-alike',
    colour_name: 'Slipware',
    colour_code: 'SW-233',
    finish: 'Matt emulsion',
    quantity: '5 litres covered two coats',
    purchased_on: addMonthsClamped(now, -14, 3)
  })

  const meter = make('meter', { name: 'Electricity meter', kind: 'electricity', unit: 'kWh', supplier_person_id: energy, bill_id: energyBill })
  for (let i = 5; i >= 0; i--) {
    make('meter_reading', { meter_id: meter, on_date: addMonthsClamped(now, -i, 3), reading: 34_120 + (5 - i) * 265 })
  }

  make('budget', { name: 'Groceries', category_id: categories.Groceries, limit_minor: 48_000, currency: 'GBP', period: 'monthly' })
  make('budget', { name: 'Eating out', category_id: categories['Eating out'], limit_minor: 12_000, currency: 'GBP', period: 'monthly' })
  make('budget', { name: 'Transport', category_id: categories.Transport, limit_minor: 16_000, currency: 'GBP', period: 'monthly' })

  make('savings_goal', {
    name: 'Car insurance renewal',
    kind: 'sinking-fund',
    target_minor: 48_600,
    currency: 'GBP',
    target_date: addMonthsClamped(now, 8, 1),
    annual_expense_minor: 48_600,
    contribution_minor: 4_050,
    contribution_period: 'monthly',
    account_id: savings,
    notes: 'So the renewal is not a shock.'
  })
  make('savings_goal', {
    name: 'Emergency fund',
    kind: 'emergency',
    target_minor: 600_000,
    currency: 'GBP',
    account_id: savings
  })

  make('money_agreement', {
    direction: 'lent',
    person_id: partner,
    reason: 'Concert tickets',
    amount_minor: 8_400,
    currency: 'GBP',
    started_on: addDays(now, -40),
    due_date: addDays(now, -5),
    status: 'open'
  })

  make('payroll_profile', {
    name: 'Main job',
    employer: 'Kestrel Logistics',
    person_id: me,
    salary_minor: 3_450_000,
    bonus_minor: 0,
    currency: 'GBP',
    frequency: 'monthly',
    payday: addMonthsClamped(now, 1, 25),
    region: 'rUK',
    tax_code: '1257L',
    ni_category: 'A',
    pension_rate_bp: 500,
    pension_type: 'salary-sacrifice',
    student_plan: 'plan2',
    postgraduate: 0,
    tax_year: '2025-26',
    active: 1
  })

  make('expense_claim', {
    title: 'Train fare to the Leeds office',
    kind: 'work-expense',
    amount_minor: 8_760,
    currency: 'GBP',
    incurred_on: addDays(now, -22),
    submitted_on: addDays(now, -20),
    expected_by: addDays(now, -1),
    status: 'chased',
    reference: 'EXP-4412'
  })

  make('voucher', {
    label: 'Bookshop gift card',
    kind: 'gift-card',
    issuer: 'Cornerstone Books',
    balance_minor: 2_500,
    currency: 'GBP',
    expires_on: addDays(now, 33),
    code_hint: '…4417'
  })

  make('wishlist_item', {
    title: 'Cordless drill',
    target_minor: 8_900,
    currency: 'GBP',
    merchant: 'Halton Electricals',
    cooling_off_until: addDays(now, 12),
    priority: 2,
    notes: 'Wait and see whether the old one really is dead.'
  })

  // Health, family and pets
  make('health_record', {
    title: 'Dental check-up',
    person_id: me,
    kind: 'check-up',
    category: 'dental',
    on_date: addMonthsClamped(now, -5, 9),
    next_due_on: addDays(now, 18),
    outcome: 'All fine.'
  })
  make('medication', {
    name: 'Hay fever tablets',
    person_id: me,
    dose: '10mg',
    form: 'Tablet',
    active: 1,
    quantity_remaining: 12,
    next_refill_on: addDays(now, 6),
    refill_reminder_days: 7
  })
  make('measurement', { person_id: me, metric: 'Weight', on_date: addDays(now, -7), value: 78.4, unit: 'kg' })

  const pet = make('pet', {
    name: 'Biscuit',
    species: 'Cat',
    breed: 'Domestic shorthair',
    date_of_birth: addMonthsClamped(now, -44, 6),
    microchip: '900DEMO0001234',
    vet_person_id: null
  })
  make('pet_record', {
    pet_id: pet,
    kind: 'vaccination',
    title: 'Annual booster',
    on_date: addMonthsClamped(now, -11, 20),
    next_due_on: addDays(now, 28),
    cost_minor: 5_800,
    currency: 'GBP'
  })
  make('care_routine', {
    subject_type: 'pet',
    subject_id: pet,
    title: 'Morning feed',
    time_of_day: '07:30',
    instructions: 'Half a pouch and fresh water. She will tell you she has not been fed. She has.',
    handover: 1
  })

  make('school_record', {
    person_id: child,
    kind: 'trip',
    title: 'Museum trip',
    on_date: addDays(now, 26),
    due_by: addDays(now, 6),
    amount_minor: 1_250,
    currency: 'GBP',
    school: 'Elmsgate Primary',
    notes: 'Permission slip and payment.'
  })
  make('chore', { title: 'Put the bins out', assignee_person_id: partner, area: 'Outside', schedule_rule: JSON.stringify({ freq: 'weekly', interval: 1, byWeekday: [2] }) })
  make('chore', { title: 'Feed the cat', assignee_person_id: child, points: 5, reward_minor: 100, currency: 'GBP', area: 'Kitchen' })

  make('dietary_preference', { person_id: child, kind: 'allergy', detail: 'Peanuts', severity: 'severe' })

  // Food
  const list = make('shopping_list', { name: 'Weekly shop', kind: 'groceries' })
  for (const item of ['Milk', 'Bread', 'Coffee', 'Washing-up liquid', 'Apples']) {
    make('shopping_item', { list_id: list, name: item, quantity: 1 })
  }
  make('pantry_item', { name: 'Chicken thighs', location: 'freezer', quantity: 2, unit: 'packs', expires_on: addDays(now, 21) })
  make('pantry_item', { name: 'Double cream', location: 'fridge', quantity: 1, unit: 'pot', expires_on: addDays(now, 2) })
  make('recipe', {
    title: 'Weeknight chicken traybake',
    servings: 4,
    prep_minutes: 10,
    cook_minutes: 40,
    cost_estimate_minor: 620,
    currency: 'GBP',
    favourite: 1,
    ingredients: 'Chicken thighs, new potatoes, lemon, rosemary, olive oil',
    method: 'Everything in one tin. 200°C for 40 minutes. Do not fuss with it.'
  })

  // Digital
  make('device', {
    name: 'Laptop',
    kind: 'computer',
    model: 'Demo Book 14',
    purchased_on: addMonthsClamped(now, -18, 5),
    warranty_ends_on: addMonthsClamped(now, 6, 5),
    backup_frequency_days: 7,
    last_backup_on: addDays(now, -11),
    next_backup_on: addDays(now, -4)
  })
  make('domain', {
    name: 'whitfield-demo.example',
    registrar: 'Demo Registrar',
    registered_on: addMonthsClamped(now, -22, 2),
    expires_on: addDays(now, 41),
    auto_renew: 0,
    cost_minor: 1_400,
    currency: 'GBP'
  })
  make('digital_account', {
    service: 'Marlow Bank',
    url: 'https://example.invalid',
    category: 'Banking',
    has_2fa: 1,
    twofa_method: 'App',
    importance: 'critical',
    password_manager: 'Kept in the password manager, not here.',
    recovery_notes: 'Recovery is by phone call to the branch. Codes are in the password manager.'
  })

  // Occasions and gifts
  make('occasion', { title: "Jo's birthday", person_id: partner, kind: 'birthday', on_date: addMonthsClamped(now, 2, 14), lead_days: 21, budget_minor: 6_000, currency: 'GBP' })
  make('gift_idea', { title: 'Pottery class', person_id: partner, estimated_minor: 5_500, currency: 'GBP', status: 'idea', notes: 'Mentioned it twice in a fortnight.' })

  // A handful of habits and notes
  make('habit', { title: 'Walk 20 minutes', cadence: 'daily', active: 1 })
  make('habit', { title: 'Weekly admin half-hour', cadence: 'weekly', active: 1, recurrence: JSON.stringify({ freq: 'weekly', interval: 1, byWeekday: [0] }) })
  make('note', { title: 'Bin days', body: 'General waste Tuesday. Recycling alternate Fridays.', pinned: 1 })
  make('note', { title: 'Stopcock', body: 'Under the sink, behind the cleaning things.', pinned: 1 })

  // -- Transactions: six months of plausible life ---------------------------

  const transactions: [number, number, string, number, string, string][] = []
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    transactions.push([monthsAgo, 25, 'Salary', 248_500, 'income', categories.Salary ?? ''])
    transactions.push([monthsAgo, 1, 'Rent', -95_000, 'expense', categories.Housing ?? ''])
    transactions.push([monthsAgo, 8, 'Riverstone Energy', -11_400, 'expense', categories.Utilities ?? ''])
    transactions.push([monthsAgo, 18, 'Broadband', -3_499, 'expense', categories.Utilities ?? ''])
    transactions.push([monthsAgo, 4, 'Weekly shop', -8_640, 'expense', categories.Groceries ?? ''])
    transactions.push([monthsAgo, 11, 'Weekly shop', -9_215, 'expense', categories.Groceries ?? ''])
    transactions.push([monthsAgo, 19, 'Weekly shop', -7_980, 'expense', categories.Groceries ?? ''])
    transactions.push([monthsAgo, 26, 'Weekly shop', -10_340, 'expense', categories.Groceries ?? ''])
    transactions.push([monthsAgo, 6, 'Fuel', -6_340, 'expense', categories.Vehicle ?? ''])
    transactions.push([monthsAgo, 15, 'Coffee and lunch', -1_780, 'expense', categories['Eating out'] ?? ''])
    transactions.push([monthsAgo, 22, 'Streaming', -1_099, 'expense', categories.Subscriptions ?? ''])
    transactions.push([monthsAgo, 1, 'Gym', -3_200, 'expense', categories.Health ?? ''])
    transactions.push([monthsAgo, 28, 'Into savings', -20_000, 'transfer', ''])
  }
  transactions.push([3, 14, 'Bellweather Motors — service', -41_250, 'expense', categories.Vehicle ?? ''])
  transactions.push([1, 12, 'Halton Electricals — dishwasher', -42_900, 'expense', categories.Home ?? ''])
  transactions.push([0, 21, 'Halton Electricals — headphones', -12_999, 'expense', categories.Shopping ?? ''])

  let txCount = 0
  for (const [monthsAgo, day, description, amount, kind, categoryId] of transactions) {
    const date = addMonthsClamped(now, -monthsAgo, day)
    if (date > now) continue
    const result = repository.create(
      'transaction',
      {
        account_id: current,
        date,
        description,
        amount_minor: amount,
        currency: 'GBP',
        kind,
        status: 'actual',
        category_id: categoryId || null,
        cleared: 1
      },
      { silent: true, source: 'demo' }
    )
    if (result.ok) txCount += 1
  }
  created.transaction = txCount

  // Link the service invoice transaction to the car for the cost rollup.
  const serviceTx = repository.list<{ id: string }>('transaction', {
    search: 'Bellweather',
    limit: 1
  }).rows[0]
  if (serviceTx && car) {
    repository.update('transaction', serviceTx.id, { asset_id: car } as Record<string, unknown>, { silent: true })
  }

  // Mark past bill periods as paid. Without this the demonstration would show
  // every bill as overdue since the day it was set up, which is both wrong and
  // a poor advertisement for a product about staying on top of things.
  try {
    const bills = db.all<{
      id: string
      name: string
      amount_minor: number
      currency: string
      cadence: string
      anchor_date: string
      due_day: number | null
      status: string
    }>('SELECT id, name, amount_minor, currency, cadence, anchor_date, due_day, status FROM bills')
    const stamp = new Date().toISOString()
    let paidCount = 0
    for (const bill of bills) {
      const occurrences = billOccurrences(
        {
          id: bill.id,
          name: bill.name,
          amountMinor: bill.amount_minor,
          currency: bill.currency,
          cadence: bill.cadence,
          anchorDate: bill.anchor_date,
          dueDay: bill.due_day,
          status: bill.status
        },
        addMonthsClamped(now, -9, 1),
        addDays(now, -1)
      )
      for (const occurrence of occurrences) {
        db.run(
          `INSERT OR IGNORE INTO bill_payments
             (id, bill_id, period_key, due_date, amount_minor, currency, paid_on, transaction_id, status, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'paid', '', ?, ?)`,
          [
            newId('bp'),
            bill.id,
            occurrence.periodKey,
            occurrence.dueDate,
            occurrence.amountMinor,
            occurrence.currency,
            occurrence.dueDate,
            stamp,
            stamp
          ]
        )
        paidCount += 1
      }
    }
    created.bill_payment = paidCount
  } catch (err) {
    log.warn('demo', 'could not record past bill payments', err)
  }

  return {
    created,
    notes: [
      'This is a demonstration vault. Nothing in it is real.',
      'The car shows its insurance, MOT, service history and running costs together.',
      'The headphones show a return that has been sent but NOT yet refunded — Orbit keeps saying so until the money arrives.',
      'The electricity bill appears in Today and in Money from the same record.'
    ]
  }
}
