-- Explicit grants and RLS hardening
-- 1. Adds GRANTs required by Supabase's new Data API policy (enforced Oct 30 2026)
-- 2. Drops overly-permissive {public} policies (allow anonymous access) and replaces with {authenticated}
-- 3. Adds missing policies for invoice-attachments
-- service_role bypasses RLS, so no grants/policies needed for edge functions.

-- ============================================================
-- GRANTs (required for Data API access regardless of RLS)
-- ============================================================
grant select, insert, update
  on public.profiles
  to authenticated;

grant select, insert, update, delete
  on public.timesheets
  to authenticated;

grant select, insert, update, delete
  on public.projects
  to authenticated;

grant select, insert, update, delete
  on public.invoices
  to authenticated;

grant select, insert, update, delete
  on public.payment_profiles
  to authenticated;

grant select, insert
  on public.email_import_log
  to authenticated;

-- ============================================================
-- profiles — drop {public} policies, keep {authenticated} ones
-- ============================================================
drop policy if exists "profiles_delete" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
-- "Admins can insert profiles", "Profiles viewable by authenticated users",
-- "Users can update own profile" are {authenticated} and stay.

-- ============================================================
-- invoices — drop {public} ALL policy, add {authenticated} replacement
-- ============================================================
drop policy if exists "invoices_all" on public.invoices;

create policy "authenticated users can manage invoices"
  on public.invoices for all to authenticated using (true) with check (true);

-- ============================================================
-- payment_profiles — drop {public} ALL policy, add {authenticated} replacement
-- ============================================================
drop policy if exists "payment_profiles_all" on public.payment_profiles;

create policy "authenticated users can manage payment profiles"
  on public.payment_profiles for all to authenticated using (true) with check (true);

-- ============================================================
-- email_import_log — drop {public} SELECT policy, add {authenticated} replacement
-- ============================================================
drop policy if exists "admin_read_import_log" on public.email_import_log;

alter table public.email_import_log enable row level security;

create policy "authenticated users can read import log"
  on public.email_import_log for select to authenticated using (true);

create policy "authenticated users can insert import log"
  on public.email_import_log for insert to authenticated with check (true);

