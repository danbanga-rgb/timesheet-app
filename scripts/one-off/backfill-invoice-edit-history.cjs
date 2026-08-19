#!/usr/bin/env node
// Backfill: normalize every invoices.edit_history entry to the canonical shape
// defined in supabase/functions/_shared/edit-history.ts.
//
// Idempotent — re-running produces no writes if all entries are already normalized.
// Dry-run by default; pass --apply to write.
//
// Historical shapes seen (2026-08-19 audit): before/after/reason, events,
// after/action/before/reason, fixes/flags, reason/changes, new/old/field/reason.
// The 12 invoices with edit_history were crashing the accountant modal because
// the renderer assumed h.old.periodStart which none of these shapes provide.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// ─── Inlined normalizer ──────────────────────────────────────────────────────
// Kept in sync with supabase/functions/_shared/edit-history.ts (CommonJS
// equivalent of normalizeEditEntry). If the canonical file changes, update
// this too.

function asString(v, fallback = '') { return typeof v === 'string' ? v : fallback; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function asArray(v) { return Array.isArray(v) ? v : []; }

function snakeifyPeriodKeys(obj) {
  const out = { ...obj };
  if ('periodStart' in out && !('period_start' in out)) { out.period_start = out.periodStart; delete out.periodStart; }
  if ('periodEnd' in out && !('period_end' in out)) { out.period_end = out.periodEnd; delete out.periodEnd; }
  return out;
}

function normalizeEditEntry(raw) {
  const r = asObject(raw);
  const at = asString(r.at, new Date(0).toISOString());
  const by = asString(r.by, 'unknown');

  // Idempotency: already-normalized entries pass through.
  if (typeof r.kind === 'string') {
    const out = { at, by, kind: r.kind, reason: asString(r.reason), before: asObject(r.before), after: asObject(r.after) };
    if (r.details !== undefined) out.details = asObject(r.details);
    return out;
  }

  if ('fixes' in r || 'flags' in r) {
    const fixes = asArray(r.fixes), flags = asArray(r.flags);
    const bits = [];
    if (fixes.length) bits.push(`${fixes.length} fix${fixes.length === 1 ? '' : 'es'}`);
    if (flags.length) bits.push(`${flags.length} flag${flags.length === 1 ? '' : 's'}`);
    return { at, by, kind: 'anomaly', reason: `Anomaly detector: ${bits.join(', ') || 'no fixes or flags'}`, before: {}, after: {}, details: { fixes, flags } };
  }

  if ('events' in r) {
    const events = asArray(r.events);
    const resolved = events.filter(e => e && e.resolved !== null).length;
    return { at, by, kind: 'guardrail', reason: `Beneficiary guardrail: ${resolved}/${events.length} deprecated id(s) resolved`, before: {}, after: {}, details: { events } };
  }

  if ('old' in r && 'new' in r) {
    const oldObj = snakeifyPeriodKeys(asObject(r.old));
    const newObj = snakeifyPeriodKeys(asObject(r.new));
    const isPeriod = asString(r.field) === 'period' || 'period_start' in oldObj || 'period_start' in newObj;
    return { at, by, kind: isPeriod ? 'period_edit' : 'other', reason: asString(r.reason), before: oldObj, after: newObj };
  }

  if ('before' in r || 'after' in r) {
    const before = snakeifyPeriodKeys(asObject(r.before));
    const after = snakeifyPeriodKeys(asObject(r.after));
    const looksLikePeriod = 'period_start' in before || 'period_end' in before || 'period_start' in after || 'period_end' in after;
    const byLower = by.toLowerCase();
    let kind = looksLikePeriod ? 'period_edit' : 'other';
    if (byLower.includes('manual-repair') || byLower.includes('manual_repair')) kind = 'manual_repair';
    const details = {};
    if ('action' in r) details.action = r.action;
    const out = { at, by, kind, reason: asString(r.reason), before, after };
    if (Object.keys(details).length) out.details = details;
    return out;
  }

  if ('changes' in r) {
    return { at, by, kind: 'other', reason: asString(r.reason), before: {}, after: {}, details: { changes: r.changes } };
  }

  return { at, by, kind: 'other', reason: asString(r.reason), before: {}, after: {}, details: { raw: r } };
}

// Compare two entries for equality (content-only — Postgres jsonb returns keys
// in a different order than our normalizer emits, so a plain JSON.stringify
// would flag identical content as different).
function stableStringify(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stableStringify).join(',') + ']';
  const keys = Object.keys(o).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
function entriesEqual(a, b) { return stableStringify(a) === stableStringify(b); }

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from('invoices')
    .select('id, user_name, invoice_number, edit_history')
    .not('edit_history', 'eq', '[]')
    .order('id');
  if (error) { console.error('Query failed:', error); process.exit(1); }
  const withHistory = (rows || []).filter(r => Array.isArray(r.edit_history) && r.edit_history.length > 0);

  console.log(`Found ${withHistory.length} invoice(s) with non-empty edit_history\n`);

  let changed = 0, unchanged = 0, writes = 0, writeErrors = 0;

  for (const row of withHistory) {
    const original = row.edit_history;
    const normalized = original.map(normalizeEditEntry);
    const isSame = original.length === normalized.length && original.every((e, i) => entriesEqual(e, normalized[i]));

    if (isSame) {
      unchanged++;
      continue;
    }

    changed++;
    console.log(`─ id=${row.id} ${row.user_name} (${row.invoice_number}) — ${original.length} entr${original.length === 1 ? 'y' : 'ies'}`);
    for (let i = 0; i < original.length; i++) {
      const before = Object.keys(original[i]).sort().join(',');
      const after  = Object.keys(normalized[i]).sort().join(',');
      const kind   = normalized[i].kind;
      console.log(`   [${i}] {${before}}  →  {${after}}  kind=${kind}`);
    }

    if (APPLY) {
      const { error: updErr } = await supabase.from('invoices').update({ edit_history: normalized }).eq('id', row.id);
      if (updErr) { console.error(`   ⚠ write failed: ${updErr.message}`); writeErrors++; }
      else { writes++; }
    }
  }

  console.log(`\n─ Summary`);
  console.log(`  changed:   ${changed}`);
  console.log(`  unchanged: ${unchanged}`);
  if (APPLY) {
    console.log(`  writes:    ${writes}`);
    if (writeErrors) console.log(`  errors:    ${writeErrors}`);
  } else {
    console.log(`\n  DRY-RUN. Re-run with --apply to write.`);
  }
})();
