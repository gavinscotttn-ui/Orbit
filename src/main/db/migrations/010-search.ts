import type { Migration } from '../types.js'

/**
 * Migration 10 — full-text search.
 *
 * FTS5 with the unicode61 tokenizer and diacritic folding, so "Citroen" finds
 * "Citroën" and "cafe" finds "café". The index is an external-content-free
 * table maintained by the application rather than by triggers: the sources are
 * two dozen tables with different shapes, and a trigger per table would be both
 * unmaintainable and impossible to keep in step with denormalised summaries.
 *
 * `search_queue` lets expensive work — extracting text from a PDF, indexing a
 * large import — happen on a background tick without blocking a save.
 */
export const migration010: Migration = {
  version: 10,
  name: 'search',
  sql: `
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  module      UNINDEXED,
  title,
  body,
  meta,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Lookup table so a re-index of one record can find and replace its row.
CREATE TABLE search_docs (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  rowid_ref   INTEGER NOT NULL,
  indexed_at  TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX ix_search_docs_rowid ON search_docs(rowid_ref);

CREATE TABLE search_queue (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL DEFAULT 'upsert'
              CHECK (operation IN ('upsert','delete')),
  queued_at   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX ux_search_queue ON search_queue(entity_type, entity_id, operation);
`
}
