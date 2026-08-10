// Dry-run the anomaly detector against last 90 days of invoices.
// Detector logic is mirrored inline from supabase/functions/ingest-invoice/anomaly-detector.ts.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/dry-run-anomaly-detector.cjs
//
// Report shape:
//   - per-invoice: fixes[] and flags[]
//   - summary: rule frequency, would-fix vs would-flag counts
//   - validation: confirm known-bad rows (228, 197, 205) are caught

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

// ─── Detector (mirror of anomaly-detector.ts) ─────────────────────────────

function daysBetween(startISO, endISO) {
  const start = new Date(startISO + 'T12:00:00Z').getTime();
  const end   = new Date(endISO   + 'T12:00:00Z').getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function isCleanRate(r) {
  const cents = Math.round(r * 100) % 100;
  return cents === 0 || cents === 25 || cents === 50 || cents === 75;
}

function detectAnomalies(parsed, ctx = {}) {
  const fixes = [];
  const flags = [];
  const corrected = { ...parsed, lines: (parsed.lines || []).map(l => ({ ...l })) };
  const push = (rule, severity, message) => flags.push({ rule, severity, message });

  // derive rate — candidate voting; flag on disagreement (Juran-style)
  if (corrected.rate == null && corrected.hours != null && corrected.hours > 0) {
    const candidates = [];
    const p = corrected.amount;
    if (p != null && p > 0) {
      const asIs = p / corrected.hours;
      if (asIs >= 5 && asIs <= 200 && isCleanRate(asIs)) candidates.push({ rate: asIs, source: 'derived_from_amount', newAmount: null });
      if (p < 100 && corrected.hours > 40) {
        const euro = (p * 1000) / corrected.hours;
        if (euro >= 5 && euro <= 200 && isCleanRate(euro)) candidates.push({ rate: euro, source: 'european_decimal', newAmount: p * 1000 });
      }
    }
    if (ctx.priorRate != null && ctx.priorRate > 0) candidates.push({ rate: ctx.priorRate, source: 'prior', newAmount: null });
    const distinct = [];
    for (const c of candidates) if (!distinct.some(d => Math.abs(d.rate - c.rate) < 0.5)) distinct.push(c);
    if (distinct.length === 1) {
      const c = distinct[0];
      fixes.push({ field: 'rate', before: null, after: c.rate, rule: 'derive_rate_' + c.source });
      corrected.rate = c.rate;
      if (c.newAmount != null) { fixes.push({ field: 'amount', before: corrected.amount, after: c.newAmount, rule: 'derive_amount_' + c.source }); corrected.amount = c.newAmount; }
    } else if (distinct.length > 1) {
      const opts = distinct.map(c => `$${c.rate} (${c.source})`).join(', ');
      push('rate_ambiguous', 'high', `candidates disagree: ${opts}`);
    } else if (p != null && p > 0) {
      push('rate_unresolvable', 'medium', `no clean rate candidate; implied ${(p/corrected.hours).toFixed(4)}`);
    }
  }

  // arithmetic mismatch
  if (corrected.rate != null && corrected.rate > 0 && corrected.hours != null && corrected.hours > 0 && corrected.amount != null && corrected.amount > 0) {
    const expected = corrected.hours * corrected.rate;
    const diff = Math.abs(corrected.amount - expected);
    if (diff / expected > 0.02) {
      push('arithmetic_mismatch', 'high',
        `hours×rate=${expected.toFixed(2)} but amount=${corrected.amount.toFixed(2)} (${((diff/expected)*100).toFixed(1)}% off)`);
    }
  }

  // implied rate range
  if (corrected.hours != null && corrected.hours > 0 && corrected.amount != null && corrected.amount > 0) {
    const implied = corrected.amount / corrected.hours;
    if (implied < 5) push('implied_rate_too_low', 'high', `implied rate $${implied.toFixed(4)}/hr < $5 floor`);
    else if (implied > 200) push('implied_rate_too_high', 'medium', `implied rate $${implied.toFixed(2)}/hr > $200 ceiling`);
  }

  // odd rate precision
  if (corrected.rate != null && corrected.rate > 0 && !isCleanRate(corrected.rate)) {
    push('unusual_rate_precision', 'low', `rate $${corrected.rate} has unusual decimal precision`);
  }

  // period too long
  const periodDays = daysBetween(corrected.periodStart, corrected.periodEnd);
  if (periodDays > 45 && corrected.hours != null && corrected.hours < 250) {
    if (corrected.lines.length === 1
        && corrected.lines[0].weekEndingFri === corrected.periodEnd
        && corrected.lines[0].weekStart > corrected.periodStart) {
      const lineStart = corrected.lines[0].weekStart;
      const lineDays = daysBetween(lineStart, corrected.periodEnd);
      if (lineDays >= 20 && lineDays <= 35) {
        fixes.push({ field: 'periodStart', before: corrected.periodStart, after: lineStart, rule: 'shrink_period_to_line' });
        corrected.periodStart = lineStart;
      } else {
        push('period_too_long', 'high',
          `period ${periodDays}d, ${corrected.hours}h; shrink→${lineDays}d out of 20-35 range`);
      }
    } else {
      push('period_too_long', 'high',
        `period ${periodDays}d, ${corrected.hours}h invoiced (<250h); verify period_start`);
    }
  }

  // line outside period
  for (const line of corrected.lines) {
    if (line.weekStart && (line.weekStart < corrected.periodStart || line.weekStart > corrected.periodEnd)) {
      push('line_outside_period', 'medium',
        `line weekStart=${line.weekStart} outside ${corrected.periodStart}..${corrected.periodEnd}`);
    }
  }

  // timesheet cross-check
  if (ctx.timesheetHours != null && corrected.hours != null && corrected.hours > 0) {
    if (ctx.timesheetHours === 0) {
      push('timesheet_zero', 'medium', `invoice ${corrected.hours}h but timesheet 0h`);
    } else if (ctx.timesheetHours < corrected.hours * 0.5) {
      push('timesheet_far_below_invoice', 'medium',
        `timesheet ${ctx.timesheetHours}h vs invoice ${corrected.hours}h (${(ctx.timesheetHours/corrected.hours).toFixed(2)})`);
    }
  }

  if (corrected.lines.length === 1 && fixes.length > 0) {
    corrected.lines[0] = {
      weekStart: corrected.periodStart,
      weekEndingFri: corrected.periodEnd,
      hours: corrected.hours,
      rate: corrected.rate,
      amount: corrected.amount ?? 0,
    };
  }

  return { corrected, fixes, flags };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getPriorRate(userId, beforeDate) {
  // Most common rate from contractor's approved invoices in 6 months before this one.
  const cutoff = new Date(beforeDate + 'T12:00:00Z');
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const { data } = await supabase
    .from('invoices')
    .select('rate')
    .eq('user_id', userId)
    .gte('period_start', cutoffStr)
    .lt('period_start', beforeDate)
    .in('status', ['approved', 'paid'])
    .not('rate', 'is', null);
  if (!data || data.length === 0) return null;
  const counts = new Map();
  for (const r of data) {
    const rate = Number(r.rate);
    if (rate > 0) counts.set(rate, (counts.get(rate) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestRate = null, bestCount = 0;
  for (const [r, c] of counts) if (c > bestCount) { bestRate = r; bestCount = c; }
  return bestRate;
}

async function getTimesheetHours(userId, periodStart, periodEnd) {
  const rangeStart = new Date(periodStart + 'T12:00:00Z');
  rangeStart.setDate(rangeStart.getDate() - 6);
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const { data } = await supabase
    .from('timesheets')
    .select('entries')
    .eq('user_id', userId)
    .gte('week_start', rangeStartStr)
    .lte('week_start', periodEnd);
  if (!data) return null;
  let total = 0;
  for (const ts of data) {
    const entries = ts.entries || {};
    for (const [date, entry] of Object.entries(entries)) {
      if (date < periodStart || date > periodEnd) continue;
      let h = 0;
      if (typeof entry === 'number') h = entry;
      else if (entry && typeof entry === 'object') {
        const raw = entry.hours;
        h = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0));
      }
      if (!isNaN(h) && h > 0) total += h;
    }
  }
  return total;
}

// ─── Main ────────────────────────────────────────────────────────────────

(async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  console.log(`\nFetching invoices with period_start >= ${cutoffStr}...`);

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, user_id, user_name, invoice_number, period_start, period_end, total_hours, rate, total_amount, currency, lines, status, reconciliation_status')
    .gte('period_start', cutoffStr)
    .eq('source', 'imported')
    .neq('matcher_ignore', true)
    .order('id', { ascending: true });

  if (error) { console.error('Query failed:', error); process.exit(1); }
  console.log(`Loaded ${invoices.length} invoices.\n`);

  const results = [];
  const ruleFrequency = new Map();
  let totalFixes = 0, totalFlags = 0, cleanCount = 0;

  for (const inv of invoices) {
    const parsed = {
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      hours: inv.total_hours != null ? Number(inv.total_hours) : null,
      rate: inv.rate != null ? Number(inv.rate) : null,
      amount: inv.total_amount != null ? Number(inv.total_amount) : null,
      currency: inv.currency || 'USD',
      lines: inv.lines || [],
    };

    const priorRate = await getPriorRate(inv.user_id, inv.period_start);
    const timesheetHours = await getTimesheetHours(inv.user_id, inv.period_start, inv.period_end);

    const result = detectAnomalies(parsed, { priorRate, timesheetHours });

    if (result.fixes.length === 0 && result.flags.length === 0) {
      cleanCount++;
    } else {
      totalFixes += result.fixes.length;
      totalFlags += result.flags.length;
      for (const f of result.fixes) ruleFrequency.set(f.rule, (ruleFrequency.get(f.rule) || 0) + 1);
      for (const f of result.flags) ruleFrequency.set(f.rule, (ruleFrequency.get(f.rule) || 0) + 1);
      results.push({ inv, priorRate, timesheetHours, result });
    }
  }

  console.log(`\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
  console.log(`Total invoices:  ${invoices.length}`);
  console.log(`Clean:           ${cleanCount}`);
  console.log(`With activity:   ${results.length} (${totalFixes} fixes + ${totalFlags} flags)\n`);

  console.log('Rule frequency:');
  const sorted = [...ruleFrequency.entries()].sort((a, b) => b[1] - a[1]);
  for (const [rule, count] of sorted) console.log(`  ${rule.padEnd(35)} ${count}`);

  console.log(`\n${'='.repeat(70)}\nPER-INVOICE DETAIL\n${'='.repeat(70)}\n`);
  for (const { inv, priorRate, timesheetHours, result } of results) {
    console.log(`─── id=${inv.id} · ${inv.user_name} · ${inv.invoice_number} · ${inv.period_start}..${inv.period_end}`);
    console.log(`    hours=${inv.total_hours} rate=${inv.rate} amount=${inv.total_amount} | priorRate=${priorRate} tsHours=${timesheetHours}`);
    for (const f of result.fixes) console.log(`    [FIX ${f.rule}] ${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`);
    for (const f of result.flags) console.log(`    [FLAG ${f.severity}/${f.rule}] ${f.message}`);
    console.log('');
  }

  // Validation: confirm known-bad rows are caught
  console.log(`${'='.repeat(70)}\nVALIDATION — known-bad rows\n${'='.repeat(70)}`);
  const knownBad = { 228: 'Juran (Aug 2 original: $7.36 for 184h)', 197: 'Zlatar (Aug 2 original: 2-month span)', 205: 'Nikolina (Aug 2 original: 2-month span)' };
  for (const [id, note] of Object.entries(knownBad)) {
    const row = results.find(r => r.inv.id === Number(id));
    if (row) console.log(`  id=${id} ${note}: ${row.result.fixes.length} fixes + ${row.result.flags.length} flags — CAUGHT`);
    else console.log(`  id=${id} ${note}: NOT flagged (may have been repaired already)`);
  }
})();
