-- Matcher-ignore flag on invoices + convera_transactions.
--
-- WHY: prior to 2026-06-20, invoices went Submitted -> Paid without an Approved step,
-- so those rows are not guaranteed to represent a real accountant-validated intent.
-- The matcher should therefore treat them as reference-only. Same for the Convera
-- transactions that pre-date the batch-export workflow -- they were reconciled once
-- by pre-launch scripts and should not be re-touched.
--
-- Data is preserved unchanged. Invoices remain visible on invoice pages (paid /
-- unmatched / etc.) and export queries still see them -- this flag only fences
-- matchPaymentToInvoice + the Payments tab default view.

ALTER TABLE invoices
  ADD COLUMN matcher_ignore boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN invoices.matcher_ignore IS
  'When true, invisible to matchPaymentToInvoice. Historical rows fenced off after the Submitted->Approved->Paid workflow became authoritative. Reversible via UPDATE.';

ALTER TABLE convera_transactions
  ADD COLUMN matcher_ignore boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN convera_transactions.matcher_ignore IS
  'When true, hidden from Payments tab default view. Historical transactions reconciled once by pre-launch scripts.';

-- Backfill: cutoffs discussed 2026-07-16
UPDATE invoices              SET matcher_ignore = true WHERE period_start   < '2026-04-28';
UPDATE convera_transactions  SET matcher_ignore = true WHERE date_of_order  < '2026-06-20';
