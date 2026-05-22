-- Returns last_sign_in_at for all auth users.
-- Callable by authenticated users; admin-only enforcement is in the app layer.
create or replace function public.get_user_last_logins()
returns table(id uuid, last_sign_in_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, last_sign_in_at from auth.users;
$$;

grant execute on function public.get_user_last_logins to authenticated;
