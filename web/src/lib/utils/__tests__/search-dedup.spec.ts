import { dedupeAppend } from '$lib/utils/search-dedup';
import { describe, expect, it } from 'vitest';

describe('dedupeAppend', () => {
  it('appends new items and de-duplicates by id (primary cross-page scenario)', () => {
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'b' }, { id: 'd' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns existing array unchanged when every incoming item is a duplicate', () => {
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(new Set(result.map((r) => r.id)).size).toBe(result.length);
  });

  it('handles empty existing (first page)', () => {
    const result = dedupeAppend([], [{ id: 'a' }, { id: 'b' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles empty incoming (end of pagination)', () => {
    const result = dedupeAppend([{ id: 'a' }], []);
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('preserves order — new items append after existing, no reordering', () => {
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'a' }, { id: 'd' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
