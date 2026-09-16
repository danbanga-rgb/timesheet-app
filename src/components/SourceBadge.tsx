import type { ReactNode } from 'react';

// Portal (contractor typed in the app) vs Email (contractor emailed a
// timesheet PDF/XLSX that the poller ingested). Rendered as a colored pill
// in row-level tables.
//
// Extracted from the Weekly and Timesheet-Only tables as Slice T2 of the
// accountant modularization arc (2026-09-16).

export interface SourceBadgeProps {
  /** Matches Timesheet['source'] from src/types.ts. */
  source: 'direct' | 'imported' | null;
  /** Rendered when source is null / undefined / other. Default: em-dash. */
  fallback?: ReactNode;
}

export default function SourceBadge({ source, fallback }: SourceBadgeProps) {
  if (source === 'direct') {
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Portal</span>;
  }
  if (source === 'imported') {
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Email</span>;
  }
  return <>{fallback ?? <span className="text-gray-300">—</span>}</>;
}
