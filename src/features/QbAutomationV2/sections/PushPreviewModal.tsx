import { Fragment, useMemo, useState } from 'react';
import { X, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Users } from 'lucide-react';
import type { ReadyRow } from '../hooks/useQbAutomationV2';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { SaveMappingArgs } from './NeedsMappingCard';
import InlineVendorPicker from './InlineVendorPicker';

interface Props {
  rows: ReadyRow[];
  vendors: QbVendorRow[];
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
  onSyncVendors: () => Promise<void>;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictLabel(v: ReadyRow['verdict']): string {
  if (v === 'will_pay') return 'Will Pay';
  if (v === 'will_create_and_pay') return 'Will Create + Pay';
  return 'Will Create Bill';
}

function verdictBadgeCls(v: ReadyRow['verdict']): string {
  if (v === 'will_create_and_pay') return 'bg-emerald-100 text-emerald-800';
  if (v === 'will_create_bill') return 'bg-purple-100 text-purple-800';
  return 'bg-blue-100 text-blue-800';
}

export default function PushPreviewModal({ rows, vendors, onSaveMapping, onSyncVendors, onCancel, onConfirm, busy }: Props) {
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Umbrella group rows in the modal default to expanded so the accountant
  // sees the full breakdown before confirming (per Dan 2026-09-23).
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(new Set());
  const toggleGroup = (rowKey: string) => {
    setCollapsedGroupKeys(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const vendorsById = useMemo(() => new Map(vendors.map(v => [v.listId, v])), [vendors]);

  // Preflight: any selected row whose target vendor listId is set but not
  // present in the qb_vendors mirror. Cause: vendor added to QB but not
  // synced to our mirror yet. Push would fall through vendor resolution.
  const missingVendorRows = useMemo(
    () => rows.filter(r => r.qbVendorListId != null && !vendorsById.has(r.qbVendorListId)),
    [rows, vendorsById],
  );

  const handleSyncVendors = async () => {
    setSyncing(true);
    try {
      await onSyncVendors();
    } catch (e) {
      console.error('preflight sync vendors failed', e);
    } finally {
      setSyncing(false);
    }
  };

  const groups = useMemo(() => {
    const pay = rows.filter(r => r.verdict === 'will_pay');
    const createPay = rows.filter(r => r.verdict === 'will_create_and_pay');
    const createBill = rows.filter(r => r.verdict === 'will_create_bill');
    return {
      pay: { rows: pay, total: pay.reduce((s, r) => s + r.amount, 0) },
      createPay: { rows: createPay, total: createPay.reduce((s, r) => s + r.amount, 0) },
      createBill: { rows: createBill, total: createBill.reduce((s, r) => s + r.amount, 0) },
    };
  }, [rows]);

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  const handleSaveVendor = async (row: ReadyRow, args: { qbVendorListId: string; qbVendorName: string }) => {
    if (row.ppId <= 0) {
      alert('This row has no payment profile — cannot save mapping.');
      return;
    }
    setSavingRowKey(row.rowKey);
    try {
      await onSaveMapping({
        eventId: row.eventId ?? null,
        ppId: row.ppId,
        source: row.ppSource,
        counterpartyPattern: row.ppCounterpartyPattern,
        qbVendorListId: args.qbVendorListId,
        qbVendorName: args.qbVendorName,
      });
      setEditingRowKey(null);
    } catch (e) {
      console.error('preview inline saveMapping failed', e);
      alert('Failed to save mapping: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRowKey(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-800">Push Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rows.length} {rows.length === 1 ? 'item' : 'items'} · {fmtMoney(grandTotal)} — review before pushing to QuickBooks
            </p>
          </div>
          <button onClick={onCancel} disabled={busy} className="text-gray-500 hover:text-gray-800 disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {missingVendorRows.length > 0 && (
          <div className="px-4 py-3 border-b border-amber-200 bg-amber-50 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-semibold text-amber-900 mb-1">
                {missingVendorRows.length} {missingVendorRows.length === 1 ? 'row targets a QB vendor' : 'rows target QB vendors'} that {missingVendorRows.length === 1 ? 'is' : 'are'} not in the local mirror yet
              </div>
              <div className="text-amber-800 mb-1">
                {missingVendorRows.slice(0, 5).map(r => r.contractorName).join(', ')}
                {missingVendorRows.length > 5 && ` +${missingVendorRows.length - 5} more`}
              </div>
              <div className="text-amber-700 mb-2">
                Push is blocked until the vendor list refreshes. Click Sync Vendors, then wait for QBWC to drain (~15 min). This banner disappears once the missing vendors appear in the mirror. Alternatively, re-map any affected row to a vendor already in your mirror.
              </div>
              <button
                onClick={handleSyncVendors}
                disabled={syncing || busy}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={'w-3.5 h-3.5 ' + (syncing ? 'animate-spin' : '')} />
                {syncing ? 'Enqueueing…' : 'Sync Vendors'}
              </button>
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-3 gap-3 text-xs">
          <div className="rounded border border-blue-200 bg-blue-50 p-2">
            <div className="uppercase font-semibold text-blue-700">Will Pay</div>
            <div className="text-lg font-bold text-blue-900">{groups.pay.rows.length}</div>
            <div className="text-blue-700">{fmtMoney(groups.pay.total)}</div>
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
            <div className="uppercase font-semibold text-emerald-700">Will Create + Pay</div>
            <div className="text-lg font-bold text-emerald-900">{groups.createPay.rows.length}</div>
            <div className="text-emerald-700">{fmtMoney(groups.createPay.total)}</div>
          </div>
          <div className="rounded border border-purple-200 bg-purple-50 p-2">
            <div className="uppercase font-semibold text-purple-700">Will Create Bill</div>
            <div className="text-lg font-bold text-purple-900">{groups.createBill.rows.length}</div>
            <div className="text-purple-700">{fmtMoney(groups.createBill.total)}</div>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">Nothing selected.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Contractor</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Period</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Invoice #</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">QB Vendor</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const missing = r.qbVendorListId != null && !vendorsById.has(r.qbVendorListId);
                  const isGroup = !!r.children && r.children.length > 0;
                  const isExpanded = isGroup && !collapsedGroupKeys.has(r.rowKey);
                  return (
                  <Fragment key={r.rowKey}>
                  <tr className={missing ? 'bg-amber-50 hover:bg-amber-100' : isGroup ? 'bg-teal-50/40 hover:bg-teal-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">
                      {isGroup ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(r.rowKey)}
                          className="inline-flex items-center gap-1 hover:text-teal-800"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <Users className="w-3.5 h-3.5 text-teal-700" />
                          <span>{r.contractorName}</span>
                          <span className="text-[10px] font-normal text-teal-800 bg-teal-100 border border-teal-200 rounded px-1 py-0.5 ml-1">
                            {r.children!.length} contractors
                          </span>
                        </button>
                      ) : (
                        r.contractorName
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{r.monthLabel || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{isGroup ? '—' : (r.invoiceNumber || '—')}</td>
                    <td className="px-3 py-1.5 text-gray-700" style={{ minWidth: 260 }}>
                      {isGroup ? (
                        r.distinctVendorCount && r.distinctVendorCount > 1
                          ? <span className="text-teal-800">{r.distinctVendorCount} vendors <span className="text-[10px] text-teal-600">(expand for detail)</span></span>
                          : r.qbVendorName
                      ) : editingRowKey === r.rowKey ? (
                        <InlineVendorPicker
                          initialValue={r.qbVendorMapped ? r.qbVendorName : ''}
                          vendors={vendors}
                          candidates={r.candidates}
                          saving={savingRowKey === r.rowKey}
                          onSave={args => handleSaveVendor(r, args)}
                          onCancel={() => setEditingRowKey(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={busy || r.ppId <= 0}
                          onClick={() => setEditingRowKey(r.rowKey)}
                          title={r.ppId <= 0 ? 'No payment profile — cannot re-map' : 'Click to change QB vendor mapping'}
                          className={
                            'text-left w-full px-1 py-0.5 rounded ' +
                            (busy || r.ppId <= 0
                              ? 'cursor-not-allowed opacity-60'
                              : 'hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 cursor-pointer')
                          }
                        >
                          <span className={r.qbVendorMapped ? '' : 'text-amber-600 italic'}>
                            {r.qbVendorName}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap">
                      {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ' + verdictBadgeCls(r.verdict)}>
                        {verdictLabel(r.verdict)}
                      </span>
                      {missing && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-200 text-amber-900" title="This vendor listId is not in the local qb_vendors mirror yet — Sync Vendors to refresh">
                          Not synced
                        </span>
                      )}
                    </td>
                  </tr>
                  {isGroup && isExpanded && r.children!.map(c => (
                    <tr key={`${r.rowKey}-child-${c.invoiceId}`} className="bg-teal-50/20 text-xs text-gray-700">
                      <td className="px-3 py-1 pl-10 italic whitespace-nowrap">{c.contractorName}</td>
                      <td className="px-3 py-1"></td>
                      <td className="px-3 py-1 font-mono text-gray-500 whitespace-nowrap">{c.invoiceNumber}</td>
                      <td className="px-3 py-1">{c.qbVendorName}</td>
                      <td className="px-3 py-1 text-right font-mono">
                        {fmtMoney(c.share)}{' '}
                        {c.shareSource === 'invoice_total' && (
                          <span title="Share from convera_transaction_invoices not available — using invoice total as fallback" className="text-amber-600">*</span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-[10px] text-gray-500">
                        {c.hours != null && `${c.hours}h`}{c.hours != null && c.rate != null && ' · '}{c.rate != null && `$${c.rate}`}
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || rows.length === 0 || missingVendorRows.length > 0}
            title={missingVendorRows.length > 0 ? 'Sync missing vendors before pushing' : undefined}
            className={
              'px-4 py-2 text-sm font-medium rounded ' +
              (busy || rows.length === 0 || missingVendorRows.length > 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700')
            }
          >
            {busy ? 'Pushing…' : `Push ${rows.length} to QuickBooks · ${fmtMoney(grandTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
