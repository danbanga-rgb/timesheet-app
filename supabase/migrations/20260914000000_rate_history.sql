-- rate_history — audit trail for pay and bill rate changes.
--
-- Scope: single source of truth for "what does user X currently pay/bill?"
-- Two kinds:
--   pay  — what we pay the contractor (before: derived from most recent invoice)
--   bill — what we charge the client (before: client_engagements.bill_rate)
--
-- Effective range model: effective_from is required; effective_to NULL = current.
-- Setting a new rate closes the current row (effective_to = new effective_from)
-- and inserts a new row. Backdated corrections are supported by inserting with
-- older effective_from; readers pick the row whose range covers "today".
--
-- Backfill:
--   pay:  one row per user with an invoice history — rate = most recent invoices.rate.
--         effective_from = the invoice's period_start.
--   bill: one row per current client_engagements (effective_to IS NULL) — rate = bill_rate.
--         effective_from = engagement's effective_from.
-- Everything historical prior to first entry is treated as unknown — no bogus rows.

CREATE TABLE rate_history (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rate_kind text NOT NULL CHECK (rate_kind IN ('pay', 'bill')),
  rate numeric(10, 2) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  effective_to date,                                   -- NULL = current
  client_engagement_id int REFERENCES client_engagements(id),  -- optional link for bill rows
  source text NOT NULL,                                -- 'chat:user.create', 'chat:user.update_pay_rate', 'admin:profile-edit', 'backfill:invoices', ...
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  notes text,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX rate_history_user_kind_idx
  ON rate_history(user_id, rate_kind, effective_from DESC);

CREATE INDEX rate_history_current_idx
  ON rate_history(user_id, rate_kind)
  WHERE effective_to IS NULL;

COMMENT ON TABLE rate_history IS
  'Audit trail for pay and bill rate changes. Single source of truth via effective_from/to ranges.';

-- RLS: readable by chat-parse (service role) + admin/contract_admin via has_permission;
-- writes only from executors (service role) — normal users can''t insert.
ALTER TABLE rate_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY rate_history_read_admin ON rate_history
  FOR SELECT USING (
    has_permission(auth.uid(), 'role_permissions.manage')
    OR has_permission(auth.uid(), 'user.get')
    OR auth.uid() = user_id
  );

-- No end-user INSERT/UPDATE/DELETE policies — writes flow only through the
-- service-role executor. Admin edits go through the chat intents or a
-- future admin-UI flow that runs with elevated privileges.

-- ─────────────────────────────────────────────────────────────
-- Backfill — SEED CURRENT RATES
-- ─────────────────────────────────────────────────────────────

-- Pay: most recent invoice per user with a non-null rate.
INSERT INTO rate_history (user_id, rate_kind, rate, effective_from, source, created_at, notes)
SELECT
  latest.user_id,
  'pay',
  latest.rate,
  latest.period_start,
  'backfill:invoices',
  now(),
  'Seeded from most recent invoice at migration time.'
FROM (
  SELECT DISTINCT ON (user_id)
    user_id, rate, period_start
  FROM invoices
  WHERE rate IS NOT NULL AND user_id IS NOT NULL
  ORDER BY user_id, period_start DESC, id DESC
) latest;

-- Bill: current client engagements (effective_to IS NULL) with non-null bill_rate.
INSERT INTO rate_history (user_id, rate_kind, rate, effective_from, client_engagement_id, source, created_at, notes)
SELECT
  ce.user_id,
  'bill',
  ce.bill_rate,
  COALESCE(ce.effective_from, ce.created_at::date, DATE '2026-04-27'),
  ce.id,
  'backfill:client_engagements',
  now(),
  'Seeded from current client_engagement at migration time.'
FROM client_engagements ce
WHERE ce.effective_to IS NULL AND ce.bill_rate IS NOT NULL;
