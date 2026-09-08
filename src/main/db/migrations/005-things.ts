import type { Migration } from '../types.js'

/**
 * Migration 5 — assets, vehicles and the home.
 *
 * One `assets` table covers vehicles, appliances, devices, bikes, instruments
 * and tools, because everything Orbit does with them is the same: they cost
 * money, they need servicing, they hold documents and they eventually break.
 * Type-specific fields (registration, engine size, capacity) live in the
 * `attributes` JSON column, which is validated in TypeScript against a schema
 * chosen by `asset_type` — a typed model with an extensible tail, rather than
 * an untyped bag.
 *
 * Maintenance can be scheduled by DATE or by DISTANCE, or both, because a car
 * service is "every 12 months or 12,000 miles, whichever comes first".
 *
 * Nothing here assumes a country. MOT, road tax and the like are expressed as
 * ordinary maintenance schedules and documents, seeded from a UK template only
 * if the user picks one.
 */
export const migration005: Migration = {
  version: 5,
  name: 'things',
  sql: `
CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  floor      TEXT NOT NULL DEFAULT '',
  area_sqm   REAL,
  dimensions TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assets (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  asset_type           TEXT NOT NULL DEFAULT 'other'
                       CHECK (asset_type IN ('vehicle','appliance','device','equipment','furniture','property',
                                             'instrument','bicycle','tool','collection-item','other')),
  make                 TEXT NOT NULL DEFAULT '',
  model                TEXT NOT NULL DEFAULT '',
  identifier           TEXT NOT NULL DEFAULT '',
  acquired_on          TEXT,
  disposed_on          TEXT,
  purchase_price_minor INTEGER,
  currency             TEXT NOT NULL DEFAULT '',
  current_value_minor  INTEGER,
  value_as_of          TEXT,
  warranty_ends_on     TEXT,
  room_id              TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  location             TEXT NOT NULL DEFAULT '',
  owner_person_id      TEXT REFERENCES people(id) ON DELETE SET NULL,
  attributes           TEXT NOT NULL DEFAULT '{}',
  module               TEXT NOT NULL DEFAULT '',
  notes                TEXT NOT NULL DEFAULT '',
  archived_at          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX ix_assets_type ON assets(asset_type, archived_at);
CREATE INDEX ix_assets_room ON assets(room_id);
CREATE INDEX ix_assets_warranty ON assets(warranty_ends_on);

CREATE TABLE maintenance_schedules (
  id                 TEXT PRIMARY KEY,
  asset_id           TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'service'
                     CHECK (kind IN ('service','inspection','replacement','cleaning','safety-check','test','other')),
  interval_rule      TEXT NOT NULL DEFAULT '',
  interval_distance  INTEGER,
  distance_unit      TEXT NOT NULL DEFAULT 'mi' CHECK (distance_unit IN ('mi','km')),
  last_done_on       TEXT,
  last_done_distance INTEGER,
  next_due_on        TEXT,
  next_due_distance  INTEGER,
  reminder_lead_days INTEGER NOT NULL DEFAULT 21,
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_maintenance_due ON maintenance_schedules(active, next_due_on);
CREATE INDEX ix_maintenance_asset ON maintenance_schedules(asset_id);

CREATE TABLE maintenance_records (
  id                 TEXT PRIMARY KEY,
  asset_id           TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  schedule_id        TEXT REFERENCES maintenance_schedules(id) ON DELETE SET NULL,
  done_on            TEXT NOT NULL,
  distance           INTEGER,
  title              TEXT NOT NULL DEFAULT '',
  summary            TEXT NOT NULL DEFAULT '',
  cost_minor         INTEGER,
  currency           TEXT NOT NULL DEFAULT '',
  provider_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  transaction_id     TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  outcome            TEXT NOT NULL DEFAULT ''
                     CHECK (outcome IN ('','pass','advisory','fail','completed')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_maintenance_records ON maintenance_records(asset_id, done_on);

CREATE TABLE odometer_readings (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  distance   INTEGER NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'mi' CHECK (unit IN ('mi','km')),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_odometer ON odometer_readings(asset_id, on_date);

CREATE TABLE fuel_logs (
  id             TEXT PRIMARY KEY,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  on_date        TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'fuel' CHECK (kind IN ('fuel','charge')),
  quantity       REAL NOT NULL DEFAULT 0,
  unit           TEXT NOT NULL DEFAULT 'litre'
                 CHECK (unit IN ('litre','gallon-uk','gallon-us','kwh')),
  cost_minor     INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL,
  odometer       INTEGER,
  full_tank      INTEGER NOT NULL DEFAULT 1 CHECK (full_tank IN (0,1)),
  location       TEXT NOT NULL DEFAULT '',
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_fuel_logs ON fuel_logs(asset_id, on_date);

CREATE TABLE parking_records (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT REFERENCES assets(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('permit','ticket','where-i-parked')),
  reference    TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  level_or_bay TEXT NOT NULL DEFAULT '',
  valid_from   TEXT,
  expires_at   TEXT,
  cost_minor   INTEGER,
  currency     TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_parking_expiry ON parking_records(expires_at);

CREATE TABLE decor_records (
  id           TEXT PRIMARY KEY,
  room_id      TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  surface      TEXT NOT NULL DEFAULT '',
  brand        TEXT NOT NULL DEFAULT '',
  colour_name  TEXT NOT NULL DEFAULT '',
  colour_code  TEXT NOT NULL DEFAULT '',
  finish       TEXT NOT NULL DEFAULT '',
  quantity     TEXT NOT NULL DEFAULT '',
  purchased_on TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE meters (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'electricity'
                     CHECK (kind IN ('electricity','gas','water','oil','heat','other')),
  serial             TEXT NOT NULL DEFAULT '',
  unit               TEXT NOT NULL DEFAULT 'kWh',
  supplier_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  bill_id            TEXT REFERENCES bills(id) ON DELETE SET NULL,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE meter_readings (
  id         TEXT PRIMARY KEY,
  meter_id   TEXT NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  reading    REAL NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_meter_readings ON meter_readings(meter_id, on_date);

CREATE TABLE storage_boxes (
  id                  TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  location            TEXT NOT NULL DEFAULT '',
  room_id             TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  contents            TEXT NOT NULL DEFAULT '',
  photo_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE lent_items (
  id           TEXT PRIMARY KEY,
  item_name    TEXT NOT NULL,
  asset_id     TEXT REFERENCES assets(id) ON DELETE SET NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
  person_id    TEXT REFERENCES people(id) ON DELETE SET NULL,
  on_date      TEXT NOT NULL,
  due_back_on  TEXT,
  returned_on  TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_lent_items ON lent_items(direction, returned_on, due_back_on);

CREATE TABLE declutter_items (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  action          TEXT NOT NULL DEFAULT 'donate'
                  CHECK (action IN ('donate','sell','recycle','bin','gift','keep')),
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','listed','gone','kept')),
  estimated_minor INTEGER,
  actual_minor    INTEGER,
  currency        TEXT NOT NULL DEFAULT '',
  on_date         TEXT,
  destination     TEXT NOT NULL DEFAULT '',
  asset_id        TEXT REFERENCES assets(id) ON DELETE SET NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE consumables (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  asset_id          TEXT REFERENCES assets(id) ON DELETE SET NULL,
  room_id           TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  interval_days     INTEGER NOT NULL DEFAULT 90,
  last_replaced_on  TEXT,
  next_due_on       TEXT,
  cost_minor        INTEGER,
  currency          TEXT NOT NULL DEFAULT '',
  supplier          TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_consumables_due ON consumables(active, next_due_on);
`
}
