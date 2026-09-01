-- RBAC refactor — Slice 0 foundation for chat-bot Phase 1.
--
-- Introduces a role_permissions table + has_permission() helper so the app's
-- permission surface becomes granular instead of tied to hardcoded role strings.
-- Chat bot's declarative intent schema hangs off this: each intent declares
-- required_permission, checked via has_permission() on the caller.
--
-- Seed is regression-safe: contract_admin and accountant get explicit grants
-- for the things they'll invoke via chat (per plan doc catalog); admin gets '*'.
-- Existing edge fns that today check `role === 'admin'` are being refactored
-- in a follow-up commit to call has_permission() instead.

CREATE TABLE role_permissions (
  role text NOT NULL,
  permission text NOT NULL,
  granted_by uuid REFERENCES profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  PRIMARY KEY (role, permission)
);

COMMENT ON TABLE role_permissions IS
  'Granular permissions per role. Wildcard "*" = all permissions. See has_permission() for the check.';

-- Helper — SECURITY DEFINER so edge fns and RLS policies can call it without
-- needing direct SELECT on role_permissions.
CREATE OR REPLACE FUNCTION has_permission(uid uuid, perm text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN profiles p ON p.role = rp.role
    WHERE p.id = uid
      AND (rp.permission = perm OR rp.permission = '*')
  );
$$;

COMMENT ON FUNCTION has_permission(uuid, text) IS
  'Returns true if the user has the given permission (directly or via wildcard). Case-sensitive.';

-- RLS on role_permissions — read allowed to anyone (needed for UI to compute
-- which buttons to show), write restricted to admin only.
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_read ON role_permissions
  FOR SELECT USING (true);

CREATE POLICY role_permissions_admin_write ON role_permissions
  FOR ALL
  USING (has_permission(auth.uid(), 'role_permissions.manage'))
  WITH CHECK (has_permission(auth.uid(), 'role_permissions.manage'));

-- Seed — matches current behavior + grants for chat Phase 1 intents.
INSERT INTO role_permissions (role, permission) VALUES
  ('admin', '*'),

  -- Contract admin: user CRUD + payment_profile (future) + role_permissions read-only implied via wildcard behavior
  ('contract_admin', 'user.create'),
  ('contract_admin', 'user.update'),
  ('contract_admin', 'user.set_end_date'),
  ('contract_admin', 'user.set_start_date'),
  ('contract_admin', 'user.update_project'),
  ('contract_admin', 'user.update_country_region'),
  ('contract_admin', 'payment_profile.create'),
  ('contract_admin', 'payment_profile.update'),

  -- Accountant (Lucien): user updates + payment profile + existing invoice/timesheet approval
  ('accountant', 'user.update'),
  ('accountant', 'user.set_end_date'),
  ('accountant', 'user.set_start_date'),
  ('accountant', 'user.update_project'),
  ('accountant', 'user.update_country_region'),
  ('accountant', 'payment_profile.create'),
  ('accountant', 'payment_profile.update'),
  ('accountant', 'invoice.approve'),
  ('accountant', 'timesheet.approve'),

  -- Vendor manager: timesheet approval for their assigned vendors
  ('vendormanager', 'timesheet.approve'),

  -- Manager: timesheet approval for their reports
  ('manager', 'timesheet.approve');
