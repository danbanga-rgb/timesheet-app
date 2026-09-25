// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useColumnPrefs, type OptionalColumn } from '../useColumnPrefs';

type K = 'a' | 'b';
const COLS: readonly OptionalColumn<K>[] = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
];

// jsdom here ships without a usable localStorage — install an in-memory one.
function installMemoryStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    },
  });
}

describe('useColumnPrefs', () => {
  beforeEach(() => installMemoryStorage());

  it('starts with no extras when nothing stored', () => {
    const { result } = renderHook(() => useColumnPrefs<K>('t', COLS));
    expect(result.current.visible.size).toBe(0);
  });

  it('persists toggles per view key', () => {
    const { result } = renderHook(() => useColumnPrefs<K>('t', COLS));
    act(() => result.current.toggle('b'));
    expect(result.current.isOn('b')).toBe(true);
    const again = renderHook(() => useColumnPrefs<K>('t', COLS));
    expect(again.result.current.isOn('b')).toBe(true);
    const other = renderHook(() => useColumnPrefs<K>('other', COLS));
    expect(other.result.current.isOn('b')).toBe(false);
  });

  it('drops unknown keys and survives garbage', () => {
    window.localStorage.setItem('qbAutoV2.columns.t', JSON.stringify(['a', 'gone']));
    expect(renderHook(() => useColumnPrefs<K>('t', COLS)).result.current.visible).toEqual(new Set(['a']));
    window.localStorage.setItem('qbAutoV2.columns.t', '{not json');
    expect(renderHook(() => useColumnPrefs<K>('t', COLS)).result.current.visible.size).toBe(0);
  });

  it('reset clears everything', () => {
    const { result } = renderHook(() => useColumnPrefs<K>('t', COLS));
    act(() => { result.current.toggle('a'); result.current.toggle('b'); });
    act(() => result.current.reset());
    expect(result.current.visible.size).toBe(0);
  });
});
