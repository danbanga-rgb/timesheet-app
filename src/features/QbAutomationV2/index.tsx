import { useEffect, useMemo, useState } from 'react';
import { UploadCloud, Inbox, ListChecks, RefreshCw, X } from 'lucide-react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbVendorMapping, UserProfile } from '../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../lib/qbStateSync/types';
import type { PushRecord } from '../../components/QbPushStatusPane';
import type { SupabaseClient } from '@supabase/supabase-js';
import QbPushStatusPane from '../../components/QbPushStatusPane';
import { cancelPushJobs } from '../../lib/qbAutomation/cancelPushJobs';
import { useQbAutomationV2 } from './hooks/useQbAutomationV2';
import KpiStrip, { type CategoryKey } from './sections/KpiStrip';
import ReadyCard from './sections/ReadyCard';
import NeedsMappingCard, { type SaveMappingArgs } from './sections/NeedsMappingCard';
import PushBar from './sections/PushBar';
import VendorMappingSubTab from './sections/VendorMappingSubTab';
import PushPreviewModal from './sections/PushPreviewModal';
import PushedTodayCard from './sections/PushedTodayCard';

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
  /** V9.5: per-invoice share for umbrella wires, keyed by `${eventId}::${invoiceId}`.
   *  Passed straight into `useQbAutomationV2` for sub-row rendering. Empty
   *  map is safe — children fall back to invoice total with a warning marker. */
  umbrellaShares?: Map<string, number>;
  pushRecords: PushRecord[];
  supabase: SupabaseClient;
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;
  onUpdateMappingVendor: (args: { mappingId: number; qbVendorListId: string; qbVendorName: string }) => Promise<void>;
  onDeleteMapping: (mappingId: number) => Promise<void>;
  onMappingChangeSubscribe: (cb: () => void) => () => void;
  onPushRows: (args: PushRowsArgs) => Promise<PushRowsResult>;
  onDismissPushRecord: (eventId: number) => void;
  onSyncVendors: () => Promise<void>;
  /** Fire-and-forget silent vendor_query enqueue. Called after a successful
   *  push so any newly-classified rows have a fresh mirror once QBWC drains
   *  (~15 min). Errors are swallowed; the hint bar tells the user to refresh
   *  later. */
  onPostPushSync: () => Promise<void>;
  /** Reload events + open bills from Supabase. Called by the post-push hint's
   *  Refresh button when the user comes back after QBWC drain. */
  onRefreshInbox: () => Promise<void>;
}

type SubTab = 'inbox' | 'mapping';

export default function QbAutomationV2(props: QbAutomationV2Props) {
  const {
    readyRows,
    skippedRows,
    needsMappingRows,
    mappingRows,
    pushedTodayRows,
    pushedTodayTotal,
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
  const [showPostPushHint, setShowPostPushHint] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      // Item 5: fire silent Sync Vendors so QBWC picks up any missing vendors
      // during its next drain (~15 min); when the user returns, the hint bar
      // Refresh button pulls the freshly-classified rows into Ready.
      void props.onPostPushSync();
      setShowPostPushHint(true);
    } catch (e) {
      alert('Push failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPushing(false);
    }
  };

  const handleRefreshInbox = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await props.onRefreshInbox();
      setShowPostPushHint(false);
    } finally {
      setRefreshing(false);
    }
  };

  const showNeedsMapping = category === 'needs_mapping';
  const showReadyOrSkipped = category === 'ready' || category === 'skipped';
  const showPushedToday = category === 'pushed_today';
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
          {showPostPushHint && (
            <div className="border border-indigo-200 rounded-lg bg-indigo-50/40 px-4 py-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-indigo-900">
                Vendor sync is running in the background (~15 min). Refresh once QBWC drains to pick up any newly-resolved rows.
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => void handleRefreshInbox()}
                  disabled={refreshing}
                  className="text-xs font-medium px-2 py-1 border border-indigo-300 text-indigo-800 rounded hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button
                  onClick={() => setShowPostPushHint(false)}
                  className="text-indigo-400 hover:text-indigo-700"
                  aria-label="Dismiss hint"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <KpiStrip
            active={category}
            onSelect={setCategory}
            readyCount={readyRows.length}
            readyTotal={readyTotal}
            needsMappingCount={needsMappingRows.length}
            skippedCount={skippedRows.length}
            pushedTodayCount={pushedTodayRows.length}
            pushedTodayTotal={pushedTodayTotal}
          />

          {showNeedsMapping && (
            <NeedsMappingCard
              rows={needsMappingRows}
              vendors={props.vendors}
              onSaveMapping={props.onSaveMapping}
            />
          )}

          {showPushedToday && (
            <PushedTodayCard rows={pushedTodayRows} total={pushedTodayTotal} />
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
            onCancel={targets => cancelPushJobs({ supabase: props.supabase, records: targets })}
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
          vendors={props.vendors}
          onSaveMapping={props.onSaveMapping}
          onSyncVendors={props.onSyncVendors}
          busy={pushing}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={handleConfirmPush}
        />
      )}
    </div>
  );
}
