import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { AssetTypeEnum, AssetVisibility, SharedSpaceRole } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { lang } from '$lib/stores/preferences.store';
import { buildSpaceTimelineOptions } from '$lib/utils/space-filter-options';
import { storeTypedSearchNames } from '$lib/utils/typed-search/typed-search-name-cache';
import SpacesPage from './+page.svelte';

const OVER_SPACE_ASSET_LIMIT = 50_001;

const {
  gotoMock,
  mockPage,
  mockAssetMultiSelectManager,
  mockAuthManager,
  mockEventManager,
  mockRegisterSelectionContext,
  mockRegisterSpaceContext,
  mockRegisterSearchablePageFilters,
} = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  mockPage: {
    url: new URL('https://gallery.test/spaces/space-1/photos'),
    route: { id: '/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]' },
    params: { spaceId: 'space-1' },
  },
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [] as TimelineAsset[],
    clear: vi.fn(),
    isAllUserOwned: true,
  },
  mockAuthManager: {
    user: { id: 'user-1', isAdmin: false, name: 'Owner', email: 'owner@example.com' },
  },
  mockEventManager: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  mockRegisterSelectionContext: vi.fn(),
  mockRegisterSpaceContext: vi.fn(),
  mockRegisterSearchablePageFilters: vi.fn(() => vi.fn()),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockIconButton } = await import('./mock-icon-button.test-wrapper.svelte');
  return {
    ...actual,
    IconButton: MockIconButton,
    modalManager: {
      show: vi.fn(),
      showDialog: vi.fn(),
    },
    toastManager: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/bindable-filter-panel.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/active-filters-bar-actions.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/search-sort-dropdown.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/sort-toggle.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/sort-toggle.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/search/smart-search-results.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/smart-search-results.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/ControlAppBar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-control-app-bar.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('./mock-button-context-menu.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/spaces/space-map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/spaces/space-panel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));
vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerSelectionContext: mockRegisterSelectionContext,
  registerSpaceContext: mockRegisterSpaceContext,
}));
vi.mock('$lib/managers/event-manager.svelte', () => ({ eventManager: mockEventManager }));
vi.mock('$lib/managers/global-search-manager.svelte', () => ({
  globalSearchManager: {
    registerSearchablePageFilters: mockRegisterSearchablePageFilters,
  },
}));
vi.mock('$lib/utils/space-hero-storage', () => ({
  loadHeroCollapsed: vi.fn().mockReturnValue(false),
  persistHeroCollapsed: vi.fn(),
}));

vi.mock('$lib/utils/space-filter-options', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/space-filter-options')>();
  return {
    ...actual,
    buildSpaceTimelineOptions: vi.fn(actual.buildSpaceTimelineOptions),
  };
});

function makeSpace(overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto {
  return {
    id: 'space-1',
    name: 'Test Space',
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assetCount: 3,
    memberCount: 1,
    faceRecognitionEnabled: false,
    hasPets: false,
    petsEnabled: false,
    color: 'primary',
    recentAssetIds: [],
    recentAssetThumbhashes: [],
    members: [],
    thumbnailAssetId: null,
    thumbnailCropY: null,
    newAssetCount: 0,
    ...overrides,
  } as SharedSpaceResponseDto;
}

function makeMember(overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto {
  return {
    userId: 'user-1',
    email: 'owner@example.com',
    name: 'Owner',
    role: SharedSpaceRole.Owner,
    showInTimeline: true,
    sharePersonMetadata: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    contributionCount: 0,
    ...overrides,
  };
}

function makeTimelineAsset(overrides: Partial<TimelineAsset> = {}): TimelineAsset {
  return {
    id: 'asset-1',
    ownerId: 'user-1',
    ratio: 1,
    thumbhash: null,
    localDateTime: '2026-01-01T00:00:00.000Z',
    fileCreatedAt: '2026-01-01T00:00:00.000Z',
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    isVideo: false,
    isImage: true,
    stack: null,
    duration: null,
    projectionType: null,
    livePhotoVideoId: null,
    city: null,
    country: null,
    people: null,
    ...overrides,
  } as unknown as TimelineAsset;
}

function renderPage(overrides: { space?: SharedSpaceResponseDto; members?: SharedSpaceMemberResponseDto[] } = {}) {
  const props = {
    data: {
      space: overrides.space ?? makeSpace(),
      members: overrides.members ?? [makeMember()],
      meta: { title: 'Test Space' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof SpacesPage; componentProps: typeof props }>, {
    component: SpacesPage,
    componentProps: props,
  });
}

describe('Spaces page search URL state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');
    lang.set('de');
    mockRegisterSearchablePageFilters.mockReturnValue(vi.fn());
    sessionStorage.clear();
    vi.mocked(sdkMock.markSpaceViewed).mockResolvedValue(void 0 as never);
    sdkMock.addAssets.mockResolvedValue(void 0 as never);
    sdkMock.updateMemberPreferences.mockResolvedValue(makeMember({ sharePersonMetadata: false }));
    sdkMock.updateMemberTimeline.mockResolvedValue(makeMember({ showInTimeline: false }));
    sdkMock.getSpace.mockResolvedValue(makeSpace());
    sdkMock.getSpaceActivities.mockResolvedValue([]);
    sdkMock.getSpacePeople.mockResolvedValue([]);
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
      total: 7,
      timeBuckets: [{ timeBucket: '2024-03-01', count: 7 }],
      countries: ['Norway'],
      cities: ['Bergen'],
      cameraMakes: ['Fuji'],
      cameraModels: ['X-T5'],
      tags: [{ id: 'tag-1', value: 'Hike' }],
      people: [{ id: 'space-person-1', name: 'Ada' }],
      ratings: [5],
      mediaTypes: [AssetTypeEnum.Image],
      hasUnnamedPeople: false,
    });
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
  });

  it('renders search results from q without a local search input', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');

    renderPage();

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sort-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'relevance');
  });

  it('hydrates an explicit search sort from the URL', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&sort=asc');

    renderPage();

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sort-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc');
  });

  it('hydrates typed filter URL params into the space FilterState', async () => {
    mockPage.url = new URL(
      'https://gallery.test/spaces/space-1/photos?q=beach&people=space-person-1&city=Berlin&type=video',
    );

    renderPage({ space: makeSpace(), members: [makeMember()] });

    expect(await screen.findByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-person-ids', 'space-person-1');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-city', 'Berlin');
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-media-type', 'video');
  });

  it('removes only the selected typed filter from the space URL', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&people=person-1&city=Berlin');

    renderPage({ space: makeSpace(), members: [makeMember()] });
    await fireEvent.click(await screen.findByTestId('active-filters-remove-person'));

    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/photos?q=beach&city=Berlin', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('syncs the URL when a location typed filter is cleared from the space filter panel', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?city=New+York+City');

    renderPage({ space: makeSpace(), members: [makeMember()] });
    await fireEvent.click(screen.getByTestId('filter-panel-clear-location'));

    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/photos', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('exposes favorites in the spaces filter panel', () => {
    renderPage();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-sections',
      'timeline,people,location,camera,tags,rating,media,favorites,albums,text',
    );
  });

  it('hydrates has-no-album from the space URL into search results', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&album=none');

    renderPage();

    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-not-in-album', 'true');
  });

  it('hydrates has-album from the space URL into search results', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&album=has');

    renderPage();

    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-in-album', 'true');
  });

  it('registers current space filters for global sort changes', async () => {
    renderPage();
    await waitFor(() => expect(mockRegisterSearchablePageFilters).toHaveBeenCalledOnce());
    const calls = mockRegisterSearchablePageFilters.mock.calls as unknown as Array<[() => FilterState]>;
    const getFilters = calls[0][0];

    expect(getFilters().isFavorite).toBeUndefined();
    expect(getFilters().sortOrder).toBe('desc');
    await fireEvent.click(screen.getByTestId('select-favorites-filter'));

    await waitFor(() => expect(getFilters()).toMatchObject({ isFavorite: true, sortOrder: 'desc' }));
  });

  it('passes typed search names into the space filter panel', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-cat&tags=tag-nature');
    storeTypedSearchNames('/spaces/space-1/photos?people=person-cat&tags=tag-nature', {
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

  it('updates current member metadata sharing from the space menu', async () => {
    renderPage();

    await fireEvent.click(screen.getByText('spaces_stop_sharing_person_metadata'));

    expect(sdkMock.updateMemberPreferences).toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceMemberPreferencesDto: { sharePersonMetadata: false },
    });
    await waitFor(() => expect(screen.getByText('spaces_share_person_metadata')).toBeInTheDocument());
  });

  it('keeps timeline visibility on the legacy endpoint', async () => {
    renderPage();

    await fireEvent.click(screen.getByText('spaces_hide_from_timeline'));

    expect(sdkMock.updateMemberTimeline).toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceMemberTimelineDto: { showInTimeline: false },
    });
    await waitFor(() => expect(screen.getByText('spaces_show_on_timeline')).toBeInTheDocument());
  });

  it('narrows space search results and facets to favorites within the space when selected', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');

    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByTestId('select-favorites-filter'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-is-favorite', 'true');
      expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-space-id', 'space-1');
      expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2);
    });
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'beach',
      isFavorite: true,
      spaceId: 'space-1',
    });
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('narrows space suggestions and dependent providers to has-no-album when selected', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-no-album-filter'));
    await fireEvent.click(screen.getByTestId('load-city-suggestions'));
    await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

    await waitFor(() => {
      expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', isNotInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', spaceId: 'space-1', isNotInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Sony', spaceId: 'space-1', isNotInAlbum: true }),
      );
    });
  });

  it('narrows space suggestions and dependent providers to has-album when selected', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-album-filter'));
    await fireEvent.click(screen.getByTestId('load-city-suggestions'));
    await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

    await waitFor(() => {
      expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', isInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', spaceId: 'space-1', isInAlbum: true }),
      );
      expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Sony', spaceId: 'space-1', isInAlbum: true }),
      );
    });
  });

  it('fetches smart facets with spaceId for committed space search', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');

    renderPage();

    await vi.waitFor(() => {
      expect(sdkMock.searchSmartFacets).toHaveBeenCalledWith(
        {
          smartSearchFacetsDto: expect.objectContaining({
            query: 'beach',
            language: 'de',
            spaceId: 'space-1',
          }),
        },
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });
    await vi.waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '7'));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-language', 'de');
  });

  it('does not include withSharedSpaces or order in the space facets payload', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&sort=asc');

    renderPage();

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    const dto = sdkMock.searchSmartFacets.mock.calls[0][0].smartSearchFacetsDto;
    expect(dto).not.toHaveProperty('withSharedSpaces');
    expect(dto).not.toHaveProperty('order');
  });

  it('does not fetch smart facets when the committed space query is whitespace only', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=%20%20');

    renderPage();

    expect(screen.queryByTestId('smart-search-results')).not.toBeInTheDocument();
    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
  });

  it('does not refetch space smart facets for sort-only filter changes', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');

    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('filter-panel-set-sort-asc'));

    await waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc'));
    expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
  });

  it('uses smart facet timeBuckets in space search mode', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');

    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
        'data-time-buckets',
        JSON.stringify([{ timeBucket: '2024-03-01', count: 7 }]),
      );
    });
  });

  it('preserves previous space facet total and buckets when a later facet fetch fails', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');
    renderPage();
    await vi.waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '7'));

    sdkMock.searchSmartFacets.mockRejectedValueOnce(new Error('facets failed'));
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '7');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-time-buckets',
      JSON.stringify([{ timeBucket: '2024-03-01', count: 7 }]),
    );
  });

  it('refetches space smart facets when an active filter changes', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'beach',
      country: 'Germany',
      spaceId: 'space-1',
    });
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-country', 'Germany');
  });

  it('refetches space smart facets when the search language changes', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach');
    renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    lang.set('fr');

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(sdkMock.searchSmartFacets.mock.calls[1][0].smartSearchFacetsDto).toMatchObject({
      query: 'beach',
      language: 'fr',
      spaceId: 'space-1',
    });
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-language', 'fr');
  });

  it('space cmdk add-photos command enters select-assets mode for writable users', async () => {
    renderPage();
    const options = mockRegisterSpaceContext.mock.calls[0][2];
    const addPhotosToCurrentSpace = options.getAddPhotosToCurrentSpace();

    expect(addPhotosToCurrentSpace).toEqual(expect.any(Function));
    addPhotosToCurrentSpace?.();

    await waitFor(() => expect(screen.getByLabelText('add_to_space')).toBeInTheDocument());
    expect(options.getAddPhotosToCurrentSpace()).toBeUndefined();
  });

  it('registers normal space view favorite/archive callbacks and no add-to-current-space', () => {
    renderPage();

    expect(mockRegisterSelectionContext).toHaveBeenCalledOnce();
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    expect(options.canAddToAlbum()).toBe(false);
    expect(options.getAssets()).toBe(mockAssetMultiSelectManager.assets);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete?.()).toBeUndefined();
    expect(options.getAddSelectedToCurrentSpace()).toBeUndefined();
  });

  it('select-assets mode exposes only addSelectedToCurrentSpace for writable users', async () => {
    renderPage();
    const options = mockRegisterSelectionContext.mock.calls[0][0];

    await fireEvent.click(screen.getByLabelText('add_photos'));

    await waitFor(() => expect(options.getAddSelectedToCurrentSpace()).toEqual(expect.any(Function)));
    expect(options.getOnFavorite()).toBeUndefined();
    expect(options.getOnArchive()).toBeUndefined();
    expect(options.getOnDelete?.()).toBeUndefined();
  });

  it('viewer users cannot expose addSelectedToCurrentSpace', () => {
    renderPage({
      members: [makeMember({ role: SharedSpaceRole.Viewer })],
    });
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    const spaceOptions = mockRegisterSpaceContext.mock.calls[0][2];

    expect(screen.queryByLabelText('add_photos')).not.toBeInTheDocument();
    expect(options.getAddSelectedToCurrentSpace()).toBeUndefined();
    expect(spaceOptions.getAddPhotosToCurrentSpace()).toBeUndefined();
  });

  it('addSelectedToCurrentSpace rejects empty and over-limit selections', async () => {
    renderPage();
    const options = mockRegisterSelectionContext.mock.calls[0][0];
    await fireEvent.click(screen.getByLabelText('add_photos'));
    const addSelected = options.getAddSelectedToCurrentSpace() as () => Promise<boolean>;

    mockAssetMultiSelectManager.assets = [];
    await expect(addSelected()).resolves.toBe(false);

    mockAssetMultiSelectManager.assets = Array.from({ length: OVER_SPACE_ASSET_LIMIT }, (_, index) =>
      makeTimelineAsset({ id: `asset-${index}` }),
    );
    await expect(addSelected()).resolves.toBe(false);
    expect(sdkMock.addAssets).not.toHaveBeenCalled();
  });

  it('addSelectedToCurrentSpace and plus button share the awaited helper', async () => {
    renderPage();
    mockAssetMultiSelectManager.assets = [makeTimelineAsset({ id: 'asset-1' })];
    const options = mockRegisterSelectionContext.mock.calls[0][0];

    await fireEvent.click(screen.getByLabelText('add_photos'));
    const addSelected = options.getAddSelectedToCurrentSpace() as () => Promise<boolean>;
    await expect(addSelected()).resolves.toBe(true);
    expect(sdkMock.addAssets).toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceAssetAddDto: { assetIds: ['asset-1'] },
    });
    expect(mockEventManager.emit).toHaveBeenCalledWith('SpaceAddAssets', { assetIds: ['asset-1'], spaceId: 'space-1' });
    expect(mockAssetMultiSelectManager.clear).toHaveBeenCalled();

    vi.clearAllMocks();
    sdkMock.addAssets.mockResolvedValue(void 0 as never);
    sdkMock.getSpace.mockResolvedValue(makeSpace());
    sdkMock.getSpaceActivities.mockResolvedValue([]);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [makeTimelineAsset({ id: 'asset-2' })];
    await fireEvent.click(screen.getByLabelText('add_photos'));
    mockAssetMultiSelectManager.selectionActive = true;
    await fireEvent.click(screen.getByLabelText('add_to_space'));
    expect(sdkMock.addAssets).toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceAssetAddDto: { assetIds: ['asset-2'] },
    });
  });

  it('passes default day grouping into space timeline options', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    });
  });

  it('clicking a space year bucket zooms without mutating filters or URL state', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
    expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
      'space-1',
      expect.objectContaining({
        personIds: ['person-1'],
        selectedYear: undefined,
        selectedMonth: undefined,
        dateAfter: undefined,
        dateBefore: undefined,
      }),
    );
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('passes description/filename/ocr text filters into space timeline options from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?description=beach&filename=IMG&ocr=invoice');

    renderPage();

    await waitFor(() => {
      expect(buildSpaceTimelineOptions).toHaveBeenCalledWith(
        'space-1',
        expect.objectContaining({ description: 'beach', originalFileName: 'IMG', ocr: 'invoice' }),
      );
    });
  });

  it('clicking a space month bucket zooms without mutating filters or URL state', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
    });
    expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
      'space-1',
      expect.objectContaining({
        personIds: ['person-1'],
        selectedYear: undefined,
        selectedMonth: undefined,
        dateAfter: undefined,
        dateBefore: undefined,
      }),
    );
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('keeps explicit space temporal filters transient across URL sync for non-time filter changes', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
    expect(gotoMock).toHaveBeenLastCalledWith('/spaces/space-1/photos?country=Germany', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('lets explicit custom space date filters apply and clear a pending zoom anchor', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(buildSpaceTimelineOptions).toHaveBeenLastCalledWith(
      'space-1',
      expect.objectContaining({
        dateAfter: '2024-01-01',
        dateBefore: '2024-12-31',
        selectedYear: undefined,
        selectedMonth: undefined,
      }),
    );
  });

  it('clearing an explicit space temporal chip keeps the current grouping and clears the anchor', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
  });

  it('select-assets mode keeps space timeline options without grouping', async () => {
    renderPage();

    await fireEvent.click(screen.getByLabelText('add_photos'));

    await waitFor(() => {
      const optionsText = screen.getByTestId('timeline-options').textContent ?? '';
      expect(optionsText).toContain('"visibility":"timeline"');
      expect(optionsText).toContain('"timelineSpaceId":"space-1"');
      expect(optionsText).not.toContain('"grouping"');
    });
  });

  it('ignores space bucket activation outside view mode', async () => {
    renderPage();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      const optionsText = screen.getByTestId('timeline-options').textContent ?? '';
      expect(optionsText).not.toContain('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
  });

  it('select-cover mode switches grouped timelines back to day mode so photos remain selectable', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));
    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    });

    await fireEvent.click(screen.getByTestId('hero-set-cover-button'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
        JSON.stringify({ grouping: 'day', hasHandler: true }),
      );
    });
  });

  it('renders a desktop grouping control on the space browse timeline', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes space grouping from the desktop control without changing filters or URL params', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1');

    renderPage();
    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(gotoMock).not.toHaveBeenCalledWith(expect.stringContaining('selectedYear'), expect.anything());
  });

  it('does not render grouping controls in space select-assets mode', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();
    await fireEvent.click(screen.getByLabelText('add_photos'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"grouping"');
    });
    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('shows grouping and the filters bar in one merged toolbar (no separate spacing wrapper)', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?country=Germany');

    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('active-filters-bar-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-active-filters-bar-spacing')).toBeNull();
  });

  it('keeps active filters visually separated from grouped space timeline cards', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

    renderPage();

    const groupingControl = await screen.findByTestId('timeline-desktop-grouping-control');
    const toolbarRoot = groupingControl.parentElement!;
    expect(toolbarRoot).toHaveClass('mb-2');
  });

  it('does not show the desktop grouping control during space search results', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=nature');

    renderPage();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('shows the filtered empty state for a filtered space timeline with no assets', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=empty-person');

    renderPage();

    expect(screen.getByTestId('empty-state-message')).toHaveTextContent('spaces_no_filtered_assets');
    expect(screen.queryByTestId('timeline-stub')).not.toBeInTheDocument();
  });

  it('passes grouping state and change handler into the space Timeline for mobile placement', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

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
    mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=person-cat&tags=tag-nature');

    renderPage();

    const bar = await screen.findByTestId('active-filters-bar-stub');
    expect(bar).toHaveAttribute('data-has-add-all', 'true');
  });
});
