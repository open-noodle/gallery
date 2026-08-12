import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import { lang } from '$lib/stores/preferences.store';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';
import { storeTypedSearchNames } from '$lib/utils/typed-search/typed-search-name-cache';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import PhotosPage from './+page.svelte';

const {
  mockAssetMultiSelectManager,
  mockAuthManager,
  mockMemoryManager,
  mockRegisterSelectionContext,
  mockRegisterSearchablePageFilters,
  readableFn,
} = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllUserOwned: true,
  },
  mockAuthManager: {
    preferences: { memories: { enabled: false } },
    user: { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' },
  },
  mockMemoryManager: {
    memories: [] as unknown[],
  },
  mockRegisterSelectionContext: vi.fn(),
  mockRegisterSearchablePageFilters: vi.fn(() => vi.fn()),
  // `memoryLaneTitle` and `getAltText` are `derived(t, ...)` stores *holding a function*, read by
  // the page as `$memoryLaneTitle(memory)` / `$getAltText(asset)`. As bare vi.fn()s they threw
  // `store_invalid_shape` the first time anything rendered the memories strip - which nothing did
  // until the test below - so they are mocked at the right shape. Hoisted with the rest: a
  // top-level const is not initialised yet when a vi.mock factory runs.
  readableFn: (value: unknown) => ({
    subscribe: (run: (value: unknown) => void) => {
      run(value);
      return () => {};
    },
  }),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
// The mock module and the spec import the SAME singleton, so assigning mockPage.url in a test is
// what the page's $effect sees. A plain vi.hoisted object registers no signal for a Svelte 5
// `$effect` reading `page.url.search` — without this reactive stand-in, a test that changes the URL
// after render (back/forward, or the `?at=` write from closing the asset viewer) would assert
// against a page that never re-hydrated, and would pass whether or not the bug is present.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/ActionMenuItem.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/active-filters-bar-actions.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/bindable-filter-panel.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/search/smart-search-results.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/smart-search-results.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/EmptyPlaceholder.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } =
    await import('../../albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/LinkLivePhotoAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/StackAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: { isViewing: false },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerSelectionContext: mockRegisterSelectionContext,
}));

vi.mock('$lib/managers/global-search-manager.svelte', () => ({
  globalSearchManager: {
    registerSearchablePageFilters: mockRegisterSearchablePageFilters,
  },
}));

vi.mock('$lib/managers/memory-manager.svelte', () => ({
  memoryManager: mockMemoryManager,
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('$lib/utils', () => ({
  createUrl: vi.fn(() => ''),
  getAssetMediaUrl: vi.fn(() => ''),
  memoryLaneTitle: readableFn(() => 'memory'),
}));

vi.mock('$lib/utils/file-uploader', () => ({
  openFileUploadDialog: vi.fn(),
}));

vi.mock('$lib/utils/photos-filter-options', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/photos-filter-options')>();
  return {
    ...actual,
    // Spied, NOT stubbed: `<Timeline options>` must carry the REAL derived query (takenAfter/…), or
    // the `not.toHaveTextContent('"takenAfter"')` assertions below would pass vacuously.
    buildPhotosTimelineOptions: vi.fn(actual.buildPhotosTimelineOptions),
  };
});

vi.mock('$lib/utils/thumbnail-util', () => ({
  getAltText: readableFn(() => 'alt'),
}));

vi.mock('$lib/utils/timeline-util', () => ({
  toTimelineAsset: vi.fn((asset) => asset),
}));

/** Must match mockAuthManager.user.id — the signed-in user whose personal timeline /photos is. */
const MY_USER_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function renderPage() {
  return render(TestWrapper as Component<{ component: typeof PhotosPage; componentProps: Record<string, never> }>, {
    component: PhotosPage,
    componentProps: {},
  });
}

describe('Photos page search URL state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPage.reset('https://gallery.test/photos?q=nature', { routeId: '/(user)/photos/[[assetId=id]]' });
    lang.set('de');
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockMemoryManager.memories = [];
    // Shared object across the whole file, and nothing else puts it back - the memories test
    // below turns it on and every test after it would otherwise render the strip too.
    mockAuthManager.preferences.memories.enabled = false;
    mockRegisterSearchablePageFilters.mockReturnValue(vi.fn());
    sessionStorage.clear();
    sdkMock.getFilterSuggestions.mockResolvedValue({
      people: [],
      countries: [],
      cameraMakes: [],
      tags: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    sdkMock.searchSmartFacets.mockResolvedValue({
      total: 12,
      timeBuckets: [{ timeBucket: '2024-01-01', count: 12 }],
      countries: ['Germany'],
      cities: ['Berlin'],
      cameraMakes: ['Sony'],
      cameraModels: ['A7'],
      tags: [{ id: 'tag-1', value: 'Travel' }],
      people: [{ id: 'person-1', name: 'Ada' }],
      ratings: [4],
      mediaTypes: [AssetTypeEnum.Image],
      hasUnnamedPeople: false,
    });
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
  });

  it('renders search results from q without a local search input', () => {
    renderPage();

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'nature');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'relevance');
    expect(screen.queryByTestId('timeline-stub')).not.toBeInTheDocument();
  });

  it('hydrates an explicit search sort from the URL', () => {
    mockPage.url = new URL('https://gallery.test/photos?q=nature&sort=asc');

    renderPage();

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'nature');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc');
  });

  it('hydrates typed filter URL params into the photos FilterState', () => {
    mockPage.url = new URL(
      'https://gallery.test/photos?q=beach&people=person-1&tags=tag-1&type=image&favorite=true&album=none&rating=4&from=2025-01-01&to=2025-12-31',
    );

    renderPage();

    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-person-ids', 'person-1');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-tag-ids', 'tag-1');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-media-type', 'image');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-favorite', 'true');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-not-in-album', 'true');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-rating', '4');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-date-after', '2025-01-01');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-date-before', '2025-12-31');
  });

  it('clears only q when clearing the search chip', async () => {
    mockPage.url = new URL('https://gallery.test/photos?view=timeline&q=beach&people=person-1&city=Berlin');

    renderPage();
    await fireEvent.click(await screen.findByTestId('active-filters-clear-search'));

    expect(goto).toHaveBeenCalledWith('/photos?view=timeline&people=person-1&city=Berlin', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('syncs the URL when a location typed filter is cleared from the filter panel', async () => {
    mockPage.url = new URL('https://gallery.test/photos?city=New+York+City');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-clear-location'));

    expect(goto).toHaveBeenCalledWith('/photos', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('clears typed filter URL params and q when clearing all active filters', async () => {
    mockPage.url = new URL('https://gallery.test/photos?view=timeline&q=beach&people=person-1&city=Berlin');

    renderPage();
    await fireEvent.click(await screen.findByTestId('active-filters-clear-all'));

    expect(goto).toHaveBeenLastCalledWith('/photos?view=timeline', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('exposes favorites in the photos filter panel', () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-sections',
      'timeline,people,location,camera,tags,rating,media,favorites,albums,text',
    );
  });

  it('passes has-no-album into photos timeline options when hydrated from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/photos?album=none');

    renderPage();

    await waitFor(() => {
      expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(
        expect.objectContaining({ isNotInAlbum: true }),
        MY_USER_ID,
      );
    });
  });

  it('passes description/filename/ocr text filters into photos timeline options from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/photos?description=beach&filename=IMG&ocr=invoice');

    renderPage();

    await waitFor(() => {
      expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'beach', originalFileName: 'IMG', ocr: 'invoice' }),
        MY_USER_ID,
      );
    });
  });

  it('D3: an album chip on /photos still carries the owner gate (userId) into the timeline query', async () => {
    // /photos is MY timeline. The server leaves `userId` undefined under an `albumId` — that branch
    // belongs to the ALBUM page, where album ACCESS is the scope (medium E22). If /photos sends the
    // album chip without stating its own owner scope, `?albumId=A&owner=<co-member>` lists that
    // co-member's assets, and the Favorites chip the album OWNER's favourites, on my personal
    // timeline. The two gates AND in the query — the page just has to send both.
    mockPage.url = new URL(
      'https://gallery.test/photos?albumId=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa&owner=bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    );

    renderPage();

    await waitFor(() => {
      expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        }),
        MY_USER_ID,
      );
    });
    expect(screen.getByTestId('timeline-options')).toHaveTextContent(`"userId":"${MY_USER_ID}"`);
  });

  it('passes has-album into photos timeline options when hydrated from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/photos?album=has');

    renderPage();

    await waitFor(() => {
      expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }), MY_USER_ID);
    });
  });

  it('registers current photos filters for global sort changes', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await waitFor(() => expect(mockRegisterSearchablePageFilters).toHaveBeenCalledOnce());
    const calls = mockRegisterSearchablePageFilters.mock.calls as unknown as Array<[() => FilterState]>;
    const getFilters = calls[0][0];

    expect(getFilters().isFavorite).toBeUndefined();
    expect(getFilters().sortOrder).toBe('desc');
    await fireEvent.click(screen.getByTestId('select-favorites-filter'));

    await waitFor(() => expect(getFilters()).toMatchObject({ isFavorite: true, sortOrder: 'desc' }));
  });

  it('passes typed search names into the photos filter panel', () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-cat&tags=tag-nature');
    storeTypedSearchNames('/photos?people=person-cat&tags=tag-nature', {
      personNames: new Map([['person-cat', 'cat']]),
      tagNames: new Map([['tag-nature', 'nature']]),
    });

    renderPage();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-person-names',
      JSON.stringify([['person-cat', 'cat']]),
    );
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-tag-names',
      JSON.stringify([['tag-nature', 'nature']]),
    );
  });

  it('passes favorites into photos timeline options when selected', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-favorites-filter'));

    await waitFor(() => {
      expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(
        expect.objectContaining({ isFavorite: true }),
        MY_USER_ID,
      );
    });
  });

  it('narrows non-search dependent suggestions to favorites without shared spaces when selected', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-favorites-filter'));
    await fireEvent.click(screen.getByTestId('load-city-suggestions'));
    await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

    await waitFor(() => {
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', isFavorite: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Sony', isFavorite: true }),
      );
    });

    for (const [request] of sdkMock.getSearchSuggestions.mock.calls) {
      expect(request).not.toHaveProperty('withSharedSpaces');
    }
  });

  it('narrows photos suggestions and dependent providers to has-no-album when selected', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-no-album-filter'));
    await fireEvent.click(screen.getByTestId('load-city-suggestions'));
    await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

    await waitFor(() => {
      expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ isNotInAlbum: true, withSharedSpaces: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', isNotInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Sony', isNotInAlbum: true }),
      );
    });
  });

  it('narrows photos suggestions and dependent providers to has-album when selected', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-album-filter'));
    await fireEvent.click(screen.getByTestId('load-city-suggestions'));
    await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

    await waitFor(() => {
      expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ isInAlbum: true, withSharedSpaces: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', isInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Sony', isInAlbum: true }),
      );
    });
  });

  it('hydrates has-album from the URL into search results', () => {
    mockPage.url = new URL('https://gallery.test/photos?q=beach&album=has');

    renderPage();

    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-in-album', 'true');
  });

  it('fetches smart facets for committed photos search and passes exact total to results', async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(sdkMock.searchSmartFacets).toHaveBeenCalledWith(
        {
          smartSearchFacetsDto: expect.objectContaining({
            query: 'nature',
            language: 'de',
            withSharedSpaces: true,
          }),
        },
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });
    await vi.waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12'));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-language', 'de');
  });

  it('narrows search results and smart facets to favorites without shared spaces when selected', async () => {
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('select-favorites-filter'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-is-favorite', 'true');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-with-shared-spaces', 'false');
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'nature',
      isFavorite: true,
    });
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('uses smart facet timeBuckets in search mode', async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
        'data-time-buckets',
        JSON.stringify([{ timeBucket: '2024-01-01', count: 12 }]),
      );
    });
  });

  // End-to-end for the narrowing path: URL → FilterState → suggestion request. A state, lens or
  // contributor filter only ever ARRIVES this way (contextual filter, typed search or a link), so a
  // panel that did not forward it would show suggestion lists describing the whole library.
  it('narrows the photos suggestion lists by the state, lens and contributor from the URL', async () => {
    const ownerId = '44444444-4444-4444-8444-444444444444';
    mockPage.url = new URL(
      `https://gallery.test/photos?state=Bavaria&lens=RF24-105mm%20F4%20L%20IS%20USM&owner=${ownerId}`,
    );

    renderPage();

    await vi.waitFor(() =>
      expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'Bavaria',
          lensModel: 'RF24-105mm F4 L IS USM',
          ownerId,
          withSharedSpaces: true,
        }),
      ),
    );
  });

  it('never sends the album filter or the free-text filters to the photos suggestion endpoint', async () => {
    // `albumId` there is a SCOPE the server rejects alongside `withSharedSpaces` (a 400 that would
    // empty every list), and the free-text filters are ILIKE / trigram predicates, not facets.
    const albumId = '11111111-1111-4111-8111-111111111111';
    mockPage.url = new URL(`https://gallery.test/photos?albumId=${albumId}&description=cake&filename=IMG_1.jpg&ocr=hi`);

    renderPage();

    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
    const request = sdkMock.getFilterSuggestions.mock.calls[0][0];
    for (const key of ['albumId', 'description', 'originalFileName', 'ocr']) {
      expect(request).not.toHaveProperty(key);
    }
  });

  it('does not fetch smart facets when the committed query is empty', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
  });

  it('does not fetch smart facets when the committed query is whitespace only', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=%20%20');

    renderPage();

    expect(screen.queryByTestId('smart-search-results')).not.toBeInTheDocument();
    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
  });

  it('does not include sort order in the smart facet payload', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=nature&sort=asc');

    renderPage();

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    expect(sdkMock.searchSmartFacets.mock.calls[0][0].smartSearchFacetsDto).not.toHaveProperty('order');
  });

  it('does not refetch smart facets for sort-only filter changes', async () => {
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('filter-panel-set-sort-asc'));

    await waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc'));
    expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
  });

  it('keeps rendering search results when smart facets fail', async () => {
    sdkMock.searchSmartFacets.mockRejectedValueOnce(new Error('facets failed'));

    renderPage();

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'nature');
  });

  it('preserves previous facet total and buckets when a later facet fetch fails', async () => {
    renderPage();
    await vi.waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12'));

    sdkMock.searchSmartFacets.mockRejectedValueOnce(new Error('facets failed'));
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-time-buckets',
      JSON.stringify([{ timeBucket: '2024-01-01', count: 12 }]),
    );
  });

  it('refetches smart facets when an active filter changes', async () => {
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'nature',
      country: 'Germany',
      withSharedSpaces: true,
    });
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-country', 'Germany');
  });

  it('refetches smart facets when the search language changes', async () => {
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    lang.set('fr');

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'nature',
      language: 'fr',
      withSharedSpaces: true,
    });
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-language', 'fr');
  });

  it('registers cmdk selection context with photo-page callbacks', () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    expect(mockRegisterSelectionContext).toHaveBeenCalledOnce();
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    expect(options.getAssets()).toBe(mockAssetMultiSelectManager.assets);
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.canAddToSpace()).toBe(true);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete()).toEqual(expect.any(Function));
  });

  it('photo-page cmdk callbacks are live functions and clearSelection delegates to the selection manager', () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    const options = mockRegisterSelectionContext.mock.calls[0][0];

    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete()).toEqual(expect.any(Function));
    options.clearSelection();
    expect(mockAssetMultiSelectManager.clear).toHaveBeenCalledOnce();
  });

  it('passes default day grouping into photos timeline options', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    });
  });

  it('clicking a photos year bucket zooms to month grouping without mutating filters', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-1&city=Berlin');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      // Zooming a year must NOT scope the query: every month of the archive
      // stays loaded so the user can scroll across year boundaries (Hagen bug 1).
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        personIds: ['person-1'],
        city: 'Berlin',
        selectedYear: undefined,
        selectedMonth: undefined,
        dateAfter: undefined,
        dateBefore: undefined,
      }),
      MY_USER_ID,
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('clicking a photos month bucket zooms to day grouping without mutating filters', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        personIds: ['person-1'],
        selectedYear: undefined,
        selectedMonth: undefined,
        dateAfter: undefined,
        dateBefore: undefined,
      }),
      MY_USER_ID,
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('does not show active filter chips when a photos bucket is activated without filters', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
    expect(screen.queryByTestId('active-filters-bar-stub')).not.toBeInTheDocument();
    expect(goto).not.toHaveBeenCalled();
  });

  it('keeps explicit photos temporal filters across URL sync for non-time filter changes', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '2015');
    });

    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        country: 'Germany',
        selectedYear: 2015,
        selectedMonth: undefined,
      }),
      MY_USER_ID,
    );
    // D2 — the year rides along in the URL now, rather than in a carry-over slot beside it.
    expect(goto).toHaveBeenLastCalledWith('/photos?country=Germany&year=2015', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('lets an explicit custom photos date range filter apply and clear a pending zoom anchor', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
    await waitFor(() => expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}'));

    await fireEvent.click(screen.getByTestId('filter-panel-set-custom-range'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-before', '2024-12-31');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        personIds: ['person-1'],
        dateAfter: '2024-01-01',
        dateBefore: '2024-12-31',
        selectedYear: undefined,
        selectedMonth: undefined,
      }),
      MY_USER_ID,
    );
    expect(goto).toHaveBeenLastCalledWith('/photos?people=person-1&from=2024-01-01&to=2024-12-31', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('clearing an explicit photos temporal chip keeps non-time filters and the current grouping', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('timeline-grouping-month'));
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
    await fireEvent.click(await screen.findByTestId('active-filters-remove-timeline'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        personIds: ['person-1'],
        selectedYear: undefined,
        selectedMonth: undefined,
      }),
      MY_USER_ID,
    );
  });

  it('clicking a photos bucket preserves an existing explicit custom date filter', async () => {
    mockPage.url = new URL('https://gallery.test/photos?from=2024-01-01&to=2024-12-31&tags=tag-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
    expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tagIds: ['tag-1'],
        dateAfter: '2024-01-01',
        dateBefore: '2024-12-31',
        selectedYear: undefined,
        selectedMonth: undefined,
      }),
      MY_USER_ID,
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('renders a desktop grouping control on the photos browse timeline', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the photos grouping control separated from representative buckets without a colored strip', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    const control = await screen.findByTestId('timeline-desktop-grouping-control');
    const toolbar = control.closest('[class*="bg-transparent"]');
    expect(toolbar).toHaveClass('mb-2', 'bg-transparent', 'dark:bg-transparent');
    expect(toolbar).not.toHaveClass('mb-6');
    expect(toolbar).not.toHaveClass('bg-gray-50', 'dark:bg-gray-900', 'border-b');
  });

  it('shows grouping and the filter bar in one merged toolbar (no separate spacing wrapper)', async () => {
    mockPage.url = new URL('https://gallery.test/photos?country=Germany');

    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('active-filters-bar-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('photos-active-filters-bar-spacing')).toBeNull();
  });

  it('keeps active filters visually separated from grouped timeline cards', async () => {
    mockPage.url = new URL('https://gallery.test/photos?country=Germany');

    renderPage();

    const filterBar = await screen.findByTestId('active-filters-bar-stub');
    const toolbar = filterBar.closest('[class*="shrink-0"]');
    expect(toolbar).toHaveClass('shrink-0');
    expect(toolbar).toHaveClass('mb-2');
  });

  it('changes photos grouping from the desktop control without changing filters or URL params', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(goto).not.toHaveBeenCalledWith(expect.stringContaining('selectedYear'), expect.anything());
  });

  it('does not show the route empty state for representative year buckets', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();
    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    });
    expect(screen.queryByText('no_assets_message')).not.toBeInTheDocument();
  });

  it('does not show the desktop grouping control during photos search results', () => {
    mockPage.url = new URL('https://gallery.test/photos?q=nature');

    renderPage();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('does not show the desktop grouping control while photos selection mode is active', () => {
    mockPage.url = new URL('https://gallery.test/photos');
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('ignores photos bucket activation while selection mode is active', async () => {
    mockPage.url = new URL('https://gallery.test/photos');
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    });
    expect(goto).not.toHaveBeenCalled();
  });

  it('passes grouping state and change handler into the photos Timeline for mobile placement', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    renderPage();

    expect(await screen.findByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );

    await fireEvent.click(screen.getByTestId('timeline-mobile-set-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
      expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
        JSON.stringify({ grouping: 'year', hasHandler: true }),
      );
    });
  });

  it('wires the add-all handler into the active filters bar', async () => {
    mockPage.url = new URL('https://gallery.test/photos?description=beach');

    renderPage();

    const bar = await screen.findByTestId('active-filters-bar-stub');
    expect(bar).toHaveAttribute('data-has-add-all', 'true');
  });
  // The strip is @immich/ui's ImageCarousel, which carries its own `mt-3` from when it was the
  // first thing in the timeline. The route grouping bar sits above it now and already ends in
  // 8px of padding plus an 8px margin, so that third helping put 28px between the
  // Years/Months/All pill and the strip where the timeline gets 16px with memories off.
  // Asserted on the rendered section rather than on the prop: the override only works because
  // the library merges the incoming class with twMerge, and a prop assertion would pass just as
  // well against a library that concatenated them and left `mt-3` winning.
  it('drops the memories strip top margin the grouping bar now provides', () => {
    mockPage.url = new URL('https://gallery.test/photos');
    mockAuthManager.preferences.memories.enabled = true;
    mockMemoryManager.memories = [{ id: 'memory-1', assets: [{ id: 'asset-1' }] }];

    const { container } = renderPage();

    const strip = container.querySelector('a[href*="/memory"]')!.closest('section')!;
    expect([...strip.classList]).toContain('mt-0');
    expect([...strip.classList]).not.toContain('mt-3');
  });

  // D2 — the picked year/month is IN the URL codec. It used to be transient, which meant a shared
  // link silently dropped it (recipient sees the whole library, no chip) and every URL-backed page
  // needed a carry-over slot to smuggle it across its own goto().
  describe('D2: the temporal filter is URL-backed', () => {
    it('hydrates a shared ?year= link into the picker, the chip and the timeline query', async () => {
      mockPage.url = new URL('https://gallery.test/photos?year=2023');

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2023');
        expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '2023');
        const options = screen.getByTestId('timeline-options').textContent ?? '';
        expect(options).toContain('"takenAfter":"2023-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2024-01-01T00:00:00.000Z"');
      });
    });

    it('hydrates a shared ?year=&month= link', async () => {
      mockPage.url = new URL('https://gallery.test/photos?year=2023&month=6');

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2023');
        expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '6');
        const options = screen.getByTestId('timeline-options').textContent ?? '';
        expect(options).toContain('"takenAfter":"2023-06-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2023-07-01T00:00:00.000Z"');
      });
    });

    it('writes the picked year to the URL', async () => {
      mockPage.url = new URL('https://gallery.test/photos');

      renderPage();
      await fireEvent.click(await screen.findByTestId('filter-panel-set-year'));

      await waitFor(() => expect(goto).toHaveBeenCalled());
      const [target] = vi.mocked(goto).mock.calls.at(-1) as [string];
      expect(target).toContain('year=2015');
    });

    // The bug D2 retires. Closing the asset viewer calls replaceScrollTarget, which writes
    // `?at=<assetId>` — a URL change the page MUST re-hydrate from. Before D2 the year lived only in
    // a carry-over slot keyed on the exact URL the page itself last wrote, so the `?at=` URL missed
    // it and the timeline silently widened back to "all time".
    it('keeps a picked year when the asset viewer closes and writes ?at=', async () => {
      mockPage.url = new URL('https://gallery.test/photos');

      renderPage();
      await fireEvent.click(await screen.findByTestId('filter-panel-set-year'));

      // goto() is mocked, so land page.url on the page's own write the way SvelteKit would.
      await waitFor(() => expect(goto).toHaveBeenCalled());
      const [target] = vi.mocked(goto).mock.calls.at(-1) as [string];
      mockPage.url = new URL(target, 'https://gallery.test');
      await waitFor(() =>
        expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'),
      );

      // Closing the asset viewer: replaceScrollTarget appends `at` to the CURRENT url. This is a raw
      // property set (not a fireEvent), so nothing implicitly flushes the pending $effect — tick()
      // forces that flush. A plain waitFor here would be vacuous: its own first synchronous check
      // runs BEFORE the effect flushes and sees the still-2015 value, so it would pass whether or
      // not the bug is present.
      const withAt = new URL(mockPage.url);
      withAt.searchParams.set('at', 'asset-1');
      mockPage.url = withAt;
      await tick();

      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
      expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2015-01-01T00:00:00.000Z"');
    });
  });

  // Slice 6 — a pasted/reloaded `/photos?albumId=<uuid>` has no session-cached name and no
  // suggestions feeder to name the album from, so the chip label comes from a by-id lookup. The bar
  // stub labels exactly like the real one (`albumNames.get(id) ?? id`), so a page that failed to
  // pass or fill the map would show the UUID here.
  describe('Slice 6: album / owner chip names', () => {
    const ALBUM_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

    it('labels the album chip with the album NAME, not the raw id', async () => {
      sdkMock.getAlbumInfo.mockResolvedValue({ id: ALBUM_ID, albumName: 'Iceland 2026' } as never);
      mockPage.url = new URL(`https://gallery.test/photos?albumId=${ALBUM_ID}`);

      renderPage();

      await waitFor(() => {
        expect(sdkMock.getAlbumInfo).toHaveBeenCalledWith({ id: ALBUM_ID });
        expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-album-label', 'Iceland 2026');
      });
    });

    it('labels the owner chip with the user NAME, resolved by id', async () => {
      sdkMock.getUser.mockResolvedValue({ id: OWNER_ID, name: 'Ada Lovelace' } as never);
      mockPage.url = new URL(`https://gallery.test/photos?owner=${OWNER_ID}`);

      renderPage();

      await waitFor(() => {
        expect(sdkMock.getUser).toHaveBeenCalledWith({ id: OWNER_ID });
        expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-owner-label', 'Ada Lovelace');
      });
    });

    it('keeps the id as the label — and the page alive — when the lookup fails', async () => {
      sdkMock.getAlbumInfo.mockRejectedValue(new Error('403'));
      mockPage.url = new URL(`https://gallery.test/photos?albumId=${ALBUM_ID}`);

      renderPage();

      await waitFor(() => expect(sdkMock.getAlbumInfo).toHaveBeenCalled());
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-album-label', ALBUM_ID);
    });
  });
});
