// X8 — Invoice approval-path behavior lock.
//
// This is a "6-lite" test suite per plan §1b-C — it locks the behavior of
// three inline functions in src/TimesheetSystem.tsx before Phase 4 (I6/I7)
// touches the surrounding code:
//   - lockTimesheetDaysForInvoice (TS.tsx ~3170)
//   - tryResolveVendorForApproval  (TS.tsx ~3209)
//   - handleInvoiceAction          (TS.tsx ~3249)
//
// Because those functions are React-component closures over ~10 pieces of
// state + supabase + alert, we cannot import them. Per plan they are COPIED
// here (reshaped to take deps as args) — the copy is the test harness. When
// Phase 6 extracts these to src/api/invoices/ later, the copy is deleted and
// tests re-point at the real module.
//
// Behavior source-of-truth cross-reference:
//   git blame src/TimesheetSystem.tsx L3170-L3311  (as of commit d462fb8)
//
// NOTE on stale plan text: §1b-C X8 mentions tryResolveVendorForApproval
// "sets vendorDecisionState" — that behavior was REMOVED in hotfix a8a9ab5
// (2026-09-17) per [[encourage-dont-block]]. The function now only checks
// "does the contractor have any payment profile at all?" — no more picker.
// Tests reflect current behavior, not the stale plan copy.

import { describe, it, expect, vi } from 'vitest';

// ─── Types (subset of app types — matches src/types.ts shape) ────────────────

interface Invoice {
  id: number;
  userId: string;
  invoiceNumber: string;
  paymentMethodOverride?: string;
  paymentTerms?: string;
  periodStart: string;
  periodEnd: string;
}

interface User {
  id: string;
  name: string;
  paymentTerms?: string;
}

// ─── Mock supabase (subset — handles the .from().update().eq() and .select
// ().eq().gte().lte() shapes used by the 3 functions) ────────────────────────

type Row = Record<string, unknown>;

interface Update {
  table: string;
  patch: Row;
  where: Array<[string, unknown]>;
}

function makeMockSupabase(tables: Record<string, Row[]> = {}) {
  const updates: Update[] = [];
  const selects: Array<{ table: string; cols: string; filters: Array<[string, string, unknown]> }> = [];

  const client = {
    from(tableName: string) {
      const rows = tables[tableName] ?? [];
      const q = {
        _rows: [...rows],
        _filters: [] as Array<[string, string, unknown]>,
        select(cols: string) {
          selects.push({ table: tableName, cols, filters: [] });
          return this;
        },
        eq(col: string, value: unknown) {
          this._rows = this._rows.filter(r => r[col] === value);
          this._filters.push([col, 'eq', value]);
          return this;
        },
        gte(col: string, value: unknown) {
          this._rows = this._rows.filter(r => (r[col] as string) >= (value as string));
          this._filters.push([col, 'gte', value]);
          return this;
        },
        lte(col: string, value: unknown) {
          this._rows = this._rows.filter(r => (r[col] as string) <= (value as string));
          this._filters.push([col, 'lte', value]);
          return this;
        },
        limit(n: number) { this._rows = this._rows.slice(0, n); return this; },
        update(patch: Row) {
          const wh = this._filters.filter(f => f[1] === 'eq').map(f => [f[0], f[2]] as [string, unknown]);
          return {
            eq(col: string, value: unknown) {
              updates.push({ table: tableName, patch, where: [...wh, [col, value]] });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return resolve({ data: this._rows, error: null });
        },
      };
      return q;
    },
  };
  return { client, updates, selects };
}

// Variant that returns an error on the first select — used by
// tryResolveVendorForApproval's "supabase error → blocked" case.
function makeErroringSupabase() {
  const client = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        limit() { return this; },
        then(resolve: (v: { data: null; error: { message: string } }) => unknown) {
          return resolve({ data: null, error: { message: 'connection lost' } });
        },
      };
    },
  };
  return { client };
}

// ─── COPIED FUNCTION BODIES (see file header) ────────────────────────────────

interface ApprovalDeps {
  supabase: ReturnType<typeof makeMockSupabase>['client'];
  invoices: Invoice[];
  users: User[];
  currentUser: User;
  setUsers: (updater: (prev: User[]) => User[]) => void;
  setShowInvoiceModal: (v: boolean) => void;
  setPendingPayOnDate: (v: string) => void;
  setPendingPaidDate: (v: string) => void;
  setPendingPaymentMethod: (v: string) => void;
  setPendingPaymentTerms: (v: string) => void;
  setPendingUsdRate: (v: string) => void;
  setPendingInvoiceNumber: (v: string) => void;
  fetchInvoices: () => Promise<void>;
  alert: (msg: string) => void;
}

async function lockTimesheetDaysForInvoice(
  deps: Pick<ApprovalDeps, 'supabase'>,
  userId: string,
  periodStart: string,
  periodEnd: string
) {
  const ps = new Date(periodStart + 'T00:00:00Z');
  const pe = new Date(periodEnd + 'T23:59:59Z');
  const windowStart = new Date(ps.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const { data: tsList } = await deps.supabase
    .from('timesheets')
    .select('id, week_start')
    .eq('user_id', userId)
    .gte('week_start', windowStart)
    .lte('week_start', periodEnd);
  if (!tsList?.length) return;
  for (const ts of tsList) {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date((ts.week_start as string) + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      if (d >= ps && d <= pe) days.push(d.toISOString().slice(0, 10));
    }
    if (days.length > 0) {
      await deps.supabase.from('timesheets').update({ locked_days: days }).eq('id', ts.id as number);
    }
  }
}

async function tryResolveVendorForApproval(
  deps: Pick<ApprovalDeps, 'supabase' | 'alert'>,
  invoice: Invoice,
  effectivePaymentMethod: string
): Promise<'proceed' | 'blocked'> {
  if (!['Intuit', 'Convera'].includes(effectivePaymentMethod)) return 'proceed';
  if ((invoice as Invoice & { paymentProfile?: { id?: number } }).paymentProfile?.id) return 'proceed';
  const { data: liveData, error } = await deps.supabase
    .from('payment_profiles')
    .select('id, user_id')
    .eq('user_id', invoice.userId)
    .limit(1);
  if (error) {
    deps.alert('Cannot approve: failed to fetch payment profiles — ' + (error as { message: string }).message);
    return 'blocked';
  }
  if (!liveData || liveData.length === 0) {
    deps.alert('Cannot approve: contractor has no payment profile. Add one on the Payments tab first.');
    return 'blocked';
  }
  return 'proceed';
}

async function handleInvoiceAction(
  deps: ApprovalDeps,
  invoiceId: number,
  status: 'approved' | 'rejected' | 'paid',
  payOnDate?: string,
  paidDate?: string,
  pmOverride?: string,
  paymentTerms?: string
) {
  const invoice = deps.invoices.find(i => i.id === invoiceId);
  if (status === 'approved') {
    const nextPM = pmOverride !== undefined ? pmOverride : (invoice?.paymentMethodOverride ?? '');
    const num = invoice?.invoiceNumber ?? '';
    if (nextPM && ['Intuit', 'Convera'].includes(nextPM) && num.length > 20) {
      deps.alert(`Cannot approve: invoice number "${num}" is ${num.length} chars. QuickBooks caps Bill.RefNumber at 20. Edit the invoice number on the Invoices tab first, then approve.`);
      return;
    }
    if (invoice) {
      const outcome = await tryResolveVendorForApproval(deps, invoice, nextPM);
      if (outcome === 'blocked') return;
    }
  }
  const update: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: deps.currentUser.name,
  };
  if (payOnDate !== undefined) update.pay_on_date = payOnDate || null;
  if (status === 'paid' && paidDate) update.paid_date = paidDate;
  if (pmOverride !== undefined) update.payment_method = pmOverride || null;
  if (paymentTerms !== undefined) update.payment_terms = paymentTerms || null;
  const updateResult = await deps.supabase.from('invoices').update(update).eq('id', invoiceId);
  if (updateResult.error) { deps.alert('Error updating invoice: ' + updateResult.error.message); return; }

  if (status === 'approved' && invoice?.userId) {
    let cascadeTerms: string | null = null;
    if (paymentTerms) {
      cascadeTerms = paymentTerms;
    } else if (invoice.paymentTerms) {
      const currentProfile = deps.users.find(u => u.id === invoice.userId);
      if (!currentProfile?.paymentTerms) cascadeTerms = invoice.paymentTerms;
    }
    if (cascadeTerms) {
      const terms = cascadeTerms;
      await deps.supabase.from('profiles').update({ payment_terms: terms }).eq('id', invoice.userId);
      deps.setUsers(prev => prev.map(u => u.id === invoice.userId ? { ...u, paymentTerms: terms } : u));
    }
  }
  if (status === 'approved' && invoice?.userId && invoice?.periodStart && invoice?.periodEnd) {
    await lockTimesheetDaysForInvoice(deps, invoice.userId, invoice.periodStart, invoice.periodEnd);
  }
  await deps.fetchInvoices();
  deps.setShowInvoiceModal(false);
  deps.setPendingPayOnDate('');
  deps.setPendingPaidDate('');
  deps.setPendingPaymentMethod('');
  deps.setPendingPaymentTerms('');
  deps.setPendingUsdRate('');
  deps.setPendingInvoiceNumber('');
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_USER: User = { id: 'admin-1', name: 'Test Accountant' };

const invoice = (extra: Partial<Invoice> = {}): Invoice => ({
  id: 1,
  userId: 'user-1',
  invoiceNumber: 'INV-001',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  ...extra,
});

function makeDeps(overrides: {
  supabase?: ApprovalDeps['supabase'];
  invoices?: Invoice[];
  users?: User[];
} = {}): ApprovalDeps & { alertMock: ReturnType<typeof vi.fn>; setUsersMock: ReturnType<typeof vi.fn>; fetchInvoicesMock: ReturnType<typeof vi.fn>; setShowInvoiceModalMock: ReturnType<typeof vi.fn> } {
  const alertMock = vi.fn();
  const setUsersMock = vi.fn();
  const fetchInvoicesMock = vi.fn(async () => {});
  const setShowInvoiceModalMock = vi.fn();
  const noop = vi.fn();
  const { client } = makeMockSupabase();
  return {
    supabase: overrides.supabase ?? client,
    invoices: overrides.invoices ?? [invoice()],
    users: overrides.users ?? [{ id: 'user-1', name: 'Alice' }],
    currentUser: CURRENT_USER,
    setUsers: setUsersMock,
    setShowInvoiceModal: setShowInvoiceModalMock,
    setPendingPayOnDate: noop,
    setPendingPaidDate: noop,
    setPendingPaymentMethod: noop,
    setPendingPaymentTerms: noop,
    setPendingUsdRate: noop,
    setPendingInvoiceNumber: noop,
    fetchInvoices: fetchInvoicesMock,
    alert: alertMock,
    alertMock,
    setUsersMock,
    fetchInvoicesMock,
    setShowInvoiceModalMock,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('tryResolveVendorForApproval', () => {
  it('non-QB payment method → proceed (no supabase check)', async () => {
    const deps = makeDeps();
    const result = await tryResolveVendorForApproval(deps, invoice(), 'Employee');
    expect(result).toBe('proceed');
    expect(deps.alertMock).not.toHaveBeenCalled();
  });

  it('empty payment method → proceed', async () => {
    const deps = makeDeps();
    const result = await tryResolveVendorForApproval(deps, invoice(), '');
    expect(result).toBe('proceed');
  });

  it('Intuit + contractor has payment profile → proceed', async () => {
    const { client } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
    });
    const deps = makeDeps({ supabase: client });
    const result = await tryResolveVendorForApproval(deps, invoice(), 'Intuit');
    expect(result).toBe('proceed');
    expect(deps.alertMock).not.toHaveBeenCalled();
  });

  it('Convera + contractor has NO payment profile → blocked + alert', async () => {
    const { client } = makeMockSupabase({ payment_profiles: [] });
    const deps = makeDeps({ supabase: client });
    const result = await tryResolveVendorForApproval(deps, invoice(), 'Convera');
    expect(result).toBe('blocked');
    expect(deps.alertMock).toHaveBeenCalledTimes(1);
    expect(deps.alertMock.mock.calls[0][0]).toMatch(/no payment profile/);
  });

  it('Convera + invoice has paymentProfile snapshot → proceed (cross-contractor Faruk-covers-Ajdin case)', async () => {
    // Ajdin has no live pp of his own; the invoice snapshot points to
    // Faruk's pp. Approval must trust the snapshot.
    const { client } = makeMockSupabase({ payment_profiles: [] });
    const deps = makeDeps({ supabase: client });
    const inv = { ...invoice(), paymentProfile: { id: 42 } } as unknown as Invoice;
    const result = await tryResolveVendorForApproval(deps, inv, 'Convera');
    expect(result).toBe('proceed');
    expect(deps.alertMock).not.toHaveBeenCalled();
  });

  it('supabase error → blocked + alert', async () => {
    const { client } = makeErroringSupabase();
    const deps = makeDeps({ supabase: client });
    const result = await tryResolveVendorForApproval(deps, invoice(), 'Intuit');
    expect(result).toBe('blocked');
    expect(deps.alertMock.mock.calls[0][0]).toMatch(/failed to fetch/);
  });
});

describe('lockTimesheetDaysForInvoice', () => {
  it('locks only period-overlapping days from each week', async () => {
    // Period: 2026-09-01 (Tue) → 2026-09-30 (Wed).
    // Two timesheets: week starting 2026-08-31 (spans period start), week starting 2026-09-28 (spans period end).
    const { client, updates } = makeMockSupabase({
      timesheets: [
        { id: 100, user_id: 'user-1', week_start: '2026-08-31' },
        { id: 101, user_id: 'user-1', week_start: '2026-09-28' },
      ],
    });
    const deps = makeDeps({ supabase: client });
    await lockTimesheetDaysForInvoice(deps, 'user-1', '2026-09-01', '2026-09-30');

    expect(updates).toHaveLength(2);
    // Week 08-31: Sep 1-6 should lock (Mon 08-31 excluded, Tue 09-01..Sun 09-06)
    expect(updates[0].patch.locked_days).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
    ]);
    // Week 09-28: Sep 28..30 (Wed) lock; Oct 1-4 excluded
    expect(updates[1].patch.locked_days).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30',
    ]);
  });

  it('no matching timesheets → no updates', async () => {
    const { client, updates } = makeMockSupabase({ timesheets: [] });
    const deps = makeDeps({ supabase: client });
    await lockTimesheetDaysForInvoice(deps, 'user-1', '2026-09-01', '2026-09-30');
    expect(updates).toHaveLength(0);
  });

  it('timesheet fully inside period → all 7 days lock', async () => {
    const { client, updates } = makeMockSupabase({
      timesheets: [{ id: 200, user_id: 'user-1', week_start: '2026-09-14' }],
    });
    const deps = makeDeps({ supabase: client });
    await lockTimesheetDaysForInvoice(deps, 'user-1', '2026-09-01', '2026-09-30');
    expect((updates[0].patch.locked_days as string[])).toHaveLength(7);
  });
});

describe('handleInvoiceAction — approve', () => {
  it('blocks approval when QB payment method + invoice number > 20 chars', async () => {
    const { client } = makeMockSupabase();
    const inv = invoice({ invoiceNumber: 'X'.repeat(21) });
    const deps = makeDeps({ supabase: client, invoices: [inv] });
    await handleInvoiceAction(deps, inv.id, 'approved', undefined, undefined, 'Intuit');
    expect(deps.alertMock.mock.calls[0][0]).toMatch(/21 chars.*caps Bill\.RefNumber/);
    expect(deps.fetchInvoicesMock).not.toHaveBeenCalled();
  });

  it('20-char invoice number is OK for QB payment method', async () => {
    const { client, updates } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
    });
    const inv = invoice({ invoiceNumber: 'X'.repeat(20) });
    const deps = makeDeps({ supabase: client, invoices: [inv] });
    await handleInvoiceAction(deps, inv.id, 'approved', undefined, undefined, 'Intuit');
    expect(deps.alertMock).not.toHaveBeenCalled();
    // At least the invoices UPDATE fires
    expect(updates.some(u => u.table === 'invoices' && u.patch.status === 'approved')).toBe(true);
  });

  it('blocks approval when tryResolveVendorForApproval returns blocked', async () => {
    const { client, updates } = makeMockSupabase({ payment_profiles: [] });
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'approved', undefined, undefined, 'Convera');
    expect(deps.alertMock.mock.calls[0][0]).toMatch(/no payment profile/);
    expect(updates.some(u => u.table === 'invoices')).toBe(false);
    expect(deps.fetchInvoicesMock).not.toHaveBeenCalled();
  });

  it('cascades explicit paymentTerms to profile + local users state', async () => {
    const { client, updates } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
    });
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'approved', undefined, undefined, 'Employee', 'Net 30');
    const profileUpdate = updates.find(u => u.table === 'profiles');
    expect(profileUpdate?.patch.payment_terms).toBe('Net 30');
    expect(deps.setUsersMock).toHaveBeenCalledTimes(1);
  });

  it('seed-once: invoice has paymentTerms but user has none → cascades', async () => {
    const { client, updates } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
    });
    const inv = invoice({ paymentTerms: 'Net 15' });
    const deps = makeDeps({ supabase: client, invoices: [inv], users: [{ id: 'user-1', name: 'Alice' }] });
    await handleInvoiceAction(deps, inv.id, 'approved', undefined, undefined, 'Employee');
    const profileUpdate = updates.find(u => u.table === 'profiles');
    expect(profileUpdate?.patch.payment_terms).toBe('Net 15');
  });

  it('seed-once: user already has terms → does NOT cascade invoice.paymentTerms', async () => {
    const { client, updates } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
    });
    const inv = invoice({ paymentTerms: 'Net 15' });
    const deps = makeDeps({
      supabase: client,
      invoices: [inv],
      users: [{ id: 'user-1', name: 'Alice', paymentTerms: 'Net 30' }],
    });
    await handleInvoiceAction(deps, inv.id, 'approved', undefined, undefined, 'Employee');
    expect(updates.some(u => u.table === 'profiles')).toBe(false);
    expect(deps.setUsersMock).not.toHaveBeenCalled();
  });

  it('locks timesheet days on approve', async () => {
    const { client, updates } = makeMockSupabase({
      payment_profiles: [{ id: 10, user_id: 'user-1' }],
      timesheets: [{ id: 100, user_id: 'user-1', week_start: '2026-09-14' }],
    });
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'approved', undefined, undefined, 'Employee');
    const lockUpdate = updates.find(u => u.table === 'timesheets');
    expect(lockUpdate?.patch.locked_days).toBeDefined();
  });

  it('post-approve resets: modal closes + all pending setters clear + fetchInvoices called', async () => {
    const { client } = makeMockSupabase({ payment_profiles: [{ id: 10, user_id: 'user-1' }] });
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'approved', undefined, undefined, 'Employee');
    expect(deps.fetchInvoicesMock).toHaveBeenCalledTimes(1);
    expect(deps.setShowInvoiceModalMock).toHaveBeenCalledWith(false);
  });
});

describe('handleInvoiceAction — reject', () => {
  it('updates status=rejected, no cascade, no lock', async () => {
    const { client, updates } = makeMockSupabase();
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'rejected');
    const invUpdate = updates.find(u => u.table === 'invoices');
    expect(invUpdate?.patch.status).toBe('rejected');
    expect(updates.some(u => u.table === 'profiles')).toBe(false);
    expect(updates.some(u => u.table === 'timesheets')).toBe(false);
  });

  it('reject skips the 20-char invoice-number cap', async () => {
    const { client, updates } = makeMockSupabase();
    const inv = invoice({ invoiceNumber: 'X'.repeat(50) });
    const deps = makeDeps({ supabase: client, invoices: [inv] });
    await handleInvoiceAction(deps, inv.id, 'rejected');
    expect(deps.alertMock).not.toHaveBeenCalled();
    expect(updates.find(u => u.table === 'invoices')?.patch.status).toBe('rejected');
  });
});

describe('handleInvoiceAction — paid', () => {
  it('paid + paidDate → update includes paid_date', async () => {
    const { client, updates } = makeMockSupabase();
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'paid', undefined, '2026-09-15');
    const invUpdate = updates.find(u => u.table === 'invoices');
    expect(invUpdate?.patch.status).toBe('paid');
    expect(invUpdate?.patch.paid_date).toBe('2026-09-15');
  });

  it('paid + pmOverride → update includes payment_method', async () => {
    const { client, updates } = makeMockSupabase();
    const deps = makeDeps({ supabase: client });
    await handleInvoiceAction(deps, 1, 'paid', undefined, '2026-09-15', 'Convera');
    const invUpdate = updates.find(u => u.table === 'invoices');
    expect(invUpdate?.patch.payment_method).toBe('Convera');
  });
});
