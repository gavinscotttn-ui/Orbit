import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from './state.js'
import { Icon, iconForEntity, type IconName } from '../components/Icon.js'
import type { Navigator } from './App.js'

/**
 * The command palette.
 *
 * Everything the application can do, findable by typing a few letters. It is
 * the keyboard route to any record type, any page and any action, and it is
 * built from the same entity descriptors as the rest of the interface, so a new
 * record type appears here without anyone remembering to add it.
 */

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: IconName
  run: () => void
}

export function CommandPalette({
  nav,
  onClose,
  onCapture
}: {
  nav: Navigator
  onClose: () => void
  onCapture: () => void
}): ReactNode {
  const { entities, settings } = useApp()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const enabled = new Set(settings?.modules ?? [])
    const out: Command[] = [
      { id: 'go-today', label: 'Go to Today', group: 'Go', icon: 'today', run: () => nav.go({ page: 'today' }) },
      { id: 'go-plan', label: 'Go to Plan', group: 'Go', icon: 'plan', run: () => nav.go({ page: 'plan' }) },
      { id: 'go-money', label: 'Go to Money', group: 'Go', icon: 'money', run: () => nav.go({ page: 'money' }) },
      { id: 'go-life', label: 'Go to Life', group: 'Go', icon: 'life', run: () => nav.go({ page: 'life' }) },
      { id: 'go-inbox', label: 'Go to Inbox', group: 'Go', icon: 'inbox', run: () => nav.go({ page: 'inbox' }) },
      { id: 'go-settings', label: 'Settings', group: 'Go', icon: 'settings', run: () => nav.go({ page: 'settings' }) },
      { id: 'capture', label: 'Quick capture', hint: 'Jot something down now, sort it later', group: 'Do', icon: 'plus', run: onCapture },
      {
        id: 'vault',
        label: 'Vault, backups and transfer',
        group: 'Do',
        icon: 'lock',
        run: () => nav.go({ page: 'settings', section: 'vault' })
      },
      {
        id: 'life-events',
        label: 'Start a life event',
        hint: 'Moving house, a new job, a baby…',
        group: 'Do',
        icon: 'flag',
        run: () => nav.go({ page: 'plan', view: 'life-events' })
      },
      {
        id: 'modules',
        label: 'Choose which areas of life to track',
        group: 'Do',
        icon: 'grid',
        run: () => nav.go({ page: 'settings', section: 'modules' })
      }
    ]
    for (const entity of entities) {
      if (entity.module && !enabled.has(entity.module)) continue
      out.push({
        id: `list-${entity.type}`,
        label: entity.plural,
        hint: entity.emptyState,
        group: 'Records',
        icon: iconForEntity(entity.icon),
        run: () => nav.go({ page: 'life', type: entity.type })
      })
    }
    return out
  }, [entities, settings?.modules, nav, onCapture])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return commands
    const words = text.split(/\s+/)
    return commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase()
        let score = 0
        for (const word of words) {
          const at = haystack.indexOf(word)
          if (at < 0) return null
          score += at === 0 ? 3 : haystack.includes(` ${word}`) ? 2 : 1
        }
        return { command, score }
      })
      .filter((x): x is { command: Command; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.command)
      .slice(0, 40)
  }, [commands, query])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    const active = listRef.current?.querySelector('.palette-item.active')
    active?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>()
    for (const command of filtered) {
      const list = map.get(command.group) ?? []
      list.push(command)
      map.set(command.group, list)
    }
    return [...map.entries()]
  }, [filtered])

  let flat = -1

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          type="text"
          value={query}
          placeholder="What would you like to do?"
          aria-label="Command"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => Math.min(filtered.length - 1, i + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              filtered[index]?.run()
              onClose()
            }
          }}
        />
        <div className="palette-results" ref={listRef}>
          {filtered.length === 0 ? (
            <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 12.5, textAlign: 'center' }}>
              Nothing matches that.
            </div>
          ) : (
            groups.map(([group, items]) => (
              <div key={group}>
                <div className="palette-group">{group}</div>
                {items.map((command) => {
                  flat += 1
                  const active = flat === index
                  return (
                    <button
                      key={command.id}
                      className={`palette-item${active ? ' active' : ''}`}
                      onMouseEnter={() => setIndex(filtered.indexOf(command))}
                      onClick={() => {
                        command.run()
                        onClose()
                      }}
                    >
                      <span className="ico">
                        <Icon name={command.icon} size={14} />
                      </span>
                      <span className="body">
                        <b>{command.label}</b>
                        {command.hint ? <small>{command.hint}</small> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to choose
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}
