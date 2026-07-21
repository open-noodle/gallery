import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { buildRecentlyAddedTimelineOptions } from '$lib/utils/recently-added-filter-options';
import RecentlyAddedPage from './+page.svelte';

const { mockPage, mockAssetMultiSelectManager, mockAuthManager, mockRegisterSearchablePageFilters } = vi.hoisted(
  () => ({
    mockPage: {
      url: new URL('https://gallery.test/recently-added'),
      route: { id: '/(user)/recently-added/[[photos=photos]]/[[assetId=id]]' },
      params: {},
    },
    mockAssetMultiSelectManager: {
      selectionActive: false,
      assets: [],
      clear: vi.fn(),
      isAllUserOwned: true,
    },
    mockAuthManager: {
      preferences: { tags: { enabled: false } },
    },
    mockRegisterSearchablePageFilters: vi.fn(() => vi.fn()),
  }),
);

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/state', () => ({ page: mockPage }));

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
    await import('../../../albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte');
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

vi.mock('$lib/managers/global-search-manager.svelte', () => ({
  globalSearchManager: {
    registerSearchablePageFilters: mockRegisterSearchablePageFilters,
  },
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('$lib/utils/file-uploader', () => ({
  openFileUploadDialog: vi.fn(),
}));

vi.mock('$lib/utils/recently-added-filter-options', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/recently-added-filter-options')>();
  return {
    ...actual,
    buildRecentlyAddedTimelineOptions: vi.fn(actual.buildRecentlyAddedTimelineOptions),
  };
});

type RecentlyAddedPageProps = { data: { meta: { title: string } } };

function renderPage() {
  return render(
    TestWrapper as Component<{ component: typeof RecentlyAddedPage; componentProps: RecentlyAddedPageProps }>,
    {
      component: RecentlyAddedPage,
      componentProps: { data: { meta: { title: 'Recently added' } } },
    },
  );
}

describe('Recently Added page filters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPage.url = new URL('https://gallery.test/recently-added');
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockRegisterSearchablePageFilters.mockReturnValue(vi.fn());
    sdkMock.getFilterSuggestions.mockResolvedValue({
      people: [],
      countries: [],
      cameraMakes: [],
      tags: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
    sdkMock.getTimeBuckets.mockResolvedValue([]);
  });

  it('derives timeline options from the filters — orderBy CreatedAt, no withSharedSpaces', async () => {
    renderPage();

    await waitFor(() => {
      expect(buildRecentlyAddedTimelineOptions).toHaveBeenCalled();
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"orderBy":"createdAt"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"withSharedSpaces"');
    });
  });

  it('fetches the temporal picker buckets by taken date, not by added date', async () => {
    // The timeline groups by added date (orderBy createdAt) — but the year/month grid must be
    // built from taken-date buckets, because clicking a year filters on takenAfter/takenBefore.
    // Sourcing the grid from the timeline's own buckets listed upload years that then matched
    // nothing.
    renderPage();

    await waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalled());
    expect(sdkMock.getTimeBuckets.mock.calls[0][0]).toMatchObject({ orderBy: 'takenAt' });
    expect(sdkMock.getTimeBuckets.mock.calls[0][0]).not.toHaveProperty('withSharedSpaces');
  });

  it('rescopes the picker buckets when another filter changes', async () => {
    // Each year chip carries a count, so the grid has to describe the currently filtered set.
    renderPage();

    await waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalled());
    await fireEvent.click(await screen.findByTestId('filter-panel-set-country'));

    await waitFor(() => {
      expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', orderBy: 'takenAt' }),
        expect.anything(),
      );
    });
  });

  it('seeds filter state from the URL on load (deep link, e.g. ?rating=5)', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?rating=5');

    renderPage();

    await waitFor(() => {
      expect(buildRecentlyAddedTimelineOptions).toHaveBeenCalledWith(expect.objectContaining({ rating: 5 }));
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"rating":5');
    });
  });

  it('writes filter changes to the URL via goto', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('filter-panel-set-country'));

    expect(goto).toHaveBeenCalledWith('/recently-added?country=Germany', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('clearing all filters removes the filter params from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?people=person-1&city=Berlin');

    renderPage();
    await fireEvent.click(await screen.findByTestId('active-filters-clear-all'));

    expect(goto).toHaveBeenLastCalledWith('/recently-added', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('registers its filters with globalSearchManager (registerSearchablePageFilters called)', async () => {
    renderPage();

    await waitFor(() => expect(mockRegisterSearchablePageFilters).toHaveBeenCalledOnce());
  });

  it('passes all ten sections to the filter panel', async () => {
    renderPage();

    const panel = await screen.findByTestId('filter-panel-stub');

    expect(panel).toHaveAttribute(
      'data-sections',
      'timeline,people,location,camera,tags,rating,media,favorites,albums,text',
    );
  });
});

describe('Recently Added page query mode', () => {
  beforeAll(async () => {
    // Global test setup (`src/test-data/setup.ts`) only inits the `dev` fallback locale, which
    // returns raw i18n keys — fine for tests that never inspect translated text, but the header
    // count's `$t('items_count', { values: { count } })` needs real ICU plural interpolation to
    // tell "12 items" apart from "2 items". Load the real English bundle, mirroring
    // `recent-row.spec.ts`'s precedent for the same `items_count` key.
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockPage.url = new URL('https://gallery.test/recently-added?q=beach');
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockRegisterSearchablePageFilters.mockReturnValue(vi.fn());
    sdkMock.getFilterSuggestions.mockResolvedValue({
      people: [],
      countries: [],
      cameraMakes: [],
      tags: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
    sdkMock.getTimeBuckets.mockResolvedValue([]);
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
  });

  it('renders SmartSearchResults instead of the timeline when the URL carries ?q=', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    });
    expect(screen.queryByTestId('timeline-options')).not.toBeInTheDocument();
  });

  it('does not send shared-space scope to SmartSearchResults', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-with-shared-spaces', 'false');
    });
  });

  it('omits withSharedSpaces from the real searchSmartFacets payload', async () => {
    renderPage();

    await waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    expect(sdkMock.searchSmartFacets.mock.calls[0][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('stays in browse mode for a blank/whitespace-only query', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?q=%20%20');

    renderPage();

    expect(screen.queryByTestId('smart-search-results')).not.toBeInTheDocument();
    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
    await waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
  });

  it('the header count uses the search total in query mode, not timelineManager.assetCount', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-description', '12 items');
    });
  });

  it('a failed facet fetch falls back to the previous facets (count survives)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12'));

    sdkMock.searchSmartFacets.mockRejectedValueOnce(new Error('facets failed'));
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12');
  });

  it('re-rendering with an unchanged query+filters does not refetch facets (key cache)', async () => {
    renderPage();
    await waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTestId('filter-panel-set-sort-asc'));

    await waitFor(() => expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc'));
    expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
  });
});
