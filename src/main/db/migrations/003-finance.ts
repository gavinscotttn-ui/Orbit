import type { Migration } from '../types.js'

/**
 * Migration 3 — personal finance.
 *
 * This is the Amethyst Money data model, adapted rather than transplanted.
 * What is carried over deliberately:
 *   - Amounts as INTEGER minor units (Amethyst stored pence; Orbit generalises
 *     this to any currency's minor unit with an explicit exponent).
 *   - Budgets as a per-category limit for a period.
 *   - Bills anchored to a day of the month, with "paid this month" tracking.
 *   - Money lent and money borrowed, each with a repayment ledger, an
 *     outstanding balance and an overdue test.
 *   - The UK payroll model: tax code, region, NI category, pension type,
 *     student loan plan, and pay frequency.
 *
 * What is changed, and why:
 *   - Amethyst tracked "bill paid this month" by writing a magic string into a
 *     transaction's notes field (`Recurring bill:<id>:<YYYY-MM>`). That is
 *     fragile — a user editing the note silently unpays the bill. Orbit uses a
 *     real `bill_payments` table with a unique key per period.
 *   - Amethyst had two near-identical tables for loans and debts. Orbit has one
 *     `money_agreements` table with a `direction`, which halves the code and
 *     makes "who owes whom, net" a single query.
 *   - Transactions carry a `status` of actual / planned / forecast, so a
 *     projection can never be mistaken for a real balance.
 *   - Every foreign-currency amount records the rate, the DATE of the rate and
 *     its source. Orbit never invents an exchange rate.
 */
export const migration003: Migration = {
  version: 3,
  name: 'finance',
  sql: `
CREATE TABLE accounts (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'current'
                         CHECK (kind IN ('current','savings','credit-card','loan','mortgage','cash','investment','pension','other')),
  institution            TEXT NOT NULL DEFAULT '',
  currency               TEXT NOT NULL,
  opening_balance_minor  INTEGER NOT NULL DEFAULT 0,
  opening_balance_date   TEXT,
  credit_limit_minor     INTEGER,
  interest_rate_bp       INTEGER,
  include_in_net_worth   INTEGER NOT NULL DEFAULT 1 CHECK (include_in_net_worth IN (0,1)),
  owner_person_id        TEXT REFERENCES people(id) ON DELETE SET NULL,
  notes                  TEXT NOT NULL DEFAULT '',
  sort_order             INTEGER NOT NULL DEFAULT 0,
  archived_at            TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX ix_accounts_kind ON accounts(kind, archived_at);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'expense'
              CHECK (kind IN ('income','expense','transfer')),
  colour      TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '',
  system      INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_categories_kind ON categories(kind, archived_at);

CREATE TABLE transactions (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  payee                 TEXT NOT NULL DEFAULT '',
  -- Signed: money out is negative. Sign and kind are kept consistent by the
  -- repository layer so that SUM(amount_minor) is always meaningful.
  amount_minor          INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  kind                  TEXT NOT NULL
                        CHECK (kind IN ('income','expense','transfer')),
  status                TEXT NOT NULL DEFAULT 'actual'
                        CHECK (status IN ('actual','planned','forecast')),
  category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
  cleared               INTEGER NOT NULL DEFAULT 0 CHECK (cleared IN (0,1)),
  reconciled_at         TEXT,
  notes                 TEXT NOT NULL DEFAULT '',

  transfer_group_id     TEXT NOT NULL DEFAULT '',
  bill_id               TEXT,
  bill_period           TEXT NOT NULL DEFAULT '',
  purchase_id           TEXT,
  trip_id               TEXT,
  asset_id              TEXT,
  project_id            TEXT REFERENCES projects(id) ON DELETE SET NULL,
  person_id             TEXT REFERENCES people(id) ON DELETE SET NULL,

  -- Import provenance and de-duplication.
  import_hash           TEXT NOT NULL DEFAULT '',
  import_batch_id       TEXT NOT NULL DEFAULT '',

  -- Foreign currency: always dated, always attributed, never guessed.
  original_amount_minor INTEGER,
  original_currency     TEXT NOT NULL DEFAULT '',
  fx_rate               REAL,
  fx_rate_date          TEXT,
  fx_source             TEXT NOT NULL DEFAULT '',

  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_transactions_account_date ON transactions(account_id, date);
CREATE INDEX ix_transactions_date ON transactions(date);
CREATE INDEX ix_transactions_category ON transactions(category_id, date);
CREATE INDEX ix_transactions_status ON transactions(status, date);
CREATE INDEX ix_transactions_bill ON transactions(bill_id, bill_period);
CREATE INDEX ix_transactions_purchase ON transactions(purchase_id);
CREATE INDEX ix_transactions_transfer ON transactions(transfer_group_id);
CREATE UNIQUE INDEX ux_transactions_import ON transactions(account_id, import_hash)
  WHERE import_hash <> '';

CREATE TABLE budgets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  period      TEXT NOT NULL DEFAULT 'monthly'
              CHECK (period IN ('weekly','monthly','annual')),
  limit_minor INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL,
  rollover    INTEGER NOT NULL DEFAULT 0 CHECK (rollover IN (0,1)),
  starts_on   TEXT,
  ends_on     TEXT,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_budgets_category_period ON budgets(category_id, period)
  WHERE archived_at IS NULL;

CREATE TABLE bills (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'bill'
                         CHECK (kind IN ('bill','subscription','contract','membership','insurance','loan','other')),
  provider_person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  category_id            TEXT REFERENCES categories(id) ON DELETE SET NULL,
  account_id             TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  amount_minor           INTEGER NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL,
  amount_varies          INTEGER NOT NULL DEFAULT 0 CHECK (amount_varies IN (0,1)),
  cadence                TEXT NOT NULL DEFAULT '',
  anchor_date            TEXT NOT NULL,
  due_day                INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  payment_method         TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','cancelled','ended')),
  trial_ends_on          TEXT,
  contract_ends_on       TEXT,
  notice_period_days     INTEGER NOT NULL DEFAULT 0,
  renewal_date           TEXT,
  auto_renews            INTEGER NOT NULL DEFAULT 1 CHECK (auto_renews IN (0,1)),
  cancelled_on           TEXT,
  cancellation_reference TEXT NOT NULL DEFAULT '',
  usage_target_per_month INTEGER,
  reminder_lead_days     INTEGER NOT NULL DEFAULT 7,
  module                 TEXT NOT NULL DEFAULT '',
  notes                  TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX ix_bills_status ON bills(status, kind);
CREATE INDEX ix_bills_renewal ON bills(renewal_date);
CREATE INDEX ix_bills_trial ON bills(trial_ends_on);

-- One row per billing period. Replaces Amethyst's magic-string-in-notes trick.
CREATE TABLE bill_payments (
  id             TEXT PRIMARY KEY,
  bill_id        TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  period_key     TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL,
  paid_on        TEXT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'due'
                 CHECK (status IN ('due','paid','skipped','failed')),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_bill_payments ON bill_payments(bill_id, period_key);
CREATE INDEX ix_bill_payments_due ON bill_payments(status, due_date);

CREATE TABLE bill_price_changes (
  id               TEXT PRIMARY KEY,
  bill_id          TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  effective_from   TEXT NOT NULL,
  old_amount_minor INTEGER NOT NULL,
  new_amount_minor INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL
);
CREATE INDEX ix_bill_price_changes ON bill_price_changes(bill_id, effective_from);

CREATE TABLE bill_usage (
  id         TEXT PRIMARY KEY,
  bill_id    TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_bill_usage ON bill_usage(bill_id, on_date);

-- Money lent to people and money borrowed from them, in one table.
CREATE TABLE money_agreements (
  id           TEXT PRIMARY KEY,
  direction    TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  reason       TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  started_on   TEXT NOT NULL,
  due_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','settled','written-off')),
  settled_on   TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_money_agreements ON money_agreements(direction, status, due_date);
CREATE INDEX ix_money_agreements_person ON money_agreements(person_id);

CREATE TABLE money_repayments (
  id             TEXT PRIMARY KEY,
  agreement_id   TEXT NOT NULL REFERENCES money_agreements(id) ON DELETE CASCADE,
  on_date        TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_money_repayments ON money_repayments(agreement_id, on_date);

CREATE TABLE payroll_profiles (
  id              TEXT PRIMARY KEY,
  person_id       TEXT REFERENCES people(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'Main job',
  employer        TEXT NOT NULL DEFAULT '',
  salary_minor    INTEGER NOT NULL DEFAULT 0,
  bonus_minor     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL,
  frequency       TEXT NOT NULL DEFAULT 'monthly'
                  CHECK (frequency IN ('weekly','fortnightly','4weekly','monthly','annual')),
  payday          TEXT NOT NULL,
  region          TEXT NOT NULL DEFAULT 'rUK'
                  CHECK (region IN ('rUK','scotland')),
  tax_code        TEXT NOT NULL DEFAULT '1257L',
  ni_category     TEXT NOT NULL DEFAULT 'A',
  pension_rate_bp INTEGER NOT NULL DEFAULT 0,
  pension_type    TEXT NOT NULL DEFAULT 'none'
                  CHECK (pension_type IN ('none','relief-at-source','net-pay','salary-sacrifice')),
  student_plan    TEXT NOT NULL DEFAULT 'none'
                  CHECK (student_plan IN ('none','plan1','plan2','plan4','plan5')),
  postgraduate    INTEGER NOT NULL DEFAULT 0 CHECK (postgraduate IN (0,1)),
  -- Tax rules change every year. The year is stored so a calculation can always
  -- state which rule set produced it.
  tax_year        TEXT NOT NULL DEFAULT '2025-26',
  irregular       INTEGER NOT NULL DEFAULT 0 CHECK (irregular IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE savings_goals (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'goal'
                        CHECK (kind IN ('goal','pot','sinking-fund','emergency')),
  target_minor          INTEGER NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL,
  target_date           TEXT,
  account_id            TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  -- Sinking funds: an annual cost spread over the year.
  annual_expense_minor  INTEGER,
  contribution_minor    INTEGER NOT NULL DEFAULT 0,
  contribution_period   TEXT NOT NULL DEFAULT 'monthly'
                        CHECK (contribution_period IN ('weekly','fortnightly','4weekly','monthly','annual')),
  bill_id               TEXT REFERENCES bills(id) ON DELETE SET NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE savings_contributions (
  id             TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  on_date        TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_savings_contributions ON savings_contributions(goal_id, on_date);

CREATE TABLE holdings (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'other'
                      CHECK (kind IN ('pension','isa','gia','crypto','property','premium-bonds','other')),
  value_minor         INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL,
  as_of_date          TEXT NOT NULL,
  contribution_minor  INTEGER NOT NULL DEFAULT 0,
  contribution_period TEXT NOT NULL DEFAULT 'monthly'
                      CHECK (contribution_period IN ('weekly','fortnightly','4weekly','monthly','annual','none')),
  employer_match_bp   INTEGER,
  provider            TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE balance_snapshots (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  on_date       TEXT NOT NULL,
  balance_minor INTEGER NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','computed','statement')),
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_balance_snapshots ON balance_snapshots(account_id, on_date);

-- Work expenses, reimbursements, refunds owed and shared costs all behave the
-- same way: money you are waiting on. One table, one "waiting on money" view.
CREATE TABLE expense_claims (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'reimbursement'
                 CHECK (kind IN ('work-expense','reimbursement','refund','shared-cost','donation')),
  amount_minor   INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL,
  incurred_on    TEXT,
  submitted_on   TEXT,
  expected_by    TEXT,
  received_on    TEXT,
  received_minor INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','submitted','chased','received','partial','rejected','cancelled')),
  person_id      TEXT REFERENCES people(id) ON DELETE SET NULL,
  reference      TEXT NOT NULL DEFAULT '',
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  gift_aid       INTEGER NOT NULL DEFAULT 0 CHECK (gift_aid IN (0,1)),
  tax_year       TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_expense_claims_status ON expense_claims(status, expected_by);

CREATE TABLE expense_shares (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  share_minor  INTEGER NOT NULL,
  weight       INTEGER NOT NULL DEFAULT 1,
  settled_on   TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_expense_shares ON expense_shares(claim_id);

CREATE TABLE wishlist_items (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL DEFAULT '',
  merchant          TEXT NOT NULL DEFAULT '',
  target_minor      INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  -- A deliberate pause before spending. The reminder fires when it expires.
  cooling_off_until TEXT,
  decision          TEXT NOT NULL DEFAULT ''
                    CHECK (decision IN ('','bought','skipped','deferred')),
  decided_on        TEXT,
  purchase_id       TEXT,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- "Is this actually cheaper than last time?" — repeat-purchase price history.
CREATE TABLE price_observations (
  id             TEXT PRIMARY KEY,
  product_key    TEXT NOT NULL,
  label          TEXT NOT NULL,
  merchant       TEXT NOT NULL DEFAULT '',
  on_date        TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  quantity       REAL NOT NULL DEFAULT 1,
  unit           TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual','receipt','import')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_price_observations ON price_observations(product_key, on_date);
`
}
