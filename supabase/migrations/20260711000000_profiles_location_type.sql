-- Adds a shore-classification column to profiles for contractors.
-- Values: 'onshore' | 'offshore'. Nullable = unclassified (admin action needed).
-- Seed: bill_rate <= 65 (from client_engagements) → offshore, else onshore.
-- Vendor managers, admins, accountants, managers left null (contractor concept only).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS location_type text
    CHECK (location_type IN ('onshore', 'offshore'));

UPDATE profiles p
SET location_type = CASE
  WHEN sub.max_rate <= 65 THEN 'offshore'
  ELSE 'onshore'
END
FROM (
  SELECT user_id, MAX(bill_rate) AS max_rate
  FROM client_engagements
  GROUP BY user_id
) sub
WHERE sub.user_id = p.id
  AND p.role = 'timesheetuser'
  AND p.location_type IS NULL;
