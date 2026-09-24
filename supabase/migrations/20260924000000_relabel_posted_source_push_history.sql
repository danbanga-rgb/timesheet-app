-- V9.9 followup 2026-09-24 — Relabel historical qb_probe rows using push history.
--
-- The reconciler at TS.tsx has stamped every auto-closed event as
-- posted_source='qb_probe', even when the closure was driven by OUR push
-- (via bill_add / bill_pmt_add / check_add jobs draining). This migration
-- backfills the correct label using the same signal the fixed reconciler
-- now uses at write time.
--
-- Two link paths per event, because bill_add's write side differs by
-- push origin:
--   1. event-driven: qb_sync_jobs.payload.sourceIngestEventId = event.id
--      (orphan bill_add; bill_pmt_add; check_add)
--   2. invoice-driven: qb_sync_jobs.payload.sourceInvoiceIds overlaps
--      event.matched_invoice_ids (G7.5 Intuit / G7.6 Convera create-bill)
--
-- Signal:
--   - Any done bill_pmt_add / check_add job linked to event → 'push'
--     (we drained a payment; mirror settlement is expected)
--   - Any done bill_add job linked to event AND mirror bill settled
--       → 'push_paid_outside' (we created; someone else paid)
--   - Any done bill_add job linked to event AND mirror bill unpaid
--       → 'push' (create-only intent achieved)
--   - No done push jobs → leave as 'qb_probe' (mirror truly discovered)
--
-- Safe: only touches rows currently labeled 'qb_probe' (or NULL). Leaves
-- 'push', 'push_paid_outside', 'manual_accept_fuzzy' alone.

WITH event_pushes AS (
  SELECT
    e.id AS event_id,
    bool_or(j.kind IN ('bill_pmt_add', 'check_add')) AS has_pay_job,
    bool_or(j.kind = 'bill_add') AS has_create_job
  FROM qb_ingest_events e
  JOIN qb_sync_jobs j
    ON j.status = 'done'
   AND j.kind IN ('bill_add', 'bill_pmt_add', 'check_add')
   AND (
     (j.payload->>'sourceIngestEventId')::int = e.id
     OR (
       j.kind = 'bill_add'
       AND j.payload ? 'sourceInvoiceIds'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(j.payload->'sourceInvoiceIds') AS x(inv_id)
         WHERE (x.inv_id)::int = ANY(e.matched_invoice_ids)
       )
     )
   )
  WHERE e.status = 'posted'
    AND (e.posted_qb_refs->>'posted_source' = 'qb_probe' OR e.posted_qb_refs->>'posted_source' IS NULL)
  GROUP BY e.id
)
UPDATE qb_ingest_events e
SET posted_qb_refs = jsonb_set(
  COALESCE(e.posted_qb_refs, '{}'::jsonb),
  '{posted_source}',
  CASE
    WHEN ep.has_pay_job
      THEN '"push"'::jsonb
    WHEN ep.has_create_job AND EXISTS (
      SELECT 1 FROM qb_mirror m
      WHERE m.entity_kind = 'bill'
        AND m.entity_ref = e.resolved_bill_txn_id
        AND m.is_settled = true
    )
      THEN '"push_paid_outside"'::jsonb
    WHEN ep.has_create_job
      THEN '"push"'::jsonb
    ELSE '"qb_probe"'::jsonb
  END
)
FROM event_pushes ep
WHERE e.id = ep.event_id
  AND e.status = 'posted'
  AND (e.posted_qb_refs->>'posted_source' = 'qb_probe' OR e.posted_qb_refs->>'posted_source' IS NULL);
