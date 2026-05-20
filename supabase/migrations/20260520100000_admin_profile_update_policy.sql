-- Allow admin users to update any profile row.
-- Without this, the existing "Users can update own profile" policy silently
-- filtered out cross-user UPDATEs (0 rows affected, no error), so admin edits
-- to start_date, project, reminders_enabled, etc. never persisted.
create policy "Admins can update any profile"
  on public.profiles for update to authenticated
  using     ((select role from public.profiles where id = auth.uid()) = 'admin')
  with check ((select role from public.profiles where id = auth.uid()) = 'admin');
