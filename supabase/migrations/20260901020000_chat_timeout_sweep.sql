-- Slice 5: pg_cron sweep to auto-cancel expired chat conversations.
--
-- Two timeout policies (LOCKED in plan doc):
--   collecting            → 60 min of silence → auto-cancel
--   awaiting_confirmation → 30 min of silence → auto-cancel
--
-- expires_at is set by the chat-parse edge fn when transitioning into those
-- phases. This sweep just checks expires_at and marks stale rows cancelled.

CREATE OR REPLACE FUNCTION chat_expire_stale_conversations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  expired_row RECORD;
BEGIN
  FOR expired_row IN
    SELECT id, user_id
    FROM chat_conversations
    WHERE expires_at IS NOT NULL
      AND expires_at < now()
      AND phase IN ('collecting', 'awaiting_confirmation', 'parsing', 'executing')
  LOOP
    -- Write a bot message explaining the expiration.
    INSERT INTO chat_messages (conversation_id, direction, content)
    VALUES (expired_row.id, 'out',
      'Session expired. Nothing was done. Send a new message to start over.');

    -- Transition to cancelled.
    UPDATE chat_conversations
    SET phase = 'cancelled', last_activity_at = now()
    WHERE id = expired_row.id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION chat_expire_stale_conversations() IS
  'Sweep for chat_conversations past expires_at. Called by pg_cron every 5 min.';

-- Schedule the sweep. Every 5 minutes is enough — timeouts are 30-60min so
-- worst-case a user sees expiration 5min late, which is fine.
SELECT cron.schedule(
  'chat-timeout-sweep',
  '*/5 * * * *',
  $$SELECT chat_expire_stale_conversations();$$
);
