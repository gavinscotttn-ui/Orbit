import type { Migration } from '../types.js'

/**
 * Migration 2 — planning: projects and goals, tasks, calendar, reminders,
 * habits and focus sessions.
 *
 * Calendar entries store the user's *intent* (a local date, a local time and
 * the IANA zone they meant it in) alongside a derived UTC instant used purely
 * for ordering and range queries. Storing only the instant would make a
 * recurring 09:00 meeting drift to 08:00 across a daylight-saving change;
 * storing only the local time would make cross-timezone travel meaningless.
 */
export const migration002: Migration = {
  version: 2,
  name: 'planning',
  sql: `
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'project'
                  CHECK (kind IN ('project','goal','area')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','someday','paused','done','abandoned')),
  description     TEXT NOT NULL DEFAULT '',
  module          TEXT NOT NULL DEFAULT '',
  colour          TEXT NOT NULL DEFAULT '',
  started_on      TEXT,
  target_date     TEXT,
  completed_at    TEXT,
  progress_mode   TEXT NOT NULL DEFAULT 'tasks'
                  CHECK (progress_mode IN ('tasks','manual','milestones')),
  progress_manual INTEGER NOT NULL DEFAULT 0,
  budget_minor    INTEGER,
  currency        TEXT NOT NULL DEFAULT '',
  archived_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_projects_status ON projects(status, kind);
CREATE INDEX ix_projects_module ON projects(module);

CREATE TABLE milestones (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  target_date TEXT,
  done_at     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_milestones_project ON milestones(project_id, sort_order);

CREATE TABLE tasks (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  notes                 TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','doing','waiting','done','cancelled')),
  priority              INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  project_id            TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id             TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  module                TEXT NOT NULL DEFAULT '',

  due_date              TEXT,
  due_time              TEXT,
  timezone              TEXT NOT NULL DEFAULT '',
  due_at_utc            TEXT,
  -- "Start by" accounts for preparation and travel, so the reminder arrives in
  -- time to actually leave the house rather than as the appointment begins.
  start_date            TEXT,
  prep_minutes          INTEGER NOT NULL DEFAULT 0,
  travel_minutes        INTEGER NOT NULL DEFAULT 0,
  defer_until           TEXT,

  estimate_minutes      INTEGER,
  energy                TEXT NOT NULL DEFAULT '' CHECK (energy IN ('','low','medium','high')),
  effort                TEXT NOT NULL DEFAULT '' CHECK (effort IN ('','quick','short','deep')),

  recurrence            TEXT NOT NULL DEFAULT '',
  recurrence_anchor     TEXT,
  series_id             TEXT NOT NULL DEFAULT '',

  completed_at          TEXT,
  completed_on          TEXT,

  waiting_kind          TEXT NOT NULL DEFAULT ''
                        CHECK (waiting_kind IN ('','reply','delivery','refund','decision','payment','other')),
  waiting_person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  waiting_since         TEXT,
  waiting_expected_by   TEXT,
  waiting_chased_on     TEXT,

  -- A label for who is meant to do this. It is NOT an authorisation boundary
  -- and grants nobody access to anything; see docs/SHARING.md.
  assignee_person_id    TEXT REFERENCES people(id) ON DELETE SET NULL,

  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_tasks_status_due ON tasks(status, due_date);
CREATE INDEX ix_tasks_project ON tasks(project_id, status);
CREATE INDEX ix_tasks_parent ON tasks(parent_id);
CREATE INDEX ix_tasks_module ON tasks(module, status);
CREATE INDEX ix_tasks_waiting ON tasks(waiting_kind, status);
CREATE INDEX ix_tasks_series ON tasks(series_id);

CREATE TABLE task_dependencies (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at          TEXT NOT NULL,
  CHECK (task_id <> depends_on_task_id)
);
CREATE UNIQUE INDEX ux_task_dependencies ON task_dependencies(task_id, depends_on_task_id);
CREATE INDEX ix_task_dependencies_rev ON task_dependencies(depends_on_task_id);

CREATE TABLE calendars (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  colour       TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'local'
               CHECK (source IN ('local','imported')),
  external_ref TEXT NOT NULL DEFAULT '',
  visible      INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE events (
  id                TEXT PRIMARY KEY,
  calendar_id       TEXT REFERENCES calendars(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL DEFAULT 'event'
                    CHECK (kind IN ('event','appointment','timeblock','birthday','anniversary','focus','travel','deadline')),
  all_day           INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  start_date        TEXT NOT NULL,
  start_time        TEXT,
  end_date          TEXT,
  end_time          TEXT,
  timezone          TEXT NOT NULL DEFAULT 'UTC',
  starts_at_utc     TEXT,
  ends_at_utc       TEXT,
  recurrence        TEXT NOT NULL DEFAULT '',
  recurrence_anchor TEXT,
  series_id         TEXT NOT NULL DEFAULT '',
  busy              INTEGER NOT NULL DEFAULT 1 CHECK (busy IN (0,1)),
  travel_minutes    INTEGER NOT NULL DEFAULT 0,
  prep_minutes      INTEGER NOT NULL DEFAULT 0,
  module            TEXT NOT NULL DEFAULT '',
  external_ref      TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX ix_events_start ON events(start_date);
CREATE INDEX ix_events_utc ON events(starts_at_utc);
CREATE INDEX ix_events_series ON events(series_id);
CREATE INDEX ix_events_module ON events(module);

CREATE TABLE event_exceptions (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('skip','move')),
  new_start_date  TEXT,
  new_start_time  TEXT,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_event_exceptions ON event_exceptions(event_id, occurrence_date);

CREATE TABLE event_attendees (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'attendee',
  response  TEXT NOT NULL DEFAULT 'invited'
            CHECK (response IN ('invited','yes','no','maybe'))
);
CREATE UNIQUE INDEX ux_event_attendees ON event_attendees(event_id, person_id);

CREATE TABLE reminders (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL DEFAULT '',
  entity_id      TEXT NOT NULL DEFAULT '',
  label          TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  remind_on      TEXT NOT NULL,
  remind_time    TEXT,
  timezone       TEXT NOT NULL DEFAULT '',
  remind_at_utc  TEXT,
  lead_days      INTEGER NOT NULL DEFAULT 0,
  recurrence     TEXT NOT NULL DEFAULT '',
  channel        TEXT NOT NULL DEFAULT 'in-app'
                 CHECK (channel IN ('in-app','os-notification')),
  state          TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (state IN ('scheduled','due','acknowledged','snoozed','cancelled')),
  snoozed_until  TEXT,
  last_fired_at  TEXT,
  module         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_reminders_due ON reminders(state, remind_on);
CREATE INDEX ix_reminders_entity ON reminders(entity_type, entity_id);

CREATE TABLE habits (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  detail            TEXT NOT NULL DEFAULT '',
  cadence           TEXT NOT NULL DEFAULT 'daily'
                    CHECK (cadence IN ('daily','weekly','custom')),
  target_per_period INTEGER NOT NULL DEFAULT 1,
  recurrence        TEXT NOT NULL DEFAULT '',
  colour            TEXT NOT NULL DEFAULT '',
  module            TEXT NOT NULL DEFAULT '',
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE habit_checkins (
  id         TEXT PRIMARY KEY,
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  on_date    TEXT NOT NULL,
  value      INTEGER NOT NULL DEFAULT 1,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_habit_checkins ON habit_checkins(habit_id, on_date);

CREATE TABLE focus_sessions (
  id              TEXT PRIMARY KEY,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  label           TEXT NOT NULL DEFAULT '',
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  planned_minutes INTEGER NOT NULL DEFAULT 25,
  actual_minutes  INTEGER,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_focus_started ON focus_sessions(started_at);
`
}
