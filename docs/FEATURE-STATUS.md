# Feature status

An honest account of what Orbit does today, section by section against the
specification. Nothing here is marked done because it compiles.

## What the marks mean

| Mark | Meaning |
| --- | --- |
| **Done** | Built, wired into the interface, and exercised by a test or the end-to-end run. |
| **Records** | Fully usable through the generic record screens: add, edit, list, filter, search, link to other records, attach files, see it in the connected detail view with its costs and history. What it lacks is a *bespoke* screen or derived logic of its own. This is a working feature, not a stub. |
| **Partial** | Some of it works. The note says which part. |
| **Not built** | No functionality. The database schema may exist; that is not the same thing. |
| **Deliberate** | Not built on purpose, with the reason. |

A word on **Records**. Orbit describes every record type once — its fields,
their types, which are required, what they reference — and that one description
drives the database constraints, the validation in the main process, the form,
the list columns and the detail view. So a "Records" feature genuinely works: you
can keep pet vaccinations, link them to the pet and the vet, attach the
certificate, search the lot and see it all on the pet's page. What it does not
have is, say, a vaccination calendar of its own.

---

## 1. Today and personal dashboard

| Feature | Status | Notes |
| --- | --- | --- |
| Daily agenda | **Done** | Events and tasks due today, in time order. |
| Priority tasks | **Done** | |
| Upcoming bills and renewals | **Done** | Derived from each bill's schedule, not a stored list. |
| Habit and routine check-ins | **Done** | Tick from Today; a second click undoes it. |
| Quick notes and capture | **Done** | Quick capture, plus pinned notes on Today. |
| "What needs my attention?" briefing | **Done** | 20 sources, ordered worst-first. 28 tests. |
| Overdue and upcoming items | **Done** | |
| Weekly administration review | **Done** | Three review cards: inbox, money owed, bills. |
| Forward view of expensive months | **Done** | Six months of committed bills, dearest month flagged. |
| Configurable dashboard widgets | **Partial** | The preference is stored and travels with the vault, but Today's layout is currently fixed. |
| Empty states and first-run guidance | **Done** | Every list and screen has one. |

## 2. Calendar, tasks and planning

| Feature | Status | Notes |
| --- | --- | --- |
| Month, week and agenda views | **Done** | |
| Day view | **Not built** | The agenda view covers the need; a single-day column does not yet exist. |
| Appointments and all-day events | **Done** | |
| Recurring events and tasks | **Done** | Daily/weekly/monthly/yearly, intervals, by-weekday, by-month-day, nth weekday, last day, count, until, exceptions, weekend adjustment. 23 tests. |
| Time blocking | **Partial** | A `timeblock` event kind exists and shows on the calendar; there is no drag-to-block interaction. |
| Subtasks and checklists | **Partial** | The schema supports parent/child tasks; the interface has no nesting yet. |
| Project plans | **Done** | Projects, goals and milestones, with tasks rolled up. |
| Deadlines and preparation reminders | **Done** | Preparation and travel minutes are stored and counted in the workload view. |
| Start-by reminders including travel time | **Partial** | Recorded and used for workload; not yet emitted as a separate reminder. |
| Task dependencies | **Not built** | Schema and unique index exist; no interface. |
| Waiting-on list | **Done** | Replies, deliveries, refunds, decisions and payments, on Today. |
| Completion-relative recurrence | **Done** | "Six weeks after I last did it." Engine, interface toggle and tests. |
| Bulk rescheduling | **Partial** | The `tasks.reschedule` message works and is validated; no interface for it. |
| Effort and energy labels | **Done** | |
| Assisted task breakdown | **Not built** | Would need the optional AI adapter, which is not built. |
| Focus sessions | **Not built** | Schema only. |
| Birthday and anniversary reminders | **Done** | Rolls forward correctly, including 29 February. |
| Workload and overcommitment warnings | **Done** | Committed time plus estimates per day, flagged over six hours. |
| Time zone and daylight-saving correctness | **Done** | Including the hour that repeats and the hour that does not exist. 19 tests. |
| Shared-calendar architecture | **Partial** | A `calendars` table with a source and external reference exists as the seam. No provider integration; see §20. |
| Calendar import/export | **Not built** | No ICS reader or writer yet. |

## 3. Personal finance (built on Amethyst)

| Feature | Status | Notes |
| --- | --- | --- |
| Accounts and balances | **Done** | Opening balance plus movement; no bank connection. |
| Transaction import | **Done** | CSV with column detection, date-format handling, a preview and duplicate detection. |
| Categorisation | **Partial** | Categories exist and are applied by hand; there is no rule engine. |
| Reconciliation | **Partial** | A cleared flag and a reconciled timestamp; no reconciliation screen. |
| Income and spending analysis | **Done** | Six-month cashflow and spend by category. |
| Budgets | **Done** | Per-category monthly limits with progress and overspend. |
| Savings pots | **Records** | |
| Debt tracking and repayment scenarios | **Done** | Snowball and avalanche, with the interest model stated. |
| Bill forecasts | **Done** | |
| Payday planning | **Done** | Next six paydays, month-end clamped. |
| Irregular-income planning | **Partial** | A flag on the pay profile; no range modelling. |
| Annual-expense sinking funds | **Partial** | The calculation and the record type exist; no dedicated screen. |
| Savings goals | **Records** | |
| Net worth | **Done** | Flags mixed currencies and stale valuations rather than quietly summing them. |
| Pension and investment overview | **Records** | Holdings feed net worth. |
| Personal finance assistance | **Not built** | Would need the optional AI adapter. |
| Money lent and borrowed | **Done** | One ledger, both directions, with outstanding balance and overdue test. |
| Shared expenses and bill splitting | **Partial** | Penny-exact splitting by shares is implemented and tested; there is no splitting interface. |
| Reimbursements and work expenses | **Done** | |
| Refunds awaiting payment | **Done** | Chased from Today after 14 days. |
| Purchase wish lists and cooling-off | **Done** | |
| Repeat-purchase price history | **Partial** | Product-key matching and the table exist; no history screen. |
| Tax document organisation | **Done** | Via document types and tax-year fields. |
| Charitable donation records | **Records** | With a Gift Aid flag. |
| Event-linked planned costs | **Done** | Transactions link to projects and trips; totals roll up. |
| Actual / planned / forecast separation | **Done** | Enforced in the schema and never mixed in a total. |
| Currency-aware amounts | **Done** | Integer minor units throughout. 19 tests. |
| Exchange-rate dates stated | **Done** | Conversion requires a dated, attributed rate. Orbit never invents one. |
| No fabricated balances or advice | **Done** | |

## 4. Bills, subscriptions and contracts

| Feature | Status | Notes |
| --- | --- | --- |
| Recurring bills | **Done** | |
| Monthly and annual commitments | **Done** | |
| Free-trial expiry | **Done** | Warned before it starts charging. |
| Contract end and notice periods | **Done** | Counts back to when notice must be *given*, not when it ends. |
| Renewal reminders | **Done** | |
| Price-change history | **Records** | Table exists; no timeline view. |
| Cancellation records | **Done** | Date and reference on the bill. |
| Membership usage vs cost | **Partial** | A usage target and a usage log exist; the cost-per-visit view does not. |
| Policy and supplier comparison notes | **Records** | Quotes, comparable side by side in a list. |
| Links to transactions and documents | **Done** | |

## 5. Receipts, purchases and consumer admin

| Feature | Status | Notes |
| --- | --- | --- |
| Receipt capture | **Done** | Drag onto the inbox or a record. |
| OCR | **Deliberate** | No OCR engine is bundled, so Orbit does not claim to read a photograph. Plain-text and CSV attachments *are* indexed. |
| Searchable purchase history | **Done** | |
| Proof of ownership | **Done** | |
| Warranty periods | **Done** | |
| Return deadlines and workflow | **Done** | Planned → sent → received → refunded, as distinct states. |
| Return labels and drop-off | **Done** | Label attached to the return; drop-off as a task. |
| Refund confirmation | **Done** | **A return sent is never a refund received.** Separate fields, separate states, and a test that says so. |
| Parcel tracking | **Partial** | Manual only, and the interface says so. No carrier integration. |
| Gift cards and vouchers | **Done** | Expiry warned about. |
| Loyalty rewards and expiry | **Records** | Same record type. |
| Purchase-to-transaction matching | **Partial** | The link exists and can be set by hand; there is no suggestion engine. |
| Complaint correspondence | **Done** | With promised-reply and escalation dates on Today. |
| Quote comparison | **Records** | |
| Product-recall matching | **Not built** | Would need a real recall data source. Orbit will not invent one. |
| Family clothing sizes | **Records** | |

## 6. Vehicles and transport

| Feature | Status | Notes |
| --- | --- | --- |
| Multiple vehicles | **Done** | |
| MOT, servicing, road tax | **Done** | As maintenance schedules and bills — nothing UK-specific is baked in. |
| Insurance and breakdown cover | **Done** | Policy types. |
| Mileage | **Done** | |
| Fuel and EV charging | **Done** | Litres, gallons or kWh. |
| Repairs, tyres, maintenance history | **Done** | |
| Parking permits and tickets | **Records** | Expiry warned about. |
| Parking location | **Records** | |
| Vehicle finance | **Partial** | As an account or bill linked to the vehicle; no bespoke screen. |
| Total ownership costs | **Done** | Servicing, fuel and linked transactions on one screen. |
| Service reminders by date **or mileage** | **Done** | Mileage compared against the latest odometer reading. |
| Breakdown/accident document pack | **Partial** | The emergency-pack flag exists; there is no assembled pack view. |
| Commute plans and costs | **Not built** | |

## 7. Home and possessions

| Feature | Status | Notes |
| --- | --- | --- |
| Rent/mortgage records | **Records** | As accounts and bills. |
| Utilities and meter readings | **Done** | |
| Appliance inventory and manuals | **Done** | Manuals as attachments. |
| Cleaning and household routines | **Records** | Chores and care routines with schedules. |
| Renovations and home projects | **Records** | As projects, with a budget and cost rollup. |
| Boiler, gutter, chimney maintenance | **Done** | Including "six weeks after completion" scheduling. |
| Smoke/CO alarm and safety checks | **Done** | |
| Consumable replacement schedules | **Done** | |
| Paint colours, dimensions, decorating | **Records** | |
| Trusted tradespeople, quotes, invoices | **Records** | |
| Repair history | **Done** | |
| Repair-versus-replacement planning | **Not built** | |
| Borrowed and lent possessions | **Records** | |
| Storage locations and box inventories | **Records** | |
| Decluttering, donations, resale | **Records** | |
| Garden schedules | **Records** | As chores. |
| Smart-home integration | **Deliberate** | Would require network access, which Orbit does not have. |
| Home contents documentation | **Done** | Assets with values, photographs and receipts. |

## 8. Documents and insurance

| Feature | Status | Notes |
| --- | --- | --- |
| Searchable document vault | **Done** | |
| Tags, metadata, linked records | **Partial** | Tags are stored and searched; there is no tag-management interface. |
| Policy periods, excesses, cover summaries | **Done** | Cover summary is entered by the user; Orbit does not read a policy and decide what you are covered for. |
| Insurance claims and correspondence | **Records** | |
| Passports, licences, certificates | **Done** | |
| Expiry and renewal dates | **Done** | |
| Version history | **Partial** | `document_versions` exists; no interface for it. |
| Emergency document pack | **Partial** | Documents can be flagged; there is no pack view or export. |
| Offline access | **Done** | Everything is offline. |
| Secure viewing and deliberate export | **Done** | Previewed in-app from bytes; export is an explicit action with a native dialog. |

## 9. Health and wellbeing

| Feature | Status | Notes |
| --- | --- | --- |
| Appointments | **Records** | Next-due dates surface on Today. |
| Medication reminders | **Records** | With a schedule. |
| Prescription refill reminders | **Done** | |
| Symptom notes | **Records** | |
| Dental and eye checks | **Done** | Via next-due dates. |
| Exercise and sleep logs | **Records** | As measurements. |
| Personal health goals | **Records** | As projects. |
| Mood and reflection journal | **Records** | |
| No diagnosis, no dose changes | **Done** | There is no field for a diagnosis Orbit produced, because it does not produce one. |
| Limitations stated | **Done** | On Today and in Settings. |

## 10. Family, household and care

| Feature | Status | Notes |
| --- | --- | --- |
| Household member records | **Done** | |
| Shopping lists and chores | **Records** | |
| School dates, clubs, permission slips, payments | **Records** | Deadlines surface on Today. |
| Uniform needs | **Records** | |
| Childcare schedules | **Records** | |
| Emergency contacts | **Records** | |
| Care visits, appointments, supplies | **Records** | |
| Assigned responsibilities | **Done** | A label, and the interface says plainly it grants no access. |
| Household budgets | **Done** | |
| Pocket money and agreed chores | **Records** | |
| Children's milestones and keepsakes | **Records** | |
| Sitter and handover notes | **Records** | Care routines carry a handover flag. |
| Private and shared areas with permissions | **Not built** | Requires multi-user identity. See §20. |

## 11. Pets

All **Records**: profiles, vaccinations, vet appointments, medication, insurance,
food subscriptions (as bills), microchip details, care routines, sitter
instructions, linked expenses and documents. Next-due dates surface on Today,
and costs roll up onto the pet.

## 12. Food and shopping

All **Records**: meal planning, pantry and freezer inventory, shopping lists,
recipes, meal cost estimates, dietary preferences, reusable list templates.
**Food expiry reminders** are **Done** — they surface on Today.

## 13. Work and learning

All **Records**: shift rota, overtime, leave allowance and requests,
qualifications, professional memberships, continuing education hours, courses,
CV entries, job applications with follow-up dates. **Expected-pay estimates** are
**Done**, with every assumption shown beside the figure. Qualification and
membership expiry surface on Today.

## 14. Travel

All **Records**: trips, bookings, budgets, packing lists, travel insurance,
preparation tasks, event tickets, post-trip administration. **Travel credit
expiry** is **Done**. **Passport-expiry checks** work through document expiry
rather than a travel-specific check. **Shared responsibilities and expenses** are
**Partial** — costs can be split and recorded, but there is no per-trip
settlement view.

## 15. Relationships, occasions and memories

| Feature | Status | Notes |
| --- | --- | --- |
| Birthdays and anniversaries | **Done** | |
| Gift ideas and budgets | **Records** | |
| Catch-up reminders | **Done** | From a cadence and the last contact date. Stays quiet if there is nothing to count from. |
| Preferences people share | **Records** | On the person record. |
| Event planning, proposed dates, RSVPs | **Records** | |
| Food contributions and costs | **Records** | |
| Memory journal | **Records** | With photographs. |
| Never messages contacts automatically | **Done** | Orbit cannot send anything. It has no network access. |

## 16. Goals, hobbies and community

All **Records**: personal goals and milestones, bucket lists, reading lists,
hobby projects with materials and costs, equipment maintenance, collections and
custom inventories, volunteer shifts, training and expenses. Goals use the same
project machinery, so a goal has tasks, a budget and a cost rollup.

## 17. Life events

**Done.** Seven editable templates — moving house, getting married, having a
baby, changing jobs, starting a course, buying a vehicle, retiring. Each is
anchored to one date you choose, every task moves with it, and **you see exactly
what would be created and untick anything that does not apply before a single
record is written.** Documents and budget lines come with each template.

## 18. Digital life

All **Records**: device inventory, backup reminders (**Done** — they surface on
Today), domain renewals (**Done**), account inventory, recovery instructions.

**No password vault, deliberately.** The online-account record has no password
field, no secret field and no encrypted blob. It records *where* your
credentials live so you can find them. Building an improvised password manager
inside a personal-admin app would be irresponsible.

## 19. Capture, search and automation

| Feature | Status | Notes |
| --- | --- | --- |
| Universal inbox | **Done** | Text and files. |
| Drag-and-drop capture | **Done** | Onto the inbox or any record. |
| Voice notes | **Not built** | Audio files can be attached; there is no recorder. |
| Suggested dates, amounts and record types | **Done** | Local pattern matching. Every suggestion says *why* it was made. |
| Review before applying | **Done** | Nothing is filed until confirmed in a real form. |
| Global search | **Done** | FTS5 across every record type, plus attachment filenames and the text of plain-text and CSV attachments. |
| Filters and saved views | **Partial** | Type filters work in search; saved views are schema only. |
| Natural-language retrieval ("Ask Orbit") | **Not built** | Needs the AI adapter. The setting exists, is off, and says plainly that it does nothing yet. |
| Optional local or remote AI adapters | **Not built** | No adapter is implemented. Core features never depended on one. |
| Automation rules with preview and history | **Not built** | Schema for rules and run history exists; there is no engine. |
| Completion evidence | **Done** | Photographs and receipts attach to any record. |
| Location-based reminders | **Deliberate** | Would require location permission, which Orbit denies. |
| Email ingestion | **Not built** | `.eml` files can be attached; there is no mailbox integration. |

## 20. Sharing and history

| Feature | Status | Notes |
| --- | --- | --- |
| Audit and change history | **Done** | Every create, update and delete, with a before-snapshot. |
| Restore earlier information | **Done** | Undo a delete, or restore an earlier version of a record. |
| Selected sharing with partners or carers | **Not built** | |
| Record-level or space-level permissions | **Not built** | |
| Conflict handling for synchronisation | **Not built** | |
| "Person assigned" is not authorisation | **Done** | Stated in the interface, not just here. |

**Orbit does not claim collaboration works, because it does not.** Sharing needs
identity, transport, permissions and conflict resolution, and none of the four
exists. What does exist is the groundwork that does not preclude it: every record
has a stable id and a full change history, and the database ships with SQLite's
session extension available.

---

## Cross-cutting

| Area | Status | Notes |
| --- | --- | --- |
| Portable vault | **Done** | Move it anywhere, across platforms. Tested by physically moving one. |
| Backups | **Done** | SQLite online backup API; automatic before every upgrade and restore. |
| Restore | **Done** | Verified equal to the original by test. |
| Vault integrity check | **Done** | Database, foreign keys, attachment presence, size and full checksum. |
| Versioned migrations | **Done** | Backup first, transactional, foreign-key checked. |
| Refusing a newer vault | **Done** | Plain message, nothing changed. |
| Interrupted-write recovery | **Done** | WAL, clean-shutdown flag, atomic attachment writes. |
| Concurrent access protection | **Done** | Lock file with heartbeat and deliberate takeover. |
| Encrypted vault | **Not built** | Designed and documented; not implemented, and never claimed. See [SECURITY.md](SECURITY.md). |
| Automatic locking | **Done** | Per-device setting; closes the vault after inactivity. Because there is no passphrase it hides and releases rather than encrypting, and the setting says so. |
| Export without lock-in | **Done** | CSV or JSON per record type, plus the whole vault as a folder. CSV export is guarded against spreadsheet formula injection. |
| Sanitised imports | **Done** | CSV only (OFX/QIF are stored, not parsed), preview before commit, duplicate detection, no formula evaluation. |
| No network access | **Done** | Enforced at the session level and verified by the end-to-end run. |
| Light and dark themes | **Done** | Both defined explicitly. |
| Keyboard shortcuts and command palette | **Done** | |
| Accessible focus, labels, large text, reduced motion | **Done** | |
| Undo | **Partial** | Deletes and record versions can be undone. There is no general undo stack. |
| Autosave with visible state | **Partial** | Saving state is shown in the top bar; forms save on an explicit action rather than continuously. |
| No dead buttons or fake integrations | **Done** | Every control does something, and anything unimplemented says so rather than pretending. |
| Demonstration data isolated | **Done** | Its own vault, flagged in the manifest, permanent banner, and refuses to seed a real vault. |

---

## Testing

| | |
| --- | --- |
| Unit and integration tests | **176 passing** |
| End-to-end checks against the running application | **55 passing** |
| Platforms actually tested | **Linux only** — see below |

**What has not been tested, and this matters.** All development and testing was
done on Linux. The macOS and Windows behaviours — the .app bundle layout, code
signing, notarisation, Gatekeeper quarantine, the NSIS installer, the Windows
portable executable, drive letters and UNC paths — are **configured but
unverified**. The cross-platform *path* logic is tested with adversarial inputs
(Windows reserved names, drive-absolute paths, UNC paths, decomposed and
composed Unicode, over-long names), but a simulated path test is not the same as
running on Windows, and this document will not pretend otherwise.

See [PACKAGING.md](PACKAGING.md) for exactly what needs checking on a real
machine of each kind.

---

## Outstanding dependencies

Things that are not bugs and not oversights, but do need a decision or an
outside input before they can be closed.

| Dependency | What it blocks | Detail |
| --- | --- | --- |
| **Current tax-year rates** | Payroll estimates being right for the year you are in | The built-in table holds **2025/26** UK rates, labelled as such, and every calculation states that assumption next to the figure. Orbit has no network and will not invent rates, so adding a year is a deliberate code change: one entry in `TAX_YEARS`, checked against HMRC's published thresholds by a person. Asking for a year that is not in the table now says so explicitly. See [AMETHYST.md](AMETHYST.md) §4. |
| **Apple Developer credentials** | Signed and notarised macOS builds | Without them macOS quarantines the app. [PACKAGING.md](PACKAGING.md) §5. |
| **A Windows code-signing certificate** | SmartScreen not warning | Same story. [PACKAGING.md](PACKAGING.md) §5. |
| **Application icon artwork** | The dock/taskbar icon | `build/icon.icns` and `build/icon.ico` are picked up with no config change; a placeholder was not shipped. [PACKAGING.md](PACKAGING.md) §6. |
| **A real macOS machine and a real Windows machine** | Everything in [PACKAGING.md](PACKAGING.md) §9 | The single largest gap in this project's testing, and the reason "Platforms actually tested" says Linux. |
| **SQLCipher, if encryption is wanted** | An encrypted vault | It is a native module, which reintroduces the per-architecture build problem that `node:sqlite` currently removes. That trade-off is a decision, not an omission. [SECURITY.md](SECURITY.md) §6. |
| **A real Amethyst backup file** | An Amethyst data importer | The mapping is straightforward; writing an importer that has never been run against a real export would be a feature that only appears to exist. [AMETHYST.md](AMETHYST.md) §5. |
