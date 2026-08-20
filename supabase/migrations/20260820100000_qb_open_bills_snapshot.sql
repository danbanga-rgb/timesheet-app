-- qb_open_bills_snapshot — local mirror of QB Vendor Bills, kept fresh by
-- bill_query jobs. Central to the qbStateSync layer: instead of matching
-- ingest events against our own invoice records, we ask QB directly which
-- bills are open per vendor, then reconcile events against that snapshot.
--
-- Consumers (as of Slice G1):
--   - Slice G1/G2 push: reconcile pending qb_ingest_events against open bills
--   - qbStateSync/read.getVendorBills() for React freshness UI
--   - Future: Convera flow retrofit (currently uses invoices.qb_bill_txn_id)
--   - Future: audit/verify scripts (qb-billtxn-audit, qb-wire-pmt-audit)
--
-- Populated by the qb-web-connector edge fn's bill_query persist step.
-- Upsert semantics: PRIMARY KEY (vendor_list_id, ref_number, txn_id) means
-- successive queries for the same bill overwrite the row (amount_due + is_paid
-- reflect current QB state); queried_at tracks when we last saw each bill.
--
-- RLS: same permissive pattern as qb_ingest_events + qb_vendor_mappings
-- (accountant-only surface, gated at UI layer).

CREATE TABLE IF NOT EXISTS public.qb_open_bills_snapshot (
  vendor_list_id text NOT NULL,
  vendor_name    text NOT NULL,             -- denormalized for display
  ref_number     text NOT NULL,
  txn_id         text NOT NULL,
  txn_date       date,                       -- bill date from QB
  due_date       date,
  amount         numeric NOT NULL,           -- original bill amount
  amount_due     numeric NOT NULL,           -- remaining unpaid balance; 0 = fully paid
  is_paid        boolean NOT NULL,           -- derived: amount_due == 0
  queried_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_list_id, ref_number, txn_id)
);

CREATE INDEX IF NOT EXISTS qb_open_bills_snapshot_vendor_idx
  ON public.qb_open_bills_snapshot (vendor_list_id);
CREATE INDEX IF NOT EXISTS qb_open_bills_snapshot_queried_at_idx
  ON public.qb_open_bills_snapshot (queried_at);
CREATE INDEX IF NOT EXISTS qb_open_bills_snapshot_open_idx
  ON public.qb_open_bills_snapshot (vendor_list_id, is_paid)
  WHERE NOT is_paid;

COMMENT ON TABLE public.qb_open_bills_snapshot IS 'Local mirror of QB Vendor Bills. Populated by bill_query persist. Reconciliation authority for whether an ingest event is already paid in QB.';

ALTER TABLE public.qb_open_bills_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY qb_open_bills_snapshot_select ON qb_open_bills_snapshot FOR SELECT USING (true);
CREATE POLICY qb_open_bills_snapshot_insert ON qb_open_bills_snapshot FOR INSERT WITH CHECK (true);
CREATE POLICY qb_open_bills_snapshot_update ON qb_open_bills_snapshot FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY qb_open_bills_snapshot_delete ON qb_open_bills_snapshot FOR DELETE USING (true);
