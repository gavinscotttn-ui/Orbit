# Amethyst Money → Orbit's finance module

The finance side of Orbit is not a fresh guess. It is built on the **Amethyst
Money** prototype supplied with the brief: a single 209 KB HTML file, a
complete working personal-finance application in its own right, with a
genuinely good UK payroll engine inside it.

This document records what was inspected, what was carried over, what was
changed and why, and what was deliberately left behind — so that nobody has to
diff a minified single-file app against a TypeScript project to find out.

---

## 1. What Amethyst was

A self-contained browser application. No build step, no server, no dependencies.

* **Storage**: everything in `localStorage` under one key, as JSON, with a
  `sanitiseVault()` pass on load.
* **Lock**: a four-digit PIN, hashed with PBKDF2-SHA-256 at 120,000 iterations
  and a random 16-byte salt, plus an inactivity auto-lock.
* **Sections** (its left-hand nav, in order): Overview · Transactions ·
  Budgets · Bills & reminders · Owed to you · You owe · Payday & tax ·
  Documents · Reports · Calculator · Money tools · Settings.
* **"Jack"**: an in-app assistant panel. Entirely local — pattern matching over
  the user's own records, with canned suggestions. No network calls anywhere in
  the file.
* **Money**: integer pence throughout, formatted at the edges. Genuinely
  correct, and unusual for a prototype.
* **Documents**: stored in IndexedDB, up to 15 MB each.
* **Export**: XLSX and CSV out, CSV in, JSON backup and restore.

It is a good piece of work, and the honest summary is that its **logic** was
worth keeping and its **storage model** was the thing that could not survive
contact with the requirement for a portable, multi-gigabyte, cross-platform
vault.

---

## 2. What was carried over

### The payroll and tax engine — the crown jewels

Amethyst's `payrollCalc`, `bandTax`, `taxCodeInfo`, `nextPaydays`,
`addMonthsClamped` and `paydayStep` were read closely and re-implemented in
[`src/shared/domain/finance.ts`](../src/shared/domain/finance.ts) and
[`src/shared/domain/time.ts`](../src/shared/domain/time.ts). The behaviour that
was preserved, item by item:

| Behaviour | Kept |
| --- | --- |
| Banded income tax measured from £0 of *taxable* pay | Yes — `bandedTax` |
| Separate rUK and Scottish band tables (six Scottish bands, 48% top rate) | Yes |
| Personal-allowance taper: £1 lost per £2 above £100,000 | Yes |
| Tax codes: `BR`, `D0`, `D1`, `NT`, `0T`, `K` codes, `S`/`C` prefixes | Yes — `parseTaxCode`, extended (Amethyst did not handle `NT` or `0T`) |
| Pension methods: salary sacrifice, net pay, none | Yes, **plus relief-at-source**, which Amethyst lacked |
| Salary sacrifice reduces both taxable pay and NI; net pay reduces only taxable pay | Yes — this distinction is easy to get wrong and Amethyst had it right |
| NI categories A / B / C / J with main and upper rates | Yes |
| Employer NI, shown but not deducted | Yes |
| Student loan plans 1, 2, 4, 5 and the postgraduate loan | Yes |
| Pay frequencies: monthly, 4-weekly, fortnightly, weekly, annual | Yes |
| Payday projection with a clamped monthly anchor day | Yes — `addMonthsClamped`, now with tests |
| "Add net pay to my income" as one action | Yes |

### The financial concepts

* **Owed to you / You owe** — Amethyst's loan and debt tracking, including
  `loanOutstanding`, `debtOutstanding`, repayment history, overdue detection and
  its `contactLateStats` "how reliably does this person repay" idea. In Orbit
  these are records with proper foreign keys to `people`, and the lateness
  scoring became `latenessProfile` and `projectSettlement`.
* **Budgets** with per-category spend against a limit → `budgetProgress`.
* **Bills & reminders** with a paid/unpaid state per period → `billOccurrences`
  and `billPeriodKey`, now derived from a recurrence rule rather than a single
  monthly assumption.
* **Cashflow over time** (`cashflowSeries`) → `cashflowByMonth`.
* **Category spending** → the same, backed by SQL rather than an in-memory sum.
* **Debt repayment planning** — snowball and avalanche → `planRepayment`.
* **CSV import of a bank statement**, with column guessing → the import preview
  in Orbit's Money module, extended with duplicate detection.

### The interface

The specification said to pinch Amethyst's layout, and Orbit does:

* the fixed left sidebar with small-caps section headings and icon + label rows
* the page header with a title, a subtitle, today's date in small caps, and a
  single primary action on the right
* cards ("panels") with a head/body split, a heading and a quiet sub-line
* the two-column form grid with `.field` labels above inputs
* the modal shape: kicker, title, close button, body, right-aligned actions
* small-caps micro-labels above bold figures for statistics
* the accent-tinted status chips (green/amber/red with matching tinted
  backgrounds)
* the token names themselves — `--ink`, `--muted`, `--panel`, `--line`,
  `--radius-*`, `--shadow` — survive in
  [`tokens.css`](../src/renderer/src/styles/tokens.css)

Orbit's palette moves from Amethyst's purple to Orbit's own, adds a genuine
dark theme (Amethyst had a `theme` preference but a light-first palette), and
adds density, text-scale and reduce-motion controls.

---

## 3. What was changed, and why

| Amethyst | Orbit | Why |
| --- | --- | --- |
| `localStorage` JSON blob | SQLite in a user-chosen folder | A `localStorage` quota is typically 5–10 MB, it is per-browser-profile, it cannot be moved, and it is silently wiped by "clear site data". The brief requires a portable vault with attachments. |
| IndexedDB for documents, 15 MB cap | Content-addressed files inside the vault | Attachments must travel with the vault and be verifiable. |
| A four-digit PIN hashed with PBKDF2 | Auto-lock only, and **no claim of encryption** | Four digits is 10,000 possibilities, and the data it guarded was sitting in plain `localStorage` next to it — the PIN hid the screen, not the data. Rather than reproduce a lock that implies protection it cannot give, Orbit states plainly that the vault is unencrypted and points at FileVault/BitLocker. See [SECURITY.md](SECURITY.md) §6–7. |
| Floating-point pounds inside `payrollCalc`, rounded to pence at the edges | Integer minor units all the way through | Amethyst was already integer-pence for *transactions*; the payroll engine worked in decimal pounds and rounded on display. Orbit's `scaleMinor` rounds half away from zero at each step, so the annual figures and the per-period figures reconcile. |
| `new Date()` arithmetic with a midday fudge (`T12:00:00`) to dodge DST | `CalendarDate` and `Instant` as separate types | The midday trick works and is a sensible hack for a prototype; it is not a foundation. Orbit separates floating dates from instants and handles the ambiguous and non-existent hours explicitly. |
| Hard-coded `£` and `en-GB` | `SUPPORTED_CURRENCIES`, locale and date-format settings | Amethyst was a UK-only tool by design. |
| Monthly-only bills | A full recurrence engine | "Every 4 weeks" and "the last working day of the quarter" are real bills. |
| One flat `state` object | 79 typed entities with foreign keys, checks and indexes | The rest of Orbit — a receipt linked to a purchase linked to a warranty linked to a task — is not expressible in a JSON blob. |
| `<a target="_blank">` links to gov.uk for rate sources | Sources named in text; links go through the confirmed external-link handler | Orbit has no network and does not open browsers by itself. |
| "Jack" assistant panel | Not carried over | It was local pattern-matching, which is fine, but a chat affordance implies more than pattern-matching delivers. Orbit's equivalent is the command palette and the attention engine, which do a narrower thing honestly. See [FEATURE-STATUS.md](FEATURE-STATUS.md) §19. |
| XLSX export | CSV and JSON export | XLSX would mean a spreadsheet-writing dependency. CSV opens in Excel, Numbers and LibreOffice, and the export is now guarded against formula injection — see [SECURITY.md](SECURITY.md) §11. |
| Built-in calculator page | Not carried over | Every operating system ships one. |

---

## 4. The tax-year caveat, stated plainly

Amethyst's payday screen carried a badge reading **"UK TAX YEAR 2026/27"**. The
numbers underneath it are the **2025/26** figures — £12,570 personal allowance,
the 2025/26 Scottish bands, employer NI at 15% above £5,000, plan-5 student
loans at £25,000.

Orbit therefore labels that rate table **`2025-26`**, because that is what it
is, and `calculatePayroll` returns `Based on 2025/26 UK rates` as the first line
of its assumptions, shown next to the figures.

**This means the built-in rates are not the current tax year.** Orbit has no
network and will not invent rates it has not been given, so adding 2026/27 is a
deliberate code change: one new entry in `TAX_YEARS` in
[`finance.ts`](../src/shared/domain/finance.ts), checked against HMRC's
published thresholds by a person. Asking for a tax year that is not in the table
now produces an explicit assumption line saying which rates were actually used
and why. This is listed as an outstanding dependency in
[FEATURE-STATUS.md](FEATURE-STATUS.md).

---

## 5. What was *not* migrated: data

There is **no importer for an Amethyst `localStorage` backup**, and none is
implied anywhere in the interface. Amethyst's JSON backup file is a documented,
readable shape and writing one would be straightforward — but an importer that
has never been run against a real export is a feature that only appears to
exist. If somebody with a real Amethyst backup wants one, it is a contained
piece of work: read the JSON, map `transactions`, `budgets`, `bills`, `loans`,
`debts`, `contacts` and `payroll` onto the corresponding Orbit records, and run
it through the same preview-then-commit path as the CSV importer.

In the meantime, Amethyst's own CSV export (Date, Type, Description, Category,
Amount, Notes) is readable by Orbit's statement importer, which covers
transactions — the bulk of what most people would have.
