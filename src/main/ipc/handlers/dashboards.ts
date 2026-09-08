import { z } from 'zod'
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  endOfMonth,
  monthKey,
  startOfMonth,
  startOfWeek,
  today as todayDate,
  type CalendarDate
} from '@shared/domain/time.js'
import { expandRecurrence, normaliseRule } from '@shared/domain/recurrence.js'
import {
  budgetProgress,
  billOccurrences,
  billPeriodKey,
  calculatePayroll,
  cashflowByMonth,
  isOverdue,
  latenessProfile,
  netWorth,
  nextPaydays,
  outstandingMinor,
  planRepayment,
  projectSettlement,
  savingsRateBp,
  type PayFrequency,
  type PayrollInput,
  type PensionType,
  type StudentPlan,
  type TaxRegion
} from '@shared/domain/finance.js'
import { requireEntity } from '@shared/contracts/entities/index.js'
import { ALL_MODULES } from '../../services/settings.js'
import type { AppContext } from '../../context.js'
import { broadcast, CalendarDateSchema, Empty, EntityType, handle, RecordId } from '../router.js'

/**
 * The screens that answer a question rather than list a table: Today, the
 * calendar, the money overview, and the connected detail view that shows a
 * record's costs, documents, dates, people and history together.
 *
 * Everything here is derived at read time from the records themselves. There
 * are no summary tables to fall out of step with the truth.
 */
export function registerDashboardHandlers(ctx: AppContext): void {
  handle('settings.get', Empty, () => {
    const { settings } = ctx.require()
    return settings.all()
  })

  handle(
    'settings.set',
    z
      .object({
        locale: z.string().max(20).optional(),
        currency: z.string().max(8).optional(),
        dateFormat: z.enum(['auto', 'dmy', 'mdy', 'ymd']).optional(),
        weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
        timezone: z.string().max(60).optional(),
        theme: z.enum(['system', 'light', 'dark']).optional(),
        density: z.enum(['comfortable', 'compact']).optional(),
        modules: z.array(z.string().max(40)).max(40).optional(),
        dashboard: z.array(z.string().max(40)).max(20).optional(),
        lowClutter: z.boolean().optional(),
        diagnosticsOptIn: z.boolean().optional(),
        aiEnabled: z.boolean().optional(),
        aiProvider: z.string().max(60).optional(),
        onboardingComplete: z.boolean().optional(),
        vaultOwnerName: z.string().max(120).optional()
      })
      .strict(),
    (values) => {
      const { settings } = ctx.require()
      const updated = settings.set(values)
      broadcast('vault.changed', { settings: true })
      return updated
    }
  )

  handle('life.modules', Empty, () => {
    const { settings } = ctx.require()
    return { available: ALL_MODULES, enabled: settings.all().modules }
  })

  handle('life.setModules', z.object({ modules: z.array(z.string().max(40)).max(40) }), ({ modules }) => {
    const { settings } = ctx.require()
    return settings.set({ modules })
  })

  // -- Today ----------------------------------------------------------------

  handle(
    'today.brief',
    z.object({ date: CalendarDateSchema.optional(), horizonDays: z.number().int().min(1).max(365).optional() }),
    ({ date, horizonDays }) => {
      const { repository, reminders, settings, session } = ctx.require()
      const now = date ?? todayDate()
      const horizon = horizonDays ?? 45
      const prefs = settings.all()

      const attention = reminders.attention({ today: now, horizonDays: horizon })

      const agenda = expandEvents(ctx, now, now)
      const tasksDue = repository.list<Record<string, unknown>>('task', {
        where: {},
        limit: 200,
        orderBy: 'due_date ASC, priority DESC'
      }).rows.filter((t) => {
        const status = String(t.status)
        if (status === 'done' || status === 'cancelled') return false
        const due = t.due_date ? String(t.due_date) : ''
        const defer = t.defer_until ? String(t.defer_until) : ''
        if (defer && defer > now) return false
        return due !== '' && due <= now
      })

      const waitingOn = repository.list<Record<string, unknown>>('task', {
        where: { status: 'waiting' },
        limit: 100,
        orderBy: 'waiting_expected_by ASC'
      }).rows

      const habits = session.db.all<Record<string, unknown>>(
        `SELECT h.id, h.title, h.colour, h.cadence,
                (SELECT c.id FROM habit_checkins c WHERE c.habit_id = h.id AND c.on_date = ?) AS checkin_id,
                (SELECT COUNT(*) FROM habit_checkins c WHERE c.habit_id = h.id AND c.on_date = ?) AS done_today,
                (SELECT COUNT(*) FROM habit_checkins c WHERE c.habit_id = h.id AND c.on_date >= ?) AS done_this_week
           FROM habits h WHERE h.active = 1 ORDER BY h.title COLLATE NOCASE`,
        [now, now, startOfWeek(now, prefs.weekStartsOn)]
      )

      const pinnedNotes = repository.list('note', { where: { pinned: 1 }, limit: 8 }).rows

      // Money for the month, split so a forecast can never look like a balance.
      const month = monthKey(now)
      const monthRows = session.db.all<{ kind: string; amount_minor: number; status: string }>(
        "SELECT kind, amount_minor, status FROM transactions WHERE date LIKE ? || '%'",
        [month]
      )
      const actual = monthRows.filter((r) => r.status === 'actual')
      const income = actual.filter((r) => r.kind === 'income').reduce((s, r) => s + Math.abs(r.amount_minor), 0)
      const spend = actual.filter((r) => r.kind === 'expense').reduce((s, r) => s + Math.abs(r.amount_minor), 0)
      const planned = monthRows
        .filter((r) => r.status !== 'actual' && r.kind === 'expense')
        .reduce((s, r) => s + Math.abs(r.amount_minor), 0)

      const inbox = Number(
        session.db.scalar<number>("SELECT COUNT(*) FROM inbox_items WHERE status = 'new'") ?? 0
      )

      // "Expensive months ahead": the next six months of known commitments.
      const forwardView = forwardCostView(ctx, now, 6)

      return {
        date: now,
        attention: attention.slice(0, 40),
        counts: {
          overdue: attention.filter((a) => a.severity === 'overdue').length,
          today: attention.filter((a) => a.severity === 'today').length,
          soon: attention.filter((a) => a.severity === 'soon').length,
          inbox
        },
        agenda,
        tasksDue,
        waitingOn,
        habits,
        pinnedNotes,
        money: { month, incomeMinor: income, spendMinor: spend, plannedMinor: planned, currency: prefs.currency },
        forwardView
      }
    }
  )

  // -- Calendar -------------------------------------------------------------

  handle(
    'plan.calendar',
    z.object({ from: CalendarDateSchema, to: CalendarDateSchema }),
    ({ from, to }) => {
      const { repository } = ctx.require()
      const events = expandEvents(ctx, from, to)
      const tasks = repository
        .list<Record<string, unknown>>('task', { range: { column: 'due_date', from, to }, limit: 1000 })
        .rows.filter((t) => String(t.status) !== 'cancelled')
      const bills = upcomingBills(ctx, from, to)
      return { events, tasks, bills }
    }
  )

  /**
   * Workload warning: how much committed time and how many due tasks fall on
   * each day, so an overcommitted week is visible before it happens.
   */
  handle(
    'plan.workload',
    z.object({ from: CalendarDateSchema, to: CalendarDateSchema }),
    ({ from, to }) => {
      const { repository } = ctx.require()
      const events = expandEvents(ctx, from, to)
      const tasks = repository
        .list<Record<string, unknown>>('task', { range: { column: 'due_date', from, to }, limit: 1000 })
        .rows.filter((t) => !['done', 'cancelled'].includes(String(t.status)))

      const byDay = new Map<string, { committedMinutes: number; taskMinutes: number; tasks: number; events: number }>()
      const ensure = (day: string) => {
        let bucket = byDay.get(day)
        if (!bucket) {
          bucket = { committedMinutes: 0, taskMinutes: 0, tasks: 0, events: 0 }
          byDay.set(day, bucket)
        }
        return bucket
      }
      for (const event of events) {
        const bucket = ensure(event.date)
        bucket.events += 1
        if (event.allDay) continue
        const minutes = eventMinutes(event.startTime, event.endTime) + event.travelMinutes + event.prepMinutes
        bucket.committedMinutes += minutes
      }
      for (const task of tasks) {
        const day = String(task.due_date ?? '')
        if (!day) continue
        const bucket = ensure(day)
        bucket.tasks += 1
        bucket.taskMinutes += Number(task.estimate_minutes ?? 0) || 0
      }

      const days = [...byDay.entries()]
        .map(([date, v]) => ({
          date,
          ...v,
          totalMinutes: v.committedMinutes + v.taskMinutes,
          // Over six hours of committed time and estimated work in one day is
          // the point at which a plan stops being a plan.
          overcommitted: v.committedMinutes + v.taskMinutes > 360
        }))
        .sort((a, b) => a.date.localeCompare(b.date))

      return { days, overcommittedDays: days.filter((d) => d.overcommitted).length }
    }
  )

  // -- Money ----------------------------------------------------------------

  handle('money.overview', z.object({ months: z.number().int().min(1).max(24).optional() }), ({ months }) => {
    const { session, settings, repository } = ctx.require()
    const prefs = settings.all()
    const now = todayDate()
    const count = months ?? 6

    const monthKeys: string[] = []
    for (let i = count - 1; i >= 0; i--) monthKeys.push(monthKey(addMonthsClamped(now, -i, 1)))

    const rows = session.db.all<{ date: string; amount_minor: number; kind: string }>(
      "SELECT date, amount_minor, kind FROM transactions WHERE status = 'actual' AND date >= ?",
      [startOfMonth(addMonthsClamped(now, -(count - 1), 1))]
    )
    const series = cashflowByMonth(
      rows.map((r) => ({ date: r.date, amountMinor: r.amount_minor, kind: r.kind })),
      monthKeys
    )
    const thisMonth = series[series.length - 1] ?? { monthKey: monthKey(now), incomeMinor: 0, expenseMinor: 0, netMinor: 0 }

    const accounts = session.db.all<{
      id: string
      name: string
      kind: string
      currency: string
      opening_balance_minor: number
      include_in_net_worth: number
    }>('SELECT id, name, kind, currency, opening_balance_minor, include_in_net_worth FROM accounts WHERE archived_at IS NULL ORDER BY sort_order, name')

    const balances = accounts.map((account) => {
      const movement = Number(
        session.db.scalar<number>(
          "SELECT COALESCE(SUM(amount_minor), 0) FROM transactions WHERE account_id = ? AND status = 'actual'",
          [account.id]
        ) ?? 0
      )
      return {
        id: account.id,
        name: account.name,
        kind: account.kind,
        currency: account.currency,
        balanceMinor: Number(account.opening_balance_minor ?? 0) + movement,
        includeInNetWorth: Number(account.include_in_net_worth) === 1
      }
    })

    const spendByCategory = session.db.all<{ category: string; total: number }>(
      `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(ABS(t.amount_minor)) AS total
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.status = 'actual' AND t.kind = 'expense' AND t.date >= ? AND t.date <= ?
        GROUP BY category ORDER BY total DESC LIMIT 12`,
      [startOfMonth(now), endOfMonth(now)]
    )

    const owed = session.db.all<{ direction: string; id: string; amount_minor: number; due_date: string | null; status: string }>(
      "SELECT id, direction, amount_minor, due_date, status FROM money_agreements WHERE status = 'open'"
    )
    let owedToMe = 0
    let iOwe = 0
    let overdueCount = 0
    for (const agreement of owed) {
      const repayments = session.db.all<{ amount_minor: number }>(
        'SELECT amount_minor FROM money_repayments WHERE agreement_id = ?',
        [agreement.id]
      )
      const outstanding = outstandingMinor(agreement.amount_minor, repayments.map((r) => ({ amountMinor: r.amount_minor })))
      if (outstanding <= 0) continue
      if (agreement.direction === 'lent') owedToMe += outstanding
      else iOwe += outstanding
      if (isOverdue({ id: agreement.id, direction: agreement.direction as 'lent' | 'borrowed', amountMinor: agreement.amount_minor, dueDate: agreement.due_date, status: agreement.status }, outstanding, now)) {
        overdueCount += 1
      }
    }

    const awaitingRefunds = Number(
      session.db.scalar<number>(
        "SELECT COALESCE(SUM(refund_expected_minor), 0) FROM returns WHERE refund_received_on IS NULL AND status IN ('sent','received')"
      ) ?? 0
    )
    const awaitingClaims = Number(
      session.db.scalar<number>(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM expense_claims WHERE status IN ('submitted','chased','partial')"
      ) ?? 0
    )

    return {
      currency: prefs.currency,
      series,
      thisMonth,
      savingsRateBp: savingsRateBp(thisMonth.incomeMinor, thisMonth.expenseMinor),
      balances,
      spendByCategory,
      lending: { owedToMeMinor: owedToMe, iOweMinor: iOwe, overdueCount },
      waitingOnMoneyMinor: awaitingRefunds + awaitingClaims,
      transactionCount: repository.count('transaction')
    }
  })

  handle('money.budgets', z.object({ month: z.string().max(7).optional() }), ({ month }) => {
    const { session, settings } = ctx.require()
    const key = month ?? monthKey(todayDate())
    const prefs = settings.all()
    const budgets = session.db.all<{ id: string; category_id: string; limit_minor: number; currency: string; period: string; name: string }>(
      "SELECT id, category_id, limit_minor, currency, period, name FROM budgets WHERE archived_at IS NULL AND period = 'monthly'"
    )
    const results = budgets.map((budget) => {
      const spent = Number(
        session.db.scalar<number>(
          "SELECT COALESCE(SUM(ABS(amount_minor)), 0) FROM transactions WHERE status = 'actual' AND kind = 'expense' AND category_id = ? AND date LIKE ? || '%'",
          [budget.category_id, key]
        ) ?? 0
      )
      const category = session.db.get<{ name: string }>('SELECT name FROM categories WHERE id = ?', [budget.category_id])
      return {
        ...budgetProgress(
          { id: budget.id, categoryId: budget.category_id, limitMinor: budget.limit_minor, currency: budget.currency || prefs.currency },
          spent
        ),
        name: budget.name || category?.name || 'Budget',
        categoryName: category?.name ?? 'Uncategorised'
      }
    })
    const totalLimit = results.reduce((s, r) => s + r.limitMinor, 0)
    const totalSpent = results.reduce((s, r) => s + r.spentMinor, 0)
    return { month: key, budgets: results, totalLimitMinor: totalLimit, totalSpentMinor: totalSpent, currency: prefs.currency }
  })

  handle('money.bills', z.object({ days: z.number().int().min(1).max(400).optional() }), ({ days }) => {
    const now = todayDate()
    const to = addDays(now, days ?? 60)
    return { from: now, to, bills: upcomingBills(ctx, now, to) }
  })

  handle('bills.upcoming', z.object({ from: CalendarDateSchema, to: CalendarDateSchema }), ({ from, to }) =>
    ({ bills: upcomingBills(ctx, from, to) })
  )

  /**
   * Record a bill as paid for a specific period, optionally creating the
   * matching transaction. The period key means a bill can never be marked paid
   * twice for the same month, which was a real failure mode in the Amethyst
   * prototype's notes-string approach.
   */
  handle(
    'bills.markPaid',
    z.object({
      billId: RecordId,
      periodKey: z.string().min(4).max(20),
      dueDate: CalendarDateSchema,
      paidOn: CalendarDateSchema.optional(),
      amountMinor: z.number().int().optional(),
      accountId: RecordId.optional(),
      createTransaction: z.boolean().optional()
    }),
    ({ billId, periodKey, dueDate, paidOn, amountMinor, accountId, createTransaction }) => {
      const { session, repository, settings } = ctx.require()
      const bill = repository.get<Record<string, unknown>>('bill', billId)
      if (!bill) throw new Error('That bill is not in this vault.')
      const when = paidOn ?? todayDate()
      const amount = amountMinor ?? Number(bill.amount_minor ?? 0)
      const currency = String(bill.currency || settings.all().currency)

      return session.db.transaction(() => {
        let transactionId: string | null = null
        if (createTransaction) {
          const account = accountId ?? (bill.account_id ? String(bill.account_id) : '')
          if (!account) {
            throw new Error('Choose which account this was paid from before recording the payment.')
          }
          const created = repository.create(
            'transaction',
            {
              account_id: account,
              date: when,
              description: String(bill.name ?? 'Bill'),
              amount_minor: -Math.abs(amount),
              currency,
              kind: 'expense',
              status: 'actual',
              category_id: bill.category_id ?? null,
              bill_id: billId,
              bill_period: periodKey
            },
            { summary: 'Recorded a bill payment' }
          )
          if (!created.ok) {
            throw new Error(created.errors[0]?.message ?? 'The payment could not be recorded.')
          }
          transactionId = created.id
        }
        const now = new Date().toISOString()
        session.db.run(
          `INSERT INTO bill_payments (id, bill_id, period_key, due_date, amount_minor, currency, paid_on, transaction_id, status, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', '', ?, ?)
           ON CONFLICT(bill_id, period_key) DO UPDATE SET
             paid_on = excluded.paid_on,
             status = 'paid',
             amount_minor = excluded.amount_minor,
             transaction_id = COALESCE(excluded.transaction_id, bill_payments.transaction_id),
             updated_at = excluded.updated_at`,
          [
            `bp_${billId}_${periodKey}`,
            billId,
            periodKey,
            dueDate,
            Math.abs(amount),
            currency,
            when,
            transactionId,
            now,
            now
          ]
        )
        broadcast('records.changed', { type: 'bill', id: billId, action: 'updated' })
        return { paid: true, transactionId }
      })
    }
  )

  handle('money.netWorth', Empty, () => {
    const { session, settings } = ctx.require()
    const prefs = settings.all()
    const accounts = session.db.all<{ id: string; name: string; kind: string; opening_balance_minor: number; currency: string }>(
      'SELECT id, name, kind, opening_balance_minor, currency FROM accounts WHERE archived_at IS NULL AND include_in_net_worth = 1'
    )
    const lines = accounts.map((account) => {
      const movement = Number(
        session.db.scalar<number>(
          "SELECT COALESCE(SUM(amount_minor), 0) FROM transactions WHERE account_id = ? AND status = 'actual'",
          [account.id]
        ) ?? 0
      )
      const balance = Number(account.opening_balance_minor ?? 0) + movement
      const isLiability = ['credit-card', 'loan', 'mortgage'].includes(account.kind)
      return {
        label: account.name,
        amountMinor: isLiability ? Math.abs(balance) : balance,
        kind: (isLiability ? 'liability' : 'asset') as 'asset' | 'liability',
        currency: account.currency
      }
    })
    const holdings = session.db.all<{ name: string; value_minor: number; as_of_date: string; currency: string }>(
      'SELECT name, value_minor, as_of_date, currency FROM holdings'
    )
    for (const holding of holdings) {
      lines.push({ label: holding.name, amountMinor: holding.value_minor, kind: 'asset', currency: holding.currency })
    }
    const mixedCurrency = new Set(lines.map((l) => l.currency).filter(Boolean))
    const summary = netWorth(lines)
    return {
      ...summary,
      lines,
      currency: prefs.currency,
      // Stated rather than silently summed: adding up two currencies without a
      // dated rate would be a fiction.
      mixedCurrency: mixedCurrency.size > 1,
      currenciesPresent: [...mixedCurrency],
      staleValuations: holdings
        .filter((h) => daysBetween(h.as_of_date, todayDate()) > 120)
        .map((h) => ({ name: h.name, asOf: h.as_of_date }))
    }
  })

  handle('money.payroll', z.object({ profileId: RecordId.optional() }), ({ profileId }) => {
    const { session, settings } = ctx.require()
    const profile = profileId
      ? session.db.get<Record<string, unknown>>('SELECT * FROM payroll_profiles WHERE id = ?', [profileId])
      : session.db.get<Record<string, unknown>>('SELECT * FROM payroll_profiles WHERE active = 1 ORDER BY created_at LIMIT 1')
    if (!profile) return { configured: false as const, currency: settings.all().currency }

    const input: PayrollInput = {
      salaryMinor: Number(profile.salary_minor ?? 0),
      bonusMinor: Number(profile.bonus_minor ?? 0),
      frequency: String(profile.frequency ?? 'monthly') as PayFrequency,
      region: String(profile.region ?? 'rUK') as TaxRegion,
      taxCode: String(profile.tax_code ?? '1257L'),
      niCategory: String(profile.ni_category ?? 'A'),
      pensionRateBp: Number(profile.pension_rate_bp ?? 0),
      pensionType: String(profile.pension_type ?? 'none') as PensionType,
      studentPlan: String(profile.student_plan ?? 'none') as StudentPlan,
      postgraduate: Number(profile.postgraduate ?? 0) === 1,
      taxYear: String(profile.tax_year ?? '2025-26')
    }
    const breakdown = calculatePayroll(input)
    const paydays = nextPaydays(String(profile.payday ?? todayDate()), input.frequency, todayDate(), 6)
    return {
      configured: true as const,
      profile,
      breakdown,
      paydays,
      currency: String(profile.currency ?? settings.all().currency)
    }
  })

  handle(
    'money.repaymentPlan',
    z.object({ monthlyMinor: z.number().int().min(0).max(100_000_000), strategy: z.enum(['snowball', 'avalanche']) }),
    ({ monthlyMinor, strategy }) => {
      const { session, settings } = ctx.require()
      const accounts = session.db.all<{ id: string; name: string; opening_balance_minor: number; interest_rate_bp: number | null }>(
        "SELECT id, name, opening_balance_minor, interest_rate_bp FROM accounts WHERE kind IN ('credit-card','loan','mortgage') AND archived_at IS NULL"
      )
      const debts = accounts.map((account) => {
        const movement = Number(
          session.db.scalar<number>(
            "SELECT COALESCE(SUM(amount_minor), 0) FROM transactions WHERE account_id = ? AND status = 'actual'",
            [account.id]
          ) ?? 0
        )
        const balance = Math.abs(Number(account.opening_balance_minor ?? 0) + movement)
        return {
          id: account.id,
          name: account.name,
          balanceMinor: balance,
          aprBp: Number(account.interest_rate_bp ?? 0),
          // Without a stated minimum, 2% of the balance is the common credit
          // card rule. It is an assumption, and it is reported as one.
          minimumPaymentMinor: Math.max(500, Math.round(balance * 0.02))
        }
      })
      const plan = planRepayment(debts, monthlyMinor, strategy)
      return {
        ...plan,
        debts,
        currency: settings.all().currency,
        assumptions: [...plan.assumptions, 'Minimum payments assumed to be 2% of the balance where none is recorded']
      }
    }
  )

  // -- The connected detail view --------------------------------------------

  /**
   * Everything about one record, gathered in a single call: its own fields, the
   * documents attached to it, what it has cost, what is due, who is involved
   * and what has changed.
   *
   * This is the screen the whole product exists for. A car is not a row in a
   * table; it is a policy, an MOT, a service history, a fuel bill and a finance
   * agreement that happen to share a registration number.
   */
  handle('record.detail', z.object({ type: EntityType, id: RecordId }), ({ type, id }) => {
    const { repository, attachments, session } = ctx.require()
    const entity = requireEntity(type)
    const record = repository.get<Record<string, unknown>>(type, id)
    if (!record) throw new Error('That record is not in this vault.')

    const costs: { label: string; amountMinor: number; currency: string; date: string; source: string }[] = []
    for (const rollup of entity.costRollup ?? []) {
      try {
        const rows = session.db.all<Record<string, unknown>>(
          `SELECT "${rollup.amountColumn}" AS amount, "${rollup.dateColumn}" AS on_date${
            rollup.currencyColumn ? `, "${rollup.currencyColumn}" AS currency` : ''
          } FROM "${rollup.table}" WHERE "${rollup.foreignKey}" = ?`,
          [id]
        )
        for (const row of rows) {
          const amount = Number(row.amount ?? 0)
          if (!amount) continue
          costs.push({
            label: rollup.table.replace(/_/g, ' '),
            amountMinor: Math.abs(amount),
            currency: String(row.currency ?? ''),
            date: String(row.on_date ?? ''),
            source: rollup.table
          })
        }
      } catch {
        // A rollup naming a table this vault has not migrated yet is skipped
        // rather than failing the whole detail view.
      }
    }
    costs.sort((a, b) => b.date.localeCompare(a.date))

    const linked = repository.linkedRecords(type, id)
    const related = linked
      .map((link) => {
        try {
          const linkedEntity = requireEntity(link.type)
          const row = repository.get<Record<string, unknown>>(link.type, link.id)
          if (!row) return null
          return {
            type: link.type,
            id: link.id,
            label: linkedEntity.label,
            title: String(row[linkedEntity.titleField] ?? '(untitled)'),
            date: linkedEntity.dateField ? String(row[linkedEntity.dateField] ?? '') : '',
            relation: link.relation
          }
        } catch {
          return null
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const tags = session.db.all<{ id: string; name: string; colour: string }>(
      'SELECT t.id, t.name, t.colour FROM tags t JOIN taggings g ON g.tag_id = t.id WHERE g.entity_type = ? AND g.entity_id = ?',
      [type, id]
    )
    const notes = session.db.all<Record<string, unknown>>(
      'SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY updated_at DESC',
      [type, id]
    )
    const reminders = session.db.all<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE entity_type = ? AND entity_id = ? ORDER BY remind_on',
      [type, id]
    )

    return {
      entity,
      record,
      attachments: attachments.listFor(type, id),
      costs,
      totalCostMinor: costs.reduce((sum, c) => sum + c.amountMinor, 0),
      related,
      tags,
      notes,
      reminders,
      history: repository.history(type, id, 30)
    }
  })

  // -- Reminders -------------------------------------------------------------

  handle('reminders.due', z.object({ horizonDays: z.number().int().min(1).max(365).optional() }), ({ horizonDays }) => {
    const { reminders } = ctx.require()
    return { items: reminders.attention({ horizonDays: horizonDays ?? 30 }) }
  })

  handle('reminders.acknowledge', z.object({ id: RecordId }), ({ id }) => {
    const { reminders } = ctx.require()
    reminders.acknowledge(id)
    broadcast('records.changed', { type: 'reminder', id, action: 'updated' })
    return { acknowledged: true }
  })

  handle('reminders.snooze', z.object({ id: RecordId, days: z.number().int().min(1).max(365) }), ({ id, days }) => {
    const { reminders } = ctx.require()
    reminders.snooze(id, days)
    broadcast('records.changed', { type: 'reminder', id, action: 'updated' })
    return { snoozed: true }
  })
}

// ---------------------------------------------------------------------------
// Shared derivations
// ---------------------------------------------------------------------------

export interface ExpandedEvent {
  id: string
  seriesId: string
  title: string
  date: CalendarDate
  startTime: string
  endTime: string
  allDay: boolean
  kind: string
  location: string
  travelMinutes: number
  prepMinutes: number
  module: string
  recurring: boolean
}

/** Expand stored events, including recurring ones, into dated occurrences. */
export function expandEvents(ctx: AppContext, from: CalendarDate, to: CalendarDate): ExpandedEvent[] {
  const { session } = ctx.require()
  const rows = session.db.all<Record<string, unknown>>(
    `SELECT * FROM events WHERE (recurrence <> '' OR (start_date >= ? AND start_date <= ?)) ORDER BY start_date`,
    [from, to]
  )
  const exceptions = session.db.all<{ event_id: string; occurrence_date: string; action: string; new_start_date: string | null }>(
    'SELECT event_id, occurrence_date, action, new_start_date FROM event_exceptions'
  )
  const exceptionsByEvent = new Map<string, Map<string, { action: string; newDate: string | null }>>()
  for (const ex of exceptions) {
    let map = exceptionsByEvent.get(ex.event_id)
    if (!map) {
      map = new Map()
      exceptionsByEvent.set(ex.event_id, map)
    }
    map.set(ex.occurrence_date, { action: ex.action, newDate: ex.new_start_date })
  }

  const out: ExpandedEvent[] = []
  for (const row of rows) {
    const id = String(row.id)
    const base: Omit<ExpandedEvent, 'date'> = {
      id,
      seriesId: String(row.series_id || id),
      title: String(row.title ?? ''),
      startTime: String(row.start_time ?? ''),
      endTime: String(row.end_time ?? ''),
      allDay: Number(row.all_day) === 1,
      kind: String(row.kind ?? 'event'),
      location: String(row.location ?? ''),
      travelMinutes: Number(row.travel_minutes ?? 0),
      prepMinutes: Number(row.prep_minutes ?? 0),
      module: String(row.module ?? ''),
      recurring: Boolean(row.recurrence)
    }
    const rule = row.recurrence ? normaliseRule(safeJson(String(row.recurrence))) : null
    const anchor = String(row.recurrence_anchor || row.start_date)
    const dates = rule ? expandRecurrence(anchor, rule, from, to, 400) : [String(row.start_date)]
    const overrides = exceptionsByEvent.get(id)
    for (const date of dates) {
      if (date < from || date > to) continue
      const override = overrides?.get(date)
      if (override?.action === 'skip') continue
      out.push({ ...base, date: override?.newDate ?? date })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''))
}

export interface UpcomingBill {
  billId: string
  name: string
  dueDate: CalendarDate
  periodKey: string
  amountMinor: number
  currency: string
  paid: boolean
  paidOn: string | null
  kind: string
  daysAway: number
}

export function upcomingBills(ctx: AppContext, from: CalendarDate, to: CalendarDate): UpcomingBill[] {
  const { session } = ctx.require()
  const bills = session.db.all<{
    id: string
    name: string
    amount_minor: number
    currency: string
    cadence: string
    anchor_date: string
    due_day: number | null
    status: string
    kind: string
  }>("SELECT id, name, amount_minor, currency, cadence, anchor_date, due_day, status, kind FROM bills WHERE status = 'active'")

  const payments = session.db.all<{ bill_id: string; period_key: string; paid_on: string | null; status: string }>(
    'SELECT bill_id, period_key, paid_on, status FROM bill_payments'
  )
  const paidIndex = new Map(payments.map((p) => [`${p.bill_id}:${p.period_key}`, p]))
  const now = todayDate()

  const out: UpcomingBill[] = []
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
      from,
      to
    )
    for (const occurrence of occurrences) {
      const payment = paidIndex.get(`${bill.id}:${occurrence.periodKey}`)
      out.push({
        billId: bill.id,
        name: bill.name,
        dueDate: occurrence.dueDate,
        periodKey: occurrence.periodKey,
        amountMinor: occurrence.amountMinor,
        currency: occurrence.currency,
        paid: payment?.status === 'paid',
        paidOn: payment?.paid_on ?? null,
        kind: bill.kind,
        daysAway: daysBetween(now, occurrence.dueDate)
      })
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/** Known committed cost per month for the next `months` months. */
function forwardCostView(
  ctx: AppContext,
  from: CalendarDate,
  months: number
): { monthKey: string; committedMinor: number; billCount: number; busiest: boolean }[] {
  const to = endOfMonth(addMonthsClamped(from, months - 1, 1))
  const bills = upcomingBills(ctx, startOfMonth(from), to)
  const buckets = new Map<string, { committedMinor: number; billCount: number }>()
  for (let i = 0; i < months; i++) {
    buckets.set(monthKey(addMonthsClamped(from, i, 1)), { committedMinor: 0, billCount: 0 })
  }
  for (const bill of bills) {
    const bucket = buckets.get(monthKey(bill.dueDate))
    if (!bucket) continue
    bucket.committedMinor += bill.amountMinor
    bucket.billCount += 1
  }
  const rows = [...buckets.entries()].map(([key, value]) => ({ monthKey: key, ...value, busiest: false }))
  const max = Math.max(0, ...rows.map((r) => r.committedMinor))
  for (const row of rows) row.busiest = max > 0 && row.committedMinor === max
  return rows
}

function eventMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return startTime ? 60 : 0
  const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const diff = toMinutes(endTime) - toMinutes(startTime)
  return diff > 0 ? diff : 60
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

export { billPeriodKey, latenessProfile, projectSettlement }
