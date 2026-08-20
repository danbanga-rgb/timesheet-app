-- Slice G4d — extend resolved_action CHECK to include 'pre_our_system'.
--
-- Adds a terminal outcome for events whose txn_date predates our system's
-- cutoff for the given source (e.g. Intuit XLSX < 2026-06-01). QB handled
-- those before we got involved; reconciler short-circuits them so we
-- never auto-close via mirror-inferred matches AND never push.
--
-- Mirrors the [[matcher-ignore]] pattern already applied to
-- invoices.matcher_ignore and convera_transactions.matcher_ignore.

ALTER TABLE public.qb_ingest_events
  DROP CONSTRAINT IF EXISTS qb_ingest_events_resolved_action_check;

ALTER TABLE public.qb_ingest_events
  ADD CONSTRAINT qb_ingest_events_resolved_action_check
  CHECK (resolved_action IS NULL OR resolved_action IN
    ('already_done','pay_existing_bill','create_bill_then_pay','check','held','pre_our_system'));

-- Full reset: clear ALL reconciler state on non-terminal events so the fixed
-- reconciler (refHit-required + cutoff) re-evaluates from scratch. Keeps
-- classifier-set fields (counterparty_qb_vendor_list_id, target_qb_txn_kind)
-- intact. Human-pushed events (posted_source='push') are NEVER touched —
-- those are final.
UPDATE public.qb_ingest_events
SET resolved_action = NULL,
    resolved_bill_txn_id = NULL,
    resolved_payment_txn_id = NULL,
    resolved_reason = NULL,
    reconciled_at = NULL,
    status = CASE
      WHEN status = 'posted' AND posted_qb_refs->>'posted_source' = 'qb_probe' THEN 'pending'
      ELSE status
    END,
    posted_qb_refs = CASE
      WHEN posted_qb_refs->>'posted_source' = 'qb_probe' THEN NULL
      ELSE posted_qb_refs
    END
WHERE status IN ('pending', 'ready')
   OR (status = 'posted' AND posted_qb_refs->>'posted_source' = 'qb_probe');

