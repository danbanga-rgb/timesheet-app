-- Manual Invoice — Slice M0 schema.
--
-- Adds:
-- 1. invoices.created_by — which accountant created the manual invoice
--    (NULL for direct/imported = contractor-driven; set for manual).
-- 2. Extends invoices.source enum to include 'manual'.
-- 3. Extends profiles.role enum to include 'external_payee' for one-off
--    payees who aren't contractors and don't have login capability.
--
-- No backfill; existing rows keep source in ('direct','imported') and
-- created_by=NULL. See .claude/plans/manual-invoice-2026-09.md.

ALTER TABLE invoices ADD COLUMN created_by uuid REFERENCES profiles(id);

COMMENT ON COLUMN invoices.created_by IS
  'For source=manual invoices: the accountant who created the row. NULL for contractor-driven (direct/imported).';

-- Extend source CHECK constraint. Two-phase: drop + recreate.
ALTER TABLE invoices DROP CONSTRAINT invoices_source_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_source_check
  CHECK (source = ANY (ARRAY['direct'::text, 'imported'::text, 'manual'::text]));

-- Extend profiles.role CHECK constraint. external_payee = one-off payees
-- (Case 2 outsiders, Case 3 Monolith). No login, no reminders, no chat,
-- filtered out of contractor lists.
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY[
    'admin'::text,
    'accountant'::text,
    'manager'::text,
    'timesheetuser'::text,
    'vendormanager'::text,
    'contract_admin'::text,
    'external_payee'::text
  ]));
