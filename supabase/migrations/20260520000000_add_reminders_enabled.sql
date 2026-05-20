-- Add per-user flag controlling whether reminder emails are sent.
-- Default true for all real contractors; false for external/test accounts.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;

-- Bron Tamulis (external contractor, not a Synergie employee — would be confused by reminders)
-- Test accounts
UPDATE profiles
SET reminders_enabled = false
WHERE email IN (
  'btamulis@hotmail.com',
  'dan.hotmail@hotmail.com',
  'dan.yahoo@yahoo.com',
  'test@test.com'
) OR name IN ('Test', 'Dan Hotmail', 'Dan Yahoo');
