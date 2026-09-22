// Discrepancy detection for QB Automation v2 Ready rows.
// Per plan §5.8. Ships 3 of 6 rules — the ones with clean data paths today.
// Rules 2 (bank drift), 5 (AI-suggested MEDIUM), 6 (missing expense fallback)
// deferred until data / flow supports them.

export type DiscrepancyKind = 'rate_drift' | 'umbrella_mismap' | 'duplicate_refnumber';

export interface Discrepancy {
  kind: DiscrepancyKind;
  message: string;      // display-ready
  resolveHint: string;  // "Edit rate in Payment Profiles" style
}

export interface DiscrepancyInput {
  invoiceRate: number | null;
  invoicePeriodEnd: string;   // 'YYYY-MM-DD'
  invoiceUserId: string | null;
  vendorListId: string | null;
  vendorName: string;
  refNumber: string;
  monthKey: string;           // 'YYYY-MM'
}

export interface RateHistoryEntry {
  userId: string;
  rateKind: string;     // 'pay' | 'bill'
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface DiscrepancyContext {
  rateHistory: RateHistoryEntry[];
  /** vendorListId → set of distinct contractor userIds historically routed there. */
  vendorContractors: Map<string, Set<string>>;
  /** All open bills — used to detect (vendor, refNumber) collisions in a different month. */
  openBills: Array<{ vendorListId: string; refNumber: string; txnDate: string | null }>;
}

const UMBRELLA_MIN_CONTRACTORS = 2;

function currentPayRate(
  history: RateHistoryEntry[],
  userId: string,
  asOf: string,
): number | null {
  const applicable = history.filter(r =>
    r.userId === userId
    && r.rateKind === 'pay'
    && r.effectiveFrom <= asOf
    && (r.effectiveTo === null || r.effectiveTo > asOf),
  );
  if (applicable.length === 0) return null;
  // Newest effective_from wins if overlap.
  applicable.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return applicable[0].rate;
}

function normalizeRefSimple(s: string): string {
  return s.toUpperCase().replace(/^(INV[\s#\-]*)+/, '').replace(/^#\s*/, '').trim();
}

export function detectDiscrepancies(input: DiscrepancyInput, ctx: DiscrepancyContext): Discrepancy[] {
  const out: Discrepancy[] = [];

  // Rule 1 — Rate drift.
  if (input.invoiceRate != null && input.invoiceUserId && input.invoicePeriodEnd) {
    const currentRate = currentPayRate(ctx.rateHistory, input.invoiceUserId, input.invoicePeriodEnd);
    if (currentRate != null && currentRate !== input.invoiceRate) {
      out.push({
        kind: 'rate_drift',
        message: `Invoice rate $${input.invoiceRate} ≠ current contract rate $${currentRate}`,
        resolveHint: 'Verify the invoice or update the pay rate in rate_history',
      });
    }
  }

  // Rule 3 — Umbrella mismap.
  if (input.vendorListId) {
    const contractors = ctx.vendorContractors.get(input.vendorListId);
    if (contractors && contractors.size >= UMBRELLA_MIN_CONTRACTORS) {
      out.push({
        kind: 'umbrella_mismap',
        message: `${input.vendorName} is a shared QB vendor across ${contractors.size} contractors — verify this is the right target`,
        resolveHint: 'Edit the vendor mapping in the Vendor Mapping sub-tab',
      });
    }
  }

  // Rule 4 — Duplicate RefNumber (different month).
  if (input.vendorListId && input.refNumber && input.monthKey) {
    const wantRef = normalizeRefSimple(input.refNumber);
    if (wantRef) {
      const collision = ctx.openBills.find(b =>
        b.vendorListId === input.vendorListId
        && normalizeRefSimple(b.refNumber) === wantRef
        && (b.txnDate ?? '').slice(0, 7) !== input.monthKey,
      );
      if (collision) {
        out.push({
          kind: 'duplicate_refnumber',
          message: `QB already has a bill with ref ${input.refNumber} for this vendor (dated ${collision.txnDate ?? 'unknown'})`,
          resolveHint: 'Confirm the invoice number is unique or renumber before pushing',
        });
      }
    }
  }

  return out;
}
