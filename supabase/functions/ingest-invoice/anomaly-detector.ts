// Anomaly detector for parsed invoices.
//
// Pure function. Called after parser output, before DB insert. Applies confident
// auto-fixes (rate derivation from prior invoices, period shrink when line item
// disagrees with period_start) and flags suspicious values (arithmetic mismatch,
// implausible rate, timesheet mismatch) for accountant review via edit_history.
//
// Rulebook rationale is in project-invoice-parser-template-redesign memory —
// this file supersedes the template-redesign plan for v1.

export type Severity = 'high' | 'medium' | 'low';

export interface ParsedInvoice {
  periodStart: string;         // YYYY-MM-DD
  periodEnd: string;           // YYYY-MM-DD
  hours: number | null;
  rate: number | null;
  amount: number | null;
  currency: string;
  lines: Array<{
    weekStart: string;
    weekEndingFri: string;
    hours: number | null;
    rate: number | null;
    amount: number;
  }>;
}

export interface DetectorContext {
  timesheetHours?: number | null;   // from reconcile; null if unknown
  priorRate?: number | null;         // most common rate from contractor's recent approved invoices
}

export interface AnomalyFix {
  field: string;
  before: unknown;
  after: unknown;
  rule: string;
}

export interface AnomalyFlag {
  rule: string;
  severity: Severity;
  message: string;
}

export interface DetectorResult {
  corrected: ParsedInvoice;
  fixes: AnomalyFix[];
  flags: AnomalyFlag[];
}

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T12:00:00Z').getTime();
  const end   = new Date(endISO   + 'T12:00:00Z').getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function isCleanRate(r: number): boolean {
  // Whole dollar, half dollar, or quarter — the shapes contractors actually bill at.
  const cents = Math.round(r * 100) % 100;
  return cents === 0 || cents === 25 || cents === 50 || cents === 75;
}

export function detectAnomalies(
  parsed: ParsedInvoice,
  ctx: DetectorContext = {},
): DetectorResult {
  const fixes: AnomalyFix[] = [];
  const flags: AnomalyFlag[] = [];
  const corrected: ParsedInvoice = {
    ...parsed,
    lines: (parsed.lines || []).map(l => ({ ...l })),
  };

  const push = (rule: string, severity: Severity, message: string) =>
    flags.push({ rule, severity, message });

  // ── Rule: derive missing rate ──────────────────────────────────────────────
  // When rate is null, consider three signals: parsed amount as-is, parsed
  // amount ×1000 (European-decimal misparse hypothesis, only if amount<100),
  // and the contractor's prior mode rate. Auto-fix only when candidates agree.
  //
  // Juran (id=228) is why we don't blindly trust priorRate: he raised his rate
  // from $30 to $40 for this invoice, so priorRate=$30 disagreed with the
  // European-decimal interpretation ($7.36 → $7,360 / 184 = $40). Flag, don't
  // guess.
  if (corrected.rate == null && corrected.hours != null && corrected.hours > 0) {
    type Candidate = { rate: number; source: string; newAmount: number | null };
    const candidates: Candidate[] = [];

    const parsedAmountVal = corrected.amount;
    if (parsedAmountVal != null && parsedAmountVal > 0) {
      const impliedAsIs = parsedAmountVal / corrected.hours;
      if (impliedAsIs >= 5 && impliedAsIs <= 200 && isCleanRate(impliedAsIs)) {
        candidates.push({ rate: impliedAsIs, source: 'derived_from_amount', newAmount: null });
      }
      // European-decimal hypothesis: parsed 7.360 as US 7.36. Only plausible when
      // the parsed amount is small (< $100) and hours substantial.
      if (parsedAmountVal < 100 && corrected.hours > 40) {
        const impliedEuropean = (parsedAmountVal * 1000) / corrected.hours;
        if (impliedEuropean >= 5 && impliedEuropean <= 200 && isCleanRate(impliedEuropean)) {
          candidates.push({ rate: impliedEuropean, source: 'european_decimal', newAmount: parsedAmountVal * 1000 });
        }
      }
    }
    if (ctx.priorRate != null && ctx.priorRate > 0) {
      candidates.push({ rate: ctx.priorRate, source: 'prior', newAmount: null });
    }

    // Deduplicate: two candidates that agree within $0.50 count as one signal.
    const distinct: Candidate[] = [];
    for (const c of candidates) {
      if (!distinct.some(d => Math.abs(d.rate - c.rate) < 0.5)) distinct.push(c);
    }

    if (distinct.length === 1) {
      // Single candidate — auto-fix.
      const c = distinct[0];
      fixes.push({ field: 'rate', before: null, after: c.rate, rule: `derive_rate_${c.source}` });
      corrected.rate = c.rate;
      if (c.newAmount != null) {
        fixes.push({ field: 'amount', before: corrected.amount, after: c.newAmount, rule: `derive_amount_${c.source}` });
        corrected.amount = c.newAmount;
      }
    } else if (distinct.length > 1) {
      // Candidates disagree — flag with all options for accountant to pick.
      const opts = distinct.map(c => `$${c.rate} (${c.source})`).join(', ');
      push('rate_ambiguous', 'high',
        `rate null; candidate rates disagree: ${opts}. Manual review required.`);
    } else if (parsedAmountVal != null && parsedAmountVal > 0) {
      // No clean candidate — flag with implied value for context.
      const implied = parsedAmountVal / corrected.hours;
      push('rate_unresolvable', 'medium',
        `rate null; amount ${parsedAmountVal}, hours ${corrected.hours}, implied $${implied.toFixed(4)}/hr. No clean rate candidate found.`);
    }
  }

  // ── Rule: arithmetic mismatch (all 3 known, hours × rate != amount) ────────
  if (corrected.rate != null && corrected.rate > 0
      && corrected.hours != null && corrected.hours > 0
      && corrected.amount != null && corrected.amount > 0) {
    const expected = corrected.hours * corrected.rate;
    const diff = Math.abs(corrected.amount - expected);
    if (diff / expected > 0.02) {
      push('arithmetic_mismatch', 'high',
        `hours×rate=${expected.toFixed(2)} but amount=${corrected.amount.toFixed(2)} (${((diff/expected)*100).toFixed(1)}% off)`);
    }
  }

  // ── Rule: implied rate outside plausible range ─────────────────────────────
  if (corrected.hours != null && corrected.hours > 0
      && corrected.amount != null && corrected.amount > 0) {
    const implied = corrected.amount / corrected.hours;
    if (implied < 5) {
      push('implied_rate_too_low', 'high',
        `implied rate $${implied.toFixed(4)}/hr is below $5 floor; likely amount or hours misparse`);
    } else if (implied > 200) {
      push('implied_rate_too_high', 'medium',
        `implied rate $${implied.toFixed(2)}/hr is above $200 ceiling; verify`);
    }
  }

  // ── Rule: rate has odd decimal precision ───────────────────────────────────
  if (corrected.rate != null && corrected.rate > 0 && !isCleanRate(corrected.rate)) {
    push('unusual_rate_precision', 'low',
      `rate $${corrected.rate} has unusual decimal precision; verify`);
  }

  // ── Rule: period spans too long for hours (Zlatar/Nikolina fix) ────────────
  const periodDays = daysBetween(corrected.periodStart, corrected.periodEnd);
  if (periodDays > 45 && corrected.hours != null && corrected.hours < 250) {
    // Auto-fix: if there's exactly one line item ending at period_end, shrink
    // period_start to the line's weekStart. This is the Zlatar/Nikolina signature.
    if (corrected.lines.length === 1
        && corrected.lines[0].weekEndingFri === corrected.periodEnd
        && corrected.lines[0].weekStart > corrected.periodStart) {
      const lineStart = corrected.lines[0].weekStart;
      const lineDays = daysBetween(lineStart, corrected.periodEnd);
      // Only shrink if the resulting span is plausibly one month
      if (lineDays >= 20 && lineDays <= 35) {
        fixes.push({ field: 'periodStart', before: corrected.periodStart, after: lineStart, rule: 'shrink_period_to_line' });
        corrected.periodStart = lineStart;
      } else {
        push('period_too_long', 'high',
          `period spans ${periodDays} days but only ${corrected.hours}h; line ends at period_end but shrinking to line.weekStart yields ${lineDays} days (out of 20–35 range)`);
      }
    } else {
      push('period_too_long', 'high',
        `period spans ${periodDays} days but only ${corrected.hours}h invoiced (<250h); verify period_start`);
    }
  }

  // ── Rule: line item's weekStart falls outside period ───────────────────────
  for (const line of corrected.lines) {
    if (line.weekStart && (line.weekStart < corrected.periodStart || line.weekStart > corrected.periodEnd)) {
      push('line_outside_period', 'medium',
        `line weekStart=${line.weekStart} outside period ${corrected.periodStart}..${corrected.periodEnd}`);
    }
  }

  // ── Rule: timesheet cross-check ────────────────────────────────────────────
  if (ctx.timesheetHours != null && corrected.hours != null && corrected.hours > 0) {
    if (ctx.timesheetHours === 0) {
      push('timesheet_zero', 'medium',
        `invoice claims ${corrected.hours}h but timesheet has 0h in period; missing timesheet or period wrong`);
    } else if (ctx.timesheetHours < corrected.hours * 0.5) {
      push('timesheet_far_below_invoice', 'medium',
        `timesheet ${ctx.timesheetHours}h vs invoice ${corrected.hours}h (ratio ${(ctx.timesheetHours/corrected.hours).toFixed(2)}); verify period`);
    }
  }

  // ── Sync line item to corrected top-level values ───────────────────────────
  // If we changed periodStart, hours, rate, or amount, the single-line item
  // representing the period needs to reflect the corrected values so downstream
  // code (recon, CSV export, UI) sees a consistent shape.
  if (corrected.lines.length === 1 && fixes.length > 0) {
    corrected.lines[0] = {
      weekStart:     corrected.periodStart,
      weekEndingFri: corrected.periodEnd,
      hours:         corrected.hours,
      rate:          corrected.rate,
      amount:        corrected.amount ?? 0,
    };
  }

  return { corrected, fixes, flags };
}
