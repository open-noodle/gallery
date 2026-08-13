import { get } from 'svelte/store';
import { AlbumSortBy, AlbumViewMode, SortOrder } from '$lib/stores/preferences.store';
import { SpaceAlbumGroupBy, spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { SpaceAlbumSortBy } from '$lib/utils/space-album-sort';

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

  // S23 — a stored preference must survive the default change.
  //
  // `persisted()` reads localStorage once, when the module is evaluated. Writing
  // to localStorage afterwards and calling `.update()` does NOT re-read it — this
  // was verified empirically against this repo: the naive version leaves sortBy at
  // the default and fails. The store must be re-imported after seeding storage.
  //
  // Keep this test LAST in the file: vi.resetModules() means later tests would
  // otherwise get a different store instance than the one imported at the top.
  it('prefers a stored sortBy over the new default', async () => {
    localStorage.setItem(
      'space-album-view-settings',
      JSON.stringify({
        view: AlbumViewMode.Cover,
        sortBy: AlbumSortBy.Title,
        sortOrder: SortOrder.Asc,
        groupBy: SpaceAlbumGroupBy.None,
        groupOrder: SortOrder.Desc,
        collapsedGroups: {},
      }),
    );
    vi.resetModules();
    const reloaded = await import('$lib/stores/space-album-view-settings.store');
    expect(get(reloaded.spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
    expect(get(reloaded.spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
  });
});
