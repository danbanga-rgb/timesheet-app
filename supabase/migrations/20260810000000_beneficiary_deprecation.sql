-- Beneficiary deprecation + replacement chain for Convera routing safety.
--
-- Problem: Bimosoft had 4 deprecated Convera beneficiaries (153/157/158/162, all pooling at
-- IE Revolut IE18REVO99036092001905) that funds were mistakenly routed to. Fix: schema-driven
-- deprecation with replacement pointer so consumers can walk to the correct live beneficiary.
--
-- Future-proof: when the current UK ALT beneficiary (156) itself gets replaced, deprecate it
-- and set its replacement_beneficiary_id to the new target. resolve_beneficiary() walks the chain.

ALTER TABLE convera_beneficiaries
  ADD COLUMN IF NOT EXISTS deprecated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deprecated_reason text,
  ADD COLUMN IF NOT EXISTS replacement_beneficiary_id integer REFERENCES convera_beneficiaries(id),
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

-- Chain resolver. Returns final non-deprecated bene id, or NULL if chain terminates without one
-- (or exceeds 10 hops — cycle guard).
CREATE OR REPLACE FUNCTION resolve_beneficiary(input_id integer)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  cur integer := input_id;
  next_id integer;
  is_dep boolean;
  hops integer := 0;
BEGIN
  IF cur IS NULL THEN RETURN NULL; END IF;
  LOOP
    hops := hops + 1;
    IF hops > 10 THEN RETURN NULL; END IF;
    SELECT deprecated, replacement_beneficiary_id
      INTO is_dep, next_id
      FROM convera_beneficiaries WHERE id = cur;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT is_dep THEN RETURN cur; END IF;
    IF next_id IS NULL THEN RETURN NULL; END IF;
    cur := next_id;
  END LOOP;
END;
$$;

-- Seed the 4 wrong Bimosoft beneficiaries. All redirect to 156 (BIMOSOFT UK ALT).
UPDATE convera_beneficiaries
SET deprecated = true,
    deprecated_reason = 'Deprecated Bimosoft beneficiary — funds route to wrong IE Revolut pool. Use replacement (BIMOSOFT UK ALT, bene 156).',
    replacement_beneficiary_id = 156,
    deprecated_at = now()
WHERE id IN (153, 157, 158, 162)
  AND deprecated = false;

-- Some beneficiaries settle a single wire covering multiple contractors (umbrella
-- payments — e.g. Bimosoft UK ALT bundles Amar/Anela/Fadil/Naretena/Edin into one
-- Convera transaction). force_combine forces the batch export to always combine
-- entries for these benes into one wire — accountant can't accidentally split.
ALTER TABLE convera_beneficiaries
  ADD COLUMN IF NOT EXISTS force_combine boolean NOT NULL DEFAULT false;

UPDATE convera_beneficiaries SET force_combine = true WHERE id = 156 AND force_combine = false;
