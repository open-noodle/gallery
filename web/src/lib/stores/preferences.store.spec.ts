import { get } from 'svelte/store';
import { recentSpaceAlbumsExpanded, setSpaceAlbumsExpanded } from '$lib/stores/preferences.store';

describe('recentSpaceAlbumsExpanded', () => {
  beforeEach(() => {
    recentSpaceAlbumsExpanded.set({});
  });

  it('defaults to collapsed (missing key)', () => {
    expect(get(recentSpaceAlbumsExpanded)['space-1']).toBeUndefined();
  });

  it('setSpaceAlbumsExpanded records the flag for a space', () => {
    setSpaceAlbumsExpanded('space-1', true, ['space-1', 'space-2']);
    expect(get(recentSpaceAlbumsExpanded)['space-1']).toBe(true);
  });

  it('prunes keys for spaces no longer in the valid set', () => {
    setSpaceAlbumsExpanded('space-1', true, ['space-1', 'gone-1']);
    expect(get(recentSpaceAlbumsExpanded)['gone-1']).toBeUndefined();

    // 'gone-1' had been expanded earlier; a later write with a set that excludes it removes it
    setSpaceAlbumsExpanded('gone-1', true, ['gone-1']); // seed it
    setSpaceAlbumsExpanded('space-1', false, ['space-1']); // valid set excludes gone-1
    expect(get(recentSpaceAlbumsExpanded)['gone-1']).toBeUndefined();
  });

  it('keeps still-valid keys while pruning stale ones and setting the target', () => {
    recentSpaceAlbumsExpanded.set({ a: true, b: true });
    setSpaceAlbumsExpanded('c', true, ['c', 'a']);
    expect(get(recentSpaceAlbumsExpanded)).toEqual({ a: true, c: true });
  });
});
