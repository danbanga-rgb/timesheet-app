-- Flip qb_vendors + qb_accounts views to SECURITY INVOKER.
--
-- Both views (created in 20260820300000_qb_mirror_unified.sql) inherit the
-- Postgres default of SECURITY DEFINER, which runs the view as its owner
-- (postgres superuser) and bypasses RLS on the underlying qb_mirror table.
-- Supabase Advisor flags this as a critical issue.
--
-- qb_mirror already has a permissive SELECT policy for `public`
-- (USING (true)), so flipping to invoker semantics has no functional impact:
-- reads still succeed for anon + authenticated. The change closes the
-- defense-in-depth gap so that if qb_mirror's RLS is ever tightened, the
-- views inherit that restriction instead of leaking around it.

ALTER VIEW public.qb_vendors  SET (security_invoker = true);
ALTER VIEW public.qb_accounts SET (security_invoker = true);
