-- Manual Invoice — grant payee.create to accountant + admin + contract_admin.
-- Used by create-payee edge fn (external_payee profile + payment_profile).

INSERT INTO role_permissions (role, permission) VALUES
  ('accountant',     'payee.create'),
  ('admin',          'payee.create'),
  ('contract_admin', 'payee.create')
ON CONFLICT DO NOTHING;
