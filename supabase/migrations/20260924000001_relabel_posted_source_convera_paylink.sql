-- V9.9 followup 2026-09-24 (second pass) — extend push classifier with
-- Convera wire-driven link path.
--
-- Convera bill_pmt_add jobs write to convera_transaction_billpmts and
-- carry payload.sourceConveraTxnId — NOT sourceIngestEventId or
-- sourceInvoiceIds. The first backfill missed them and mislabeled 16
-- events as push_paid_outside that were actually push (we drained the
-- Convera payment).
--
-- Third link path added below:
--   payload.sourceConveraTxnId = event.raw_data->>'convera_transaction_id'
--
-- Applies to both qb_probe AND push_paid_outside rows so the second
-- pass can promote the first pass's mislabels.

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
     OR (
       j.kind = 'bill_pmt_add'
       AND (j.payload->>'sourceConveraTxnId')::int = (e.raw_data->>'convera_transaction_id')::int
     )
   )
  WHERE e.status = 'posted'
    AND (
      e.posted_qb_refs->>'posted_source' = 'qb_probe'
      OR e.posted_qb_refs->>'posted_source' = 'push_paid_outside'
      OR e.posted_qb_refs->>'posted_source' IS NULL
    )
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
  AND (
    e.posted_qb_refs->>'posted_source' = 'qb_probe'
    OR e.posted_qb_refs->>'posted_source' = 'push_paid_outside'
    OR e.posted_qb_refs->>'posted_source' IS NULL
  );
