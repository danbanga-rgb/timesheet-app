-- Slice G4a — reconciler output columns on qb_ingest_events.
--
-- After the classifier (Slice F.5) assigns kind + vendor, the reconciler
-- (Slice G4b) reads qb_mirror to decide the concrete action per event:
--
--   already_done         — bill exists AND matching payment exists in QB
--                          → skip push, auto-close event (posted_source='qb_probe')
--   pay_existing_bill    — bill exists but no payment → push bill_pmt_add
--                          against resolved_bill_txn_id
--   create_bill_then_pay — neither bill nor payment in QB → push bill_add
--                          then bill_pmt_add (chained)
--   check                — direct-expense (kind='check' events like Lucien)
--                          → push check_add
--   held                 — cannot reconcile (vendor not synced, no matched
--                          invoice, ambiguous match) → surface in UI
--
-- Columns are additive + nullable. Existing events stay NULL until the
-- reconciler runs. Slice G4c wires the orchestrator.

ALTER TABLE public.qb_ingest_events
  ADD COLUMN IF NOT EXISTS resolved_action text
    CHECK (resolved_action IS NULL OR resolved_action IN
      ('already_done','pay_existing_bill','create_bill_then_pay','check','held')),
  ADD COLUMN IF NOT EXISTS resolved_bill_txn_id text,       -- TxnID of the bill we'll pay (or auto-closed against)
  ADD COLUMN IF NOT EXISTS resolved_payment_txn_id text,    -- TxnID of the QB payment that already settled the bill (already_done case)
  ADD COLUMN IF NOT EXISTS resolved_reason text,            -- free-form explainer when action='held' or debugging
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE INDEX IF NOT EXISTS qb_ingest_events_resolved_action_idx
  ON public.qb_ingest_events (resolved_action) WHERE resolved_action IS NOT NULL;

COMMENT ON COLUMN public.qb_ingest_events.resolved_action IS 'Reconciler output: what QB write action (if any) this event should trigger. NULL = not yet reconciled.';
COMMENT ON COLUMN public.qb_ingest_events.resolved_bill_txn_id IS 'When resolved_action=pay_existing_bill: TxnID of the open QB bill to pay. When already_done: TxnID of the bill QB already paid.';
COMMENT ON COLUMN public.qb_ingest_events.resolved_payment_txn_id IS 'When resolved_action=already_done: TxnID of the existing QB payment. Otherwise NULL.';
COMMENT ON COLUMN public.qb_ingest_events.resolved_reason IS 'Free-form explanation when resolved_action=held, or debugging metadata.';
