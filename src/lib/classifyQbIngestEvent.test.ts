import { describe, it, expect } from 'vitest';
import {
  classifyOne,
  classifyBatch,
  resolveBankAccount,
  type ClassifiableEvent,
  type ClassifiableMapping,
  type ClassifiableInvoice,
  type ClassifiableVendor,
  type ClassifiableAccount,
  type ClassifyContext,
} from './classifyQbIngestEvent';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACCT_8220: ClassifiableAccount = { listId: 'ACCT-8220', fullName: 'Key Point Checking (8220)' };
const ACCT_ADMIN: ClassifiableAccount = { listId: 'ACCT-ADMIN', fullName: 'Administration salaries' };
const ACCT_OTHER: ClassifiableAccount = { listId: 'ACCT-OTHER', fullName: 'Some other account' };

const VENDOR_HOVER: ClassifiableVendor = { listId: 'VEND-HOVER', name: 'HOVERCLOUD' };
const VENDOR_FLAWLESS: ClassifiableVendor = { listId: 'VEND-FLAW', name: 'FLAWLESS' };

const vendorsMap = (vendors: ClassifiableVendor[]) =>
  new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));

function ctxOf(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    mappings: [],
    invoicesById: new Map(),
    vendorsByLowerName: vendorsMap([VENDOR_HOVER, VENDOR_FLAWLESS]),
    bankAccount: ACCT_8220,
    ...overrides,
  };
}

function eventOf(overrides: Partial<ClassifiableEvent> = {}): ClassifiableEvent {
  return {
    id: 1,
    source: 'intuit_xlsx',
    counterpartyRaw: 'Hover cloud technologies LLC',
    matchedInvoiceIds: [],
    status: 'pending',
    counterpartyQbVendorListId: null,
    targetQbTxnKind: null,
    qbBankAccountListId: null,
    qbExpenseAccountListId: null,
    ...overrides,
  };
}

// ─── Pass 1: explicit mapping ────────────────────────────────────────────────

describe('classifyOne — Pass 1: explicit mapping', () => {
  it('applies bill_pmt mapping and flips status to ready', () => {
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'Hover cloud technologies LLC',
      qbVendorListId: 'VEND-HOVER',
      defaultTargetKind: 'bill_pmt',
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: null,
    };
    const r = classifyOne(eventOf(), ctxOf({ mappings: [mapping] }));
    expect(r.source).toBe('mapping');
    expect(r.patch.target_qb_txn_kind).toBe('bill_pmt');
    expect(r.patch.counterparty_qb_vendor_list_id).toBe('VEND-HOVER');
    expect(r.patch.qb_bank_account_list_id).toBe('ACCT-8220');
    expect(r.patch.status).toBe('ready');
    expect(r.seedMapping).toBeUndefined();  // no re-seed for Pass 1
  });

  it('applies check mapping with expense account', () => {
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'Lucien C Pinto',
      qbVendorListId: 'VEND-LUCIEN',
      defaultTargetKind: 'check',
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: 'ACCT-ADMIN',
    };
    const event = eventOf({ counterpartyRaw: 'Lucien C Pinto' });
    const r = classifyOne(event, ctxOf({ mappings: [mapping] }));
    expect(r.source).toBe('mapping');
    expect(r.patch.target_qb_txn_kind).toBe('check');
    expect(r.patch.qb_expense_account_list_id).toBe('ACCT-ADMIN');
    expect(r.patch.status).toBe('ready');
  });

  it('applies ignore mapping — status becomes ignored, vendor/bank fields patched to null only if event had them set', () => {
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'CLOUDYGON',
      qbVendorListId: '',
      defaultTargetKind: 'ignore',
      defaultBankAccountListId: null,
      defaultExpenseAccountListId: null,
    };
    // Case A: event starts fully null → patch only carries kind + status (idempotent omit).
    const rA = classifyOne(eventOf({ counterpartyRaw: 'CLOUDYGON' }), ctxOf({ mappings: [mapping] }));
    expect(rA.source).toBe('mapping');
    expect(rA.patch.target_qb_txn_kind).toBe('ignore');
    expect(rA.patch.status).toBe('ignored');
    expect(rA.patch.counterparty_qb_vendor_list_id).toBeUndefined();  // no change from null → null
    expect(rA.patch.qb_bank_account_list_id).toBeUndefined();

    // Case B: event had stale vendor/bank from a prior mapping → patch clears them to null.
    const rB = classifyOne(
      eventOf({
        counterpartyRaw: 'CLOUDYGON',
        counterpartyQbVendorListId: 'VEND-STALE',
        qbBankAccountListId: 'ACCT-STALE',
      }),
      ctxOf({ mappings: [mapping] }),
    );
    expect(rB.patch.counterparty_qb_vendor_list_id).toBe(null);
    expect(rB.patch.qb_bank_account_list_id).toBe(null);
    expect(rB.patch.status).toBe('ignored');
  });

  it('bill_add_and_pmt mapping includes expense account', () => {
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'TechAntz Inc.',
      qbVendorListId: 'VEND-TA',
      defaultTargetKind: 'bill_add_and_pmt',
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: 'ACCT-ADMIN',
    };
    const event = eventOf({ counterpartyRaw: 'TechAntz Inc.' });
    const r = classifyOne(event, ctxOf({ mappings: [mapping] }));
    expect(r.source).toBe('mapping');
    expect(r.patch.qb_expense_account_list_id).toBe('ACCT-ADMIN');
  });

  it('mapping with different source does not apply', () => {
    const mapping: ClassifiableMapping = {
      source: 'convera',   // wrong source
      counterpartyPattern: 'Hover cloud technologies LLC',
      qbVendorListId: 'VEND-HOVER',
      defaultTargetKind: 'bill_pmt',
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: null,
    };
    const r = classifyOne(eventOf(), ctxOf({ mappings: [mapping] }));
    // Falls through to Pass 2, which needs invoice — event has none.
    expect(r.source).toBe(null);
    expect(r.skipReason).toBe('no matched invoice');
  });

  it('mapping with null defaultTargetKind is skipped (falls through to Pass 2)', () => {
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'Hover cloud technologies LLC',
      qbVendorListId: 'VEND-HOVER',
      defaultTargetKind: null,  // never happens today but defensive
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: null,
    };
    const r = classifyOne(eventOf(), ctxOf({ mappings: [mapping] }));
    expect(r.source).toBe(null);
  });
});

// ─── Pass 2: profile-chain inference ─────────────────────────────────────────

describe('classifyOne — Pass 2: profile-chain', () => {
  it('resolves via invoice → paymentProfile.qbVendorName → qb_vendors', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, invoice]]) }));
    expect(r.source).toBe('profile-chain');
    expect(r.patch.target_qb_txn_kind).toBe('bill_pmt');
    expect(r.patch.counterparty_qb_vendor_list_id).toBe('VEND-HOVER');
    expect(r.patch.qb_bank_account_list_id).toBe('ACCT-8220');
    expect(r.patch.status).toBe('ready');
    expect(r.seedMapping).toBeDefined();
    expect(r.seedMapping?.source).toBe('intuit_xlsx');
    expect(r.seedMapping?.counterparty_pattern).toBe('Hover cloud technologies LLC');
    expect(r.seedMapping?.qb_vendor_list_id).toBe('VEND-HOVER');
  });

  it('case-insensitive vendor match ("hovercloud" ↔ "HOVERCLOUD")', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'hovercloud' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, invoice]]) }));
    expect(r.source).toBe('profile-chain');
  });

  it('trims whitespace on vendor name', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: '  HOVERCLOUD  ' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, invoice]]) }));
    expect(r.source).toBe('profile-chain');
  });

  it('picks the first matched invoice when multiple are matched', () => {
    const inv100: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const inv101: ClassifiableInvoice = { id: 101, paymentProfileQbVendorName: 'FLAWLESS' };  // ignored
    const event = eventOf({ matchedInvoiceIds: [100, 101] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, inv100], [101, inv101]]) }));
    expect(r.source).toBe('profile-chain');
    expect(r.patch.counterparty_qb_vendor_list_id).toBe('VEND-HOVER');
  });

  it('skipReason="no matched invoice" when matchedInvoiceIds is empty', () => {
    const r = classifyOne(eventOf(), ctxOf());
    expect(r.source).toBe(null);
    expect(r.skipReason).toBe('no matched invoice');
    expect(r.patch).toEqual({});
  });

  it('skipReason when matched invoice id not in the map', () => {
    const r = classifyOne(eventOf({ matchedInvoiceIds: [999] }), ctxOf());
    expect(r.source).toBe(null);
    expect(r.skipReason).toBe('matched invoice not found');
  });

  it('skipReason when payment profile has no qbVendorName', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: null };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, invoice]]) }));
    expect(r.source).toBe(null);
    expect(r.skipReason).toBe('profile missing qb_vendor_name');
  });

  it('skipReason when qbVendorName does not match any qb_vendors row', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'UNKNOWN VENDOR' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({ invoicesById: new Map([[100, invoice]]) }));
    expect(r.source).toBe(null);
    expect(r.skipReason).toContain('UNKNOWN VENDOR');
  });

  it('skipReason when bank account is missing (8220 not resolved)', () => {
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({
      invoicesById: new Map([[100, invoice]]),
      bankAccount: null,
    }));
    expect(r.source).toBe(null);
    expect(r.skipReason).toBe('bank account (8220) not found');
  });
});

// ─── Precedence + status guards ──────────────────────────────────────────────

describe('classifyOne — precedence and guards', () => {
  it('explicit mapping wins over profile chain (ignore beats bill_pmt)', () => {
    // CLOUDYGON case: even though a matched invoice with a qb_vendor exists,
    // an explicit ignore mapping must win.
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'Hover cloud technologies LLC',
      qbVendorListId: '',
      defaultTargetKind: 'ignore',
      defaultBankAccountListId: null,
      defaultExpenseAccountListId: null,
    };
    const invoice: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const event = eventOf({ matchedInvoiceIds: [100] });
    const r = classifyOne(event, ctxOf({
      mappings: [mapping],
      invoicesById: new Map([[100, invoice]]),
    }));
    expect(r.source).toBe('mapping');
    expect(r.patch.target_qb_txn_kind).toBe('ignore');
    expect(r.patch.status).toBe('ignored');
  });

  it('does not touch already-ready events (status guard)', () => {
    const event = eventOf({ status: 'ready' });
    const r = classifyOne(event, ctxOf());
    expect(r.source).toBe(null);
    expect(r.skipReason).toContain('not pending');
    expect(r.patch).toEqual({});
  });

  it('does not touch posted events', () => {
    const event = eventOf({ status: 'posted' });
    const r = classifyOne(event, ctxOf());
    expect(r.source).toBe(null);
  });

  it('empty patch when classifier would set values already matching event state', () => {
    // Idempotency: an event that's already been correctly classified but still
    // status='pending' (edge case) should produce a minimal patch — only status.
    const mapping: ClassifiableMapping = {
      source: 'intuit_xlsx',
      counterpartyPattern: 'Hover cloud technologies LLC',
      qbVendorListId: 'VEND-HOVER',
      defaultTargetKind: 'bill_pmt',
      defaultBankAccountListId: 'ACCT-8220',
      defaultExpenseAccountListId: null,
    };
    const event = eventOf({
      counterpartyQbVendorListId: 'VEND-HOVER',
      targetQbTxnKind: 'bill_pmt',
      qbBankAccountListId: 'ACCT-8220',
    });
    const r = classifyOne(event, ctxOf({ mappings: [mapping] }));
    expect(r.source).toBe('mapping');
    expect(r.patch.counterparty_qb_vendor_list_id).toBeUndefined();
    expect(r.patch.target_qb_txn_kind).toBeUndefined();
    expect(r.patch.qb_bank_account_list_id).toBeUndefined();
    expect(r.patch.status).toBe('ready');  // only status changes
  });
});

// ─── Batch API + seed dedup ──────────────────────────────────────────────────

describe('classifyBatch', () => {
  it('de-dupes seed mappings across multiple events with same counterparty_raw', () => {
    const inv: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const events = [
      eventOf({ id: 1, matchedInvoiceIds: [100] }),
      eventOf({ id: 2, matchedInvoiceIds: [100] }),
      eventOf({ id: 3, matchedInvoiceIds: [100] }),
    ];
    const { results, seedMappings } = classifyBatch(events, ctxOf({
      invoicesById: new Map([[100, inv]]),
    }));
    expect(results).toHaveLength(3);
    expect(results.every(r => r.result.source === 'profile-chain')).toBe(true);
    expect(seedMappings).toHaveLength(1);   // deduped
    expect(seedMappings[0]?.counterparty_pattern).toBe('Hover cloud technologies LLC');
  });

  it('keeps separate seeds for different counterparties', () => {
    const invA: ClassifiableInvoice = { id: 100, paymentProfileQbVendorName: 'HOVERCLOUD' };
    const invB: ClassifiableInvoice = { id: 200, paymentProfileQbVendorName: 'FLAWLESS' };
    const events = [
      eventOf({ id: 1, matchedInvoiceIds: [100] }),
      eventOf({ id: 2, counterpartyRaw: 'Flawless Apps LLC', matchedInvoiceIds: [200] }),
    ];
    const { seedMappings } = classifyBatch(events, ctxOf({
      invoicesById: new Map([[100, invA], [200, invB]]),
    }));
    expect(seedMappings).toHaveLength(2);
  });
});

// ─── resolveBankAccount ──────────────────────────────────────────────────────

describe('resolveBankAccount', () => {
  it('finds account by substring in fullName (default "8220")', () => {
    const acct = resolveBankAccount([ACCT_OTHER, ACCT_8220]);
    expect(acct?.listId).toBe('ACCT-8220');
  });

  it('returns null when no account matches', () => {
    expect(resolveBankAccount([ACCT_OTHER, ACCT_ADMIN])).toBe(null);
  });

  it('accepts a custom pattern', () => {
    const acct = resolveBankAccount([ACCT_OTHER, ACCT_ADMIN], 'admin');
    expect(acct?.listId).toBe('ACCT-ADMIN');
  });
});
