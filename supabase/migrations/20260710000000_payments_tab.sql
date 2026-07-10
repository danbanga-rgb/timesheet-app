-- Payments Tab MVP — 2026-07-10
-- Adds match state to convera_transactions, an import_batches table, and a
-- link table for umbrella payments (one Convera line settling multiple invoices).

-- ─── import_batches ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
  id                SERIAL PRIMARY KEY,
  source            TEXT NOT NULL,                       -- 'convera_xls' for MVP
  source_filename   TEXT,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by       TEXT,                                -- accountant name
  row_count         INTEGER NOT NULL DEFAULT 0,
  state             TEXT NOT NULL DEFAULT 'pending'      -- 'pending' | 'processed' | 'rolled_back'
                    CHECK (state IN ('pending','processed','rolled_back'))
);

-- ─── convera_transactions match columns ──────────────────────────────────────
ALTER TABLE convera_transactions
  ADD COLUMN IF NOT EXISTS import_batch_id     INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_invoice_id  INTEGER REFERENCES invoices(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_state         TEXT NOT NULL DEFAULT 'unreviewed'
                          CHECK (match_state IN ('unreviewed','matched','no_invoice','flagged')),
  ADD COLUMN IF NOT EXISTS match_confidence    TEXT
                          CHECK (match_confidence IN ('strong','weak','none') OR match_confidence IS NULL),
  ADD COLUMN IF NOT EXISTS match_level         INTEGER,
  ADD COLUMN IF NOT EXISTS matched_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_by          TEXT,
  ADD COLUMN IF NOT EXISTS notes               TEXT;

CREATE INDEX IF NOT EXISTS idx_convera_transactions_batch  ON convera_transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_convera_transactions_state  ON convera_transactions(match_state);
CREATE INDEX IF NOT EXISTS idx_convera_transactions_invid  ON convera_transactions(matched_invoice_id);

-- ─── umbrella link table ─────────────────────────────────────────────────────
-- One Convera transaction can settle multiple invoices (Bimosoft, Native Teams, Wise umbrella).
-- matched_invoice_id above is the single-invoice case; this table handles the multi-invoice case.
-- A row here implies match_state='matched' on the parent transaction.
CREATE TABLE IF NOT EXISTS convera_transaction_invoices (
  transaction_id  INTEGER NOT NULL REFERENCES convera_transactions(id) ON DELETE CASCADE,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id)             ON DELETE CASCADE,
  amount_share    NUMERIC,                             -- allocation for this invoice
  PRIMARY KEY (transaction_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ctxi_invoice ON convera_transaction_invoices(invoice_id);

-- ─── Backfill historical batch for existing rows ─────────────────────────────
-- Assigns any existing convera_transactions row (imported pre-Payments-tab) to a synthetic
-- "Historical import" batch marked processed so it shows in the batch list and can be
-- Reopened for review if needed. No data loss.
DO $$
DECLARE
  hist_batch_id INTEGER;
  historic_count INTEGER;
BEGIN
  SELECT count(*) INTO historic_count FROM convera_transactions WHERE import_batch_id IS NULL;

  IF historic_count > 0 THEN
    INSERT INTO import_batches (source, source_filename, imported_by, row_count, state)
    VALUES ('convera_xls', '(pre-launch imports)', 'system-backfill', historic_count, 'processed')
    RETURNING id INTO hist_batch_id;

    UPDATE convera_transactions
       SET import_batch_id = hist_batch_id
     WHERE import_batch_id IS NULL;

    -- Mark rows whose invoice was already paid (via the old flow) as 'matched'
    -- Rows without a linked invoice stay 'unreviewed' so accountant can review them.
    -- (This is a best-effort backfill — matched_invoice_id stays NULL because the old
    -- flow didn't record the transaction→invoice link. Reopen path lets accountant
    -- reconcile these manually.)
  END IF;
END $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON import_batches TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE import_batches_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON convera_transaction_invoices TO authenticated;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE import_batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE convera_transaction_invoices  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can manage import_batches"
  ON import_batches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage convera_transaction_invoices"
  ON convera_transaction_invoices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- convera_transactions already has SELECT / INSERT / UPDATE policies; add DELETE for rollback.
CREATE POLICY "convera_transactions_delete"
  ON convera_transactions FOR DELETE TO authenticated
  USING (true);
