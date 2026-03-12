import { splitPinnedSpaces } from '$lib/utils/space-utils';

type MinimalSpace = { id: string; [key: string]: unknown };

const makeSpace = (id: string): MinimalSpace => ({ id, name: `Space ${id}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdById: 'user-1' });

describe('splitPinnedSpaces', () => {
  it('should return empty pinned and all unpinned when no IDs pinned', () => {
    const spaces = [makeSpace('a'), makeSpace('b')] as any[];
    const result = splitPinnedSpaces(spaces, []);
    expect(result.pinned).toEqual([]);
    expect(result.unpinned).toHaveLength(2);
  });

  it('should split spaces into pinned and unpinned', () => {
    const spaces = [makeSpace('a'), makeSpace('b'), makeSpace('c')] as any[];
    const result = splitPinnedSpaces(spaces, ['a', 'c']);
    expect(result.pinned.map((s: any) => s.id)).toEqual(['a', 'c']);
    expect(result.unpinned.map((s: any) => s.id)).toEqual(['b']);
  });

  it('should ignore stale pinned IDs not in spaces list', () => {
    const spaces = [makeSpace('a')] as any[];
    const result = splitPinnedSpaces(spaces, ['a', 'deleted-id']);
    expect(result.pinned).toHaveLength(1);
    expect(result.unpinned).toHaveLength(0);
  });

  it('should preserve spaces array order within pinned group', () => {
    const spaces = [makeSpace('a'), makeSpace('b'), makeSpace('c'), makeSpace('d')] as any[];
    const result = splitPinnedSpaces(spaces, ['c', 'a']);
    expect(result.pinned.map((s: any) => s.id)).toEqual(['a', 'c']);
    expect(result.unpinned.map((s: any) => s.id)).toEqual(['b', 'd']);
  });

  it('should set showSection=false when all spaces are pinned', () => {
    const spaces = [makeSpace('a'), makeSpace('b')] as any[];
    const result = splitPinnedSpaces(spaces, ['a', 'b']);
    expect(result.pinned).toHaveLength(2);
    expect(result.unpinned).toHaveLength(0);
    expect(result.showSection).toBe(false);
  });

  it('should set showSection=true when there are both pinned and unpinned', () => {
    const spaces = [makeSpace('a'), makeSpace('b')] as any[];
    const result = splitPinnedSpaces(spaces, ['a']);
    expect(result.showSection).toBe(true);
  });
});
