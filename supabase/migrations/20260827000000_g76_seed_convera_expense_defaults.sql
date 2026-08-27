-- G7.6 seed: default_expense_account_list_id for Convera vendors with open
-- invoices. Defaults to Vendor Consultants (600000-1142369998) per
-- [[qb-expense-account-conventions]] (verified 2026-08-26 on all 4 Case A
-- vendors; matches accountant's IIF/manual convention).
--
-- Motivation: G7.6 proactive create_bill needs a mapping row per vendor
-- with default_expense_account_list_id populated before the consumer emits
-- the intent. Without this seed, all 55 open Convera invoices would drop
-- with the "no default_expense_account_list_id" ineligibility reason.
--
-- Idempotency:
--   - Existing mapping row for the vendor with the expense already set: no-op
--   - Existing mapping row with NULL default_expense_account_list_id: UPDATE
--     to the seed value (targets ANY row for the vendor; qb_vendor_mappings
--     unique-scopes to (source, counterparty_pattern), so a vendor can have
--     multiple mapping rows across sources — the seed touches all null ones)
--   - No mapping row for the vendor at all: INSERT (source='convera',
--     counterparty_pattern=<vendor.name>) with the seed expense
--
-- Safe to re-run. Only touches vendors that currently have an open Convera
-- invoice — future onboardings will pick up their own seed on the next run.

DO $$
DECLARE
  seed_expense_id      text := '600000-1142369998';   -- Vendor Consultants
  target_vendors       CURSOR FOR
    SELECT DISTINCT
      v.list_id AS vendor_list_id,
      v.name    AS vendor_name
    FROM qb_vendors v
    JOIN payment_profiles pp
      ON pp.qb_vendor_name = v.name
    JOIN invoices inv
      ON inv.user_id = pp.user_id
     AND inv.status = 'approved'
     AND inv.qb_bill_txn_id IS NULL
     AND inv.payment_method = 'Convera'
     AND inv.period_end >= DATE '2026-04-28';
  rec                  RECORD;
  updated_ct           int;
  any_row_id           bigint;
  inserted_ct          int := 0;
  updated_total_ct     int := 0;
  no_op_ct             int := 0;
BEGIN
  FOR rec IN target_vendors LOOP
    -- Step 1: fill in NULL expenses on any existing rows for this vendor.
    UPDATE qb_vendor_mappings
       SET default_expense_account_list_id = seed_expense_id,
           updated_at = now()
     WHERE qb_vendor_list_id = rec.vendor_list_id
       AND default_expense_account_list_id IS NULL;
    GET DIAGNOSTICS updated_ct = ROW_COUNT;
    IF updated_ct > 0 THEN
      updated_total_ct := updated_total_ct + 1;
      CONTINUE;
    END IF;

    -- Step 2: does any mapping row exist for this vendor at all?
    SELECT id INTO any_row_id
      FROM qb_vendor_mappings
     WHERE qb_vendor_list_id = rec.vendor_list_id
     LIMIT 1;

    IF any_row_id IS NOT NULL THEN
      -- Row exists AND already has expense set — nothing to do.
      no_op_ct := no_op_ct + 1;
      CONTINUE;
    END IF;

    -- Step 3: no row at all — seed one keyed to source='convera'.
    -- ON CONFLICT covers the rare race with a concurrent ingest classifier.
    INSERT INTO qb_vendor_mappings (
      source,
      counterparty_pattern,
      qb_vendor_list_id,
      default_expense_account_list_id
    ) VALUES (
      'convera',
      rec.vendor_name,
      rec.vendor_list_id,
      seed_expense_id
    )
    ON CONFLICT (source, counterparty_pattern) DO UPDATE
      SET default_expense_account_list_id
            = COALESCE(qb_vendor_mappings.default_expense_account_list_id,
                       EXCLUDED.default_expense_account_list_id),
          updated_at = now();
    inserted_ct := inserted_ct + 1;
  END LOOP;

  RAISE NOTICE 'G7.6 seed: inserted=% updated=% no_op=%', inserted_ct, updated_total_ct, no_op_ct;
END $$;
