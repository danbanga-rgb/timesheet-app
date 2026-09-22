import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import type { Invoice, QbIngestEvent } from '../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../lib/qbStateSync/types';
import { useQbAutomationV2 } from './hooks/useQbAutomationV2';
import KpiStrip, { type CategoryKey } from './sections/KpiStrip';
import ReadyCard from './sections/ReadyCard';
import NeedsMappingCard, { type SaveMappingArgs } from './sections/NeedsMappingCard';
import PushBar from './sections/PushBar';

export interface QbAutomationV2Props {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
}

export default function QbAutomationV2(props: QbAutomationV2Props) {
  const {
    readyRows,
    skippedRows,
    needsMappingRows,
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

  const [category, setCategory] = useState<CategoryKey>('ready');

  const handlePushSelected = () => {
    alert('Push flow lands in Slice V8. This is the current skeleton — selection + preview only.');
    // After push (V8 will wire this for real): snap back to Ready so newly-
    // resolved sibling events are visible in the same view.
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
            <p className="text-xs text-gray-500">Admin preview · Slice V4 (Ready + Needs Mapping)</p>
          </div>
        </div>
        <PushBar count={selectionCount} total={selectionTotal} onPush={handlePushSelected} />
      </div>

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
    </div>
  );
}
