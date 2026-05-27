CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; anon key needs explicit policies for poller writes
CREATE POLICY "anon_read" ON system_settings
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_poller_heartbeat" ON system_settings
  FOR INSERT TO anon WITH CHECK (key = 'poller_last_run');

CREATE POLICY "anon_update_poller_heartbeat" ON system_settings
  FOR UPDATE TO anon USING (key = 'poller_last_run');

ALTER TABLE email_import_log ADD COLUMN IF NOT EXISTS run_id TEXT;
CREATE INDEX IF NOT EXISTS email_import_log_run_id_idx ON email_import_log (run_id);
