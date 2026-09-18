# Deprecated: QuickBooks IIF export (Bills + Convera payments)

**Deleted:** 2026-09-18, Slice X7 (Accountant modularization arc).
**Reason:** Fully superseded by the QB Automation Layer (qbXML via Web Connector). IIF was the pre-qbXML manual export path; accountant confirmed the buttons haven't been used in the qbXML era and there is no intent to use them again. Preserved here so we can `cat` the file if the thesis ever un-dies.

**Reachable via:** `git show 596d696:src/TimesheetSystem.tsx` (last commit before deletion). This file mirrors the same source, indexed by symbol.

**Restore recipe:** re-add the state hook, the three builders, `bulkMarkPaymentExportStatus`, the "Generate IIF" QbExport modal footer button, the "Export Payments IIF" Payments-tab button, and the full Payment IIF preview modal. Types (`PaymentIifRow` / `PaymentIifGroup` / `PaymentIifPreview`) live inline — they were never in `src/types.ts`. `resolveLivePaymentProfile` is still imported for QbExport (do not re-import).

---

## Deleted state hook

`src/TimesheetSystem.tsx:607` (pre-deletion line)

```ts
// QB Payment IIF preview modal state
const [paymentIifPreview, setPaymentIifPreview] = useState<PaymentIifPreview | null>(null);
```

---

## Deleted pre-role helpers

### `bulkMarkInvoiceExportStatus` (`src/TimesheetSystem.tsx:3263–3272`)

Dead once the Generate IIF button is removed (its only caller). `saveInvoiceExportStatus` (single-invoice variant used by QbExport modal's Unskip / Confirm / Skip buttons) is **retained**.

```ts
// Bulk-mark a set of invoices to a given export status (used by Generate IIF).
const bulkMarkInvoiceExportStatus = async (invoiceIds: number[], next: Invoice['qbExportStatus']) => {
  if (invoiceIds.length === 0) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('invoices').update({ qb_export_status: next, qb_export_status_at: nowIso }).in('id', invoiceIds);
  if (error) { alert('Error updating export statuses: ' + error.message); return; }
  const idSet = new Set(invoiceIds);
  setInvoices(prev => prev.map(i => idSet.has(i.id) ? { ...i, qbExportStatus: next, qbExportStatusAt: nowIso } : i));
  setQbExportSnapshot(prev => prev.map(i => idSet.has(i.id) ? { ...i, qbExportStatus: next, qbExportStatusAt: nowIso } : i));
};
```

### `buildIifContent` (`src/TimesheetSystem.tsx:3274–3362`)

Bills IIF for QB Desktop. Groups by (qb_vendor_name, period_end month) so umbrella vendors (Teal, Cloudygon, etc.) get one bill with multiple SPL lines.

```ts
// Build tab-separated QB Desktop IIF content from selected invoices.
// Groups by (qb_vendor_name, period_end month) so multi-contractor umbrella
// vendors (Teal, Cloudygon, etc.) get one bill with multiple SPL lines.
const buildIifContent = (invoicesToExport: Invoice[]): string => {
  const AP_ACCOUNT      = 'Accounts Payable';
  const EXPENSE_ACCOUNT = 'Project Related Costs:Personnel Expenses:Consulting:Vendor Consultants';
  const termsToDays: Record<string, number> = { NET15: 15, NET30: 30, NET45: 45, NET60: 60 };
  const findLivePp = (inv: Invoice) => resolveLivePaymentProfile(inv, paymentProfiles);
  const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate = (yyyyMmDd: string) => {
    const [y, m, d] = yyyyMmDd.split('-');
    return `${m}/${d}/${y}`;
  };
  const lastDayOfMonth = (yyyyMm: string) => {
    const [y, m] = yyyyMm.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  };
  const addDays = (yyyyMmDd: string, days: number) => {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  };

  // Group by (qb_vendor_name, period_end month)
  type GroupKey = string;
  const groups = new Map<GroupKey, { vendor: string; monthKey: string; invoices: Invoice[] }>();
  for (const inv of invoicesToExport) {
    const pp = findLivePp(inv);
    const vendor = pp?.qbVendorName || null;
    if (!vendor) continue; // safety — should not happen if UI gates properly
    const monthKey = (inv.periodEnd || inv.periodStart || '').slice(0, 7);
    if (!monthKey) continue;
    const key = `${vendor}::${monthKey}`;
    if (!groups.has(key)) groups.set(key, { vendor, monthKey, invoices: [] });
    groups.get(key)!.invoices.push(inv);
  }

  // Header
  const header = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tDUEDATE',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tQNTY\tPRICE',
    '!ENDTRNS',
  ].join('\n');

  let trnsId = 1;
  let splId = 1;
  const blocks: string[] = [];
  for (const g of groups.values()) {
    const billDate = fmtDate(lastDayOfMonth(g.monthKey));
    const groupTotal = g.invoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
    // Use the longest payment terms among grouped invoices as due date basis
    const maxTermsDays = g.invoices.reduce((mx, i) => Math.max(mx, termsToDays[i.paymentTerms || 'NET30'] || 30), 0) || 30;
    const dueDate = fmtDate(addDays(lastDayOfMonth(g.monthKey), maxTermsDays));
    const monthLabel = monthsFull[Number(g.monthKey.split('-')[1]) - 1] + ' ' + g.monthKey.split('-')[0];
    const monthShort = monthsShort[Number(g.monthKey.split('-')[1]) - 1] + ' ' + g.monthKey.split('-')[0];
    // TRNS memo: aggregate if combined bill
    const trnsMemo = g.invoices.length === 1
      ? `${monthLabel} — ${g.invoices[0].totalHours ?? 0}h @ $${g.invoices[0].rate ?? 0} — ${g.invoices[0].userName}`
      : `${monthLabel} — ${g.invoices.length} contractors — ${g.invoices.reduce((s, i) => s + Number(i.totalHours || 0), 0)}h total`;
    // TRNS DOCNUM: single invoice → its number; multi → shared group tag
    const docNum = g.invoices.length === 1 ? g.invoices[0].invoiceNumber : `MULTI-${g.monthKey}`;

    const trns = [
      'TRNS', trnsId, 'BILL', billDate, AP_ACCOUNT, g.vendor,
      (-groupTotal).toFixed(2), docNum, trnsMemo, 'N', 'Y', dueDate,
    ].join('\t');
    blocks.push(trns);
    trnsId++;

    for (const inv of g.invoices) {
      const hours = Number(inv.totalHours || 0);
      const rate  = Number(inv.rate || 0);
      const amt   = Number(inv.totalAmount || 0);
      const memo  = `${monthShort} — ${hours}h @ $${rate} — ${inv.userName} — INV ${inv.invoiceNumber}`;
      const spl = [
        'SPL', splId, 'BILL', billDate, EXPENSE_ACCOUNT, '',
        amt.toFixed(2), inv.invoiceNumber, memo, 'N', hours.toFixed(2), rate.toFixed(2),
      ].join('\t');
      blocks.push(spl);
      splId++;
    }
    blocks.push('ENDTRNS');
  }

  return header + '\n' + blocks.join('\n') + '\n';
};
```

### Convera Payment IIF types + `buildPaymentIifPreview` (`src/TimesheetSystem.tsx:3364–3462`)

Groups a batch's Convera transactions by confirmation_number (one wire = one bank debit). For each group: one CHECK from Key Point Checking (splits to Western Union Holding + Bank Service Charges) + one BILLPMT per matched invoice from Western Union Holding.

```ts
// ─── QB Payment IIF export ──────────────────────────────────────────────────
// Groups a batch's Convera transactions by confirmation_number (one wire = one
// bank debit). For each group: one CHECK from Key Point Checking (splits to
// Western Union Holding + Bank Service Charges) + one BILLPMT per matched
// invoice from Western Union Holding. See project_convera_payment_iif memory.
type PaymentIifRow = {
  txn: ConveraTransaction;
  invoice: Invoice | null;
  vendorName: string | null;
  excludeReason: string | null;  // null = includable
};
type PaymentIifGroup = {
  confirmationNumber: string;
  dateOfOrder: string;
  rows: PaymentIifRow[];         // includable only
  subtotalSum: number;
  feeSum: number;
  grandTotalSum: number;
};
type PaymentIifPreview = {
  batch: ImportBatch;
  groups: PaymentIifGroup[];
  excluded: PaymentIifRow[];     // rows with excludeReason set
  totalSubtotal: number;
  totalFee: number;
  totalGrand: number;
  includableTxnIds: number[];    // for bulk-mark on download
};

const buildPaymentIifPreview = (batchId: number): PaymentIifPreview | null => {
  const batch = importBatches.find(b => b.id === batchId);
  if (!batch) return null;
  const batchRows = converaTransactions.filter(t =>
    t.importBatchId === batchId && !t.matcherIgnore
  );

  // Classify every row: includable or excluded (with reason)
  const classified: PaymentIifRow[] = batchRows.map(txn => {
    const invId = txn.matchedInvoiceId;
    const inv = invId ? invoices.find(i => i.id === invId) ?? null : null;
    let vendor: string | null = null;
    if (inv) {
      const pp = inv.paymentProfile?.id
        ? paymentProfiles.find(p => p.id === inv.paymentProfile!.id) ?? null
        : (paymentProfiles.find(p => p.userId === inv.userId && p.isDefault) ?? null);
      vendor = pp?.qbVendorName || null;
    }
    let reason: string | null = null;
    if (txn.matchState !== 'matched' || !invId || !inv) reason = 'Not matched to an invoice';
    else if (!vendor) reason = 'Missing qb_vendor_name on payment profile';
    else if (!inv.invoiceNumber) reason = 'Missing invoice number';
    else if (inv.qbExportStatus === 'not_exported') reason = 'BILL not yet exported to QB';
    else if (inv.qbExportStatus === 'skipped') reason = 'BILL was skipped in QB export';
    else if (txn.qbBillpmtTxnId) reason = 'Payment already recorded via Web Connector';
    else if (txn.qbPaymentExportStatus === 'exported' || txn.qbPaymentExportStatus === 'confirmed') reason = 'Payment already exported';
    return { txn, invoice: inv, vendorName: vendor, excludeReason: reason };
  });

  const includable = classified.filter(r => !r.excludeReason);
  const excluded   = classified.filter(r =>  r.excludeReason);

  // Group includable by confirmation_number
  const groupMap = new Map<string, PaymentIifGroup>();
  for (const r of includable) {
    const key = r.txn.confirmationNumber;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        confirmationNumber: key,
        dateOfOrder: r.txn.dateOfOrder,
        rows: [],
        subtotalSum: 0,
        feeSum: 0,
        grandTotalSum: 0,
      });
    }
    const g = groupMap.get(key)!;
    g.rows.push(r);
    g.subtotalSum   += Number(r.txn.subtotal ?? 0);
    g.feeSum        += Number(r.txn.serviceCharges ?? 0);
    g.grandTotalSum += Number(r.txn.grandTotal ?? 0);
    // Use earliest date in the group as the wire date
    if (r.txn.dateOfOrder < g.dateOfOrder) g.dateOfOrder = r.txn.dateOfOrder;
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.dateOfOrder.localeCompare(b.dateOfOrder));

  const totalSubtotal = groups.reduce((s, g) => s + g.subtotalSum, 0);
  const totalFee      = groups.reduce((s, g) => s + g.feeSum, 0);
  const totalGrand    = groups.reduce((s, g) => s + g.grandTotalSum, 0);

  return {
    batch,
    groups,
    excluded,
    totalSubtotal,
    totalFee,
    totalGrand,
    includableTxnIds: includable.map(r => r.txn.id),
  };
};
```

### `buildPaymentIifContent` (`src/TimesheetSystem.tsx:3464–3550`)

Emits the actual IIF text for the preview. Key Point Checking → Western Union Holding + Bank Service Charges (SPLs). Per matched invoice: WU Holding → A/P (CHECK-to-AP produces a vendor credit QBO auto-applies; QBO does not accept BILLPMT via IIF).

```ts
const buildPaymentIifContent = (preview: PaymentIifPreview): string => {
  const KEY_POINT       = 'BANK/CASH:8220 - Key Point Checking';
  const WU_HOLDING      = 'BANK/CASH:Western Union Holding';
  const BANK_CHARGES    = 'Bank Charges:Bank Service Charges';
  const AP_ACCOUNT      = 'Accounts Payable';
  const CONVERA_PAYEE   = 'Convera';

  const fmtDate = (yyyyMmDd: string) => {
    const [y, m, d] = yyyyMmDd.split('-');
    return `${m}/${d}/${y}`;
  };

  const header = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR',
    '!ENDTRNS',
  ].join('\n');

  let trnsId = 1;
  let splId  = 1;
  const blocks: string[] = [];

  for (const g of preview.groups) {
    const wireDate = fmtDate(g.dateOfOrder);
    const memoTop  = `Convera wire ${g.confirmationNumber} — ${g.rows.length} bill${g.rows.length === 1 ? '' : 's'}`;

    // Block 1: CHECK from Key Point Checking
    blocks.push([
      'TRNS', trnsId, 'CHECK', wireDate, KEY_POINT, CONVERA_PAYEE,
      (-g.grandTotalSum).toFixed(2), g.confirmationNumber, memoTop, 'N',
    ].join('\t'));
    trnsId++;

    // SPL 1: Wire principal → Western Union Holding
    blocks.push([
      'SPL', splId, 'CHECK', wireDate, WU_HOLDING, '',
      g.subtotalSum.toFixed(2), '', 'Wire principal to Western Union Holding', 'N',
    ].join('\t'));
    splId++;

    // SPL 2: Fees → Bank Service Charges (only if > 0)
    if (g.feeSum > 0) {
      const distinctFees = new Set(g.rows.map(r => Number(r.txn.serviceCharges ?? 0)));
      const feeMemo = distinctFees.size === 1
        ? `Convera fees (${g.rows.length} × $${[...distinctFees][0].toFixed(2)})`
        : `Convera fees for ${g.rows.length} wires (mixed rates)`;
      blocks.push([
        'SPL', splId, 'CHECK', wireDate, BANK_CHARGES, '',
        g.feeSum.toFixed(2), '', feeMemo, 'N',
      ].join('\t'));
      splId++;
    }
    blocks.push('ENDTRNS');

    // Blocks 2..N+1: one CHECK per matched invoice, FROM Western Union Holding
    // to Accounts Payable. QB Online does not accept BILLPMT via IIF; CHECK-to-AP
    // with vendor NAME + bill DOCNUM produces a vendor credit QBO auto-applies to
    // the outstanding BILL (or accountant applies via Bill screen with one click).
    for (const r of g.rows) {
      const inv = r.invoice!;
      const vendor = r.vendorName!;
      const sub = Number(r.txn.subtotal ?? 0);
      const memo = `Applied to INV ${inv.invoiceNumber} — ${inv.userName} — wire ${g.confirmationNumber}`;

      // DOCNUM = wire confirmation (always ≤11 chars). QB rejects DOCNUM > 11
      // on IIF import; invoice numbers often exceed that. Full invoice number
      // stays in the memo so accountant can identify the target bill in "Set
      // Credits". Wire is not the join key anyway — CHECK-to-AP lands as a
      // vendor credit that accountant applies manually (QBO restriction).
      blocks.push([
        'TRNS', trnsId, 'CHECK', wireDate, WU_HOLDING, vendor,
        (-sub).toFixed(2), g.confirmationNumber, memo, 'N',
      ].join('\t'));
      trnsId++;

      blocks.push([
        'SPL', splId, 'CHECK', wireDate, AP_ACCOUNT, vendor,
        sub.toFixed(2), g.confirmationNumber, memo, 'N',
      ].join('\t'));
      splId++;

      blocks.push('ENDTRNS');
    }
  }

  return header + '\n' + blocks.join('\n') + '\n';
};
```

### `bulkMarkPaymentExportStatus` (`src/TimesheetSystem.tsx:3552–3567`)

Only called from the Payment IIF preview modal's Download button (line 9943). Dead once that modal is removed.

```ts
const bulkMarkPaymentExportStatus = async (
  txnIds: number[],
  next: ConveraTransaction['qbPaymentExportStatus'],
) => {
  if (txnIds.length === 0) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('convera_transactions')
    .update({ qb_payment_export_status: next, qb_payment_export_status_at: nowIso })
    .in('id', txnIds);
  if (error) { alert('Error updating payment export status: ' + error.message); return; }
  const idSet = new Set(txnIds);
  setConveraTransactions(prev => prev.map(t => idSet.has(t.id)
    ? { ...t, qbPaymentExportStatus: next, qbPaymentExportStatusAt: nowIso }
    : t));
};
```

Note: `qb_payment_export_status` / `qb_payment_export_status_at` DB columns and their JSONB load into `qbPaymentExportStatus` / `qbPaymentExportStatusAt` (TS.tsx:1715–1716) are retained. They are read-only after this deletion — benign dead load.

---

## Deleted UI

### "Export Payments IIF" button (Payments tab; `src/TimesheetSystem.tsx:6889–6897`)

```tsx
<button
  onClick={() => {
    const preview = buildPaymentIifPreview(b.id);
    if (!preview) { alert('Could not load batch data'); return; }
    setPaymentIifPreview(preview);
  }}
  className="px-3 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 font-medium border border-emerald-200"
  title="Preview and download the QuickBooks payment IIF for this batch"
>Export Payments IIF</button>
```

### "Generate IIF" button (QbExport modal footer; `src/TimesheetSystem.tsx:9772–9802`)

QbExport modal itself is **retained** — its category-card inspector for invoice status (`ready` / `no_vendor` / `already_sent` / `skipped` / `confirmed`) is still useful independent of IIF, and `saveInvoiceExportStatus` (Unskip/Confirm/Skip) still runs from inside the modal. Only the "Generate IIF" footer button is removed.

```tsx
<button
  disabled={qbExportSelectedIds.size === 0}
  onClick={async () => {
    const invoicesToExport = rows.filter(r => qbExportSelectedIds.has(r.inv.id)).map(r => r.inv);
    // Guard: refuse to generate if any selected row lacks a QB vendor mapping
    const unmapped = rows.filter(r => qbExportSelectedIds.has(r.inv.id) && !r.vendorName);
    if (unmapped.length > 0) {
      alert(`Cannot generate: ${unmapped.length} selected invoice(s) have no QB vendor mapping. Uncheck them or map their vendors first.`);
      return;
    }
    // Build content + trigger download
    const iif = buildIifContent(invoicesToExport);
    // Filename: single-month vs cross-month
    const monthKeys = Array.from(new Set(invoicesToExport.map(i => (i.periodEnd || i.periodStart || '').slice(0, 7)).filter(Boolean)));
    const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const filename = monthKeys.length === 1
      ? `Synergie_QB_Bills_${monthsFull[Number(monthKeys[0].split('-')[1]) - 1]}_${monthKeys[0].split('-')[0]}.iif`
      : `Synergie_QB_Bills_${new Date().toISOString().slice(0,10)}.iif`;
    const blob = new Blob([iif], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // Mark all selected as exported (approved re-generate: resets confirmed→exported too)
    await bulkMarkInvoiceExportStatus(invoicesToExport.map(i => i.id), 'exported');
  }}
  className={'px-4 py-2 text-white rounded-lg text-sm ' + (qbExportSelectedIds.size === 0 ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700')}
>
  Generate IIF ({qbExportSelectedIds.size})
</button>
```

Also removed: stale hint text one row above the footer (`src/TimesheetSystem.tsx:9675`) — `<div className="ml-auto text-xs text-gray-400 self-center italic">Chunk 2a preview — Generate IIF not wired yet</div>` (Chunk 2a era artefact — always inaccurate after Generate IIF wired up, now irrelevant).

### Payment IIF Preview + Download modal (`src/TimesheetSystem.tsx:9808–9954`)

```tsx
{/* QB Payment IIF Preview + Download Modal */}
{paymentIifPreview && (() => {
  const p = paymentIifPreview;
  const fmt$ = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const canDownload = p.groups.length > 0;
  const excludedByReason = p.excluded.reduce<Record<string, PaymentIifRow[]>>((acc, r) => {
    const k = r.excludeReason || 'Unknown';
    (acc[k] ??= []).push(r);
    return acc;
  }, {});
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">QB Payment IIF Export</h2>
              <p className="text-sm text-gray-500 mt-1">
                Batch #{p.batch.id} · {p.batch.sourceFilename || p.batch.source}
              </p>
            </div>
            <button onClick={() => setPaymentIifPreview(null)} className="text-gray-400 hover:text-gray-600">
              <span className="text-2xl leading-none">×</span>
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Wires</div>
              <div className="text-2xl font-bold text-emerald-900">{p.groups.length}</div>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-indigo-700 font-semibold">Bills paid</div>
              <div className="text-2xl font-bold text-indigo-900">{p.includableTxnIds.length}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-700 font-semibold">Principal + Fees</div>
              <div className="text-lg font-bold text-slate-900">${fmt$(p.totalSubtotal)} + ${fmt$(p.totalFee)}</div>
            </div>
            <div className="bg-slate-900 text-white rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">Bank debit total</div>
              <div className="text-2xl font-bold">${fmt$(p.totalGrand)}</div>
            </div>
          </div>

          {/* Wire groups */}
          {p.groups.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-4 text-sm text-amber-900">
              No exportable payments in this batch. See exclusions below.
            </div>
          ) : (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Wire groups (one CHECK per group)</h3>
              <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
                <span className="font-semibold">Ref No. in QB</span> = wire confirmation (e.g. <span className="font-mono">OTR6607568</span>) for every credit. Full invoice number is in the memo so you can identify the target bill when clicking Set Credits.
              </div>
              <div className="space-y-3">
                {p.groups.map(g => (
                  <div key={g.confirmationNumber} className="border border-gray-200 rounded">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-mono font-semibold text-emerald-700">{g.confirmationNumber}</span>
                        <span className="text-gray-500 ml-2">· {g.dateOfOrder}</span>
                        <span className="text-gray-500 ml-2">· {g.rows.length} bill{g.rows.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="text-sm font-semibold text-gray-900">
                        ${fmt$(g.subtotalSum)} + ${fmt$(g.feeSum)} = <span className="text-emerald-700">${fmt$(g.grandTotalSum)}</span>
                      </div>
                    </div>
                    <div className="p-2 text-xs">
                      {g.rows.map(r => (
                        <div key={r.txn.id} className="flex justify-between py-0.5 border-b border-gray-100 last:border-b-0">
                          <div>
                            <span className="text-gray-600">{r.invoice?.userName}</span>
                            <span className="text-gray-400 mx-2">·</span>
                            <span className="font-mono text-gray-700">{r.vendorName}</span>
                            <span className="text-gray-400 mx-2">·</span>
                            <span className="text-gray-500">INV {r.invoice?.invoiceNumber}</span>
                          </div>
                          <div className="text-gray-900 font-medium">${fmt$(Number(r.txn.subtotal ?? 0))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exclusions */}
          {p.excluded.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Excluded ({p.excluded.length})</h3>
              {Object.entries(excludedByReason).map(([reason, rows]) => (
                <div key={reason} className="mb-2 border border-amber-200 rounded overflow-hidden">
                  <div className="bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
                    {reason} — {rows.length}
                  </div>
                  <div className="p-2 text-xs bg-white">
                    {rows.map(r => (
                      <div key={r.txn.id} className="text-gray-600 py-0.5">
                        <span className="font-mono text-gray-500">{r.txn.confirmationNumber}</span>
                        <span className="mx-2">·</span>
                        <span>{r.txn.beneficiaryName}</span>
                        <span className="mx-2">·</span>
                        <span>${fmt$(Number(r.txn.grandTotal ?? 0))}</span>
                        {r.txn.ref1 && <><span className="mx-2">·</span><span className="text-gray-500">{r.txn.ref1}</span></>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
            <button
              onClick={() => setPaymentIifPreview(null)}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >Cancel</button>
            <button
              onClick={async () => {
                const iif = buildPaymentIifContent(p);
                const dateSlug = p.groups[0]?.dateOfOrder.replace(/-/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
                const filename = `Synergie_QB_Payments_Batch${p.batch.id}_${dateSlug}.iif`;
                const blob = new Blob([iif], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                await bulkMarkPaymentExportStatus(p.includableTxnIds, 'exported');
                setPaymentIifPreview(null);
              }}
              disabled={!canDownload}
              className={`px-4 py-2 text-sm rounded font-medium ${canDownload ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >Download IIF ({p.groups.length} wire{p.groups.length === 1 ? '' : 's'})</button>
          </div>
        </div>
      </div>
    </div>
  );
})()}
```
