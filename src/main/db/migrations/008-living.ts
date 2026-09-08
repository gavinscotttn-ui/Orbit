import type { Migration } from '../types.js'

/**
 * Migration 8 — food and shopping, travel, work and learning, relationships and
 * occasions, goals and hobbies, and digital life.
 *
 * Note what is absent from `digital_accounts`: there is no password column, no
 * secret column, and no encrypted-blob column. Orbit is not a password manager
 * and will not become one by accident. It records which service an account is
 * with, whether two-factor is on, and where the real credentials live.
 */
export const migration008: Migration = {
  version: 8,
  name: 'living',
  sql: `
-- Food and shopping ---------------------------------------------------------

CREATE TABLE recipes (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT '',
  servings            INTEGER NOT NULL DEFAULT 2,
  prep_minutes        INTEGER,
  cook_minutes        INTEGER,
  ingredients         TEXT NOT NULL DEFAULT '',
  method              TEXT NOT NULL DEFAULT '',
  cost_estimate_minor INTEGER,
  currency            TEXT NOT NULL DEFAULT '',
  favourite           INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0,1)),
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE meal_plan_entries (
  id                  TEXT PRIMARY KEY,
  on_date             TEXT NOT NULL,
  slot                TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner','snack')),
  recipe_id           TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  title               TEXT NOT NULL DEFAULT '',
  servings            INTEGER NOT NULL DEFAULT 2,
  cost_estimate_minor INTEGER,
  currency            TEXT NOT NULL DEFAULT '',
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_meal_plan ON meal_plan_entries(on_date, slot);

CREATE TABLE pantry_items (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT 'pantry'
             CHECK (location IN ('pantry','fridge','freezer','cupboard','other')),
  quantity   REAL NOT NULL DEFAULT 1,
  unit       TEXT NOT NULL DEFAULT '',
  expires_on TEXT,
  opened_on  TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_pantry_expiry ON pantry_items(expires_on);

CREATE TABLE shopping_lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'groceries'
             CHECK (kind IN ('groceries','household','diy','gifts','other')),
  is_template INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0,1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shopping_items (
  id              TEXT PRIMARY KEY,
  list_id         TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  quantity        REAL NOT NULL DEFAULT 1,
  unit            TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  estimated_minor INTEGER,
  currency        TEXT NOT NULL DEFAULT '',
  bought          INTEGER NOT NULL DEFAULT 0 CHECK (bought IN (0,1)),
  bought_on       TEXT,
  note            TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_shopping_items ON shopping_items(list_id, bought, sort_order);

CREATE TABLE dietary_preferences (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('allergy','intolerance','dislike','preference','diet')),
  detail     TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT '' CHECK (severity IN ('','mild','moderate','severe')),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_dietary ON dietary_preferences(person_id);

-- Travel --------------------------------------------------------------------

CREATE TABLE trips (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  destination  TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  starts_on    TEXT,
  ends_on      TEXT,
  purpose      TEXT NOT NULL DEFAULT 'leisure'
               CHECK (purpose IN ('leisure','work','family','other')),
  budget_minor INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'idea'
               CHECK (status IN ('idea','planned','booked','underway','complete','cancelled')),
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_trips_dates ON trips(starts_on);

CREATE TABLE trip_bookings (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'other'
              CHECK (kind IN ('flight','train','coach','ferry','hotel','rental','car-hire','activity','transfer','other')),
  title       TEXT NOT NULL,
  reference   TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL DEFAULT '',
  starts_on   TEXT,
  starts_time TEXT,
  ends_on     TEXT,
  ends_time   TEXT,
  timezone    TEXT NOT NULL DEFAULT '',
  from_place  TEXT NOT NULL DEFAULT '',
  to_place    TEXT NOT NULL DEFAULT '',
  cost_minor  INTEGER,
  currency    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'booked'
              CHECK (status IN ('idea','held','booked','cancelled','used','refunded')),
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  event_id    TEXT REFERENCES events(id) ON DELETE SET NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_trip_bookings ON trip_bookings(trip_id, starts_on);

CREATE TABLE packing_items (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT REFERENCES trips(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  quantity    INTEGER NOT NULL DEFAULT 1,
  packed      INTEGER NOT NULL DEFAULT 0 CHECK (packed IN (0,1)),
  person_id   TEXT REFERENCES people(id) ON DELETE SET NULL,
  is_template INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_packing ON packing_items(trip_id, packed);

CREATE TABLE travel_credits (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'airline'
               CHECK (kind IN ('airline','hotel','rail','ferry','other')),
  reference    TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL,
  expires_on   TEXT,
  used_on      TEXT,
  trip_id      TEXT REFERENCES trips(id) ON DELETE SET NULL,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_travel_credits ON travel_credits(expires_on, used_on);

-- Work and learning ---------------------------------------------------------

CREATE TABLE shifts (
  id             TEXT PRIMARY KEY,
  person_id      TEXT REFERENCES people(id) ON DELETE CASCADE,
  employer       TEXT NOT NULL DEFAULT '',
  on_date        TEXT NOT NULL,
  starts_time    TEXT NOT NULL DEFAULT '',
  ends_time      TEXT NOT NULL DEFAULT '',
  break_minutes  INTEGER NOT NULL DEFAULT 0,
  rate_minor     INTEGER,
  currency       TEXT NOT NULL DEFAULT '',
  overtime       INTEGER NOT NULL DEFAULT 0 CHECK (overtime IN (0,1)),
  multiplier_bp  INTEGER NOT NULL DEFAULT 10000,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','worked','cancelled','swapped')),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_shifts_date ON shifts(on_date);

CREATE TABLE leave_allowances (
  id                 TEXT PRIMARY KEY,
  person_id          TEXT REFERENCES people(id) ON DELETE CASCADE,
  leave_year         TEXT NOT NULL,
  entitlement_days   REAL NOT NULL DEFAULT 0,
  carried_over_days  REAL NOT NULL DEFAULT 0,
  starts_on          TEXT,
  ends_on            TEXT,
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_leave_allowances ON leave_allowances(person_id, leave_year);

CREATE TABLE leave_records (
  id         TEXT PRIMARY KEY,
  person_id  TEXT REFERENCES people(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'annual'
             CHECK (kind IN ('annual','sick','unpaid','parental','compassionate','toil','study','other')),
  starts_on  TEXT NOT NULL,
  ends_on    TEXT NOT NULL,
  days       REAL NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'planned'
             CHECK (status IN ('planned','requested','approved','declined','taken','cancelled')),
  leave_year TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_leave_records ON leave_records(person_id, starts_on);

CREATE TABLE qualifications (
  id             TEXT PRIMARY KEY,
  person_id      TEXT REFERENCES people(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  awarding_body  TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT 'qualification'
                 CHECK (kind IN ('qualification','membership','licence','certification','registration')),
  obtained_on    TEXT,
  expires_on     TEXT,
  reference      TEXT NOT NULL DEFAULT '',
  renewal_cost_minor INTEGER,
  currency       TEXT NOT NULL DEFAULT '',
  cpd_hours_required REAL,
  document_id    TEXT REFERENCES documents(id) ON DELETE SET NULL,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_qualifications_expiry ON qualifications(expires_on);

CREATE TABLE cpd_records (
  id                   TEXT PRIMARY KEY,
  qualification_id     TEXT REFERENCES qualifications(id) ON DELETE CASCADE,
  person_id            TEXT REFERENCES people(id) ON DELETE CASCADE,
  on_date              TEXT NOT NULL,
  hours                REAL NOT NULL DEFAULT 0,
  activity             TEXT NOT NULL,
  evidence_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX ix_cpd ON cpd_records(qualification_id, on_date);

CREATE TABLE courses (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT '',
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  started_on    TEXT,
  target_end_on TEXT,
  completed_on  TEXT,
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  cost_minor    INTEGER,
  currency      TEXT NOT NULL DEFAULT '',
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE job_applications (
  id                TEXT PRIMARY KEY,
  role              TEXT NOT NULL,
  company           TEXT NOT NULL DEFAULT '',
  applied_on        TEXT,
  source            TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','applied','screening','interview','offer','rejected','withdrawn','accepted')),
  next_action       TEXT NOT NULL DEFAULT '',
  next_action_on    TEXT,
  salary_minor      INTEGER,
  currency          TEXT NOT NULL DEFAULT '',
  contact_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_job_applications ON job_applications(status, next_action_on);

CREATE TABLE cv_entries (
  id           TEXT PRIMARY KEY,
  person_id    TEXT REFERENCES people(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('role','education','skill','achievement','publication')),
  title        TEXT NOT NULL,
  organisation TEXT NOT NULL DEFAULT '',
  starts_on    TEXT,
  ends_on      TEXT,
  detail       TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Relationships, occasions and memories -------------------------------------

CREATE TABLE occasions (
  id           TEXT PRIMARY KEY,
  person_id    TEXT REFERENCES people(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'birthday'
               CHECK (kind IN ('birthday','anniversary','remembrance','other')),
  title        TEXT NOT NULL,
  on_date      TEXT NOT NULL,
  year_known   INTEGER NOT NULL DEFAULT 1 CHECK (year_known IN (0,1)),
  lead_days    INTEGER NOT NULL DEFAULT 14,
  budget_minor INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_occasions_date ON occasions(on_date);

CREATE TABLE gift_ideas (
  id              TEXT PRIMARY KEY,
  person_id       TEXT REFERENCES people(id) ON DELETE CASCADE,
  occasion_id     TEXT REFERENCES occasions(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL DEFAULT '',
  estimated_minor INTEGER,
  currency        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'idea'
                  CHECK (status IN ('idea','chosen','bought','wrapped','given','rejected')),
  bought_on       TEXT,
  purchase_id     TEXT REFERENCES purchases(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_gift_ideas ON gift_ideas(person_id, status);

CREATE TABLE memories (
  id            TEXT PRIMARY KEY,
  on_date       TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  place         TEXT NOT NULL DEFAULT '',
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_memories_date ON memories(on_date);

CREATE TABLE event_plans (
  id           TEXT PRIMARY KEY,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  hosting      INTEGER NOT NULL DEFAULT 1 CHECK (hosting IN (0,1)),
  rsvp_by      TEXT,
  guest_count  INTEGER,
  budget_minor INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'planning'
               CHECK (status IN ('planning','invited','confirmed','done','cancelled')),
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE proposed_dates (
  id         TEXT PRIMARY KEY,
  plan_id    TEXT NOT NULL REFERENCES event_plans(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  at_time    TEXT NOT NULL DEFAULT '',
  votes      INTEGER NOT NULL DEFAULT 0,
  chosen     INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0,1)),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE rsvps (
  id                 TEXT PRIMARY KEY,
  plan_id            TEXT NOT NULL REFERENCES event_plans(id) ON DELETE CASCADE,
  person_id          TEXT REFERENCES people(id) ON DELETE SET NULL,
  guest_name         TEXT NOT NULL DEFAULT '',
  response           TEXT NOT NULL DEFAULT 'invited'
                     CHECK (response IN ('invited','yes','no','maybe')),
  contribution       TEXT NOT NULL DEFAULT '',
  contribution_minor INTEGER,
  currency           TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_rsvps ON rsvps(plan_id);

-- Goals, hobbies and community ----------------------------------------------

CREATE TABLE bucket_list (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT '',
  target_year         INTEGER,
  status              TEXT NOT NULL DEFAULT 'someday'
                      CHECK (status IN ('someday','planned','doing','done','abandoned')),
  cost_estimate_minor INTEGER,
  currency            TEXT NOT NULL DEFAULT '',
  done_on             TEXT,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE reading_list (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'book'
              CHECK (kind IN ('book','article','paper','course','podcast','other')),
  status      TEXT NOT NULL DEFAULT 'want'
              CHECK (status IN ('want','reading','finished','abandoned')),
  started_on  TEXT,
  finished_on TEXT,
  rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE project_materials (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit        TEXT NOT NULL DEFAULT '',
  cost_minor  INTEGER,
  currency    TEXT NOT NULL DEFAULT '',
  supplier    TEXT NOT NULL DEFAULT '',
  acquired_on TEXT,
  needed      INTEGER NOT NULL DEFAULT 1 CHECK (needed IN (0,1)),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE collection_items (
  id                  TEXT PRIMARY KEY,
  collection_id       TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  identifier          TEXT NOT NULL DEFAULT '',
  acquired_on         TEXT,
  cost_minor          INTEGER,
  value_minor         INTEGER,
  currency            TEXT NOT NULL DEFAULT '',
  condition           TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  photo_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX ix_collection_items ON collection_items(collection_id);

CREATE TABLE volunteer_shifts (
  id                      TEXT PRIMARY KEY,
  organisation_person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  on_date                 TEXT NOT NULL,
  starts_time             TEXT NOT NULL DEFAULT '',
  ends_time               TEXT NOT NULL DEFAULT '',
  hours                   REAL NOT NULL DEFAULT 0,
  expenses_minor          INTEGER,
  currency                TEXT NOT NULL DEFAULT '',
  reimbursed_on           TEXT,
  kind                    TEXT NOT NULL DEFAULT 'shift'
                          CHECK (kind IN ('shift','training','meeting','event')),
  note                    TEXT NOT NULL DEFAULT '',
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX ix_volunteer_shifts ON volunteer_shifts(on_date);

-- Digital life ---------------------------------------------------------------

CREATE TABLE devices (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'computer'
                       CHECK (kind IN ('computer','phone','tablet','wearable','console','nas','router','printer','other')),
  make                 TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  serial               TEXT NOT NULL DEFAULT '',
  os_version           TEXT NOT NULL DEFAULT '',
  purchased_on         TEXT,
  warranty_ends_on     TEXT,
  asset_id             TEXT REFERENCES assets(id) ON DELETE SET NULL,
  owner_person_id      TEXT REFERENCES people(id) ON DELETE SET NULL,
  backup_frequency_days INTEGER,
  last_backup_on       TEXT,
  next_backup_on       TEXT,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX ix_devices_backup ON devices(next_backup_on);

CREATE TABLE domains (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  registrar     TEXT NOT NULL DEFAULT '',
  registered_on TEXT,
  expires_on    TEXT,
  auto_renew    INTEGER NOT NULL DEFAULT 1 CHECK (auto_renew IN (0,1)),
  cost_minor    INTEGER,
  currency      TEXT NOT NULL DEFAULT '',
  bill_id       TEXT REFERENCES bills(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_domains_expiry ON domains(expires_on);

-- An inventory of WHERE your accounts are. Never WHAT the passwords are.
CREATE TABLE digital_accounts (
  id               TEXT PRIMARY KEY,
  service          TEXT NOT NULL,
  url              TEXT NOT NULL DEFAULT '',
  username_hint    TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT '',
  has_2fa          INTEGER NOT NULL DEFAULT 0 CHECK (has_2fa IN (0,1)),
  twofa_method     TEXT NOT NULL DEFAULT '',
  password_manager TEXT NOT NULL DEFAULT '',
  recovery_notes   TEXT NOT NULL DEFAULT '',
  importance       TEXT NOT NULL DEFAULT 'normal'
                   CHECK (importance IN ('low','normal','critical')),
  person_id        TEXT REFERENCES people(id) ON DELETE SET NULL,
  bill_id          TEXT REFERENCES bills(id) ON DELETE SET NULL,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX ix_digital_accounts ON digital_accounts(importance, service);
`
}
