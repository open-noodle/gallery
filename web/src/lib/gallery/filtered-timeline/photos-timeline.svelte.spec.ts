import { createFilterState } from '#lib/components/filter-panel/filter-panel.ts';
import { librarySpaces, libraryView } from '#lib/gallery/library-view/library-view.svelte.ts';
import { invalidateSpaces, spacesQueryKey } from '#lib/gallery/spaces/space.query.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { LibraryView, getAllSpaces, type SharedSpaceResponseDto } from '@immich/sdk';
import { flushSync } from 'svelte';
import { createPhotosTimeline, photosTimelineConfig } from './photos-timeline.ts';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
}));

describe('photos timeline library view', () => {
  beforeEach(() => {
    authManager.setUser(factory.user({ id: 'me' }));
  });

  afterEach(() => {
    libraryView.current = 'both';
    librarySpaces.list = undefined;
    queryClient.removeQueries({ queryKey: spacesQueryKey });
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

    librarySpaces.list = [] as SharedSpaceResponseDto[];
    expect(config.showLibraryView!()).toBe(false);
    expect(config.timelineOptions(createFilterState())).not.toHaveProperty('libraryView');
  });

  // Adding photos to a space invalidates the spaces list. Unless the timeline holds the query open, the view stays
  // applied but its section and chip are hidden, and only the sidebar's expanded Spaces list refetched it.
  it('reloads the spaces list whenever a space change invalidates it', async () => {
    const spaces = [] as SharedSpaceResponseDto[];
    vi.mocked(getAllSpaces).mockResolvedValue(spaces);
    const cleanup = $effect.root(() => {
      createPhotosTimeline(() => undefined);
    });
    try {
      flushSync();
      await vi.waitFor(() => expect(librarySpaces.list).toEqual(spaces));
      expect(getAllSpaces).toHaveBeenCalledTimes(1);

      await invalidateSpaces();
      flushSync();
      await vi.waitFor(() => expect(getAllSpaces).toHaveBeenCalledTimes(2));
      expect(librarySpaces.list).toEqual(spaces);
    } finally {
      cleanup();
    }
  });
});
