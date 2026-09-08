import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { date as fmtDate, money } from '../lib/format.js'
import { Icon } from '../components/Icon.js'
import { Chip, Loading, Modal, Notice } from '../components/ui.js'

/**
 * Importing a bank statement.
 *
 * Nothing is written until the user has seen it. The preview shows every row
 * Orbit could read, flags the ones it could not, and marks anything already in
 * the vault as a duplicate — visibly, rather than silently dropping it, because
 * "why are forty of my two hundred transactions missing?" is a far worse
 * experience than being told.
 *
 * The duplicate key is the same one the database's unique index uses, so what
 * the preview promises is what the import does.
 */

interface PreviewRow {
  index: number
  date: string
  description: string
  amountMinor: number | null
  currency: string
  kind: 'income' | 'expense'
  importHash: string
  duplicate: boolean
  problem: string
}

interface Preview {
  cancelled?: boolean
  filename: string
  headers: string[]
  mapping: Record<string, number>
  rows: PreviewRow[]
  duplicates: number
  problems: string[]
}

export function ImportStatement({ onClose }: { onClose: () => void }): ReactNode {
  const { format, toast, bumpRevision } = useApp()
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string }[]>([])
  const [accountId, setAccountId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'choose' | 'review' | 'done'>('choose')
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  useEffect(() => {
    void (async () => {
      const response = await call<{ rows: Record<string, unknown>[] }>('records.list', { type: 'account', limit: 100 })
      if (response.ok) {
        const list = response.data.rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          currency: String(row.currency ?? 'GBP')
        }))
        setAccounts(list)
        setAccountId(list[0]?.id ?? '')
      }
    })()
  }, [])

  const choose = async (): Promise<void> => {
    if (!accountId) return
    setBusy(true)
    const response = await call<Preview>('import.previewCsv', { accountId })
    setBusy(false)
    if (!response.ok) {
      toast({ tone: 'bad', title: 'That file could not be read', detail: response.error })
      return
    }
    if (response.data.cancelled) return
    setPreview(response.data)
    // Duplicates and unreadable rows start unticked.
    setSkipped(new Set(response.data.rows.filter((r) => r.duplicate || r.problem).map((r) => r.index)))
    setStage('review')
  }

  const importable = useMemo(
    () => (preview?.rows ?? []).filter((row) => !skipped.has(row.index) && !row.problem && row.amountMinor !== null),
    [preview, skipped]
  )

  const commit = async (): Promise<void> => {
    if (!preview || importable.length === 0) return
    setBusy(true)
    const response = await call<{ imported: number; skipped: number }>('import.commitCsv', {
      accountId,
      rows: importable.map((row) => ({
        date: row.date,
        description: row.description,
        amountMinor: Math.abs(row.amountMinor ?? 0),
        kind: row.kind,
        importHash: row.importHash
      }))
    })
    setBusy(false)
    if (!response.ok) {
      toast({ tone: 'bad', title: 'The import did not finish', detail: response.error })
      return
    }
    setResult(response.data)
    setStage('done')
    bumpRevision()
  }

  return (
    <Modal
      title="Import a statement"
      subtitle={stage === 'review' && preview ? preview.filename : 'A CSV exported from your bank'}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        stage === 'choose' ? (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void choose()} disabled={busy || !accountId}>
              {busy ? 'Reading…' : 'Choose a file'}
            </button>
          </>
        ) : stage === 'review' ? (
          <>
            <span className="left" style={{ color: 'var(--muted)', fontSize: 12 }}>
              {importable.length} of {preview?.rows.length ?? 0} rows will be imported
            </span>
            <button className="btn" onClick={() => setStage('choose')} disabled={busy}>
              Back
            </button>
            <button className="btn primary" onClick={() => void commit()} disabled={busy || importable.length === 0}>
              {busy ? 'Importing…' : `Import ${importable.length}`}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {stage === 'choose' ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="field">
            <label htmlFor="import-account">Which account is this statement for?</label>
            <select id="import-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.length === 0 ? <option value="">Add an account first</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
          </div>
          <Notice tone="info" title="What Orbit can read">
            A CSV with a date column, a description and either a single amount column or separate money-in and money-out
            columns. Dates are read day-first, which is what UK banks export; the preview shows exactly how each one was
            interpreted so you can check before anything is saved.
          </Notice>
          <Notice tone="good" icon="lock" title="The file never leaves your computer">
            It is read by Orbit itself and turned into records in your vault. Nothing is uploaded, because Orbit has no
            network access at all.
          </Notice>
        </div>
      ) : stage === 'review' && preview ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {preview.duplicates > 0 ? (
            <Notice tone="warn" title={`${preview.duplicates} row${preview.duplicates === 1 ? '' : 's'} already in this vault`}>
              They have been unticked rather than hidden, so you can see what was skipped and why. Tick one to import it
              anyway.
            </Notice>
          ) : null}
          {preview.rows.some((r) => r.problem) ? (
            <Notice tone="bad" title="Some rows could not be read">
              They are marked below. Usually it is a date format Orbit did not recognise or a missing amount.
            </Notice>
          ) : null}

          <div className="table-wrap" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={skipped.size === 0}
                      onChange={(event) => {
                        if (event.target.checked) setSkipped(new Set())
                        else setSkipped(new Set(preview.rows.map((r) => r.index)))
                      }}
                    />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.index} style={{ cursor: 'default', opacity: row.problem ? 0.6 : 1 }}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Import ${row.description}`}
                        disabled={Boolean(row.problem)}
                        checked={!skipped.has(row.index)}
                        onChange={() => {
                          setSkipped((current) => {
                            const next = new Set(current)
                            if (next.has(row.index)) next.delete(row.index)
                            else next.add(row.index)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td className="num">{row.date ? fmtDate(row.date, format) : '—'}</td>
                    <td>{row.description || '—'}</td>
                    <td className={`right money ${row.kind === 'expense' ? 'out' : 'in'}`}>
                      {row.amountMinor === null ? '—' : money(row.amountMinor, format, row.currency)}
                    </td>
                    <td>
                      {row.problem ? (
                        <Chip tone="bad">{row.problem}</Chip>
                      ) : row.duplicate ? (
                        <Chip tone="warn">Already here</Chip>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : stage === 'done' && result ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <Notice tone="good" title={`${result.imported} transaction${result.imported === 1 ? '' : 's'} imported`}>
            {result.skipped > 0
              ? `${result.skipped} were skipped because they were already in the vault.`
              : 'Nothing was skipped.'}
          </Notice>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            They are uncategorised for now. Categorising them is what makes the budget and spending screens useful, and
            it is much quicker done in one sitting than a few at a time.
          </p>
        </div>
      ) : (
        <Loading rows={4} label="Reading the file" />
      )}
    </Modal>
  )
}

export { Icon }
