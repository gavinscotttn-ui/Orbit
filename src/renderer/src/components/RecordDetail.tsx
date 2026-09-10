import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EntityDescriptor, FieldSpec } from '@shared/contracts/fields.js'
import type { AttentionItem } from '@shared/contracts/ipc.js'
import { call, pathForDroppedFile } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { bytes as fmtBytes, date as fmtDate, dayAndRelative, money, humanise, relative, time as fmtTime } from '../lib/format.js'
import { describeRule, normaliseRule } from '@shared/domain/recurrence.js'
import { Icon, iconForEntity, type IconName } from './Icon.js'
import { Chip, EmptyState, ErrorState, Loading, Modal, Notice, useConfirm } from './ui.js'
import { RecordEditor } from './RecordEditor.js'

/**
 * One record, and everything connected to it.
 *
 * This is what Orbit is for. A car is not a row in a table: it is a policy, an
 * MOT, a service history, a fuel bill and a finance agreement that happen to
 * share a registration number. This view puts all of that on one screen, with
 * the same tabs for every record type — overview, related, files, costs,
 * history — so learning it once is learning it everywhere.
 *
 * Files can be dragged straight onto it. The renderer never opens them; it
 * hands the paths to the main process, which reads and stores them.
 */

export interface DetailPayload {
  entity: EntityDescriptor
  record: Record<string, unknown>
  attachments: {
    id: string
    originalFilename: string
    mimeType: string
    bytes: number
    extension: string
    createdAt: string
  }[]
  costs: { label: string; amountMinor: number; currency: string; date: string; source: string }[]
  totalCostMinor: number
  related: { type: string; id: string; label: string; title: string; date: string; relation: string }[]
  tags: { id: string; name: string; colour: string }[]
  notes: Record<string, unknown>[]
  reminders: Record<string, unknown>[]
  history: Record<string, unknown>[]
}

type Tab = 'overview' | 'related' | 'files' | 'costs' | 'history'

export function RecordDetail({
  type,
  id,
  onClose,
  onNavigate
}: {
  type: string
  id: string
  onClose: () => void
  onNavigate?: (type: string, id: string) => void
}): ReactNode {
  const { format, revision, bumpRevision, toast } = useApp()
  const { confirm, dialog } = useConfirm()
  const [data, setData] = useState<DetailPayload | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const dragDepth = useRef(0)

  const load = useCallback(async () => {
    setError('')
    const result = await call<DetailPayload>('record.detail', { type, id })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setData(result.data)
  }, [type, id])

  useEffect(() => {
    void load()
  }, [load, revision])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const attachPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    setAttaching(true)
    const result = await call<{ added: unknown[]; duplicates: number; failed: { name: string; reason: string }[] }>(
      'attachments.addFromPaths',
      { type, id, paths }
    )
    setAttaching(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'Those files could not be attached', detail: result.error })
      return
    }
    const { added, duplicates, failed } = result.data
    if (failed.length > 0) {
      toast({
        tone: 'bad',
        title: `${failed.length} file${failed.length === 1 ? '' : 's'} could not be attached`,
        detail: failed[0]?.reason
      })
    }
    if (added.length > 0) {
      toast({
        tone: 'good',
        title: `Attached ${added.length} file${added.length === 1 ? '' : 's'}`,
        ...(duplicates > 0
          ? { detail: `${duplicates} of them were already in this vault, so they were linked rather than stored twice.` }
          : {})
      })
    }
    bumpRevision()
    setTab('files')
  }

  const chooseFiles = async (): Promise<void> => {
    setAttaching(true)
    const result = await call<{ cancelled?: boolean; added?: unknown[]; duplicates?: number }>('attachments.addFiles', {
      type,
      id
    })
    setAttaching(false)
    if (result.ok && !result.data.cancelled) {
      bumpRevision()
      setTab('files')
    }
  }

  if (error) {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Record">
          <div className="modal-body">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        </div>
      </div>
    )
  }

  const title = data ? String(data.record[data.entity.titleField] ?? '(untitled)') : 'Loading…'

  return (
    <>
      <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div
          className={`drawer drop-target${dragging ? ' dragging' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            dragDepth.current += 1
            setDragging(true)
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDragLeave={() => {
            dragDepth.current -= 1
            if (dragDepth.current <= 0) {
              dragDepth.current = 0
              setDragging(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => pathForDroppedFile(file))
              .filter(Boolean)
            if (paths.length === 0) {
              toast({ tone: 'bad', title: 'Orbit could not read those files', detail: 'Try the Attach button instead.' })
              return
            }
            void attachPaths(paths)
          }}
        >
          <div className="modal-head">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: 'var(--accent)' }}>
                  <Icon name={data ? iconForEntity(data.entity.icon) : 'grid'} size={15} />
                </span>
                <span
                  style={{
                    color: 'var(--muted)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase'
                  }}
                >
                  {data?.entity.label ?? ''}
                </span>
              </div>
              <h2 style={{ overflowWrap: 'anywhere' }}>{title}</h2>
              {data ? <SubtitleLine data={data} /> : null}
            </div>
            <div className="btn-row">
              <button className="btn small" onClick={() => setEditing(true)} disabled={!data}>
                <Icon name="edit" size={14} />
                Edit
              </button>
              <button className="btn icon ghost" onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 2, padding: '0 20px', borderBottom: '1px solid var(--line)' }} role="tablist">
            {(
              [
                ['overview', 'Overview', 'info'],
                ['related', `Related${data?.related.length ? ` (${data.related.length})` : ''}`, 'link'],
                ['files', `Files${data?.attachments.length ? ` (${data.attachments.length})` : ''}`, 'paperclip'],
                ['costs', `Costs${data?.costs.length ? ` (${data.costs.length})` : ''}`, 'money'],
                ['history', 'History', 'history']
              ] as [Tab, string, IconName][]
            ).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className="btn ghost small"
                style={{
                  borderRadius: 0,
                  borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
                  color: tab === key ? 'var(--accent)' : 'var(--muted)',
                  fontWeight: tab === key ? 650 : 550,
                  padding: '10px 12px'
                }}
                onClick={() => setTab(key)}
              >
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px 28px' }}>
            {!data ? (
              <Loading rows={6} label="Loading the record" />
            ) : tab === 'overview' ? (
              <Overview data={data} formatCtx={format} onNavigate={onNavigate} onSeeAll={() => setTab('related')} />
            ) : tab === 'related' ? (
              <Related data={data} onNavigate={onNavigate} />
            ) : tab === 'files' ? (
              <Files
                data={data}
                busy={attaching}
                onChoose={() => void chooseFiles()}
                onRemoved={() => bumpRevision()}
                confirm={confirm}
              />
            ) : tab === 'costs' ? (
              <Costs data={data} formatCtx={format} />
            ) : (
              <History data={data} formatCtx={format} onRestored={() => bumpRevision()} />
            )}
          </div>
        </div>
      </div>

      {editing && data ? (
        <RecordEditor
          entity={data.entity}
          id={id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            bumpRevision()
            void load()
          }}
          onDeleted={() => {
            bumpRevision()
            onClose()
          }}
        />
      ) : null}
      {dialog}
    </>
  )
}

// ---------------------------------------------------------------------------

function SubtitleLine({ data }: { data: DetailPayload }): ReactNode {
  const { format } = useApp()
  const bits: string[] = []
  if (data.entity.dateField) {
    const value = data.record[data.entity.dateField]
    if (value) bits.push(dayAndRelative(String(value), format))
  }
  if (data.totalCostMinor > 0) bits.push(`${money(data.totalCostMinor, format)} recorded`)
  if (data.attachments.length > 0) bits.push(`${data.attachments.length} file${data.attachments.length === 1 ? '' : 's'}`)
  if (bits.length === 0) return null
  return <p className="sub">{bits.join(' · ')}</p>
}

function Overview({
  data,
  formatCtx,
  onNavigate,
  onSeeAll
}: {
  data: DetailPayload
  formatCtx: Parameters<typeof money>[1]
  onNavigate?: (type: string, id: string) => void
  onSeeAll: () => void
}): ReactNode {
  const { entities } = useApp()
  const [refLabels, setRefLabels] = useState<Record<string, string>>({})

  // Resolve any reference fields so the overview shows names, not ids.
  useEffect(() => {
    const refFields = data.entity.fields.filter((f) => f.type === 'ref' && data.record[f.name])
    if (refFields.length === 0) return
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const field of refFields) {
        const target = entities.find((e) => e.type === field.refType)
        if (!target) continue
        const result = await call<Record<string, unknown>>('records.get', {
          type: field.refType,
          id: String(data.record[field.name])
        })
        if (result.ok) next[field.name] = String(result.data[target.titleField] ?? '')
      }
      if (!cancelled) setRefLabels(next)
    })()
    return () => {
      cancelled = true
    }
  }, [data, entities])

  /**
   * A record's connections are the point of the thing, so a few of them belong
   * on the overview rather than entirely behind a tab. One per kind, so a car
   * with nine fuel logs does not bury its insurance policy — the tab has the
   * full list.
   */
  // Every call site of iconForEntity passes a descriptor's declared icon, not
  // an entity type; passing the type silently lands on the generic fallback.
  const iconFor = useCallback(
    (type: string): IconName => {
      const descriptor = entities.find((e) => e.type === type)
      return descriptor ? iconForEntity(descriptor.icon) : 'grid'
    },
    [entities]
  )

  const relatedPreview = useMemo(() => {
    const perKind = new Map<string, DetailPayload['related'][number]>()
    for (const link of data.related) if (!perKind.has(link.type)) perKind.set(link.type, link)
    return [...perKind.values()].slice(0, 6)
  }, [data.related])

  const groups = useMemo(() => {
    const shown = data.entity.fields.filter((field) => {
      const value = data.record[field.name]
      return value !== null && value !== undefined && value !== '' && !(field.type === 'boolean' && value === 0)
    })
    const map = new Map<string, FieldSpec[]>()
    for (const field of shown) {
      const key = field.group ?? ''
      const list = map.get(key) ?? []
      list.push(field)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [data])

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Deadlines type={data.entity.type} id={String(data.record.id)} />

      {data.tags.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.tags.map((tag) => (
            <Chip key={tag.id}>{tag.name}</Chip>
          ))}
        </div>
      ) : null}

      {relatedPreview.length > 0 ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
            <h4
              style={{
                color: 'var(--muted)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }}
            >
              What this connects to
            </h4>
            {data.related.length > relatedPreview.length ? (
              <button className="btn small ghost" onClick={onSeeAll}>
                All {data.related.length}
              </button>
            ) : null}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {relatedPreview.map((link) => (
              <button
                key={`${link.type}:${link.id}`}
                className="related-row"
                onClick={() => onNavigate?.(link.type, link.id)}
                disabled={!onNavigate}
              >
                <Icon name={iconFor(link.type)} size={14} />
                <span className="related-title">{link.title}</span>
                <span className="related-kind">{link.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {groups.map(([group, fields]) => (
        <div key={group || 'main'}>
          {group ? (
            <h4
              style={{
                marginBottom: 9,
                color: 'var(--muted)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }}
            >
              {group}
            </h4>
          ) : null}
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) 1fr', gap: '9px 16px', margin: 0 }}>
            {fields.map((field) => (
              <FieldRow key={field.name} field={field} data={data} formatCtx={formatCtx} refLabel={refLabels[field.name]} />
            ))}
          </dl>
        </div>
      ))}

      {data.reminders.length > 0 ? (
        <div>
          <h4 style={{ marginBottom: 9, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Reminders
          </h4>
          <ul style={{ display: 'grid', gap: 7 }}>
            {data.reminders.map((reminder) => (
              <li key={String(reminder.id)} className="notice">
                <Icon name="clock" size={15} />
                <div className="body">
                  <strong>{String(reminder.label)}</strong>
                  {dayAndRelative(String(reminder.remind_on), formatCtx)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.notes.length > 0 ? (
        <div>
          <h4 style={{ marginBottom: 9, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Notes
          </h4>
          <ul style={{ display: 'grid', gap: 8 }}>
            {data.notes.map((note) => (
              <li key={String(note.id)} className="card" style={{ padding: '11px 13px' }}>
                {note.title ? <b style={{ display: 'block', marginBottom: 3 }}>{String(note.title)}</b> : null}
                <span style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.55 }}>{String(note.body ?? '')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function FieldRow({
  field,
  data,
  formatCtx,
  refLabel
}: {
  field: FieldSpec
  data: DetailPayload
  formatCtx: Parameters<typeof money>[1]
  refLabel?: string
}): ReactNode {
  const value = data.record[field.name]
  let rendered: ReactNode

  switch (field.type) {
    case 'money': {
      const currency = String(data.record[field.currencyField ?? 'currency'] ?? '')
      rendered = <span className="money">{money(Number(value), formatCtx, currency || undefined)}</span>
      break
    }
    case 'date':
      rendered = <span>{dayAndRelative(String(value), formatCtx)}</span>
      break
    case 'time':
      rendered = <span>{fmtTime(String(value))}</span>
      break
    case 'boolean':
      rendered = <Chip tone="good">Yes</Chip>
      break
    case 'select': {
      const option = field.options?.find((o) => o.value === String(value))
      rendered = option ? <Chip tone={option.tone ?? 'neutral'}>{option.label}</Chip> : <span>{humanise(String(value))}</span>
      break
    }
    case 'ref':
      rendered = refLabel ? <span>{refLabel}</span> : <span style={{ color: 'var(--muted-2)' }}>—</span>
      break
    case 'recurrence': {
      const rule = normaliseRule(safeJson(String(value)))
      rendered = (
        <Chip tone="accent">
          <Icon name="repeat" size={12} />
          {describeRule(rule)}
        </Chip>
      )
      break
    }
    case 'url':
      rendered = <ExternalLink url={String(value)} />
      break
    case 'longtext':
      rendered = <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>
      break
    default:
      rendered = <span style={{ overflowWrap: 'anywhere' }}>{String(value)}</span>
  }

  return (
    <>
      <dt style={{ color: 'var(--muted)', fontSize: 12.5 }}>{field.label}</dt>
      <dd style={{ margin: 0, fontSize: 13 }}>{rendered}</dd>
    </>
  )
}

/**
 * A link out of Orbit.
 *
 * Never a real anchor: the main process opens it in the user's own browser
 * after checking the scheme, and the click is a deliberate act rather than
 * something a stray href could do on its own.
 */
function ExternalLink({ url }: { url: string }): ReactNode {
  const { toast } = useApp()
  return (
    <button
      className="btn small ghost"
      style={{ padding: '2px 6px', color: 'var(--accent)' }}
      onClick={() => {
        void (async () => {
          const result = await call<{ opened: boolean; reason: string }>('app.openExternal', { url })
          if (result.ok && !result.data.opened) {
            toast({ tone: 'bad', title: 'That link was not opened', detail: result.data.reason })
          }
        })()
      }}
    >
      {url.length > 44 ? url.slice(0, 43) + '…' : url}
      <Icon name="external" size={12} />
    </button>
  )
}

function Related({
  data,
  onNavigate
}: {
  data: DetailPayload
  onNavigate?: (type: string, id: string) => void
}): ReactNode {
  const { format } = useApp()
  if (data.related.length === 0) {
    return (
      <EmptyState
        icon="link"
        title="Nothing linked yet"
        message="Link this to a person, a document, a bill or anything else, and it will appear here and on the other record too."
      />
    )
  }
  const grouped = new Map<string, typeof data.related>()
  for (const item of data.related) {
    const list = grouped.get(item.label) ?? []
    list.push(item)
    grouped.set(item.label, list)
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {[...grouped.entries()].map(([label, items]) => (
        <div key={label}>
          <h4 style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {label}
          </h4>
          <ul style={{ display: 'grid', gap: 6 }}>
            {items.map((item) => (
              <li key={`${item.type}:${item.id}`}>
                <button
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', textAlign: 'left' }}
                  onClick={() => onNavigate?.(item.type, item.id)}
                  disabled={!onNavigate}
                >
                  <span style={{ color: 'var(--muted)' }}>
                    <Icon name="link" size={14} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 13, fontWeight: 560 }}>{item.title}</b>
                    <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                      {humanise(item.relation)}
                      {item.date ? ` · ${fmtDate(item.date, format)}` : ''}
                    </small>
                  </span>
                  {onNavigate ? (
                    <span style={{ color: 'var(--muted-2)' }}>
                      <Icon name="chevron-right" size={14} />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Files({
  data,
  busy,
  onChoose,
  onRemoved,
  confirm
}: {
  data: DetailPayload
  busy: boolean
  onChoose: () => void
  onRemoved: () => void
  confirm: (options: Parameters<ReturnType<typeof useConfirm>['confirm']>[0]) => Promise<boolean>
}): ReactNode {
  const { format, toast } = useApp()
  const [preview, setPreview] = useState<{ id: string; name: string; url: string; mime: string } | null>(null)

  const openPreview = async (attachment: DetailPayload['attachments'][number]): Promise<void> => {
    const result = await call<{ bytes: ArrayBuffer; mimeType: string }>('attachments.read', { id: attachment.id })
    if (!result.ok) {
      toast({ tone: 'bad', title: 'That file could not be opened', detail: result.error })
      return
    }
    // The bytes came from the vault via the main process. A blob URL keeps the
    // preview inside the app rather than handing the file to another program.
    const blob = new Blob([result.data.bytes], { type: result.data.mimeType })
    setPreview({ id: attachment.id, name: attachment.originalFilename, url: URL.createObjectURL(blob), mime: result.data.mimeType })
  }

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url)
  }, [preview])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="btn-row">
        <button className="btn primary" onClick={onChoose} disabled={busy}>
          <Icon name="paperclip" size={14} />
          {busy ? 'Attaching…' : 'Attach files'}
        </button>
        <span className="help">Or drag them straight onto this panel.</span>
      </div>

      {data.attachments.length === 0 ? (
        <EmptyState
          icon="paperclip"
          title="No files yet"
          message="Receipts, photographs, manuals, policy documents — anything worth keeping with this record."
        />
      ) : (
        <ul style={{ display: 'grid', gap: 7 }}>
          {data.attachments.map((attachment) => (
            <li key={attachment.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px' }}>
              <span style={{ color: 'var(--muted)' }}>
                <Icon name="document" size={16} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 13, fontWeight: 560, overflowWrap: 'anywhere' }}>
                  {attachment.originalFilename}
                </b>
                <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {fmtBytes(attachment.bytes)} · added {fmtDate(attachment.createdAt.slice(0, 10), format)}
                </small>
              </span>
              <button className="btn small" onClick={() => void openPreview(attachment)}>
                View
              </button>
              <button
                className="btn small"
                onClick={() => {
                  void (async () => {
                    const result = await call<{ cancelled?: boolean; name?: string }>('attachments.export', {
                      id: attachment.id
                    })
                    if (result.ok && !result.data.cancelled) {
                      toast({ tone: 'good', title: 'Saved a copy', detail: result.data.name })
                    }
                  })()
                }}
              >
                <Icon name="download" size={13} />
              </button>
              <button
                className="btn small danger"
                aria-label={`Remove ${attachment.originalFilename}`}
                onClick={() => {
                  void (async () => {
                    const ok = await confirm({
                      title: 'Remove this file?',
                      message: `"${attachment.originalFilename}" will be detached from this record. If nothing else uses it, the file itself is deleted from the vault.`,
                      confirmLabel: 'Remove',
                      tone: 'danger'
                    })
                    if (!ok) return
                    const result = await call<{ removed: boolean; reason: string }>('attachments.remove', {
                      id: attachment.id,
                      force: true
                    })
                    if (result.ok && result.data.removed) {
                      toast({ tone: 'good', title: 'File removed' })
                      onRemoved()
                    } else {
                      toast({ tone: 'bad', title: 'It could not be removed', detail: result.ok ? result.data.reason : result.error })
                    }
                  })()
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview ? (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          {preview.mime.startsWith('image/') ? (
            <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }} />
          ) : preview.mime === 'application/pdf' ? (
            <iframe src={preview.url} title={preview.name} style={{ width: '100%', height: '65vh', border: 0 }} />
          ) : preview.mime.startsWith('text/') || preview.mime === 'application/json' ? (
            <TextPreview url={preview.url} />
          ) : (
            <Notice tone="info" title="No preview for this kind of file">
              Orbit can show images, PDFs and text. Use the download button to open it in whatever program handles it.
            </Notice>
          )}
        </Modal>
      ) : null}
    </div>
  )
}

function TextPreview({ url }: { url: string }): ReactNode {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    // A blob: URL created from bytes we already hold. Nothing leaves the machine.
    void fetch(url)
      .then((response) => response.text())
      .then((body) => {
        if (!cancelled) setText(body.slice(0, 200_000))
      })
      .catch(() => {
        if (!cancelled) setText('This file could not be shown as text.')
      })
    return () => {
      cancelled = true
    }
  }, [url])
  if (text === null) return <Loading rows={4} label="Loading the file" />
  return (
    <pre
      style={{
        margin: 0,
        padding: 14,
        borderRadius: 'var(--radius)',
        background: 'var(--panel-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        maxHeight: '62vh',
        overflow: 'auto'
      }}
    >
      {text}
    </pre>
  )
}

function Costs({ data, formatCtx }: { data: DetailPayload; formatCtx: Parameters<typeof money>[1] }): ReactNode {
  if (data.costs.length === 0) {
    return (
      <EmptyState
        icon="money"
        title="Nothing has been spent on this yet"
        message="Costs recorded against this record — services, fuel, transactions — are totted up here."
      />
    )
  }
  const byYear = new Map<string, number>()
  for (const cost of data.costs) {
    const year = cost.date.slice(0, 4) || 'Undated'
    byYear.set(year, (byYear.get(year) ?? 0) + cost.amountMinor)
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Total recorded
        </div>
        <div className="num" style={{ marginTop: 5, fontSize: 25, fontWeight: 660 }}>
          {money(data.totalCostMinor, formatCtx)}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[...byYear.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([year, total]) => (
              <Chip key={year}>
                {year}: {money(total, formatCtx)}
              </Chip>
            ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.costs.map((cost, index) => (
              <tr key={index} style={{ cursor: 'default' }}>
                <td className="num">{fmtDate(cost.date, formatCtx)}</td>
                <td>{humanise(cost.source)}</td>
                <td className="right money">{money(cost.amountMinor, formatCtx, cost.currency || undefined)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function History({
  data,
  formatCtx,
  onRestored
}: {
  data: DetailPayload
  formatCtx: Parameters<typeof money>[1]
  onRestored: () => void
}): ReactNode {
  const { toast } = useApp()
  if (data.history.length === 0) {
    return <EmptyState icon="history" title="No changes recorded yet" />
  }
  return (
    <ul style={{ display: 'grid', gap: 8 }}>
      {data.history.map((entry) => {
        const at = String(entry.at ?? '')
        const undoable = Number(entry.undoable) === 1
        return (
          <li key={String(entry.id)} className="card" style={{ display: 'flex', gap: 11, padding: '10px 12px' }}>
            <span style={{ color: 'var(--muted)' }}>
              <Icon name="history" size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 12.5, fontWeight: 560 }}>
                {humanise(String(entry.action))}
                {entry.summary ? ` — ${String(entry.summary)}` : ''}
              </b>
              <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                {fmtDate(at.slice(0, 10), formatCtx)} at {at.slice(11, 16)}
                {entry.source && entry.source !== 'ui' ? ` · ${humanise(String(entry.source))}` : ''}
              </small>
            </div>
            {undoable ? (
              <button
                className="btn small"
                onClick={() => {
                  void (async () => {
                    const result = await call<{ ok: boolean; message: string }>('records.restore', {
                      activityId: String(entry.id)
                    })
                    if (result.ok && result.data.ok) {
                      toast({ tone: 'good', title: 'Restored' })
                      onRestored()
                    } else {
                      toast({ tone: 'bad', title: 'It could not be restored' })
                    }
                  })()
                }}
              >
                <Icon name="undo" size={13} />
                Restore
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}


/**
 * What this record wants doing about it.
 *
 * Everything Orbit knows about a record's dates, in one strip at the top of the
 * overview: its MOT, its renewal, the warranty running out, the service due.
 * These come from the same engine that fills Today, narrowed to this record and
 * the records linked to it — so a car shows the MOT that is stored on its
 * maintenance schedule rather than only the fields typed onto the car.
 *
 * It renders nothing at all when there is nothing to say, which is the point:
 * a heading over an empty box is worse than no heading.
 */
function Deadlines({ type, id }: { type: string; id: string }): ReactNode {
  const { format } = useApp()
  const [items, setItems] = useState<AttentionItem[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await call<{ items: AttentionItem[] }>('records.attention', { type, id })
      if (!cancelled) setItems(result.ok ? result.data.items : [])
    })()
    return () => {
      cancelled = true
    }
  }, [type, id])

  if (items.length === 0) return null

  const tone = (severity: string): 'bad' | 'warn' | 'info' =>
    severity === 'overdue' ? 'bad' : severity === 'today' || severity === 'soon' ? 'warn' : 'info'

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        paddingBottom: 4
      }}
    >
      {items.slice(0, 6).map((item) => (
        <span key={item.id} className={`deadline-chip ${tone(item.severity)}`}>
          <b>{item.title}</b>
          <span>
            {relative(item.daysAway, format)}
            {item.laterOccurrences ? ` · ${item.laterOccurrences} more after that` : ''}
          </span>
        </span>
      ))}
    </div>
  )
}
