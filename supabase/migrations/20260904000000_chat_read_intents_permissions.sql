-- Grant read permissions for chat's new user.get + user.list intents.
-- admin already gets '*'. contract_admin (CA) + accountant (Lucien) need
-- explicit grants to run these from chat.

INSERT INTO role_permissions (role, permission) VALUES
  ('contract_admin', 'user.get'),
  ('contract_admin', 'user.list'),
  ('accountant',     'user.get'),
  ('accountant',     'user.list')
ON CONFLICT DO NOTHING;
