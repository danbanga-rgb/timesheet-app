// Shared invoice edit_history schema + factories + normalizer.
//
// One target shape for every writer (frontend period edit, ingest-invoice
// guardrail, ingest-invoice anomaly, one-off repair scripts) so the invoice
// modal renderer no longer has to guess between 6+ historical shapes.
//
// If you add a new kind, extend `InvoiceEditKind`, add a factory here, and
// update the renderer's kind switch in TimesheetSystem.tsx.

export type InvoiceEditKind =
  | 'period_edit'      // Accountant changed periodStart/periodEnd via UI, or claude-repair adjusted it.
  | 'guardrail'        // Beneficiary guardrail deprecated-id resolution during ingest.
  | 'anomaly'          // Anomaly detector post-ingest fixes/flags.
  | 'manual_repair'    // Manual DB patch (rare — parse failure fallback recoveries).
  | 'other';           // Legacy or unclassified — kept so backfill never drops audit rows.

export interface InvoiceEditEntry {
  at: string;                              // ISO8601 UTC
  by: string;                              // Actor: user name, or 'anomaly-detector', 'beneficiary-guardrail', 'claude-repair', etc.
  kind: InvoiceEditKind;
  reason: string;                          // Human-readable one-liner. Empty string if the writer has no reason.
  before: Record<string, unknown>;         // Column values before change (snake_case keys). {} for non-diff kinds.
  after: Record<string, unknown>;          // Column values after change. {} for non-diff kinds.
  details?: Record<string, unknown>;       // Kind-specific extras: guardrail events, anomaly fixes/flags, etc.
}

// ─── Factories ────────────────────────────────────────────────────────────────
// All writers should use these. They enforce the shape at construction.

export function periodEditEntry(args: {
  by: string;
  reason: string;
  beforePeriodStart: string;
  beforePeriodEnd: string;
  afterPeriodStart: string;
  afterPeriodEnd: string;
}): InvoiceEditEntry {
  return {
    at: new Date().toISOString(),
    by: args.by,
    kind: 'period_edit',
    reason: args.reason,
    before: { period_start: args.beforePeriodStart, period_end: args.beforePeriodEnd },
    after: { period_start: args.afterPeriodStart, period_end: args.afterPeriodEnd },
  };
}

export function guardrailEntry(args: {
  by?: string;
  events: Array<{ stage: string; original: number; resolved: number | null; note?: string }>;
}): InvoiceEditEntry {
  const eventCount = args.events.length;
  const resolved = args.events.filter(e => e.resolved !== null).length;
  return {
    at: new Date().toISOString(),
    by: args.by ?? 'beneficiary-guardrail',
    kind: 'guardrail',
    reason: `Beneficiary guardrail: ${resolved}/${eventCount} deprecated id(s) resolved`,
    before: {},
    after: {},
    details: { events: args.events },
  };
}

export function anomalyEntry(args: {
  by?: string;
  fixes: unknown[];
  flags: unknown[];
}): InvoiceEditEntry {
  const nFixes = args.fixes.length;
  const nFlags = args.flags.length;
  const bits: string[] = [];
  if (nFixes) bits.push(`${nFixes} fix${nFixes === 1 ? '' : 'es'}`);
  if (nFlags) bits.push(`${nFlags} flag${nFlags === 1 ? '' : 's'}`);
  return {
    at: new Date().toISOString(),
    by: args.by ?? 'anomaly-detector',
    kind: 'anomaly',
    reason: `Anomaly detector: ${bits.join(', ') || 'no fixes or flags'}`,
    before: {},
    after: {},
    details: { fixes: args.fixes, flags: args.flags },
  };
}

// ─── Normalizer ───────────────────────────────────────────────────────────────
// Read-path defence. Accepts any historical shape and returns a normalized
// InvoiceEditEntry. Used by both the frontend renderer (belt-and-braces after
// backfill) and the backfill script itself (source of truth for translation).

interface RawEntry { [key: string]: unknown }

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// Fields inside before/after can arrive as camelCase (older frontend writes) or
// snake_case (edge fn / this file's canonical shape). Normalize to snake_case.
function snakeifyPeriodKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  if ('periodStart' in out && !('period_start' in out)) { out.period_start = out.periodStart; delete out.periodStart; }
  if ('periodEnd'   in out && !('period_end'   in out)) { out.period_end   = out.periodEnd;   delete out.periodEnd; }
  return out;
}

export function normalizeEditEntry(raw: unknown): InvoiceEditEntry {
  const r = asObject(raw) as RawEntry;
  const at = asString(r.at, new Date(0).toISOString());
  const by = asString(r.by, 'unknown');

  // Idempotency: already-normalized entries pass through untouched.
  // Detect via presence of `kind` (never set by any legacy shape).
  if (typeof r.kind === 'string') {
    const out: InvoiceEditEntry = {
      at, by,
      kind: r.kind as InvoiceEditKind,
      reason: asString(r.reason),
      before: asObject(r.before),
      after: asObject(r.after),
    };
    if (r.details !== undefined) out.details = asObject(r.details);
    return out;
  }

  // Kind 4: anomaly detector — { fixes, flags }
  if ('fixes' in r || 'flags' in r) {
    return anomalyEntryFromLegacy(at, by, asArray(r.fixes), asArray(r.flags));
  }

  // Kind 2: guardrail — { events }
  if ('events' in r) {
    return guardrailEntryFromLegacy(at, by, asArray(r.events) as Array<{ stage: string; original: number; resolved: number | null; note?: string }>);
  }

  // Kind 6: old savePeriodEdit — { old, new, field, reason } (camelCase inside)
  if ('old' in r && 'new' in r) {
    const oldObj = snakeifyPeriodKeys(asObject(r.old));
    const newObj = snakeifyPeriodKeys(asObject(r.new));
    const isPeriod = asString(r.field) === 'period' || 'period_start' in oldObj || 'period_start' in newObj;
    return {
      at, by,
      kind: isPeriod ? 'period_edit' : 'other',
      reason: asString(r.reason),
      before: oldObj,
      after: newObj,
    };
  }

  // Kind 1/3: { before, after, reason [, action] } — claude-repair / one-offs
  if ('before' in r || 'after' in r) {
    const before = snakeifyPeriodKeys(asObject(r.before));
    const after  = snakeifyPeriodKeys(asObject(r.after));
    const looksLikePeriod = 'period_start' in before || 'period_end' in before || 'period_start' in after || 'period_end' in after;
    const byLower = by.toLowerCase();
    let kind: InvoiceEditKind = looksLikePeriod ? 'period_edit' : 'other';
    if (byLower.includes('manual-repair') || byLower.includes('manual_repair')) kind = 'manual_repair';
    const details: Record<string, unknown> = {};
    if ('action' in r) details.action = r.action;
    const out: InvoiceEditEntry = { at, by, kind, reason: asString(r.reason), before, after };
    if (Object.keys(details).length) out.details = details;
    return out;
  }

  // Kind 5: { reason, changes } — one-off script style
  if ('changes' in r) {
    return {
      at, by,
      kind: 'other',
      reason: asString(r.reason),
      before: {},
      after: {},
      details: { changes: r.changes },
    };
  }

  // Unknown shape — preserve raw payload in details so the audit trail isn't lost.
  return {
    at, by,
    kind: 'other',
    reason: asString(r.reason),
    before: {},
    after: {},
    details: { raw: r },
  };
}

function anomalyEntryFromLegacy(at: string, by: string, fixes: unknown[], flags: unknown[]): InvoiceEditEntry {
  const bits: string[] = [];
  if (fixes.length) bits.push(`${fixes.length} fix${fixes.length === 1 ? '' : 'es'}`);
  if (flags.length) bits.push(`${flags.length} flag${flags.length === 1 ? '' : 's'}`);
  return {
    at, by,
    kind: 'anomaly',
    reason: `Anomaly detector: ${bits.join(', ') || 'no fixes or flags'}`,
    before: {}, after: {},
    details: { fixes, flags },
  };
}

function guardrailEntryFromLegacy(
  at: string, by: string,
  events: Array<{ stage: string; original: number; resolved: number | null; note?: string }>,
): InvoiceEditEntry {
  const resolved = events.filter(e => e.resolved !== null).length;
  return {
    at, by,
    kind: 'guardrail',
    reason: `Beneficiary guardrail: ${resolved}/${events.length} deprecated id(s) resolved`,
    before: {}, after: {},
    details: { events },
  };
}
