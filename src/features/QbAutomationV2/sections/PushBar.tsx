interface Props {
  count: number;
  total: number;
  onPush: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PushBar({ count, total, onPush }: Props) {
  const disabled = count === 0;
  return (
    <button
      onClick={onPush}
      disabled={disabled}
      className={
        'px-4 py-2 text-sm font-medium rounded transition ' +
        (disabled
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm')
      }
      title={disabled ? 'Select rows in Ready to Push' : `Push ${count} rows`}
    >
      {disabled
        ? 'Push Selected'
        : `Push ${count} ${count === 1 ? 'item' : 'items'} · ${fmtMoney(total)}`}
    </button>
  );
}
