-- SECURITY DEFINER function so the anon key can check if an email exists
-- in profiles without exposing any profile data. Used by the poller's
-- sender allowlist (isKnownContractor) to avoid RLS blocking the check.
create or replace function public.profile_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from profiles where lower(email) = lower(p_email));
$$;

grant execute on function public.profile_email_exists to anon;
