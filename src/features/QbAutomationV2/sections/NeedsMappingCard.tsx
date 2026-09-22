import { useState } from 'react';
import type { NeedsMappingRow } from '../hooks/useQbAutomationV2';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { Candidate, Confidence } from '../../../lib/qbAutomation/vendorMappingResolver';

export interface SaveMappingArgs {
  // null when saving from a Ready row that has no event (invoice-driven rows
  // in the "will_create_bill" verdict). Wrapper handler skips the event-flip
  // step in that case; the mapping upsert still runs and future events
  // pick up the new vendor via classifier.
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

function tierLabel(tier: Candidate['tier']): string {
  return tier === 'history' ? 'history' : 'match';
}

export default function NeedsMappingCard({ rows, vendors, onSaveMapping }: Props) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Set<number>>(new Set());

  const vendorByLowerName = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));

  const handleSave = async (row: NeedsMappingRow) => {
    const name = (picked[row.eventId] ?? '').trim();
    if (!name) return;
    const vendor = vendorByLowerName.get(name.toLowerCase());
    if (!vendor) {
      alert(`No QB vendor found matching "${name}". Pick from the suggestions or Sync Vendors first.`);
      return;
    }
    setSaving(prev => new Set(prev).add(row.eventId));
    try {
      await onSaveMapping({
        eventId: row.eventId,
        ppId: row.ppId,
        source: row.source,
        counterpartyPattern: row.counterpartyRaw,
        qbVendorListId: vendor.listId,
        qbVendorName: vendor.name,
      });
    } catch (e) {
      console.error('saveMapping failed', e);
      alert('Failed to save mapping: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(prev => {
        const next = new Set(prev);
        next.delete(row.eventId);
        return next;
      });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-800">Needs Vendor Mapping</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <span className="text-xs text-gray-500">Pick a QB vendor to map by payment profile</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Every event with a payment profile has a QB vendor mapping. Nice.
        </div>
      ) : (
        <div className="overflow-auto">
          <datalist id="qbautov2-vendors">
            {vendors.map(v => <option key={v.listId} value={v.name} />)}
          </datalist>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Contractor</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Period</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Payment Profile</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600" style={{ minWidth: 320 }}>QB Vendor</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600">Total</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 w-32">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const isSaving = saving.has(r.eventId);
                const value = picked[r.eventId] ?? '';
                const canSave = value.trim().length > 0 && !isSaving;
                return (
                  <tr key={r.eventId} className="hover:bg-gray-50 align-top">
                    <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{r.contractorName}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{r.monthLabel || '(no period)'}</td>
                    <td className="px-2 py-1.5 text-gray-700">{r.ppLabel}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        list="qbautov2-vendors"
                        value={value}
                        onChange={e => setPicked(prev => ({ ...prev, [r.eventId]: e.target.value }))}
                        placeholder="Type or pick a QB vendor..."
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        disabled={isSaving}
                      />
                      {r.candidates.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                          <span className="text-[10px] uppercase text-gray-400 mr-1">Suggested:</span>
                          {r.candidates.map(c => (
                            <button
                              key={c.qbVendorListId}
                              type="button"
                              onClick={() => setPicked(prev => ({ ...prev, [r.eventId]: c.qbVendorName }))}
                              className={
                                'px-2 py-0.5 text-[11px] rounded-full border cursor-pointer ' + confidenceChipClass(c.confidence)
                              }
                              title={`${c.reason} · ${c.confidence} (${tierLabel(c.tier)})`}
                            >
                              {c.qbVendorName}
                              <span className="ml-1 opacity-70 text-[10px]">{c.confidence}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold whitespace-nowrap">
                      {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleSave(r)}
                        disabled={!canSave}
                        className={
                          'px-2.5 py-1 text-xs font-medium rounded ' +
                          (canSave
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed')
                        }
                      >
                        {isSaving ? 'Saving…' : 'Map & Send to Ready'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
