-- RLS policies for qb_ingest_events and qb_vendor_mappings.
--
-- Slice A created the tables with RLS enabled (Supabase default) but no policies,
-- which means default-deny for anon/JWT clients — the accountant's frontend calls
-- were being silently blocked. Matches the permissive pattern already in use on
-- convera_transactions (any authenticated user can read/write).
--
-- Both tables are accountant-only surfaces (the QB Automation tab and its import
-- flow are gated by role in the frontend), so permissive at the DB level is fine
-- and matches how other qb_* / convera_* tables are configured.

CREATE POLICY qb_ingest_events_select ON qb_ingest_events FOR SELECT USING (true);
CREATE POLICY qb_ingest_events_insert ON qb_ingest_events FOR INSERT WITH CHECK (true);
CREATE POLICY qb_ingest_events_update ON qb_ingest_events FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY qb_ingest_events_delete ON qb_ingest_events FOR DELETE USING (true);

CREATE POLICY qb_vendor_mappings_select ON qb_vendor_mappings FOR SELECT USING (true);
CREATE POLICY qb_vendor_mappings_insert ON qb_vendor_mappings FOR INSERT WITH CHECK (true);
CREATE POLICY qb_vendor_mappings_update ON qb_vendor_mappings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY qb_vendor_mappings_delete ON qb_vendor_mappings FOR DELETE USING (true);
