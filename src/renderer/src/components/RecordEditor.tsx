import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { EntityDescriptor } from '@shared/contracts/fields.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { EntityForm, initialValues, valuesFromRow, type FieldErrors, type FormValues } from './Form.js'
import { Modal, Loading, ErrorState, useConfirm } from './ui.js'

/**
 * Add or edit any record.
 *
 * One component for every record type, because the descriptors already say what
 * each one looks like. What it adds on top of the form:
 *
 *  - Errors from the main process land against the right field.
 *  - Closing with unsaved changes asks first, rather than quietly binning work.
 *  - Deleting is confirmed, and the toast that follows offers to undo it, which
 *    it can because the repository keeps a snapshot.
 */

export interface RecordEditorProps {
  entity: EntityDescriptor
  /** Omit for a new record. */
  id?: string
  /** Values to pre-fill and lock, e.g. the asset a service record belongs to. */
  seed?: FormValues
  lockFields?: string[]
  onClose: () => void
  onSaved?: (id: string) => void
  onDeleted?: () => void
}

export function RecordEditor({
  entity,
  id,
  seed = {},
  lockFields = [],
  onClose,
  onSaved,
  onDeleted
}: RecordEditorProps): ReactNode {
  const { toast, bumpRevision, reportSaving, reportSaved, reportSaveError, settings } = useApp()
  const { confirm, dialog } = useConfirm()

  const [values, setValues] = useState<FormValues | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [generalError, setGeneralError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!id) {
        // A money-bearing record inherits the vault's currency, so the user is
        // not asked the same question every time. The currency column is often
        // named by a money field rather than declared as a field of its own.
        const currencyColumns = new Set<string>()
        for (const field of entity.fields) {
          if (field.name === 'currency') currencyColumns.add('currency')
          if (field.type === 'money' && field.currencyField) currencyColumns.add(field.currencyField)
        }
        const currencyDefaults: Record<string, unknown> = {}
        for (const column of currencyColumns) currencyDefaults[column] = settings?.currency ?? 'GBP'

        const defaults = initialValues(entity, { ...currencyDefaults, ...seed })
        setValues(defaults)
        return
      }
      const result = await call<Record<string, unknown>>('records.get', { type: entity.type, id })
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error)
        return
      }
      setValues({ ...valuesFromRow(entity, result.data), ...seed })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.type, id])

  const change = useCallback((name: string, value: unknown) => {
    setDirty(true)
    setValues((current) => ({ ...(current ?? {}), [name]: value }))
    setErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const close = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard your changes?',
        message: 'You have edited this without saving. Closing now will lose those edits.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger'
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, confirm, onClose])

  const save = async (): Promise<void> => {
    if (!values) return
    setBusy(true)
    setErrors({})
    setGeneralError('')
    reportSaving()

    const payload: Record<string, unknown> = {}
    for (const field of entity.fields) payload[field.name] = values[field.name] ?? null
    // Currency columns are referenced by money fields rather than declared as
    // fields, so they have to be carried over explicitly.
    for (const field of entity.fields) {
      if (field.type === 'money' && field.currencyField && values[field.currencyField] !== undefined) {
        payload[field.currencyField] = values[field.currencyField]
      }
    }

    const result = id
      ? await call<{ updated: boolean; errors?: { field: string; message: string }[]; row?: Record<string, unknown> }>(
          'records.update',
          { type: entity.type, id, data: payload }
        )
      : await call<{ created: boolean; errors?: { field: string; message: string }[]; id?: string }>('records.create', {
          type: entity.type,
          data: payload
        })

    setBusy(false)

    if (!result.ok) {
      reportSaveError(result.error)
      // Field-level errors from schema validation come back on the envelope.
      if (result.fields?.length) {
        const mapped: FieldErrors = {}
        for (const item of result.fields) {
          const name = item.field.replace(/^data\./, '')
          if (name) mapped[name] = item.message
        }
        setErrors(mapped)
      }
      setGeneralError(result.error)
      return
    }

    const data = result.data as { created?: boolean; updated?: boolean; errors?: { field: string; message: string }[]; id?: string }
    if (data.errors?.length) {
      reportSaveError('Some details need fixing.')
      const mapped: FieldErrors = {}
      let general = ''
      for (const item of data.errors) {
        if (item.field) mapped[item.field] = item.message
        else general = item.message
      }
      setErrors(mapped)
      setGeneralError(general)
      return
    }

    reportSaved()
    setDirty(false)
    bumpRevision()
    const savedId = id ?? data.id ?? ''
    toast({ tone: 'good', title: id ? `${entity.label} saved` : `${entity.label} added` })
    onSaved?.(savedId)
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (!id) return
    const ok = await confirm({
      title: `Delete this ${entity.label.toLowerCase()}?`,
      message: (
        <>
          <p>
            This removes the record and everything that depends on it. Attached files stay in the vault unless nothing
            else uses them.
          </p>
          <p style={{ marginTop: 8, color: 'var(--muted)' }}>You can undo this straight afterwards.</p>
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger'
    })
    if (!ok) return

    setBusy(true)
    const result = await call<{ ok: boolean; message: string }>('records.delete', { type: entity.type, id })
    setBusy(false)
    if (!result.ok || !result.data.ok) {
      const message = result.ok ? result.data.message : result.error
      toast({ tone: 'bad', title: 'It could not be deleted', detail: message })
      return
    }

    // The activity log holds a snapshot, so undo is real rather than decorative.
    const history = await call<{ entries: { id: string; action: string }[] }>('records.history', {
      type: entity.type,
      id,
      limit: 1
    })
    const activityId = history.ok ? history.data.entries.find((e) => e.action === 'deleted')?.id : undefined

    bumpRevision()
    toast({
      tone: 'good',
      title: `${entity.label} deleted`,
      ...(activityId
        ? {
            action: {
              label: 'Undo',
              run: () => {
                void (async () => {
                  const undone = await call<{ ok: boolean; message: string }>('records.restore', { activityId })
                  if (undone.ok && undone.data.ok) {
                    bumpRevision()
                    toast({ tone: 'good', title: 'Put back' })
                  } else {
                    toast({ tone: 'bad', title: 'It could not be put back' })
                  }
                })()
              }
            }
          }
        : {})
    })
    onDeleted?.()
    onClose()
  }

  return (
    <>
      <Modal
        title={id ? `Edit ${entity.label.toLowerCase()}` : `Add ${entity.label.toLowerCase()}`}
        {...(entity.emptyState && !id ? { subtitle: entity.emptyState } : {})}
        onClose={() => void close()}
        busy={busy}
        wide
        footer={
          <>
            {id ? (
              <button className="btn danger left" onClick={() => void remove()} disabled={busy}>
                Delete
              </button>
            ) : null}
            <button className="btn" onClick={() => void close()} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={busy || !values}>
              {busy ? 'Saving…' : id ? 'Save changes' : `Add ${entity.label.toLowerCase()}`}
            </button>
          </>
        }
      >
        {loadError ? (
          <ErrorState message={loadError} />
        ) : !values ? (
          <Loading rows={5} label={`Loading ${entity.label.toLowerCase()}`} />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {generalError ? <ErrorState message={generalError} /> : null}
            <EntityForm
              entity={entity}
              values={values}
              errors={errors}
              onChange={change}
              omit={lockFields}
              disabled={busy}
            />
          </div>
        )}
      </Modal>
      {dialog}
    </>
  )
}
