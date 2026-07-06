import { get } from 'svelte/store';
import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';

describe('space-album-view-settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    spaceAlbumViewSettings.reset();
  });

  it('defaults view to Cover', () => {
    expect(get(spaceAlbumViewSettings).view).toBe(AlbumViewMode.Cover);
  });
  it('defaults sort to MostRecentPhoto desc and group to None', () => {
    const s = get(spaceAlbumViewSettings);
    expect(s.sortBy).toBe(AlbumSortBy.MostRecentPhoto);
    expect(s.sortOrder).toBe(SortOrder.Desc);
    expect(s.groupBy).toBe(SpaceAlbumGroupBy.None);
    expect(s.collapsedGroups).toEqual({});
  });
  it('persists under a key distinct from album-view-settings', () => {
    spaceAlbumViewSettings.update((s) => ({ ...s, view: AlbumViewMode.List }));
    expect(localStorage.getItem('space-album-view-settings')).toContain('List');
    expect(localStorage.getItem('album-view-settings')).toBeNull();
  });
});
