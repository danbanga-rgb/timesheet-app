-- Extend match_provenance to include 'created-pay' — G7b orphan flow.
--
-- When we push a bill_add for a qb_ingest_event that has no matching invoice
-- in our system (TechAntz-style vendors mapped as bill_add_and_pmt), the
-- resulting event has:
--   - resolved_bill_txn_id set (written by the drain handler)
--   - matched_invoice_ids = []
--   - target_qb_txn_kind = 'bill_add_and_pmt'
--
-- Before this migration, computeMatchProvenance labeled these as 'empty' —
-- semantically correct (no invoice link) but visually indistinguishable from
-- a matcher-failure. 'created-pay' communicates the actual authorization:
-- WE created and paid this bill, mapping-authorized, not invoice-linked.

ALTER TABLE public.qb_ingest_events
  DROP CONSTRAINT IF EXISTS qb_ingest_events_match_provenance_check;

ALTER TABLE public.qb_ingest_events
  ADD CONSTRAINT qb_ingest_events_match_provenance_check
  CHECK (match_provenance IS NULL OR match_provenance IN
    ('exact-txn','exact-ref','fuzzy','empty','created-pay'));
