import { LibraryView, type SharedSpaceResponseDto } from '@immich/sdk';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { libraryView } from '$lib/gallery/library-view/library-view.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { userAdminFactory } from '@test-data/factories/user-factory';
import { photosTimelineConfig } from './photos-timeline';

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
});
