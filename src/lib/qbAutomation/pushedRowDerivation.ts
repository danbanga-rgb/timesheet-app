import type { QbResolvedAction } from '../../types';
import type { MatchProvenance } from '../matchProvenance';
import type { QbOpenBillRow } from '../qbStateSync/types';

// Structured display fields for a Pushed row. Two axes:
//   1. resolvedAction + resolvedRefLabel + isG75Source → the "action chip"
//      (what actually happened in QB — created bill, paid, wrote check).
//   2. matchProvenance → the "match chip" (how we linked our event to
//      that QB record — deterministic txn id, memo ref match, we-created
//      -pay, fuzzy, none).
//
// Lifted from V1's renderPostedRow (TS.tsx:8632-8670). V2 consumes now;
// V1 will migrate at V12 cutover. Keep both surfaces reading from these
// helpers so labelling never drifts.
export interface PushedRowDisplay {
  resolvedAction: QbResolvedAction | null;
  resolvedRefLabel: string | null;   // "INV 51" — resolved bill's refNumber if known, invoice number for synthetic
  isG75Source: boolean;              // affects create_bill_then_pay label wording
  matchProvenance: MatchProvenance | null;
}

export interface PushedEventInput {
  resolvedAction: QbResolvedAction | null;
  resolvedBillTxnId: string | null;
  matchProvenance: MatchProvenance | null;
  source: string;                    // 'invoice_g75' | 'convera' | 'intuit' | ...
}

export function derivePushedRowDisplay(
  e: PushedEventInput,
  billByTxnId: Map<string, QbOpenBillRow>,
): PushedRowDisplay {
  const resolvedBill = e.resolvedBillTxnId ? billByTxnId.get(e.resolvedBillTxnId) ?? null : null;
  return {
    resolvedAction: e.resolvedAction,
    resolvedRefLabel: resolvedBill?.refNumber ?? null,
    isG75Source: e.source === 'invoice_g75',
    matchProvenance: e.matchProvenance,
  };
}

// Synthetic G7.5/G7.6 rows represent our invoice-driven create-bill pushes
// where success writes qb_bill_txn_id back on the invoice (not the event).
// We created it, so ref is our invoice number and provenance is always
// exact-ref (invoice.qb_bill_txn_id → 1:1 our push).
export function deriveSyntheticPushedRowDisplay(
  kind: 'g75' | 'g76',
  invoiceNumber: string | null,
): PushedRowDisplay {
  return {
    resolvedAction: 'create_bill_then_pay',
    resolvedRefLabel: invoiceNumber && invoiceNumber.length > 0 ? invoiceNumber : null,
    isG75Source: kind === 'g75',
    matchProvenance: 'exact-ref',
  };
}

// Human-readable action label. Pushed card only contains posted rows, so
// the "will X" branches from V1 don't apply here.
export function formatActionLabel(d: PushedRowDisplay): string {
  const ref = d.resolvedRefLabel;
  switch (d.resolvedAction) {
    case 'already_done':
    case 'pay_existing_bill':
      return ref ? `paid: ${ref}` : 'paid';
    case 'create_bill_then_pay':
      if (d.isG75Source) return ref ? `created bill: ${ref}` : 'created bill';
      return ref ? `created bill + paid: ${ref}` : 'created bill + paid';
    case 'check':
      return 'wrote check';
    case 'held':
    case 'pre_our_system':
    case null:
      return '';
  }
}

export interface ProvenanceBadge {
  text: string;
  tooltip: string;
  bg: string;
  fg: string;
}

// Provenance badge palette lifted from V1 (TS.tsx:8656-8686) — same colors,
// same emoji, same tooltip wording so v1 and v2 stay visually identical.
export function formatProvenanceBadge(p: MatchProvenance | null): ProvenanceBadge {
  switch (p) {
    case 'exact-txn':
      return {
        text: '🔒 exact-txn',
        tooltip: 'invoice.qb_bill_txn_id matches — deterministic 1:1 link',
        bg: 'bg-emerald-100',
        fg: 'text-emerald-800',
      };
    case 'exact-ref':
      return {
        text: '✓ exact-ref',
        tooltip: 'memo names this invoice by number',
        bg: 'bg-teal-100',
        fg: 'text-teal-800',
      };
    case 'created-pay':
      return {
        text: '🆕 created-pay',
        tooltip: 'We created this bill (no matching invoice in our system) and paid it — vendor mapping authorizes this',
        bg: 'bg-violet-100',
        fg: 'text-violet-800',
      };
    case 'fuzzy':
      return {
        text: '~ fuzzy',
        tooltip: 'matched by vendor+amount only — verify before pushing',
        bg: 'bg-amber-100',
        fg: 'text-amber-800',
      };
    case 'empty':
    case null:
      return {
        text: '— empty',
        tooltip: 'no invoice link',
        bg: 'bg-gray-100',
        fg: 'text-gray-600',
      };
  }
}
