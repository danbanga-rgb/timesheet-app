-- Allow qb_vendor_mappings to reference payees that are NOT in the Vendors
-- list (e.g. QB OtherName entities like Lucien C Pinto who receive direct
-- Write-Check payments). qbXML CheckAdd's <PayeeEntityRef><FullName>
-- resolves across all payee-eligible lists (Vendor/Customer/Employee/
-- OtherName), so we only need the name — no ListID required.
--
-- After this migration:
--   - Rows with qb_vendor_list_id populated: existing pattern (payee is a Vendor)
--   - Rows with payee_full_name populated: OtherName / Employee / Customer payees
--   - CHECK ensures at least one is present.
--
-- payee_list_kind is documentation only (which QB list the payee lives in);
-- qbXML resolves by name regardless. Kept for auditability + future upgrade
-- to a full OtherName mirror if we accumulate more non-Vendor payees.

ALTER TABLE qb_vendor_mappings
  ALTER COLUMN qb_vendor_list_id DROP NOT NULL;

ALTER TABLE qb_vendor_mappings
  ADD COLUMN payee_full_name text;

ALTER TABLE qb_vendor_mappings
  ADD COLUMN payee_list_kind text CHECK (payee_list_kind IN
    ('Vendor','OtherName','Employee','Customer'));

ALTER TABLE qb_vendor_mappings
  ADD CONSTRAINT qb_vendor_mappings_payee_ref_present CHECK (
    qb_vendor_list_id IS NOT NULL OR payee_full_name IS NOT NULL
  );

COMMENT ON COLUMN qb_vendor_mappings.payee_full_name IS
  'Full name for qbXML PayeeEntityRef when payee is not in the Vendors list (e.g. OtherName). QB resolves the name across all payee-eligible lists.';
COMMENT ON COLUMN qb_vendor_mappings.payee_list_kind IS
  'Which QB list the payee lives in. Documentation only — qbXML resolves by name. Populated to aid audit + future retrofit if we mirror OtherName.';
