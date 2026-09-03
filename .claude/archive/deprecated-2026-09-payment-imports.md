# Deprecated 2026-09-03: QuickBooks Export + Intuit Emails payment-import tabs

Archived for reference. All source deleted from `src/TimesheetSystem.tsx` in the
same commit as this doc. Recover via `git show <hash>^:src/TimesheetSystem.tsx`
or by copying the extracts below.

**Why deleted:** three tabs in the "Import Payments" modal (QuickBooks Export,
Intuit Emails, Intuit XLSX) all *looked* like ways to import Intuit payments but
did fundamentally different things:

- **QuickBooks Export** (this tab) + **Intuit Emails** (this tab) = read what QB
  or Intuit **already recorded**, flip our invoices to `paid`, done. No
  `qb_ingest_events` shadow-write, no QB push.
- **Intuit XLSX** = forward-flow: read what Intuit paid, seed `qb_ingest_events`,
  and push into QB via QB Automation Layer. Only path that reaches QB.

On 2026-09-03, Dan uploaded a QB Transaction Detail export via QuickBooks Export
thinking it was the Intuit XLSX flow. Invoices flipped (correct for that tab)
but nothing appeared on QB Automation (also correct — that tab doesn't seed).
Both legacy paths belonged to the pre-QB-Automation-Layer world. Deprecated.

See project memory `project_payment_import_relocation.md` for the full
architectural rationale and the "import ≠ paid under QB Automation" rule that
replaces the legacy flow.

---

## Deleted state (was in `TimesheetSystem` component body)

```ts
const [qbFile, setQbFile] = useState<File | null>(null);
const [intuitText, setIntuitText] = useState('');
const [converaRows, setConveraRows] = useState<ConveraPaymentRow[]>([]);
const [converaApplying, setConveraApplying] = useState(false);
const [converaPaidDate, setConveraPaidDate] = useState('');
```

`converaTab` was narrowed from `'quickbooks' | 'intuit' | 'intuitXlsx' | 'beneficiaries'`
to `'intuitXlsx' | 'beneficiaries'`.

---

## Deleted function: `parseQbXlsx`

Parsed a QuickBooks Transaction Detail by Account XLSX export. Took the
Business-Checking split (which carried the invoice memo), matched by invoice
ref / name+amount, populated `converaRows` for the shared review-and-apply flow.

```ts
const parseQbXlsx = async () => {
  if (!qbFile) return;
  setConveraError('');
  setConveraRows([]);
  try {
    const buffer = await qbFile.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    // Find header row: look for a row containing "Date" and "Name"
    let headerIdx = -1;
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i] as string[];
      if (r.some(c => String(c).trim() === 'Date') && r.some(c => String(c).trim() === 'Name')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) { setConveraError('Could not find header row. Expected columns: Date, Name, Memo/Description, Split, Amount.'); return; }

    const headers = (rawRows[headerIdx] as string[]).map(h => String(h).trim().toLowerCase());
    const col = (name: string) => headers.indexOf(name);
    const iDate = col('date'), iName = col('name'), iMemo = col('memo/description'), iSplit = col('split'), iAmt = col('amount');

    if ([iDate, iName, iAmt].some(i => i < 0)) { setConveraError('Missing required columns: Date, Name, Amount.'); return; }

    // Extract payments: take "Business Checking" split rows (have invoice memo + positive amount = the offset entry)
    // OR take "Contractor Payment" rows (negative amount = the actual outgoing payment)
    // We use Business Checking rows because they carry the Inv# memo.
    const payments: ConveraPaymentRow[] = [];
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const r = rawRows[i] as (string | number)[];
      const split  = iSplit >= 0 ? String(r[iSplit]).trim() : '';
      const amt    = parseFloat(String(r[iAmt]));
      if (isNaN(amt) || amt <= 0) continue; // skip negatives, totals, empty rows
      if (split !== 'Business Checking') continue; // only take the memo-bearing row

      const dateRaw = String(r[iDate]).trim();
      const name    = String(r[iName]).trim();
      const memo    = iMemo >= 0 ? String(r[iMemo]).trim() : '';

      // Parse date MM/DD/YYYY → YYYY-MM-DD
      const dm = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const paidDate = dm ? `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}` : '';

      // Extract invoice ref from memo ("Inv# XXX" or "Invoice# XXX")
      const invMatch = memo.match(/Inv#?\s*([A-Za-z0-9][\w\-\/\.]+)/i);
      const invoiceRef = invMatch?.[1]?.trim() ?? '';

      const m = matchPaymentToInvoice(invoiceRef, name, amt, paidDate || undefined);

      payments.push({
        source: 'quickbooks',
        itemNumber: '',
        beneficiary: name,
        amount: amt,
        currency: 'USD',
        invoiceRef,
        suggestedDate: paidDate,
        matchedInvoice: m?.invoice ?? null,
        matchLevel: m?.level,
        selected: !!m && m.invoice.status !== 'paid',
      });
    }

    if (!payments.length) { setConveraError('No outgoing payments found. Make sure this is a QuickBooks Transaction Detail export with a "Split" column.'); return; }

    setConveraRows(payments);
    // Pre-fill paid date from most common date in the export
    const dates = payments.map(p => p.suggestedDate).filter(Boolean);
    const dateFreq = dates.reduce<Record<string, number>>((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
    const mostCommon = Object.entries(dateFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    if (!converaPaidDate && mostCommon) setConveraPaidDate(mostCommon);
  } catch (e: unknown) {
    setConveraError(e instanceof Error ? e.message : 'Failed to parse file');
  }
};
```

`matchPaymentToInvoice` is retained — it's still used by the live Convera
reconciliation path.

---

## Deleted function: `parseIntuitEmails`

Parsed pasted QuickBooks/Intuit payment-confirmation email text. Regex-matched
"payment of $X to COMPANY has been scheduled…paid on Month Nth". Populated
`converaRows` for the shared review-and-apply flow.

```ts
const parseIntuitEmails = () => {
  if (!intuitText.trim()) return;
  setConveraError('');
  // Each email: "payment of $X.XX to COMPANY has been scheduled. ...paid on Month Nth"
  const pattern = /payment\s+of\s+\$([\d,]+\.?\d*)\s+to\s+(.+?)\s+has\s+been\s+scheduled[\s\S]*?paid\s+on\s+(\w+\s+\d+(?:st|nd|rd|th)?)/gi;
  const matches = [...intuitText.matchAll(pattern)];
  if (!matches.length) {
    setConveraError('No payment entries found. Make sure the pasted text includes "payment of $X.XX to COMPANY has been scheduled".');
    return;
  }
  const rows: ConveraPaymentRow[] = matches.map(m => {
    const amount    = parseFloat(m[1].replace(/,/g, ''));
    const beneficiary = m[2].trim();
    const dateStr   = m[3].trim();
    const suggestedDate = parseIntuitDateStr(dateStr);

    // Match by: (normalised company name ≈ userName or paymentProfile.companyName) AND amount
    const normBenef = normaliseCompany(beneficiary);
    const match = invoices.find(inv => {
      const invComp = normaliseCompany(inv.paymentProfile?.companyName || inv.userName);
      const nameOk = invComp.includes(normBenef) || normBenef.includes(invComp);
      const amtOk  = Math.abs(inv.totalAmount - amount) < 0.02;
      return nameOk && amtOk && inv.status !== 'paid';
    }) ?? null;

    return {
      source: 'intuit' as const,
      itemNumber: '',
      beneficiary,
      amount,
      currency: 'USD',
      invoiceRef: '',
      suggestedDate,
      matchedInvoice: match,
      matchLevel: match ? 4 : undefined,
      selected: !!match,
    };
  });
  setConveraRows(rows);
  // Pre-populate paid date from first entry if all same
  const dates = [...new Set(rows.map(r => r.suggestedDate).filter(Boolean))];
  if (dates.length === 1 && !converaPaidDate) setConveraPaidDate(dates[0]);
};
```

---

## Deleted function: `applyConveraPayments`

Note: name was legacy — it applied both QuickBooks Export and Intuit Emails
review rows, not just Convera. The Convera pipeline had migrated to its own
Payments-tab matcher long before this deletion.

```ts
const applyConveraPayments = async () => {
  const selected = converaRows.filter(r => r.selected && (r.matchedInvoices?.length || r.matchedInvoice));
  if (!selected.length) return;
  if (!converaPaidDate) { alert('Please enter the payment date.'); return; }
  setConveraApplying(true);
  let ok = 0, failed = 0;
  for (const row of selected) {
    const invoicesToMark = row.matchedInvoices ?? (row.matchedInvoice ? [row.matchedInvoice] : []);
    const paidDate = converaPaidDate || row.suggestedDate;
    for (const inv of invoicesToMark) {
      const { error } = await supabase.from('invoices').update({
        status: 'paid',
        paid_date: paidDate,
        reviewed_at: new Date().toISOString(),
        reviewed_by: currentUser!.name,
      }).eq('id', inv.id);
      if (error) failed++; else ok++;
    }
  }
  await fetchInvoices();
  setConveraApplying(false);
  if (failed) {
    alert(`${ok} invoices marked paid, ${failed} failed.`);
  } else {
    alert(`${ok} invoice${ok !== 1 ? 's' : ''} marked as paid on ${converaPaidDate}.`);
    setShowConveraModal(false);
    setConveraRows([]);
    setIntuitText('');
    setConveraError('');
  }
};
```

---

## Deleted JSX — modal tab bar

```tsx
{/* Source tabs */}
{converaRows.length === 0 && (
  <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-5 w-fit">
    <button onClick={() => { setConveraTab('quickbooks'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'quickbooks' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>QuickBooks Export</button>
    <button onClick={() => { setConveraTab('intuit'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'intuit' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Intuit Emails</button>
    <button onClick={() => { setConveraTab('intuitXlsx'); setConveraError(''); setIntuitXlsxResult(null); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'intuitXlsx' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Intuit XLSX</button>
    <button onClick={() => { setConveraTab('beneficiaries'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'beneficiaries' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Convera Beneficiaries</button>
  </div>
)}
```

---

## Deleted JSX — QuickBooks Export tab

```tsx
{/* Step 1: QuickBooks XLSX export */}
{converaRows.length === 0 && converaTab === 'quickbooks' && (
  <div>
    <p className="text-sm text-gray-600 mb-1">Upload the QuickBooks <strong>Transaction Detail by Account</strong> export (.xlsx). Payments are matched by invoice number from the Memo field, falling back to company name + amount.</p>
    <p className="text-xs text-gray-400 mb-4">In QuickBooks: Reports → Transaction Detail by Account → export to Excel</p>
    <div className="border-2 border-dashed border-indigo-300 rounded-lg p-6 text-center mb-4">
      {qbFile ? (
        <div className="flex items-center justify-center gap-2 text-indigo-700">
          <FileText className="w-5 h-5" />
          <span className="text-sm font-medium">{qbFile.name}</span>
          <button onClick={() => setQbFile(null)} className="text-gray-400 hover:text-red-500 ml-1"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <label className="cursor-pointer">
          <UploadCloud className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">Click to select .xlsx file</p>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setQbFile(e.target.files?.[0] ?? null)} />
        </label>
      )}
    </div>
    {converaError && <p className="text-red-600 text-sm mb-3">{converaError}</p>}
    <div className="flex justify-end">
      <button onClick={parseQbXlsx} disabled={!qbFile} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
        <FileText className="w-4 h-4" /> Parse Export
      </button>
    </div>
  </div>
)}
```

---

## Deleted JSX — Intuit Emails tab

```tsx
{/* Step 1B: Intuit email paste */}
{converaRows.length === 0 && converaTab === 'intuit' && (
  <div>
    <p className="text-sm text-gray-600 mb-1">Paste one or more QuickBooks payment confirmation emails below. Payments are matched by company name and amount.</p>
    <p className="text-xs text-gray-400 mb-3">Each email must include: <em>"payment of $X to COMPANY has been scheduled…paid on Month Nth"</em></p>
    <textarea
      value={intuitText}
      onChange={e => setIntuitText(e.target.value)}
      rows={10}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 font-mono resize-y"
      placeholder="Paste QuickBooks payment emails here…"
    />
    {converaError && <p className="text-red-600 text-sm mt-2 mb-1">{converaError}</p>}
    <div className="flex justify-end mt-3">
      <button onClick={parseIntuitEmails} disabled={!intuitText.trim()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
        <FileText className="w-4 h-4" /> Parse Emails
      </button>
    </div>
  </div>
)}
```

---

## Deleted JSX — Step 2 shared review-and-apply block

Was rendered when `converaRows.length > 0` — the review table and "Mark N as
Paid" apply button shared between the QuickBooks Export and Intuit Emails flows.
See git for the full ~100-line block; key structural pieces retained here for
context.

```tsx
{converaRows.length > 0 && (() => {
  const matched      = converaRows.filter(r => r.matchedInvoices?.length || r.matchedInvoice);
  const alreadyPaid  = converaRows.filter(r => !r.matchedInvoices?.length && r.matchedInvoice?.status === 'paid');
  const unmatched    = converaRows.filter(r => !r.matchedInvoices?.length && !r.matchedInvoice);
  const selectedCount = converaRows.filter(r => r.selected).length;
  const totalSelected = converaRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
  // ... status chips, payment-date picker, review table with per-row checkboxes,
  // "Start over" + "Mark N as Paid" (calls applyConveraPayments) ...
})()}
```

---

## Deleted JSX — Invoices tab "Import Payments" button

```tsx
<button onClick={() => { setShowConveraModal(true); loadConveraBeneficiaries(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"><UploadCloud className="w-4 h-4" /> Import Payments</button>
```

Replaced by two purpose-specific buttons on Payments tab (Import Intuit Payments
XLS) and Payment Profiles tab (Import Beneficiaries).
