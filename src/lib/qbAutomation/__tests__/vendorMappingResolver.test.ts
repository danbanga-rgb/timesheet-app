import { describe, it, expect } from 'vitest';
import { resolveVendorCandidates, buildHistoryByUser, type ResolveContext } from '../vendorMappingResolver';

const vendors = [
  { listId: 'V-BIMO-FARUK',    name: 'Bimosoft - Faruk Sinanović' },
  { listId: 'V-BIMO-EDIN',     name: 'Bimosoft - Edin Jasarspahic' },
  { listId: 'V-BIMO-NARETENA', name: 'Bimosoft - Naretena Arnaut' },
  { listId: 'V-NT-AHMET',      name: 'Native Team - Ahmet Buzaljko' },
  { listId: 'V-NT-NEJRA',      name: 'Native Team Nejra' },
  { listId: 'V-TEAL',          name: 'Teal Crossroads' },
  { listId: 'V-YARA',          name: 'Yara Solutions Inc.' },
  { listId: 'V-HOVER',         name: 'Hovercloud Technologies' },
];

const emptyCtx: ResolveContext = { vendors, historyByUser: new Map() };

describe('resolveVendorCandidates — tier 3 (token overlap)', () => {
  it('finds "Bimosoft - Faruk Sinanović" for Faruk on the Bimosoft pp', () => {
    const cs = resolveVendorCandidates(
      { contractorName: 'Faruk Sinanović', contractorUserId: null, ppLabel: 'Bimosoft' },
      emptyCtx,
    );
    expect(cs[0]?.qbVendorName).toBe('Bimosoft - Faruk Sinanović');
    expect(cs[0]?.confidence).toBe('high');   // 2 tokens matched (bimosoft + faruk or sinanovic)
    expect(cs[0]?.tier).toBe('token_overlap');
  });

  it('finds "Native Team - Ahmet Buzaljko" for Ahmet on Native Teams', () => {
    const cs = resolveVendorCandidates(
      { contractorName: 'Ahmet Buzaljko', contractorUserId: null, ppLabel: 'Native Teams' },
      emptyCtx,
    );
    expect(cs[0]?.qbVendorName).toBe('Native Team - Ahmet Buzaljko');
    expect(cs[0]?.confidence).toBe('high');
  });

  it('returns MEDIUM when only pp label matches with a strong token', () => {
    // Unknown contractor, but pp label "Hovercloud" hits Hovercloud Technologies.
    const cs = resolveVendorCandidates(
      { contractorName: 'Someone Unknown', contractorUserId: null, ppLabel: 'Hovercloud' },
      emptyCtx,
    );
    const hover = cs.find(c => c.qbVendorName === 'Hovercloud Technologies');
    expect(hover?.confidence).toBe('medium');   // 1 long token (hovercloud, 10 chars)
  });

  it('returns empty when no tokens overlap and no history', () => {
    const cs = resolveVendorCandidates(
      { contractorName: 'X Y', contractorUserId: null, ppLabel: 'Nonsense Wire Memo' },
      emptyCtx,
    );
    expect(cs).toEqual([]);
  });

  it('ignores stopwords (ltd, inc, llc, etc.)', () => {
    const cs = resolveVendorCandidates(
      { contractorName: 'Company Ltd', contractorUserId: null, ppLabel: 'Solutions Inc' },
      emptyCtx,
    );
    // Yara Solutions Inc contains "solutions" which is 9 chars — matches.
    // But "ltd"/"inc" are stopwords so don't count.
    const yara = cs.find(c => c.qbVendorName === 'Yara Solutions Inc.');
    expect(yara?.confidence).toBe('medium');   // 1 strong token (solutions)
  });

  it('caps at 3 candidates by default', () => {
    const cs = resolveVendorCandidates(
      { contractorName: 'Bimosoft', contractorUserId: null, ppLabel: 'Bimosoft' },
      emptyCtx,
    );
    // "bimosoft" hits all 3 Bimosoft vendors.
    expect(cs.length).toBe(3);
  });
});

describe('resolveVendorCandidates — tier 2 (history)', () => {
  it('surfaces the historical vendor with HIGH confidence', () => {
    const historyByUser = new Map<string, Set<string>>([
      ['user-nejra', new Set(['V-NT-NEJRA'])],
    ]);
    const cs = resolveVendorCandidates(
      { contractorName: 'Nejra Muzaferija', contractorUserId: 'user-nejra', ppLabel: 'Native Teams' },
      { vendors, historyByUser },
    );
    expect(cs[0]?.qbVendorName).toBe('Native Team Nejra');
    expect(cs[0]?.confidence).toBe('high');
    expect(cs[0]?.tier).toBe('history');
  });

  it('history takes priority over token overlap for the same vendor', () => {
    const historyByUser = new Map<string, Set<string>>([
      ['user-faruk', new Set(['V-BIMO-FARUK'])],
    ]);
    const cs = resolveVendorCandidates(
      { contractorName: 'Faruk Sinanović', contractorUserId: 'user-faruk', ppLabel: 'Bimosoft' },
      { vendors, historyByUser },
    );
    const faruk = cs.find(c => c.qbVendorName === 'Bimosoft - Faruk Sinanović');
    expect(faruk?.tier).toBe('history');   // history won, not token_overlap
  });

  it('falls back to token overlap when history has no match', () => {
    // History points to a vendor that no longer exists in the vendors list.
    const historyByUser = new Map<string, Set<string>>([
      ['user-nejra', new Set(['V-DELETED-VENDOR'])],
    ]);
    const cs = resolveVendorCandidates(
      { contractorName: 'Nejra Muzaferija', contractorUserId: 'user-nejra', ppLabel: 'Native Teams' },
      { vendors, historyByUser },
    );
    expect(cs.length).toBeGreaterThan(0);
    expect(cs[0]?.tier).toBe('token_overlap');   // history had a stale listId → skipped
  });

  it('returns nothing when contractorUserId is null and no token match', () => {
    const historyByUser = new Map<string, Set<string>>([
      ['user-someone', new Set(['V-YARA'])],
    ]);
    const cs = resolveVendorCandidates(
      { contractorName: 'X Y', contractorUserId: null, ppLabel: 'Nonsense' },
      { vendors, historyByUser },
    );
    expect(cs).toEqual([]);
  });
});

describe('buildHistoryByUser', () => {
  it('groups posted events by user via matched_invoice_ids', () => {
    const events = [
      { status: 'posted',  counterpartyQbVendorListId: 'V-A', matchedInvoiceIds: [1] },
      { status: 'posted',  counterpartyQbVendorListId: 'V-A', matchedInvoiceIds: [2] },
      { status: 'posted',  counterpartyQbVendorListId: 'V-B', matchedInvoiceIds: [3] },
      { status: 'ready',   counterpartyQbVendorListId: 'V-C', matchedInvoiceIds: [4] }, // not posted → skip
      { status: 'posted',  counterpartyQbVendorListId: null,  matchedInvoiceIds: [5] }, // no vendor → skip
      { status: 'posted',  counterpartyQbVendorListId: 'V-D', matchedInvoiceIds: [] },  // no invoice → skip
    ];
    const invoiceUserIdById = new Map<number, string>([[1, 'u1'], [2, 'u1'], [3, 'u2'], [4, 'u3'], [5, 'u4']]);
    const h = buildHistoryByUser(events, invoiceUserIdById);
    expect(h.get('u1')).toEqual(new Set(['V-A']));
    expect(h.get('u2')).toEqual(new Set(['V-B']));
    expect(h.get('u3')).toBeUndefined();  // ready, not posted
    expect(h.get('u4')).toBeUndefined();  // no vendor
  });
});
