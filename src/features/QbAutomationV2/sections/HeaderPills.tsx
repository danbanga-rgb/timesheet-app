import { Loader2, RefreshCw } from 'lucide-react';
import type { PillState } from '../hooks/useQbSyncState';

interface Props {
  mirror: PillState;
  vendors: PillState;
  qbwc: PillState;
  totalPending: number;                    // sum across bill_query + vendor_query
  onSyncNow: () => void;                   // fires both bill_query + vendor_query (silent)
  onOpenPendingInspector: () => void;      // only relevant when totalPending > 0
}

// Status → tailwind classes. Pills are status-only (not clickable).
const STATUS_CLASSES: Record<PillState['status'], string> = {
  green:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  red:     'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-gray-50 text-gray-600 border-gray-200',
};

function Pill({ pill }: { pill: PillState }) {
  const cls = STATUS_CLASSES[pill.status];
  const title = pill.kind === 'qbwc'
    ? 'QBWC is the Windows connector on the accountant\'s laptop. If red, start QBWC there.'
    : `Freshness of the ${pill.kind} mirror snapshot.`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-full border ${cls}`}
      title={title}
    >
      {pill.label}
    </span>
  );
}

export default function HeaderPills({ mirror, vendors, qbwc, totalPending, onSyncNow, onOpenPendingInspector }: Props) {
  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <Pill pill={mirror} />
      <Pill pill={vendors} />
      <Pill pill={qbwc} />
      <button
        type="button"
        onClick={onSyncNow}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
        title="Enqueue a fresh bill + vendor query. Drains via QBWC in ~15 min."
      >
        <RefreshCw className="w-3 h-3" /> Sync Now
      </button>
      {totalPending > 0 && (
        <button
          type="button"
          onClick={onOpenPendingInspector}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
          title={`${totalPending} sync job${totalPending === 1 ? '' : 's'} draining via QBWC. Click to inspect.`}
        >
          <Loader2 className="w-3 h-3 animate-spin" /> {totalPending} pending
        </button>
      )}
    </div>
  );
}
