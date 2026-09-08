import type { Migration } from '../types.js'

/**
 * Migration 6 — purchases, receipts, warranties, returns, parcels and vouchers.
 *
 * The consumer-admin loop Orbit is built to close:
 *   buy → receipt → warranty → it breaks → return → parcel → refund → transaction
 *
 * A hard rule is encoded here: `refund_received_on` and `refund_received_minor`
 * are separate from `sent_on`. Sending a return proves nothing about being
 * refunded, and Orbit never marks money as received because a parcel left the
 * house. The status CHECK makes the two states distinct.
 */
export const migration006: Migration = {
  version: 6,
  name: 'purchases',
  sql: `
CREATE TABLE purchases (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  merchant           TEXT NOT NULL DEFAULT '',
  merchant_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  purchased_on       TEXT NOT NULL,
  total_minor        INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL,
  order_reference    TEXT NOT NULL DEFAULT '',
  payment_method     TEXT NOT NULL DEFAULT '',
  transaction_id     TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  warranty_months    INTEGER,
  warranty_ends_on   TEXT,
  return_window_days INTEGER,
  return_by          TEXT,
  asset_id           TEXT REFERENCES assets(id) ON DELETE SET NULL,
  is_gift            INTEGER NOT NULL DEFAULT 0 CHECK (is_gift IN (0,1)),
  module             TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_purchases_date ON purchases(purchased_on);
CREATE INDEX ix_purchases_warranty ON purchases(warranty_ends_on);
CREATE INDEX ix_purchases_return_by ON purchases(return_by);
CREATE INDEX ix_purchases_merchant ON purchases(merchant);

CREATE TABLE purchase_items (
  id               TEXT PRIMARY KEY,
  purchase_id      TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  quantity         REAL NOT NULL DEFAULT 1,
  unit             TEXT NOT NULL DEFAULT '',
  unit_price_minor INTEGER,
  total_minor      INTEGER NOT NULL DEFAULT 0,
  category_id      TEXT REFERENCES categories(id) ON DELETE SET NULL,
  product_key      TEXT NOT NULL DEFAULT '',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE INDEX ix_purchase_items ON purchase_items(purchase_id);
CREATE INDEX ix_purchase_items_product ON purchase_items(product_key);

CREATE TABLE returns (
  id                     TEXT PRIMARY KEY,
  purchase_id            TEXT REFERENCES purchases(id) ON DELETE SET NULL,
  item_name              TEXT NOT NULL,
  reason                 TEXT NOT NULL DEFAULT '',
  opened_on              TEXT NOT NULL,
  method                 TEXT NOT NULL DEFAULT 'post'
                         CHECK (method IN ('post','courier','in-store','collection','other')),
  label_attachment_id    TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  deadline_on            TEXT,
  sent_on                TEXT,
  received_by_merchant_on TEXT,
  refund_expected_minor  INTEGER,
  refund_received_minor  INTEGER,
  refund_received_on     TEXT,
  refund_transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  currency               TEXT NOT NULL,
  -- 'sent' and 'refunded' are separate states on purpose.
  status                 TEXT NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','sent','received','refunded','partially-refunded','rejected','cancelled')),
  reference              TEXT NOT NULL DEFAULT '',
  notes                  TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX ix_returns_status ON returns(status, deadline_on);

CREATE TABLE parcels (
  id              TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  carrier         TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  tracking_url    TEXT NOT NULL DEFAULT '',
  direction       TEXT NOT NULL DEFAULT 'inbound'
                  CHECK (direction IN ('inbound','outbound')),
  dispatched_on   TEXT,
  expected_on     TEXT,
  delivered_on    TEXT,
  -- Updated by hand. Orbit has no carrier integration and does not pretend to.
  status          TEXT NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected','in-transit','out-for-delivery','delivered','collected','lost','returned')),
  purchase_id     TEXT REFERENCES purchases(id) ON DELETE SET NULL,
  return_id       TEXT REFERENCES returns(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_parcels_status ON parcels(status, expected_on);

CREATE TABLE vouchers (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'gift-card'
                CHECK (kind IN ('gift-card','voucher','loyalty-points','store-credit','coupon')),
  issuer        TEXT NOT NULL DEFAULT '',
  -- A hint only (last four characters). Full codes belong in a password manager.
  code_hint     TEXT NOT NULL DEFAULT '',
  balance_minor INTEGER NOT NULL DEFAULT 0,
  points        INTEGER,
  currency      TEXT NOT NULL DEFAULT '',
  expires_on    TEXT,
  used_on       TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_vouchers_expiry ON vouchers(expires_on, used_on);

CREATE TABLE quotes (
  id                 TEXT PRIMARY KEY,
  subject            TEXT NOT NULL,
  provider_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  provider_name      TEXT NOT NULL DEFAULT '',
  received_on        TEXT NOT NULL,
  valid_until        TEXT,
  amount_minor       INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL,
  chosen             INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0,1)),
  entity_type        TEXT NOT NULL DEFAULT '',
  entity_id          TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_quotes_subject ON quotes(subject, received_on);

CREATE TABLE clothing_sizes (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  size       TEXT NOT NULL,
  brand      TEXT NOT NULL DEFAULT '',
  measured_on TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_clothing_sizes ON clothing_sizes(person_id, category);
`
}
