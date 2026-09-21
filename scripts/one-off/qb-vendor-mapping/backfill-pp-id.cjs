#!/usr/bin/env node
// Slice V1 backfill: populate qb_vendor_mappings.pp_id from historical invoice data.
//
// Strategy: for each existing mapping row (source, counterparty_pattern),
// find invoices whose counterparty_raw matches AND look at the resolved
// payment_profile. If all matched invoices resolve to the SAME pp_id, backfill it.
// If they resolve to different pp_ids (this is exactly the Buzalko bug — one
// counterparty_pattern being used for many contractors), report as ORPHAN and
// don't backfill. Dan reviews orphans and manually creates per-pp mappings.
//
// Usage:
//   DRY_RUN=1 node backfill-pp-id.cjs   # default — prints plan, no writes
//   DRY_RUN=0 node backfill-pp-id.cjs   # writes pp_id updates
//
// Read-only unless DRY_RUN=0.

const https = require('https');
const fs = require('fs');
const path = require('path');

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'mimlatvdwxqtgxrgcins';
const DRY_RUN = process.env.DRY_RUN !== '0';

if (!PAT) {
  console.error('SUPABASE_PAT env var required. Grab it from Supabase Dashboard > Account > Tokens.');
  console.error('Usage: SUPABASE_PAT=<token> node scripts/one-off/qb-vendor-mapping/backfill-pp-id.cjs');
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
          if (parsed.message || parsed.error) reject(new Error(`SQL error: ${JSON.stringify(parsed)}`));
          else resolve(parsed);
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function esc(s) { return String(s).replace(/'/g, "''"); }

async function main() {
  console.log(`[backfill-pp-id] DRY_RUN=${DRY_RUN ? 'true (no writes)' : 'false — WILL WRITE'}\n`);

  // ─── 1. Load all mapping rows ─────────────────────────────────────────────
  const mappings = await query(`
    SELECT id, source, counterparty_pattern, qb_vendor_list_id, pp_id
    FROM qb_vendor_mappings
    ORDER BY source, counterparty_pattern;
  `);
  const rows = mappings.result || mappings;
  console.log(`Loaded ${rows.length} mapping rows.\n`);

  // ─── 2. For each mapping row, resolve invoices matching its counterparty_pattern ─
  //     → collect distinct pp_ids used by those invoices.
  const backfillPlan = [];   // {id, pp_id, sample_invoice_ids, sample_user_names}
  const orphans = [];        // {id, pattern, distinct_pp_ids, distinct_users}
  const alreadySet = [];     // already have pp_id
  const noMatchingInvoices = []; // no invoices match this pattern

  for (const m of rows) {
    if (m.pp_id != null) {
      alreadySet.push(m);
      continue;
    }

    // Match invoices via ingest events whose counterparty_raw matches this pattern
    // (both directions: exact match, and each pattern is what the classifier compared against).
    const matches = await query(`
      WITH candidate_events AS (
        SELECT DISTINCT e.matched_invoice_ids
        FROM qb_ingest_events e
        WHERE e.source = '${esc(m.source)}'
          AND e.counterparty_raw = '${esc(m.counterparty_pattern)}'
          AND array_length(e.matched_invoice_ids, 1) > 0
      ),
      inv_ids AS (
        SELECT DISTINCT unnest(matched_invoice_ids) AS invoice_id FROM candidate_events
      )
      SELECT
        (i.payment_profile->>'id')::int AS pp_id,
        (SELECT p.name FROM profiles p WHERE p.id = i.user_id) AS contractor_name,
        i.id AS invoice_id
      FROM inv_ids
      JOIN invoices i ON i.id = inv_ids.invoice_id
      WHERE i.payment_profile ? 'id';
    `);
    const invRows = matches.result || matches;

    if (invRows.length === 0) {
      noMatchingInvoices.push(m);
      continue;
    }

    // Group by pp_id
    const byPp = new Map();
    for (const r of invRows) {
      const pp = r.pp_id;
      if (!byPp.has(pp)) byPp.set(pp, { count: 0, users: new Set(), invoices: [] });
      const bucket = byPp.get(pp);
      bucket.count++;
      bucket.users.add(r.contractor_name);
      if (bucket.invoices.length < 3) bucket.invoices.push(r.invoice_id);
    }

    const distinctPps = [...byPp.keys()];
    if (distinctPps.length === 1) {
      // Clean single-pp resolution → backfill.
      const pp = distinctPps[0];
      const bucket = byPp.get(pp);
      backfillPlan.push({
        id: m.id,
        source: m.source,
        pattern: m.counterparty_pattern,
        pp_id: pp,
        sample_users: [...bucket.users].slice(0, 3),
        sample_invoice_ids: bucket.invoices,
        invoice_count: bucket.count,
      });
    } else {
      // Multiple pps use this counterparty_pattern → THIS IS THE BUZALKO CASE.
      orphans.push({
        id: m.id,
        source: m.source,
        pattern: m.counterparty_pattern,
        qb_vendor_list_id: m.qb_vendor_list_id,
        distinct_pp_count: distinctPps.length,
        pps: distinctPps.map(pp => ({
          pp_id: pp,
          users: [...byPp.get(pp).users],
          invoice_count: byPp.get(pp).count,
          sample_invoice_ids: byPp.get(pp).invoices,
        })),
      });
    }
  }

  // ─── 3. Report ────────────────────────────────────────────────────────────
  console.log(`\n=== BACKFILL PLAN ===`);
  console.log(`Total mappings: ${rows.length}`);
  console.log(`  Already have pp_id: ${alreadySet.length}`);
  console.log(`  No matching invoices (dormant / seed rows): ${noMatchingInvoices.length}`);
  console.log(`  Clean single-pp → will backfill: ${backfillPlan.length}`);
  console.log(`  ORPHANS (Buzalko-class — multi-pp for one pattern): ${orphans.length}\n`);

  if (backfillPlan.length > 0) {
    console.log(`--- Rows to backfill ---`);
    for (const b of backfillPlan.slice(0, 20)) {
      console.log(`  id=${b.id} · ${b.source}::${b.pattern.slice(0, 40)} → pp_id=${b.pp_id} · ${b.sample_users.join(', ')} · ${b.invoice_count} invoices`);
    }
    if (backfillPlan.length > 20) console.log(`  ... and ${backfillPlan.length - 20} more`);
  }

  if (orphans.length > 0) {
    console.log(`\n--- ORPHANS (need per-pp rows created manually) ---`);
    for (const o of orphans) {
      console.log(`  id=${o.id} · ${o.source}::${o.pattern.slice(0, 40)} → currently ${o.qb_vendor_list_id}`);
      console.log(`    ${o.distinct_pp_count} distinct pps use this pattern:`);
      for (const p of o.pps) {
        console.log(`      pp_id=${p.pp_id} · ${p.users.join(', ')} · ${p.invoice_count} invoices (sample: ${p.sample_invoice_ids.join(', ')})`);
      }
    }
  }

  if (noMatchingInvoices.length > 0) {
    console.log(`\n--- Dormant / no matching invoices (leave as-is for now) ---`);
    for (const m of noMatchingInvoices.slice(0, 15)) {
      console.log(`  id=${m.id} · ${m.source}::${m.counterparty_pattern.slice(0, 60)}`);
    }
    if (noMatchingInvoices.length > 15) console.log(`  ... and ${noMatchingInvoices.length - 15} more`);
  }

  // ─── 4. Execute (or dry-run) ──────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`\n[DRY_RUN] Not executing. Re-run with DRY_RUN=0 to apply the backfill.\n`);
  } else {
    console.log(`\n[LIVE] Applying ${backfillPlan.length} pp_id updates...`);
    for (const b of backfillPlan) {
      await query(`UPDATE qb_vendor_mappings SET pp_id = ${b.pp_id} WHERE id = ${b.id};`);
      console.log(`  ✓ id=${b.id} → pp_id=${b.pp_id}`);
    }
    console.log(`\n✓ Backfill complete. ${orphans.length} orphans need manual per-pp rows.`);
  }

  // ─── 5. Persist report ────────────────────────────────────────────────────
  const report = { generated_at: new Date().toISOString(), dry_run: DRY_RUN, backfillPlan, orphans, noMatchingInvoices, alreadySet: alreadySet.map(m => ({ id: m.id, pp_id: m.pp_id })) };
  const outPath = path.join(path.dirname(__filename), 'backfill-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n✓ Wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
