// VendorDecisionModal — Slice 2 of the vendor-resolution flow.
//
// Opens when an invoice can't be routed to a QB vendor unambiguously:
//  - The snapshot payment_profile has no qb_vendor_name.
//  - The contractor's OTHER pps don't unambiguously agree on one vendor.
//    (Marta pattern auto-resolves elsewhere; that path never opens this modal.)
//
// Two paths:
//  - Slice 2: pick an EXISTING QB vendor from the dropdown. Prefilled with
//    the sibling-vendor hint when one exists.
//  - Slice 4 (deferred): "Create new QB vendor" — currently grayed out with
//    a tooltip explaining it's coming.
//
// The modal writes payment_profiles.qb_vendor_name for the target pp and
// logs a manual_vendor_map entry to invoice.edit_history. The parent
// component supplies an optional afterResolve callback that re-runs the
// upstream flow (e.g., approval) once the vendor is set.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

export interface VendorDecisionModalProps {
  open: boolean;
  contractorName: string;
  invoiceNumber: string;
  invoiceAmount: number;
  invoicePeriodEnd: string | null;
  targetPaymentProfileCompany: string;
  targetPaymentProfileIban: string | null;
  siblingVendorHint?: string;
  conflictNames?: string[];
  qbVendors: Array<{ listId: string; name: string }>;
  onCancel: () => void;
  onConfirm: (vendorName: string) => Promise<void> | void;
}

export default function VendorDecisionModal(props: VendorDecisionModalProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [chosenVendor, setChosenVendor] = useState<string>(props.siblingVendorHint ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedVendors = useMemo(
    () => [...props.qbVendors].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [props.qbVendors],
  );

  if (!props.open) return null;

  const canConfirm = mode === 'existing' && chosenVendor.trim().length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    setError(null);
    try {
      await props.onConfirm(chosenVendor);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pick QuickBooks vendor</h2>
            <p className="text-sm text-gray-500 mt-1">
              This invoice's payment profile isn't linked to a QuickBooks vendor. Choose one so we can book the bill under the right vendor.
            </p>
          </div>
          <button
            onClick={() => { if (!saving) props.onCancel(); }}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            disabled={saving}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <div className="font-medium text-gray-900">{props.contractorName}</div>
            <div className="mt-0.5 text-xs text-gray-600">
              Invoice {props.invoiceNumber} · ${props.invoiceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {props.invoicePeriodEnd ? ` · period end ${props.invoicePeriodEnd}` : ''}
            </div>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="font-medium text-amber-900">Payment profile (needs vendor)</div>
            <div className="mt-0.5 text-xs text-amber-800">
              {props.targetPaymentProfileCompany || '(no company name)'}{props.targetPaymentProfileIban ? ` · IBAN ····${props.targetPaymentProfileIban.slice(-4)}` : ''}
            </div>
          </div>

          {props.conflictNames && props.conflictNames.length > 1 && (
            <div className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
              <div className="font-medium">Sibling profiles disagree.</div>
              <div className="text-xs mt-1">
                Other payment profiles for this contractor point at different QB vendors: {props.conflictNames.join(', ')}. Pick the one that applies to this specific invoice — or a different vendor entirely.
              </div>
            </div>
          )}

          {props.siblingVendorHint && !props.conflictNames && (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <div className="text-xs">
                Suggested: <strong>{props.siblingVendorHint}</strong> (from this contractor's other payment profiles). Preselected below — change if wrong.
              </div>
            </div>
          )}

          <fieldset className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="vendor-mode"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">Use an existing QuickBooks vendor</div>
                <select
                  value={chosenVendor}
                  onChange={e => setChosenVendor(e.target.value)}
                  disabled={mode !== 'existing' || saving}
                  className="mt-1.5 w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100"
                >
                  <option value="">— select vendor —</option>
                  {sortedVendors.map(v => (
                    <option key={v.listId} value={v.name}>{v.name}</option>
                  ))}
                </select>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-not-allowed opacity-50" title="Create-new-vendor flow ships in Slice 4.">
              <input type="radio" name="vendor-mode" disabled className="mt-1" />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">Create a new QuickBooks vendor</div>
                <div className="text-xs text-gray-500 mt-0.5">Coming soon. For now, if none of the existing vendors fit, ask the accountant to add the vendor in QuickBooks directly, then refresh.</div>
              </div>
            </label>
          </fieldset>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50">
          <button
            onClick={props.onCancel}
            disabled={saving}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {saving ? 'Saving…' : 'Confirm & save'}
          </button>
        </div>
      </div>
    </div>
  );
}
