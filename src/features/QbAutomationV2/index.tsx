import { UploadCloud } from 'lucide-react';
import type { Invoice, QbIngestEvent } from '../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../lib/qbStateSync/types';
import { useQbAutomationV2 } from './hooks/useQbAutomationV2';
import ReadyCard from './sections/ReadyCard';

export interface QbAutomationV2Props {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
}

export default function QbAutomationV2(props: QbAutomationV2Props) {
  const { readyRows, selectedIds, selectionCount, selectionTotal, toggle, selectAll, clearSelection } =
    useQbAutomationV2(props);

  const handlePushSelected = () => {
    alert('Push flow lands in Slice V8. This is the V3 skeleton — selection + preview only.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50">
          <UploadCloud className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">QB Automation v2</h2>
          <p className="text-xs text-gray-500">Admin preview · Slice V3 (Ready card)</p>
        </div>
      </div>

      <ReadyCard
        rows={readyRows}
        selectedIds={selectedIds}
        selectionCount={selectionCount}
        selectionTotal={selectionTotal}
        onToggle={toggle}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onPushSelected={handlePushSelected}
      />
    </div>
  );
}
