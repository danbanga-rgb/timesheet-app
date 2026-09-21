#!/usr/bin/env node
// Pre-migration analyzer for Slice V1. Read-only.
//
// Answers: given current qb_vendor_mappings + invoice history, what would
// the backfill do post-migration? Which rows get clean pp_id? Which are
// orphans (multi-pp)? For each orphan, produce candidate per-pp rows.
//
// Output: JSON report + a ready-to-run SQL script that Dan can review
// and apply as one atomic package after the migration lands.
//
// Usage: SUPABASE_PAT=<token> node pre-migration-analysis.cjs

const https = require('https');
const fs = require('fs');
const path = require('path');

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'mimlatvdwxqtgxrgcins';

if (!PAT) {
  console.error('SUPABASE_PAT env var required.');
  process.exit(1);
}

function query(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.message || parsed.error) reject(new Error(`SQL: ${JSON.stringify(parsed)}`));
          else resolve(parsed);
        } catch (e) { reject(new Error(`Parse: ${data.slice(0, 500)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function esc(s) { return String(s).replace(/'/g, "''"); }

async function main() {
  console.log('[pre-migration-analysis] Read-only. No writes.\n');

  // ─── Load mapping rows + vendor names ─────────────────────────────────────
  const mappingsRes = await query(`
    SELECT
      m.id, m.source, m.counterparty_pattern, m.qb_vendor_list_id,
      (SELECT data->>'name' FROM qb_mirror WHERE entity_kind='vendor' AND entity_ref = m.qb_vendor_list_id) AS current_vendor_name,
      m.default_target_kind, m.default_bank_account_list_id, m.default_expense_account_list_id
    FROM qb_vendor_mappings m
    ORDER BY m.source, m.counterparty_pattern;
  `);
  const mappings = mappingsRes.result || mappingsRes;
  console.log(`Loaded ${mappings.length} mapping rows.\n`);

  // ─── For each mapping, resolve pp candidates ─────────────────────────────
  const clean = [];    // one clean pp → simple backfill
  const orphans = [];  // multiple pps → need per-pp replacement rows
  const dormant = [];  // no matching invoices at all

  for (const m of mappings) {
    const invMatch = await query(`
      WITH ev_invs AS (
        SELECT DISTINCT unnest(matched_invoice_ids) AS invoice_id
        FROM qb_ingest_events
        WHERE source = '${esc(m.source)}' AND counterparty_raw = '${esc(m.counterparty_pattern)}'
          AND array_length(matched_invoice_ids, 1) > 0
      )
      SELECT
        pp_id,
        (SELECT p.name FROM profiles p WHERE p.id = user_id) AS contractor_name,
        (SELECT pp.qb_vendor_name FROM payment_profiles pp WHERE pp.id = pp_id) AS current_pp_vendor_name,
        invoice_count,
        sample_invoice_id
      FROM (
        SELECT
          (i.payment_profile->>'id')::int AS pp_id,
          i.user_id,
          COUNT(*) AS invoice_count,
          MIN(i.id) AS sample_invoice_id
        FROM ev_invs
        JOIN invoices i ON i.id = ev_invs.invoice_id
        WHERE i.payment_profile ? 'id'
        GROUP BY (i.payment_profile->>'id')::int, i.user_id
      ) grouped
      ORDER BY invoice_count DESC;
    `);
    const ppRows = invMatch.result || invMatch;

    if (ppRows.length === 0) {
      dormant.push(m);
      continue;
    }
    if (ppRows.length === 1) {
      clean.push({ mapping: m, pp: ppRows[0] });
      continue;
    }
    // Orphan: multiple pps use this pattern.
    // For each pp, look up which QB vendor its actual bills went to in mirror.
    const perPpTargets = [];
    for (const pp of ppRows) {
      const targetRes = await query(`
        SELECT
          qm.vendor_list_id,
          qm.data->>'name' AS vendor_name,
          COUNT(*) AS bill_count
        FROM invoices i
        JOIN qb_mirror qm ON qm.entity_kind='bill' AND qm.entity_ref = i.qb_bill_txn_id
        WHERE (i.payment_profile->>'id')::int = ${pp.pp_id}
          AND i.qb_bill_txn_id IS NOT NULL
        GROUP BY qm.vendor_list_id, qm.data->>'name'
        ORDER BY bill_count DESC
        LIMIT 3;
      `);
      const targets = targetRes.result || targetRes;
      perPpTargets.push({ ...pp, historical_targets: targets });
    }
    orphans.push({ mapping: m, pps: perPpTargets });
  }

  // ─── Build SQL package ────────────────────────────────────────────────────
  const sqlLines = [];
  sqlLines.push('-- ============================================================');
  sqlLines.push('-- Slice V1: pp_id migration + backfill + orphan cleanup');
  sqlLines.push('-- Generated: ' + new Date().toISOString());
  sqlLines.push('-- ============================================================');
  sqlLines.push('');
  sqlLines.push('BEGIN;');
  sqlLines.push('');
  sqlLines.push('-- Step 1: schema migration (from 20260921000000_qb_vendor_mappings_pp_id.sql)');
  sqlLines.push('ALTER TABLE public.qb_vendor_mappings');
  sqlLines.push('  ADD COLUMN IF NOT EXISTS pp_id bigint REFERENCES public.payment_profiles(id) ON DELETE SET NULL;');
  sqlLines.push('ALTER TABLE public.qb_vendor_mappings');
  sqlLines.push('  DROP CONSTRAINT IF EXISTS qb_vendor_mappings_source_counterparty_pattern_key;');
  sqlLines.push('ALTER TABLE public.qb_vendor_mappings');
  sqlLines.push('  ADD CONSTRAINT qb_vendor_mappings_pp_id_key UNIQUE (pp_id);');
  sqlLines.push('');
  sqlLines.push(`-- Step 2: backfill ${clean.length} clean single-pp rows`);
  for (const c of clean) {
    sqlLines.push(`UPDATE qb_vendor_mappings SET pp_id = ${c.pp.pp_id} WHERE id = ${c.mapping.id};  -- ${c.pp.contractor_name} (${c.pp.invoice_count} invoices)`);
  }
  sqlLines.push('');
  sqlLines.push(`-- Step 3: orphan cleanup — ${orphans.length} mapping row(s) misroute across contractors`);
  for (const o of orphans) {
    sqlLines.push('');
    sqlLines.push(`-- Orphan id=${o.mapping.id}: "${o.mapping.counterparty_pattern}" was routing everyone to "${o.mapping.current_vendor_name || o.mapping.qb_vendor_list_id}"`);
    sqlLines.push(`DELETE FROM qb_vendor_mappings WHERE id = ${o.mapping.id};`);
    for (const pp of o.pps) {
      const target = pp.historical_targets[0];
      if (!target) {
        sqlLines.push(`-- SKIP: pp_id=${pp.pp_id} (${pp.contractor_name}) has no historical bills in qb_mirror — no target inferred. Add mapping manually.`);
        continue;
      }
      const targetName = (target.vendor_name || '').replace(/'/g, "''");
      const sourceQuoted = esc(o.mapping.source);
      const patternQuoted = esc(o.mapping.counterparty_pattern);
      const kind = o.mapping.default_target_kind || 'bill_pmt';
      const bank = o.mapping.default_bank_account_list_id ? `'${esc(o.mapping.default_bank_account_list_id)}'` : 'NULL';
      const exp = o.mapping.default_expense_account_list_id ? `'${esc(o.mapping.default_expense_account_list_id)}'` : 'NULL';
      sqlLines.push(`INSERT INTO qb_vendor_mappings (source, counterparty_pattern, pp_id, qb_vendor_list_id, default_target_kind, default_bank_account_list_id, default_expense_account_list_id)`);
      sqlLines.push(`  VALUES ('${sourceQuoted}', '${patternQuoted}', ${pp.pp_id}, '${target.vendor_list_id}', '${kind}', ${bank}, ${exp});`);
      sqlLines.push(`  -- ${pp.contractor_name} · pp=${pp.pp_id} → ${targetName} (${target.bill_count} historical bills)`);
    }
  }
  sqlLines.push('');
  sqlLines.push(`-- Step 4: ${dormant.length} dormant mapping(s) with no matching invoices — left alone (pp_id stays NULL)`);
  for (const m of dormant.slice(0, 15)) {
    sqlLines.push(`-- dormant: id=${m.id} · ${m.source}::${m.counterparty_pattern}`);
  }
  if (dormant.length > 15) sqlLines.push(`-- ... and ${dormant.length - 15} more dormant rows`);
  sqlLines.push('');
  sqlLines.push('-- Verify counts before COMMIT');
  sqlLines.push('SELECT');
  sqlLines.push(`  (SELECT COUNT(*) FROM qb_vendor_mappings)                                    AS total_after,`);
  sqlLines.push(`  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NOT NULL)            AS pp_id_populated,`);
  sqlLines.push(`  (SELECT COUNT(*) FROM qb_vendor_mappings WHERE pp_id IS NULL)                AS legacy_null;`);
  sqlLines.push('');
  sqlLines.push('COMMIT;');
  sqlLines.push('-- ROLLBACK; -- uncomment above COMMIT to preview without committing');

  // ─── Write outputs ────────────────────────────────────────────────────────
  const outDir = path.dirname(__filename);
  const jsonPath = path.join(outDir, 'v1-plan.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), clean, orphans, dormant: dormant.map(m => ({ id: m.id, source: m.source, counterparty_pattern: m.counterparty_pattern })) }, null, 2));
  const sqlPath = path.join(outDir, 'v1-plan.sql');
  fs.writeFileSync(sqlPath, sqlLines.join('\n'));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total mappings: ${mappings.length}`);
  console.log(`  Clean single-pp → auto-backfill: ${clean.length}`);
  console.log(`  Orphans (multi-pp, need cleanup): ${orphans.length}`);
  console.log(`  Dormant (no matching invoices): ${dormant.length}`);
  console.log(`\n✓ Wrote ${jsonPath}`);
  console.log(`✓ Wrote ${sqlPath}`);

  if (orphans.length > 0) {
    console.log(`\n=== ORPHAN DETAILS ===`);
    for (const o of orphans) {
      console.log(`\nid=${o.mapping.id} · ${o.mapping.source} · "${o.mapping.counterparty_pattern}"`);
      console.log(`  Currently routes to: ${o.mapping.current_vendor_name || o.mapping.qb_vendor_list_id}`);
      console.log(`  ${o.pps.length} distinct pps use this wire memo:`);
      for (const pp of o.pps) {
        const t = pp.historical_targets[0];
        console.log(`    pp=${pp.pp_id} · ${pp.contractor_name} · ${pp.invoice_count} invoices → target ${t ? `${t.vendor_name} (${t.bill_count} bills)` : 'NONE (needs manual mapping)'}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
