import type { Migration } from '../types.js'

/**
 * Migration 7 — health, family, care and pets.
 *
 * This is the most sensitive data in the product, and the schema reflects two
 * firm limits:
 *   1. Orbit records what the user tells it. There is no field for a diagnosis
 *      Orbit produced, because Orbit does not produce one.
 *   2. Medication records store a schedule and a reminder. Nothing in this
 *      schema can alter a dose; changes are always a user edit, logged in
 *      `activity` like any other change.
 */
export const migration007: Migration = {
  version: 7,
  name: 'people-care',
  sql: `
CREATE TABLE health_records (
  id                 TEXT PRIMARY KEY,
  person_id          TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL
                     CHECK (kind IN ('appointment','symptom','test-result','vaccination','procedure','note','check-up')),
  category           TEXT NOT NULL DEFAULT ''
                     CHECK (category IN ('','gp','dental','optical','hospital','physio','mental-health','other')),
  title              TEXT NOT NULL,
  on_date            TEXT NOT NULL,
  at_time            TEXT,
  detail             TEXT NOT NULL DEFAULT '',
  provider_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  location           TEXT NOT NULL DEFAULT '',
  outcome            TEXT NOT NULL DEFAULT '',
  next_due_on        TEXT,
  event_id           TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_health_person ON health_records(person_id, on_date);
CREATE INDEX ix_health_next_due ON health_records(next_due_on);

CREATE TABLE medications (
  id                   TEXT PRIMARY KEY,
  person_id            TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  dose                 TEXT NOT NULL DEFAULT '',
  form                 TEXT NOT NULL DEFAULT '',
  instructions         TEXT NOT NULL DEFAULT '',
  schedule_rule        TEXT NOT NULL DEFAULT '',
  times_of_day         TEXT NOT NULL DEFAULT '[]',
  started_on           TEXT,
  ends_on              TEXT,
  prescriber           TEXT NOT NULL DEFAULT '',
  quantity_remaining   INTEGER,
  quantity_per_refill  INTEGER,
  refill_reminder_days INTEGER NOT NULL DEFAULT 7,
  last_refill_on       TEXT,
  next_refill_on       TEXT,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX ix_medications_person ON medications(person_id, active);
CREATE INDEX ix_medications_refill ON medications(active, next_refill_on);

CREATE TABLE medication_logs (
  id            TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  on_date       TEXT NOT NULL,
  at_time       TEXT NOT NULL DEFAULT '',
  taken         INTEGER NOT NULL DEFAULT 1 CHECK (taken IN (0,1)),
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_medication_logs ON medication_logs(medication_id, on_date);

CREATE TABLE measurements (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  on_date    TEXT NOT NULL,
  at_time    TEXT NOT NULL DEFAULT '',
  value      REAL NOT NULL,
  value2     REAL,
  unit       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_measurements ON measurements(person_id, metric, on_date);

CREATE TABLE journal_entries (
  id         TEXT PRIMARY KEY,
  person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
  on_date    TEXT NOT NULL,
  mood       INTEGER CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  energy     INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  gratitude  TEXT NOT NULL DEFAULT '',
  private    INTEGER NOT NULL DEFAULT 1 CHECK (private IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_journal_date ON journal_entries(on_date);

CREATE TABLE pets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  species             TEXT NOT NULL DEFAULT '',
  breed               TEXT NOT NULL DEFAULT '',
  date_of_birth       TEXT,
  sex                 TEXT NOT NULL DEFAULT '',
  colour              TEXT NOT NULL DEFAULT '',
  microchip           TEXT NOT NULL DEFAULT '',
  insurer_person_id   TEXT REFERENCES people(id) ON DELETE SET NULL,
  vet_person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  policy_id           TEXT REFERENCES policies(id) ON DELETE SET NULL,
  photo_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  notes               TEXT NOT NULL DEFAULT '',
  archived_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE pet_records (
  id             TEXT PRIMARY KEY,
  pet_id         TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL
                 CHECK (kind IN ('vaccination','vet-visit','medication','grooming','weight','flea-worm','insurance','note')),
  title          TEXT NOT NULL,
  on_date        TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  next_due_on    TEXT,
  cost_minor     INTEGER,
  currency       TEXT NOT NULL DEFAULT '',
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_pet_records ON pet_records(pet_id, on_date);
CREATE INDEX ix_pet_records_due ON pet_records(next_due_on);

CREATE TABLE care_routines (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('pet','person','home')),
  subject_id    TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  instructions  TEXT NOT NULL DEFAULT '',
  schedule_rule TEXT NOT NULL DEFAULT '',
  time_of_day   TEXT NOT NULL DEFAULT '',
  -- Included when generating a handover sheet for a sitter or carer.
  handover      INTEGER NOT NULL DEFAULT 0 CHECK (handover IN (0,1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_care_routines ON care_routines(subject_type, subject_id);

CREATE TABLE chores (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  assignee_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  schedule_rule      TEXT NOT NULL DEFAULT '',
  anchor_date        TEXT,
  area               TEXT NOT NULL DEFAULT '',
  points             INTEGER NOT NULL DEFAULT 0,
  reward_minor       INTEGER,
  currency           TEXT NOT NULL DEFAULT '',
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE chore_completions (
  id         TEXT PRIMARY KEY,
  chore_id   TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
  on_date    TEXT NOT NULL,
  points     INTEGER NOT NULL DEFAULT 0,
  paid_on    TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_chore_completions ON chore_completions(chore_id, on_date);

CREATE TABLE school_records (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL
               CHECK (kind IN ('term-date','inset-day','event','trip','club','permission','payment','uniform','report','parents-evening')),
  title        TEXT NOT NULL,
  on_date      TEXT,
  ends_on      TEXT,
  due_by       TEXT,
  amount_minor INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  school       TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_school_records ON school_records(person_id, on_date);
CREATE INDEX ix_school_due ON school_records(done, due_by);

CREATE TABLE emergency_contacts (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  for_person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT '',
  priority     INTEGER NOT NULL DEFAULT 1,
  phone        TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE personal_milestones (
  id            TEXT PRIMARY KEY,
  person_id     TEXT REFERENCES people(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  on_date       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_personal_milestones ON personal_milestones(person_id, on_date);

CREATE TABLE childcare_slots (
  id           TEXT PRIMARY KEY,
  child_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  carer_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  on_date      TEXT NOT NULL,
  starts_at    TEXT NOT NULL DEFAULT '',
  ends_at      TEXT NOT NULL DEFAULT '',
  provider     TEXT NOT NULL DEFAULT '',
  cost_minor   INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','confirmed','cancelled','completed')),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_childcare ON childcare_slots(on_date);
`
}
