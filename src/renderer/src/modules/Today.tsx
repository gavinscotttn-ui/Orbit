import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AttentionItem } from '@shared/contracts/ipc.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money, moneyCompact, relative, time as fmtTime } from '../lib/format.js'
import { today as todayDate } from '@shared/domain/time.js'
import { Icon, type IconName } from '../components/Icon.js'
import { Chip, EmptyState, ErrorState, Loading, Meter, SectionHeading } from '../components/ui.js'
import { RecordEditor } from '../components/RecordEditor.js'
import type { Navigator } from '../app/App.js'

/**
 * Today.
 *
 * The one screen that answers "what needs me?" without being asked. Everything
 * on it is derived from the records themselves at the moment it is drawn, so it
 * cannot disagree with the rest of the application.
 *
 * The honest limitation, printed on the screen rather than hidden in a manual:
 * these are worked out while Orbit is running. Orbit does not install a
 * background service on your computer, so a reminder for Tuesday is seen when
 * you next open it, not while it is closed.
 */

interface Brief {
  date: string
  attention: AttentionItem[]
  counts: { overdue: number; today: number; soon: number; inbox: number }
  agenda: {
    id: string
    title: string
    date: string
    startTime: string
    endTime: string
    allDay: boolean
    location: string
    kind: string
  }[]
  tasksDue: Record<string, unknown>[]
  waitingOn: Record<string, unknown>[]
  habits: Record<string, unknown>[]
  pinnedNotes: Record<string, unknown>[]
  money: { month: string; incomeMinor: number; spendMinor: number; plannedMinor: number; currency: string }
  forwardView: { monthKey: string; committedMinor: number; billCount: number; busiest: boolean }[]
}

export function TodayPage({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, bumpRevision, settings, entities, toast } = useApp()
  const [brief, setBrief] = useState<Brief | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    const result = await call<Brief>('today.brief', { horizonDays: 45 })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setBrief(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load, revision])

  const greeting = greetingFor(new Date().getHours(), settings?.vaultOwnerName ?? '')

  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!brief) return <Loading rows={8} label="Working out what needs your attention" />

  const overdue = brief.attention.filter((a) => a.severity === 'overdue')
  const dueToday = brief.attention.filter((a) => a.severity === 'today')
  const soon = brief.attention.filter((a) => a.severity === 'soon')
  const later = brief.attention.filter((a) => a.severity === 'upcoming')
  const nothingAtAll =
    brief.attention.length === 0 && brief.agenda.length === 0 && brief.tasksDue.length === 0 && brief.habits.length === 0

  const forward = describeForwardView(brief.forwardView)

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <p className="kicker">
            {new Date().toLocaleDateString(format.locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>{greeting}</h1>
          <p className="sub">{summarise(overdue.length, dueToday.length, soon.length, brief.counts.inbox)}</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setAdding('task')}>
            <Icon name="plus" size={14} />
            New task
          </button>
          <button className="btn" onClick={() => setAdding('event')}>
            <Icon name="calendar" size={14} />
            New event
          </button>
        </div>
      </div>

      {nothingAtAll ? (
        <div className="card">
          <EmptyState
            icon="today"
            title="Nothing needs you right now"
            message="Once you have added a few bills, documents or vehicles, this page fills itself in — what is due, what is expiring, and what you are still waiting on."
            action={
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => nav.go({ page: 'life' })}>
                  Add something to track
                </button>
                <button className="btn" onClick={() => nav.go({ page: 'settings', section: 'modules' })}>
                  Choose your areas
                </button>
              </div>
            }
          />
        </div>
      ) : null}

      {overdue.length > 0 || dueToday.length > 0 ? (
        <div className="card" style={{ borderColor: overdue.length > 0 ? 'color-mix(in srgb, var(--bad) 35%, var(--line))' : 'var(--line)' }}>
          <div className="card-head">
            <div>
              <h2>Needs your attention</h2>
              <p className="sub">
                {overdue.length > 0
                  ? `${overdue.length} overdue${dueToday.length > 0 ? `, ${dueToday.length} due today` : ''}`
                  : `${dueToday.length} due today`}
              </p>
            </div>
          </div>
          <div className="card-body flush">
            <ul>
              {[...overdue, ...dueToday].slice(0, 12).map((item) => (
                <AttentionRow key={item.id} item={item} nav={nav} formatCtx={format} />
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="grid wide-first" style={{ marginTop: 'var(--gap)' }}>
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          {/* Today's diary */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Today</h2>
                <p className="sub">{fmtDate(brief.date, format, 'long')}</p>
              </div>
              <button className="btn small" onClick={() => nav.go({ page: 'plan' })}>
                Open the calendar
              </button>
            </div>
            <div className="card-body flush">
              {brief.agenda.length === 0 && brief.tasksDue.length === 0 ? (
                <EmptyState icon="calendar" title="A clear day" message="Nothing in the diary and nothing due." />
              ) : (
                <ul>
                  {brief.agenda.map((event) => (
                    <li
                      key={`${event.id}:${event.date}`}
                      style={{ display: 'flex', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}
                    >
                      <span
                        className="num"
                        style={{ width: 54, flex: '0 0 auto', color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}
                      >
                        {event.allDay ? 'All day' : fmtTime(event.startTime) || '—'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ display: 'block', fontSize: 13, fontWeight: 570 }}>{event.title}</b>
                        {event.location ? (
                          <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>{event.location}</small>
                        ) : null}
                      </span>
                    </li>
                  ))}
                  {brief.tasksDue.slice(0, 10).map((task) => (
                    <TaskRow
                      key={String(task.id)}
                      task={task}
                      onDone={() => {
                        void (async () => {
                          const result = await call<{ updated: boolean; createdNext: string | null }>('tasks.complete', {
                            id: String(task.id),
                            done: true
                          })
                          if (result.ok) {
                            bumpRevision()
                            toast({
                              tone: 'good',
                              title: 'Done',
                              ...(result.data.createdNext ? { detail: 'The next one has been scheduled.' } : {}),
                              action: {
                                label: 'Undo',
                                run: () => {
                                  void call('tasks.complete', { id: String(task.id), done: false }).then(() => bumpRevision())
                                }
                              }
                            })
                          }
                        })()
                      }}
                      onOpen={() => nav.openRecord('task', String(task.id))}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Coming up */}
          {soon.length > 0 || later.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Coming up</h2>
                  <p className="sub">The next few weeks</p>
                </div>
              </div>
              <div className="card-body flush">
                <ul>
                  {[...soon, ...later].slice(0, 14).map((item) => (
                    <AttentionRow key={item.id} item={item} nav={nav} formatCtx={format} />
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {/* Waiting on */}
          {brief.waitingOn.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Waiting on someone else</h2>
                  <p className="sub">Replies, deliveries, refunds and decisions</p>
                </div>
              </div>
              <div className="card-body flush">
                <ul>
                  {brief.waitingOn.map((task) => (
                    <li
                      key={String(task.id)}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        padding: '11px 16px',
                        borderBottom: '1px solid var(--line)'
                      }}
                    >
                      <span style={{ color: 'var(--warn)' }}>
                        <Icon name="clock" size={15} />
                      </span>
                      <button
                        style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
                        onClick={() => nav.openRecord('task', String(task.id))}
                      >
                        <b style={{ display: 'block', fontSize: 13, fontWeight: 560 }}>{String(task.title)}</b>
                        <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                          {task.waiting_since
                            ? `Waiting since ${fmtDate(String(task.waiting_since), format)}`
                            : 'Waiting'}
                          {task.waiting_expected_by ? ` · expected ${fmtDate(String(task.waiting_expected_by), format)}` : ''}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right column */}
        <div style={{ display: 'grid', gap: 'var(--gap)', alignContent: 'start' }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>This month</h2>
                <p className="sub">Actual money only</p>
              </div>
              <button className="btn small" onClick={() => nav.go({ page: 'money' })}>
                Money
              </button>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 12 }}>
              {brief.money.incomeMinor === 0 && brief.money.spendMinor === 0 ? (
                /* Three zeroes and an empty bar look like a broken screen. Say
                   what is actually true: there is nothing recorded yet. */
                <p className="help" style={{ margin: 0 }}>
                  No money has been recorded this month yet. Add transactions, or import a statement, and this fills in.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)' }}>In</span>
                    <span className="money in">{money(brief.money.incomeMinor, format, brief.money.currency)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)' }}>Out</span>
                    <span className="money out">{money(brief.money.spendMinor, format, brief.money.currency)}</span>
                  </div>
                  {brief.money.incomeMinor > 0 ? (
                    <Meter
                      value={brief.money.spendMinor}
                      max={Math.max(brief.money.incomeMinor, brief.money.spendMinor, 1)}
                      tone={brief.money.spendMinor > brief.money.incomeMinor ? 'bad' : 'good'}
                      label="Spending against income this month"
                    />
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                    <span>{brief.money.incomeMinor > 0 ? 'Left' : 'Net'}</span>
                    <span className={`money ${brief.money.incomeMinor - brief.money.spendMinor < 0 ? 'out' : 'in'}`}>
                      {money(brief.money.incomeMinor - brief.money.spendMinor, format, brief.money.currency)}
                    </span>
                  </div>
                </>
              )}
              {brief.money.plannedMinor > 0 ? (
                <p className="help">
                  {money(brief.money.plannedMinor, format, brief.money.currency)} more is planned or forecast this month.
                  Those are not counted above.
                </p>
              ) : null}
            </div>
          </div>

          {/* Forward view: which months are going to hurt */}
          {brief.forwardView.some((m) => m.committedMinor > 0) ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Months ahead</h2>
                  <p className="sub">{forward.subtitle}</p>
                </div>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 9 }}>
                {brief.forwardView.map((month) => (
                  <div key={month.monthKey} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: month.busiest ? 'var(--warn)' : 'var(--muted)', fontWeight: month.busiest ? 650 : 500 }}>
                        {monthLabel(month.monthKey, format.locale)}
                        {month.busiest ? ' — the dearest' : ''}
                      </span>
                      <span className="num">{moneyCompact(month.committedMinor, format)}</span>
                    </div>
                    {/* Scaled with headroom so the largest month reads as the
                        largest rather than as a bar that has run out of card. */}
                    <Meter
                      value={month.committedMinor}
                      max={forward.scale}
                      tone={month.busiest ? 'warn' : 'accent'}
                      label={`Committed in ${month.monthKey}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Habits */}
          {brief.habits.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2>Today's routines</h2>
              </div>
              <div className="card-body flush">
                <ul>
                  {brief.habits.map((habit) => {
                    const done = Number(habit.done_today) > 0
                    return (
                      <li
                        key={String(habit.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}
                      >
                        <button
                          className={`btn icon small${done ? ' primary' : ''}`}
                          aria-label={done ? `Undo ${String(habit.title)}` : `Mark ${String(habit.title)} done`}
                          aria-pressed={done}
                          onClick={() => {
                            void (async () => {
                              const checkinId = habit.checkin_id ? String(habit.checkin_id) : ''
                              const result =
                                done && checkinId
                                  ? await call('records.delete', { type: 'habit_checkin', id: checkinId })
                                  : await call('records.create', {
                                      type: 'habit_checkin',
                                      data: { habit_id: String(habit.id), on_date: todayDate(), value: 1 }
                                    })
                              if (result.ok) bumpRevision()
                              else toast({ tone: 'bad', title: 'That could not be recorded', detail: result.error })
                            })()
                          }}
                        >
                          <Icon name="check" size={14} />
                        </button>
                        <span style={{ flex: 1, fontSize: 13, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--muted)' : 'inherit' }}>
                          {String(habit.title)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          ) : null}

          {/* Pinned notes */}
          {brief.pinnedNotes.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2>Pinned</h2>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                {brief.pinnedNotes.map((note) => (
                  <div key={String(note.id)}>
                    {note.title ? <b style={{ display: 'block', fontSize: 12.5 }}>{String(note.title)}</b> : null}
                    <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{String(note.body ?? '')}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <p className="help" style={{ padding: '0 4px' }}>
            These are worked out while Orbit is running. Orbit does not install anything that runs in the background, so
            a reminder for Tuesday is seen when you next open it.
          </p>
        </div>
      </div>

      <SectionHeading title="Weekly review" sub="A quarter of an hour that saves you a fortnight" />
      <div className="grid three">
        <ReviewCard
          icon="inbox"
          title="Clear the inbox"
          count={brief.counts.inbox}
          label="waiting to be sorted"
          onClick={() => nav.go({ page: 'inbox' })}
        />
        <ReviewCard
          icon="clock"
          title="Chase what you are owed"
          count={brief.waitingOn.length}
          label="things you are waiting on"
          onClick={() => nav.go({ page: 'money', view: 'owed' })}
        />
        <ReviewCard
          icon="bill"
          title="Check the bills"
          count={brief.attention.filter((a) => a.entityType === 'bill' || a.entityType === 'bill_payment').length}
          label="bills and renewals coming"
          onClick={() => nav.go({ page: 'money', view: 'bills' })}
        />
      </div>

      {adding ? (
        <RecordEditorLauncher type={adding} onClose={() => setAdding(null)} onSaved={() => bumpRevision()} entities={entities} />
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------

function AttentionRow({
  item,
  nav,
  formatCtx
}: {
  item: AttentionItem
  nav: Navigator
  formatCtx: Parameters<typeof money>[1]
}): ReactNode {
  const tone = item.severity === 'overdue' ? 'bad' : item.severity === 'today' ? 'warn' : 'neutral'
  const icon: IconName =
    item.entityType === 'bill' || item.entityType === 'bill_payment'
      ? 'bill'
      : item.entityType === 'document' || item.entityType === 'policy'
        ? 'document'
        : item.entityType === 'return'
          ? 'undo'
          : item.entityType === 'task'
            ? 'task'
            : item.entityType === 'medication'
              ? 'heart'
              : 'clock'

  return (
    <li style={{ borderBottom: '1px solid var(--line)' }}>
      <button
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 16px', textAlign: 'left' }}
        onClick={() => nav.openRecord(mapEntityType(item.entityType), item.entityId)}
      >
        <span style={{ color: tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>
          <Icon name={icon} size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 13, fontWeight: 570 }}>{item.title}</b>
          <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
            {item.detail}
            {item.date ? ` · ${fmtDate(item.date, formatCtx)}` : ''}
          </small>
        </span>
        {item.amountMinor !== undefined ? (
          <span className="money" style={{ fontSize: 13 }}>
            {money(item.amountMinor, formatCtx, item.currency)}
          </span>
        ) : null}
        <Chip tone={tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'neutral'}>
          {item.daysAway === 0 ? 'Today' : relative(item.daysAway, formatCtx)}
        </Chip>
      </button>
    </li>
  )
}

/** The attention engine names some virtual types; map them to real records. */
function mapEntityType(type: string): string {
  if (type === 'bill_payment') return 'bill'
  if (type === 'maintenance_schedule') return 'maintenance_schedule'
  return type
}

function TaskRow({
  task,
  onDone,
  onOpen
}: {
  task: Record<string, unknown>
  onDone: () => void
  onOpen: () => void
}): ReactNode {
  const priority = Number(task.priority ?? 0)
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
      <button className="btn icon small" onClick={onDone} aria-label={`Mark "${String(task.title)}" done`}>
        <Icon name="check" size={14} />
      </button>
      <button style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={onOpen}>
        <b style={{ display: 'block', fontSize: 13, fontWeight: 560 }}>{String(task.title)}</b>
        {task.notes ? (
          <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>{String(task.notes).slice(0, 90)}</small>
        ) : null}
      </button>
      {priority >= 3 ? <Chip tone={priority === 4 ? 'bad' : 'warn'}>{priority === 4 ? 'Urgent' : 'High'}</Chip> : null}
    </li>
  )
}

function ReviewCard({
  icon,
  title,
  count,
  label,
  onClick
}: {
  icon: IconName
  title: string
  count: number
  label: string
  onClick: () => void
}): ReactNode {
  return (
    <button className="card" style={{ display: 'flex', gap: 13, padding: 16, textAlign: 'left', alignItems: 'center' }} onClick={onClick}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          flex: '0 0 auto',
          borderRadius: 11,
          background: 'var(--accent-soft)',
          color: 'var(--accent)'
        }}
      >
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>
        <b style={{ display: 'block', fontSize: 13.5 }}>{title}</b>
        <small style={{ color: 'var(--muted)', fontSize: 12 }}>
          {count} {label}
        </small>
      </span>
      <Icon name="chevron-right" size={15} />
    </button>
  )
}

function RecordEditorLauncher({
  type,
  onClose,
  onSaved,
  entities
}: {
  type: string
  onClose: () => void
  onSaved: () => void
  entities: { type: string }[]
}): ReactNode {
  const entity = entities.find((e) => e.type === type)
  if (!entity) return null
  return <RecordEditor entity={entity as never} onClose={onClose} onSaved={onSaved} />
}

function greetingFor(hour: number, name: string): string {
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}` : part
}

function summarise(overdue: number, today: number, soon: number, inbox: number): string {
  const bits: string[] = []
  if (overdue > 0) bits.push(`${overdue} overdue`)
  if (today > 0) bits.push(`${today} due today`)
  if (soon > 0) bits.push(`${soon} coming up`)
  if (inbox > 0) bits.push(`${inbox} in your inbox`)
  if (bits.length === 0) return 'Nothing is overdue and nothing is due today.'
  return bits.join(' · ')
}

function monthLabel(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number]
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - 1, 1))
    )
  } catch {
    return monthKey
  }
}

/**
 * The "months ahead" card, described honestly.
 *
 * Six bars all at full width tell you nothing, and calling every month "the
 * dearest" when they are identical is worse than saying nothing. So the bars
 * are scaled with headroom, and the subtitle says what the shape actually is.
 */
function describeForwardView(
  months: { monthKey: string; committedMinor: number; billCount: number; busiest: boolean }[]
): { scale: number; subtitle: string } {
  const amounts = months.map((m) => m.committedMinor)
  const max = Math.max(0, ...amounts)
  const min = Math.min(...amounts, max)
  const scale = Math.max(1, Math.round(max * 1.12))
  if (max > 0 && max === min) {
    return { scale, subtitle: 'The same every month, on what you have told Orbit so far' }
  }
  return { scale, subtitle: 'Committed bills already known about' }
}
