import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { call } from '../lib/api.js'
import { useApp } from './state.js'
import { Icon, iconForEntity } from '../components/Icon.js'
import { Loading } from '../components/ui.js'

/**
 * Search across everything.
 *
 * The query goes to SQLite's full-text index, which covers every record type
 * and the text of any attachment Orbit was able to read. Results say which kind
 * of record they are and show the matching phrase in context, so "where is the
 * dishwasher receipt" lands on the purchase rather than on a list of maybes.
 */

interface Hit {
  type: string
  id: string
  title: string
  snippet: string
  module: string
  entityLabel: string
}

export function SearchPanel({
  onClose,
  onOpen
}: {
  onClose: () => void
  onOpen: (type: string, id: string) => void
}): ReactNode {
  const { entities } = useApp()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (query.trim().length < 2) {
      setHits(null)
      return
    }
    setBusy(true)
    timer.current = window.setTimeout(() => {
      void (async () => {
        const result = await call<{ hits: Hit[] }>('search.query', {
          text: query.trim(),
          limit: 60,
          ...(typeFilter ? { types: [typeFilter] } : {})
        })
        setBusy(false)
        setHits(result.ok ? result.data.hits : [])
        setIndex(0)
      })()
    }, 160)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [query, typeFilter])

  const typesPresent = useMemo(() => {
    if (!hits) return []
    const counts = new Map<string, number>()
    for (const hit of hits) counts.set(hit.type, (counts.get(hit.type) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [hits])

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Search records, documents and file contents…"
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => Math.min((hits?.length ?? 1) - 1, i + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (event.key === 'Enter' && hits?.[index]) {
              event.preventDefault()
              onOpen(hits[index].type, hits[index].id)
            }
          }}
        />

        {typesPresent.length > 1 ? (
          <div style={{ display: 'flex', gap: 6, padding: '9px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <button className={`btn small${typeFilter === '' ? ' primary' : ''}`} onClick={() => setTypeFilter('')}>
              Everything
            </button>
            {typesPresent.map(([type, count]) => {
              const entity = entities.find((e) => e.type === type)
              return (
                <button
                  key={type}
                  className={`btn small${typeFilter === type ? ' primary' : ''}`}
                  onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
                >
                  {entity?.plural ?? type} ({count})
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="palette-results">
          {query.trim().length < 2 ? (
            <div style={{ padding: '26px 18px', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7 }}>
              Type at least two letters. Orbit searches every record, every attached filename, and the text inside plain
              text and CSV attachments.
              <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                {['Where is the dishwasher receipt?', 'What renews this month?', 'MOT'].map((example) => (
                  <button
                    key={example}
                    className="btn small ghost"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setQuery(example.replace(/[?]/g, ''))}
                  >
                    <Icon name="search" size={13} />
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : busy && !hits ? (
            <div style={{ padding: 16 }}>
              <Loading rows={3} label="Searching" />
            </div>
          ) : !hits || hits.length === 0 ? (
            <div style={{ padding: '26px 18px', color: 'var(--muted)', fontSize: 12.5, textAlign: 'center' }}>
              Nothing found. Try fewer words, or part of a word.
            </div>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.type}:${hit.id}`}
                className={`palette-item${i === index ? ' active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onOpen(hit.type, hit.id)}
              >
                <span className="ico">
                  <Icon name={iconForEntity(entities.find((e) => e.type === hit.type)?.icon ?? 'grid')} size={14} />
                </span>
                <span className="body">
                  <b>{hit.title}</b>
                  <small>
                    {hit.entityLabel}
                    {hit.snippet ? ` · ${hit.snippet.replace(/\[|\]/g, '')}` : ''}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>{hits ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'Full-text search'}</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}
