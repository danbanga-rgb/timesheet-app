-- SLO alerting state table
-- Tracks per-SLO breach/alert history for frequency capping

CREATE TABLE IF NOT EXISTS public.system_alerts_state (
  slo_key              TEXT PRIMARY KEY,
  last_breached_at     TIMESTAMPTZ,
  last_alerted_at      TIMESTAMPTZ,
  consecutive_breaches INT NOT NULL DEFAULT 0
);

-- Service role only — no public access
ALTER TABLE public.system_alerts_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.system_alerts_state TO service_role;
