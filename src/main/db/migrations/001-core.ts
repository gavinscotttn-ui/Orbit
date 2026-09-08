import type { Migration } from '../types.js'

/**
 * Migration 1 — the shared foundation.
 *
 * Every module in Orbit builds on these tables. The point of the product is
 * that a car, a receipt, a school trip and a holiday can all carry the same
 * kinds of attachment: people, documents, notes, tags, links and history. So
 * those live here, once, rather than being reinvented per module.
 *
 * Design rules applied throughout the schema:
 *  - Money is INTEGER minor units plus an explicit currency. Never a float.
 *  - Calendar dates are TEXT 'YYYY-MM-DD'. Instants are TEXT ISO-8601 UTC.
 *  - Booleans are INTEGER 0/1 with a CHECK constraint.
 *  - Enumerations are TEXT with a CHECK constraint, so a bad write fails loudly
 *    at the database rather than quietly poisoning a report months later.
 *  - Nothing stores an absolute filesystem path. Attachments are addressed by a
 *    path relative to the vault root, which is what makes the vault portable.
 */
export const migration001: Migration = {
  version: 1,
  name: 'core',
  sql: `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Portable preferences travel with the vault (locale, currency, enabled
-- modules). Device-specific preferences deliberately do NOT live here.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Attachments are content-addressed: the stored filename is the SHA-256 of the
-- bytes, so the same file attached twice is stored once, and no user-supplied
-- filename ever reaches the filesystem. That removes an entire class of
-- cross-platform problems (Windows reserved names, invalid characters, case
-- collisions, Unicode normalisation) by construction.
CREATE TABLE attachments (
  id                TEXT PRIMARY KEY,
  sha256            TEXT NOT NULL,
  relative_path     TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  extension         TEXT NOT NULL DEFAULT '',
  mime_type         TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes             INTEGER NOT NULL DEFAULT 0,
  text_content      TEXT NOT NULL DEFAULT '',
  text_status       TEXT NOT NULL DEFAULT 'none'
                    CHECK (text_status IN ('none','pending','done','failed','unsupported')),
  imported_note     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_attachments_sha ON attachments(sha256);
CREATE INDEX ix_attachments_text_status ON attachments(text_status);

CREATE TABLE attachment_links (
  id            TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'attachment',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_attachment_links ON attachment_links(attachment_id, entity_type, entity_id, role);
CREATE INDEX ix_attachment_links_entity ON attachment_links(entity_type, entity_id);

CREATE TABLE people (
  id                   TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  full_name            TEXT NOT NULL DEFAULT '',
  kind                 TEXT NOT NULL DEFAULT 'person'
                       CHECK (kind IN ('person','organisation')),
  relationship         TEXT NOT NULL DEFAULT '',
  household_member     INTEGER NOT NULL DEFAULT 0 CHECK (household_member IN (0,1)),
  is_me                INTEGER NOT NULL DEFAULT 0 CHECK (is_me IN (0,1)),
  email                TEXT NOT NULL DEFAULT '',
  phone                TEXT NOT NULL DEFAULT '',
  address              TEXT NOT NULL DEFAULT '',
  website              TEXT NOT NULL DEFAULT '',
  birthday             TEXT,
  birthday_year_known  INTEGER NOT NULL DEFAULT 1 CHECK (birthday_year_known IN (0,1)),
  catch_up_days        INTEGER,
  last_contact_on      TEXT,
  avatar_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  notes                TEXT NOT NULL DEFAULT '',
  archived_at          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX ix_people_kind ON people(kind, archived_at);
CREATE INDEX ix_people_household ON people(household_member);
CREATE UNIQUE INDEX ux_people_me ON people(is_me) WHERE is_me = 1;

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  colour     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_tags_slug ON tags(slug);

CREATE TABLE taggings (
  id          TEXT PRIMARY KEY,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_taggings ON taggings(tag_id, entity_type, entity_id);
CREATE INDEX ix_taggings_entity ON taggings(entity_type, entity_id);

-- The connection table. This is what makes a vehicle show its policy, its MOT,
-- its servicing receipt and its fuel costs on one screen.
CREATE TABLE links (
  id         TEXT PRIMARY KEY,
  from_type  TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_type    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  relation   TEXT NOT NULL DEFAULT 'related',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_links ON links(from_type, from_id, to_type, to_id, relation);
CREATE INDEX ix_links_from ON links(from_type, from_id);
CREATE INDEX ix_links_to ON links(to_type, to_id);

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  module      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX ix_notes_pinned ON notes(pinned, updated_at);

-- User-defined fields on any record type, using supported field types only.
CREATE TABLE custom_field_defs (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL
              CHECK (field_type IN ('text','longtext','number','money','date','boolean','select','url','person','record')),
  options     TEXT NOT NULL DEFAULT '[]',
  required    INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_custom_field_defs ON custom_field_defs(entity_type, key);

CREATE TABLE custom_field_values (
  id         TEXT PRIMARY KEY,
  field_id   TEXT NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL,
  value_text TEXT NOT NULL DEFAULT '',
  value_num  INTEGER,
  value_date TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_custom_field_values ON custom_field_values(field_id, entity_id);

-- Change history. The snapshot column holds the record as it was before the
-- change, which is what powers undo and 'restore earlier information'.
CREATE TABLE activity (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL
              CHECK (action IN ('created','updated','deleted','restored','completed','reopened','linked','unlinked','imported','automation','note')),
  summary     TEXT NOT NULL DEFAULT '',
  changes     TEXT NOT NULL DEFAULT '{}',
  snapshot    TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'ui'
              CHECK (source IN ('ui','import','automation','migration','demo','system')),
  undoable    INTEGER NOT NULL DEFAULT 0 CHECK (undoable IN (0,1))
);
CREATE INDEX ix_activity_entity ON activity(entity_type, entity_id, at);
CREATE INDEX ix_activity_at ON activity(at);
`
}
