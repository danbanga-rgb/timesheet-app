-- qb_vendors — snapshot of the accountant's QB Desktop vendor list.
--
-- Populated by the qb-web-connector edge fn on completion of `vendor_query`
-- jobs (VendorQueryRs → parsed → upserted). Primary consumer: pre-batch
-- verification — before enqueueing bill_pmt_add / bill_add jobs, callers
-- confirm every payment_profiles.qb_vendor_name exists here EXACTLY. This
-- prevents statusCode=3140 "Object not found" mid-batch failures and — worst
-- case — silent shadow-vendor creation from a slightly-misspelled reference.
--
-- Primary key: list_id — QB assigns on vendor creation, stable across
-- renames. `name` is what plugs into <PayeeEntityRef><FullName>...</FullName>
-- and <VendorRef><FullName>...</FullName> so it's indexed for lookup.

CREATE TABLE IF NOT EXISTS public.qb_vendors (
  list_id      text PRIMARY KEY,
  name         text NOT NULL,
  company_name text,
  is_active    boolean NOT NULL DEFAULT true,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qb_vendors_name_idx      ON public.qb_vendors (name);
CREATE INDEX IF NOT EXISTS qb_vendors_is_active_idx ON public.qb_vendors (is_active) WHERE is_active;

-- RLS: service-role only. Admin UI reads via service-role edge fn or bypasses
-- RLS entirely — no anon paths need this.
ALTER TABLE public.qb_vendors ENABLE ROW LEVEL SECURITY;
