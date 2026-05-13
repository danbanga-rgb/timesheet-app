-- Clean up contractor names that were stored as raw MIME encoded words
-- (e.g. =?UTF-8?Q?Branimir_Vu=C4=8Di=C4=87?=) due to a poller bug where
-- forwarded email body text was not MIME-decoded before storing.
-- Names are cleared to NULL here; the poller will re-derive them correctly
-- from the next timesheet email for each affected user.

update public.profiles
set name = null
where
  -- MIME encoded-word pattern: =?charset?encoding?text?=
  name ~ '\=\?[A-Za-z0-9\-]+\?[BbQq]\?[^?]+\?\='
  -- Only touch imported/contractor accounts, never admin/manager/accountant
  and role = 'timesheetuser';
