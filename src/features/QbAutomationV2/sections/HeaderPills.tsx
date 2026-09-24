import { Loader2 } from 'lucide-react';
import type { PillState } from '../hooks/useQbSyncState';

interface Props {
  mirror: PillState;
  vendors: PillState;
  qbwc: PillState;
  onMirrorClick: () => void;               // enqueue sync OR open inspector if pending
  onVendorsClick: () => void;
}

// Status → tailwind classes. Compact so tests can eyeball parity.
const STATUS_CLASSES: Record<PillState['status'], string> = {
  green:   'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  amber:   'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  red:     'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  unknown: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100',
};

function Pill({ pill, onClick }: { pill: PillState; onClick?: () => void }) {
  const cls = STATUS_CLASSES[pill.status];
  const cursor = pill.clickable ? 'cursor-pointer' : 'cursor-default';
  const isPending = pill.pendingCount > 0;
  const title = pill.clickable
    ? (isPending
        ? `${pill.pendingCount} sync job${pill.pendingCount === 1 ? '' : 's'} draining via QBWC (~15 min). Click to inspect.`
        : 'Click to enqueue a fresh sync (drains via QBWC in ~15 min).')
    : (pill.kind === 'qbwc'
        ? 'QBWC is the Windows connector on the accountant\'s laptop. This app can\'t start it — if red, start QBWC there.'
        : undefined);
  return (
    <button
      type="button"
      onClick={pill.clickable ? onClick : undefined}
      disabled={!pill.clickable}
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-full border ${cls} ${cursor} transition-colors`}
      title={title}
    >
      <span>{pill.label}</span>
      {isPending && (
        <span className="inline-flex items-center gap-0.5 text-[10px] opacity-75">
          <Loader2 className="w-3 h-3 animate-spin" />
          {pill.pendingCount}
        </span>
      )}
    </button>
  );
}

export default function HeaderPills({ mirror, vendors, qbwc, onMirrorClick, onVendorsClick }: Props) {
  return (
    <div className="inline-flex items-center gap-2">
      <Pill pill={mirror} onClick={onMirrorClick} />
      <Pill pill={vendors} onClick={onVendorsClick} />
      <Pill pill={qbwc} />
    </div>
  );
}
