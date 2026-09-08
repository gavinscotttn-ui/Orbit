import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EntityDescriptor, FieldSpec } from '@shared/contracts/fields.js'
import { parseAmount, decimalSeparatorForLocale, SUPPORTED_CURRENCIES } from '@shared/domain/money.js'
import { describeRule, normaliseRule, type RecurrenceRule } from '@shared/domain/recurrence.js'
import { call } from '../lib/api.js'
import { moneyInput } from '../lib/format.js'
import { useApp } from '../app/state.js'
import { Icon } from './Icon.js'

/**
 * Forms built from the record-type descriptors.
 *
 * One description drives the database constraint, the main process's
 * validation and this form, so the three cannot drift apart. A money field
 * knows which currency column it belongs to; a reference field knows which
 * record type it points at and fetches the options itself; a recurrence field
 * gets a real editor rather than a box to type JSON into.
 *
 * Errors from the main process arrive keyed by field name and are shown against
 * the right input, not as one opaque message at the top.
 */

export type FormValues = Record<string, unknown>

export interface FieldErrors {
  [field: string]: string
}

export interface FormProps {
  entity: EntityDescriptor
  values: FormValues
  errors: FieldErrors
  onChange: (name: string, value: unknown) => void
  /** Fields to leave out, e.g. the parent already chosen by context. */
  omit?: string[]
  disabled?: boolean
}

export function EntityForm({ entity, values, errors, onChange, omit = [], disabled }: FormProps): ReactNode {
  const omitted = useMemo(() => new Set(omit), [omit])
  const fields = entity.fields.filter((f) => !omitted.has(f.name))

  // Group the fields, keeping the ungrouped ones first and in order.
  const groups = useMemo(() => {
    const main: FieldSpec[] = []
    const named = new Map<string, FieldSpec[]>()
    for (const field of fields) {
      if (!field.group) {
        main.push(field)
        continue
      }
      const list = named.get(field.group) ?? []
      list.push(field)
      named.set(field.group, list)
    }
    return { main, named: [...named.entries()] }
  }, [fields])

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div className="form-grid">
        {groups.main.map((field) => (
          <Field
            key={field.name}
            spec={field}
            value={values[field.name]}
            error={errors[field.name] ?? ''}
            values={values}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </div>
      {groups.named.map(([name, list]) => (
        <div className="form-section" key={name}>
          <h4>{name}</h4>
          <div className="form-grid">
            {list.map((field) => (
              <Field
                key={field.name}
                spec={field}
                value={values[field.name]}
                error={errors[field.name] ?? ''}
                values={values}
                onChange={onChange}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface FieldProps {
  spec: FieldSpec
  value: unknown
  values: FormValues
  error: string
  onChange: (name: string, value: unknown) => void
  disabled?: boolean
}

function Field({ spec, value, values, error, onChange, disabled }: FieldProps): ReactNode {
  const id = `field-${spec.name}`
  const describedBy = [spec.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ')
  const span = spec.span === 2 || spec.type === 'longtext' || spec.type === 'recurrence'

  return (
    <div className={`field${span ? ' span-2' : ''}`}>
      {spec.type === 'boolean' ? null : <label htmlFor={id}>{spec.label}{spec.required ? ' *' : ''}</label>}
      <Control
        id={id}
        spec={spec}
        value={value}
        values={values}
        onChange={onChange}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={describedBy || undefined}
      />
      {spec.help ? (
        <span className="help" id={`${id}-help`}>
          {spec.help}
        </span>
      ) : null}
      {error ? (
        <span className="error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

interface ControlProps {
  id: string
  spec: FieldSpec
  value: unknown
  values: FormValues
  onChange: (name: string, value: unknown) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

function Control({ id, spec, value, values, onChange, disabled, invalid, describedBy }: ControlProps): ReactNode {
  const common = {
    id,
    disabled,
    'aria-invalid': invalid ? (true as const) : undefined,
    'aria-describedby': describedBy
  }

  switch (spec.type) {
    case 'boolean':
      return (
        <label className="check" htmlFor={id}>
          <input
            {...common}
            type="checkbox"
            checked={value === 1 || value === true || value === '1'}
            onChange={(event) => onChange(spec.name, event.target.checked ? 1 : 0)}
          />
          <span>{spec.label}</span>
        </label>
      )

    case 'longtext':
      return (
        <textarea
          {...common}
          value={String(value ?? '')}
          placeholder={spec.placeholder ?? ''}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )

    case 'select':
      return (
        <select {...common} value={String(value ?? '')} onChange={(event) => onChange(spec.name, event.target.value)}>
          {spec.options?.some((o) => o.value === '') ? null : <option value="">Not set</option>}
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'money':
      return <MoneyInput {...common} spec={spec} value={value} values={values} onChange={onChange} />

    case 'ref':
      return <RefPicker {...common} spec={spec} value={value} values={values} onChange={onChange} />

    case 'recurrence':
      return <RecurrenceEditor id={id} value={value} onChange={(next) => onChange(spec.name, next)} disabled={disabled} />

    case 'date':
      return (
        <input
          {...common}
          type="date"
          value={String(value ?? '')}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )

    case 'time':
      return (
        <input
          {...common}
          type="time"
          value={String(value ?? '')}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )

    case 'number':
      return (
        <input
          {...common}
          type="number"
          value={value === null || value === undefined ? '' : String(value)}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          placeholder={spec.placeholder ?? ''}
          onChange={(event) => onChange(spec.name, event.target.value === '' ? null : Number(event.target.value))}
        />
      )

    case 'url':
      return (
        <input
          {...common}
          type="url"
          value={String(value ?? '')}
          placeholder={spec.placeholder ?? 'https://'}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )

    case 'email':
      return (
        <input
          {...common}
          type="email"
          value={String(value ?? '')}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )

    default:
      return (
        <input
          {...common}
          type="text"
          value={String(value ?? '')}
          placeholder={spec.placeholder ?? ''}
          onChange={(event) => onChange(spec.name, event.target.value)}
        />
      )
  }
}

// -- Money -------------------------------------------------------------------

/**
 * The only place in the interface where a decimal string becomes a number.
 *
 * The user types what they like — "12.50", "£1,234", "(4.20)" — and it is
 * parsed into minor units on the way out. What is stored is always an integer;
 * what is shown while typing is exactly what they typed, so the cursor never
 * jumps and a half-finished "12." is not eaten.
 */
function MoneyInput({
  id,
  spec,
  value,
  values,
  onChange,
  disabled,
  ...rest
}: ControlProps): ReactNode {
  const { settings, format } = useApp()
  const currency = String(values[spec.currencyField ?? 'currency'] ?? settings?.currency ?? 'GBP')
  const [text, setText] = useState(() => moneyInput(value as number, currency))
  const [localError, setLocalError] = useState('')

  // Keep in step when the value changes from outside (a reset, or a load).
  useEffect(() => {
    const asText = moneyInput(value as number, currency)
    setText((current) => {
      const parsed = parseAmount(current, currency, { decimalSeparator: decimalSeparatorForLocale(format.locale) })
      if (parsed.ok && parsed.value === value) return current
      return asText
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency])

  const commit = (raw: string): void => {
    if (raw.trim() === '') {
      setLocalError('')
      onChange(spec.name, null)
      return
    }
    const parsed = parseAmount(raw, currency, { decimalSeparator: decimalSeparatorForLocale(format.locale) })
    if (parsed.ok) {
      setLocalError('')
      onChange(spec.name, parsed.value)
    } else {
      setLocalError(parsed.error)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          {...rest}
          id={id}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={text}
          placeholder="0.00"
          style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          onChange={(event) => {
            setText(event.target.value)
            commit(event.target.value)
          }}
          onBlur={(event) => {
            const parsed = parseAmount(event.target.value, currency, {
              decimalSeparator: decimalSeparatorForLocale(format.locale)
            })
            if (parsed.ok) setText(moneyInput(parsed.value, currency))
          }}
        />
        <span
          className="chip"
          title={`Amounts are stored as whole ${currency} minor units`}
          style={{ alignSelf: 'center' }}
        >
          {currency}
        </span>
      </div>
      {localError ? (
        <span className="error" role="alert">
          {localError}
        </span>
      ) : null}
    </>
  )
}

// -- Reference picker --------------------------------------------------------

interface RefOption {
  id: string
  label: string
}

function RefPicker({ id, spec, value, onChange, disabled, ...rest }: ControlProps): ReactNode {
  const { entities, revision } = useApp()
  const [options, setOptions] = useState<RefOption[] | null>(null)
  const target = entities.find((e) => e.type === spec.refType)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!spec.refType || !target) {
        setOptions([])
        return
      }
      const result = await call<{ rows: Record<string, unknown>[] }>('records.list', {
        type: spec.refType,
        limit: 500,
        ...(spec.refFilter ? { where: spec.refFilter } : {})
      })
      if (cancelled) return
      if (!result.ok) {
        setOptions([])
        return
      }
      setOptions(
        result.data.rows.map((row) => ({
          id: String(row.id),
          label: String(row[target.titleField] ?? '(untitled)')
        }))
      )
    })()
    return () => {
      cancelled = true
    }
  }, [spec.refType, spec.refFilter, target, revision])

  if (options === null) {
    return <div className="skeleton" style={{ height: 34 }} />
  }
  if (options.length === 0) {
    return (
      <select {...rest} id={id} disabled value="" onChange={() => undefined}>
        <option value="">No {target?.plural.toLowerCase() ?? 'records'} yet — add one first</option>
      </select>
    )
  }
  return (
    <select
      {...rest}
      id={id}
      disabled={disabled}
      value={String(value ?? '')}
      onChange={(event) => onChange(spec.name, event.target.value || null)}
    >
      <option value="">Not set</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

// -- Recurrence --------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * A recurrence editor that speaks English.
 *
 * Everything it can express maps onto the rule the engine actually understands,
 * and the plain sentence underneath is generated by the same `describeRule`
 * the rest of the app uses — so what the user reads here is exactly what will
 * happen.
 */
export function RecurrenceEditor({
  id,
  value,
  onChange,
  disabled
}: {
  id: string
  value: unknown
  onChange: (next: string) => void
  disabled?: boolean
}): ReactNode {
  const rule = useMemo<RecurrenceRule | null>(() => {
    if (!value || typeof value !== 'string' || value === '') return null
    try {
      return normaliseRule(JSON.parse(value) as Partial<RecurrenceRule>)
    } catch {
      return null
    }
  }, [value])

  const update = (patch: Partial<RecurrenceRule>): void => {
    const next = normaliseRule({ freq: 'monthly', interval: 1, ...(rule ?? {}), ...patch })
    onChange(next ? JSON.stringify(next) : '')
  }

  if (!rule) {
    return (
      <div className="btn-row">
        <button className="btn small" disabled={disabled} onClick={() => update({ freq: 'monthly', interval: 1 })} id={id}>
          <Icon name="repeat" size={14} />
          Make it repeat
        </button>
        <span className="help">Does not repeat</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>Every</span>
        <input
          id={id}
          type="number"
          min={1}
          max={99}
          value={rule.interval}
          disabled={disabled}
          style={{ width: 74 }}
          onChange={(event) => update({ interval: Math.max(1, Number(event.target.value) || 1) })}
        />
        <select
          value={rule.freq}
          disabled={disabled}
          style={{ width: 130 }}
          onChange={(event) => update({ freq: event.target.value as RecurrenceRule['freq'] })}
        >
          <option value="daily">{rule.interval === 1 ? 'day' : 'days'}</option>
          <option value="weekly">{rule.interval === 1 ? 'week' : 'weeks'}</option>
          <option value="monthly">{rule.interval === 1 ? 'month' : 'months'}</option>
          <option value="yearly">{rule.interval === 1 ? 'year' : 'years'}</option>
        </select>
        <button className="btn small ghost" disabled={disabled} onClick={() => onChange('')}>
          <Icon name="close" size={13} />
          Stop repeating
        </button>
      </div>

      {rule.freq === 'weekly' ? (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {WEEKDAYS.map((day, index) => {
            const active = rule.byWeekday?.includes(index) ?? false
            return (
              <button
                key={day}
                className={`btn small${active ? ' primary' : ''}`}
                disabled={disabled}
                aria-pressed={active}
                onClick={() => {
                  const current = new Set(rule.byWeekday ?? [])
                  if (current.has(index)) current.delete(index)
                  else current.add(index)
                  update({ byWeekday: [...current].sort() })
                }}
              >
                {day}
              </button>
            )
          })}
        </div>
      ) : null}

      {rule.freq === 'monthly' ? (
        <div className="btn-row">
          <label className="check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={rule.byMonthDay?.includes(-1) ?? false}
              onChange={(event) => update(event.target.checked ? { byMonthDay: [-1] } : { byMonthDay: [] })}
            />
            <span>On the last day of the month</span>
          </label>
        </div>
      ) : null}

      <div className="btn-row">
        <label className="check">
          <input
            type="checkbox"
            disabled={disabled}
            checked={Boolean(rule.fromCompletion)}
            onChange={(event) => update({ fromCompletion: event.target.checked })}
          />
          <span>Count from when I finish it, not when it was due</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            disabled={disabled}
            checked={rule.workdayAdjust === 'next'}
            onChange={(event) => update({ workdayAdjust: event.target.checked ? 'next' : 'none' })}
          />
          <span>Move weekends to the next working day</span>
        </label>
      </div>

      <div className="chip accent" style={{ alignSelf: 'start' }}>
        <Icon name="repeat" size={12} />
        {describeRule(rule)}
      </div>
    </div>
  )
}

// -- Currency picker (used by settings) --------------------------------------

export function CurrencySelect({
  id,
  value,
  onChange,
  disabled
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}): ReactNode {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {SUPPORTED_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  )
}

/** Build the initial values for a new record from its descriptor's defaults. */
export function initialValues(entity: EntityDescriptor, seed: FormValues = {}): FormValues {
  const values: FormValues = {}
  for (const field of entity.fields) {
    if (field.defaultValue !== undefined && field.defaultValue !== null) values[field.name] = field.defaultValue
    else if (field.type === 'boolean') values[field.name] = 0
    else if (['money', 'number', 'date'].includes(field.type)) values[field.name] = null
    else values[field.name] = ''
  }
  return { ...values, ...seed }
}

/** Strip a loaded row down to the fields this form knows how to edit. */
export function valuesFromRow(entity: EntityDescriptor, row: Record<string, unknown>): FormValues {
  const values: FormValues = {}
  for (const field of entity.fields) values[field.name] = row[field.name] ?? null
  return values
}
