import { useState } from 'react';
import { AlertOctagon, Clock, ExternalLink } from 'lucide-react';
import type { NeedsAttentionRow, NeedsAttentionReason } from '../hooks/useQbAutomationV2';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import InlineVendorPicker from './InlineVendorPicker';

interface Props {
  rows: NeedsAttentionRow[];
  vendors: QbVendorRow[];
  onSaveQbVendorName: (ppId: number, vendorName: string) => Promise<void>;
  onOpenInvoiceModal: (invoiceId: number) => void;
  onSyncVendors: () => Promise<void>;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reasonMeta(reason: NeedsAttentionReason) {
  switch (reason) {
    case 'waiting_for_wire':
      return { label: 'Awaiting Convera wire', cls: 'bg-blue-100 text-blue-800', icon: Clock,
        detail: 'Umbrella-vendor invoice. Will render as an umbrella group once the wire lands and classifies.' };
    case 'no_qb_vendor_on_pp':
      return { label: 'No QB Vendor on profile', cls: 'bg-orange-100 text-orange-800', icon: AlertOctagon,
        detail: "The contractor's payment profile has no QB Vendor set. Pick one below — the mapping will be created automatically." };
    case 'qb_vendor_not_in_mirror':
      return { label: 'QB Vendor not synced', cls: 'bg-amber-100 text-amber-800', icon: AlertOctagon,
        detail: 'The profile lists a QB vendor that is not in the local mirror. Run Sync Vendors, wait for QBWC to drain, then this row will heal automatically.' };
    case 'no_pp_on_invoice':
      return { label: 'No payment profile', cls: 'bg-red-100 text-red-800', icon: AlertOctagon,
        detail: 'This invoice has no payment profile snapshot. Open the invoice to link one (cross-contractor picker works for Faruk-covers-Ajdin cases).' };
  }
}

export default function NeedsAttentionCard(props: Props) {
  const { rows, vendors, onSaveQbVendorName, onOpenInvoiceModal, onSyncVendors } = props;
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const handleSaveVendor = async (row: NeedsAttentionRow, args: { qbVendorName: string }) => {
    if (row.ppId <= 0) return;
    setSavingRowKey(row.rowKey);
    try {
      await onSaveQbVendorName(row.ppId, args.qbVendorName);
      setEditingRowKey(null);
    } catch (e) {
      alert('Failed to save: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRowKey(null);
    }
  };

  const handleSyncVendors = async () => {
    setSyncing(true);
    try { await onSyncVendors(); } finally { setSyncing(false); }
  };

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-orange-600" />
          <h3 className="text-base font-semibold text-gray-800">Needs Attention</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-orange-50 text-orange-800 border border-orange-200">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            {total > 0 && <span className="ml-1">· {fmtMoney(total)}</span>}
          </span>
        </div>
        <span className="text-xs text-gray-500">Every filtered row lands here with an inline fix.</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Nothing needs attention. Every approved invoice is either Ready, mapped, or already pushed.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(r => {
            const meta = reasonMeta(r.reason);
            const Icon = meta.icon;
            return (
              <li key={r.rowKey} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{r.contractorName}</span>
                      <span className="text-xs text-gray-500 font-mono">{r.invoiceNumber || '(no invoice #)'}</span>
                      <span className="text-xs text-gray-500">{r.monthLabel || ''}</span>
                      <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ' + meta.cls}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{meta.detail}</div>
                    {r.currentVendorGuess && (
                      <div className="text-xs text-gray-500 mt-1">
                        Target vendor: <span className="font-mono">{r.currentVendorGuess}</span>
                      </div>
                    )}
                  </div>
                  <div className="font-mono font-semibold text-sm text-gray-800 whitespace-nowrap">
                    {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {r.reason === 'no_qb_vendor_on_pp' && (
                    editingRowKey === r.rowKey ? (
                      <InlineVendorPicker
                        initialValue=""
                        vendors={vendors}
                        candidates={[]}
                        saving={savingRowKey === r.rowKey}
                        onSave={args => handleSaveVendor(r, { qbVendorName: args.qbVendorName })}
                        onCancel={() => setEditingRowKey(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingRowKey(r.rowKey)}
                        className="text-xs px-2 py-1 border border-orange-300 text-orange-800 rounded hover:bg-orange-50"
                      >
                        Pick QB vendor
                      </button>
                    )
                  )}
                  {r.reason === 'qb_vendor_not_in_mirror' && (
                    <button
                      onClick={() => void handleSyncVendors()}
                      disabled={syncing}
                      className="text-xs px-2 py-1 border border-amber-300 text-amber-800 rounded hover:bg-amber-50 disabled:opacity-50"
                    >
                      {syncing ? 'Enqueueing…' : 'Sync Vendors'}
                    </button>
                  )}
                  {r.reason === 'no_pp_on_invoice' && (
                    <button
                      onClick={() => onOpenInvoiceModal(r.invoiceId)}
                      className="text-xs px-2 py-1 border border-red-300 text-red-800 rounded hover:bg-red-50 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Open invoice
                    </button>
                  )}
                  {r.reason === 'waiting_for_wire' && (
                    <button
                      onClick={() => onOpenInvoiceModal(r.invoiceId)}
                      className="text-xs px-2 py-1 border border-blue-300 text-blue-800 rounded hover:bg-blue-50 inline-flex items-center gap-1"
                      title="Open the invoice if you need to change routing before the wire lands"
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
