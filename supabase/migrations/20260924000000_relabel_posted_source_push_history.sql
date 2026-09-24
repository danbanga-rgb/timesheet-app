-- V9.9 followup 2026-09-24 — Relabel historical qb_probe rows using push history.
--
-- The reconciler at TS.tsx:2149 has stamped every auto-closed event as
-- posted_source='qb_probe', even when the closure was driven by OUR push
-- (via bill_add / bill_pmt_add / check_add jobs draining). This migration
-- backfills the correct label using the same signal the fixed reconciler
-- now uses at write time.
--
-- Signal:
--   - Event has any done bill_pmt_add or check_add job → 'push'
--   - Event has any done bill_add job (create-only), mirror shows the
--     bill settled → 'push_paid_outside'
--   - Event has any done bill_add job (create-only), mirror shows the
--     bill unpaid → 'push' (create-only intent achieved)
--   - No done push jobs → leave as 'qb_probe' (mirror truly discovered)
--
-- Safe: only touches rows currently labeled 'qb_probe' (or NULL). Leaves
-- 'push', 'push_paid_outside', 'manual_accept_fuzzy' alone.

UPDATE qb_ingest_events e
SET posted_qb_refs = jsonb_set(
  COALESCE(e.posted_qb_refs, '{}'::jsonb),
  '{posted_source}',
  CASE
    -- Pay/check job drained → we paid → 'push'
    WHEN EXISTS (
      SELECT 1 FROM qb_sync_jobs j
      WHERE j.id = ANY(e.qb_sync_job_ids)
        AND j.status = 'done'
        AND j.kind IN ('bill_pmt_add', 'check_add')
    ) THEN '"push"'::jsonb
    -- Create-only push, mirror shows OUR bill settled → someone paid it outside
    WHEN EXISTS (
      SELECT 1 FROM qb_sync_jobs j
      WHERE j.id = ANY(e.qb_sync_job_ids)
        AND j.status = 'done'
        AND j.kind = 'bill_add'
    ) AND EXISTS (
      SELECT 1 FROM qb_mirror m
      WHERE m.entity_kind = 'bill'
        AND m.entity_ref = e.resolved_bill_txn_id
        AND m.is_settled = true
    ) THEN '"push_paid_outside"'::jsonb
    -- Create-only push, mirror shows OUR bill unpaid → intent achieved → 'push'
    WHEN EXISTS (
      SELECT 1 FROM qb_sync_jobs j
      WHERE j.id = ANY(e.qb_sync_job_ids)
        AND j.status = 'done'
        AND j.kind = 'bill_add'
    ) THEN '"push"'::jsonb
    -- No push jobs → keep qb_probe (mirror truly discovered)
    ELSE '"qb_probe"'::jsonb
  END
)
WHERE e.status = 'posted'
  AND (e.posted_qb_refs->>'posted_source' = 'qb_probe' OR e.posted_qb_refs->>'posted_source' IS NULL)
  AND array_length(e.qb_sync_job_ids, 1) > 0;
