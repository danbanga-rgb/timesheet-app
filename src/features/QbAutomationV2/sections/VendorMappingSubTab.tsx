import { useMemo, useState } from 'react';
import type { QbIngestEvent } from '../../../types';
import { sourceLabel, type MappingRow } from '../hooks/useQbAutomationV2';
import { useColumnPrefs, type OptionalColumn } from '../hooks/useColumnPrefs';
import ColumnPicker from './ColumnPicker';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { SaveMappingArgs } from './NeedsMappingCard';
import BillsRoutedModal from './BillsRoutedModal';

type ExtraKey = 'source' | 'lastPosted';
type SortKey = 'contractor' | 'pp' | 'vendor' | 'bills' | ExtraKey;

// V9.10: optional columns, off by default.
const EXTRA_COLUMNS: readonly OptionalColumn<ExtraKey>[] = [
  { key: 'source',     label: 'Source' },
  { key: 'lastPosted', label: 'Last posted' },
];
type SortDir = 'asc' | 'desc';

interface Props {
  rows: MappingRow[];
  vendors: QbVendorRow[];
  events: QbIngestEvent[];
  onUpdateVendor: (args: { mappingId: number; qbVendorListId: string; qbVendorName: string }) => Promise<void>;
  onDelete: (mappingId: number) => Promise<void>;
  onAddLikeNeeds: (args: SaveMappingArgs) => Promise<void>;   // future — currently unused; kept for API symmetry
}

export default function VendorMappingSubTab({ rows, vendors, events, onUpdateVendor, onDelete }: Props) {
  const [inspecting, setInspecting] = useState<{ listId: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('contractor');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const columnPrefs = useColumnPrefs<ExtraKey>('mappings', EXTRA_COLUMNS);
  const extras = EXTRA_COLUMNS.filter(c => columnPrefs.isOn(c.key));

  const vendorByLowerName = useMemo(() => new Map(vendors.map(v => [v.name.toLowerCase().trim(), v])), [vendors]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r =>
          r.contractorName.toLowerCase().includes(q)
          || r.ppLabel.toLowerCase().includes(q)
          || r.qbVendorName.toLowerCase().includes(q))
      : rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'contractor': return a.contractorName.localeCompare(b.contractorName) * dir;
        case 'pp':         return a.ppLabel.localeCompare(b.ppLabel) * dir;
        case 'vendor':     return a.qbVendorName.localeCompare(b.qbVendorName) * dir;
        case 'bills':      return (a.billsPushedCount - b.billsPushedCount) * dir;
        case 'source':     return sourceLabel(a.source).localeCompare(sourceLabel(b.source)) * dir;
        case 'lastPosted': return (a.lastPostedDate || '').localeCompare(b.lastPostedDate || '') * dir;
      }
    });
    return sorted;
  }, [rows, search, sortKey, sortDir]);

  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortArrow = (key: SortKey) => sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';

  const startEdit = (row: MappingRow) => {
    setEditingId(row.mappingId);
    setEditValue(row.qbVendorName === '(vendor not in mirror)' ? '' : row.qbVendorName);
  };
  const cancelEdit = () => { setEditingId(null); setEditValue(''); };
  const saveEdit = async (row: MappingRow) => {
    const name = editValue.trim();
    if (!name) { alert('Pick a QB vendor name.'); return; }
    const vendor = vendorByLowerName.get(name.toLowerCase());
    if (!vendor) { alert(`No QB vendor found matching "${name}".`); return; }
    setBusyId(row.mappingId);
    try {
      await onUpdateVendor({ mappingId: row.mappingId, qbVendorListId: vendor.listId, qbVendorName: vendor.name });
      cancelEdit();
    } catch (e) {
      alert('Failed to update: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: MappingRow) => {
    if (!confirm(`Delete mapping for ${row.contractorName}? Future invoices from this payment profile will need re-mapping.`)) return;
    setBusyId(row.mappingId);
    try {
      await onDelete(row.mappingId);
    } catch (e) {
      alert('Failed to delete: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-800">Vendor Mapping</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 border border-gray-200">
            {filteredSorted.length} {search ? `of ${rows.length}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
        <ColumnPicker columns={EXTRA_COLUMNS} isOn={columnPrefs.isOn} onToggle={columnPrefs.toggle} onReset={columnPrefs.reset} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search contractor, profile, vendor…"
          className="px-3 py-1.5 text-xs border border-gray-300 rounded w-64 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
        </div>
      </div>

      {filteredSorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          {rows.length === 0 ? "No mappings yet. They're created when you fix rows in Needs Mapping." : 'No mappings match your search.'}
        </div>
      ) : (
        <div className="overflow-auto">
          <datalist id="qbautov2-mapping-vendors">
            {vendors.map(v => <option key={v.listId} value={v.name} />)}
          </datalist>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer" onClick={() => clickSort('contractor')}>
                  Contractor{sortArrow('contractor')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer" onClick={() => clickSort('pp')}>
                  Payment Profile{sortArrow('pp')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer" onClick={() => clickSort('vendor')} style={{ minWidth: 240 }}>
                  QB Vendor{sortArrow('vendor')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => clickSort('bills')}>
                  Bills pushed{sortArrow('bills')}
                </th>
                {extras.map(c => (
                  <th key={c.key} className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer whitespace-nowrap" onClick={() => clickSort(c.key)}>
                    {c.label}{sortArrow(c.key)}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold text-gray-600 w-40">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSorted.map(row => {
                const isEditing = editingId === row.mappingId;
                const isBusy = busyId === row.mappingId;
                return (
                  <tr key={row.mappingId} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">
                      {row.contractorName}
                      {row.isLegacy && <span className="ml-2 text-[10px] text-gray-400">legacy</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">{row.ppLabel}</td>
                    <td className="px-2 py-1.5">
                      {isEditing ? (
                        <input
                          type="text"
                          list="qbautov2-mapping-vendors"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          placeholder="Type or pick..."
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          autoFocus
                          disabled={isBusy}
                        />
                      ) : (
                        <span className={row.qbVendorName === '(vendor not in mirror)' ? 'text-amber-600 italic' : ''}>
                          {row.qbVendorName}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {row.billsPushedCount > 0 && row.qbVendorListId ? (
                        <button
                          onClick={() => setInspecting({ listId: row.qbVendorListId, name: row.qbVendorName })}
                          className="font-mono text-blue-600 hover:underline"
                          title="See these bills"
                        >
                          {row.billsPushedCount}
                        </button>
                      ) : (
                        <span className="font-mono text-gray-400">{row.billsPushedCount}</span>
                      )}
                    </td>
                    {extras.map(c => (
                      <td key={c.key} className="px-2 py-1.5 whitespace-nowrap">
                        {c.key === 'source'
                          ? <span className="inline-block px-1 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 font-medium">{sourceLabel(row.source)}</span>
                          : row.lastPostedDate
                            ? <span className="font-mono text-gray-600">{row.lastPostedDate}</span>
                            : <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveEdit(row)}
                            disabled={isBusy}
                            className="text-xs text-emerald-700 hover:underline font-semibold mr-3"
                          >
                            {isBusy ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} disabled={isBusy} className="text-xs text-gray-500 hover:underline">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(row)}
                            disabled={isBusy}
                            className="text-xs text-blue-600 hover:underline mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(row)}
                            disabled={isBusy}
                            className="text-xs text-gray-500 hover:text-red-700 hover:underline"
                          >
                            {isBusy ? 'Deleting…' : 'Delete'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {inspecting && (
        <BillsRoutedModal
          qbVendorListId={inspecting.listId}
          qbVendorName={inspecting.name}
          events={events}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
