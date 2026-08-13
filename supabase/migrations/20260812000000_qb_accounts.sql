-- qb_accounts — snapshot of the accountant's QB Desktop chart of accounts.
--
-- Populated by the qb-web-connector edge fn on completion of `account_query`
-- jobs (AccountQueryRs → parsed → upserted). Consumed by:
--   - src/lib/qbxml/constants.ts (KEY_POINT_CHECKING / WU_HOLDING / etc.)
--     validation — surface a nicer error if the constant doesn't exist in QB.
--   - future admin UI so the accountant can wire our internal names to QB
--     account paths without a code push.
--
-- Primary key: list_id — QB assigns on account creation, stable across
-- renames. full_name is what plugs into <BankAccountRef><FullName>...</FullName>
-- so it's indexed for lookup. account_type is indexed for the common
-- "give me all Bank accounts" query the UI will want.

CREATE TABLE IF NOT EXISTS public.qb_accounts (
  list_id           text PRIMARY KEY,
  name              text NOT NULL,
  full_name         text NOT NULL,
  account_type      text,
  parent_full_name  text,
  is_active         boolean NOT NULL DEFAULT true,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qb_accounts_full_name_idx    ON public.qb_accounts (full_name);
CREATE INDEX IF NOT EXISTS qb_accounts_account_type_idx ON public.qb_accounts (account_type);

-- RLS: service-role only. Admin UI reads via service-role edge fn or bypasses
-- RLS entirely — no anon paths need this.
ALTER TABLE public.qb_accounts ENABLE ROW LEVEL SECURITY;
