-- QB Automation Layer — core data model
--
-- Two tables:
--   qb_ingest_events    — one row per external financial event (Convera wire,
--                          Intuit payment row, future bank/CC entry). Source-agnostic
--                          shape; specifics stashed in raw_data jsonb.
--   qb_vendor_mappings  — remembered per-source vendor + account mappings so
--                          accountant only maps each counterparty once.
--
-- Design memory: [[intuit-qb-layer-spec]] v3 (2026-08-19)
--
-- Slice A of Phase 1 build. No code reads/writes these tables yet.

CREATE TABLE qb_ingest_events (
  id                           bigserial PRIMARY KEY,
  ingested_at                  timestamptz NOT NULL DEFAULT now(),
  status_updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Where the event came from + its natural key within that source.
  -- Convention:
  --   source='intuit_xlsx'  → source_ref = sha256(xlsx_row_normalized) or (date|vendor|amount|memo)
  --   source='convera'      → source_ref = wire confirmation number
  --   source='manual'       → source_ref = user-provided string
  source                       text NOT NULL,
  source_ref                   text NOT NULL,

  -- What the event describes, in source-neutral form.
  txn_date                     date NOT NULL,
  amount                       numeric(14,2) NOT NULL,   -- positive = money out (expense/AP)
  counterparty_raw             text NOT NULL,             -- as source spells it
  memo                         text,

  -- Resolution: filled in by mapping lookup or by accountant.
  counterparty_qb_vendor_list_id text,                    -- qb_vendors.list_id
  target_qb_txn_kind           text CHECK (target_qb_txn_kind IN
                                 ('bill_pmt','bill_add_and_pmt','check','ignore')),
  qb_bank_account_list_id      text,                      -- 8220 Key Point for our current flows
  qb_expense_account_list_id   text,                      -- expense side for check / bill_add_and_pmt

  -- Invoice linkage (0..N — Convera umbrella wires cover multiple invoices).
  matched_invoice_ids          integer[] NOT NULL DEFAULT '{}',

  -- Push lifecycle.
  status                       text NOT NULL DEFAULT 'pending' CHECK (status IN
                                 ('pending','ready','queued','posted','failed','ignored')),
  qb_sync_job_ids              bigint[] NOT NULL DEFAULT '{}',  -- 1 job for bill_pmt/check, 2 for bill_add_and_pmt
  posted_qb_refs               jsonb,                      -- {bill: "TxnID", bill_pmt: "TxnID"} etc.
  last_error                   text,

  -- Source-specific extras (Intuit XLSX row, Convera wire row, etc.)
  raw_data                     jsonb,
  notes                        text,

  UNIQUE (source, source_ref)
);

-- Inbox query: pending events ordered newest-first.
CREATE INDEX qb_ingest_events_status_idx ON qb_ingest_events (status, ingested_at DESC);
-- Filter by source in the UI.
CREATE INDEX qb_ingest_events_source_idx ON qb_ingest_events (source);
-- Look up events by matched invoice (for the Invoice modal's "pushed to QB" badge later).
CREATE INDEX qb_ingest_events_matched_invoices_idx ON qb_ingest_events USING GIN (matched_invoice_ids);

COMMENT ON TABLE qb_ingest_events IS 'One row per external financial event to be posted to QB via qbXML. Source-agnostic. Spec: [[intuit-qb-layer-spec]] v3.';
COMMENT ON COLUMN qb_ingest_events.amount IS 'Positive = money out (AP/expense/check). Sign flip for future deposit/journal kinds.';
COMMENT ON COLUMN qb_ingest_events.target_qb_txn_kind IS 'bill_pmt = pay existing Bill; bill_add_and_pmt = create Bill + Pay Bill (chained qbXML); check = direct CheckAdd; ignore = never push.';
COMMENT ON COLUMN qb_ingest_events.status IS 'pending = needs mapping; ready = mapped, awaiting push; queued = jobs in qb_sync_jobs; posted = QBWC done; failed = QBWC error; ignored = deliberate skip.';

-- ─── Vendor mappings ──────────────────────────────────────────────────────────
-- Remembered per-source pattern → QB vendor + default push kind + default accounts.
-- MVP: exact-match on counterparty_raw. Later: prefix / regex / rules engine.

CREATE TABLE qb_vendor_mappings (
  id                           bigserial PRIMARY KEY,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  source                       text NOT NULL,       -- matches qb_ingest_events.source
  counterparty_pattern         text NOT NULL,       -- exact match on counterparty_raw for now

  qb_vendor_list_id            text NOT NULL,       -- qb_vendors.list_id
  default_target_kind          text CHECK (default_target_kind IN
                                 ('bill_pmt','bill_add_and_pmt','check','ignore')),
  default_bank_account_list_id text,
  default_expense_account_list_id text,

  notes                        text,

  UNIQUE (source, counterparty_pattern)
);

CREATE INDEX qb_vendor_mappings_lookup_idx ON qb_vendor_mappings (source, counterparty_pattern);

COMMENT ON TABLE qb_vendor_mappings IS 'Remembered mappings from raw counterparty strings to QB vendors + default push kind + default accounts. Applied on ingest to auto-classify events.';
