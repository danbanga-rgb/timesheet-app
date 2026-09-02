// Convera → qb_ingest_events shadow-write. Phase 2 of the QB Automation Layer
// per [[intuit-qb-layer-spec]] v3.
//
// The primary write path (convera_transactions + convera_transaction_invoices)
// is untouched — this module writes a SHADOW event into qb_ingest_events so
// the unified QB Automation Inbox can surface Convera activity alongside
// Intuit XLSX imports. Downstream (Slice C) will push these as
// BillPaymentCheckAdd via QBWC, retiring the manual IIF export.
//
// Lifecycle (option (c) — mirrors Intuit pattern):
//   1. Import: on convera_transactions insert, upsert a shadow event with the
//      auto-match's matched_invoice_ids and status='pending' (or 'ignored'
//      when matcher_ignore is true — legacy pre-cutoff rows).
//   2. Match commit: on match_state transition, update the shadow event's
//      matched_invoice_ids and (for no_invoice) flip status to 'ignored'.
//
// source_ref convention: `${confirmation_number}::${line_item}` — a single
// wire confirmation can carry multiple line items (Convera splits multi-currency
// or multi-beneficiary wires this way). Uniqueness matches convera_transactions'
// natural key.
//
// This module is pure (no imports from React/UI state). The executor takes a
// SupabaseClient and returns counts. Testable via mock client.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConveraShadowInput {
  /** convera_transactions.id — carried in raw_data for cross-ref. */
  converaTransactionId: number;
  /** Wire confirmation code — part of source_ref. */
  confirmationNumber: string;
  /** Line item within the wire (1-based) — part of source_ref. */
  lineItem: number;
  /** ISO date (YYYY-MM-DD) — date_of_order. */
  txnDate: string;
  /** Beneficiary-currency amount (foreign_amount). Matches what invoice
   *  totals compare against. Slice C will use umbrella link amount_share
   *  for the actual QB BillPmt amount. */
  amount: number;
  /** As Convera spells it — populates counterparty_raw. */
  beneficiaryName: string;
  /** Wire reference line (invoice number annotation) — memo. */
  ref1: string | null;
  /** Auto-match or manual-match invoice ids. Empty until matched. */
  matchedInvoiceIds: number[];
  /** Convera matcher state at write time — persisted in raw_data. */
  matchState: 'unreviewed' | 'matched' | 'no_invoice' | 'flagged';
  /** Pre-cutoff historical rows — event.status='ignored' so Inbox filters
   *  them out. Same fencing pattern as convera_transactions.matcher_ignore. */
  matcherIgnore: boolean;
}

export interface ConveraShadowEventRow {
  source: 'convera';
  source_ref: string;
  txn_date: string;
  amount: number;
  counterparty_raw: string;
  memo: string | null;
  matched_invoice_ids: number[];
  status: 'pending' | 'ignored';
  raw_data: Record<string, unknown>;
}

/** Pure builder — no side effects. Testable. */
export function buildConveraShadowRow(input: ConveraShadowInput): ConveraShadowEventRow {
  return {
    source: 'convera',
    source_ref: `${input.confirmationNumber}::${input.lineItem}`,
    txn_date: input.txnDate,
    amount: input.amount,
    counterparty_raw: input.beneficiaryName,
    memo: input.ref1 || null,
    matched_invoice_ids: input.matchedInvoiceIds,
    status: input.matcherIgnore ? 'ignored' : 'pending',
    raw_data: {
      convera_transaction_id: input.converaTransactionId,
      confirmation_number: input.confirmationNumber,
      line_item: input.lineItem,
      ref1: input.ref1,
      match_state: input.matchState,
    },
  };
}

/**
 * Bulk-insert shadow events for freshly-imported convera_transactions rows.
 * Uses ignoreDuplicates on (source, source_ref) so re-import of the same wire
 * silently skips — mirrors the Intuit XLSX pattern (TimesheetSystem.tsx
 * commitIntuitXlsxToInbox). Existing events with the same source_ref are NOT
 * updated by this call — use updateConveraShadowMatch for state transitions.
 */
export async function insertConveraShadowEvents(
  supabase: SupabaseClient,
  inputs: ConveraShadowInput[],
): Promise<{ inserted: number; skipped: number }> {
  if (inputs.length === 0) return { inserted: 0, skipped: 0 };
  const rows = inputs.map(buildConveraShadowRow);
  const { data, error } = await supabase
    .from('qb_ingest_events')
    .upsert(rows, { onConflict: 'source,source_ref', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  const inserted = data?.length ?? 0;
  return { inserted, skipped: inputs.length - inserted };
}

export interface ConveraShadowMatchUpdate {
  confirmationNumber: string;
  lineItem: number;
  matchedInvoiceIds: number[];
  /** 'matched' | 'no_invoice' | 'flagged' — 'no_invoice' flips event.status
   *  to 'ignored' since we've decided this wire has no invoice-side work to
   *  push. Other states keep the event in the Inbox. */
  matchState: 'matched' | 'no_invoice' | 'flagged' | 'unreviewed';
}

/**
 * Update shadow events after a batch of match-state transitions. Runs one
 * UPDATE per event by (source, source_ref). Cheaper than the alternative
 * (delete + reinsert), and preserves the id/ingested_at of the shadow event
 * so any downstream references (qb_sync_job_ids etc.) survive.
 *
 * Rows with no matching shadow event are silently skipped — accountant may
 * have deleted the shadow row manually, or the event was never created
 * (e.g. matcher_ignore rows that got promoted post-cutoff).
 */
export async function updateConveraShadowMatch(
  supabase: SupabaseClient,
  updates: ConveraShadowMatchUpdate[],
): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;
  for (const u of updates) {
    const sourceRef = `${u.confirmationNumber}::${u.lineItem}`;
    const nextStatus = u.matchState === 'no_invoice' ? 'ignored' : 'pending';
    const { data, error } = await supabase
      .from('qb_ingest_events')
      .update({
        matched_invoice_ids: u.matchedInvoiceIds,
        status: nextStatus,
      })
      .eq('source', 'convera')
      .eq('source_ref', sourceRef)
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) updated += 1;
    else skipped += 1;
  }
  return { updated, skipped };
}
