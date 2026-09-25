import { useCallback, useState } from 'react';

// V9.10: per-view optional-column visibility, persisted per browser.
// Each view (ready, pushed, mappings) keeps its own set. Storage can be
// unavailable (private window, blocked site data) — every access is guarded
// and the view falls back to "no extras" without it.

export interface OptionalColumn<K extends string> {
  key: K;
  label: string;
}

const STORAGE_PREFIX = 'qbAutoV2.columns.';

function readStored<K extends string>(viewKey: string, allowed: readonly K[]): Set<K> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + viewKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is K => allowed.includes(k as K)));
  } catch {
    return new Set();
  }
}

function writeStored(viewKey: string, keys: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + viewKey, JSON.stringify([...keys]));
  } catch {
    // Non-fatal: choice just won't survive a reload.
  }
}

export function useColumnPrefs<K extends string>(viewKey: string, columns: readonly OptionalColumn<K>[]) {
  const [visible, setVisible] = useState<Set<K>>(() => readStored(viewKey, columns.map(c => c.key)));

  const toggle = useCallback((key: K) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeStored(viewKey, next);
      return next;
    });
  }, [viewKey]);

  const reset = useCallback(() => {
    setVisible(new Set());
    writeStored(viewKey, new Set());
  }, [viewKey]);

  const isOn = useCallback((key: K) => visible.has(key), [visible]);

  return { visible, isOn, toggle, reset };
}
