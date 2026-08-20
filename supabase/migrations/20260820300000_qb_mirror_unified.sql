-- Unified QB entity mirror.
--
-- One table for every QB entity we care about: vendors, accounts, bills,
-- bill payments, checks, credit-card charges, and future kinds. entity_kind
-- discriminates; data JSONB carries kind-specific fields.
--
-- Replaces:
--   - qb_vendors             → becomes a VIEW over this table
--   - qb_accounts            → becomes a VIEW over this table
--   - qb_open_bills_snapshot → dropped entirely (Slice G1 was 1 day old,
--                               no downstream compat needed)
--
-- Why unified: adding a new QB entity type (e.g. bill payments in Slice G1.2,
-- credit card charges later) becomes a zero-schema-change addition. Just persist
-- with a new entity_kind and consumers query with a filter. See
-- [[intuit-qb-layer-spec]] and the 2026-08-20 conversation on why per-kind
-- tables don't scale.

CREATE TABLE IF NOT EXISTS public.qb_mirror (
  entity_kind    text NOT NULL,      -- 'vendor' | 'account' | 'bill' | 'bill_payment' | 'check' | ...
  entity_ref     text NOT NULL,      -- QB stable ID: ListID for masters, TxnID for txns
  vendor_list_id text,               -- populated when kind is vendor-scoped (bill, bill_payment); NULL for masters
  ref_number     text,               -- populated for txns
  amount         numeric,            -- populated for txns
  is_active      boolean,            -- populated for masters (vendor, account)
  is_settled     boolean,            -- populated for txns (bill.is_paid, payment.is_applied)
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  queried_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_kind, entity_ref)
);

CREATE INDEX IF NOT EXISTS qb_mirror_vendor_kind_idx
  ON public.qb_mirror (vendor_list_id, entity_kind) WHERE vendor_list_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qb_mirror_ref_idx
  ON public.qb_mirror (entity_kind, ref_number) WHERE ref_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS qb_mirror_kind_settled_idx
  ON public.qb_mirror (entity_kind, is_settled);
CREATE INDEX IF NOT EXISTS qb_mirror_kind_queried_idx
  ON public.qb_mirror (entity_kind, queried_at);

COMMENT ON TABLE public.qb_mirror IS 'Unified local mirror of QuickBooks entities. Populated by qb-web-connector edge fn persist steps. Read via src/lib/qbStateSync/read.ts. Scalable to new entity kinds by convention — no schema change needed.';

-- Backfill vendors from legacy qb_vendors
INSERT INTO public.qb_mirror (entity_kind, entity_ref, is_active, data, queried_at)
SELECT 'vendor',
       list_id,
       is_active,
       jsonb_strip_nulls(jsonb_build_object(
         'name', name,
         'company_name', company_name
       )),
       COALESCE(synced_at, now())
FROM public.qb_vendors
ON CONFLICT (entity_kind, entity_ref) DO NOTHING;

-- Backfill accounts from legacy qb_accounts
INSERT INTO public.qb_mirror (entity_kind, entity_ref, is_active, data, queried_at)
SELECT 'account',
       list_id,
       is_active,
       jsonb_strip_nulls(jsonb_build_object(
         'full_name', full_name,
         'account_type', account_type
       )),
       COALESCE(synced_at, now())
FROM public.qb_accounts
ON CONFLICT (entity_kind, entity_ref) DO NOTHING;

-- Backfill bills from qb_open_bills_snapshot (may be zero rows)
INSERT INTO public.qb_mirror (entity_kind, entity_ref, vendor_list_id, ref_number, amount, is_settled, data, queried_at)
SELECT 'bill',
       txn_id,
       vendor_list_id,
       ref_number,
       amount,
       is_paid,
       jsonb_strip_nulls(jsonb_build_object(
         'vendor_name', vendor_name,
         'open_amount', amount_due,       -- source column is amount_due (remaining); mirror data.open_amount matches QB's OpenAmount naming
         'txn_date', txn_date::text,
         'due_date', due_date::text
       )),
       queried_at
FROM public.qb_open_bills_snapshot
ON CONFLICT (entity_kind, entity_ref) DO NOTHING;

-- Replace qb_vendors table with a VIEW on qb_mirror.
-- All existing callers (Convera scripts, frontend loader, edge fn cross-refs)
-- continue reading qb_vendors as if nothing changed.
DROP TABLE public.qb_vendors;
CREATE VIEW public.qb_vendors AS
  SELECT entity_ref                   AS list_id,
         data->>'name'                AS name,
         data->>'company_name'        AS company_name,
         COALESCE(is_active, true)    AS is_active,
         queried_at                   AS synced_at
  FROM public.qb_mirror
  WHERE entity_kind = 'vendor';

-- Replace qb_accounts table with a VIEW on qb_mirror.
DROP TABLE public.qb_accounts;
CREATE VIEW public.qb_accounts AS
  SELECT entity_ref                   AS list_id,
         data->>'full_name'           AS full_name,
         data->>'account_type'        AS account_type,
         COALESCE(is_active, true)    AS is_active,
         queried_at                   AS synced_at
  FROM public.qb_mirror
  WHERE entity_kind = 'account';

-- Drop qb_open_bills_snapshot — nothing else uses it (shipped today).
DROP TABLE public.qb_open_bills_snapshot;

-- RLS on qb_mirror. Permissive, matching qb_ingest_events / qb_vendor_mappings
-- pattern (accountant-only surfaces gated at UI). Views inherit RLS from base.
ALTER TABLE public.qb_mirror ENABLE ROW LEVEL SECURITY;

CREATE POLICY qb_mirror_select ON public.qb_mirror FOR SELECT USING (true);
CREATE POLICY qb_mirror_insert ON public.qb_mirror FOR INSERT WITH CHECK (true);
CREATE POLICY qb_mirror_update ON public.qb_mirror FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY qb_mirror_delete ON public.qb_mirror FOR DELETE USING (true);
