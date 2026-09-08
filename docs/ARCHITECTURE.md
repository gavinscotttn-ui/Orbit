# Architecture

How Orbit is put together, and why it is put together that way. Aimed at
somebody who has to change it.

---

## The shape

```
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer  (Chromium, sandboxed, no Node, no network)                 │
│   React 19 · screens, forms, lists, detail views                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ window.orbit.invoke(channel, payload)
                     ┌──────────┴──────────┐
                     │ Preload             │  contextBridge, allow-list only
                     └──────────┬──────────┘
                                │ ipcRenderer.invoke('orbit:invoke', …)
┌───────────────────────────────┴──────────────────────────────────────┐
│ Main  (Node 24, the only process that touches disk)                  │
│   IPC router  → zod schema per channel, result envelopes             │
│   Services    → attention, search, attachments, settings, demo       │
│   Repository  → validated CRUD driven by entity descriptors          │
│   Database    → node:sqlite, WAL, migrations, backup API             │
│   Vault       → paths, lock, manifest, portable resolution           │
│   Security    → network block, CSP, permissions, navigation guards   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                     ┌──────────┴──────────┐
                     │ The vault folder    │  a folder the user chose
                     └─────────────────────┘
```

`src/shared/` is imported by **both** sides: domain logic (money, time,
recurrence, finance, CSV), the entity descriptors, the vault format constants,
and the IPC contract. It contains no Electron and no Node imports, which is what
makes it testable in plain vitest and reusable in the renderer.

| Directory | Responsibility |
| --- | --- |
| `src/shared/domain/` | Pure logic. No I/O. Fully unit tested. |
| `src/shared/contracts/` | Entity descriptors, field types, IPC channel names and payload types. |
| `src/main/db/` | Migrations, the database wrapper, the generic repository. |
| `src/main/vault/` | Paths, locking, the manifest, portable resolution, the vault manager. |
| `src/main/services/` | Attention engine, search, attachments, settings, life-event templates, demo data. |
| `src/main/ipc/` | The router and the handlers. The only place `handle()` is called. |
| `src/preload/` | The bridge. Three functions, nothing else. |
| `src/renderer/src/` | React. Knows nothing about SQLite, paths, or Electron. |

---

## The one idea that makes the breadth possible

Orbit covers vehicles, prescriptions, warranties, pets, mortgages, school terms
and seventy-odd other kinds of record. Writing seventy-nine bespoke screens is
not a plan, and a single untyped `records` table with a JSON blob is a database that
cannot be queried, constrained or migrated.

So: **one description drives everything.**

```ts
// src/shared/contracts/entities/life.ts (abridged, real code)
{
  type: 'asset',
  table: 'assets',
  label: 'Item',
  plural: 'Things',
  module: 'home',
  icon: 'box',
  titleField: 'name',
  dateField: 'warranty_ends_on',
  searchFields: ['name', 'make', 'model', 'identifier', 'location', 'notes'],
  defaultOrder: 'asset_type ASC, name COLLATE NOCASE ASC',
  costRollup: [
    { table: 'maintenance_records', foreignKey: 'asset_id', amountColumn: 'cost_minor', … },
    { table: 'fuel_logs', foreignKey: 'asset_id', amountColumn: 'cost_minor', … },
    { table: 'transactions', foreignKey: 'asset_id', amountColumn: 'amount_minor', … }
  ],
  fields: [
    f.text('name', 'Name', { required: true, span: 2, inList: true }),
    f.select('asset_type', 'Type', ['vehicle', 'appliance', 'device', …], { required: true }),
    f.money('purchase_price_minor', 'Paid', 'currency', { group: 'Ownership' }),
    f.date('warranty_ends_on', 'Warranty ends', { group: 'Ownership', inList: true }),
    f.ref('owner_person_id', 'Whose', 'person', { group: 'Ownership' }),
    …
  ]
}
```

From that single object Orbit derives:

* **the form** — field order, groups, spans, labels, required marks, validation
  messages (`RecordEditor.tsx`)
* **the list** — columns, sort, filters, search fields (`RecordList.tsx`)
* **the detail view** — overview, related records, costs, documents, history
  (`RecordDetail.tsx`)
* **main-process validation** — every incoming value coerced and checked against
  its declared type before it reaches SQL (`repository.ts`)
* **search indexing** — which fields go into FTS (`services/search.ts`)
* **CSV/JSON export** columns
* **the command palette** entries and quick-capture targets

There are **79 descriptors** across four files. The tables are still real SQL
tables with real columns, real foreign keys, real `CHECK` constraints and real
indexes, written by hand in the migrations. The descriptor describes the table;
it does not replace it. A test
(`tests/integration/records.test.ts`) asserts that **every descriptor field has
a matching column and every table is reachable** — so the two cannot drift apart
silently, which is the usual failure mode of this pattern.

The tradeoff is stated in [FEATURE-STATUS.md](FEATURE-STATUS.md): many areas are
marked **Records** rather than **Done**, meaning they are fully usable through
these generic screens but have no bespoke screen of their own. That is a working
feature with a plain interface, not a stub.

---

## Persistence: `node:sqlite`

Orbit uses **`node:sqlite`**, the SQLite binding built into the Node runtime
that ships inside Electron. Not better-sqlite3, not sql.js.

Why it matters:

* **No native module.** Nothing to compile, no node-gyp, no Python, no
  per-architecture prebuild to go missing, no `electron-rebuild` step. A macOS
  arm64 build and a Windows x64 build come from the same `npm install`. This is
  most of the reason cross-platform packaging here is uneventful.
* It is real SQLite (3.53.x) with **FTS5**, JSON1, the **online backup API** and
  WAL — everything Orbit needs.
* It is synchronous, which suits a single-user desktop application: no promise
  plumbing around every read, and transactions are ordinary code blocks.

The cost is honest too: `node:sqlite` has no encryption (see
[SECURITY.md](SECURITY.md) §6 — SQLCipher would reintroduce the native module),
and the API is younger than better-sqlite3's.

### The database wrapper

`src/main/db/database.ts` owns the pragmas (`journal_mode = WAL`,
`synchronous = NORMAL`, `foreign_keys = ON`, a busy timeout), nested
transactions via `SAVEPOINT`, the migration runner, `checkpoint('TRUNCATE')`,
`backupTo()` using SQLite's own backup API, and the integrity and foreign-key
checks.

Nested `transaction()` is genuinely nested: an inner call creates a savepoint
rather than a second `BEGIN`, so a service can wrap its work in a transaction
without needing to know whether its caller already did.

### Migrations

Ten numbered migration files, each a plain function, each recorded in the `meta`
table. Forwards only, and every one runs inside a transaction after a
**mandatory pre-migration backup**. `SCHEMA_VERSION` in `src/shared/vault.ts` is
the single source of truth; opening a vault whose schema is *newer* than the
running application produces a clear refusal rather than a partial read. See
[VAULT-FORMAT.md](VAULT-FORMAT.md).

---

## The IPC contract

One channel: `orbit:invoke`. 76 message names in a frozen allow-list
(`src/shared/contracts/ipc.ts`). Each name is registered exactly once with a zod
schema:

```ts
handle('records.create', z.object({ type: EntityType, values: z.record(z.unknown()) }), (payload) => …)
```

* The preload rejects a name that is not in the list, so an injected script
  cannot reach a handler that does not exist.
* The router validates the payload before the handler runs.
* Handlers return `{ ok: true, data }` or `{ ok: false, error }`. **Nothing
  throws across the boundary.** A database error becomes a sentence
  (`describeSqlError`) that the interface can show a person, rather than a stack
  trace or, worse, a promise that never settles.
* Events go the other way on a separate allow-list (`IPC_EVENTS`) —
  `vault.changed`, `vault.closed`, `records.changed`, `vault.warning`.

---

## Domain logic worth knowing about

### Money is integers

Every amount is an integer of minor units (`1234` = £12.34) with a currency code
beside it. There is no float arithmetic anywhere in the finance path.
`splitEvenly` and `splitByWeights` distribute remainder pennies deterministically
so that split amounts always sum back to the original — the classic
"£10 split three ways" bug is a test, not a hope. Currency conversion requires
an explicit, dated, attributed `ConversionNote`: Orbit has no network and will
not invent a rate.

### Dates and instants are different types

`CalendarDate` is a floating `YYYY-MM-DD` — a birthday, an MOT due date, a bill
date. It has no time and no zone, because those things do not have one.
`Instant` is an ISO UTC timestamp — when something actually happened.

`zonedToInstant` handles the two hours a year that break naive code: the
ambiguous hour when clocks go back (resolved to the **earlier** instant) and the
non-existent hour when they go forward (shifted **forward**). Both are tested,
across several zones.

### Recurrence

`src/shared/domain/recurrence.ts` expands rules over calendar dates, with two
distinct modes that are usually conflated:

* **fixed schedule** — "the 1st of every month", "every other Tuesday". The next
  occurrence does not care when you completed the last one.
* **completion-relative** — "6 weeks after I last did it". Bins, haircuts,
  servicing.

`addMonthsClamped` keeps an anchor day, so "the 31st" is 30 June and then 31
July again, rather than drifting to the 30th forever.

---

## The attention engine

`src/main/services/reminders.ts` is what fills **Today**. Roughly twenty sources
— bills due, MOT and insurance expiry, warranties running out, prescriptions,
birthdays, tasks, mileage-based servicing, people you have not contacted — each
wrapped so that one failing source cannot empty the screen.

The important design decision: **nothing is precomputed into a notifications
table.** Attention items are derived from the records every time Today is
opened. A stale notification table that disagrees with the data is worse than no
notification table, and there is no background process to keep one fresh —
Orbit has no daemon, and says so.

Bill occurrences are derived from the bill's schedule via `billOccurrences`,
cross-referenced against recorded payments, with a guard so that a bill you
added today does not immediately claim you missed six months of payments.

---

## Search

FTS5 with `unicode61 remove_diacritics 2`, fed by a queue table. Writes push row
ids onto `search_queue`; the indexer drains it. That keeps a large import from
blocking on index maintenance, and makes a full `rebuild()` a normal operation
rather than an emergency.

`toFtsQuery` quotes every token and adds a prefix wildcard to the last one, so a
user typing `o'brien halifax` gets sensible results instead of an FTS syntax
error.

---

## Attachments

Content-addressed: `attachments/<aa>/<bb>/<sha256>.<ext>`, with the original
filename stored as a column. Identical files stored twice occupy one file.
Writes go to a temporary name and are renamed into place, so an interrupted
write cannot leave a truncated file where a complete one should be. The link
between a record and an attachment is a row in `attachment_links`, so one
receipt can belong to a purchase, an expense and a vehicle at once without being
copied.

This is also a security measure — see [SECURITY.md](SECURITY.md) §5.

---

## The renderer

React 19, no state-management library, no router library, no component library,
no CSS framework. Application state is one small context
(`app/state.tsx`): which vault is open, the preferences, the descriptors, the
toast queue, and a revision counter that screens watch to know when to re-fetch.
Everything else is fetched by the screen that needs it, so no cache can go stale
behind the user's back.

Styling is three hand-written stylesheets: `tokens.css` (the palette and
spacing scale, light and dark), `base.css` (elements and controls) and
`shell.css` (layout, drawers, lists). Theme, density, text scale and
reduce-motion are all attributes on `<html>` set from one effect, so a single
source of truth drives every screen.

The layout follows the Amethyst prototype the project started from — see
[AMETHYST.md](AMETHYST.md).

---

## Processes and lifetimes

* One main process, one window. A second launch focuses the existing window
  (single-instance lock) rather than opening a second copy on the same vault.
* No background service, no scheduler, no tray agent. Orbit computes what needs
  attention when it is open, and this limitation is stated in the interface
  rather than implied away.
* Clean shutdown on quit, `SIGINT` and `SIGTERM`: checkpoint the WAL, mark the
  manifest as cleanly closed, release the lock.

---

## Testing

| Layer | Where | What it covers |
| --- | --- | --- |
| Unit | `tests/unit/` | Money, time and DST, recurrence, tax and finance, CSV both ways. Pure functions, no mocks. |
| Integration | `tests/integration/` | Real vaults on a real filesystem: create, migrate, move, back up, restore, lock, and every entity through the repository; plus the attention engine end to end. |
| End-to-end | `tests/e2e/smoke.mjs` | Playwright driving the **actually built** application under Electron: first run, creating a vault, the demo workflows, moving a vault on disk and reopening it, the command palette, search, and the network block. Writes 18 screenshots. |

Counts and — more importantly — what has **not** been tested are in
[FEATURE-STATUS.md](FEATURE-STATUS.md).

---

## Things deliberately not here

* **No ORM.** The descriptors and a small repository do the job; an ORM would
  hide the constraints that make the schema trustworthy.
* **No IPC code generation.** 76 hand-written schemas are readable; a generator
  would not be.
* **No plugin system.** A plugin API in an offline privacy-first application is
  a way to let arbitrary code near somebody's passport scans.
* **No auto-update, telemetry, or crash reporting.** See
  [SECURITY.md](SECURITY.md).
