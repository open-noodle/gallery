import { AlbumSortBy, AlbumViewMode, SortOrder } from '#lib/stores/preferences.store.ts';
import { get } from 'svelte/store';

const KEY = 'space-album-view-settings';

describe('space-album-view-settings store on load', () => {
  afterAll(() => {
    localStorage.removeItem(KEY);
  });

  // S23 — a stored preference must survive the default change.
  //
  // `persisted()` reads localStorage once, when the store is created, and caches it by key for the page's
  // lifetime; browser mode cannot reset modules. So storage is seeded before this file's only import of the
  // store module, which must not be imported statically here.
  it('prefers a stored sortBy over the new default', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        view: AlbumViewMode.Cover,
        sortBy: AlbumSortBy.Title,
        sortOrder: SortOrder.Asc,
        groupBy: 'None', // SpaceAlbumGroupBy.None, written out to keep the store module unloaded
        groupOrder: SortOrder.Desc,
        collapsedGroups: {},
      }),
    );
    const { spaceAlbumViewSettings } = await import('#lib/stores/space-album-view-settings.store.ts');
    expect(get(spaceAlbumViewSettings).sortBy).toBe(AlbumSortBy.Title);
    expect(get(spaceAlbumViewSettings).sortOrder).toBe(SortOrder.Asc);
  });
});
