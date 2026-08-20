-- RLS policies for qb_vendors and qb_accounts.
--
-- The 2026-08-12 and 2026-08-13 migrations created these tables with
-- ENABLE ROW LEVEL SECURITY (Supabase default) but no policies. That means
-- default-deny for anon/JWT clients — the accountant frontend was silently
-- getting empty results, breaking the Slice D vendor mapping dropdown and
-- the Slice F.5 auto-classifier's profile-chain lookup.
--
-- Same permissive pattern applied to qb_ingest_events + qb_vendor_mappings
-- (migration 20260819100000). Both tables are accountant-only surfaces
-- gated at the UI layer.

CREATE POLICY qb_vendors_select ON qb_vendors FOR SELECT USING (true);

CREATE POLICY qb_accounts_select ON qb_accounts FOR SELECT USING (true);
