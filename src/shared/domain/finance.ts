/**
 * Orbit's finance engine, derived from the Amethyst Money prototype.
 *
 * Everything here is a pure function over integer minor units. No dates are
 * read from the clock, no rounding happens in floating point, and every
 * calculation that rests on an assumption returns that assumption alongside the
 * number so the interface can show it.
 *
 * What is carried over from Amethyst: the UK payroll model (tax code, region,
 * National Insurance category, pension treatment, student loan plan, pay
 * frequency), the budget-versus-spend comparison, the bill due-day arithmetic,
 * and the lending ledger with its outstanding balance, overdue test and
 * repayment-history projection.
 *
 * What is fixed relative to Amethyst: the payroll maths ran in whole pounds as
 * floating-point numbers while transactions were held in pence, so a salary of
 * £30,000.50 could not be represented and every result was subject to binary
 * rounding. Orbit does the whole calculation in minor units with integer
 * arithmetic, so it is exact and reproducible.
 */

import { scaleMinor, sumMinor } from './money.js'
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  daysInMonth,
  parseCalendarDate,
  type CalendarDate
} from './time.js'
import { expandRecurrence, normaliseRule, type RecurrenceRule } from './recurrence.js'

// ---------------------------------------------------------------------------
// UK payroll
// ---------------------------------------------------------------------------

export type PayFrequency = 'weekly' | 'fortnightly' | '4weekly' | 'monthly' | 'annual'
export type TaxRegion = 'rUK' | 'scotland'
export type PensionType = 'none' | 'relief-at-source' | 'net-pay' | 'salary-sacrifice'
export type StudentPlan = 'none' | 'plan1' | 'plan2' | 'plan4' | 'plan5'

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  '4weekly': 13,
  monthly: 12,
  annual: 1
}

/**
 * Tax rules for a given year, in WHOLE POUNDS. Multiplied up to minor units
 * before use, so the published thresholds stay legible against HMRC's own
 * tables and a future year can be added by copying this block.
 *
 * These figures are the ones the Amethyst prototype used, which correspond to
 * the 2025/26 UK tax year. They are reproduced here as the prototype had them;
 * they have NOT been re-verified against HMRC for this build, and Orbit labels
 * every payroll figure as an estimate for exactly that reason. Anyone relying
 * on a payslip should compare it with the payslip.
 */
export interface TaxYearRules {
  label: string
  personalAllowance: number
  /** Allowance is reduced by £1 for every £2 of income above this. */
  taperThreshold: number
  ruk: [number, number][]
  scotland: [number, number][]
  niPrimaryThreshold: number
  niUpperEarningsLimit: number
  niRates: Record<string, [number, number]>
  employerNiThreshold: number
  employerNiRate: number
  studentThresholds: Record<Exclude<StudentPlan, 'none'>, number>
  studentRate: number
  postgraduateThreshold: number
  postgraduateRate: number
}

export const TAX_YEARS: Record<string, TaxYearRules> = {
  '2025-26': {
    label: '2025/26',
    personalAllowance: 12570,
    taperThreshold: 100000,
    // [upper bound of band measured from £0 of TAXABLE pay, rate]
    ruk: [
      [37700, 0.2],
      [125140, 0.4],
      [Number.POSITIVE_INFINITY, 0.45]
    ],
    scotland: [
      [3967, 0.19],
      [16956, 0.2],
      [31092, 0.21],
      [62430, 0.42],
      [125140, 0.45],
      [Number.POSITIVE_INFINITY, 0.48]
    ],
    niPrimaryThreshold: 12570,
    niUpperEarningsLimit: 50270,
    niRates: {
      A: [0.08, 0.02],
      B: [0.0185, 0.02],
      C: [0, 0],
      J: [0.02, 0.02]
    },
    employerNiThreshold: 5000,
    employerNiRate: 0.15,
    studentThresholds: { plan1: 26900, plan2: 29385, plan4: 33795, plan5: 25000 },
    studentRate: 0.09,
    postgraduateThreshold: 21000,
    postgraduateRate: 0.06
  }
}

export const DEFAULT_TAX_YEAR = '2025-26'

export interface TaxCodeInfo {
  /** A flat rate on all pay (BR, D0, D1), or null for the normal band system. */
  flatRate: number | null
  /** Allowance in whole pounds; negative for a K code. */
  allowance: number
  description: string
}

/**
 * Interpret a UK tax code.
 *
 * Handles the S (Scottish) and C (Welsh) prefixes, the flat-rate codes and K
 * codes (which represent untaxed income and therefore a negative allowance).
 * An unrecognised code falls back to the standard allowance rather than
 * silently taxing everything.
 */
export function parseTaxCode(code: string, rules: TaxYearRules = TAX_YEARS[DEFAULT_TAX_YEAR] as TaxYearRules): TaxCodeInfo {
  const clean = String(code || '')
    .toUpperCase()
    .replace(/\s/g, '')
    .replace(/^[SC]/, '')
  if (clean === 'BR') return { flatRate: 0.2, allowance: 0, description: 'All pay taxed at the basic rate' }
  if (clean === 'D0') return { flatRate: 0.4, allowance: 0, description: 'All pay taxed at the higher rate' }
  if (clean === 'D1') return { flatRate: 0.45, allowance: 0, description: 'All pay taxed at the additional rate' }
  if (clean === 'NT') return { flatRate: 0, allowance: 0, description: 'No tax deducted' }
  if (clean === '0T') return { flatRate: null, allowance: 0, description: 'No personal allowance' }

  const digits = clean.match(/\d+/)
  if (!digits) {
    return {
      flatRate: null,
      allowance: rules.personalAllowance,
      description: 'Tax code not recognised; the standard allowance has been assumed'
    }
  }
  const value = Number(digits[0]) * 10
  const isK = clean.startsWith('K')
  return {
    flatRate: null,
    allowance: isK ? -value : value,
    description: isK ? 'K code: untaxed income added to your pay' : 'Standard tax code'
  }
}

/**
 * Tax charged by slicing an amount through cumulative bands.
 * `bands` are [upperBound, rate] pairs measured from zero, in minor units.
 */
export function bandedTax(amountMinor: number, bands: readonly [number, number][]): number {
  let tax = 0
  let previous = 0
  for (const [limit, rate] of bands) {
    const slice = Math.max(0, Math.min(amountMinor, limit) - previous)
    tax += scaleMinor(slice, rate)
    previous = limit
    if (amountMinor <= limit) break
  }
  return tax
}

export interface PayrollInput {
  salaryMinor: number
  bonusMinor: number
  frequency: PayFrequency
  region: TaxRegion
  taxCode: string
  niCategory: string
  /** Pension contribution as basis points of gross (500 = 5%). */
  pensionRateBp: number
  pensionType: PensionType
  studentPlan: StudentPlan
  postgraduate: boolean
  taxYear: string
}

export interface PayrollBreakdown {
  taxYear: string
  annualGrossMinor: number
  pensionMinor: number
  taxableGrossMinor: number
  allowanceMinor: number
  taxableMinor: number
  incomeTaxMinor: number
  nationalInsuranceMinor: number
  employerNiMinor: number
  studentLoanMinor: number
  postgraduateLoanMinor: number
  annualNetMinor: number
  periodsPerYear: number
  periodGrossMinor: number
  periodNetMinor: number
  effectiveRateBp: number
  /** Every assumption behind the numbers, for display next to them. */
  assumptions: string[]
  taxCode: TaxCodeInfo
}

export function calculatePayroll(input: PayrollInput): PayrollBreakdown {
  const rules = TAX_YEARS[input.taxYear] ?? (TAX_YEARS[DEFAULT_TAX_YEAR] as TaxYearRules)
  const yearKey = TAX_YEARS[input.taxYear] ? input.taxYear : DEFAULT_TAX_YEAR
  const P = 100 // minor units per pound, for scaling the published thresholds
  const assumptions: string[] = []

  const annualGross = Math.max(0, Math.round(input.salaryMinor)) + Math.max(0, Math.round(input.bonusMinor))

  const pensionRate = Math.max(0, input.pensionRateBp) / 10000
  const rawPension = scaleMinor(annualGross, pensionRate)
  const pension = input.pensionType === 'none' ? 0 : rawPension

  // Salary sacrifice and net-pay arrangements reduce taxable pay; relief at
  // source does not (the relief is claimed by the pension provider instead).
  const reducesTaxable = input.pensionType === 'salary-sacrifice' || input.pensionType === 'net-pay'
  const taxableGross = Math.max(0, annualGross - (reducesTaxable ? pension : 0))
  // Only salary sacrifice reduces National Insurance.
  const niGross = Math.max(0, annualGross - (input.pensionType === 'salary-sacrifice' ? pension : 0))

  const codeInfo = parseTaxCode(input.taxCode, rules)
  let allowance = codeInfo.allowance * P
  if (codeInfo.flatRate === null && allowance > 0 && taxableGross > rules.taperThreshold * P) {
    const excess = taxableGross - rules.taperThreshold * P
    const reduction = Math.floor(excess / 2)
    const before = allowance
    allowance = Math.max(0, allowance - reduction)
    if (allowance < before) {
      assumptions.push(
        'Personal allowance reduced by £1 for every £2 of income above £' +
          rules.taperThreshold.toLocaleString('en-GB')
      )
    }
  }

  const taxable = Math.max(0, taxableGross - allowance)
  let incomeTax: number
  if (codeInfo.flatRate !== null) {
    incomeTax = scaleMinor(taxableGross, codeInfo.flatRate)
    assumptions.push(`Tax code ${input.taxCode.toUpperCase()}: ${codeInfo.description.toLowerCase()}`)
  } else {
    const bands = (input.region === 'scotland' ? rules.scotland : rules.ruk).map(
      ([limit, rate]) => [limit === Number.POSITIVE_INFINITY ? limit : limit * P, rate] as [number, number]
    )
    incomeTax = bandedTax(taxable, bands)
    assumptions.push(
      input.region === 'scotland' ? 'Scottish income tax rates applied' : 'Income tax rates for England, Wales and Northern Ireland applied'
    )
  }

  const niRates = rules.niRates[input.niCategory] ?? (rules.niRates.A as [number, number])
  const niMainBand = Math.max(0, Math.min(niGross, rules.niUpperEarningsLimit * P) - rules.niPrimaryThreshold * P)
  const niUpperBand = Math.max(0, niGross - rules.niUpperEarningsLimit * P)
  const nationalInsurance = scaleMinor(niMainBand, niRates[0]) + scaleMinor(niUpperBand, niRates[1])
  const employerNi = scaleMinor(Math.max(0, niGross - rules.employerNiThreshold * P), rules.employerNiRate)

  const studentLoan =
    input.studentPlan === 'none'
      ? 0
      : scaleMinor(
          Math.max(0, annualGross - rules.studentThresholds[input.studentPlan] * P),
          rules.studentRate
        )
  const postgraduateLoan = input.postgraduate
    ? scaleMinor(Math.max(0, annualGross - rules.postgraduateThreshold * P), rules.postgraduateRate)
    : 0

  const cashPension = input.pensionType === 'none' ? 0 : pension
  const annualNet = annualGross - cashPension - incomeTax - nationalInsurance - studentLoan - postgraduateLoan
  const periods = PERIODS_PER_YEAR[input.frequency]

  assumptions.unshift(`Based on ${rules.label} UK rates`)
  // Orbit has no network and will not guess at rates it has not been given.
  // If somebody asks for a tax year that is not in the table, say so plainly
  // rather than quietly answering a different question.
  if (input.taxYear && !TAX_YEARS[input.taxYear]) {
    assumptions.push(
      `Rates for ${input.taxYear} are not built in, so ${rules.label} rates were used instead. ` +
        'Orbit never fetches rates, so a new tax year has to be added to the application.'
    )
  }
  assumptions.push('An estimate. Your payslip is the authority, not this figure.')
  if (input.pensionType === 'salary-sacrifice') {
    assumptions.push('Salary sacrifice assumed to reduce both taxable pay and National Insurance')
  } else if (input.pensionType === 'net-pay') {
    assumptions.push('Net-pay pension assumed to reduce taxable pay but not National Insurance')
  } else if (input.pensionType === 'relief-at-source') {
    assumptions.push('Relief-at-source pension taken from net pay; basic-rate relief is added by your provider')
  }
  assumptions.push('Assumes the same pay in every period and no mid-year changes')

  return {
    taxYear: yearKey,
    annualGrossMinor: annualGross,
    pensionMinor: cashPension,
    taxableGrossMinor: taxableGross,
    allowanceMinor: allowance,
    taxableMinor: taxable,
    incomeTaxMinor: incomeTax,
    nationalInsuranceMinor: nationalInsurance,
    employerNiMinor: employerNi,
    studentLoanMinor: studentLoan,
    postgraduateLoanMinor: postgraduateLoan,
    annualNetMinor: annualNet,
    periodsPerYear: periods,
    periodGrossMinor: Math.round(annualGross / periods),
    periodNetMinor: Math.round(annualNet / periods),
    effectiveRateBp:
      annualGross > 0
        ? Math.round(((incomeTax + nationalInsurance + studentLoan + postgraduateLoan) / annualGross) * 10000)
        : 0,
    assumptions,
    taxCode: codeInfo
  }
}

/** The next `count` paydays from an anchor, honouring month-end clamping. */
export function nextPaydays(
  anchor: CalendarDate,
  frequency: PayFrequency,
  from: CalendarDate,
  count = 6
): CalendarDate[] {
  const anchorDay = parseCalendarDate(anchor).day
  const step = (date: CalendarDate, k: number): CalendarDate | null => {
    switch (frequency) {
      case 'monthly':
        return addMonthsClamped(date, k, anchorDay)
      case '4weekly':
        return addDays(date, 28 * k)
      case 'fortnightly':
        return addDays(date, 14 * k)
      case 'weekly':
        return addDays(date, 7 * k)
      case 'annual':
        return addMonthsClamped(date, 12 * k, anchorDay)
      default:
        return null
    }
  }
  let first = anchor
  let guard = 0
  while (first < from && guard++ < 2000) {
    const next = step(first, 1)
    if (!next || next === first) break
    first = next
  }
  const out: CalendarDate[] = []
  for (let i = 0; i < count; i++) {
    const date = step(first, i)
    if (!date) break
    out.push(date)
  }
  return out
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

/**
 * Days until a monthly bill's next due date, clamped to the end of short
 * months. A bill due on the 31st is due on 28 February, not 3 March.
 *
 * Carried over from Amethyst, which got this right.
 */
export function daysUntilMonthlyDue(dueDay: number, today: CalendarDate): number {
  const day = Math.min(31, Math.max(1, Math.round(dueDay) || 1))
  const { year, month } = parseCalendarDate(today)
  const at = (y: number, m: number): CalendarDate => {
    const last = daysInMonth(y, m)
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
  }
  let target = at(year, month)
  if (target < today) {
    target = month === 12 ? at(year + 1, 1) : at(year, month + 1)
  }
  return daysBetween(today, target)
}

export interface BillLike {
  id: string
  name: string
  amountMinor: number
  currency: string
  cadence: string
  anchorDate: CalendarDate
  dueDay: number | null
  status: string
}

export interface BillOccurrence {
  billId: string
  name: string
  dueDate: CalendarDate
  periodKey: string
  amountMinor: number
  currency: string
}

/** Period key for a due date: the string a bill_payments row is keyed on. */
export function billPeriodKey(dueDate: CalendarDate, cadence: RecurrenceRule | null): string {
  if (!cadence) return dueDate
  switch (cadence.freq) {
    case 'yearly':
      return dueDate.slice(0, 4)
    case 'monthly':
      return dueDate.slice(0, 7)
    default:
      return dueDate
  }
}

/** Expand a bill's schedule into due dates inside a window. */
export function billOccurrences(bill: BillLike, from: CalendarDate, to: CalendarDate): BillOccurrence[] {
  if (bill.status !== 'active') return []
  let rule: RecurrenceRule | null = null
  if (bill.cadence) {
    try {
      rule = normaliseRule(JSON.parse(bill.cadence) as Partial<RecurrenceRule>)
    } catch {
      rule = null
    }
  }
  if (!rule) {
    // A bill with only a due day is monthly, the Amethyst default.
    rule = normaliseRule({ freq: 'monthly', interval: 1 })
  }
  const dates = expandRecurrence(bill.anchorDate, rule, from, to, 200)
  return dates.map((dueDate) => ({
    billId: bill.id,
    name: bill.name,
    dueDate,
    periodKey: billPeriodKey(dueDate, rule),
    amountMinor: bill.amountMinor,
    currency: bill.currency
  }))
}

// ---------------------------------------------------------------------------
// Money lent and borrowed
// ---------------------------------------------------------------------------

export interface AgreementLike {
  id: string
  direction: 'lent' | 'borrowed'
  amountMinor: number
  dueDate: string | null
  status: string
}

export function outstandingMinor(amountMinor: number, repayments: readonly { amountMinor: number }[]): number {
  const paid = sumMinor(repayments.map((r) => r.amountMinor))
  return Math.max(0, amountMinor - paid)
}

export function isOverdue(agreement: AgreementLike, outstanding: number, today: CalendarDate): boolean {
  return outstanding > 0 && Boolean(agreement.dueDate) && (agreement.dueDate as string) < today
}

/**
 * How late this person has typically been, from their settled agreements.
 *
 * Only fully-settled agreements with a due date contribute, so an outstanding
 * loan cannot flatter or damn somebody's record. Shown as history, never as a
 * judgement: "Rob has settled two loans an average of 9 days late."
 */
export function latenessProfile(
  settled: readonly { dueDate: string | null; finalRepaymentDate: string | null }[]
): { averageDaysLate: number; sampleSize: number } {
  const samples: number[] = []
  for (const item of settled) {
    if (!item.dueDate || !item.finalRepaymentDate) continue
    samples.push(Math.max(0, daysBetween(item.dueDate, item.finalRepaymentDate)))
  }
  if (samples.length === 0) return { averageDaysLate: 0, sampleSize: 0 }
  return {
    averageDaysLate: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    sampleSize: samples.length
  }
}

/** Projected settlement date from a person's history. Clearly an estimate. */
export function projectSettlement(
  dueDate: string | null,
  profile: { averageDaysLate: number; sampleSize: number }
): { date: string; basis: string } | null {
  if (!dueDate) return null
  if (profile.sampleSize === 0) {
    return { date: dueDate, basis: 'the agreed date — no repayment history yet' }
  }
  return {
    date: addDays(dueDate, profile.averageDaysLate),
    basis: `the agreed date plus ${profile.averageDaysLate} day${profile.averageDaysLate === 1 ? '' : 's'}, from ${profile.sampleSize} settled loan${profile.sampleSize === 1 ? '' : 's'}`
  }
}

// ---------------------------------------------------------------------------
// Budgets, spending and net worth
// ---------------------------------------------------------------------------

export interface BudgetProgress {
  budgetId: string
  categoryId: string
  limitMinor: number
  spentMinor: number
  remainingMinor: number
  /** Basis points of the limit used; 10000 = exactly on budget. */
  usedBp: number
  overspent: boolean
  currency: string
}

export function budgetProgress(
  budget: { id: string; categoryId: string; limitMinor: number; currency: string },
  spentMinor: number
): BudgetProgress {
  const remaining = budget.limitMinor - spentMinor
  return {
    budgetId: budget.id,
    categoryId: budget.categoryId,
    limitMinor: budget.limitMinor,
    spentMinor,
    remainingMinor: remaining,
    usedBp: budget.limitMinor > 0 ? Math.round((spentMinor / budget.limitMinor) * 10000) : 0,
    overspent: remaining < 0,
    currency: budget.currency
  }
}

export interface NetWorthLine {
  label: string
  amountMinor: number
  kind: 'asset' | 'liability'
}

export function netWorth(lines: readonly NetWorthLine[]): {
  assetsMinor: number
  liabilitiesMinor: number
  netMinor: number
} {
  const assets = sumMinor(lines.filter((l) => l.kind === 'asset').map((l) => l.amountMinor))
  // Liabilities are held as positive magnitudes and subtracted here, so a
  // credit card balance entered either way cannot flip the sign of net worth.
  const liabilities = sumMinor(lines.filter((l) => l.kind === 'liability').map((l) => Math.abs(l.amountMinor)))
  return { assetsMinor: assets, liabilitiesMinor: liabilities, netMinor: assets - liabilities }
}

/**
 * A sinking fund: an annual cost turned into a per-period set-aside.
 *
 * "The car insurance is £640 in November" becomes "put £53.34 aside a month",
 * and the shortfall tells you whether you are on track.
 */
export function sinkingFund(params: {
  annualAmountMinor: number
  periodsPerYear: number
  alreadySavedMinor: number
  periodsRemaining: number
}): { perPeriodMinor: number; shortfallMinor: number; onTrack: boolean; catchUpPerPeriodMinor: number } {
  const perPeriod = Math.ceil(params.annualAmountMinor / Math.max(1, params.periodsPerYear))
  const shortfall = Math.max(0, params.annualAmountMinor - params.alreadySavedMinor)
  const periods = Math.max(1, params.periodsRemaining)
  const catchUp = Math.ceil(shortfall / periods)
  return {
    perPeriodMinor: perPeriod,
    shortfallMinor: shortfall,
    onTrack: catchUp <= perPeriod,
    catchUpPerPeriodMinor: catchUp
  }
}

// ---------------------------------------------------------------------------
// Debt repayment
// ---------------------------------------------------------------------------

export interface DebtLine {
  id: string
  name: string
  balanceMinor: number
  /** Annual interest rate in basis points (1999 = 19.99%). */
  aprBp: number
  minimumPaymentMinor: number
}

export interface RepaymentStep {
  month: number
  debtId: string
  paymentMinor: number
  interestMinor: number
  balanceAfterMinor: number
}

export interface RepaymentPlan {
  strategy: 'snowball' | 'avalanche'
  months: number
  totalInterestMinor: number
  totalPaidMinor: number
  payoffOrder: { debtId: string; name: string; month: number }[]
  steps: RepaymentStep[]
  assumptions: string[]
  /** True when the plan could not clear the debts within the horizon. */
  incomplete: boolean
}

/**
 * Model a debt-repayment plan.
 *
 * Snowball clears the smallest balance first (motivating); avalanche clears the
 * highest interest rate first (cheapest). Interest is applied monthly at
 * APR/12, which is the standard simplification and is stated as an assumption
 * rather than hidden.
 *
 * This is a projection. It is never presented as advice, and it never claims to
 * know what a lender will actually charge.
 */
export function planRepayment(
  debts: readonly DebtLine[],
  monthlyBudgetMinor: number,
  strategy: 'snowball' | 'avalanche',
  horizonMonths = 600
): RepaymentPlan {
  const working = debts
    .filter((d) => d.balanceMinor > 0)
    .map((d) => ({ ...d, balance: Math.round(d.balanceMinor) }))
  const order = [...working].sort((a, b) =>
    strategy === 'snowball' ? a.balance - b.balance || a.name.localeCompare(b.name) : b.aprBp - a.aprBp || a.balance - b.balance
  )

  const steps: RepaymentStep[] = []
  const payoffOrder: RepaymentPlan['payoffOrder'] = []
  let totalInterest = 0
  let totalPaid = 0
  let month = 0
  let incomplete = false

  const minimumTotal = sumMinor(working.map((d) => d.minimumPaymentMinor))
  const assumptions = [
    'Interest applied monthly at the annual rate divided by twelve',
    'Minimum payments assumed fixed, and made on time every month',
    'No new borrowing, fees or charges',
    'A projection, not advice or an offer'
  ]

  if (monthlyBudgetMinor < minimumTotal) {
    assumptions.unshift(
      'Your monthly amount is less than the minimum payments, so this plan cannot be met as entered'
    )
  }

  while (working.some((d) => d.balance > 0) && month < horizonMonths) {
    month += 1
    let available = monthlyBudgetMinor

    // Interest first, then minimums, then everything left at the target debt.
    for (const debt of working) {
      if (debt.balance <= 0) continue
      const interest = scaleMinor(debt.balance, debt.aprBp / 10000 / 12)
      debt.balance += interest
      totalInterest += interest
    }
    for (const debt of working) {
      if (debt.balance <= 0) continue
      const payment = Math.min(debt.minimumPaymentMinor, debt.balance, Math.max(0, available))
      debt.balance -= payment
      available -= payment
      totalPaid += payment
      if (payment > 0) {
        steps.push({ month, debtId: debt.id, paymentMinor: payment, interestMinor: 0, balanceAfterMinor: debt.balance })
      }
    }
    for (const target of order) {
      if (available <= 0) break
      const debt = working.find((d) => d.id === target.id)
      if (!debt || debt.balance <= 0) continue
      const extra = Math.min(available, debt.balance)
      debt.balance -= extra
      available -= extra
      totalPaid += extra
      steps.push({ month, debtId: debt.id, paymentMinor: extra, interestMinor: 0, balanceAfterMinor: debt.balance })
    }
    for (const debt of working) {
      if (debt.balance <= 0 && !payoffOrder.some((p) => p.debtId === debt.id)) {
        payoffOrder.push({ debtId: debt.id, name: debt.name, month })
      }
    }
    // No progress at all means the budget cannot even cover the interest.
    if (month > 1 && available === monthlyBudgetMinor) {
      incomplete = true
      break
    }
  }
  if (working.some((d) => d.balance > 0)) incomplete = true

  return {
    strategy,
    months: month,
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    payoffOrder,
    steps,
    assumptions,
    incomplete
  }
}

// ---------------------------------------------------------------------------
// Cashflow
// ---------------------------------------------------------------------------

export interface CashflowPoint {
  monthKey: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

/**
 * Monthly income and expense totals over a window.
 *
 * `status` matters: actual, planned and forecast rows are summed separately by
 * the caller so a projection is never mixed into a real balance.
 */
export function cashflowByMonth(
  rows: readonly { date: CalendarDate; amountMinor: number; kind: string }[],
  months: readonly string[]
): CashflowPoint[] {
  const byMonth = new Map<string, { income: number; expense: number }>()
  for (const key of months) byMonth.set(key, { income: 0, expense: 0 })
  for (const row of rows) {
    const key = row.date.slice(0, 7)
    const bucket = byMonth.get(key)
    if (!bucket) continue
    if (row.kind === 'income') bucket.income += Math.abs(row.amountMinor)
    else if (row.kind === 'expense') bucket.expense += Math.abs(row.amountMinor)
  }
  return months.map((monthKey) => {
    const bucket = byMonth.get(monthKey) ?? { income: 0, expense: 0 }
    return {
      monthKey,
      incomeMinor: bucket.income,
      expenseMinor: bucket.expense,
      netMinor: bucket.income - bucket.expense
    }
  })
}

/** Savings rate in basis points of income. Zero income gives zero, not NaN. */
export function savingsRateBp(incomeMinor: number, expenseMinor: number): number {
  if (incomeMinor <= 0) return 0
  return Math.max(0, Math.round(((incomeMinor - expenseMinor) / incomeMinor) * 10000))
}

/**
 * A stable key for matching repeat purchases of the same product across
 * receipts, so price history means something. Deliberately crude and
 * deterministic: lower-cased, punctuation stripped, sizes normalised.
 */
export function productKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(\d+)\s*(g|kg|ml|l|pack|pk|x)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * Which of a run of monthly totals genuinely stands out as the dearest.
 *
 * Returns the index of the standout month, or null when there is not one.
 * There is not one when everything is zero, when every month ties (a tie has
 * no winner), or when the leader is only marginally ahead — highlighting a
 * month that is £2 dearer than its neighbours tells the reader nothing and
 * costs them a moment working out why it is coloured.
 */
export function dearestMonth(amountsMinor: number[]): number | null {
  if (amountsMinor.length === 0) return null
  const max = Math.max(...amountsMinor)
  if (max <= 0) return null
  const below = amountsMinor.filter((a) => a < max)
  if (below.length === 0) return null
  const runnerUp = Math.max(...below)
  // Five per cent, or a pound, whichever is larger: enough to be visible on a
  // bar and enough to be worth a word.
  if (max - runnerUp < Math.max(100, max * 0.05)) return null
  return amountsMinor.indexOf(max)
}
