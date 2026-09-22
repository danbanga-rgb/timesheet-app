import { useEffect, useMemo, useState } from 'react';
import { UploadCloud, Inbox, ListChecks } from 'lucide-react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbVendorMapping, UserProfile } from '../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../lib/qbStateSync/types';
import type { PushRecord } from '../../components/QbPushStatusPane';
import type { SupabaseClient } from '@supabase/supabase-js';
import QbPushStatusPane from '../../components/QbPushStatusPane';
import { useQbAutomationV2 } from './hooks/useQbAutomationV2';
import KpiStrip, { type CategoryKey } from './sections/KpiStrip';
import ReadyCard from './sections/ReadyCard';
import NeedsMappingCard, { type SaveMappingArgs } from './sections/NeedsMappingCard';
import PushBar from './sections/PushBar';
import VendorMappingSubTab from './sections/VendorMappingSubTab';
import PushPreviewModal from './sections/PushPreviewModal';

export interface PushRowsArgs {
  eventIds: number[];
  invoiceIds: number[];
}

export interface PushRowsResult {
  pushed: number;
  rejected: number;
  skippedDuplicate: number;
  skippedIneligible: number;
  alerts?: string[];
}

export interface QbAutomationV2Props {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
  paymentProfiles: PaymentProfile[];
  users: UserProfile[];
  mappings: QbVendorMapping[];
  pushRecords: PushRecord[];
  supabase: SupabaseClient;
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
  onUpdateMappingVendor: (args: { mappingId: number; qbVendorListId: string; qbVendorName: string }) => Promise<void>;
  onDeleteMapping: (mappingId: number) => Promise<void>;
  onMappingChangeSubscribe: (cb: () => void) => () => void;
  onPushRows: (args: PushRowsArgs) => Promise<PushRowsResult>;
  onDismissPushRecord: (eventId: number) => void;
}

type SubTab = 'inbox' | 'mapping';

export default function QbAutomationV2(props: QbAutomationV2Props) {
  const {
    readyRows,
    skippedRows,
    needsMappingRows,
    mappingRows,
    payCount,
    createCount,
    payTotal,
    createTotal,
    selectedKeys,
    selectionCount,
    selectionTotal,
    readyTotal,
    toggle,
    selectAll,
    selectGroup,
    clearSelection,
    skip,
    unskip,
  } = useQbAutomationV2(props);

  const [subTab, setSubTab] = useState<SubTab>('inbox');
  const [category, setCategory] = useState<CategoryKey>('ready');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    const unsubscribe = props.onMappingChangeSubscribe(() => {});
    return unsubscribe;
  }, [props.onMappingChangeSubscribe]);

  const selectedRows = useMemo(
    () => readyRows.filter(r => selectedKeys.has(r.rowKey)),
    [readyRows, selectedKeys],
  );

  const handlePushSelected = () => {
    if (selectedRows.length === 0) return;
    setPreviewOpen(true);
  };

  const handleConfirmPush = async () => {
    if (selectedRows.length === 0) return;
    setPushing(true);
    try {
      const eventIds: number[] = [];
      const invoiceIds: number[] = [];
      for (const r of selectedRows) {
        if (r.eventId != null) eventIds.push(r.eventId);
        else if (r.invoiceId != null) invoiceIds.push(r.invoiceId);
      }
      const result = await props.onPushRows({ eventIds, invoiceIds });
      const parts: string[] = [];
      if (result.pushed > 0) parts.push(`${result.pushed} jobs enqueued`);
      if (result.rejected > 0) parts.push(`${result.rejected} rejected`);
      if (result.skippedDuplicate > 0) parts.push(`${result.skippedDuplicate} duplicate-skipped`);
      if (result.skippedIneligible > 0) parts.push(`${result.skippedIneligible} ineligible`);
      alert(parts.length > 0 ? parts.join(' · ') : 'Push complete.');
      clearSelection();
      setPreviewOpen(false);
      setCategory('ready');
    } catch (e) {
      alert('Push failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPushing(false);
    }
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
            <p className="text-xs text-gray-500">Admin preview · Slice V8 (push flow + preview)</p>
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
              selectedKeys={selectedKeys}
              selectionCount={selectionCount}
              onToggle={toggle}
              onSelectAll={selectAll}
              onSelectGroup={selectGroup}
              onClearSelection={clearSelection}
              onSkip={skip}
              onUnskip={unskip}
              vendors={props.vendors}
              onSaveMapping={props.onSaveMapping}
              payCount={payCount}
              createCount={createCount}
              payTotal={payTotal}
              createTotal={createTotal}
            />
          )}

          <QbPushStatusPane
            supabase={props.supabase}
            records={props.pushRecords}
            onDismiss={props.onDismissPushRecord}
          />
        </>
      )}

      {subTab === 'mapping' && (
        <VendorMappingSubTab
          rows={mappingRows}
          vendors={props.vendors}
          events={props.events}
          invoices={props.invoices}
          onUpdateVendor={props.onUpdateMappingVendor}
          onDelete={props.onDeleteMapping}
          onAddLikeNeeds={props.onSaveMapping}
        />
      )}

      {previewOpen && (
        <PushPreviewModal
          rows={selectedRows}
          busy={pushing}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={handleConfirmPush}
        />
      )}
    </div>
  );
}
