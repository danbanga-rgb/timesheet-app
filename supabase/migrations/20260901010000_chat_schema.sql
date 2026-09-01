-- Chat bot Phase 1 schema — Slice 1.
--
-- profiles: chat_enabled + passkey enrollment fields.
-- chat_conversations: one active per user, holds state-machine phase + captured JSON.
-- chat_messages: every inbound/outbound turn logged with parsed intent + action taken.
-- chat_actions: every executed action for audit + rollback context.
-- chat_allowlist_audit: append-only log of enable/disable/passkey events.
--
-- RLS per rls-on-new-tables rule — no table lands without policies.

ALTER TABLE profiles
  ADD COLUMN chat_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN chat_passkey_id text,
  ADD COLUMN chat_passkey_registered_at timestamptz;

COMMENT ON COLUMN profiles.chat_enabled IS
  'Hard allowlist gate for chat surface. Admin flips manually.';
COMMENT ON COLUMN profiles.chat_passkey_id IS
  'WebAuthn credential ID enrolled by user for chat surface. NULL until enrolled or after admin-reset.';

-- ─────────────────────────────────────────────────────────────
-- chat_allowlist_audit — append-only log of enable/disable/passkey events
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_allowlist_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  action text NOT NULL CHECK (action IN ('enabled', 'disabled', 'passkey_registered', 'passkey_revoked')),
  changed_by uuid NOT NULL REFERENCES profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
CREATE INDEX chat_allowlist_audit_user_idx ON chat_allowlist_audit(user_id, changed_at DESC);

ALTER TABLE chat_allowlist_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_allowlist_audit_read_admin ON chat_allowlist_audit
  FOR SELECT USING (has_permission(auth.uid(), 'role_permissions.manage') OR auth.uid() = user_id);
CREATE POLICY chat_allowlist_audit_write_admin ON chat_allowlist_audit
  FOR INSERT WITH CHECK (has_permission(auth.uid(), 'role_permissions.manage'));

-- ─────────────────────────────────────────────────────────────
-- chat_conversations — one per active user session
-- Enforced as one-active-per-user via partial unique index below.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  intent text,                                      -- current intent name, NULL when idle
  captured jsonb NOT NULL DEFAULT '{}'::jsonb,      -- fields collected so far
  missing_field text,                               -- field currently being asked
  phase text NOT NULL DEFAULT 'idle'
    CHECK (phase IN ('idle', 'parsing', 'collecting', 'awaiting_confirmation', 'executing', 'done', 'cancelled', 'error')),
  started_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_conv_user_idx ON chat_conversations(user_id, phase);
CREATE INDEX chat_conv_expires_idx ON chat_conversations(expires_at)
  WHERE phase NOT IN ('idle', 'done', 'cancelled', 'error');
-- Only one non-terminal conversation per user at a time.
CREATE UNIQUE INDEX chat_conv_one_active_per_user
  ON chat_conversations(user_id)
  WHERE phase NOT IN ('done', 'cancelled', 'error');

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_conv_own ON chat_conversations
  FOR ALL
  USING (auth.uid() = user_id OR has_permission(auth.uid(), 'role_permissions.manage'))
  WITH CHECK (auth.uid() = user_id OR has_permission(auth.uid(), 'role_permissions.manage'));

-- ─────────────────────────────────────────────────────────────
-- chat_messages — every turn logged
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  content text NOT NULL,
  parsed_intent jsonb,                             -- LLM output for inbound msgs (intent + entities + confidence)
  action_taken jsonb,                              -- bot's response metadata (e.g. buttons rendered, prompt sent)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_conv_idx ON chat_messages(conversation_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_messages_via_conv ON chat_messages
  FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE user_id = auth.uid() OR has_permission(auth.uid(), 'role_permissions.manage')
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE user_id = auth.uid() OR has_permission(auth.uid(), 'role_permissions.manage')
    )
  );

-- ─────────────────────────────────────────────────────────────
-- chat_actions — every executed action (write-side) for audit
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chat_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id),
  actor_user_id uuid NOT NULL REFERENCES profiles(id),  -- who initiated (chat sender)
  action_type text NOT NULL,                            -- 'user.create', 'user.set_end_date', etc.
  action_input jsonb NOT NULL,                          -- final captured values sent to executor
  action_output jsonb,                                  -- executor response (success payload or error)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'success', 'partial', 'failed', 'cancelled')),
  attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_actions_actor_idx ON chat_actions(actor_user_id, created_at DESC);
CREATE INDEX chat_actions_conv_idx ON chat_actions(conversation_id, created_at);

ALTER TABLE chat_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_actions_own_or_admin ON chat_actions
  FOR SELECT USING (auth.uid() = actor_user_id OR has_permission(auth.uid(), 'role_permissions.manage'));
CREATE POLICY chat_actions_own_write ON chat_actions
  FOR INSERT WITH CHECK (auth.uid() = actor_user_id);
CREATE POLICY chat_actions_own_update ON chat_actions
  FOR UPDATE
  USING (auth.uid() = actor_user_id OR has_permission(auth.uid(), 'role_permissions.manage'))
  WITH CHECK (auth.uid() = actor_user_id OR has_permission(auth.uid(), 'role_permissions.manage'));
