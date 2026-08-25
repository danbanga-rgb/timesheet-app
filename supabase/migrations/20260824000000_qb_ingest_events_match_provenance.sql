-- Add match_provenance column to qb_ingest_events.
--
-- Records how matched_invoice_ids was determined:
--   exact-txn  — invoices.qb_bill_txn_id = qb_ingest_events.resolved_bill_txn_id
--                (authoritative — QB bill directly links to our invoice)
--   exact-ref  — matcher L1: invoice_number exact match
--   fuzzy      — matcher L2/L3: vendor + amount (or subset-sum)
--   empty      — no match found, or event has no invoice concept (check)
--
-- Consumers gate on this per resolved_action:
--   already_done       → auto-close only on exact-txn
--   pay_existing_bill  → push only on exact-txn or exact-ref (else human tick)
--   create_bill_then_pay → push only on exact-ref (else human tick)
--   check              → gate not applicable

ALTER TABLE public.qb_ingest_events
  ADD COLUMN IF NOT EXISTS match_provenance text;

ALTER TABLE public.qb_ingest_events
  DROP CONSTRAINT IF EXISTS qb_ingest_events_match_provenance_check;

ALTER TABLE public.qb_ingest_events
  ADD CONSTRAINT qb_ingest_events_match_provenance_check
  CHECK (match_provenance IS NULL OR match_provenance IN
    ('exact-txn','exact-ref','fuzzy','empty'));
