// FilterPills — horizontal row of clickable filter pills.
//
// Single-select (default): one option active at a time; active pill gets a
//   ring. Existing consumers use this shape.
// Multi-select (`multi: true`): `selected` is a Set; clicks toggle inclusion;
//   optional leading reset button clears the set. Used by the Invoices tab
//   pill rows (I2).
//
// Optional slots: `prefix` (label before first pill) and `extra` (trailing
// chip / hint after last pill).
//
// Base API extracted as Slice PP1 (2026-09-16). Multi mode + colored tones +
// prefix/extra/reset added as Slice I2 (2026-09-17) to consolidate 5 Invoice
// pill rows into one component.

import type { ReactNode } from 'react';

export interface FilterPillOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Default tone applied to both active + inactive when the state-specific
   *  props aren't given. */
  tone?: string;
  /** Overrides `tone` when the pill is active. Useful for per-option colored
   *  active states (e.g. Intuit=green, Convera=purple). */
  activeTone?: string;
  /** Overrides `tone` when the pill is inactive. */
  inactiveTone?: string;
}

interface CommonProps<T extends string> {
  options: FilterPillOption<T>[];
  className?: string;
  /** Rendered before the first pill (e.g. "Pay On:", "Method:"). */
  prefix?: ReactNode;
  /** Rendered after the last pill (e.g. trailing chip or hint span). */
  extra?: ReactNode;
  /** 'sm' (default) = text-xs / px-3 py-1; 'md' = text-sm / px-3 py-1.5. */
  size?: 'sm' | 'md';
  /** 'pill' (default, rounded-full, ring on active — matches original API) or
   *  'button' (rounded-lg, colored-border style — Invoice pills). */
  shape?: 'pill' | 'button';
  /** Extra tone applied to the ring on the active pill (pill shape only).
   *  Default indigo. */
  ringTone?: 'indigo' | 'teal';
}

interface SingleProps<T extends string> extends CommonProps<T> {
  multi?: false;
  selected: T;
  onChange: (next: T) => void;
}

interface MultiProps<T extends string> extends CommonProps<T> {
  multi: true;
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  /** Leading pill that clears the set. Rendered before options. */
  resetLabel?: ReactNode;
  resetActiveTone?: string;
  resetInactiveTone?: string;
}

export type FilterPillsProps<T extends string> = SingleProps<T> | MultiProps<T>;

export default function FilterPills<T extends string>(props: FilterPillsProps<T>) {
  const {
    options,
    className,
    prefix,
    extra,
    size = 'sm',
    shape = 'pill',
    ringTone = 'indigo',
  } = props;

  const sizeCls = size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-3 py-1 text-xs';
  const shapeCls = shape === 'button' ? 'rounded-lg border transition-colors' : 'rounded-full transition-colors';
  const baseCls = `${sizeCls} ${shapeCls} font-medium`;
  const ringCls = ringTone === 'teal' ? 'ring-teal-400' : 'ring-indigo-400';

  const toneFor = (opt: FilterPillOption<T>, isActive: boolean) => {
    if (isActive) return opt.activeTone ?? opt.tone ?? '';
    return opt.inactiveTone ?? opt.tone ?? '';
  };
  const stateExtras = (isActive: boolean) => {
    if (shape === 'button') return '';
    return isActive ? `ring-2 ring-offset-1 ${ringCls}` : 'hover:opacity-80';
  };

  const isSelected = (v: T) => props.multi ? props.selected.has(v) : props.selected === v;

  const handleClick = (v: T) => {
    if (props.multi) {
      const next = new Set(props.selected);
      if (next.has(v)) next.delete(v); else next.add(v);
      props.onChange(next);
    } else {
      props.onChange(v);
    }
  };

  const handleReset = () => {
    if (props.multi) props.onChange(new Set());
  };

  return (
    <div className={`flex flex-wrap gap-2 items-center ${className ?? ''}`.trim()}>
      {prefix != null && <span className="text-xs font-medium text-gray-600 mr-1">{prefix}</span>}
      {props.multi && props.resetLabel != null && (
        <button
          type="button"
          onClick={handleReset}
          className={`${baseCls} ${props.selected.size === 0 ? (props.resetActiveTone ?? '') : (props.resetInactiveTone ?? '')}`}
        >
          {props.resetLabel}
        </button>
      )}
      {options.map(opt => {
        const active = isSelected(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            className={`${baseCls} ${toneFor(opt, active)} ${stateExtras(active)}`.trim()}
          >
            {opt.label}
          </button>
        );
      })}
      {extra}
    </div>
  );
}
