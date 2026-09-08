import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money, moneyCompact, percentFromBp, relative } from '../lib/format.js'
import { addDays, monthKey, today as todayDate } from '@shared/domain/time.js'
import { Icon } from '../components/Icon.js'
import { Chip, EmptyState, ErrorState, Loading, Meter, Modal, Notice, SectionHeading, StatCard } from '../components/ui.js'
import { RecordList } from '../components/RecordList.js'
import { RecordEditor } from '../components/RecordEditor.js'
import { ImportStatement } from './ImportStatement.js'
import type { Navigator } from '../app/App.js'

/**
 * Money.
 *
 * Built on the Amethyst finance engine. Two rules run through every screen
 * here, because getting them wrong is how a personal finance app quietly
 * misleads somebody:
 *
 *  1. Actual, planned and forecast are never added together. A projection is
 *     labelled a projection.
 *  2. Every derived figure that rests on an assumption states the assumption
 *     next to it — the tax year for a payslip estimate, the interest model for
 *     a repayment plan, the date of a valuation.
 */

type View = 'overview' | 'accounts' | 'transactions' | 'budgets' | 'bills' | 'owed' | 'pay' | 'worth' | 'debt'

interface Overview {
  currency: string
  series: { monthKey: string; incomeMinor: number; expenseMinor: number; netMinor: number }[]
  thisMonth: { monthKey: string; incomeMinor: number; expenseMinor: number; netMinor: number }
  savingsRateBp: number
  balances: { id: string; name: string; kind: string; currency: string; balanceMinor: number; includeInNetWorth: boolean }[]
  spendByCategory: { category: string; total: number }[]
  lending: { owedToMeMinor: number; iOweMinor: number; overdueCount: number }
  waitingOnMoneyMinor: number
  transactionCount: number
}

export function MoneyPage({ nav }: { nav: Navigator }): ReactNode {
  const { entities } = useApp()
  const initial = nav.route.page === 'money' && nav.route.view ? (nav.route.view as View) : 'overview'
  const [view, setView] = useState<View>(initial)
  const [importing, setImporting] = useState(false)

  const entityFor = (type: string) => entities.find((e) => e.type === type)

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <p className="kicker">Money</p>
          <h1>{LABELS[view]}</h1>
          <p className="sub">Everything you have told Orbit. It has no connection to any bank and never will unless you ask for one.</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setImporting(true)}>
            <Icon name="upload" size={14} />
            Import a statement
          </button>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 'var(--gap)' }}>
        {(Object.keys(LABELS) as View[]).map((key) => (
          <button key={key} className={`btn small${view === key ? ' primary' : ''}`} onClick={() => setView(key)}>
            {LABELS[key]}
          </button>
        ))}
      </div>

      {view === 'overview' ? (
        <MoneyOverview nav={nav} onView={setView} />
      ) : view === 'accounts' ? (
        <AccountsView nav={nav} />
      ) : view === 'transactions' ? (
        entityFor('transaction') ? (
          <RecordList entity={entityFor('transaction')!} onOpen={(id) => nav.openRecord('transaction', id)} limit={500} />
        ) : null
      ) : view === 'budgets' ? (
        <BudgetsView nav={nav} />
      ) : view === 'bills' ? (
        <BillsView nav={nav} />
      ) : view === 'owed' ? (
        <OwedView nav={nav} />
      ) : view === 'pay' ? (
        <PayView nav={nav} />
      ) : view === 'worth' ? (
        <NetWorthView nav={nav} />
      ) : (
        <DebtView />
      )}

      {importing ? <ImportStatement onClose={() => setImporting(false)} /> : null}
    </>
  )
}

const LABELS: Record<View, string> = {
  overview: 'Overview',
  accounts: 'Accounts',
  transactions: 'Transactions',
  budgets: 'Budgets',
  bills: 'Bills',
  owed: 'Owed',
  pay: 'Pay & tax',
  worth: 'Net worth',
  debt: 'Debt plan'
}

// -- Overview ----------------------------------------------------------------

function MoneyOverview({ nav, onView }: { nav: Navigator; onView: (view: View) => void }): ReactNode {
  const { format, revision } = useApp()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const result = await call<Overview>('money.overview', { months: 6 })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setData(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load, revision])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!data) return <Loading rows={8} label="Adding it all up" />

  if (data.transactionCount === 0 && data.balances.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon="money"
          title="No money records yet"
          message="Add the accounts you actually use, then import a statement or enter a few transactions. Orbit never connects to a bank — you tell it what is there."
          action={
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => onView('accounts')}>
                Add an account
              </button>
            </div>
          }
        />
      </div>
    )
  }

  const maxMonth = Math.max(...data.series.map((s) => Math.max(s.incomeMinor, s.expenseMinor)), 1)
  const totalBalance = data.balances.filter((b) => b.includeInNetWorth).reduce((sum, b) => sum + b.balanceMinor, 0)

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="grid three">
        <StatCard
          label="Across your accounts"
          value={money(totalBalance, format, data.currency)}
          detail={`${data.balances.length} account${data.balances.length === 1 ? '' : 's'}`}
          onClick={() => onView('accounts')}
        />
        <StatCard
          label="In this month"
          value={money(data.thisMonth.incomeMinor, format, data.currency)}
          detail="Actual money only"
          tone="good"
        />
        <StatCard
          label="Out this month"
          value={money(data.thisMonth.expenseMinor, format, data.currency)}
          detail={`Saving ${percentFromBp(data.savingsRateBp, format)} of what came in`}
          tone={data.thisMonth.netMinor < 0 ? 'bad' : undefined}
        />
      </div>

      <div className="grid wide-first">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>The last six months</h2>
              <p className="sub">Actual transactions only — nothing planned or forecast</p>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gap: 12 }}>
              {data.series.map((month) => (
                <div key={month.monthKey} style={{ display: 'grid', gridTemplateColumns: '58px 1fr 92px', gap: 12, alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{shortMonth(month.monthKey, format.locale)}</span>
                  <div style={{ display: 'grid', gap: 3 }}>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
                      <div style={{ width: `${(month.incomeMinor / maxMonth) * 100}%`, height: '100%', background: 'var(--good)' }} />
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
                      <div style={{ width: `${(month.expenseMinor / maxMonth) * 100}%`, height: '100%', background: 'var(--bad)' }} />
                    </div>
                  </div>
                  <span className={`money ${month.netMinor < 0 ? 'out' : 'in'}`} style={{ fontSize: 12.5, textAlign: 'right' }}>
                    {moneyCompact(month.netMinor, format, data.currency)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 16, color: 'var(--muted)', fontSize: 11.5 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="dot" style={{ color: 'var(--good)' }} /> Money in
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="dot" style={{ color: 'var(--bad)' }} /> Money out
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--gap)', alignContent: 'start' }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Waiting on money</h2>
                <p className="sub">Refunds and claims not yet received</p>
              </div>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">
                {money(data.waitingOnMoneyMinor, format, data.currency)}
              </div>
              <button className="btn small" onClick={() => onView('owed')}>
                See what and who
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Lending</h2>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 9 }}>
              <Row label="Owed to me" value={money(data.lending.owedToMeMinor, format, data.currency)} tone="good" />
              <Row label="I owe" value={money(data.lending.iOweMinor, format, data.currency)} tone="bad" />
              {data.lending.overdueCount > 0 ? (
                <Chip tone="bad">{data.lending.overdueCount} past the agreed date</Chip>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {data.spendByCategory.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Where it went this month</h2>
              <p className="sub">{monthKey(todayDate())}</p>
            </div>
            <button className="btn small" onClick={() => onView('budgets')}>
              Budgets
            </button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 9 }}>
            {data.spendByCategory.map((row) => {
              const max = data.spendByCategory[0]?.total ?? 1
              return (
                <div key={row.category} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.category}
                  </span>
                  <Meter value={row.total} max={max} label={`Spent on ${row.category}`} />
                  <span className="num" style={{ fontSize: 12.5, textAlign: 'right' }}>
                    {money(row.total, format, data.currency)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <SectionHeading title="Coming up" sub="The next month of bills" />
      <UpcomingBills nav={nav} days={35} />
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }): ReactNode {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="money" style={{ color: tone ? `var(--${tone})` : 'inherit' }}>
        {value}
      </span>
    </div>
  )
}

// -- Accounts ----------------------------------------------------------------

function AccountsView({ nav }: { nav: Navigator }): ReactNode {
  const { format, entities, revision } = useApp()
  const [data, setData] = useState<Overview | null>(null)
  const entity = entities.find((e) => e.type === 'account')

  useEffect(() => {
    void (async () => {
      const result = await call<Overview>('money.overview', { months: 1 })
      if (result.ok) setData(result.data)
    })()
  }, [revision])

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      {data && data.balances.length > 0 ? (
        <div className="grid three">
          {data.balances.map((account) => (
            <StatCard
              key={account.id}
              label={account.name}
              value={money(account.balanceMinor, format, account.currency)}
              detail={account.kind.replace('-', ' ')}
              tone={account.balanceMinor < 0 ? 'bad' : undefined}
              onClick={() => nav.openRecord('account', account.id)}
            />
          ))}
        </div>
      ) : null}
      {entity ? <RecordList entity={entity} onOpen={(id) => nav.openRecord('account', id)} /> : null}
    </div>
  )
}

// -- Budgets -----------------------------------------------------------------

function BudgetsView({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, entities } = useApp()
  const [data, setData] = useState<{
    month: string
    budgets: { budgetId: string; name: string; categoryName: string; limitMinor: number; spentMinor: number; remainingMinor: number; usedBp: number; overspent: boolean; currency: string }[]
    totalLimitMinor: number
    totalSpentMinor: number
    currency: string
  } | null>(null)
  const entity = entities.find((e) => e.type === 'budget')

  useEffect(() => {
    void (async () => {
      const result = await call<NonNullable<typeof data>>('money.budgets', {})
      if (result.ok) setData(result.data)
    })()
  }, [revision])

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      {data && data.budgets.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>This month</h2>
              <p className="sub">
                {money(data.totalSpentMinor, format, data.currency)} of {money(data.totalLimitMinor, format, data.currency)}
              </p>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 14 }}>
            {data.budgets.map((budget) => (
              <div key={budget.budgetId} style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 550 }}>{budget.name || budget.categoryName}</span>
                  <span className="num" style={{ color: budget.overspent ? 'var(--bad)' : 'var(--muted)' }}>
                    {money(budget.spentMinor, format, budget.currency)} of {money(budget.limitMinor, format, budget.currency)}
                  </span>
                </div>
                <Meter
                  value={budget.spentMinor}
                  max={budget.limitMinor}
                  tone={budget.overspent ? 'bad' : budget.usedBp > 8000 ? 'warn' : 'good'}
                  label={`${budget.name} budget`}
                />
                <span style={{ fontSize: 11.5, color: budget.overspent ? 'var(--bad)' : 'var(--muted)' }}>
                  {budget.overspent
                    ? `${money(Math.abs(budget.remainingMinor), format, budget.currency)} over`
                    : `${money(budget.remainingMinor, format, budget.currency)} left`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {entity ? <RecordList entity={entity} onOpen={(id) => nav.openRecord('budget', id)} /> : null}
    </div>
  )
}

// -- Bills -------------------------------------------------------------------

function BillsView({ nav }: { nav: Navigator }): ReactNode {
  const { entities } = useApp()
  const entity = entities.find((e) => e.type === 'bill')
  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <UpcomingBills nav={nav} days={90} />
      {entity ? <RecordList entity={entity} onOpen={(id) => nav.openRecord('bill', id)} /> : null}
    </div>
  )
}

interface UpcomingBill {
  billId: string
  name: string
  dueDate: string
  periodKey: string
  amountMinor: number
  currency: string
  paid: boolean
  paidOn: string | null
  kind: string
  daysAway: number
}

function UpcomingBills({ nav, days }: { nav: Navigator; days: number }): ReactNode {
  const { format, revision, bumpRevision, toast } = useApp()
  const [bills, setBills] = useState<UpcomingBill[] | null>(null)
  const [marking, setMarking] = useState<UpcomingBill | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await call<{ bills: UpcomingBill[] }>('money.bills', { days })
      setBills(result.ok ? result.data.bills : [])
    })()
  }, [days, revision])

  if (!bills) return <Loading rows={4} label="Working out what is due" />
  if (bills.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon="bill"
          title="No bills due in this period"
          message="Add your regular commitments and Orbit will show you what is coming, with the renewal and notice dates that catch people out."
        />
      </div>
    )
  }

  const total = bills.filter((b) => !b.paid).reduce((sum, b) => sum + b.amountMinor, 0)

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Bills due</h2>
            <p className="sub">
              {money(total, format)} still to pay across {bills.filter((b) => !b.paid).length} bill
              {bills.filter((b) => !b.paid).length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="card-body flush">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Due</th>
                  <th className="right">Amount</th>
                  <th>Status</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={`${bill.billId}:${bill.periodKey}`} onClick={() => nav.openRecord('bill', bill.billId)}>
                    <td>
                      <b style={{ fontWeight: 560 }}>{bill.name}</b>
                    </td>
                    <td className="num">
                      {fmtDate(bill.dueDate, format)}
                      <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11.5 }}>
                        {relative(bill.daysAway, format)}
                      </span>
                    </td>
                    <td className="right money">{money(bill.amountMinor, format, bill.currency)}</td>
                    <td>
                      {bill.paid ? (
                        <Chip tone="good">Paid</Chip>
                      ) : bill.daysAway < 0 ? (
                        <Chip tone="bad">Overdue</Chip>
                      ) : bill.daysAway <= 3 ? (
                        <Chip tone="warn">Due soon</Chip>
                      ) : (
                        <Chip>Due</Chip>
                      )}
                    </td>
                    <td>
                      {!bill.paid ? (
                        <button
                          className="btn small"
                          onClick={(event) => {
                            event.stopPropagation()
                            setMarking(bill)
                          }}
                        >
                          Mark paid
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {marking ? (
        <MarkPaid
          bill={marking}
          onClose={() => setMarking(null)}
          onDone={() => {
            setMarking(null)
            bumpRevision()
            toast({ tone: 'good', title: 'Recorded as paid' })
          }}
        />
      ) : null}
    </>
  )
}

function MarkPaid({ bill, onClose, onDone }: { bill: UpcomingBill; onClose: () => void; onDone: () => void }): ReactNode {
  const { format, toast } = useApp()
  const [paidOn, setPaidOn] = useState(todayDate())
  const [createTransaction, setCreateTransaction] = useState(true)
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const result = await call<{ rows: Record<string, unknown>[] }>('records.list', { type: 'account', limit: 100 })
      if (result.ok) {
        const list = result.data.rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
        setAccounts(list)
        setAccountId(list[0]?.id ?? '')
      }
    })()
  }, [])

  const submit = async (): Promise<void> => {
    setBusy(true)
    const result = await call<{ paid: boolean }>('bills.markPaid', {
      billId: bill.billId,
      periodKey: bill.periodKey,
      dueDate: bill.dueDate,
      paidOn,
      amountMinor: bill.amountMinor,
      createTransaction,
      ...(createTransaction && accountId ? { accountId } : {})
    })
    setBusy(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'That could not be recorded', detail: result.error })
      return
    }
    onDone()
  }

  return (
    <Modal
      title={`Mark "${bill.name}" as paid`}
      subtitle={`${money(bill.amountMinor, format, bill.currency)} due ${fmtDate(bill.dueDate, format)}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || (createTransaction && !accountId)}>
            {busy ? 'Recording…' : 'Record the payment'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="field">
          <label htmlFor="paid-on">Paid on</label>
          <input id="paid-on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={createTransaction} onChange={(event) => setCreateTransaction(event.target.checked)} />
          <span>Also add a transaction for it</span>
        </label>
        {createTransaction ? (
          <div className="field">
            <label htmlFor="paid-account">From which account</label>
            <select id="paid-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Notice tone="info">
          Recording a payment for this period cannot happen twice — the bill and the period together are a unique key, so
          a double click will not double-count it.
        </Notice>
      </div>
    </Modal>
  )
}

// -- Owed --------------------------------------------------------------------

function OwedView({ nav }: { nav: Navigator }): ReactNode {
  const { entities } = useApp()
  const agreements = entities.find((e) => e.type === 'money_agreement')
  const claims = entities.find((e) => e.type === 'expense_claim')
  const returns = entities.find((e) => e.type === 'return')
  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <Notice tone="info" title="A return sent is not a refund received">
        Orbit keeps those two facts apart on purpose. A refund is only marked as received when you say the money has
        actually arrived.
      </Notice>
      {claims ? <RecordList entity={claims} onOpen={(id) => nav.openRecord('expense_claim', id)} /> : null}
      {returns ? (
        <RecordList
          entity={returns}
          where={{ status: 'sent' }}
          onOpen={(id) => nav.openRecord('return', id)}
          compact
        />
      ) : null}
      {agreements ? <RecordList entity={agreements} onOpen={(id) => nav.openRecord('money_agreement', id)} /> : null}
    </div>
  )
}

// -- Pay ---------------------------------------------------------------------

interface PayrollBreakdown {
  taxYear: string
  annualGrossMinor: number
  pensionMinor: number
  allowanceMinor: number
  taxableMinor: number
  incomeTaxMinor: number
  nationalInsuranceMinor: number
  studentLoanMinor: number
  postgraduateLoanMinor: number
  annualNetMinor: number
  periodsPerYear: number
  periodGrossMinor: number
  periodNetMinor: number
  effectiveRateBp: number
  assumptions: string[]
}

function PayView({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, entities } = useApp()
  const [data, setData] = useState<
    { configured: false; currency: string } | { configured: true; breakdown: PayrollBreakdown; paydays: string[]; currency: string; profile: Record<string, unknown> } | null
  >(null)
  const [adding, setAdding] = useState(false)
  const entity = entities.find((e) => e.type === 'payroll_profile')

  useEffect(() => {
    void (async () => {
      const result = await call<NonNullable<typeof data>>('money.payroll', {})
      if (result.ok) setData(result.data)
    })()
  }, [revision])

  if (!data) return <Loading rows={6} label="Working out your pay" />

  if (!data.configured) {
    return (
      <>
        <div className="card">
          <EmptyState
            icon="money"
            title="Tell Orbit about your pay"
            message="Salary, tax code, pension and student loan. Orbit estimates each payday and what lands in your account. It is an estimate — your payslip is the authority."
            action={
              <button className="btn primary" onClick={() => setAdding(true)}>
                Add your pay details
              </button>
            }
          />
        </div>
        {adding && entity ? <RecordEditor entity={entity} onClose={() => setAdding(false)} /> : null}
      </>
    )
  }

  const b = data.breakdown
  const deductions = [
    ['Income tax', b.incomeTaxMinor],
    ['National Insurance', b.nationalInsuranceMinor],
    ['Pension', b.pensionMinor],
    ['Student loan', b.studentLoanMinor],
    ['Postgraduate loan', b.postgraduateLoanMinor]
  ].filter(([, value]) => Number(value) > 0) as [string, number][]

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="grid three">
        <StatCard label="Gross a year" value={money(b.annualGrossMinor, format, data.currency)} />
        <StatCard label="Take-home a year" value={money(b.annualNetMinor, format, data.currency)} tone="good" />
        <StatCard
          label="Each payday"
          value={money(b.periodNetMinor, format, data.currency)}
          detail={`${b.periodsPerYear} times a year`}
        />
      </div>

      <div className="grid wide-first">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Where the gross goes</h2>
              <p className="sub">
                {percentFromBp(b.effectiveRateBp, format, 1)} of your gross pay goes in tax and deductions
              </p>
            </div>
            <button className="btn small" onClick={() => nav.openRecord('payroll_profile', String(data.profile.id))}>
              Edit
            </button>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            {deductions.map(([label, value]) => (
              <div key={label} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{label}</span>
                  <span className="num">{money(value, format, data.currency)}</span>
                </div>
                <Meter value={value} max={b.annualGrossMinor} tone="warn" label={label} />
              </div>
            ))}
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 620 }}>
                <span>Take-home</span>
                <span className="num">{money(b.annualNetMinor, format, data.currency)}</span>
              </div>
              <Meter value={b.annualNetMinor} max={b.annualGrossMinor} tone="good" label="Take-home" />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--gap)', alignContent: 'start' }}>
          <div className="card">
            <div className="card-head">
              <h2>Next paydays</h2>
            </div>
            <div className="card-body flush">
              <ul>
                {data.paydays.map((day) => (
                  <li
                    key={day}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}
                  >
                    <span>{fmtDate(day, format)}</span>
                    <span className="num" style={{ color: 'var(--muted)' }}>
                      {relative(Math.round((Date.parse(day) - Date.parse(todayDate())) / 86400000), format)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Notice tone="warn" title="This is an estimate" icon="info">
            <ul style={{ marginTop: 6, display: 'grid', gap: 3 }}>
              {b.assumptions.map((assumption) => (
                <li key={assumption} style={{ fontSize: 12 }}>
                  • {assumption}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      </div>
    </div>
  )
}

// -- Net worth ---------------------------------------------------------------

function NetWorthView({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, entities } = useApp()
  const [data, setData] = useState<{
    assetsMinor: number
    liabilitiesMinor: number
    netMinor: number
    lines: { label: string; amountMinor: number; kind: 'asset' | 'liability'; currency: string }[]
    currency: string
    mixedCurrency: boolean
    currenciesPresent: string[]
    staleValuations: { name: string; asOf: string }[]
  } | null>(null)
  const holdings = entities.find((e) => e.type === 'holding')

  useEffect(() => {
    void (async () => {
      const result = await call<NonNullable<typeof data>>('money.netWorth', {})
      if (result.ok) setData(result.data)
    })()
  }, [revision])

  if (!data) return <Loading rows={6} label="Adding up what you own and owe" />

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      {data.mixedCurrency ? (
        <Notice tone="warn" title="More than one currency is involved">
          These figures add up {data.currenciesPresent.join(', ')} as if they were the same currency. Orbit will not
          invent an exchange rate, so convert them yourself or keep the accounts separate.
        </Notice>
      ) : null}
      {data.staleValuations.length > 0 ? (
        <Notice tone="info" title="Some valuations are getting old">
          {data.staleValuations.map((v) => `${v.name} (last valued ${fmtDate(v.asOf, format)})`).join(', ')}. A balance
          without a recent date is a guess.
        </Notice>
      ) : null}

      <div className="grid three">
        <StatCard label="Assets" value={money(data.assetsMinor, format, data.currency)} tone="good" />
        <StatCard label="Liabilities" value={money(data.liabilitiesMinor, format, data.currency)} tone="bad" />
        <StatCard label="Net worth" value={money(data.netMinor, format, data.currency)} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>What it is made of</h2>
        </div>
        <div className="card-body flush">
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {data.lines.map((line, index) => (
                  <tr key={index} style={{ cursor: 'default' }}>
                    <td>{line.label}</td>
                    <td>
                      <Chip tone={line.kind === 'asset' ? 'good' : 'bad'}>{line.kind === 'asset' ? 'Asset' : 'Liability'}</Chip>
                    </td>
                    <td className="right money">{money(line.amountMinor, format, line.currency || data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {holdings ? <RecordList entity={holdings} onOpen={(id) => nav.openRecord('holding', id)} /> : null}
    </div>
  )
}

// -- Debt --------------------------------------------------------------------

function DebtView(): ReactNode {
  const { format, revision } = useApp()
  const [strategy, setStrategy] = useState<'snowball' | 'avalanche'>('avalanche')
  const [monthly, setMonthly] = useState('300')
  const [plan, setPlan] = useState<{
    months: number
    totalInterestMinor: number
    totalPaidMinor: number
    payoffOrder: { debtId: string; name: string; month: number }[]
    assumptions: string[]
    incomplete: boolean
    debts: { id: string; name: string; balanceMinor: number; aprBp: number }[]
    currency: string
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    const parsed = Math.round(Number(monthly.replace(/[^0-9.]/g, '')) * 100)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    setBusy(true)
    const result = await call<NonNullable<typeof plan>>('money.repaymentPlan', {
      monthlyMinor: parsed,
      strategy
    })
    setBusy(false)
    if (result.ok) setPlan(result.data)
  }, [monthly, strategy])

  useEffect(() => {
    void run()
  }, [run, revision])

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Repayment plan</h2>
            <p className="sub">A projection, not advice</p>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="debt-monthly">How much a month can you put towards debt?</label>
              <input
                id="debt-monthly"
                type="text"
                inputMode="decimal"
                value={monthly}
                onChange={(event) => setMonthly(event.target.value)}
                onBlur={() => void run()}
              />
            </div>
            <div className="field">
              <label htmlFor="debt-strategy">Order</label>
              <select id="debt-strategy" value={strategy} onChange={(event) => setStrategy(event.target.value as 'snowball' | 'avalanche')}>
                <option value="avalanche">Avalanche — highest interest rate first (cheapest)</option>
                <option value="snowball">Snowball — smallest balance first (most encouraging)</option>
              </select>
            </div>
          </div>

          {busy ? (
            <Loading rows={2} label="Working out the plan" />
          ) : !plan || plan.debts.length === 0 ? (
            <EmptyState
              icon="chart"
              title="No debts recorded"
              message="Add a credit card, loan or mortgage account with its interest rate and Orbit can model paying it off."
            />
          ) : (
            <>
              <div className="grid three">
                <StatCard label="Clear in" value={plan.incomplete ? 'Not within 50 years' : `${plan.months} months`} />
                <StatCard label="Interest paid" value={money(plan.totalInterestMinor, format, plan.currency)} tone="bad" />
                <StatCard label="Total paid" value={money(plan.totalPaidMinor, format, plan.currency)} />
              </div>
              {plan.payoffOrder.length > 0 ? (
                <div>
                  <h4 style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Order they clear
                  </h4>
                  <ol style={{ display: 'grid', gap: 5 }}>
                    {plan.payoffOrder.map((step, index) => (
                      <li key={step.debtId} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                        <span className="chip accent">{index + 1}</span>
                        <span style={{ flex: 1 }}>{step.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>month {step.month}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <Notice tone="warn" title="What this assumes">
                <ul style={{ marginTop: 5, display: 'grid', gap: 3 }}>
                  {plan.assumptions.map((assumption) => (
                    <li key={assumption} style={{ fontSize: 12 }}>
                      • {assumption}
                    </li>
                  ))}
                </ul>
              </Notice>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function shortMonth(key: string, locale: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number]
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
  } catch {
    return key
  }
}

export { addDays }
