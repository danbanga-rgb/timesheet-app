-- Grant chat write permissions for user.update_pay_rate + user.update_bill_rate.
-- admin already gets '*'. contract_admin (CA) is the primary user of these
-- intents; grant explicitly. Not granted to accountant for now (rates changes
-- are contract admin's remit; can be added later if needed).

INSERT INTO role_permissions (role, permission) VALUES
  ('contract_admin', 'user.update_pay_rate'),
  ('contract_admin', 'user.update_bill_rate')
ON CONFLICT DO NOTHING;
