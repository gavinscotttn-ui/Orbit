import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { EntityDescriptor } from '@shared/contracts/fields.js'
import { call, pathForDroppedFile } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money } from '../lib/format.js'
import { Icon } from '../components/Icon.js'
import { Chip, EmptyState, ErrorState, Loading, Modal, Notice } from '../components/ui.js'
import { EntityForm, initialValues, type FieldErrors, type FormValues } from '../components/Form.js'
import type { Navigator } from '../app/App.js'

/**
 * The inbox.
 *
 * Everything captured lands here first with its suggestions attached but NOT
 * applied. Orbit says what it thinks a thing is and why it thinks so; the user
 * decides. That distinction is the whole reason this screen exists rather than
 * a clever filing robot: an extraction that is right 90% of the time and silent
 * about the other 10% is worse than useless in a system holding your money.
 */

interface Suggestion {
  field: string
  label: string
  value: string
  confidence: 'high' | 'medium' | 'low'
  because: string
}

interface InboxItem {
  id: string
  kind: string
  title: string
  body: string
  attachment_id: string | null
  captured_at: string
  source: string
  status: string
  suggestions: Suggestion[]
}

export function InboxPage({ nav }: { nav: Navigator }): ReactNode {
  const { format, revision, bumpRevision, toast, entities } = useApp()
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'new' | 'archived' | 'converted'>('new')
  const [converting, setConverting] = useState<InboxItem | null>(null)
  const [dragging, setDragging] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const result = await call<{ items: InboxItem[] }>('inbox.list', { status })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setItems(result.data.items)
  }, [status])

  useEffect(() => {
    void load()
  }, [load, revision])

  const archive = async (id: string): Promise<void> => {
    const result = await call('inbox.archive', { id })
    if (result.ok) {
      bumpRevision()
      toast({ tone: 'good', title: 'Archived' })
    }
  }

  const captureFiles = async (paths: string[]): Promise<void> => {
    const result = await call<{ captured: number }>('inbox.capture', { paths, source: 'drag-drop' })
    if (result.ok) {
      bumpRevision()
      toast({ tone: 'good', title: `${result.data.captured} captured` })
    } else {
      toast({ tone: 'bad', title: 'Those could not be captured', detail: result.error })
    }
  }

  return (
    <div
      className={`drop-target${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => pathForDroppedFile(file))
          .filter(Boolean)
        if (paths.length > 0) void captureFiles(paths)
      }}
    >
      <div className="page-head">
        <div className="titles">
          <p className="kicker">Inbox</p>
          <h1>Sort it out</h1>
          <p className="sub">
            Anything you have captured, waiting to become a real record. Orbit suggests; you decide. Nothing here has
            been filed anywhere yet.
          </p>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 'var(--gap)' }}>
        {(
          [
            ['new', 'To sort'],
            ['converted', 'Filed'],
            ['archived', 'Archived']
          ] as ['new' | 'converted' | 'archived', string][]
        ).map(([key, label]) => (
          <button key={key} className={`btn small${status === key ? ' primary' : ''}`} onClick={() => setStatus(key)}>
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !items ? (
        <Loading rows={5} label="Loading your inbox" />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="inbox"
            title={status === 'new' ? 'Nothing waiting' : 'Nothing here'}
            message={
              status === 'new'
                ? 'Drop a receipt or a photograph onto this page, or press the Capture button in the top bar to jot something down.'
                : undefined
            }
          />
        </div>
      ) : (
        <ul style={{ display: 'grid', gap: 'var(--gap)' }}>
          {items.map((item) => (
            <li key={item.id} className="card">
              <div style={{ display: 'flex', gap: 13, padding: 15 }}>
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 34,
                    height: 34,
                    flex: '0 0 auto',
                    borderRadius: 10,
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)'
                  }}
                >
                  <Icon
                    name={item.kind === 'image' ? 'star' : item.kind === 'document' || item.kind === 'file' ? 'document' : 'note'}
                    size={16}
                  />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 13.5, overflowWrap: 'anywhere' }}>{item.title || '(no title)'}</b>
                  {item.body ? (
                    <p style={{ marginTop: 3, color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
                      {item.body.slice(0, 400)}
                    </p>
                  ) : null}
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Chip>{fmtDate(item.captured_at.slice(0, 10), format)}</Chip>
                    {item.suggestions.map((suggestion, index) => (
                      <Chip
                        key={index}
                        tone={suggestion.confidence === 'high' ? 'good' : suggestion.confidence === 'medium' ? 'info' : 'neutral'}
                      >
                        {suggestion.field === '__type'
                          ? `Looks like a ${suggestion.value.replace(/_/g, ' ')}`
                          : suggestion.field === 'amount_minor'
                            ? `${suggestion.label}: ${money(Number(suggestion.value), format)}`
                            : `${suggestion.label}: ${suggestion.value}`}
                      </Chip>
                    ))}
                  </div>
                  {item.suggestions.length > 0 ? (
                    <p style={{ marginTop: 7, color: 'var(--muted-2)', fontSize: 11.5 }}>
                      Suggested because {item.suggestions.map((s) => s.because).join('; ')}. Nothing has been applied.
                    </p>
                  ) : null}
                </div>
                {status === 'new' ? (
                  <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                    <button className="btn small primary" onClick={() => setConverting(item)}>
                      File it
                    </button>
                    <button className="btn small" onClick={() => void archive(item.id)}>
                      Archive
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {converting ? (
        <ConvertDialog
          item={converting}
          entities={entities}
          onClose={() => setConverting(null)}
          onDone={(type, id) => {
            setConverting(null)
            bumpRevision()
            toast({
              tone: 'good',
              title: 'Filed',
              action: { label: 'Open it', run: () => nav.openRecord(type, id) }
            })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Turning an inbox item into a record.
 *
 * The suggested values are pre-filled into a real form of the chosen record
 * type, so what the user confirms is exactly what gets saved — and they can
 * change any of it first.
 */
function ConvertDialog({
  item,
  entities,
  onClose,
  onDone
}: {
  item: InboxItem
  entities: EntityDescriptor[]
  onClose: () => void
  onDone: (type: string, id: string) => void
}): ReactNode {
  const { settings, toast } = useApp()
  const suggestedType = item.suggestions.find((s) => s.field === '__type')?.value ?? ''
  const [type, setType] = useState(suggestedType || 'task')
  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)

  const entity = entities.find((e) => e.type === type)

  useEffect(() => {
    if (!entity) return
    const seed: FormValues = {}
    // Map the item's own text onto the record's title, and any suggestion
    // whose field this record actually has.
    seed[entity.titleField] = item.title || item.body.split('\n')[0] || ''
    if (entity.fields.some((f) => f.name === 'notes')) seed.notes = item.body
    if (entity.fields.some((f) => f.name === 'currency')) seed.currency = settings?.currency ?? 'GBP'
    for (const suggestion of item.suggestions) {
      if (suggestion.field === '__type') continue
      const field = entity.fields.find((f) => f.name === suggestion.field || (suggestion.field === 'date' && f.type === 'date' && f.required))
      if (!field) continue
      seed[field.name] = field.type === 'money' || field.type === 'number' ? Number(suggestion.value) : suggestion.value
    }
    setValues(initialValues(entity, seed))
    setErrors({})
  }, [entity, item, settings?.currency])

  const options = entities.filter((e) => !e.module || (settings?.modules ?? []).includes(e.module))

  const submit = async (): Promise<void> => {
    if (!entity) return
    setBusy(true)
    const payload: Record<string, unknown> = {}
    for (const field of entity.fields) payload[field.name] = values[field.name] ?? null
    const result = await call<{ converted: boolean; id?: string; errors?: { field: string; message: string }[] }>(
      'inbox.convert',
      { id: item.id, type, data: payload }
    )
    setBusy(false)
    if (!result.ok) {
      toast({ tone: 'bad', title: 'It could not be filed', detail: result.error })
      return
    }
    if (result.data.errors?.length) {
      const mapped: FieldErrors = {}
      for (const error of result.data.errors) if (error.field) mapped[error.field] = error.message
      setErrors(mapped)
      return
    }
    onDone(type, result.data.id ?? '')
  }

  return (
    <Modal
      title="File this"
      subtitle={item.title}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !entity}>
            {busy ? 'Filing…' : `Create the ${entity?.label.toLowerCase() ?? 'record'}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="field">
          <label htmlFor="convert-type">What is it?</label>
          <select id="convert-type" value={type} onChange={(event) => setType(event.target.value)}>
            {options.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
          {suggestedType && suggestedType === type ? (
            <span className="help">Orbit suggested this. Change it if it is wrong.</span>
          ) : null}
        </div>

        {item.attachment_id ? (
          <Notice tone="info" icon="paperclip" title="The file comes with it">
            The attached file will be linked to the new record automatically.
          </Notice>
        ) : null}

        {entity ? (
          <EntityForm
            entity={entity}
            values={values}
            errors={errors}
            onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
            disabled={busy}
          />
        ) : (
          <Loading rows={4} label="Loading the form" />
        )}
      </div>
    </Modal>
  )
}
