import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money, relative, time as fmtTime } from '../lib/format.js'
import {
  addDays,
  addMonthsClamped,
  dayOfWeek,
  daysInMonth,
  endOfMonth,
  startOfMonth,
  startOfWeek,
  today as todayDate,
  type CalendarDate
} from '@shared/domain/time.js'
import { Icon } from '../components/Icon.js'
import { Chip, EmptyState, ErrorState, Loading, Modal, Notice } from '../components/ui.js'
import { RecordList } from '../components/RecordList.js'
import { RecordEditor } from '../components/RecordEditor.js'
import type { Navigator } from '../app/App.js'

/**
 * Plan: the calendar, the task list, workload and the life-event templates.
 *
 * The calendar draws events, tasks and bills together, because a month with
 * three bills and a car service in it is a busy month whether or not any of
 * those are "appointments".
 */

type View = 'month' | 'week' | 'agenda' | 'tasks' | 'workload' | 'life-events'

interface CalendarEvent {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  allDay: boolean
  kind: string
  location: string
  recurring: boolean
}

interface CalendarData {
  events: CalendarEvent[]
  tasks: Record<string, unknown>[]
  bills: { billId: string; name: string; dueDate: string; amountMinor: number; currency: string; paid: boolean }[]
}

export function PlanPage({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, entities } = useApp()
  const initial = nav.route.page === 'plan' && nav.route.view ? (nav.route.view as View) : 'month'
  const [view, setView] = useState<View>(initial)
  const [anchor, setAnchor] = useState<CalendarDate>(todayDate())
  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<'event' | 'task' | null>(null)

  const range = useMemo(() => {
    if (view === 'week') {
      const from = startOfWeek(anchor, format.weekStartsOn)
      return { from, to: addDays(from, 6) }
    }
    if (view === 'agenda') return { from: anchor, to: addDays(anchor, 60) }
    if (view === 'workload') return { from: startOfWeek(anchor, format.weekStartsOn), to: addDays(anchor, 42) }
    // Month view needs the leading and trailing days of the grid too.
    const first = startOfMonth(anchor)
    const gridStart = addDays(first, -((dayOfWeek(first) - format.weekStartsOn + 7) % 7))
    return { from: gridStart, to: addDays(gridStart, 41) }
  }, [view, anchor, format.weekStartsOn])

  const load = useCallback(async () => {
    if (view === 'tasks' || view === 'life-events') return
    setError('')
    const result = await call<CalendarData>('plan.calendar', range)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setData(result.data)
  }, [range, view])

  useEffect(() => {
    void load()
  }, [load, revision])

  const taskEntity = entities.find((e) => e.type === 'task')
  const eventEntity = entities.find((e) => e.type === 'event')

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <p className="kicker">Plan</p>
          <h1>{titleFor(view, anchor, format.locale)}</h1>
          <p className="sub">Appointments, tasks, deadlines and the bills that land in the same week.</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setAdding('task')}>
            <Icon name="plus" size={14} />
            Task
          </button>
          <button className="btn primary" onClick={() => setAdding('event')}>
            <Icon name="calendar" size={14} />
            Event
          </button>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 'var(--gap)' }}>
        {(
          [
            ['month', 'Month'],
            ['week', 'Week'],
            ['agenda', 'Agenda'],
            ['tasks', 'Tasks'],
            ['workload', 'Workload'],
            ['life-events', 'Life events']
          ] as [View, string][]
        ).map(([key, label]) => (
          <button key={key} className={`btn small${view === key ? ' primary' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}

        {view === 'month' || view === 'week' || view === 'agenda' ? (
          <div className="btn-row" style={{ marginLeft: 'auto' }}>
            <button
              className="btn icon small"
              aria-label="Previous"
              onClick={() => setAnchor(view === 'month' ? addMonthsClamped(anchor, -1, 1) : addDays(anchor, view === 'week' ? -7 : -14))}
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <button className="btn small" onClick={() => setAnchor(todayDate())}>
              Today
            </button>
            <button
              className="btn icon small"
              aria-label="Next"
              onClick={() => setAnchor(view === 'month' ? addMonthsClamped(anchor, 1, 1) : addDays(anchor, view === 'week' ? 7 : 14))}
            >
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
        ) : null}
      </div>

      {view === 'tasks' && taskEntity ? (
        <RecordList entity={taskEntity} onOpen={(id) => nav.openRecord('task', id)} />
      ) : view === 'life-events' ? (
        <LifeEvents nav={nav} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data ? (
        <Loading rows={8} label="Loading the calendar" />
      ) : view === 'month' ? (
        <MonthGrid anchor={anchor} range={range} data={data} nav={nav} />
      ) : view === 'week' ? (
        <WeekList range={range} data={data} nav={nav} />
      ) : view === 'workload' ? (
        <Workload range={range} />
      ) : (
        <AgendaList data={data} nav={nav} />
      )}

      {adding === 'task' && taskEntity ? (
        <RecordEditor entity={taskEntity} seed={{ due_date: anchor }} onClose={() => setAdding(null)} />
      ) : null}
      {adding === 'event' && eventEntity ? (
        <RecordEditor
          entity={eventEntity}
          seed={{ start_date: anchor, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------

function MonthGrid({
  anchor,
  range,
  data,
  nav
}: {
  anchor: CalendarDate
  range: { from: string; to: string }
  data: CalendarData
  nav: Navigator
}): ReactNode {
  const { format } = useApp()
  const today = todayDate()
  const month = anchor.slice(0, 7)

  const byDay = useMemo(() => {
    const map = new Map<string, { events: CalendarEvent[]; tasks: Record<string, unknown>[]; bills: CalendarData['bills'] }>()
    const ensure = (day: string) => {
      let bucket = map.get(day)
      if (!bucket) {
        bucket = { events: [], tasks: [], bills: [] }
        map.set(day, bucket)
      }
      return bucket
    }
    for (const event of data.events) ensure(event.date).events.push(event)
    for (const task of data.tasks) {
      const due = String(task.due_date ?? '')
      if (due) ensure(due).tasks.push(task)
    }
    for (const bill of data.bills) ensure(bill.dueDate).bills.push(bill)
    return map
  }, [data])

  const days: string[] = []
  for (let i = 0; i < 42; i++) days.push(addDays(range.from, i))

  const weekdayNames = useMemo(() => {
    const names: string[] = []
    for (let i = 0; i < 7; i++) {
      const day = addDays(range.from, i)
      const [y, m, d] = day.split('-').map(Number) as [number, number, number]
      names.push(
        new Intl.DateTimeFormat(format.locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
      )
    }
    return names
  }, [range.from, format.locale])

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--line)' }}>
        {weekdayNames.map((name) => (
          <div
            key={name}
            style={{
              padding: '9px 10px',
              color: 'var(--muted)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'var(--panel-2)'
            }}
          >
            {name}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {days.map((day, index) => {
          const bucket = byDay.get(day)
          const inMonth = day.slice(0, 7) === month
          const isToday = day === today
          const items = [
            ...(bucket?.events ?? []).map((e) => ({ kind: 'event' as const, item: e })),
            ...(bucket?.bills ?? []).map((b) => ({ kind: 'bill' as const, item: b })),
            ...(bucket?.tasks ?? []).map((t) => ({ kind: 'task' as const, item: t }))
          ]
          return (
            <div
              key={day}
              style={{
                minHeight: 108,
                padding: '7px 8px',
                borderRight: index % 7 === 6 ? 'none' : '1px solid var(--line)',
                borderBottom: index < 35 ? '1px solid var(--line)' : 'none',
                background: inMonth ? 'transparent' : 'var(--panel-2)',
                opacity: inMonth ? 1 : 0.55
              }}
            >
              <div
                className="num"
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  minWidth: 22,
                  height: 22,
                  marginBottom: 5,
                  borderRadius: 999,
                  background: isToday ? 'var(--accent)' : 'transparent',
                  color: isToday ? 'var(--accent-ink)' : 'var(--muted)',
                  fontSize: 11.5,
                  fontWeight: isToday ? 700 : 550
                }}
              >
                {Number(day.slice(8, 10))}
              </div>
              <div style={{ display: 'grid', gap: 3 }}>
                {items.slice(0, 4).map((entry, i) => (
                  <CalendarPill key={i} entry={entry} nav={nav} />
                ))}
                {items.length > 4 ? (
                  <span style={{ color: 'var(--muted)', fontSize: 10.5, paddingLeft: 2 }}>+{items.length - 4} more</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CalendarPill({
  entry,
  nav
}: {
  entry:
    | { kind: 'event'; item: CalendarEvent }
    | { kind: 'bill'; item: CalendarData['bills'][number] }
    | { kind: 'task'; item: Record<string, unknown> }
  nav: Navigator
}): ReactNode {
  const { format } = useApp()
  if (entry.kind === 'event') {
    return (
      <button
        onClick={() => nav.openRecord('event', entry.item.id)}
        style={{
          display: 'block',
          width: '100%',
          padding: '2px 5px',
          borderRadius: 5,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          fontSize: 10.5,
          fontWeight: 560,
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={entry.item.title}
      >
        {entry.item.allDay ? '' : `${fmtTime(entry.item.startTime)} `}
        {entry.item.title}
      </button>
    )
  }
  if (entry.kind === 'bill') {
    return (
      <button
        onClick={() => nav.openRecord('bill', entry.item.billId)}
        style={{
          display: 'block',
          width: '100%',
          padding: '2px 5px',
          borderRadius: 5,
          background: entry.item.paid ? 'var(--good-soft)' : 'var(--warn-soft)',
          color: entry.item.paid ? 'var(--good)' : 'var(--warn)',
          fontSize: 10.5,
          fontWeight: 560,
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={`${entry.item.name} — ${money(entry.item.amountMinor, format, entry.item.currency)}`}
      >
        {entry.item.name}
      </button>
    )
  }
  const done = String(entry.item.status) === 'done'
  return (
    <button
      onClick={() => nav.openRecord('task', String(entry.item.id))}
      style={{
        display: 'block',
        width: '100%',
        padding: '2px 5px',
        borderRadius: 5,
        background: 'var(--panel-2)',
        color: done ? 'var(--muted-2)' : 'var(--ink-2)',
        fontSize: 10.5,
        fontWeight: 520,
        textAlign: 'left',
        textDecoration: done ? 'line-through' : 'none',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
      title={String(entry.item.title)}
    >
      ✓ {String(entry.item.title)}
    </button>
  )
}

function WeekList({ range, data, nav }: { range: { from: string; to: string }; data: CalendarData; nav: Navigator }): ReactNode {
  const { format } = useApp()
  const days: string[] = []
  for (let i = 0; i < 7; i++) days.push(addDays(range.from, i))
  const today = todayDate()

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {days.map((day) => {
        const events = data.events.filter((e) => e.date === day)
        const tasks = data.tasks.filter((t) => String(t.due_date ?? '') === day)
        const bills = data.bills.filter((b) => b.dueDate === day)
        return (
          <div key={day} className="card" style={{ borderColor: day === today ? 'var(--accent)' : 'var(--line)' }}>
            <div className="card-head" style={{ padding: '10px 13px' }}>
              <div>
                <h3 style={{ fontSize: 12.5 }}>{fmtDate(day, format, 'short')}</h3>
                <p className="sub">
                  {new Intl.DateTimeFormat(format.locale, { weekday: 'long', timeZone: 'UTC' }).format(
                    new Date(`${day}T12:00:00Z`)
                  )}
                </p>
              </div>
            </div>
            <div className="card-body" style={{ padding: 11, display: 'grid', gap: 5 }}>
              {events.length + tasks.length + bills.length === 0 ? (
                <span style={{ color: 'var(--muted-2)', fontSize: 11.5 }}>Nothing</span>
              ) : null}
              {events.map((event) => (
                <CalendarPill key={event.id} entry={{ kind: 'event', item: event }} nav={nav} />
              ))}
              {bills.map((bill) => (
                <CalendarPill key={bill.billId + bill.dueDate} entry={{ kind: 'bill', item: bill }} nav={nav} />
              ))}
              {tasks.map((task) => (
                <CalendarPill key={String(task.id)} entry={{ kind: 'task', item: task }} nav={nav} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AgendaList({ data, nav }: { data: CalendarData; nav: Navigator }): ReactNode {
  const { format } = useApp()
  const entries = useMemo(() => {
    const all: { date: string; sort: string; node: ReactNode; key: string }[] = []
    for (const event of data.events) {
      all.push({
        date: event.date,
        sort: event.startTime || '00:00',
        key: `e${event.id}${event.date}`,
        node: (
          <button
            style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'center' }}
            onClick={() => nav.openRecord('event', event.id)}
          >
            <span className="num" style={{ width: 52, color: 'var(--muted)', fontSize: 12 }}>
              {event.allDay ? 'All day' : fmtTime(event.startTime)}
            </span>
            <span style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: 13, fontWeight: 560 }}>{event.title}</b>
              {event.location ? <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>{event.location}</small> : null}
            </span>
            {event.recurring ? <Chip tone="accent">Repeats</Chip> : null}
          </button>
        )
      })
    }
    for (const bill of data.bills) {
      all.push({
        date: bill.dueDate,
        sort: '23:58',
        key: `b${bill.billId}${bill.dueDate}`,
        node: (
          <button
            style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'center' }}
            onClick={() => nav.openRecord('bill', bill.billId)}
          >
            <span style={{ width: 52, color: 'var(--muted)' }}>
              <Icon name="bill" size={15} />
            </span>
            <span style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: 13, fontWeight: 560 }}>{bill.name}</b>
              <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>{bill.paid ? 'Paid' : 'Due'}</small>
            </span>
            <span className="money">{money(bill.amountMinor, format, bill.currency)}</span>
          </button>
        )
      })
    }
    for (const task of data.tasks) {
      const due = String(task.due_date ?? '')
      if (!due) continue
      all.push({
        date: due,
        sort: '23:59',
        key: `t${String(task.id)}`,
        node: (
          <button
            style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'center' }}
            onClick={() => nav.openRecord('task', String(task.id))}
          >
            <span style={{ width: 52, color: 'var(--muted)' }}>
              <Icon name="task" size={15} />
            </span>
            <span style={{ flex: 1 }}>
              <b
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 560,
                  textDecoration: String(task.status) === 'done' ? 'line-through' : 'none'
                }}
              >
                {String(task.title)}
              </b>
            </span>
          </button>
        )
      })
    }
    return all.sort((a, b) => a.date.localeCompare(b.date) || a.sort.localeCompare(b.sort))
  }, [data, nav, format])

  if (entries.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="calendar" title="Nothing in the next two months" message="Add an event, a task or a bill and it will appear here." />
      </div>
    )
  }

  const grouped = new Map<string, typeof entries>()
  for (const entry of entries) {
    const list = grouped.get(entry.date) ?? []
    list.push(entry)
    grouped.set(entry.date, list)
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      {[...grouped.entries()].map(([day, items]) => (
        <div className="card" key={day}>
          <div className="card-head" style={{ padding: '10px 16px' }}>
            <div>
              <h3 style={{ fontSize: 13 }}>{fmtDate(day, format, 'long')}</h3>
            </div>
            <Chip>{relative(Math.round((Date.parse(day) - Date.parse(todayDate())) / 86400000), format)}</Chip>
          </div>
          <div className="card-body flush">
            <ul>
              {items.map((entry) => (
                <li key={entry.key} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                  {entry.node}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}

function Workload({ range }: { range: { from: string; to: string } }): ReactNode {
  const { format, revision } = useApp()
  const [days, setDays] = useState<{ date: string; committedMinutes: number; taskMinutes: number; tasks: number; events: number; totalMinutes: number; overcommitted: boolean }[] | null>(null)
  const [overcommitted, setOvercommitted] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await call<{ days: NonNullable<typeof days>; overcommittedDays: number }>('plan.workload', range)
      if (cancelled) return
      if (result.ok) {
        setDays(result.data.days)
        setOvercommitted(result.data.overcommittedDays)
      } else setDays([])
    })()
    return () => {
      cancelled = true
    }
  }, [range, revision])

  if (!days) return <Loading rows={6} label="Working out your workload" />
  if (days.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="chart" title="Nothing committed in this period" message="Add events with times or tasks with estimates and the load shows up here." />
      </div>
    )
  }
  const max = Math.max(...days.map((d) => d.totalMinutes), 60)

  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      {overcommitted > 0 ? (
        <Notice tone="warn" title={`${overcommitted} day${overcommitted === 1 ? '' : 's'} look overcommitted`}>
          More than six hours of appointments and estimated work in one day. Something will have to give, and it is
          better to decide which now than at half past four on the day.
        </Notice>
      ) : null}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Committed time</h2>
            <p className="sub">Appointments plus your own estimates, including travel and preparation</p>
          </div>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 8 }}>
          {days.map((day) => (
            <div key={day.date} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 96px', gap: 12, alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(day.date, format)}</span>
              <div style={{ height: 9, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', display: 'flex' }}>
                <div
                  style={{
                    width: `${Math.min(100, (day.committedMinutes / max) * 100)}%`,
                    background: day.overcommitted ? 'var(--bad)' : 'var(--accent)'
                  }}
                />
                <div
                  style={{
                    width: `${Math.min(100, (day.taskMinutes / max) * 100)}%`,
                    background: day.overcommitted ? 'color-mix(in srgb, var(--bad) 45%, transparent)' : 'var(--accent-soft)'
                  }}
                />
              </div>
              <span className="num" style={{ fontSize: 12, textAlign: 'right', color: day.overcommitted ? 'var(--bad)' : 'var(--muted)' }}>
                {formatHours(day.totalMinutes)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LifeEvents({ nav }: { nav: Navigator }): ReactNode {
  const { format, toast, bumpRevision } = useApp()
  const [templates, setTemplates] = useState<{ key: string; title: string; blurb: string; anchorLabel: string }[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await call<{ templates: NonNullable<typeof templates> }>('lifeEvents.templates', {})
      setTemplates(result.ok ? result.data.templates : [])
    })()
  }, [])

  if (!templates) return <Loading rows={5} label="Loading templates" />

  return (
    <>
      <Notice tone="info" title="Nothing is created until you say so">
        Pick a template, set the date it revolves around, and Orbit shows you exactly what it would create. Untick
        anything that does not apply to you before it writes a single record.
      </Notice>
      <div className="grid two" style={{ marginTop: 'var(--gap)' }}>
        {templates.map((template) => (
          <button
            key={template.key}
            className="card"
            style={{ display: 'grid', gap: 8, padding: 18, textAlign: 'left' }}
            onClick={() => setChosen(template.key)}
          >
            <h3 style={{ fontSize: 14.5 }}>{template.title}</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>{template.blurb}</p>
            <span className="chip accent" style={{ justifySelf: 'start' }}>
              Anchored to: {template.anchorLabel}
            </span>
          </button>
        ))}
      </div>
      {chosen ? (
        <LifeEventPreview
          templateKey={chosen}
          onClose={() => setChosen(null)}
          onApplied={(projectId) => {
            bumpRevision()
            toast({ tone: 'good', title: 'Created', detail: 'Everything is linked to one project so you can see it all together.' })
            setChosen(null)
            nav.openRecord('project', projectId)
          }}
          locale={format.locale}
        />
      ) : null}
    </>
  )
}

function LifeEventPreview({
  templateKey,
  onClose,
  onApplied,
  locale
}: {
  templateKey: string
  onClose: () => void
  onApplied: (projectId: string) => void
  locale: string
}): ReactNode {
  const { format, toast } = useApp()
  const [startDate, setStartDate] = useState(addDays(todayDate(), 60))
  const [title, setTitle] = useState('')
  const [preview, setPreview] = useState<{
    title: string
    anchorLabel: string
    summary: string
    tasks: { key: string; title: string; date: string; group: string; notes: string }[]
    documents: { key: string; title: string; group: string }[]
    budgetLines: { key: string; label: string; note: string }[]
  } | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const result = await call<NonNullable<typeof preview>>('lifeEvents.preview', {
        key: templateKey,
        startDate,
        ...(title ? { title } : {})
      })
      if (result.ok) {
        setPreview(result.data)
        if (!title) setTitle(result.data.title)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, startDate])

  const toggle = (key: string): void => {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    const include = [
      ...preview.tasks.map((t) => t.key),
      ...preview.documents.map((d) => d.key)
    ].filter((key) => !excluded.has(key))
    const result = await call<{ projectId: string; tasksCreated: number; documentsCreated: number }>('lifeEvents.apply', {
      key: templateKey,
      startDate,
      title,
      include
    })
    setBusy(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'That could not be created', detail: result.error })
      return
    }
    onApplied(result.data.projectId)
  }

  const grouped = useMemo(() => {
    if (!preview) return []
    const map = new Map<string, typeof preview.tasks>()
    for (const task of preview.tasks) {
      const list = map.get(task.group) ?? []
      list.push(task)
      map.set(task.group, list)
    }
    return [...map.entries()]
  }, [preview])

  const includedCount = preview
    ? preview.tasks.length + preview.documents.length - excluded.size
    : 0

  return (
    <Modal
      title={preview?.title ?? 'Life event'}
      subtitle={preview?.summary}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <span className="left" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {includedCount} item{includedCount === 1 ? '' : 's'} will be created
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void apply()} disabled={busy || includedCount === 0}>
            {busy ? 'Creating…' : 'Create these'}
          </button>
        </>
      }
    >
      {!preview ? (
        <Loading rows={6} label="Building the preview" />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="le-title">Call it</label>
              <input id="le-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="le-date">{preview.anchorLabel}</label>
              <input id="le-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <span className="help">Every date below moves with this one.</span>
            </div>
          </div>

          {grouped.map(([group, tasks]) => (
            <div key={group}>
              <h4 style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {group}
              </h4>
              <ul style={{ display: 'grid', gap: 4 }}>
                {tasks.map((task) => (
                  <li key={task.key}>
                    <label className="check" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={!excluded.has(task.key)}
                        onChange={() => toggle(task.key)}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ flex: 1 }}>
                        <b style={{ display: 'block', fontSize: 13, fontWeight: 550 }}>{task.title}</b>
                        <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                          {fmtDate(task.date, format)}
                          {task.notes ? ` · ${task.notes}` : ''}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {preview.documents.length > 0 ? (
            <div>
              <h4 style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Document slots
              </h4>
              <ul style={{ display: 'grid', gap: 4 }}>
                {preview.documents.map((document) => (
                  <li key={document.key}>
                    <label className="check">
                      <input type="checkbox" checked={!excluded.has(document.key)} onChange={() => toggle(document.key)} />
                      <span style={{ fontSize: 13 }}>{document.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.budgetLines.length > 0 ? (
            <Notice tone="info" title="Costs worth planning for">
              <ul style={{ marginTop: 5 }}>
                {preview.budgetLines.map((line) => (
                  <li key={line.key} style={{ fontSize: 12.5 }}>
                    • {line.label}
                    {line.note ? ` — ${line.note}` : ''}
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 7, fontSize: 12 }}>
                These are noted on the project rather than created as budgets, because only you know the numbers.
              </p>
            </Notice>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function titleFor(view: View, anchor: string, locale: string): string {
  if (view === 'tasks') return 'Tasks'
  if (view === 'life-events') return 'Life events'
  if (view === 'workload') return 'Workload'
  if (view === 'agenda') return 'What is coming'
  const [year, month] = anchor.split('-').map(Number) as [number, number]
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - 1, 1))
    )
  } catch {
    return anchor
  }
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export { daysInMonth, endOfMonth }
