import { describe, it, expect } from 'vitest'
import {
  bandedTax,
  billOccurrences,
  billPeriodKey,
  budgetProgress,
  calculatePayroll,
  cashflowByMonth,
  daysUntilMonthlyDue,
  dearestMonth,
  isOverdue,
  latenessProfile,
  netWorth,
  nextPaydays,
  outstandingMinor,
  planRepayment,
  parseTaxCode,
  productKey,
  projectSettlement,
  savingsRateBp,
  sinkingFund,
  type PayrollInput
} from '@shared/domain/finance.js'

const basePayroll: PayrollInput = {
  salaryMinor: 3_500_000, // £35,000.00
  bonusMinor: 0,
  frequency: 'monthly',
  region: 'rUK',
  taxCode: '1257L',
  niCategory: 'A',
  pensionRateBp: 0,
  pensionType: 'none',
  studentPlan: 'none',
  postgraduate: false,
  taxYear: '2025-26'
}

describe('tax codes', () => {
  it('reads standard, flat-rate and K codes', () => {
    expect(parseTaxCode('1257L').allowance).toBe(12570)
    expect(parseTaxCode('S1257L').allowance).toBe(12570) // Scottish prefix
    expect(parseTaxCode('C1257L').allowance).toBe(12570) // Welsh prefix
    expect(parseTaxCode('BR').flatRate).toBe(0.2)
    expect(parseTaxCode('D0').flatRate).toBe(0.4)
    expect(parseTaxCode('D1').flatRate).toBe(0.45)
    expect(parseTaxCode('0T').allowance).toBe(0)
    expect(parseTaxCode('K500').allowance).toBe(-5000)
  })

  it('falls back to the standard allowance for an unrecognised code', () => {
    const info = parseTaxCode('WHAT')
    expect(info.allowance).toBe(12570)
    expect(info.description).toMatch(/not recognised/)
  })
})

describe('banded tax', () => {
  it('slices through cumulative bands', () => {
    const bands: [number, number][] = [
      [1000, 0.1],
      [2000, 0.2],
      [Number.POSITIVE_INFINITY, 0.3]
    ]
    expect(bandedTax(500, bands)).toBe(50)
    expect(bandedTax(1000, bands)).toBe(100)
    expect(bandedTax(1500, bands)).toBe(200) // 100 + 100
    expect(bandedTax(3000, bands)).toBe(600) // 100 + 200 + 300
    expect(bandedTax(0, bands)).toBe(0)
  })
})

describe('UK payroll', () => {
  it('computes tax and NI for a basic-rate salary', () => {
    const r = calculatePayroll(basePayroll)
    // Taxable: 35,000 - 12,570 = 22,430 at 20% = 4,486.00
    expect(r.incomeTaxMinor).toBe(448_600)
    // NI: (35,000 - 12,570) at 8% = 1,794.40
    expect(r.nationalInsuranceMinor).toBe(179_440)
    expect(r.annualNetMinor).toBe(3_500_000 - 448_600 - 179_440)
    expect(r.periodsPerYear).toBe(12)
  })

  it('crosses into the higher-rate band correctly', () => {
    const r = calculatePayroll({ ...basePayroll, salaryMinor: 6_000_000 })
    // Taxable 47,430: 37,700 at 20% (7,540) + 9,730 at 40% (3,892) = 11,432
    expect(r.incomeTaxMinor).toBe(1_143_200)
    // NI: (50,270-12,570) at 8% = 3,016 plus (60,000-50,270) at 2% = 194.60
    expect(r.nationalInsuranceMinor).toBe(301_600 + 19_460)
  })

  it('tapers the personal allowance above £100,000', () => {
    const r = calculatePayroll({ ...basePayroll, salaryMinor: 12_000_000 })
    // 120,000 is 20,000 over; allowance reduced by 10,000 to 2,570.
    expect(r.allowanceMinor).toBe(257_000)
    expect(r.assumptions.join(' ')).toMatch(/reduced by £1 for every £2/)
  })

  it('removes the allowance entirely above £125,140', () => {
    const r = calculatePayroll({ ...basePayroll, salaryMinor: 15_000_000 })
    expect(r.allowanceMinor).toBe(0)
  })

  it('applies Scottish rates when asked', () => {
    const ruk = calculatePayroll({ ...basePayroll, salaryMinor: 5_000_000 })
    const scot = calculatePayroll({ ...basePayroll, salaryMinor: 5_000_000, region: 'scotland' })
    expect(scot.incomeTaxMinor).not.toBe(ruk.incomeTaxMinor)
    expect(scot.assumptions.join(' ')).toMatch(/Scottish/)
  })

  it('treats the pension types differently, as they actually differ', () => {
    const input = { ...basePayroll, pensionRateBp: 500 } // 5%
    const none = calculatePayroll({ ...input, pensionType: 'none' })
    const ras = calculatePayroll({ ...input, pensionType: 'relief-at-source' })
    const netPay = calculatePayroll({ ...input, pensionType: 'net-pay' })
    const sacrifice = calculatePayroll({ ...input, pensionType: 'salary-sacrifice' })

    // Relief at source does not reduce taxable pay.
    expect(ras.incomeTaxMinor).toBe(none.incomeTaxMinor)
    // Net pay reduces income tax but not NI.
    expect(netPay.incomeTaxMinor).toBeLessThan(none.incomeTaxMinor)
    expect(netPay.nationalInsuranceMinor).toBe(none.nationalInsuranceMinor)
    // Salary sacrifice reduces both.
    expect(sacrifice.incomeTaxMinor).toBe(netPay.incomeTaxMinor)
    expect(sacrifice.nationalInsuranceMinor).toBeLessThan(none.nationalInsuranceMinor)
  })

  it('applies student and postgraduate loan deductions', () => {
    const r = calculatePayroll({ ...basePayroll, studentPlan: 'plan2', postgraduate: true })
    // Plan 2: (35,000 - 29,385) at 9% = 505.35
    expect(r.studentLoanMinor).toBe(50_535)
    // Postgraduate: (35,000 - 21,000) at 6% = 840.00
    expect(r.postgraduateLoanMinor).toBe(84_000)
  })

  it('handles a flat-rate BR code', () => {
    const r = calculatePayroll({ ...basePayroll, taxCode: 'BR' })
    expect(r.incomeTaxMinor).toBe(700_000) // 20% of the whole 35,000
  })

  it('handles zero and refuses to produce NaN', () => {
    const r = calculatePayroll({ ...basePayroll, salaryMinor: 0 })
    expect(r.annualNetMinor).toBe(0)
    expect(r.effectiveRateBp).toBe(0)
    expect(Number.isFinite(r.periodNetMinor)).toBe(true)
  })

  it('always states its assumptions and that it is an estimate', () => {
    const r = calculatePayroll(basePayroll)
    expect(r.assumptions[0]).toMatch(/2025\/26/)
    expect(r.assumptions.join(' ')).toMatch(/estimate/i)
    expect(r.assumptions.join(' ')).toMatch(/payslip/i)
  })

  it('is exact in minor units for an awkward salary', () => {
    // £35,000.55 — impossible to represent in Amethyst's whole-pound model.
    const r = calculatePayroll({ ...basePayroll, salaryMinor: 3_500_055 })
    expect(r.annualGrossMinor).toBe(3_500_055)
    expect(Number.isInteger(r.incomeTaxMinor)).toBe(true)
    expect(Number.isInteger(r.nationalInsuranceMinor)).toBe(true)
  })
})

describe('paydays', () => {
  it('walks monthly paydays forward, clamping to short months', () => {
    expect(nextPaydays('2026-01-31', 'monthly', '2026-01-01', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ])
  })

  it('walks weekly and four-weekly paydays', () => {
    expect(nextPaydays('2026-01-02', 'weekly', '2026-01-01', 3)).toEqual(['2026-01-02', '2026-01-09', '2026-01-16'])
    expect(nextPaydays('2026-01-02', '4weekly', '2026-01-01', 3)).toEqual(['2026-01-02', '2026-01-30', '2026-02-27'])
  })

  it('skips past paydays already gone', () => {
    const dates = nextPaydays('2026-01-15', 'monthly', '2026-03-20', 2)
    expect(dates[0]).toBe('2026-04-15')
  })
})

describe('bills', () => {
  it('counts days to the next monthly due date', () => {
    expect(daysUntilMonthlyDue(15, '2026-01-10')).toBe(5)
    expect(daysUntilMonthlyDue(15, '2026-01-15')).toBe(0)
    expect(daysUntilMonthlyDue(15, '2026-01-16')).toBe(30) // next is 15 Feb
  })

  it('clamps a 31st due day into February', () => {
    expect(daysUntilMonthlyDue(31, '2026-02-01')).toBe(27) // 28 February
  })

  it('expands a monthly bill into due dates', () => {
    const bill = {
      id: 'b1',
      name: 'Broadband',
      amountMinor: 3200,
      currency: 'GBP',
      cadence: JSON.stringify({ freq: 'monthly', interval: 1 }),
      anchorDate: '2026-01-05',
      dueDay: 5,
      status: 'active'
    }
    const occ = billOccurrences(bill, '2026-01-01', '2026-03-31')
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])
    expect(occ[0]?.periodKey).toBe('2026-01')
  })

  it('produces nothing for a cancelled bill', () => {
    const bill = {
      id: 'b1',
      name: 'Gym',
      amountMinor: 3200,
      currency: 'GBP',
      cadence: '',
      anchorDate: '2026-01-05',
      dueDay: 5,
      status: 'cancelled'
    }
    expect(billOccurrences(bill, '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('keys periods by the right granularity', () => {
    expect(billPeriodKey('2026-03-05', { freq: 'monthly', interval: 1 })).toBe('2026-03')
    expect(billPeriodKey('2026-03-05', { freq: 'yearly', interval: 1 })).toBe('2026')
    expect(billPeriodKey('2026-03-05', { freq: 'weekly', interval: 1 })).toBe('2026-03-05')
  })
})

describe('money lent and borrowed', () => {
  const agreement = { id: 'a1', direction: 'lent' as const, amountMinor: 50_000, dueDate: '2026-02-01', status: 'open' }

  it('computes the outstanding balance', () => {
    expect(outstandingMinor(50_000, [])).toBe(50_000)
    expect(outstandingMinor(50_000, [{ amountMinor: 20_000 }])).toBe(30_000)
    // Overpayment never produces a negative outstanding.
    expect(outstandingMinor(50_000, [{ amountMinor: 60_000 }])).toBe(0)
  })

  it('flags overdue only when money is genuinely still owed', () => {
    expect(isOverdue(agreement, 30_000, '2026-03-01')).toBe(true)
    expect(isOverdue(agreement, 0, '2026-03-01')).toBe(false)
    expect(isOverdue(agreement, 30_000, '2026-01-15')).toBe(false)
  })

  it('builds a lateness profile only from settled agreements', () => {
    const profile = latenessProfile([
      { dueDate: '2026-01-01', finalRepaymentDate: '2026-01-11' },
      { dueDate: '2026-02-01', finalRepaymentDate: '2026-02-09' },
      { dueDate: '2026-03-01', finalRepaymentDate: null }
    ])
    expect(profile.sampleSize).toBe(2)
    expect(profile.averageDaysLate).toBe(9)
  })

  it('projects settlement and says what the projection rests on', () => {
    const withHistory = projectSettlement('2026-05-01', { averageDaysLate: 9, sampleSize: 2 })
    expect(withHistory?.date).toBe('2026-05-10')
    expect(withHistory?.basis).toMatch(/2 settled loans/)

    const noHistory = projectSettlement('2026-05-01', { averageDaysLate: 0, sampleSize: 0 })
    expect(noHistory?.date).toBe('2026-05-01')
    expect(noHistory?.basis).toMatch(/no repayment history/)
  })
})

describe('budgets and net worth', () => {
  it('reports budget progress including overspend', () => {
    const budget = { id: 'b', categoryId: 'c', limitMinor: 20_000, currency: 'GBP' }
    expect(budgetProgress(budget, 15_000).usedBp).toBe(7500)
    expect(budgetProgress(budget, 15_000).overspent).toBe(false)
    const over = budgetProgress(budget, 25_000)
    expect(over.overspent).toBe(true)
    expect(over.remainingMinor).toBe(-5000)
  })

  it('does not divide by zero for a zero budget', () => {
    expect(budgetProgress({ id: 'b', categoryId: 'c', limitMinor: 0, currency: 'GBP' }, 500).usedBp).toBe(0)
  })

  it('subtracts liabilities however their sign was entered', () => {
    expect(
      netWorth([
        { label: 'Current account', amountMinor: 250_000, kind: 'asset' },
        { label: 'Credit card', amountMinor: -80_000, kind: 'liability' },
        { label: 'Car loan', amountMinor: 120_000, kind: 'liability' }
      ]).netMinor
    ).toBe(250_000 - 80_000 - 120_000)
  })
})

describe('sinking funds', () => {
  it('spreads an annual cost and reports the catch-up needed', () => {
    const fund = sinkingFund({
      annualAmountMinor: 64_000,
      periodsPerYear: 12,
      alreadySavedMinor: 20_000,
      periodsRemaining: 6
    })
    expect(fund.perPeriodMinor).toBe(5334) // ceil(64000/12)
    expect(fund.shortfallMinor).toBe(44_000)
    expect(fund.catchUpPerPeriodMinor).toBe(7334)
    expect(fund.onTrack).toBe(false)
  })

  it('reports on-track when the saving is ahead', () => {
    const fund = sinkingFund({
      annualAmountMinor: 12_000,
      periodsPerYear: 12,
      alreadySavedMinor: 11_000,
      periodsRemaining: 6
    })
    expect(fund.onTrack).toBe(true)
  })
})

describe('debt repayment plans', () => {
  const debts = [
    { id: 'card', name: 'Credit card', balanceMinor: 120_000, aprBp: 1999, minimumPaymentMinor: 2500 },
    { id: 'loan', name: 'Personal loan', balanceMinor: 300_000, aprBp: 799, minimumPaymentMinor: 8000 },
    { id: 'store', name: 'Store card', balanceMinor: 40_000, aprBp: 2999, minimumPaymentMinor: 1500 }
  ]

  it('clears the smallest balance first under snowball', () => {
    const plan = planRepayment(debts, 30_000, 'snowball')
    expect(plan.incomplete).toBe(false)
    expect(plan.payoffOrder[0]?.debtId).toBe('store')
  })

  it('clears the most expensive debt first under avalanche', () => {
    const plan = planRepayment(debts, 30_000, 'avalanche')
    expect(plan.payoffOrder[0]?.debtId).toBe('store') // also highest APR here
    const cheaper = planRepayment(debts, 30_000, 'avalanche')
    const snowball = planRepayment(debts, 30_000, 'snowball')
    // Avalanche never costs more interest than snowball for the same budget.
    expect(cheaper.totalInterestMinor).toBeLessThanOrEqual(snowball.totalInterestMinor)
  })

  it('always states its assumptions and never calls itself advice', () => {
    const plan = planRepayment(debts, 30_000, 'snowball')
    expect(plan.assumptions.join(' ')).toMatch(/not advice/i)
    expect(plan.assumptions.join(' ')).toMatch(/interest applied monthly/i)
  })

  it('says so plainly when the budget cannot cover the minimums', () => {
    const plan = planRepayment(debts, 1000, 'snowball')
    expect(plan.assumptions[0]).toMatch(/less than the minimum payments/)
    expect(plan.incomplete).toBe(true)
  })

  it('handles an empty debt list without looping forever', () => {
    const plan = planRepayment([], 10_000, 'snowball')
    expect(plan.months).toBe(0)
    expect(plan.incomplete).toBe(false)
  })
})

describe('cashflow', () => {
  it('buckets income and expenses by month', () => {
    const rows = [
      { date: '2026-01-05', amountMinor: 200_000, kind: 'income' },
      { date: '2026-01-20', amountMinor: -50_000, kind: 'expense' },
      { date: '2026-02-01', amountMinor: -30_000, kind: 'expense' },
      { date: '2025-12-01', amountMinor: -99_999, kind: 'expense' } // outside the window
    ]
    const series = cashflowByMonth(rows, ['2026-01', '2026-02'])
    expect(series).toEqual([
      { monthKey: '2026-01', incomeMinor: 200_000, expenseMinor: 50_000, netMinor: 150_000 },
      { monthKey: '2026-02', incomeMinor: 0, expenseMinor: 30_000, netMinor: -30_000 }
    ])
  })

  it('computes a savings rate without dividing by zero', () => {
    expect(savingsRateBp(200_000, 150_000)).toBe(2500)
    expect(savingsRateBp(0, 5000)).toBe(0)
    expect(savingsRateBp(100, 500)).toBe(0) // never negative
  })
})

describe('product keys for price history', () => {
  it('matches the same product written differently', () => {
    expect(productKey('Heinz Baked Beans 415g')).toBe(productKey('heinz baked beans  415 g'))
    expect(productKey('Milk, Semi-Skimmed (2L)')).toBe('milk semi skimmed 2l')
  })
})

describe('dearestMonth', () => {
  it('finds a month that is genuinely ahead of the rest', () => {
    expect(dearestMonth([10000, 12000, 40000, 11000])).toBe(2)
  })

  it('returns nothing when every month is identical', () => {
    // The bug this exists for: six identical bills a month, all six labelled
    // "the dearest", which is both wrong and useless.
    expect(dearestMonth([21100, 21100, 21100, 21100, 21100, 21100])).toBeNull()
  })

  it('returns nothing when the leader is only marginally ahead', () => {
    expect(dearestMonth([21100, 21100, 21150])).toBeNull()
  })

  it('ignores a difference smaller than a pound even in tiny amounts', () => {
    expect(dearestMonth([100, 150])).toBeNull()
  })

  it('accepts a difference of a pound or more in tiny amounts', () => {
    expect(dearestMonth([100, 250])).toBe(1)
  })

  it('returns nothing when there is no money at all', () => {
    expect(dearestMonth([0, 0, 0])).toBeNull()
    expect(dearestMonth([])).toBeNull()
  })

  it('picks the first of two joint leaders rather than neither, when they lead', () => {
    // Two months tie at the top but both stand well clear of the others; the
    // first is named, because naming both would say "the dearest" twice.
    expect(dearestMonth([10000, 50000, 50000])).toBe(1)
  })
})
