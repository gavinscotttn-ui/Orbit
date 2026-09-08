import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EntityDescriptor, FieldSpec } from '@shared/contracts/fields.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money, humanise, truncate } from '../lib/format.js'
import { Icon, iconForEntity } from './Icon.js'
import { EmptyState, ErrorState, Loading, Chip } from './ui.js'
import { RecordEditor } from './RecordEditor.js'
import type { FormValues } from './Form.js'

/**
 * A list of any record type.
 *
 * Columns come from the descriptor's `inList` fields, so a list never shows a
 * column the record does not have, and adding a field to a descriptor puts it
 * in the list without touching this file. Reference columns are resolved to the
 * referenced record's title rather than showing an opaque id.
 */

export interface RecordListProps {
  entity: EntityDescriptor
  /** Fixed filter applied on top of whatever the user types. */
  where?: Record<string, string | number | null>
  seed?: FormValues
  lockFields?: string[]
  onOpen?: (id: string) => void
  /** Replaces the built-in "Add" button when the caller wants its own. */
  actions?: ReactNode
  emptyAction?: ReactNode
  limit?: number
  compact?: boolean
}

interface RefLookup {
  [type: string]: Record<string, string>
}

export function RecordList({
  entity,
  where,
  seed,
  lockFields,
  onOpen,
  actions,
  emptyAction,
  limit = 300,
  compact
}: RecordListProps): ReactNode {
  const { format, revision, bumpRevision, entities } = useApp()
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [refs, setRefs] = useState<RefLookup>({})

  const columns = useMemo(() => entity.fields.filter((f) => f.inList).slice(0, compact ? 4 : 7), [entity, compact])

  const load = useCallback(async () => {
    setError('')
    const result = await call<{ rows: Record<string, unknown>[]; total: number }>('records.list', {
      type: entity.type,
      limit,
      ...(where ? { where } : {}),
      ...(search.trim() ? { search: search.trim() } : {})
    })
    if (!result.ok) {
      setError(result.error)
      setRows([])
      return
    }
    setRows(result.data.rows)
    setTotal(result.data.total)
  }, [entity.type, limit, where, search])

  useEffect(() => {
    void load()
  }, [load, revision])

  // Resolve the reference columns in one pass per referenced type.
  useEffect(() => {
    if (!rows || rows.length === 0) return
    const refColumns = columns.filter((c) => c.type === 'ref' && c.refType)
    if (refColumns.length === 0) return
    let cancelled = false
    void (async () => {
      const next: RefLookup = {}
      for (const column of refColumns) {
        const type = column.refType as string
        if (next[type]) continue
        const target = entities.find((e) => e.type === type)
        if (!target) continue
        const result = await call<{ rows: Record<string, unknown>[] }>('records.list', { type, limit: 1000 })
        if (!result.ok) continue
        const map: Record<string, string> = {}
        for (const row of result.data.rows) map[String(row.id)] = String(row[target.titleField] ?? '')
        next[type] = map
      }
      if (!cancelled) setRefs((current) => ({ ...current, ...next }))
    })()
    return () => {
      cancelled = true
    }
  }, [rows, columns, entities])

  const open = (id: string): void => {
    if (onOpen) onOpen(id)
    else setEditing({ id })
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{entity.plural}</h2>
            <p className="sub">
              {rows === null ? 'Loading…' : total === 1 ? '1 record' : `${total.toLocaleString(format.locale)} records`}
            </p>
          </div>
          <div className="btn-row">
            {entity.searchFields.length > 0 ? (
              <div style={{ position: 'relative' }}>
                <input
                  type="search"
                  value={search}
                  placeholder={`Filter ${entity.plural.toLowerCase()}…`}
                  aria-label={`Filter ${entity.plural.toLowerCase()}`}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ width: 210, paddingLeft: 30 }}
                />
                <span style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)', pointerEvents: 'none' }}>
                  <Icon name="search" size={15} />
                </span>
              </div>
            ) : null}
            {actions ?? (
              <button className="btn primary" onClick={() => setEditing({})}>
                <Icon name="plus" size={15} />
                Add
              </button>
            )}
          </div>
        </div>

        <div className="card-body flush">
          {error ? (
            <div style={{ padding: 16 }}>
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : rows === null ? (
            <div style={{ padding: 16 }}>
              <Loading rows={4} label={`Loading ${entity.plural.toLowerCase()}`} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={iconForEntity(entity.icon)}
              title={search ? `No ${entity.plural.toLowerCase()} match "${truncate(search, 30)}"` : `No ${entity.plural.toLowerCase()} yet`}
              message={search ? 'Try a shorter search.' : entity.emptyState}
              action={
                search ? (
                  <button className="btn" onClick={() => setSearch('')}>
                    Clear the filter
                  </button>
                ) : (
                  (emptyAction ?? (
                    <button className="btn primary" onClick={() => setEditing({})}>
                      <Icon name="plus" size={15} />
                      Add the first one
                    </button>
                  ))
                )
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column.name} className={isRight(column) ? 'right' : undefined}>
                        {column.label}
                      </th>
                    ))}
                    <th style={{ width: 34 }} aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={String(row.id)}
                      tabIndex={0}
                      onClick={() => open(String(row.id))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          open(String(row.id))
                        }
                      }}
                    >
                      {columns.map((column) => (
                        <td key={column.name} className={isRight(column) ? 'right' : undefined}>
                          <Cell spec={column} row={row} refs={refs} formatCtx={format} />
                        </td>
                      ))}
                      <td style={{ color: 'var(--muted-2)' }}>
                        <Icon name="chevron-right" size={15} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {rows && rows.length > 0 && total > rows.length ? (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12 }}>
            Showing the first {rows.length} of {total.toLocaleString(format.locale)}. Use the filter or search to narrow it down.
          </div>
        ) : null}
      </div>

      {editing ? (
        <RecordEditor
          entity={entity}
          {...(editing.id ? { id: editing.id } : {})}
          {...(seed ? { seed } : {})}
          {...(lockFields ? { lockFields } : {})}
          onClose={() => setEditing(null)}
          onSaved={() => bumpRevision()}
          onDeleted={() => bumpRevision()}
        />
      ) : null}
    </>
  )
}

function isRight(spec: FieldSpec): boolean {
  return spec.type === 'money' || spec.type === 'number'
}

function Cell({
  spec,
  row,
  refs,
  formatCtx
}: {
  spec: FieldSpec
  row: Record<string, unknown>
  refs: RefLookup
  formatCtx: Parameters<typeof money>[1]
}): ReactNode {
  const value = row[spec.name]

  switch (spec.type) {
    case 'money': {
      const currency = String(row[spec.currencyField ?? 'currency'] ?? '')
      if (value === null || value === undefined) return <span style={{ color: 'var(--muted-2)' }}>—</span>
      const amount = Number(value)
      return (
        <span className={`money ${amount < 0 ? 'out' : amount > 0 ? 'in' : ''}`}>
          {money(amount, formatCtx, currency || undefined)}
        </span>
      )
    }
    case 'date':
      return <span className="num">{fmtDate(value as string, formatCtx)}</span>
    case 'boolean':
      return value === 1 || value === true ? (
        <span style={{ color: 'var(--good)' }} aria-label="Yes">
          <Icon name="check" size={15} />
        </span>
      ) : (
        <span style={{ color: 'var(--muted-2)' }} aria-label="No">
          —
        </span>
      )
    case 'select': {
      const option = spec.options?.find((o) => o.value === String(value ?? ''))
      if (!option || !option.value) return <span style={{ color: 'var(--muted-2)' }}>—</span>
      return <Chip tone={option.tone ?? 'neutral'}>{option.label}</Chip>
    }
    case 'ref': {
      const label = spec.refType ? refs[spec.refType]?.[String(value ?? '')] : undefined
      if (!label) return <span style={{ color: 'var(--muted-2)' }}>—</span>
      return <span>{label}</span>
    }
    case 'number':
      return <span className="num">{value === null || value === undefined ? '—' : String(value)}</span>
    default: {
      const text = String(value ?? '')
      if (!text) return <span style={{ color: 'var(--muted-2)' }}>—</span>
      return <span title={text.length > 60 ? text : undefined}>{truncate(humaniseIfEnum(spec, text), 60)}</span>
    }
  }
}

function humaniseIfEnum(spec: FieldSpec, text: string): string {
  // Values that look like machine enums read better title-cased.
  if (spec.type === 'text' && /^[a-z][a-z0-9-]*$/.test(text) && text.includes('-')) return humanise(text)
  return text
}
