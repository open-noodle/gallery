import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { buildRecentlyAddedTimelineOptions } from '#lib/utils/recently-added-filter-options.ts';
import { AssetTypeEnum } from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { SvelteURL } from 'svelte/reactivity';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { goto } from '$app/navigation';
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
      // The timeline / picker queries send `userId` as the view's owner gate (D3), so the page
      // reads authManager.user.id.
      user: { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' },
      preferences: { tags: { enabled: false } },
    },
    mockRegisterSearchablePageFilters: vi.fn(() => vi.fn()),
  }),
);

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$app/state', () => ({ page: mockPage, navigating: { to: null } }));

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/ActionMenuItem.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/active-filters-bar-actions.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/bindable-filter-panel.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/search/smart-search-results.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/smart-search-results.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/context-menu/ButtonContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/shared-components/EmptyPlaceholder.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } =
    await import('../../../albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/LinkLivePhotoAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/StackAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('#lib/managers/asset-viewer-manager.svelte.js', () => ({
  assetViewerManager: { isViewing: false },
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: mockAuthManager,
}));

vi.mock('#lib/managers/global-search-manager.svelte.js', () => ({
  globalSearchManager: {
    registerSearchablePageFilters: mockRegisterSearchablePageFilters,
  },
}));

vi.mock('#lib/services/asset.service.js', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('#lib/utils/file-uploader.js', () => ({
  openFileUploadDialog: vi.fn(),
}));

vi.mock('#lib/utils/recently-added-filter-options.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/recently-added-filter-options.ts')>();
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
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
    });
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
    sdkMock.getTimeBuckets.mockResolvedValue([]);
  });

  it('derives timeline options from the filters — orderBy CreatedAt, no withSharedSpaces', async () => {
    await renderPage();

    await vi.waitFor(() => expect(buildRecentlyAddedTimelineOptions).toHaveBeenCalled());
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"orderBy":"createdAt"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"withSharedSpaces"');
  });

  it('fetches the temporal picker buckets by taken date, not by added date', async () => {
    // The timeline groups by added date (orderBy createdAt) — but the year/month grid must be
    // built from taken-date buckets, because clicking a year filters on takenAfter/takenBefore.
    // Sourcing the grid from the timeline's own buckets listed upload years that then matched
    // nothing.
    await renderPage();

    await vi.waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalled());
    expect(sdkMock.getTimeBuckets.mock.calls[0][0]).toMatchObject({ orderBy: 'takenAt' });
    expect(sdkMock.getTimeBuckets.mock.calls[0][0]).not.toHaveProperty('withSharedSpaces');
  });

  it('rescopes the picker buckets when another filter changes', async () => {
    // Each year chip carries a count, so the grid has to describe the currently filtered set.
    await renderPage();

    await vi.waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalled());
    await userEvent.click(page.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => {
      expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'Germany', orderBy: 'takenAt' }),
        expect.anything(),
      );
    });
  });

  it('seeds filter state from the URL on load (deep link, e.g. ?rating=5)', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?rating=5');

    await renderPage();

    await vi.waitFor(() =>
      expect(buildRecentlyAddedTimelineOptions).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 5 }),
        expect.any(String),
      ),
    );
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"rating":5');
  });

  it('writes filter changes to the URL via goto', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(goto).toHaveBeenCalled());
    expect(goto).toHaveBeenCalledWith('/recently-added?country=Germany', {
      replace: true,
      reset: false,
    });
  });

  it('clearing all filters removes the filter params from the URL', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?people=person-1&city=Berlin');

    await renderPage();
    await userEvent.click(page.getByTestId('active-filters-clear-all'));

    await vi.waitFor(() => expect(goto).toHaveBeenCalled());
    expect(goto).toHaveBeenLastCalledWith('/recently-added', {
      replace: true,
      reset: false,
    });
  });

  it('registers its filters with globalSearchManager (registerSearchablePageFilters called)', async () => {
    await renderPage();

    await vi.waitFor(() => expect(mockRegisterSearchablePageFilters).toHaveBeenCalledOnce());
  });

  // #1051: deliberately NO scoped search button here. Recently Added is an ORDERING
  // (orderBy: CreatedAt), not a set — the search it launches carries no recency predicate
  // (see <SmartSearchResults> in +page.svelte: filters + withSharedSpaces only), so a
  // "Search here" affordance would promise a scope the page does not have and hand back
  // ten-year-old photos.
  it('has no scoped search button, because the page is an ordering rather than a scope', async () => {
    await renderPage();

    await expect.element(page.getByTestId('filter-panel-stub')).toBeInTheDocument();
    expect(page.getByTestId('scoped-search-button').query()).toBeNull();
  });

  it('passes all ten sections to the filter panel', async () => {
    await renderPage();

    const panel = page.getByTestId('filter-panel-stub');

    await expect
      .element(panel)
      .toHaveAttribute('data-sections', 'timeline,people,location,camera,tags,rating,media,favorites,albums,text');
  });
});

describe('Recently Added page query mode', () => {
  beforeAll(async () => {
    // Global test setup (`test/unit/setup.ts`) only inits the `dev` fallback locale, which
    // returns raw i18n keys — fine for tests that never inspect translated text, but the header
    // count's `$t('items_count', { values: { count } })` needs real ICU plural interpolation to
    // tell "12 items" apart from "2 items". Load the real English bundle, mirroring
    // `recent-row.spec.ts`'s precedent for the same `items_count` key.
    register('en-US', () => import('#i18n/en.json'));
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
      hasFavorites: false,
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
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
      hasFavorites: true,
      hasAssetsInAlbum: true,
      hasAssetsNotInAlbum: true,
    });
  });

  it('renders SmartSearchResults instead of the timeline when the URL carries ?q=', async () => {
    await renderPage();

    await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
    await expect.element(page.getByTestId('timeline-options')).not.toBeInTheDocument();
  });

  it('does not send shared-space scope to SmartSearchResults', async () => {
    await renderPage();

    await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-with-shared-spaces', 'false');
  });

  it('omits withSharedSpaces from the real searchSmartFacets payload', async () => {
    await renderPage();

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    expect(sdkMock.searchSmartFacets.mock.calls[0][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('stays in browse mode for a blank/whitespace-only query', async () => {
    mockPage.url = new URL('https://gallery.test/recently-added?q=%20%20');

    await renderPage();

    expect(page.getByTestId('smart-search-results').query()).toBeNull();
    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
    expect(page.getByTestId('smart-search-results').query()).toBeNull();
    expect(sdkMock.searchSmartFacets).not.toHaveBeenCalled();
  });

  it('the header count uses the search total in query mode, not timelineManager.assetCount', async () => {
    await renderPage();

    await expect.element(page.getByTestId('user-page-layout')).toHaveAttribute('data-description', '12 items');
  });

  it('a failed facet fetch falls back to the previous facets (count survives)', async () => {
    await renderPage();
    await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-total', '12');

    sdkMock.searchSmartFacets.mockRejectedValueOnce(new Error('facets failed'));
    await userEvent.click(page.getByTestId('filter-panel-set-country'));

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(2));
    expect(page.getByTestId('smart-search-results').element()).toHaveAttribute('data-total', '12');
  });

  it('rejects rather than reporting an empty library when the facet fetch fails (#910)', async () => {
    sdkMock.searchSmartFacets.mockRejectedValue(new Error('boom'));

    await renderPage();

    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalled());
    // The stub's suggestionsProvider effect sets data-suggestions to 'error' on rejection, and to a
    // JSON dump of the resolved value otherwise — an empty-sentinel resolution would show up here as
    // JSON, not 'error'. #910: on a first-ever failure (no previous smartFacets to fall back to), the
    // provider must reject rather than resolve with a fabricated empty response.
    await expect.element(page.getByTestId('filter-panel-stub')).toHaveAttribute('data-suggestions', 'error');
  });

  it('re-rendering with an unchanged query+filters does not refetch facets (key cache)', async () => {
    await renderPage();
    await vi.waitFor(() => expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1));

    await userEvent.click(page.getByTestId('filter-panel-set-sort-asc'));

    await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-sort-order', 'asc');
    expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
  });

  it('remounts the filter panel on the browse-to-query transition, dropping the stale baseline (#910)', async () => {
    mockPage.url = new SvelteURL('https://gallery.test/recently-added');

    await renderPage();
    await vi.waitFor(() => expect(sdkMock.getFilterSuggestions).toHaveBeenCalled());
    await userEvent.click(page.getByTestId('load-baseline'));
    await expect.element(page.getByTestId('filter-panel-stub')).not.toHaveAttribute('data-baseline', 'not-loaded');

    // Commit a query without unmounting the page: the panel's {#key} must remount it so the
    // browse-mode baseline (cached on the stub for the component's lifetime) doesn't survive into
    // query mode, where §4.5 says the baseline provider must return undefined.
    mockPage.url.search = '?q=beach';

    await expect.element(page.getByTestId('filter-panel-stub')).toHaveAttribute('data-baseline', 'not-loaded');
  });
});
