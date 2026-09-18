// Accountant Invoices tab — extracted from TS.tsx in Slice I6 (2026-09-17).
// All filter state comes from the useInvoiceFilters hook at wrapper scope
// (I3). Modal-owned state and the pending* edit hooks stay at wrapper too;
// row-click opens the InvoiceDetail modal via the 2-call form (the reset
// effect at wrapper clears pending* on selectedInvoice.id change).

import { Download, FileText, Paperclip, Receipt, Users } from 'lucide-react';
import FilterPills, { type FilterPillOption } from '../../../components/FilterPills';
import MultiSelectDropdown from '../../../components/MultiSelectDropdown';
import StickyScrollWrapper from '../../../components/StickyScrollWrapper';
import InvoiceReconBadge from '../../../components/InvoiceReconBadge';
import { parseLocalDate } from '../../../lib/dates';
import type { Invoice, PaymentProfile, Project, Timesheet } from '../../../types';
import { reconcileInvoiceLive } from '../../../lib/reconcileInvoice';
import type { useInvoiceFilters } from '../../../hooks/useInvoiceFilters';

type InvoiceFilters = ReturnType<typeof useInvoiceFilters>;

interface InvoicesTabProps extends InvoiceFilters {
  invoices: Invoice[];
  projects: Project[];
  paymentProfiles: PaymentProfile[];
  timesheets: Timesheet[];
  // Pre-role handlers / helpers
  paymentMethod: (inv: Invoice) => string;
  paymentMethodLabel: (inv: Invoice) => string;
  paymentMethodChipClass: (inv: Invoice) => string;
  handleInvoiceAction: (
    id: number,
    status: 'approved' | 'rejected' | 'paid',
    payOnDate?: string,
    paidDate?: string,
    pmOverride?: string,
    paymentTerms?: string,
  ) => Promise<void>;
  openInvoiceDetail: (inv: Invoice) => void;
  openAttachment: (inv: Invoice) => void;
  exportInvoicesCSV: (rows: Invoice[]) => void;
  openConveraBatchPreview: (rows: Invoice[]) => void;
  openIntuitBatchPreview: (rows: Invoice[]) => void;
  loadConveraBeneficiaries: () => Promise<void> | void;
  loadConveraLastPaymentDates: () => Promise<void> | void;
  toggleCombinePayments: (profileId: number, current: boolean | null) => Promise<void> | void;
  // Modal openers (wrapper-owned state)
  setSelectedInvoice: (inv: Invoice) => void;
  setShowInvoiceModal: (v: boolean) => void;
  setShowConveraMatchingModal: (v: boolean) => void;
  setShowManualInvoiceModal: (v: boolean) => void;
  setShowQbExportModal: (v: boolean) => void;
  setQbExportSnapshot: (rows: Invoice[]) => void;
  setQbExportSelectedIds: (ids: Set<number>) => void;
}

export default function InvoicesTab(props: InvoicesTabProps) {
  const {
    invoices, projects, paymentProfiles, timesheets,
    accountantInvoiceFilter, setAccountantInvoiceFilter,
    invoiceDateRange, setInvoiceDateRange,
    invoicePayDateRange, setInvoicePayDateRange,
    invoicePaidDateRange, setInvoicePaidDateRange,
    invoiceMonthPreset, setInvoiceMonthPreset,
    invoicePayOnPreset, setInvoicePayOnPreset,
    invoicePaymentMethodPreset, setInvoicePaymentMethodPreset,
    invoiceSourceFilter, setInvoiceSourceFilter,
    setInvoiceSelectedUsers,
    invoiceUsers, effectiveInvoiceUsers, invoiceMonths, payOnDates,
    prePayOnFiltered, preStatusFiltered, filtered,
    nonUsdFiltered, totalFilteredUsd, nonUsdByCurrency, totalLabel,
    paymentMethod, paymentMethodLabel, paymentMethodChipClass,
    handleInvoiceAction, openInvoiceDetail, openAttachment,
    exportInvoicesCSV, openConveraBatchPreview, openIntuitBatchPreview,
    loadConveraBeneficiaries, loadConveraLastPaymentDates, toggleCombinePayments,
    setSelectedInvoice, setShowInvoiceModal, setShowConveraMatchingModal,
    setShowManualInvoiceModal, setShowQbExportModal,
    setQbExportSnapshot, setQbExportSelectedIds,
  } = props;

  const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
  const currencySymbols: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };

  // Full group sizes (before user filter) — tab-only, kept here.
  // Rows collapse by group_key when set (single umbrella PDF ingested as
  // multi-contractor, e.g. Teal). Bimosoft/HSBC/D-Kode contractors who
  // submit SEPARATE PDFs sharing a destination IBAN stay as their own
  // invoice document — distinct source PDFs, not one umbrella.
  const fullGroupSizes = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.groupKey) fullGroupSizes.set(inv.groupKey, (fullGroupSizes.get(inv.groupKey) || 0) + 1);
  }

  // I2: FilterPills-based Invoice pill rows. Tone consts local to this scope.
  const indigoActive = 'bg-indigo-600 text-white border-indigo-600';
  const indigoInactive = 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400';
  const blueActive = 'bg-blue-600 text-white border-blue-600';
  const blueInactive = 'bg-white text-blue-700 border-blue-200 hover:border-blue-400';
  const blueResetInactive = 'bg-white text-gray-600 border-gray-300 hover:border-blue-400';
  const grayInactiveInBlueRow = 'bg-white text-gray-500 border-gray-300 hover:border-blue-400';
  const grayActive = 'bg-gray-700 text-white border-gray-700';
  const grayInactive = 'bg-white text-gray-600 border-gray-300 hover:border-gray-500';
  const amberActive = 'bg-amber-600 text-white border-amber-600';
  const amberInactive = 'bg-amber-50 text-amber-700 border-amber-300 hover:border-amber-500';
  const amberInactiveSource = 'bg-white text-amber-700 border-amber-300 hover:border-amber-500';
  const intuitActive = 'bg-green-600 text-white border-green-600';
  const intuitInactive = 'bg-white text-green-700 border-green-300 hover:border-green-500';
  const converaActive = 'bg-purple-600 text-white border-purple-600';
  const converaInactive = 'bg-white text-purple-700 border-purple-300 hover:border-purple-500';

  const unassignedCount = preStatusFiltered.filter(i => (accountantInvoiceFilter.size === 0 || accountantInvoiceFilter.has(i.status)) && paymentMethod(i) === '').length;
  const pmOptions: FilterPillOption<string>[] = [
    { value: 'Intuit', label: <>Intuit <span className="opacity-70">({preStatusFiltered.filter(i => (accountantInvoiceFilter.size === 0 || accountantInvoiceFilter.has(i.status)) && paymentMethod(i) === 'Intuit').length})</span></>, activeTone: intuitActive, inactiveTone: intuitInactive },
    { value: 'Convera', label: <>Convera <span className="opacity-70">({preStatusFiltered.filter(i => (accountantInvoiceFilter.size === 0 || accountantInvoiceFilter.has(i.status)) && paymentMethod(i) === 'Convera').length})</span></>, activeTone: converaActive, inactiveTone: converaInactive },
  ];
  if (unassignedCount > 0) {
    pmOptions.push({ value: '', label: <>Unassigned <span className="opacity-70">({unassignedCount})</span></>, activeTone: amberActive, inactiveTone: amberInactive });
  }

  // Build display groups once — shared by tbody and tfoot.
  const groupMap = new Map<string, Invoice[]>();
  for (const inv of filtered) {
    const key = inv.groupKey ? `grp:${inv.groupKey}` : `solo:${inv.id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(inv);
  }
  const displayGroups = Array.from(groupMap.values());
  displayGroups.sort((a, b) => {
    const nameA = (a.length > 1 ? (a[0].paymentProfile?.companyName || a[0].userName) : a[0].userName).toLowerCase();
    const nameB = (b.length > 1 ? (b[0].paymentProfile?.companyName || b[0].userName) : b[0].userName).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const reconCell = (inv: Invoice, compact?: boolean) => {
    if (inv.source !== 'imported') return <span className="text-gray-300 text-xs">—</span>;
    const recon = reconcileInvoiceLive(inv, timesheets);
    const tooltip = recon.timesheetHours == null
      ? 'No timesheets found for period'
      : `Timesheet: ${recon.timesheetHours}h · Invoice: ${inv.totalHours}h`;
    const missingText = recon.missingWeeks > 0 && recon.timesheetHours != null && recon.status !== 'matched'
      ? `${recon.missingWeeks} week${recon.missingWeeks > 1 ? 's' : ''} with no TS` : null;
    return (
      <InvoiceReconBadge
        status={recon.status}
        delta={recon.delta}
        tsHours={recon.timesheetHours}
        missingText={missingText}
        tooltip={tooltip}
        showTsHours={!compact}
      />
    );
  };

  // Contractor rows vs distinct invoice documents. Match the table footer's
  // grouping semantic — rows collapse by group_key when set.
  const invoiceKey = (i: Invoice): string =>
    i.groupKey ? `grp:${i.groupKey}` : `solo:${i.id}`;
  const countCaption = (rows: Invoice[]) => {
    const c = rows.length;
    if (c === 0) return null;
    const inv = new Set(rows.map(invoiceKey)).size;
    return `${c} contractor${c === 1 ? '' : 's'} · ${inv} invoice${inv === 1 ? '' : 's'}`;
  };
  const submittedRows = filtered.filter(i => i.status === 'submitted');
  const approvedRows  = filtered.filter(i => i.status === 'approved');
  const paidRows      = filtered.filter(i => i.status === 'paid');

  return (
    <div>
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <div className="flex flex-col gap-3">
          {invoiceMonths.length > 0 && (
            <FilterPills<string>
              multi
              shape="button"
              selected={invoiceMonthPreset}
              onChange={setInvoiceMonthPreset}
              resetLabel="All months"
              resetActiveTone={indigoActive}
              resetInactiveTone={indigoInactive}
              options={invoiceMonths.map(ym => {
                const [y, m] = ym.split('-');
                const label = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                const count = invoices.filter(i => i.periodEnd?.slice(0, 7) === ym).length;
                return { value: ym, label: <>{label} <span className="opacity-70">({count})</span></>, activeTone: indigoActive, inactiveTone: indigoInactive };
              })}
              extra={invoiceMonthPreset.size === 1 && [...invoiceMonthPreset][0] === invoiceMonths[0] ? (
                <span className="text-xs text-gray-400 ml-1">Loaded to latest period — select All months to see everything</span>
              ) : undefined}
            />
          )}
          {payOnDates.length > 0 && (
            <FilterPills<string>
              multi
              shape="button"
              selected={invoicePayOnPreset}
              onChange={setInvoicePayOnPreset}
              prefix={<span className="text-xs font-medium text-blue-600 mr-1">Pay On:</span>}
              resetLabel="All"
              resetActiveTone={blueActive}
              resetInactiveTone={blueResetInactive}
              options={[
                ...payOnDates.map(d => {
                  const label = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const count = prePayOnFiltered.filter(i => i.payOnDate === d).length;
                  return { value: d, label: <>{label} <span className="opacity-70">({count})</span></>, activeTone: blueActive, inactiveTone: blueInactive };
                }),
                { value: 'none', label: <>Not assigned <span className="opacity-70">({prePayOnFiltered.filter(i => !i.payOnDate).length})</span></>, activeTone: blueActive, inactiveTone: grayInactiveInBlueRow },
              ]}
            />
          )}
          <FilterPills<string>
            multi
            shape="button"
            size="md"
            selected={accountantInvoiceFilter}
            onChange={setAccountantInvoiceFilter}
            resetLabel={<>All <span className={`ml-1 text-xs ${accountantInvoiceFilter.size === 0 ? 'opacity-80' : 'opacity-60'}`}>({preStatusFiltered.length})</span></>}
            resetActiveTone={indigoActive}
            resetInactiveTone={indigoInactive}
            options={(['submitted', 'approved', 'paid', 'rejected'] as const).map(s => {
              const count = preStatusFiltered.filter(i => i.status === s).length;
              return {
                value: s,
                label: <>{s.charAt(0).toUpperCase() + s.slice(1)}<span className={`ml-1.5 text-xs ${accountantInvoiceFilter.has(s) ? 'opacity-80' : 'opacity-60'}`}>({count})</span></>,
                activeTone: indigoActive,
                inactiveTone: indigoInactive,
              };
            })}
          />
          <FilterPills<string>
            multi
            shape="button"
            selected={invoicePaymentMethodPreset}
            onChange={setInvoicePaymentMethodPreset}
            prefix="Method:"
            resetLabel="All"
            resetActiveTone={grayActive}
            resetInactiveTone={grayInactive}
            options={pmOptions}
          />
          <FilterPills<'all' | 'contractor' | 'manual'>
            shape="button"
            selected={invoiceSourceFilter}
            onChange={setInvoiceSourceFilter}
            prefix="Source:"
            options={(['all', 'contractor', 'manual'] as const).map(k => {
              const count = k === 'all'
                ? preStatusFiltered.length
                : k === 'manual'
                  ? preStatusFiltered.filter(i => i.source === 'manual').length
                  : preStatusFiltered.filter(i => i.source !== 'manual').length;
              const label = k === 'all' ? 'All' : k === 'contractor' ? 'Contractor' : 'Manual';
              const activeTone = k === 'manual' ? amberActive : grayActive;
              const inactiveTone = k === 'manual' ? amberInactiveSource : grayInactive;
              return { value: k, label: <>{label} <span className="opacity-70">({count})</span></>, activeTone, inactiveTone };
            })}
          />
          {/* Contractor picker */}
          <MultiSelectDropdown
            options={invoiceUsers.map(u => ({ id: u.id, label: u.name }))}
            selected={effectiveInvoiceUsers}
            onChange={next => setInvoiceSelectedUsers(next.length === invoiceUsers.length ? null : next)}
            itemNoun="contractors"
            searchPlaceholder="Search contractors..."
            emptyLabel="No contractors match"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <span className="block text-xs font-medium text-gray-500 mb-1">Period</span>
              <div className="flex gap-1 items-center">
                <input type="date" value={invoiceDateRange.start} onChange={e => setInvoiceDateRange({...invoiceDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="date" value={invoiceDateRange.end} onChange={e => setInvoiceDateRange({...invoiceDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                {(invoiceDateRange.start || invoiceDateRange.end) && <button onClick={() => setInvoiceDateRange({start:'',end:''})} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">✕</button>}
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium text-blue-600 mb-1">Pay On Date (range)</span>
              <div className="flex gap-1 items-center">
                <input type="date" value={invoicePayDateRange.start} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="date" value={invoicePayDateRange.end} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                {(invoicePayDateRange.start || invoicePayDateRange.end) && <button onClick={() => setInvoicePayDateRange({start:'',end:''})} className="text-xs text-blue-400 hover:text-blue-600 underline ml-1">✕</button>}
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium text-green-700 mb-1">Paid Date</span>
              <div className="flex gap-1 items-center">
                <input type="date" value={invoicePaidDateRange.start} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="date" value={invoicePaidDateRange.end} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                {(invoicePaidDateRange.start || invoicePaidDateRange.end) && <button onClick={() => setInvoicePaidDateRange({start:'',end:''})} className="text-xs text-green-500 hover:text-green-700 underline ml-1">✕</button>}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 flex-wrap">
            <button onClick={() => setShowManualInvoiceModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"><FileText className="w-4 h-4" /> + Manual Invoice</button>
            <button onClick={() => { setShowConveraMatchingModal(true); loadConveraBeneficiaries(); loadConveraLastPaymentDates(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm"><Users className="w-4 h-4" /> Convera Matching</button>
            <button onClick={() => exportInvoicesCSV(filtered)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
            <button onClick={() => { setInvoicePaymentMethodPreset(new Set(['Convera'])); openConveraBatchPreview(filtered); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 text-sm"><Download className="w-4 h-4" /> Convera Batch</button>
            <button onClick={() => openIntuitBatchPreview(filtered)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm"><Download className="w-4 h-4" /> Intuit Batch</button>
            <button
              onClick={() => {
                // Snapshot filter view + pre-select ready (mapped + not_exported).
                const preSelected = new Set<number>();
                for (const inv of filtered) {
                  const pp = paymentProfiles.find(p => p.id === inv.paymentProfile?.id)
                    || (inv.paymentProfile?.iban ? paymentProfiles.find(p => p.userId === inv.userId && p.iban === inv.paymentProfile!.iban) : null)
                    || paymentProfiles.find(p => p.userId === inv.userId && p.isDefault);
                  const hasVendor = !!pp?.qbVendorName;
                  const isReady = inv.qbExportStatus === 'not_exported';
                  if (hasVendor && isReady) preSelected.add(inv.id);
                }
                setQbExportSnapshot(filtered);
                setQbExportSelectedIds(preSelected);
                setShowQbExportModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Download className="w-4 h-4" /> Export to QB
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards — reflect current filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-sm text-gray-500 mb-1">{totalLabel}</div>
          <div className="text-2xl font-bold text-indigo-600">${totalFilteredUsd.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          <div className="text-xs text-gray-400 mt-1">{nonUsdFiltered.length > 0 ? `excl. ${nonUsdFiltered.length} non-USD` : 'USD only'}</div>
          {countCaption(filtered) && <div className="text-xs text-gray-500 mt-0.5">{countCaption(filtered)}</div>}
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-sm text-gray-500 mb-1">Pending Review</div>
          <div className="text-2xl font-bold text-yellow-600">{submittedRows.length}</div>
          <div className="text-xs text-gray-400 mt-1">awaiting approval</div>
          {countCaption(submittedRows) && <div className="text-xs text-gray-500 mt-0.5">{countCaption(submittedRows)}</div>}
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-sm text-gray-500 mb-1">Approved</div>
          <div className="text-2xl font-bold text-green-600">{approvedRows.length}</div>
          <div className="text-xs text-gray-400 mt-1">ready to pay</div>
          {countCaption(approvedRows) && <div className="text-xs text-gray-500 mt-0.5">{countCaption(approvedRows)}</div>}
        </div>
        {nonUsdFiltered.length > 0 ? (
          <div className="bg-amber-50 border border-amber-300 rounded-lg shadow-md p-4">
            <div className="text-sm text-amber-700 font-semibold mb-1">Non-USD Invoices</div>
            <div className="text-2xl font-bold text-amber-600">{nonUsdFiltered.length}</div>
            <div className="text-xs text-amber-600 mt-1">
              {Object.entries(nonUsdByCurrency).map(([cur, cnt]) => `${cnt} ${cur}`).join(', ')} — USD amounts needed
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-500 mb-1">Paid</div>
            <div className="text-2xl font-bold text-blue-600">{paidRows.length}</div>
            <div className="text-xs text-gray-400 mt-1">invoices settled</div>
            {countCaption(paidRows) && <div className="text-xs text-gray-500 mt-0.5">{countCaption(paidRows)}</div>}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Table */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400"><Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No invoices match the current filter</p></div>
        ) : (
          <StickyScrollWrapper maxHeight="calc(100vh - 360px)">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-indigo-600 text-white sticky top-0 z-20">
                <tr>
                  <th className="border border-indigo-700 px-4 py-3 text-left sticky left-0 z-30 bg-indigo-600">Contractor</th>
                  <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Period</th>
                  <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Project</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Hours</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Rate</th>
                  <th className="border border-indigo-700 px-4 py-3 text-right bg-indigo-600">Amount</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Pay On Date</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Payment Method</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Paid Date</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Status</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Recon</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">PDF</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let rowIdx = 0;
                  return displayGroups.map((group) => {
                    const isGroup = group.length > 1;

                    if (!isGroup) {
                      const inv = group[0];
                      const project = projects.find(p => p.id === inv.projectId);
                      const sym = currencySymbols[inv.currency] || '$';
                      const isEvenRow = rowIdx % 2 === 0;
                      const rowClass = isEvenRow ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50';
                      rowIdx++;
                      return (
                        <tr key={inv.id} className={'cursor-pointer group ' + rowClass} onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                          <td className={`border border-gray-200 px-4 py-3 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] group-hover:bg-blue-50 ${isEvenRow ? 'bg-white' : 'bg-gray-50'}`}>
                            <div className="font-medium text-gray-800">{inv.userName}</div>
                            <div className="font-mono text-xs text-gray-400 mt-0.5">#{inv.invoiceNumber}</div>
                          </td>
                          <td className="border border-gray-200 px-4 py-3 whitespace-nowrap">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                          <td className="border border-gray-200 px-4 py-3 text-indigo-600 text-xs">{project?.name || '—'}</td>
                          <td className="border border-gray-200 px-4 py-3 text-center">{inv.totalHours?.toFixed(2) ?? '—'}</td>
                          <td className="border border-gray-200 px-4 py-3 text-center text-gray-500">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)}` : '—'}</td>
                          <td className="border border-gray-200 px-4 py-3 text-right font-bold text-gray-800">
                            {sym}{inv.totalAmount.toFixed(2)}
                            {inv.source === 'imported' && inv.currency !== 'USD' && (
                              <span className="ml-1 text-amber-500 text-xs font-semibold" title={`Extracted in ${inv.currency} — set USD rate in invoice detail`}>⚠ {inv.currency}</span>
                            )}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                            {inv.payOnDate
                              ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{parseLocalDate(inv.payOnDate!).toLocaleDateString()}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                            {/* Always show the chip. paymentMethodLabel resolves via
                                override → prior history → location_type invariant,
                                falling to "Unassigned" (gray) only when nothing works. */}
                            <span className={`px-2 py-1 rounded text-xs font-medium ${paymentMethodChipClass(inv)}`}>{paymentMethodLabel(inv)}</span>
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                            {inv.paidDate
                              ? <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">{parseLocalDate(inv.paidDate!).toLocaleDateString()}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                            {inv.corrected && <span className="ml-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                            {inv.source === 'manual' && <span className="ml-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800" title="Created by accountant via + Manual Invoice">Manual</span>}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center">{reconCell(inv)}</td>
                          <td className="border border-gray-200 px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            {inv.attachmentPath ? (
                              <button onClick={() => openAttachment(inv)} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 text-xs font-medium">
                                <Paperclip className="w-3 h-3" /> PDF
                              </button>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="border border-gray-200 px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {inv.status === 'submitted' && (
                                <>
                                  <button onClick={() => handleInvoiceAction(inv.id, 'approved')} className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">Approve</button>
                                  <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">Reject</button>
                                </>
                              )}
                              {inv.status === 'approved' && (
                                <>
                                  <button onClick={() => openInvoiceDetail(inv)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs font-medium">Mark Paid</button>
                                  {!inv.paidDate && <button onClick={() => { if (!window.confirm(`Reject ${inv.userName}'s invoice?`)) return; handleInvoiceAction(inv.id, 'rejected'); }} className="px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">Reject</button>}
                                </>
                              )}
                              {inv.status === 'rejected' && <button onClick={() => openInvoiceDetail(inv)} className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">Re-approve</button>}
                              {inv.status === 'paid' && <span className="text-gray-400 text-xs">—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // ── Multi-invoice group (e.g. Teal Crossroads) ──
                    rowIdx++;
                    const groupKey = group[0].invoiceNumber;
                    const groupPeriod = parseLocalDate(group[0].periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    const groupTotalHours = group.reduce((s, i) => s + (i.totalHours ?? 0), 0);
                    const groupTotalAmount = group.reduce((s, i) => s + i.totalAmount, 0);
                    const groupSym = currencySymbols[group[0].currency] || '$';
                    const submittedInGroup = group.filter(i => i.status === 'submitted');
                    const anyAttachment = group.find(i => i.attachmentPath);
                    const sharedProfile = group[0].paymentProfile;
                    const allShareProfile = sharedProfile && group.every(i => i.paymentProfile?.id === sharedProfile.id);
                    const groupStatuses = [...new Set(group.map(i => i.status))];
                    const groupFirstPayOn = group.find(i => i.payOnDate)?.payOnDate;

                    const sortedGroup = [...group].sort((a, b) => a.userName.localeCompare(b.userName));
                    const companyName = group[0].paymentProfile?.companyName || group.map(i => i.userName).join(', ');
                    const groupRecons = group.filter(i => i.source === 'imported').map(i => reconcileInvoiceLive(i, timesheets));
                    const groupTsHours = groupRecons.every(r => r.timesheetHours != null)
                      ? groupRecons.reduce((s, r) => s + (r.timesheetHours ?? 0), 0) : null;
                    // Missing weeks at group level: weeks where no member has any hours.
                    const groupMissingWeeks = (() => {
                      const inv0 = group.find(i => i.source === 'imported');
                      if (!inv0) return 0;
                      const { periodStart, periodEnd } = inv0;
                      const firstDay = new Date(periodStart + 'T12:00:00');
                      const firstDow = firstDay.getDay();
                      firstDay.setDate(firstDay.getDate() - (firstDow === 0 ? 6 : firstDow - 1));
                      const weeks: string[] = [];
                      const cur = new Date(firstDay.getTime());
                      while (cur.toISOString().slice(0, 10) <= periodEnd) {
                        weeks.push(cur.toISOString().slice(0, 10));
                        cur.setDate(cur.getDate() + 7);
                      }
                      const weeksWithAnyHours = new Set(
                        groupRecons.flatMap(r => r.rows.filter(row => row.hoursInPeriod > 0).map(row => row.ts.weekStart))
                      );
                      return weeks.filter(w => !weeksWithAnyHours.has(w)).length;
                    })();
                    const groupReconDelta = groupTsHours != null ? Math.round((groupTotalHours - groupTsHours) * 100) / 100 : null;
                    const groupReconStatus: 'matched' | 'mismatch' | 'unverifiable' = groupTsHours == null ? 'unverifiable'
                      : Math.abs(groupReconDelta!) < 0.01 ? 'matched' : 'mismatch';
                    const groupMissingText = groupMissingWeeks > 0 && groupTsHours != null && groupReconStatus !== 'matched'
                      ? `${groupMissingWeeks} wk${groupMissingWeeks > 1 ? 's' : ''} missing` : null;

                    return [
                      // Group header row
                      <tr key={`grp-hdr-${groupKey}`} className="bg-indigo-50 border-l-4 border-l-indigo-500 font-semibold">
                        <td className="border border-indigo-200 px-4 py-2.5 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] bg-indigo-50">
                          <div className="font-medium text-indigo-900">{companyName}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-xs text-gray-400">#{groupKey}</span>
                            <span className="px-1.5 py-0.5 bg-indigo-200 text-indigo-700 rounded text-xs">Group · {group.length}</span>
                            {group[0].groupKey && group.length < (fullGroupSizes.get(group[0].groupKey) ?? group.length) && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">Filtered</span>
                            )}
                          </div>
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-xs whitespace-nowrap text-indigo-700">{groupPeriod}</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-xs text-gray-400">—</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center text-indigo-800">{groupTotalHours.toFixed(2)}</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center text-gray-400 text-xs">—</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-right text-indigo-900 font-bold">{groupSym}{groupTotalAmount.toFixed(2)}</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center whitespace-nowrap">
                          {groupFirstPayOn
                            ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{new Date(groupFirstPayOn).toLocaleDateString()}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {allShareProfile && sharedProfile ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentMethodChipClass(group[0])}`}>
                                {paymentMethodLabel(group[0])}
                              </span>
                              <button
                                onClick={() => toggleCombinePayments(sharedProfile.id, sharedProfile.combinePayments)}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${sharedProfile.combinePayments ? 'bg-teal-100 text-teal-700 border-teal-300 hover:bg-teal-200' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
                                title="Toggle whether all invoices to this payee are combined into one wire"
                              >
                                {sharedProfile.combinePayments ? '⊕ Combined' : '○ Separate'}
                              </button>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center text-gray-400 text-xs">—</td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center">
                          <div className="flex flex-wrap justify-center gap-0.5">
                            {groupStatuses.map(s => (
                              <span key={s} className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${statusColors[s]}`}>
                                {group.filter(i => i.status === s).length} {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center">
                          <InvoiceReconBadge
                            status={groupReconStatus}
                            delta={groupReconDelta}
                            tsHours={groupTsHours}
                            missingText={groupMissingText}
                          />
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {anyAttachment ? (
                            <button onClick={() => openAttachment(anyAttachment)} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 text-indigo-700 border border-indigo-300 rounded hover:bg-indigo-200 text-xs font-medium">
                              <Paperclip className="w-3 h-3" /> PDF
                            </button>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          {submittedInGroup.length > 0 && (
                            <button
                              onClick={async () => { for (const inv of submittedInGroup) await handleInvoiceAction(inv.id, 'approved'); }}
                              className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium whitespace-nowrap"
                            >
                              Approve all ({submittedInGroup.length})
                            </button>
                          )}
                          {submittedInGroup.length === 0 && <span className="text-gray-400 text-xs">—</span>}
                        </td>
                      </tr>,
                      // Individual contractor rows within the group — sorted by name
                      ...sortedGroup.map((inv) => {
                        const project = projects.find(p => p.id === inv.projectId);
                        const sym = currencySymbols[inv.currency] || '$';
                        return (
                          <tr key={inv.id} className="bg-white border-l-4 border-l-indigo-200 hover:bg-indigo-50 cursor-pointer group" onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                            <td className="border border-gray-200 px-4 py-2 pl-7 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] bg-white group-hover:bg-indigo-50">
                              <div className="flex items-center gap-1.5">
                                <span className="text-gray-300 text-xs">↳</span>
                                <span className="font-medium text-gray-800 text-sm">{inv.userName}</span>
                              </div>
                              {inv.invoiceNumber && <div className="font-mono text-xs text-gray-400 mt-0.5 ml-4">#{inv.invoiceNumber}</div>}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-gray-400 text-xs">—</td>
                            <td className="border border-gray-200 px-4 py-2 text-indigo-600 text-xs">{project?.name || '—'}</td>
                            <td className="border border-gray-200 px-4 py-2 text-center text-sm">{inv.totalHours?.toFixed(2) ?? '—'}</td>
                            <td className="border border-gray-200 px-4 py-2 text-center text-gray-500 text-sm">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)}` : '—'}</td>
                            <td className="border border-gray-200 px-4 py-2 text-right font-semibold text-gray-800 text-sm">
                              {sym}{inv.totalAmount.toFixed(2)}
                              {inv.source === 'imported' && inv.currency !== 'USD' && (
                                <span className="ml-1 text-amber-500 text-xs" title={`Extracted in ${inv.currency}`}>⚠ {inv.currency}</span>
                              )}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center whitespace-nowrap">
                              {inv.payOnDate
                                ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{parseLocalDate(inv.payOnDate!).toLocaleDateString()}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentMethodChipClass(inv)}`}>{paymentMethodLabel(inv)}</span>
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center whitespace-nowrap">
                              {inv.paidDate
                                ? <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">{parseLocalDate(inv.paidDate!).toLocaleDateString()}</span>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>
                                {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                              </span>
                              {inv.corrected && <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center">{reconCell(inv, true)}</td>
                            <td className="border border-gray-200 px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                              {inv.attachmentPath ? (
                                <button onClick={() => openAttachment(inv)} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 text-xs">
                                  <Paperclip className="w-3 h-3" /> PDF
                                </button>
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            <td className="border border-gray-200 px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {inv.status === 'submitted' && (
                                  <>
                                    <button onClick={() => handleInvoiceAction(inv.id, 'approved')} className="px-2 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">✓</button>
                                    <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">✕</button>
                                  </>
                                )}
                                {inv.status === 'approved' && (
                                  <>
                                    <button onClick={() => openInvoiceDetail(inv)} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs font-medium">Paid</button>
                                    {!inv.paidDate && <button onClick={() => { if (!window.confirm(`Reject ${inv.userName}'s invoice?`)) return; handleInvoiceAction(inv.id, 'rejected'); }} className="px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">✕</button>}
                                  </>
                                )}
                                {inv.status === 'rejected' && <button onClick={() => openInvoiceDetail(inv)} className="px-2 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">↩</button>}
                                {inv.status === 'paid' && <span className="text-gray-400 text-xs">—</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  });
                })()}
              </tbody>
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td className="border border-gray-200 px-4 py-3 text-gray-700 sticky left-0 z-10 bg-gray-100" colSpan={4}>Filtered Total ({filtered.length} contractor{filtered.length !== 1 ? 's' : ''}, {displayGroups.length} invoice{displayGroups.length !== 1 ? 's' : ''})</td>
                  <td className="border border-gray-200 px-4 py-3 text-center">{filtered.reduce((s, i) => s + (i.totalHours ?? 0), 0).toFixed(2)}</td>
                  <td className="border border-gray-200 px-4 py-3"></td>
                  <td className="border border-gray-200 px-4 py-3 text-right text-indigo-700">${filtered.reduce((s, i) => s + i.totalAmount, 0).toFixed(2)}</td>
                  <td className="border border-gray-200 px-4 py-3" colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          </StickyScrollWrapper>
        )}
      </div>
    </div>
  );
}
