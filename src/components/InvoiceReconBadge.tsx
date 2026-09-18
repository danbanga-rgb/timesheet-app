// Compact reconciliation badge used by the Invoices tab. Renders a
// stacked pill (status) + optional "TS: Nh" line + optional missing-weeks
// note. Extracted in Slice I6 (2026-09-17); previously duplicated across
// the reconCell helper and the group-header inline JSX.

export type ReconBadgeStatus = 'matched' | 'mismatch' | 'unverifiable';

export interface InvoiceReconBadgeProps {
  status: ReconBadgeStatus;
  delta: number | null;
  tsHours: number | null;
  missingText?: string | null;
  tooltip?: string;
  showTsHours?: boolean;
}

export default function InvoiceReconBadge({
  status,
  delta,
  tsHours,
  missingText,
  tooltip,
  showTsHours = true,
}: InvoiceReconBadgeProps) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={tooltip}>
      {status === 'matched' ? (
        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">✓ Matched</span>
      ) : status === 'mismatch' ? (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${delta != null && delta > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {delta != null ? (delta > 0 ? '▲ +' : '▽ ') + delta + 'h' : '⚠ Mismatch'}
        </span>
      ) : (
        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">? —</span>
      )}
      {showTsHours && tsHours != null && (
        <span className="text-gray-400 text-xs">TS: {tsHours}h</span>
      )}
      {missingText && (
        <span className="text-red-400 text-xs font-medium">{missingText}</span>
      )}
    </div>
  );
}
