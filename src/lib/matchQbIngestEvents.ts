// Match qb_ingest_events → invoices — layered matcher.
//
// Single source of truth for the invoice-match algorithm. Used at:
//   - ingest-preview time (Intuit XLSX loader) to populate matched_invoice_ids
//     on freshly-parsed events before the accountant hits Import.
//   - on-load auto-recompute (QB Automation tab) to re-run the matcher against
//     the current invoice set for events with status='pending'. Ensures a
//     matcher upgrade OR a late-created invoice self-heals without re-ingest.
//   - manual "Recompute matches" button for deliberate re-runs.
//
// Never called for events with status ready/ignored/posted — those reflect
// accountant decisions and matcher improvements shouldn't retroactively flip
// them. Callers filter by status before invoking.
//
// Algorithm:
//   L1  exact invoice_number match (case + dashes insensitive)
//   L2  vendor company + amount (single-invoice memos and no-memo events)
//   L3  vendor company + subset-sum (multi-invoice memos like "Inv# 03, 04")
//
// Chronological pass with a "claimed" Set prevents 1:many — an invoice
// matched to one event is off the table for later events. Also date-gated:
// vendor invoice's period_end must be within 120 days BEFORE (or up to 30
// days AFTER) the event date, otherwise a payment-side amount collision with
// an unrelated recent invoice would falsely match.

/** Minimal shape required from the caller's event objects. */
export interface MatchableEvent {
  date: string;              // YYYY-MM-DD
  counterpartyRaw: string;   // vendor/counterparty as the source spells it
  amount: number;            // positive
  invoiceRefs: string[];     // parsed from memo (e.g. ['05'] or ['03', '04'])
}

/** Minimal shape required from the caller's invoice objects. companyName
 *  is preferred over userName for company-match — an umbrella name matches
 *  the Intuit payee more reliably than a person's name. */
export interface MatcherInvoice {
  id: number;
  invoiceNumber: string | null;
  totalAmount: number;
  periodEnd: string | null;  // YYYY-MM-DD; if null, date-proximity check is skipped
  userName: string;
  companyName: string | null;
}

// Company-name normaliser — strips corporate suffixes, punctuation, and case
// so "Hover cloud technologies limited liability company" (Intuit's spelling)
// matches "HOVERCLOUD TECHNOLOGIES" (our DB). Kept inline so this module has
// no external string-utility dependency.
const CORP_SUFFIXES_RE = /\b(inc|corp|llc|ltd|d\.?o\.?o\.?|s\.?r\.?o\.?|gmbh|co|technologies|solutions|services|agency|group|digital|labs?|tech)\b\.?/gi;
function normaliseCompany(s: string): string {
  return (s || '').toLowerCase()
    .replace(CORP_SUFFIXES_RE, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const stripWs = (s: string) => s.replace(/\s+/g, '');
const normRef = (s: string) => s.toLowerCase().trim().replace(/-+/g, '-');

const AMT_EPS = 0.02;                // dollars — QB and Intuit may disagree on the cent
const DATE_LOOKBACK_DAYS = 120;      // invoice period_end this far before event = still plausible
const DATE_LOOKAHEAD_DAYS = 30;      // early-payment tolerance (invoice period_end after event)

/** Match a batch of events to invoices. Returns matched invoice ids in the
 *  same order as the input events array. */
export function matchEventsToInvoices(events: MatchableEvent[], invoices: MatcherInvoice[]): number[][] {
  const invByNum = new Map<string, number>();
  for (const inv of invoices) if (inv.invoiceNumber) invByNum.set(normRef(inv.invoiceNumber), inv.id);

  const orderedIdx = events.map((_, i) => i).sort((a, b) => events[a].date.localeCompare(events[b].date));
  const results: number[][] = events.map(() => []);
  const claimed = new Set<number>();

  for (const idx of orderedIdx) {
    const r = events[idx];

    // L1: exact invoice_number match on every memo ref.
    const l1: number[] = [];
    for (const ref of r.invoiceRefs) {
      const hit = invByNum.get(normRef(ref));
      if (hit != null && !l1.includes(hit) && !claimed.has(hit)) l1.push(hit);
    }
    if (r.invoiceRefs.length > 0 && l1.length === r.invoiceRefs.length) {
      results[idx] = l1; l1.forEach(id => claimed.add(id));
      continue;
    }

    // L2/L3 candidate pool: unclaimed vendor invoices, date-gated.
    const eventCompanyC = stripWs(normaliseCompany(r.counterpartyRaw));
    if (!eventCompanyC) { results[idx] = l1; l1.forEach(id => claimed.add(id)); continue; }
    const evtMs = new Date(r.date + 'T00:00:00Z').getTime();
    const vendorInvoices = invoices.filter(inv => {
      if (claimed.has(inv.id)) return false;
      const invComp = stripWs(normaliseCompany(inv.companyName || inv.userName));
      if (!invComp) return false;
      if (!(invComp.includes(eventCompanyC) || eventCompanyC.includes(invComp))) return false;
      if (inv.periodEnd) {
        const daysDelta = (evtMs - new Date(inv.periodEnd + 'T00:00:00Z').getTime()) / 86400000;
        if (daysDelta < -DATE_LOOKAHEAD_DAYS || daysDelta > DATE_LOOKBACK_DAYS) return false;
      }
      return true;
    });
    if (vendorInvoices.length === 0) { results[idx] = l1; l1.forEach(id => claimed.add(id)); continue; }

    // L2 (single-invoice event): one vendor invoice whose totalAmount matches.
    if (r.invoiceRefs.length <= 1) {
      const amtHit = vendorInvoices.find(inv => Math.abs(inv.totalAmount - r.amount) < AMT_EPS);
      if (amtHit) { results[idx] = [amtHit.id]; claimed.add(amtHit.id); continue; }
      results[idx] = l1; l1.forEach(id => claimed.add(id));
      continue;
    }

    // L3 (multi-invoice memo): subset-sum on unclaimed vendor invoices.
    const cands = vendorInvoices.slice(0, 20);   // cap combinatorial cost
    const targetCents = Math.round(r.amount * 100);
    const size = r.invoiceRefs.length;
    let found = null as number[] | null;
    function rec(start: number, chosen: number[], sumCents: number) {
      if (found) return;
      if (chosen.length === size) {
        if (Math.abs(sumCents - targetCents) <= 2) found = chosen.slice();
        return;
      }
      for (let i = start; i < cands.length; i++) {
        const next = sumCents + Math.round(cands[i].totalAmount * 100);
        if (next > targetCents + 5) continue;
        chosen.push(cands[i].id);
        rec(i + 1, chosen, next);
        chosen.pop();
        if (found) return;
      }
    }
    rec(0, [], 0);
    if (found) { results[idx] = found; found.forEach((id: number) => claimed.add(id)); }
    else { results[idx] = l1; l1.forEach(id => claimed.add(id)); }
  }

  return results;
}
