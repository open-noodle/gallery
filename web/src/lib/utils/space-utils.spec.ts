import { SharedSpaceRole } from '@immich/sdk';
import { spaceRoleLabelKey, splitPinnedSpaces } from '$lib/utils/space-utils';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';

describe('spaceRoleLabelKey', () => {
  it('maps owner to the existing owner key', () => {
    expect(spaceRoleLabelKey(SharedSpaceRole.Owner)).toBe('owner');
  });

  it('maps editor to the existing role_editor key', () => {
    expect(spaceRoleLabelKey(SharedSpaceRole.Editor)).toBe('role_editor');
  });

  it('maps viewer to the existing role_viewer key', () => {
    expect(spaceRoleLabelKey(SharedSpaceRole.Viewer)).toBe('role_viewer');
  });

  it('falls back to the least-privileged label for an unknown role', () => {
    expect(spaceRoleLabelKey('something-new')).toBe('role_viewer');
  });
});

describe('splitPinnedSpaces', () => {
  it('should return empty pinned and all unpinned when no IDs pinned', () => {
    const spaces = [sharedSpaceFactory.build({ id: 'a' }), sharedSpaceFactory.build({ id: 'b' })];
    const result = splitPinnedSpaces(spaces, []);
    expect(result.pinned).toEqual([]);
    expect(result.unpinned).toHaveLength(2);
  });

  it('should split spaces into pinned and unpinned', () => {
    const spaces = [
      sharedSpaceFactory.build({ id: 'a' }),
      sharedSpaceFactory.build({ id: 'b' }),
      sharedSpaceFactory.build({ id: 'c' }),
    ];
    const result = splitPinnedSpaces(spaces, ['a', 'c']);
    expect(result.pinned.map((s) => s.id)).toEqual(['a', 'c']);
    expect(result.unpinned.map((s) => s.id)).toEqual(['b']);
  });

  it('should ignore stale pinned IDs not in spaces list', () => {
    const spaces = [sharedSpaceFactory.build({ id: 'a' })];
    const result = splitPinnedSpaces(spaces, ['a', 'deleted-id']);
    expect(result.pinned).toHaveLength(1);
    expect(result.unpinned).toHaveLength(0);
  });

  it('should preserve spaces array order within pinned group', () => {
    const spaces = [
      sharedSpaceFactory.build({ id: 'a' }),
      sharedSpaceFactory.build({ id: 'b' }),
      sharedSpaceFactory.build({ id: 'c' }),
      sharedSpaceFactory.build({ id: 'd' }),
    ];
    const result = splitPinnedSpaces(spaces, ['c', 'a']);
    expect(result.pinned.map((s) => s.id)).toEqual(['a', 'c']);
    expect(result.unpinned.map((s) => s.id)).toEqual(['b', 'd']);
  });

  it('should set showSection=false when all spaces are pinned', () => {
    const spaces = [sharedSpaceFactory.build({ id: 'a' }), sharedSpaceFactory.build({ id: 'b' })];
    const result = splitPinnedSpaces(spaces, ['a', 'b']);
    expect(result.pinned).toHaveLength(2);
    expect(result.unpinned).toHaveLength(0);
    expect(result.showSection).toBe(false);
  });

  it('should set showSection=true when there are both pinned and unpinned', () => {
    const spaces = [sharedSpaceFactory.build({ id: 'a' }), sharedSpaceFactory.build({ id: 'b' })];
    const result = splitPinnedSpaces(spaces, ['a']);
    expect(result.showSection).toBe(true);
  });
});
