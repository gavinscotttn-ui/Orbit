import type { Migration } from '../types.js'

/**
 * Migration 4 — the document vault, insurance and correspondence.
 *
 * A document record is metadata; the bytes live in `attachments`, addressed by
 * a vault-relative path. Version history is a list of attachments, so replacing
 * a renewed policy never destroys the one it replaced.
 *
 * `correspondence` is deliberately generic: a complaint to a retailer, a letter
 * from an insurer and a chase-up email about a refund are the same shape, and
 * all three need "they promised to reply by" and "escalate on" dates.
 */
export const migration004: Migration = {
  version: 4,
  name: 'documents',
  sql: `
CREATE TABLE documents (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  doc_type              TEXT NOT NULL DEFAULT 'other'
                        CHECK (doc_type IN ('passport','driving-licence','birth-certificate','marriage-certificate',
                                            'policy','certificate','statement','receipt','warranty','contract',
                                            'manual','payslip','tax','medical','education','identity','vehicle',
                                            'property','will','other')),
  reference             TEXT NOT NULL DEFAULT '',
  issuer_person_id      TEXT REFERENCES people(id) ON DELETE SET NULL,
  person_id             TEXT REFERENCES people(id) ON DELETE SET NULL,
  issued_on             TEXT,
  expires_on            TEXT,
  renewal_reminder_days INTEGER NOT NULL DEFAULT 60,
  -- Marked for the emergency pack: the handful of things you would need if the
  -- house burned down. Kept available offline like everything else.
  emergency_pack        INTEGER NOT NULL DEFAULT 0 CHECK (emergency_pack IN (0,1)),
  sensitive             INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  module                TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT '',
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_documents_type ON documents(doc_type, archived_at);
CREATE INDEX ix_documents_expiry ON documents(expires_on);
CREATE INDEX ix_documents_pack ON documents(emergency_pack);

CREATE TABLE document_versions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_document_versions ON document_versions(document_id, version);

CREATE TABLE policies (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT REFERENCES documents(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'other'
                     CHECK (kind IN ('home-buildings','home-contents','motor','travel','pet','health','dental',
                                     'life','income-protection','gadget','breakdown','warranty','other')),
  provider_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  policy_number      TEXT NOT NULL DEFAULT '',
  starts_on          TEXT,
  ends_on            TEXT,
  premium_minor      INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL,
  premium_period     TEXT NOT NULL DEFAULT 'annual'
                     CHECK (premium_period IN ('monthly','quarterly','annual','one-off')),
  excess_minor       INTEGER,
  cover_limit_minor  INTEGER,
  -- Entered and reviewed by the user. Orbit does not read a policy PDF and
  -- decide what you are covered for.
  cover_summary      TEXT NOT NULL DEFAULT '',
  auto_renews        INTEGER NOT NULL DEFAULT 1 CHECK (auto_renews IN (0,1)),
  notice_days        INTEGER NOT NULL DEFAULT 0,
  bill_id            TEXT REFERENCES bills(id) ON DELETE SET NULL,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_policies_ends ON policies(ends_on);
CREATE INDEX ix_policies_kind ON policies(kind);

CREATE TABLE claims (
  id                    TEXT PRIMARY KEY,
  policy_id             TEXT REFERENCES policies(id) ON DELETE SET NULL,
  reference             TEXT NOT NULL DEFAULT '',
  title                 TEXT NOT NULL,
  opened_on             TEXT NOT NULL,
  closed_on             TEXT,
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','submitted','assessing','settled','rejected','withdrawn')),
  amount_claimed_minor  INTEGER,
  amount_settled_minor  INTEGER,
  currency              TEXT NOT NULL,
  excess_paid_minor     INTEGER,
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX ix_claims_status ON claims(status, opened_on);

CREATE TABLE correspondence (
  id               TEXT PRIMARY KEY,
  entity_type      TEXT NOT NULL DEFAULT '',
  entity_id        TEXT NOT NULL DEFAULT '',
  person_id        TEXT REFERENCES people(id) ON DELETE SET NULL,
  subject          TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('sent','received')),
  on_date          TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'email'
                   CHECK (channel IN ('email','letter','phone','chat','in-person','portal','social')),
  reference        TEXT NOT NULL DEFAULT '',
  summary          TEXT NOT NULL DEFAULT '',
  response_due_by  TEXT,
  escalation_date  TEXT,
  resolved_on      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX ix_correspondence_entity ON correspondence(entity_type, entity_id, on_date);
CREATE INDEX ix_correspondence_due ON correspondence(response_due_by);
`
}
