#!/usr/bin/env node
// Build the final V1 SQL package from v1-plan.json.
// Filters pp_id=0 (JSONB glitch — invoice.payment_profile has id=0 or missing).
// Real orphans (multi-real-pp) get per-pp cleanup rows.
// Fake orphans (same contractor with pp_id=0 noise) get backfilled to the real pp.

const fs = require('fs');
const path = require('path');

const plan = require('./v1-plan.json');
const outPath = path.join(__dirname, 'v1-final.sql');

// Reclassify orphans: pp_id=0 is invalid (JSONB glitch). Filter it out and
// re-examine: is the row a true orphan (multiple REAL pps) or just a false
// alarm (single real pp + pp=0 noise)?
const cleanBackfill = [];   // {mapping_id, pp_id, contractor, invoice_count}
const trueOrphans = [];     // {mapping, real_pps: [{pp_id, contractor, historical_target}]}

// From "clean" bucket in the JSON: rows with exactly one pp (may be pp=0 which is invalid).
for (const c of plan.clean) {
  if (c.pp.pp_id > 0) {
    cleanBackfill.push({
      mapping_id: c.mapping.id,
      pp_id: c.pp.pp_id,
      contractor: c.pp.contractor_name,
      invoice_count: c.pp.invoice_count,
    });
  } // else: pp=0-only row; leave dormant (no valid pp to backfill).
}

// From "orphans" bucket: filter pp>0, dedupe by contractor.
for (const o of plan.orphans) {
  const realPps = o.pps.filter(p => p.pp_id > 0);
  const uniqueContractors = new Set(realPps.map(p => p.contractor_name));

  if (realPps.length === 0) continue;

  if (uniqueContractors.size === 1) {
    // False orphan: same contractor, multiple pp records (pp=0 + real). Pick the real pp_id.
    // If multiple real pps for the same contractor exist, prefer the one with more invoices.
    realPps.sort((a, b) => b.invoice_count - a.invoice_count);
    const best = realPps[0];
    cleanBackfill.push({
      mapping_id: o.mapping.id,
      pp_id: best.pp_id,
      contractor: best.contractor_name,
      invoice_count: best.invoice_count,
    });
  } else {
    // True orphan: multiple real contractors on same wire memo. Need per-pp rows.
    trueOrphans.push({
      mapping: o.mapping,
      real_pps: realPps,
    });
  }
}

// ─── Build SQL ────────────────────────────────────────────────────────────
const lines = [];
lines.push('-- ============================================================');
lines.push('-- Slice V1: pp_id migration + backfill + orphan cleanup');
lines.push('-- Generated: ' + new Date().toISOString());
lines.push('-- ============================================================');
lines.push('--');
lines.push('-- Read-only preview: replace COMMIT with ROLLBACK at the bottom.');
lines.push('-- Apply for real: keep COMMIT.');
lines.push('--');
lines.push('-- Summary:');
lines.push(`--   Clean single-pp backfills (incl. false orphans deduped): ${cleanBackfill.length}`);
lines.push(`--   True orphan cleanups (multi-real-contractor wire memos): ${trueOrphans.length}`);
lines.push(`--   Dormant rows left alone (no matching invoices in ingest events): ${plan.dormant.length}`);
lines.push('');
lines.push('BEGIN;');
lines.push('');

lines.push('-- ─── Step 1: schema migration ─────────────────────────────────────────────');
lines.push('ALTER TABLE public.qb_vendor_mappings');
lines.push('  ADD COLUMN IF NOT EXISTS pp_id bigint REFERENCES public.payment_profiles(id) ON DELETE SET NULL;');
lines.push('');
lines.push('ALTER TABLE public.qb_vendor_mappings');
lines.push('  DROP CONSTRAINT IF EXISTS qb_vendor_mappings_source_counterparty_pattern_key;');
lines.push('');
lines.push('ALTER TABLE public.qb_vendor_mappings');
lines.push('  ADD CONSTRAINT qb_vendor_mappings_pp_id_key UNIQUE (pp_id);');
lines.push('');

lines.push(`-- ─── Step 2: backfill ${cleanBackfill.length} single-pp rows ────────────────────────`);
for (const b of cleanBackfill) {
  lines.push(`UPDATE qb_vendor_mappings SET pp_id = ${b.pp_id} WHERE id = ${b.mapping_id};  -- ${b.contractor} (${b.invoice_count} inv)`);
}
lines.push('');

lines.push(`-- ─── Step 3: true orphan cleanup (${trueOrphans.length} rows serving multiple contractors) ──`);
for (const o of trueOrphans) {
  const m = o.mapping;
  lines.push('');
  lines.push(`-- Orphan id=${m.id}: "${m.counterparty_pattern}"`);
  lines.push(`-- Currently routes EVERYONE to: ${m.current_vendor_name || m.qb_vendor_list_id}`);
  lines.push(`-- Splitting into ${o.real_pps.length} per-pp rows.`);
  lines.push(`DELETE FROM qb_vendor_mappings WHERE id = ${m.id};`);
  for (const pp of o.real_pps) {
    const target = pp.historical_targets[0];
    if (!target) {
      lines.push(`--   SKIP pp=${pp.pp_id} (${pp.contractor_name}): no historical bills to infer QB vendor from. Add manually.`);
      continue;
    }
    const src = m.source.replace(/'/g, "''");
    const pat = m.counterparty_pattern.replace(/'/g, "''");
    const kind = m.default_target_kind || 'bill_pmt';
    const bank = m.default_bank_account_list_id ? `'${m.default_bank_account_list_id}'` : 'NULL';
    const exp = m.default_expense_account_list_id ? `'${m.default_expense_account_list_id}'` : 'NULL';
    lines.push(`INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)`);
    lines.push(`  VALUES ('${src}', '${pat}', ${pp.pp_id}, '${target.vendor_list_id}', '${kind}', ${bank}, ${exp});  -- ${pp.contractor_name} · ${target.bill_count} historical bills`);
  }
}
lines.push('');

lines.push('-- ─── Verify before commit ────────────────────────────────────────────────');
lines.push('SELECT');
lines.push('  (SELECT COUNT(*) FROM qb_vendor_mappings)                             AS total_rows,');
lines.push('  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NOT NULL)     AS pp_id_populated,');
lines.push('  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NULL)         AS legacy_null_kept;');
lines.push('');
lines.push('COMMIT;');
lines.push('-- To preview without persisting: replace COMMIT above with ROLLBACK.');

fs.writeFileSync(outPath, lines.join('\n'));
console.log('=== Slice V1 SQL package ===');
console.log(`Clean single-pp backfills: ${cleanBackfill.length}`);
console.log(`True orphans (per-pp cleanup): ${trueOrphans.length}`);
console.log(`Dormant (untouched): ${plan.dormant.length}`);
console.log(`\nTrue orphans:`);
for (const o of trueOrphans) {
  console.log(`  id=${o.mapping.id} · "${o.mapping.counterparty_pattern.slice(0, 50)}" → ${o.real_pps.length} per-pp rows`);
  for (const pp of o.real_pps) {
    const t = pp.historical_targets[0];
    console.log(`    pp=${pp.pp_id} · ${pp.contractor_name} → ${t?.vendor_list_id || 'NO TARGET'}`);
  }
}
console.log(`\n✓ Wrote ${outPath}`);
