import { AlbumViewMode, SortOrder } from '#lib/stores/preferences.store.ts';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '#lib/stores/space-album-view-settings.store.ts';
import { SpaceAlbumSortBy } from '#lib/utils/space-album-sort.ts';
import { get } from 'svelte/store';

describe('space-album-view-settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    spaceAlbumViewSettings.reset();
  });

  it('defaults view to Cover', () => {
    expect(get(spaceAlbumViewSettings).view).toBe(AlbumViewMode.Cover);
  });
  it('defaults sort to RecentlyLinked desc and group to None', () => {
    const s = get(spaceAlbumViewSettings);
    expect(s.sortBy).toBe(SpaceAlbumSortBy.RecentlyLinked);
    expect(s.sortOrder).toBe(SortOrder.Desc);
    expect(s.groupBy).toBe(SpaceAlbumGroupBy.None);
    expect(s.collapsedGroups).toEqual({});
  });
  it('persists under a key distinct from album-view-settings', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
    expect(localStorage.getItem('space-album-view-settings')).toContain('List');
    expect(localStorage.getItem('album-view-settings')).toBeNull();
  });

  // S23 (a stored sortBy survives the default change) is in space-album-view-settings.store.load.spec.ts:
  // `persisted()` caches each store by key for the page's lifetime and browser mode cannot reset modules,
  // so reading storage on load needs a file of its own.
});
