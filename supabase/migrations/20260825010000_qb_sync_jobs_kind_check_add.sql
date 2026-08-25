-- Add 'check_add' to the qb_sync_jobs.kind CHECK constraint so intuitCheck
-- can enqueue check_add jobs (Lucien-style direct-expense CheckAdd).
--
-- Backfill note: no existing rows use 'check_add' yet — this is a pure
-- constraint expansion, no data migration needed.

ALTER TABLE qb_sync_jobs DROP CONSTRAINT qb_sync_jobs_kind_check;

ALTER TABLE qb_sync_jobs ADD CONSTRAINT qb_sync_jobs_kind_check
  CHECK (kind = ANY (ARRAY[
    'bill_add'::text,
    'bill_query'::text,
    'bill_pmt_add'::text,
    'account_query'::text,
    'vendor_query'::text,
    'bill_pmt_query'::text,
    'check_add'::text
  ]));
