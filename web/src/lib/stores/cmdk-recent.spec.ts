import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addEntry, getEntries, clearEntries, makePlaceId, __resetForTests } from './cmdk-recent';

describe('cmdk-recent', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('returns [] for unset store', () => {
    expect(getEntries()).toEqual([]);
  });

  it('addEntry persists, returns newest first', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 });
    expect(getEntries().map((e) => e.id)).toEqual(['q:b', 'q:a']);
  });

  it('dedupes by id, updating lastUsed', () => {
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 5 });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(5);
  });

  it('trims to 20, keeping newest', () => {
    for (let i = 0; i < 25; i++) {
      addEntry({ kind: 'query', id: `q:${i}`, text: `q${i}`, mode: 'smart', lastUsed: i });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].id).toBe('q:24');
    expect(entries[19].id).toBe('q:5');
  });

  it('treats corrupt JSON as empty; next write overwrites', () => {
    localStorage.setItem('cmdk.recent', 'not-valid-json');
    __resetForTests();
    expect(getEntries()).toEqual([]);
    addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 });
    expect(getEntries()).toHaveLength(1);
  });

  it('QuotaExceededError preserves in-memory copy (regression test)', () => {
    addEntry({ kind: 'query', id: 'q:initial', text: 'initial', mode: 'smart', lastUsed: 1 });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    addEntry({ kind: 'query', id: 'q:new', text: 'new', mode: 'smart', lastUsed: 2 });
    spy.mockRestore();
    const entries = getEntries();
    expect(entries.some((e) => e.id === 'q:initial')).toBe(true);
    expect(entries.some((e) => e.id === 'q:new')).toBe(true);
  });

  it('handles localStorage unavailable (getItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getEntries()).toEqual([]);
    expect(() =>
      addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 }),
    ).not.toThrow();
    spy.mockRestore();
  });

  it('clearEntries empties the store', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    clearEntries();
    expect(getEntries()).toEqual([]);
  });

  it('invalidates in-memory cache on storage event for cmdk.recent', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    // Simulate another tab writing directly to localStorage and dispatching the
    // 'storage' event that cross-tab updates emit.
    localStorage.setItem(
      'cmdk.recent',
      JSON.stringify([{ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 }]),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'cmdk.recent' }));
    const entries = getEntries();
    expect(entries.map((e) => e.id)).toEqual(['q:b']);
  });

  it('invalidates cache on storage event with null key (full clear)', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(getEntries()).toEqual([]);
  });

  it('ignores storage events for unrelated keys', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    // Fire an unrelated key event — in-memory copy should survive.
    window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }));
    const entries = getEntries();
    expect(entries.map((e) => e.id)).toEqual(['q:a']);
  });
});

describe('makePlaceId precision', () => {
  it('rounds to 4 decimals so near-identical coords collapse', () => {
    expect(makePlaceId(48.85664567, 2.35221001)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.85661111, 2.35219999)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.85664567, 2.35221001)).toBe(makePlaceId(48.85661111, 2.35219999));
  });

  it('coords far apart produce different keys', () => {
    expect(makePlaceId(48.85, 2.35)).not.toBe(makePlaceId(48.86, 2.35));
  });
});
