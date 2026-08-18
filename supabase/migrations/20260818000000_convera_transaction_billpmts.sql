-- Link table: convera_transactions ↔ QB bill payments (1:N).
--
-- convera_transactions.qb_billpmt_txn_id (existing single-value column) can
-- only hold ONE QB payment TxnID. Umbrella wires (BIMOSOFT, Native Teams,
-- Teal) cover multiple vendors → multiple QB bill payments per wire, so a
-- single column silently loses N-1 TxnIDs on persist.
--
-- This link table stores one row per (wire, vendor) so umbrella persist is
-- lossless. The old single-value column stays populated as an "at least one
-- payment recorded" cache (drop candidate for a future cleanup migration).
--
-- Skip-gate in enqueue-payments checks THIS table (per-vendor granularity)
-- rather than the old boolean-ish column, so an umbrella wire whose first
-- vendor persisted but second failed will still requeue the second vendor.

CREATE TABLE convera_transaction_billpmts (
  id                     bigserial PRIMARY KEY,
  convera_transaction_id integer      NOT NULL REFERENCES convera_transactions(id) ON DELETE CASCADE,
  qb_vendor_name         text         NOT NULL,
  qb_billpmt_txn_id      text         NOT NULL,
  payment_amount         numeric      NOT NULL,
  synced_at              timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (convera_transaction_id, qb_vendor_name)
);

CREATE INDEX convera_transaction_billpmts_txn_idx
  ON convera_transaction_billpmts(convera_transaction_id);

-- Reverse lookup: given a QB payment TxnID, which wire spawned it?
CREATE INDEX convera_transaction_billpmts_qb_txn_idx
  ON convera_transaction_billpmts(qb_billpmt_txn_id);

COMMENT ON TABLE convera_transaction_billpmts IS
  'Per-(wire, vendor) linkage to QB bill payments. Umbrella-safe replacement for '
  'convera_transactions.qb_billpmt_txn_id (which only holds one TxnID per wire). '
  'Populated by qb-web-connector persistJobResponse on bill_pmt_add success.';
