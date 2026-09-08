/**
 * The field vocabulary Orbit records are described with.
 *
 * One description of a record type drives four things at once: what the
 * database will accept, what the main process validates on the way in, what
 * form the interface draws, and what columns a list shows. Keeping those in
 * step by hand across a hundred record types is how products end up with a
 * form that saves a field the database silently drops.
 *
 * This is deliberately NOT a generic key-value store. Every record type still
 * has its own table with its own columns and constraints; this is a typed
 * description OF those columns, not a substitute for them.
 */

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'date'
  | 'time'
  | 'boolean'
  | 'select'
  | 'ref'
  | 'recurrence'
  | 'json'
  | 'url'
  | 'email'
  | 'phone'

export interface SelectOption {
  value: string
  label: string
  /** Optional accent used by chips and status dots. */
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
}

export interface FieldSpec {
  /** Database column name. */
  name: string
  label: string
  type: FieldType
  /** Refuse to save when empty. Enforced in the main process, not just the UI. */
  required?: boolean
  options?: SelectOption[]
  /** For `ref`: which entity type this points at. */
  refType?: string
  /** For `ref`: restrict the picker, e.g. only organisations. */
  refFilter?: Record<string, string | number>
  /** For `money`: the column holding the currency code. */
  currencyField?: string
  placeholder?: string
  help?: string
  /** Groups fields into sections on the form. */
  group?: string
  /** Show as a column in list views. */
  inList?: boolean
  /** Width hint for the form grid. */
  span?: 1 | 2
  min?: number
  max?: number
  step?: number
  defaultValue?: string | number | boolean | null
  /** Never send this field to the renderer in a list context. */
  sensitive?: boolean
}

export interface EntityDescriptor {
  /** Stable identifier used across IPC, links, tags and search. */
  type: string
  table: string
  label: string
  plural: string
  /** Which Life module this belongs to; '' means core. */
  module: string
  icon: string
  /** Column shown as the record's name. */
  titleField: string
  /** Primary date column, used for timelines and "what's coming up". */
  dateField?: string
  /** Columns included in the full-text index. */
  searchFields: string[]
  /** Default ORDER BY clause (column names and ASC/DESC only). */
  defaultOrder: string
  fields: FieldSpec[]
  /** Short sentence shown when the list is empty. */
  emptyState?: string
  /** Where this record's costs come from, for the connected cost rollup. */
  costRollup?: { table: string; foreignKey: string; amountColumn: string; currencyColumn?: string; dateColumn: string }[]
}

/** Convenience builders that keep the descriptors readable. */
export const f = {
  text(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'text', ...extra }
  },
  longtext(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'longtext', span: 2, ...extra }
  },
  number(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'number', ...extra }
  },
  money(name: string, label: string, currencyField = 'currency', extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'money', currencyField, ...extra }
  },
  date(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'date', ...extra }
  },
  time(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'time', ...extra }
  },
  bool(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'boolean', ...extra }
  },
  select(name: string, label: string, options: (SelectOption | string)[], extra: Partial<FieldSpec> = {}): FieldSpec {
    return {
      name,
      label,
      type: 'select',
      options: options.map((o) => (typeof o === 'string' ? { value: o, label: titleise(o) } : o)),
      ...extra
    }
  },
  ref(name: string, label: string, refType: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'ref', refType, ...extra }
  },
  recurrence(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'recurrence', span: 2, ...extra }
  },
  url(name: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec {
    return { name, label, type: 'url', ...extra }
  }
}

export function titleise(value: string): string {
  const text = String(value ?? '').replace(/[-_]/g, ' ')
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Currency is present on most money-bearing records; declared once. */
export const currencyField: FieldSpec = {
  name: 'currency',
  label: 'Currency',
  type: 'text',
  group: 'Money',
  placeholder: 'GBP'
}
