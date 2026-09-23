import { useState } from 'react';
import { AlertOctagon, ExternalLink, RefreshCw } from 'lucide-react';
import type { NeedsMappingRow, NeedsMappingReason } from '../hooks/useQbAutomationV2';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { Candidate, Confidence } from '../../../lib/qbAutomation/vendorMappingResolver';
import InlineVendorPicker from './InlineVendorPicker';

export interface SaveMappingArgs {
  // null when saving from a Ready row that has no event (invoice-driven
  // rows in the "will_create_bill" verdict).
  eventId: number | null;
  ppId: number;
  source: string;
  counterpartyPattern: string;
  qbVendorListId: string;
  qbVendorName: string;
}

interface Props {
  rows: NeedsMappingRow[];
  vendors: QbVendorRow[];
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
  /** Writes qb_vendor_name to the pp — reconciler picks it up on next tick
   *  and creates the mapping. Used for invoice_pp_no_qb_vendor. */
  onSaveQbVendorName: (ppId: number, vendorName: string) => Promise<void>;
  onSyncVendors: () => Promise<void>;
  onOpenInvoiceModal: (invoiceId: number) => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function confidenceChipClass(c: Confidence): string {
  return c === 'high'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
    : c === 'medium'
      ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
      : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200';
}

function reasonMeta(reason: NeedsMappingReason) {
  switch (reason) {
    case 'event_needs_vendor':
      return { label: 'Event needs QB vendor', cls: 'bg-amber-100 text-amber-800',
        detail: 'This wire event landed but no QB vendor was picked. Choose one and it moves to Ready.' };
    case 'invoice_pp_no_qb_vendor':
      return { label: 'Profile needs QB vendor', cls: 'bg-amber-100 text-amber-800',
        detail: "The contractor's payment profile has no QB Vendor set. Pick one and the mapping is created automatically." };
    case 'invoice_pp_vendor_not_synced':
      return { label: 'QB vendor not synced', cls: 'bg-amber-100 text-amber-800',
        detail: 'The profile lists a QB vendor that is not in the local mirror. Run Sync Vendors and this row heals automatically after QBWC drains.' };
    case 'invoice_no_pp':
      return { label: 'No payment profile', cls: 'bg-red-100 text-red-800',
        detail: 'This invoice has no payment profile snapshot. Open the invoice to link one (cross-contractor picker works too).' };
  }
}

export default function NeedsMappingCard(props: Props) {
  const { rows, vendors, onSaveMapping, onSaveQbVendorName, onSyncVendors, onOpenInvoiceModal } = props;
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const vendorByLowerName = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));

  const handleSaveEventMapping = async (row: NeedsMappingRow, args: { qbVendorListId: string; qbVendorName: string }) => {
    if (row.ppId <= 0) return;
    setSavingRowKey(row.rowKey);
    try {
      await onSaveMapping({
        eventId: row.eventId,
        ppId: row.ppId,
        source: row.source,
        counterpartyPattern: row.counterpartyRaw,
        qbVendorListId: args.qbVendorListId,
        qbVendorName: args.qbVendorName,
      });
      setEditingRowKey(null);
    } catch (e) {
      alert('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRowKey(null);
    }
  };

  const handleSaveVendorName = async (row: NeedsMappingRow, args: { qbVendorName: string }) => {
    if (row.ppId <= 0) return;
    // If picked value resolves to a known vendor, save the canonical name;
    // otherwise the raw text (reconciler will fail cleanly).
    const vendor = vendorByLowerName.get(args.qbVendorName.toLowerCase().trim());
    setSavingRowKey(row.rowKey);
    try {
      await onSaveQbVendorName(row.ppId, vendor?.name ?? args.qbVendorName);
      setEditingRowKey(null);
    } catch (e) {
      alert('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRowKey(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try { await onSyncVendors(); } finally { setSyncing(false); }
  };

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-amber-600" />
          <h3 className="text-base font-semibold text-gray-800">Needs Mapping</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-800 border border-amber-200">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            {total > 0 && <span className="ml-1">· {fmtMoney(total)}</span>}
          </span>
        </div>
        <span className="text-xs text-gray-500">Fix inline — the row moves to Ready on save.</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Every approved invoice and every event has a QB vendor mapping. Nice.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(r => {
            const meta = reasonMeta(r.reason);
            const isEditing = editingRowKey === r.rowKey;
            const isSaving = savingRowKey === r.rowKey;
            return (
              <li key={r.rowKey} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{r.contractorName}</span>
                      {r.invoiceNumber && <span className="text-xs text-gray-500 font-mono">{r.invoiceNumber}</span>}
                      <span className="text-xs text-gray-500">{r.monthLabel}</span>
                      <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ' + meta.cls}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{meta.detail}</div>
                    {r.ppLabel && (
                      <div className="text-[10px] text-gray-400 mt-0.5">Profile: <span className="font-mono">{r.ppLabel}</span></div>
                    )}
                    {r.ppQbVendorName && (
                      <div className="text-[10px] text-gray-400 mt-0.5">Listed QB vendor: <span className="font-mono">{r.ppQbVendorName}</span></div>
                    )}
                  </div>
                  <div className="font-mono font-semibold text-sm text-gray-800 whitespace-nowrap">
                    {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                  </div>
                </div>

                <div className="mt-2">
                  {(r.reason === 'event_needs_vendor' || r.reason === 'invoice_pp_no_qb_vendor') && (
                    isEditing ? (
                      <InlineVendorPicker
                        initialValue=""
                        vendors={vendors}
                        candidates={r.candidates}
                        saving={isSaving}
                        onSave={args => r.reason === 'event_needs_vendor'
                          ? handleSaveEventMapping(r, args)
                          : handleSaveVendorName(r, args)}
                        onCancel={() => setEditingRowKey(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setEditingRowKey(r.rowKey)}
                          className="text-xs px-2 py-1 border border-amber-300 text-amber-800 rounded hover:bg-amber-50"
                        >
                          Pick QB vendor
                        </button>
                        {r.candidates.length > 0 && (
                          <>
                            <span className="text-[10px] uppercase text-gray-400">Suggested:</span>
                            {r.candidates.slice(0, 3).map((c: Candidate) => (
                              <button
                                key={c.qbVendorListId}
                                onClick={async () => {
                                  setEditingRowKey(r.rowKey);
                                  if (r.reason === 'event_needs_vendor') {
                                    await handleSaveEventMapping(r, { qbVendorListId: c.qbVendorListId, qbVendorName: c.qbVendorName });
                                  } else {
                                    await handleSaveVendorName(r, { qbVendorName: c.qbVendorName });
                                  }
                                }}
                                className={'px-2 py-0.5 text-[11px] rounded-full border cursor-pointer ' + confidenceChipClass(c.confidence)}
                                title={`${c.reason} · ${c.confidence}`}
                              >
                                {c.qbVendorName}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )
                  )}
                  {r.reason === 'invoice_pp_vendor_not_synced' && (
                    <button
                      onClick={() => void handleSync()}
                      disabled={syncing}
                      className="text-xs px-2 py-1 border border-amber-300 text-amber-800 rounded hover:bg-amber-50 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw className={'w-3 h-3 ' + (syncing ? 'animate-spin' : '')} />
                      {syncing ? 'Enqueueing…' : 'Sync Vendors'}
                    </button>
                  )}
                  {r.reason === 'invoice_no_pp' && r.invoiceId != null && (
                    <button
                      onClick={() => onOpenInvoiceModal(r.invoiceId!)}
                      className="text-xs px-2 py-1 border border-red-300 text-red-800 rounded hover:bg-red-50 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Open invoice
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
