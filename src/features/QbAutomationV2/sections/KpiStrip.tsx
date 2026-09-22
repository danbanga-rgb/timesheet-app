export type CategoryKey = 'ready' | 'needs_mapping' | 'skipped' | 'pushed_today';

interface Props {
  active: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  readyCount: number;
  readyTotal: number;
  skippedCount: number;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface CardProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  headBg: string;
  headText: string;
  numText: string;
  border: string;
  activeRing: string;
  label: string;
  value: React.ReactNode;
  secondary?: React.ReactNode;
}

function KpiCard(p: CardProps) {
  const base = 'rounded-lg border p-3 text-left transition ' + p.border + ' ' + p.headBg;
  const stateCls = p.disabled
    ? 'opacity-60 cursor-not-allowed'
    : p.active
      ? `ring-2 ring-offset-1 ${p.activeRing} shadow-sm`
      : 'hover:shadow-sm cursor-pointer';
  return (
    <button type="button" onClick={p.disabled ? undefined : p.onClick} className={base + ' ' + stateCls} disabled={p.disabled}>
      <div className={'text-xs uppercase font-semibold ' + p.headText}>{p.label}</div>
      <div className={'text-2xl font-bold ' + p.numText}>{p.value}</div>
      {p.secondary && <div className={'text-xs mt-1 ' + p.headText}>{p.secondary}</div>}
    </button>
  );
}

export default function KpiStrip({ active, onSelect, readyCount, readyTotal, skippedCount }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        active={active === 'ready'}
        onClick={() => onSelect('ready')}
        headBg="bg-emerald-50"
        headText="text-emerald-700"
        numText="text-emerald-900"
        border="border-emerald-200"
        activeRing="ring-emerald-400"
        label="Ready to Push"
        value={readyCount}
        secondary={readyTotal > 0 ? fmtMoney(readyTotal) : null}
      />
      <KpiCard
        active={false}
        disabled
        onClick={() => {}}
        headBg="bg-amber-50"
        headText="text-amber-700"
        numText="text-amber-900"
        border="border-amber-200"
        activeRing="ring-amber-400"
        label="Needs Mapping"
        value={<span className="text-amber-400">—</span>}
        secondary="lands in Slice V4"
      />
      <KpiCard
        active={active === 'skipped'}
        disabled={skippedCount === 0}
        onClick={() => onSelect('skipped')}
        headBg="bg-gray-50"
        headText="text-gray-600"
        numText="text-gray-800"
        border="border-gray-200"
        activeRing="ring-gray-400"
        label="Skipped"
        value={skippedCount}
        secondary={skippedCount === 0 ? 'session-scoped' : 'click to view'}
      />
      <KpiCard
        active={false}
        disabled
        onClick={() => {}}
        headBg="bg-indigo-50"
        headText="text-indigo-700"
        numText="text-indigo-900"
        border="border-indigo-200"
        activeRing="ring-indigo-400"
        label="Pushed today"
        value={<span className="text-indigo-400">—</span>}
        secondary="lands in Slice V9"
      />
    </div>
  );
}
