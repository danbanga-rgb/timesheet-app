-- Slice V1 — QB Automation v2 mapping key migration.
--
-- Adds pp_id (payment_profile FK) as the primary lookup key for
-- qb_vendor_mappings. Fixes the "NATIVE TEAMS LIMITED → Buzalko for everyone"
-- misrouting bug where counterparty_pattern (wire memo) is identical across
-- every contractor using the same payment method.
--
-- Empirical baseline (2026-09-21 historical seed):
--   - payment_profile is strictly 1:1 with contractor.
--   - (contractor, pp) → QB vendor is deterministic in history.
--   - Only Teal is a true multi-contractor QB vendor.
-- Therefore pp_id alone is a safe unique key. See [[qb-vendor-mapping-truths-2026-09]].
--
-- Migration steps:
--   1. Add pp_id column (nullable — legacy rows keep working via counterparty_pattern).
--   2. Drop the old UNIQUE (source, counterparty_pattern). This lets multiple
--      contractors share a wire memo pattern with different pp_ids — the whole
--      point of the fix. Without dropping, seed upserts would overwrite one
--      contractor's mapping with another's.
--   3. Add UNIQUE (pp_id) WHERE pp_id IS NOT NULL — partial unique so legacy
--      pp_id=null rows don't conflict, but future pp_id-scoped rows enforce 1:1.
--   4. Keep counterparty_pattern btree index for legacy fallback lookups.

ALTER TABLE public.qb_vendor_mappings
  ADD COLUMN IF NOT EXISTS pp_id bigint REFERENCES public.payment_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.qb_vendor_mappings
  DROP CONSTRAINT IF EXISTS qb_vendor_mappings_source_counterparty_pattern_key;

-- Plain UNIQUE (pp_id) — Postgres treats NULL as distinct from itself by
-- default (NULLS DISTINCT), so multiple legacy rows with pp_id=NULL coexist;
-- non-null pp_ids are enforced 1:1. This lets `ON CONFLICT (pp_id)` work
-- cleanly in upserts (partial indexes require WHERE clause in conflict target).
ALTER TABLE public.qb_vendor_mappings
  ADD CONSTRAINT qb_vendor_mappings_pp_id_key UNIQUE (pp_id);

COMMENT ON COLUMN public.qb_vendor_mappings.pp_id IS
  'Payment profile FK. Primary lookup key for classifier Pass 1 as of Slice V1 (2026-09-21). '
  'When set, this row applies to that specific pp regardless of counterparty_pattern. '
  'Fixes wire-memo-based mis-routing (e.g. "NATIVE TEAMS LIMITED" catching every contractor). '
  'See .claude/plans/qb-automation-v2.md §5.7 and memory [[qb-vendor-mapping-truths-2026-09]].';
