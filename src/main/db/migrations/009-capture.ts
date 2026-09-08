import type { Migration } from '../types.js'

/**
 * Migration 9 — capture, custom trackers, saved views, automation and life
 * events.
 *
 * `inbox_items` is the universal in-tray. Anything dropped on Orbit lands here
 * first with its suggestions attached but NOT applied. The user reviews before
 * anything is written to a real record — extraction is a proposal, never a fact.
 *
 * `automation_runs` records every rule execution including previews and
 * failures, so an automation can never quietly do something and leave no trace.
 */
export const migration009: Migration = {
  version: 9,
  name: 'capture',
  sql: `
CREATE TABLE inbox_items (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL DEFAULT 'text'
                 CHECK (kind IN ('text','file','receipt','document','image','link','voice','email')),
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  attachment_id  TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  captured_at    TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'quick-capture'
                 CHECK (source IN ('quick-capture','drag-drop','import','automation','file-menu')),
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','triaged','converted','archived')),
  converted_type TEXT NOT NULL DEFAULT '',
  converted_id   TEXT NOT NULL DEFAULT '',
  -- Proposed dates, amounts and record types. Applied only on user confirmation.
  suggestions    TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_inbox_status ON inbox_items(status, captured_at);

CREATE TABLE trackers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT NOT NULL DEFAULT '',
  colour       TEXT NOT NULL DEFAULT '',
  entry_label  TEXT NOT NULL DEFAULT 'Entry',
  -- JSON array of field definitions, validated against the supported field types.
  field_schema TEXT NOT NULL DEFAULT '[]',
  module       TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE tracker_entries (
  id         TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL DEFAULT '{}',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_tracker_entries ON tracker_entries(tracker_id, on_date);

CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'search',
  query      TEXT NOT NULL DEFAULT '{}',
  icon       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE automation_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  trigger      TEXT NOT NULL DEFAULT '{}',
  conditions   TEXT NOT NULL DEFAULT '[]',
  actions      TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  -- Consequential actions always ask, even when the rule is enabled.
  require_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (require_confirmation IN (0,1)),
  last_run_at  TEXT,
  run_count    INTEGER NOT NULL DEFAULT 0,
  error_count  INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE automation_runs (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  ran_at      TEXT NOT NULL,
  status      TEXT NOT NULL
              CHECK (status IN ('preview','applied','failed','skipped','cancelled')),
  summary     TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_automation_runs ON automation_runs(rule_id, ran_at);

CREATE TABLE life_event_plans (
  id           TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  title        TEXT NOT NULL,
  started_on   TEXT,
  target_date  TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('draft','active','done','abandoned')),
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  -- What the template actually created, so it can be reviewed or undone.
  created_refs TEXT NOT NULL DEFAULT '[]',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- External integrations. Every one has an explicit state, and 'not-configured'
-- is the default. Nothing here implies a connection exists.
CREATE TABLE integrations (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT 'not-configured'
                CHECK (state IN ('not-configured','connected','expired','failed','unavailable-offline','disabled')),
  last_checked_at TEXT,
  last_error    TEXT NOT NULL DEFAULT '',
  -- Configuration only. Credentials live in the OS keychain, never here.
  config        TEXT NOT NULL DEFAULT '{}',
  retain_data_on_disconnect INTEGER NOT NULL DEFAULT 1
                CHECK (retain_data_on_disconnect IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_integrations ON integrations(provider, label);
`
}
