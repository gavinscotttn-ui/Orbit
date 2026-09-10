import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EntityDescriptor } from '@shared/contracts/fields.js'
import { call } from '../lib/api.js'
import { useApp } from '../app/state.js'
import { Icon, iconForEntity, type IconName } from '../components/Icon.js'
import { EmptyState, Loading } from '../components/ui.js'
import { RecordList } from '../components/RecordList.js'
import type { Navigator } from '../app/App.js'

/**
 * Life.
 *
 * The catalogue of everything Orbit can keep, arranged by the areas the user
 * has switched on. Somebody with no car and no pets never sees a vehicle or a
 * vaccination screen — the full list at once would be paralysing, and most of
 * it irrelevant to any one person.
 */

const MODULE_META: Record<string, { label: string; icon: IconName; blurb: string }> = {
  '': { label: 'Core', icon: 'grid', blurb: 'The records everything else hangs off.' },
  home: { label: 'Home', icon: 'home', blurb: 'Utilities, appliances, repairs, rooms and household routines.' },
  vehicles: { label: 'Vehicles', icon: 'car', blurb: 'Servicing, mileage, fuel, insurance and running costs.' },
  health: { label: 'Health', icon: 'heart', blurb: 'Appointments, medication, measurements and a private journal.' },
  family: { label: 'Family', icon: 'people', blurb: 'Household members, chores, school, childcare and care routines.' },
  pets: { label: 'Pets', icon: 'paw', blurb: 'Vaccinations, vet visits, insurance and sitter instructions.' },
  food: { label: 'Food', icon: 'basket', blurb: 'Meal plans, pantry, shopping lists and dietary needs.' },
  travel: { label: 'Travel', icon: 'plane', blurb: 'Trips, bookings, packing lists and travel credits.' },
  work: { label: 'Work', icon: 'briefcase', blurb: 'Shifts, leave, qualifications, courses and job applications.' },
  relationships: { label: 'Relationships', icon: 'gift', blurb: 'Birthdays, gift ideas, occasions and memories.' },
  goals: { label: 'Goals & hobbies', icon: 'flag', blurb: 'Bucket list, reading, collections and volunteering.' },
  digital: { label: 'Digital life', icon: 'laptop', blurb: 'Devices, backups, domains and an account inventory.' }
}

/**
 * Some record types belong to more than one area. A car is an `asset`, which
 * lives under Home, but somebody who has switched Vehicles on expects to find
 * their car there — an area called Vehicles that contains no vehicles is a bug,
 * not a subtlety. These entries put a filtered view of a shared type into the
 * area a person would actually look in.
 */
const MODULE_EXTRAS: Record<string, { type: string; label: string; where: Record<string, string>; blurb: string }[]> = {
  vehicles: [
    {
      type: 'asset',
      label: 'Vehicles',
      where: { asset_type: 'vehicle' },
      blurb: 'Cars, vans, motorbikes — with their servicing, fuel and running costs.'
    }
  ],
  home: [
    {
      type: 'asset',
      label: 'Appliances',
      where: { asset_type: 'appliance' },
      blurb: 'Boiler, washing machine, dishwasher — and when each was last serviced.'
    }
  ]
}

export function LifePage({ nav }: { nav: Navigator }): ReactNode {
  const { entities, sections, settings, revision } = useApp()
  const route = nav.route.page === 'life' ? nav.route : { page: 'life' as const }
  const [counts, setCounts] = useState<Record<string, number>>({})

  const enabled = settings?.modules ?? []

  const visible = useMemo(
    () => entities.filter((entity) => !entity.module || enabled.includes(entity.module)),
    [entities, enabled]
  )

  useEffect(() => {
    if (visible.length === 0) return
    let cancelled = false
    void (async () => {
      const result = await call<Record<string, number>>('records.counts', { types: visible.map((e) => e.type) })
      if (!cancelled && result.ok) setCounts(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, revision])

  // A single record type was asked for.
  if (route.type) {
    const entity = entities.find((e) => e.type === route.type)
    if (!entity) {
      return <EmptyState icon="alert" title="That is not something Orbit keeps" />
    }
    const filter = route.filter
    return (
      <>
        <div className="page-head">
          <div className="titles">
            <p className="kicker">{MODULE_META[entity.module]?.label ?? 'Records'}</p>
            <h1>{route.title ?? entity.plural}</h1>
            {entity.emptyState ? <p className="sub">{entity.emptyState}</p> : null}
          </div>
          <button className="btn" onClick={() => nav.go({ page: 'life', ...(route.module ? { module: route.module } : entity.module ? { module: entity.module } : {}) })}>
            <Icon name="chevron-left" size={14} />
            Back
          </button>
        </div>
        <RecordList
          entity={entity}
          {...(filter ? { where: filter, seed: filter } : {})}
          onOpen={(id) => nav.openRecord(entity.type, id)}
        />
      </>
    )
  }

  // One module's record types.
  if (route.module) {
    const meta = MODULE_META[route.module]
    const inModule = entities.filter((e) => e.module === route.module)
    return (
      <>
        <div className="page-head">
          <div className="titles">
            <p className="kicker">Life</p>
            <h1>{meta?.label ?? route.module}</h1>
            <p className="sub">{meta?.blurb}</p>
          </div>
          <button className="btn" onClick={() => nav.go({ page: 'life' })}>
            <Icon name="chevron-left" size={14} />
            All areas
          </button>
        </div>
        <div className="grid three">
          {(MODULE_EXTRAS[route.module] ?? []).map((extra) => {
            const entity = entities.find((e) => e.type === extra.type)
            if (!entity) return null
            return (
              <button
                key={`${extra.type}:${extra.label}`}
                className="card"
                style={{ display: 'flex', gap: 12, padding: 15, textAlign: 'left', alignItems: 'flex-start' }}
                onClick={() =>
                  nav.go({
                    page: 'life',
                    type: extra.type,
                    filter: extra.where,
                    title: extra.label,
                    module: route.module
                  })
                }
              >
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
                  <Icon name={iconForEntity(entity.icon)} size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 13.5, marginBottom: 2 }}>{extra.label}</b>
                  <small style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.5, display: 'block' }}>
                    {extra.blurb}
                  </small>
                </span>
              </button>
            )
          })}
          {inModule.map((entity) => (
            <TypeCard key={entity.type} entity={entity} count={counts[entity.type] ?? 0} nav={nav} />
          ))}
        </div>
      </>
    )
  }

  // The hub.
  //
  // Record types with a life area group under that area. The rest — the ones
  // that cannot be switched off — group by what they are for, rather than all
  // landing in one heap under the word "Core", which told the reader nothing
  // and buried the four types they actually had records in.
  const groups: { key: string; label: string; blurb: string; icon: IconName; list: EntityDescriptor[] }[] = []
  const push = (key: string, label: string, blurb: string, icon: IconName, entity: EntityDescriptor): void => {
    const existing = groups.find((g) => g.key === key)
    if (existing) existing.list.push(entity)
    else groups.push({ key, label, blurb, icon, list: [entity] })
  }
  for (const entity of visible) {
    if (entity.module) {
      const meta = MODULE_META[entity.module]
      push(entity.module, meta?.label ?? entity.module, meta?.blurb ?? '', meta?.icon ?? 'grid', entity)
      continue
    }
    const section = sections.find((candidate) => candidate.types.includes(entity.type))
    push(
      section?.key ?? 'core',
      section?.label ?? 'Core',
      section?.blurb ?? '',
      section?.key === 'money' ? 'money' : section?.key === 'plan' ? 'plan' : 'grid',
      entity
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <p className="kicker">Life</p>
          <h1>Everything Orbit keeps</h1>
          <p className="sub">
            Every kind of record Orbit holds, and how many of each you have. Life areas can be switched on and off;
            the rest are always here.
          </p>
        </div>
        <button className="btn" onClick={() => nav.go({ page: 'settings', section: 'modules' })}>
          <Icon name="settings" size={14} />
          Choose areas
        </button>
      </div>

      {Object.keys(counts).length === 0 && visible.length > 0 ? <Loading rows={4} label="Counting your records" /> : null}

      {groups.map((group) => {
        const held = group.list.reduce((total, entity) => total + (counts[entity.type] ?? 0), 0)
        return (
          <section key={group.key} style={{ marginBottom: 28 }}>
            <div className="section-head">
              <div>
                <h2>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon name={group.icon} size={16} />
                    {group.label}
                  </span>
                </h2>
                {group.blurb ? <p className="sub">{group.blurb}</p> : null}
              </div>
              {held > 0 ? (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {held} record{held === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <div className="grid three">
              {group.list.map((entity) => (
                <TypeCard key={entity.type} entity={entity} count={counts[entity.type] ?? 0} nav={nav} />
              ))}
            </div>
          </section>
        )
      })}

      {enabled.length === 0 ? (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <EmptyState
            icon="life"
            title="Choose what you want to keep track of"
            message="Orbit can look after a great deal. Start with two or three areas that matter now — you can add more at any time without losing anything."
            action={
              <button className="btn primary" onClick={() => nav.go({ page: 'settings', section: 'modules' })}>
                Choose your areas
              </button>
            }
          />
        </div>
      ) : null}
    </>
  )
}

function TypeCard({
  entity,
  count,
  nav
}: {
  entity: EntityDescriptor
  count: number
  nav: Navigator
}): ReactNode {
  // An index of eighty record types is mostly empty for everybody, always. The
  // tiles holding something are the ones worth seeing, so the empty ones step
  // back rather than being hidden — they still have to be reachable, because
  // reaching them is how they stop being empty.
  return (
    <button
      className={`card type-card${count > 0 ? ' has-records' : ''}`}
      onClick={() => nav.go({ page: 'life', type: entity.type })}
    >
      <span className="type-icon">
        <Icon name={iconForEntity(entity.icon)} size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{entity.plural}</b>
        <small>{count > 0 ? `${count} record${count === 1 ? '' : 's'}` : 'None yet'}</small>
      </span>
    </button>
  )
}
