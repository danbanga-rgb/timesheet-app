import type { ReactNode } from 'react';

// Generic colored-pill status badge. Callers pass a `tone` (color family)
// and children. Standardizes the tailwind class churn across the ~10
// status-pill sites in TS.tsx.
//
// Extracted as Slice A10 of the accountant modularization arc (2026-09-16).

export type BadgeTone =
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'gray'
  | 'purple'
  | 'teal'
  | 'amber'
  | 'indigo'
  | 'orange';

export type BadgeSize = 'sm' | 'md' | 'lg';

export interface StatusBadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  /** Default 'pill' (rounded-full). 'rounded' uses less curvature. */
  shape?: 'pill' | 'rounded';
  /** sm=px-1.5 py-0.5, md=px-2 py-1 (default), lg=px-3 py-1. */
  size?: BadgeSize;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  green:  'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red:    'bg-red-100 text-red-800',
  blue:   'bg-blue-100 text-blue-800',
  gray:   'bg-gray-100 text-gray-800',
  purple: 'bg-purple-100 text-purple-800',
  teal:   'bg-teal-100 text-teal-800',
  amber:  'bg-amber-100 text-amber-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  orange: 'bg-orange-100 text-orange-800',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5',
  md: 'px-2 py-1',
  lg: 'px-3 py-1',
};

export default function StatusBadge({ tone, children, shape = 'pill', size = 'md', className }: StatusBadgeProps) {
  const shapeCls = shape === 'pill' ? 'rounded-full' : 'rounded';
  return (
    <span className={`inline-block ${SIZE_CLASSES[size]} ${shapeCls} text-xs font-medium ${TONE_CLASSES[tone]} ${className ?? ''}`.trim()}>
      {children}
    </span>
  );
}
