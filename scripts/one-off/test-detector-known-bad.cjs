// Feed the detector the ORIGINAL parser outputs (pre-repair) for the 3 known-bad
// invoices from 2026-08-04 and confirm it catches them.

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

// Inline detector (mirror of anomaly-detector.ts)
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000) + 1;
}
function isCleanRate(r) { const c = Math.round(r * 100) % 100; return c === 0 || c === 25 || c === 50 || c === 75; }
function detectAnomalies(parsed, ctx = {}) {
  const fixes = []; const flags = [];
  const corrected = { ...parsed, lines: (parsed.lines || []).map(l => ({ ...l })) };
  const push = (rule, sev, msg) => flags.push({ rule, sev, msg });

  if (corrected.rate == null && corrected.hours > 0) {
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
  if (corrected.rate > 0 && corrected.hours > 0 && corrected.amount > 0) {
    const exp = corrected.hours * corrected.rate;
    const diff = Math.abs(corrected.amount - exp);
    if (diff / exp > 0.02) push('arithmetic_mismatch', 'high', `hours×rate=${exp.toFixed(2)} but amount=${corrected.amount.toFixed(2)}`);
  }
  if (corrected.hours > 0 && corrected.amount > 0) {
    const imp = corrected.amount / corrected.hours;
    if (imp < 5) push('implied_rate_too_low', 'high', `implied rate $${imp.toFixed(4)}/hr < $5`);
    else if (imp > 200) push('implied_rate_too_high', 'medium', `implied rate $${imp.toFixed(2)}/hr > $200`);
  }
  const pd = daysBetween(corrected.periodStart, corrected.periodEnd);
  if (pd > 45 && corrected.hours != null && corrected.hours < 250) {
    if (corrected.lines.length === 1 && corrected.lines[0].weekEndingFri === corrected.periodEnd && corrected.lines[0].weekStart > corrected.periodStart) {
      const ls = corrected.lines[0].weekStart;
      const ld = daysBetween(ls, corrected.periodEnd);
      if (ld >= 20 && ld <= 35) {
        fixes.push({ field: 'periodStart', before: corrected.periodStart, after: ls, rule: 'shrink_period_to_line' });
        corrected.periodStart = ls;
      } else push('period_too_long', 'high', `period ${pd}d, shrink→${ld}d out of range`);
    } else push('period_too_long', 'high', `period ${pd}d ${corrected.hours}h — verify`);
  }
  if (ctx.timesheetHours != null && corrected.hours > 0) {
    if (ctx.timesheetHours === 0) push('timesheet_zero', 'medium', `invoice ${corrected.hours}h, ts 0h`);
    else if (ctx.timesheetHours < corrected.hours * 0.5) push('timesheet_far_below_invoice', 'medium', `ts ${ctx.timesheetHours}h vs inv ${corrected.hours}h`);
  }
  return { corrected, fixes, flags };
}

// ─── Fixture: original parser outputs (before 2026-08-04 repair) ──────────
async function priorRate(userId, beforeDate) {
  const cutoff = new Date(beforeDate + 'T12:00:00Z');
  cutoff.setMonth(cutoff.getMonth() - 6);
  const { data } = await supabase.from('invoices').select('rate').eq('user_id', userId).gte('period_start', cutoff.toISOString().slice(0, 10)).lt('period_start', beforeDate).in('status', ['approved', 'paid']).not('rate', 'is', null);
  if (!data || !data.length) return null;
  const counts = new Map();
  for (const r of data) { const rr = Number(r.rate); if (rr > 0) counts.set(rr, (counts.get(rr) || 0) + 1); }
  let best = null, bestC = 0;
  for (const [r, c] of counts) if (c > bestC) { best = r; bestC = c; }
  return best;
}

(async () => {
  const fixtures = [
    {
      id: 228, label: 'Juran (2026-08-04 original)',
      userId: '7a2f1310-d04a-4cf1-bc70-11130f2d7d4a',
      parsed: {
        periodStart: '2026-07-01', periodEnd: '2026-07-31',
        hours: 184, rate: null, amount: 7.36, currency: 'USD',
        lines: [{ weekStart: '2026-07-01', weekEndingFri: '2026-07-31', hours: 184, rate: null, amount: 7.36 }],
      },
    },
    {
      id: 197, label: 'Zlatar (2026-08-04 original)',
      userId: '8929ac1d-1684-4f71-884a-bb9664bebd7d',
      parsed: {
        periodStart: '2026-06-01', periodEnd: '2026-07-31',
        hours: 176, rate: 30, amount: 5280, currency: 'USD',
        lines: [{ weekStart: '2026-07-01', weekEndingFri: '2026-07-31', hours: 176, rate: 30, amount: 5280 }],
      },
    },
    {
      id: 205, label: 'Nikolina (2026-08-04 original)',
      userId: '1479d4dc-38f9-4285-9d4c-19680c8c89f8',
      parsed: {
        periodStart: '2026-06-01', periodEnd: '2026-07-31',
        hours: 184, rate: 30, amount: 5520, currency: 'USD',
        lines: [{ weekStart: '2026-07-01', weekEndingFri: '2026-07-31', hours: 184, rate: 30, amount: 5520 }],
      },
    },
  ];

  for (const fx of fixtures) {
    const pr = await priorRate(fx.userId, fx.parsed.periodStart);
    // Note: this is what we would have known at ingest time. Use 6-month history before period_start.
    const result = detectAnomalies(fx.parsed, { priorRate: pr, timesheetHours: null });
    console.log(`\n── ${fx.label} (id=${fx.id}) — priorRate=${pr}`);
    console.log(`   Original parsed: period=${fx.parsed.periodStart}..${fx.parsed.periodEnd} hours=${fx.parsed.hours} rate=${fx.parsed.rate} amount=${fx.parsed.amount}`);
    console.log(`   Corrected:       period=${result.corrected.periodStart}..${result.corrected.periodEnd} hours=${result.corrected.hours} rate=${result.corrected.rate} amount=${result.corrected.amount}`);
    for (const f of result.fixes) console.log(`   [FIX ${f.rule}] ${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`);
    for (const f of result.flags) console.log(`   [FLAG ${f.sev}/${f.rule}] ${f.msg}`);
    if (result.fixes.length === 0 && result.flags.length === 0) console.log(`   ✗ NOT CAUGHT`);
  }
})();
