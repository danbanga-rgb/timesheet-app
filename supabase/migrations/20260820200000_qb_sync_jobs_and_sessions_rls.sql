-- RLS policies for qb_sync_jobs and qb_wc_sessions.
--
-- Both tables were created before we tracked migrations here (or at least
-- before the RLS conversation started). Both have RLS enabled at the DB
-- level but no policies for the anon/authenticated JWT the frontend uses.
--
-- Blockers surfaced 2026-08-20:
--   - qb_sync_jobs: Slice G1 "Sync QB state" button needs INSERT to enqueue
--     bill_query jobs from the accountant's browser. Was 42501 blocked.
--   - qb_wc_sessions: G1 UI wants to display QBWC heartbeat (freshness +
--     "next poll in ~5m") which requires reading MAX(last_seen_at).
--
-- Same permissive pattern as qb_ingest_events, qb_vendor_mappings, and
-- qb_open_bills_snapshot — accountant-only surfaces gated at the UI layer.

CREATE POLICY qb_sync_jobs_select ON qb_sync_jobs FOR SELECT USING (true);
CREATE POLICY qb_sync_jobs_insert ON qb_sync_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY qb_sync_jobs_update ON qb_sync_jobs FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY qb_wc_sessions_select ON qb_wc_sessions FOR SELECT USING (true);
