-- Widen qb_sync_jobs.kind CHECK to allow 'bill_pmt_query'.
--
-- Exploratory read-only query kind — issues BillPaymentCheckQueryRq to QB and
-- stores the raw response in qbxml_response. Used to inspect historic bill
-- payment patterns (bank account, payee vendor, refnumber conventions) when
-- planning new payment flows (e.g. Intuit push design 2026-08-17).
--
-- Payload shape: { rawQbxmlRequest: '<BillPaymentCheckQueryRq>...</BillPaymentCheckQueryRq>' }
-- Persist path is a no-op (returns ok:true). Response inspection is manual.

ALTER TABLE qb_sync_jobs DROP CONSTRAINT qb_sync_jobs_kind_check;
ALTER TABLE qb_sync_jobs ADD CONSTRAINT qb_sync_jobs_kind_check
  CHECK (kind IN ('bill_add', 'bill_query', 'bill_pmt_add', 'account_query', 'vendor_query', 'bill_pmt_query'));
