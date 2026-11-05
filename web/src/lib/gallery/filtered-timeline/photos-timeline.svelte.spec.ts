import { getAllSpaces, LibraryView, type SharedSpaceResponseDto } from '@immich/sdk';
import { flushSync } from 'svelte';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { libraryView } from '$lib/gallery/library-view/library-view.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { userAdminFactory } from '@test-data/factories/user-factory';
import { createPhotosTimeline, photosTimelineConfig } from './photos-timeline';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
}));

describe('photos timeline library view', () => {
  beforeEach(() => {
    authManager.setUser(userAdminFactory.build({ id: 'me' }));
  });

  afterEach(() => {
    libraryView.current = 'both';
    userInteraction.recentSpaces = undefined;
    authManager.reset();
  });

  it('narrows the timeline and the add-all replay, but not a text search', () => {
    libraryView.current = LibraryView.Personal;
    const config = photosTimelineConfig(() => undefined);
    const filters = createFilterState();

    expect(config.timelineOptions(filters)).toMatchObject({ libraryView: LibraryView.Personal });
    expect(config.collectTerms!(filters, '')).toMatchObject({ libraryView: LibraryView.Personal });
    expect(config.collectTerms!(filters, 'beach')).not.toHaveProperty('libraryView');
  });

  it('offers the view, and applies it, only while a space is on my timeline', () => {
    libraryView.current = LibraryView.Personal;
    const config = photosTimelineConfig(() => undefined);
    expect(config.showLibraryView!()).toBe(false);

    userInteraction.recentSpaces = [] as SharedSpaceResponseDto[];
    expect(config.showLibraryView!()).toBe(false);
    expect(config.timelineOptions(createFilterState())).not.toHaveProperty('libraryView');
  });

  // Adding photos to a space drops the shared spaces list (spaces-cache). Until it is back the view stays
  // applied but its section and chip are hidden, and only the sidebar's expanded Spaces list refetched it.
  it('reloads the spaces list whenever a space change drops it', async () => {
    const spaces = [] as SharedSpaceResponseDto[];
    vi.mocked(getAllSpaces).mockResolvedValue(spaces);
    const cleanup = $effect.root(() => {
      createPhotosTimeline(() => undefined);
    });
    try {
      flushSync();
      await vi.waitFor(() => expect(userInteraction.recentSpaces).toEqual(spaces));
      expect(getAllSpaces).toHaveBeenCalledTimes(1);

      userInteraction.recentSpaces = undefined;
      flushSync();
      await vi.waitFor(() => expect(getAllSpaces).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(userInteraction.recentSpaces).toEqual(spaces));
    } finally {
      cleanup();
    }
  });
});
