-- ============================================================
-- Slice V1: pp_id migration + backfill + orphan cleanup
-- Generated: 2026-09-21T19:13:33.956Z
-- ============================================================
--
-- Read-only preview: replace COMMIT with ROLLBACK at the bottom.
-- Apply for real: keep COMMIT.
--
-- Summary:
--   Clean single-pp backfills (incl. false orphans deduped): 44
--   True orphan cleanups (multi-real-contractor wire memos): 3
--   Dormant rows left alone (no matching invoices in ingest events): 55

BEGIN;

-- ─── Step 1: schema migration ─────────────────────────────────────────────
ALTER TABLE public.qb_vendor_mappings
  ADD COLUMN IF NOT EXISTS pp_id bigint REFERENCES public.payment_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.qb_vendor_mappings
  DROP CONSTRAINT IF EXISTS qb_vendor_mappings_source_counterparty_pattern_key;

ALTER TABLE public.qb_vendor_mappings
  ADD CONSTRAINT qb_vendor_mappings_pp_id_key UNIQUE (pp_id);

-- ─── Step 2: backfill 44 single-pp rows ────────────────────────
UPDATE qb_vendor_mappings SET pp_id = 15 WHERE id = 73;  -- Antonio Samuga (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 16 WHERE id = 84;  -- Arpit Saxena (1 inv)
UPDATE qb_vendor_mappings SET pp_id = 39 WHERE id = 39;  -- Ismir Terzic (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 104 WHERE id = 102;  -- Tomislav Škoda (1 inv)
UPDATE qb_vendor_mappings SET pp_id = 61 WHERE id = 100;  -- Nikolina Radošević (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 48 WHERE id = 62;  -- Liya Haustova (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 40 WHERE id = 95;  -- Ivan Kusturić (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 38 WHERE id = 93;  -- Ismet Kovacevic (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 105 WHERE id = 78;  -- Branimir Asanović (1 inv)
UPDATE qb_vendor_mappings SET pp_id = 77 WHERE id = 103;  -- Vladimir Simsic (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 70 WHERE id = 70;  -- Urbano Gardun (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 10 WHERE id = 83;  -- Amar Cakic (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 9 WHERE id = 82;  -- Aleksandar Brajkovic (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 99 WHERE id = 3;  -- Sivakumar Gnanathilagam (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 23 WHERE id = 88;  -- Davor Buha (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 50 WHERE id = 63;  -- Luka Žagar (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 74 WHERE id = 104;  -- Zlatan Bekrić (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 72 WHERE id = 71;  -- Zejd Koco (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 68 WHERE id = 101;  -- Tarik Ahmetović (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 53 WHERE id = 65;  -- Marinela Sumanjski (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 59 WHERE id = 99;  -- Mirza Hukić (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 49 WHERE id = 98;  -- Luka Crnogorac (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 17 WHERE id = 85;  -- Boris Stupar (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 47 WHERE id = 61;  -- Kornelije Sajler (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 51 WHERE id = 64;  -- Marin Purgar (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 42 WHERE id = 96;  -- Ivica Zlatar (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 43 WHERE id = 97;  -- Izet Copelj (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 36 WHERE id = 91;  -- Haris Balavac (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 32 WHERE id = 89;  -- Enis Basic (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 29 WHERE id = 74;  -- Dzevad Alibegovic (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 41 WHERE id = 75;  -- Ivan Uršić (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 63 WHERE id = 67;  -- Sebastian Marjanović (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 45 WHERE id = 77;  -- Juran Dadić (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 65 WHERE id = 69;  -- Stefan Ruvčeski (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 64 WHERE id = 68;  -- Slaven Konforta (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 37 WHERE id = 92;  -- Imran Šehić (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 22 WHERE id = 87;  -- Damir Husadzic (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 58 WHERE id = 66;  -- Mensur Duraković (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 19 WHERE id = 86;  -- Bozhidar Bozhinovski (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 44 WHERE id = 76;  -- Josip Vrdoljak (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 34 WHERE id = 90;  -- Faruk Sinanovic (2 inv)
UPDATE qb_vendor_mappings SET pp_id = 98 WHERE id = 1;  -- Rumiya Hasnutdinova (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 97 WHERE id = 2;  -- Mek Attoh (3 inv)
UPDATE qb_vendor_mappings SET pp_id = 85 WHERE id = 6;  -- Ravi Prasad Reddy (2 inv)

-- ─── Step 3: true orphan cleanup (3 rows serving multiple contractors) ──

-- Orphan id=81: "NATIVE TEAMS LIMITED"
-- Currently routes EVERYONE to: Native Team - Ahmet Buzaljko
-- Splitting into 3 per-pp rows.
DELETE FROM qb_vendor_mappings WHERE id = 81;
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'NATIVE TEAMS LIMITED', 8, '80000534-1773282076', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Ahmet Buzaljko · 3 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'NATIVE TEAMS LIMITED', 83, '80000540-1784753966', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Nejra Muzaferija · 3 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'NATIVE TEAMS LIMITED', 62, '80000533-1773280895', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Predrag Simanic · 2 historical bills

-- Orphan id=72: "OBRTNICKA DJELATNOST D-KODE VL. KESTEN DENIZ"
-- Currently routes EVERYONE to: D-KODE o.d. vl deniz Kesten, Nikole -Amra
-- Splitting into 2 per-pp rows.
DELETE FROM qb_vendor_mappings WHERE id = 72;
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'OBRTNICKA DJELATNOST D-KODE VL. KESTEN DENIZ', 12, '80000410-1703573672', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Amra Adzamija · 2 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'OBRTNICKA DJELATNOST D-KODE VL. KESTEN DENIZ', 94, '80000528-1766722109', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Deniz Kesten · 2 historical bills

-- Orphan id=80: "POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA"
-- Currently routes EVERYONE to: Teal Crossroads
-- Splitting into 6 per-pp rows.
DELETE FROM qb_vendor_mappings WHERE id = 80;
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 7, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Strahinja Miljkovic · 2 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 2, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Dejan Tripic · 1 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 3, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Dusan Sancanin · 2 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 5, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Petar Vasev · 2 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 6, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Senad Ibrahimpašić · 2 historical bills
INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)
  VALUES ('convera', 'POSLOVNI REINZENJERING "TEAL CROSSROADS" ALEKSANDAR ALEKSIC S.P. BANJA LUKA', 95, '8000044B-1720027526', 'bill_pmt', '800000F5-1529957073', '600000-1142369998');  -- Damjan Stojanovski · 2 historical bills

-- ─── Verify before commit ────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM qb_vendor_mappings)                             AS total_rows,
  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NOT NULL)     AS pp_id_populated,
  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NULL)         AS legacy_null_kept;

COMMIT;
-- To preview without persisting: replace COMMIT above with ROLLBACK.