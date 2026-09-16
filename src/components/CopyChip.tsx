import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';

// Click-to-copy button chip with a "copied" indicator swap. The caller owns
// the copied state (so a modal-wide "one at a time" UX can be enforced by
// pointing every chip's copied flag at the same shared string key). No
// internal timers — caller decides how long the "✓ copied" indicator stays
// visible.
//
// Extracted as Slice B6 of the accountant modularization arc (2026-09-16).
// Consumers: Convera Bene Create card (Payment Profiles tab), Intuit Batch
// modal (payee / invoice / amount chips).

export interface CopyChipProps {
  /** The value shown when NOT copied (usually the raw value being copied). */
  label: ReactNode;
  copied: boolean;
  onCopy: () => void;
  /** sm = font-mono text-[11px] px-1.5 py-0.5, md = text-sm px-2 py-1,
   *  font-mono variant of md uses font-mono at md size. Default 'md'. */
  size?: 'sm' | 'md';
  /** Default true — chip renders label in a monospace font. */
  monospace?: boolean;
  title?: string;
}

export default function CopyChip({
  label,
  copied,
  onCopy,
  size = 'md',
  monospace = false,
  title = 'Click to copy',
}: CopyChipProps) {
  const sizeCls = size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const monoCls = monospace ? 'font-mono' : '';
  const stateCls = copied
    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
    : 'bg-white border-gray-300 text-gray-700 hover:border-emerald-400 hover:bg-emerald-50';
  return (
    <button
      type="button"
      onClick={onCopy}
      title={title}
      className={`inline-flex items-center gap-1 ${monoCls} ${sizeCls} rounded border transition-colors align-baseline ${stateCls}`.trim()}
    >
      <Copy className={iconSize} />
      {copied ? '✓ copied' : label}
    </button>
  );
}
