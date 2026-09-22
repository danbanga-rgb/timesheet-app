import { useEffect, useState } from 'react';
import { UploadCloud, Inbox, ListChecks } from 'lucide-react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbVendorMapping, UserProfile } from '../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../lib/qbStateSync/types';
import { useQbAutomationV2 } from './hooks/useQbAutomationV2';
import KpiStrip, { type CategoryKey } from './sections/KpiStrip';
import ReadyCard from './sections/ReadyCard';
import NeedsMappingCard, { type SaveMappingArgs } from './sections/NeedsMappingCard';
import PushBar from './sections/PushBar';
import VendorMappingSubTab from './sections/VendorMappingSubTab';

export interface QbAutomationV2Props {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
  paymentProfiles: PaymentProfile[];
  users: UserProfile[];
  mappings: QbVendorMapping[];
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
  onUpdateMappingVendor: (args: { mappingId: number; qbVendorListId: string; qbVendorName: string }) => Promise<void>;
  onDeleteMapping: (mappingId: number) => Promise<void>;
  onMappingChangeSubscribe: (cb: () => void) => () => void;   // returns unsubscribe
}

type SubTab = 'inbox' | 'mapping';

export default function QbAutomationV2(props: QbAutomationV2Props) {
  const {
    readyRows,
    skippedRows,
    needsMappingRows,
    mappingRows,
    selectedIds,
    selectionCount,
    selectionTotal,
    readyTotal,
    toggle,
    selectAll,
    clearSelection,
    skip,
    unskip,
  } = useQbAutomationV2(props);

  const [subTab, setSubTab] = useState<SubTab>('inbox');
  const [category, setCategory] = useState<CategoryKey>('ready');

  useEffect(() => {
    const unsubscribe = props.onMappingChangeSubscribe(() => {
      // Realtime hook fires when qb_vendor_mappings changes. Wrapper
      // reloads mappings + events; v2 re-renders from fresh props.
    });
    return unsubscribe;
  }, [props.onMappingChangeSubscribe]);

  const handlePushSelected = () => {
    alert('Push flow lands in Slice V8. This is the current skeleton — selection + preview only.');
    setCategory('ready');
  };

  const showNeedsMapping = category === 'needs_mapping';
  const showReadyOrSkipped = category === 'ready' || category === 'skipped';
  const rowsForReadyView = category === 'skipped' ? skippedRows : readyRows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50">
            <UploadCloud className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">QB Automation v2</h2>
            <p className="text-xs text-gray-500">Admin preview · Slice V5 (Vendor Mapping sub-tab)</p>
          </div>
        </div>
        {subTab === 'inbox' && <PushBar count={selectionCount} total={selectionTotal} onPush={handlePushSelected} />}
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setSubTab('inbox')}
          className={
            'px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-2 ' +
            (subTab === 'inbox'
              ? 'text-indigo-600 border-indigo-600'
              : 'text-gray-500 border-transparent hover:text-gray-700')
          }
        >
          <Inbox className="w-4 h-4" /> Push Inbox
        </button>
        <button
          onClick={() => setSubTab('mapping')}
          className={
            'px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-2 ' +
            (subTab === 'mapping'
              ? 'text-indigo-600 border-indigo-600'
              : 'text-gray-500 border-transparent hover:text-gray-700')
          }
        >
          <ListChecks className="w-4 h-4" /> Vendor Mapping
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{mappingRows.length}</span>
        </button>
      </div>

      {subTab === 'inbox' && (
        <>
          <KpiStrip
            active={category}
            onSelect={setCategory}
            readyCount={readyRows.length}
            readyTotal={readyTotal}
            needsMappingCount={needsMappingRows.length}
            skippedCount={skippedRows.length}
          />

          {showNeedsMapping && (
            <NeedsMappingCard
              rows={needsMappingRows}
              vendors={props.vendors}
              onSaveMapping={props.onSaveMapping}
            />
          )}

          {showReadyOrSkipped && (
            <ReadyCard
              category={category}
              rows={rowsForReadyView}
              selectedIds={selectedIds}
              selectionCount={selectionCount}
              onToggle={toggle}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onSkip={skip}
              onUnskip={unskip}
            />
          )}
        </>
      )}

      {subTab === 'mapping' && (
        <VendorMappingSubTab
          rows={mappingRows}
          vendors={props.vendors}
          onUpdateVendor={props.onUpdateMappingVendor}
          onDelete={props.onDeleteMapping}
          onAddLikeNeeds={props.onSaveMapping}
        />
      )}
    </div>
  );
}
