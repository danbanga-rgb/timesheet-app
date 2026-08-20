// ============================================================
// classifyQbIngestEvent.ts — pure classifier for QB Automation Layer.
//
// Given a pending qb_ingest_events row plus the current world (mappings,
// invoices, profiles, vendors, bank), decide how the event should be
// classified for QB push.
//
// Called from:
//   - commitIntuitXlsxToInbox (post-insert)
//   - runRecomputeButton      (post-invoice-matcher)
//   - auto-recompute effect   (post-invoice-matcher)
//   - (future) Convera shadow-write adapter, bank/CC loaders, manual UI
//
// Two-pass strategy:
//   Pass 1 — explicit mapping wins (from qb_vendor_mappings).
//   Pass 2 — profile-chain inference: event → matched invoice →
//            paymentProfile.qbVendorName → qb_vendors.list_id.
//            When Pass 2 fires, we also emit a seed mapping row so
//            future events for the same counterparty_raw hit Pass 1.
// ============================================================

export type QbIngestKind = 'bill_pmt' | 'bill_add_and_pmt' | 'check' | 'ignore';
export type QbIngestStatus = 'pending' | 'ready' | 'queued' | 'posted' | 'failed' | 'ignored';

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface ClassifiableEvent {
  id: number;
  source: string;                       // 'intuit_xlsx' | 'convera' | 'manual' | ...
  counterpartyRaw: string;
  matchedInvoiceIds: number[];
  status: QbIngestStatus;
  // Existing classification (may be filled from a prior pass or a prior save)
  counterpartyQbVendorListId: string | null;
  targetQbTxnKind: QbIngestKind | null;
  qbBankAccountListId: string | null;
  qbExpenseAccountListId: string | null;
}

export interface ClassifiableMapping {
  source: string;
  counterpartyPattern: string;          // exact match on counterparty_raw (for now)
  qbVendorListId: string;
  defaultTargetKind: QbIngestKind | null;
  defaultBankAccountListId: string | null;
  defaultExpenseAccountListId: string | null;
}

export interface ClassifiableInvoice {
  id: number;
  paymentProfileQbVendorName: string | null;   // invoice.paymentProfile?.qbVendorName
}

export interface ClassifiableVendor {
  listId: string;
  name: string;
}

export interface ClassifiableAccount {
  listId: string;
  fullName: string;
}

export interface ClassifyContext {
  mappings: ClassifiableMapping[];
  invoicesById: Map<number, ClassifiableInvoice>;
  vendorsByLowerName: Map<string, ClassifiableVendor>;
  bankAccount: ClassifiableAccount | null;  // pre-resolved (e.g. "Key Point 8220"); may be null
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  // The fields to PATCH onto qb_ingest_events. Include only fields that changed.
  patch: {
    counterparty_qb_vendor_list_id?: string | null;
    target_qb_txn_kind?: QbIngestKind;
    qb_bank_account_list_id?: string | null;
    qb_expense_account_list_id?: string | null;
    status?: QbIngestStatus;
    status_updated_at?: string;
  };
  // If Pass 2 fired, upsert this into qb_vendor_mappings so future events for
  // the same counterparty_raw hit Pass 1. Undefined = no seed.
  seedMapping?: {
    source: string;
    counterparty_pattern: string;
    qb_vendor_list_id: string;
    default_target_kind: QbIngestKind;
    default_bank_account_list_id: string | null;
    default_expense_account_list_id: string | null;
  };
  // Debug: which pass produced this result. null = no classification (stays pending).
  source: 'mapping' | 'profile-chain' | null;
  // Reason (populated only when source=null) — surfaced to help debugging held-back events.
  skipReason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = () => new Date().toISOString();

const buildPatch = (
  event: ClassifiableEvent,
  vendorListId: string | null,
  kind: QbIngestKind,
  bankListId: string | null,
  expenseListId: string | null,
  nextStatus: QbIngestStatus,
): ClassificationResult['patch'] => {
  const patch: ClassificationResult['patch'] = {};
  if (event.counterpartyQbVendorListId !== vendorListId) patch.counterparty_qb_vendor_list_id = vendorListId;
  if (event.targetQbTxnKind !== kind) patch.target_qb_txn_kind = kind;
  if (event.qbBankAccountListId !== bankListId) patch.qb_bank_account_list_id = bankListId;
  if (event.qbExpenseAccountListId !== expenseListId) patch.qb_expense_account_list_id = expenseListId;
  if (event.status !== nextStatus) patch.status = nextStatus;
  if (Object.keys(patch).length > 0) patch.status_updated_at = NOW();
  return patch;
};

// ─── Pass 1: explicit mapping ────────────────────────────────────────────────

function applyExplicitMapping(
  event: ClassifiableEvent,
  ctx: ClassifyContext,
): ClassificationResult | null {
  const m = ctx.mappings.find(
    x => x.source === event.source && x.counterpartyPattern === event.counterpartyRaw,
  );
  if (!m || !m.defaultTargetKind) return null;

  const kind = m.defaultTargetKind;
  const nextStatus: QbIngestStatus = kind === 'ignore' ? 'ignored' : 'ready';
  const vendorListId = kind === 'ignore' ? null : (m.qbVendorListId || null);
  const bankListId = kind === 'ignore' ? null : m.defaultBankAccountListId;
  const expenseListId = (kind === 'check' || kind === 'bill_add_and_pmt')
    ? m.defaultExpenseAccountListId
    : null;

  return {
    patch: buildPatch(event, vendorListId, kind, bankListId, expenseListId, nextStatus),
    source: 'mapping',
  };
}

// ─── Pass 2: profile-chain inference ─────────────────────────────────────────

function applyProfileChain(
  event: ClassifiableEvent,
  ctx: ClassifyContext,
): ClassificationResult | null {
  if (event.matchedInvoiceIds.length === 0) {
    return { patch: {}, source: null, skipReason: 'no matched invoice' };
  }
  const firstInvoiceId = event.matchedInvoiceIds[0];
  const invoice = ctx.invoicesById.get(firstInvoiceId);
  if (!invoice) return { patch: {}, source: null, skipReason: 'matched invoice not found' };

  const qbVendorName = invoice.paymentProfileQbVendorName;
  if (!qbVendorName) return { patch: {}, source: null, skipReason: 'profile missing qb_vendor_name' };

  const vendor = ctx.vendorsByLowerName.get(qbVendorName.toLowerCase().trim());
  if (!vendor) return { patch: {}, source: null, skipReason: `qb_vendor "${qbVendorName}" not in qb_vendors` };

  if (!ctx.bankAccount) return { patch: {}, source: null, skipReason: 'bank account (8220) not found' };

  const kind: QbIngestKind = 'bill_pmt';
  const nextStatus: QbIngestStatus = 'ready';
  return {
    patch: buildPatch(event, vendor.listId, kind, ctx.bankAccount.listId, null, nextStatus),
    source: 'profile-chain',
    seedMapping: {
      source: event.source,
      counterparty_pattern: event.counterpartyRaw,
      qb_vendor_list_id: vendor.listId,
      default_target_kind: kind,
      default_bank_account_list_id: ctx.bankAccount.listId,
      default_expense_account_list_id: null,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify one event. Returns:
 *   - source='mapping' when an explicit qb_vendor_mappings row applied
 *   - source='profile-chain' when the invoice→profile→qbVendorName chain resolved
 *   - source=null with a skipReason when neither pass could classify
 *
 * Only considers events with status='pending'. Events that already ready/ignored/
 * posted/queued/failed are returned as source=null (no-op) to avoid clobbering.
 */
export function classifyOne(event: ClassifiableEvent, ctx: ClassifyContext): ClassificationResult {
  if (event.status !== 'pending') {
    return { patch: {}, source: null, skipReason: `status=${event.status} — not pending` };
  }
  const pass1 = applyExplicitMapping(event, ctx);
  if (pass1) return pass1;
  const pass2 = applyProfileChain(event, ctx);
  if (pass2) return pass2;
  // applyProfileChain always returns something for pending events, so this
  // fallback should be unreachable. Kept defensively.
  return { patch: {}, source: null, skipReason: 'unclassified' };
}

/**
 * Batch classifier. Returns the per-event results plus a de-duplicated list
 * of mappings to upsert. Callers apply the patches and mappings to the DB.
 */
export function classifyBatch(
  events: ClassifiableEvent[],
  ctx: ClassifyContext,
): {
  results: Array<{ event: ClassifiableEvent; result: ClassificationResult }>;
  seedMappings: ClassificationResult['seedMapping'][];
} {
  const results: Array<{ event: ClassifiableEvent; result: ClassificationResult }> = [];
  const seedByKey = new Map<string, NonNullable<ClassificationResult['seedMapping']>>();
  for (const e of events) {
    const r = classifyOne(e, ctx);
    results.push({ event: e, result: r });
    if (r.seedMapping) {
      const k = `${r.seedMapping.source}||${r.seedMapping.counterparty_pattern}`;
      if (!seedByKey.has(k)) seedByKey.set(k, r.seedMapping);
    }
  }
  return { results, seedMappings: [...seedByKey.values()] };
}

/**
 * Resolve the Intuit/Convera bill_pmt bank account by fullName pattern.
 * Per [[intuit-push-context]] the account is Key Point checking (contains "8220").
 * Returns null if no match — callers should treat this as a non-fatal warning
 * (events stay pending, accountant sees "bank account not found" reason).
 */
export function resolveBankAccount(
  accounts: ClassifiableAccount[],
  pattern: string = '8220',
): ClassifiableAccount | null {
  const p = pattern.toLowerCase();
  return accounts.find(a => a.fullName.toLowerCase().includes(p)) ?? null;
}
