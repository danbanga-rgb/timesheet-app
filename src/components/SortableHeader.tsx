import type { ReactNode } from 'react';

// Clickable table header with a sort-direction indicator slot. Standardizes
// the cursor-pointer + hover + select-none class churn across sortable
// column headers. Consumers pass their own indicator content (usually
// derived from the column's active/direction state) so styles can vary
// per-tab (arrows, chevrons, lucide icons).
//
// Extracted as Slice B4 of the accountant modularization arc (2026-09-16).

export interface SortableHeaderProps {
  onClick: () => void;
  children: ReactNode;
  /** Indicator content appended after children (e.g. arrow or chevron). */
  indicator?: ReactNode;
  className?: string;
  /** Tailwind hover class applied on the row. Default 'hover:bg-gray-100'. */
  hoverClass?: string;
  align?: 'left' | 'center' | 'right';
}

export default function SortableHeader({
  onClick,
  children,
  indicator,
  className,
  hoverClass = 'hover:bg-gray-100',
  align = 'left',
}: SortableHeaderProps) {
  const alignCls = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      onClick={onClick}
      className={`${alignCls} cursor-pointer select-none ${hoverClass} ${className ?? ''}`.trim()}
    >
      {children}{indicator}
    </th>
  );
}
