import TestWrapper from '#lib/components/TestWrapper.svelte';
import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { getAlbumInfoQuery } from '#lib/queries/album.query.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
import { factory } from '#test/unit/factories.ts';
import { defaultUserConfig } from '#test/unit/gallery-config-defaults.ts';
import { AlbumUserRole, AssetOrder } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import AlbumPage from './+page.svelte';

const {
  registerAlbumContextMock,
  registerSelectionContextMock,
  gotoMock,
  mockFeatureFlagsManager,
  mockOpenSearchPalette,
} = vi.hoisted(() => ({
  registerAlbumContextMock: vi.fn(),
  registerSelectionContextMock: vi.fn(),
  gotoMock: vi.fn(),
  mockFeatureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: { map: false } },
  mockOpenSearchPalette: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
  invalidate: vi.fn().mockResolvedValue(undefined),
  onNavigate: vi.fn(),
}));
// The mock module and the spec import the SAME singleton, so assigning mockPage.url in a test is
// what the page's $effect sees.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return {
    ...(await import('#test/unit/mocks/app-state.svelte.ts')),
    page: reactivePageMock,
    navigating: { to: null },
  };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockTimeline } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockTimeline };
});

vi.mock('#lib/components/search/smart-search-results.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/smart-search-results.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/managers/global-search-manager.svelte.js', () => ({
  globalSearchManager: {
    // Returns a teardown, matching the real registration the page's $effect consumes.
    registerSearchablePageFilters: vi.fn(() => vi.fn()),
    open: mockOpenSearchPalette,
  },
}));

vi.mock('#lib/managers/command-context-manager.svelte.js', () => ({
  registerAlbumContext: registerAlbumContextMock,
  registerSelectionContext: registerSelectionContextMock,
}));

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: mockFeatureFlagsManager as never,
}));

// `#lib/utils/navigation.ts` is deliberately NOT mocked: the picker open/close handlers call the
// real navigate({ assetGridRouteSearchParams: { at } }), which routes into the real
// replaceScrollTarget/goto machinery against mockPage + gotoMock above. A no-op stub would hide the
// exact bug this suite regression-tests (album.e2e-spec.ts:150 — closing the add-photos picker
// silently drops the album's own filter query).

function renderPage(album = factory.album({ assetCount: 2 })) {
  const owner = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)?.user ?? album.albumUsers[0]?.user;
  authManager.setUser(factory.user({ id: owner?.id ?? 'album-owner' }));
  authManager.setPreferences(factory.preferences());

  sdkMock.getFilterSuggestions.mockImplementation((request: { albumId?: string } = {}) => {
    if (request.albumId) {
      const personName =
        request.albumId === 'album-2'
          ? 'Second Album Person'
          : request.albumId === 'album-1'
            ? 'First Album Person'
            : 'Album Person';
      const tagName =
        request.albumId === 'album-2'
          ? 'Second Album Tag'
          : request.albumId === 'album-1'
            ? 'First Album Tag'
            : 'Album Tag';
      return Promise.resolve({
        countries: [],
        cameraMakes: [],
        tags: [
          { id: 'tag-view', value: tagName },
          { id: 'tag-no-match', value: 'No Match' },
        ],
        people: [{ id: 'person-view', name: personName }],
        ratings: [5],
        mediaTypes: ['IMAGE'],
        hasUnnamedPeople: false,
        hasFavorites: true,
        hasAssetsInAlbum: true,
        hasAssetsNotInAlbum: true,
        hasNoGpsAssets: false,
        hasNoPlaceNameAssets: false,
      });
    }

    return Promise.resolve({
      countries: [],
      cameraMakes: [],
      tags: [
        { id: 'tag-picker', value: 'Picker Tag' },
        { id: 'tag-no-match', value: 'No Match' },
      ],
      people: [{ id: 'person-picker', name: 'Picker Person' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
      hasFavorites: true,
      hasAssetsInAlbum: true,
      hasAssetsNotInAlbum: true,
      hasNoGpsAssets: false,
      hasNoPlaceNameAssets: false,
    });
  });

  sdkMock.getSearchSuggestions.mockImplementation((() => Promise.resolve([] as string[])) as never);

  // The page reads its album from getAlbumInfoQuery (immich-32668), which +page.ts preloads.
  queryClient.setQueryData(getAlbumInfoQuery(album.id).queryKey, album);
  return render(TestWrapper, {
    component: AlbumPage,
    componentProps: { params: { albumId: album.id } },
  });
}

describe('album detail filter panel route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stand in for SvelteKit: a goto() actually changes page.url, which re-runs the page's URL
    // $effect. If the effect's lastHandled token guard is ever broken, this turns goto -> $effect ->
    // goto into a real loop and the test times out — which is the correct, loud failure.
    gotoMock.mockImplementation((href: string) => {
      mockPage.url = new URL(href, 'https://gallery.test');
      return Promise.resolve();
    });
    mockPage.reset('https://gallery.test/albums/album-1', {
      routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      params: { albumId: 'album-1' },
    });
    assetMultiSelectManager.clear();
    mockFeatureFlagsManager.value.map = false;
    // The map button follows the user config now (immich-32498), not the feature flags.
    queryClient.setQueryData(getUserConfigQuery().queryKey, {
      ...defaultUserConfig,
      map: { ...defaultUserConfig.map, enabled: false },
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('renders the filter panel in view mode and select-assets mode', async () => {
    await renderPage();

    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('hides the filter panel when the active dataset is empty and no filters are active', async () => {
    await renderPage(factory.album({ assetCount: 0 }));

    await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
  });

  // Unlike the pages built on UserPageLayout, this route's <main> is transparent, so the panel's
  // bg-light surface sits directly on the darker app background instead of blending into a card.
  // It therefore has to shape itself: rounded to the app's 16px surface radius and held off the
  // bottom edge, rather than running as a flush slab to the foot of the window.
  it('shapes the filter panel as a rounded card lifted off the bottom edge', async () => {
    await renderPage();

    await expect.element(page.getByTestId('filter-panel-shell')).toBeInTheDocument();

    const clip = page.getByTestId('album-filter-panel-surface').element();
    expect(clip.contains(page.getByTestId('filter-panel-shell').element())).toBe(true);
    // rounded-lg is 16px in this theme — the same radius UserPageLayout gives every other page.
    expect(clip.className).toContain('rounded-lg');
    expect(clip.className).toContain('overflow-hidden');
    // py-4: inset equally from the app bar above and the window edge below, so the card doesn't
    // sit flush against either.
    expect(clip.parentElement?.className).toContain('py-4');
  });

  it('registers cmdk selection context for album view mode only', async () => {
    await renderPage();

    expect(registerSelectionContextMock).toHaveBeenCalledOnce();
    const options = registerSelectionContextMock.mock.calls[0][0];
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.getAssets()).toBe(assetMultiSelectManager.assets);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete()).toEqual(expect.any(Function));

    await userEvent.click(page.getByLabelText('add_photos'));
    expect(options.getAssets()).toEqual([]);
    expect(options.canAddToAlbum()).toBe(false);
    expect(options.getOnFavorite()).toBeUndefined();
    expect(options.getOnArchive()).toBeUndefined();
    expect(options.getOnDelete()).toBeUndefined();
    expect(options.getOnUndoDelete()).toBeUndefined();
  });

  it('does not expose timeline-backed cmdk callbacks before the album timeline manager is bound', async () => {
    await renderPage(factory.album({ id: 'without-bound-timeline-manager', assetCount: 2 }));

    expect(registerSelectionContextMock).toHaveBeenCalledOnce();
    const options = registerSelectionContextMock.mock.calls[0][0];
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.getAssets()).toBe(assetMultiSelectManager.assets);
    expect(options.getOnFavorite()).toBeUndefined();
    expect(options.getOnArchive()).toBeUndefined();
    expect(options.getOnDelete()).toBeUndefined();
    expect(options.getOnUndoDelete()).toBeUndefined();
  });

  it('keeps the filter panel visible when timeline months exist but the manager asset count is zero', async () => {
    await renderPage(factory.album({ id: 'timeline-months-only', assetCount: 2 }));

    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('keeps separate filter state for view and select-assets, and reuses view filters for select-thumbnail', async () => {
    await renderPage();

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Album Person');

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('people-item-person-picker')).toBeInTheDocument();
    await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('people-item-person-picker'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Picker Person');

    await userEvent.click(page.getByLabelText('Close'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Album Person');

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Picker Person');

    await userEvent.click(page.getByLabelText('Close'));
    await userEvent.click(page.getByLabelText('album_options'));
    await userEvent.click(page.getByText('select_album_cover'));
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Album Person');
  });

  it('applies favorites independently in album view and picker modes', async () => {
    await renderPage();

    await expect.element(page.getByTestId('favorites-only')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('favorites-only'));

    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('favorites');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"isFavorite":true');

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('favorites-only')).toBeInTheDocument();
    await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('favorites-only'));

    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('favorites');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"timelineAlbumId":"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"isFavorite":true');
    // #763 slice 4: favorites no longer suppress partner scope in picker mode.
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"withPartners":true');
  });

  it('keeps timelineAlbumId in picker options after filters change and shows filtered empty state', async () => {
    await renderPage();

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('tags-item-tag-no-match')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"timelineAlbumId"');

    await userEvent.click(page.getByTestId('tags-item-tag-picker'));
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"timelineAlbumId"');

    await userEvent.click(page.getByTestId('tags-item-tag-no-match'));
    await expect.element(page.getByText('space_album_no_photos_to_add_match_filters')).toBeInTheDocument();
    await userEvent.click(page.getByText('space_album_clear_all_filters'));
    await expect.element(page.getByText('space_album_no_photos_to_add_match_filters')).not.toBeInTheDocument();
  });

  it('keeps already-in-album assets disabled after picker filters change', async () => {
    await renderPage();

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('tags-item-tag-picker')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('tags-item-tag-picker'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"timelineAlbumId"');
    await expect.element(page.getByTestId('mock-disabled-asset')).toHaveAttribute('data-disabled', 'true');
  });

  it('renders album browse grouping controls and passes mobile grouping props', async () => {
    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: true }));
  });

  // #1051: searching an album already narrowed to the album — via the nav bar, which gave no hint
  // it would. This puts the trigger on the album itself.
  describe('scoped search button', () => {
    it('sits beside the album grouping control', async () => {
      await renderPage();

      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
    });

    it('opens the album-scoped search palette when clicked', async () => {
      await renderPage();
      await userEvent.click(page.getByTestId('scoped-search-button'));

      expect(mockOpenSearchPalette).toHaveBeenCalledOnce();
    });

    it('is hidden in select-assets mode, alongside the grouping control', async () => {
      await renderPage();

      await userEvent.click(page.getByLabelText('add_photos'));

      await expect.element(page.getByTestId('scoped-search-button')).not.toBeInTheDocument();
    });

    it('is hidden in select-thumbnail mode, where the grouping control also goes', async () => {
      await renderPage();

      await userEvent.click(page.getByLabelText('album_options'));
      await userEvent.click(page.getByText('select_album_cover'));

      await expect.element(page.getByTestId('scoped-search-button')).not.toBeInTheDocument();
    });

    // The grouping pill is swapped out in search mode; the search button must NOT be, or the
    // only way to change a query would be to clear it first.
    it('stays available while album search results are showing', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');

      await renderPage(factory.album({ id: 'album-1', assetCount: 2 }));

      await expect.element(page.getByTestId('scoped-search-button')).toBeInTheDocument();
      await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    });
  });

  it('changes album grouping without changing album filters or URL state', async () => {
    await renderPage();

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));
    await userEvent.click(page.getByTestId('timeline-grouping-year'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"year"');
    await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('Album Person');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
  });

  it('clicking album year and month buckets zooms without temporal chips', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('activate-year-bucket'));
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"albumId"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent(JSON.stringify({ year: 2015 }));

    await userEvent.click(page.getByTestId('activate-month-bucket'));
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"albumId"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId('timeline-anchor'))
      .toMatchTextContent(JSON.stringify({ year: 2015, month: 8 }));
  });

  it('album bucket activation preserves non-time album filters without adding temporal chips', async () => {
    await renderPage();

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));
    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('Album Person');
    await expect.element(page.getByTestId('active-filters-bar')).not.toMatchTextContent('2015');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"albumId"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent(JSON.stringify({ year: 2015 }));
  });

  it('ignores album bucket activation while selection mode is active', async () => {
    await renderPage();
    assetMultiSelectManager.selectAsset(factory.timelineAsset({ id: 'selected-asset' }));

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('explicit album timeline filters still show chips and clear without changing grouping', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('timeline-grouping-month'));
    await userEvent.click(page.getByTestId('year-btn-2024'));

    await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('2024');
    await expect
      .element(page.getByTestId('timeline-options'))
      .toMatchTextContent('"takenAfter":"2024-01-01T00:00:00.000Z"');
    await expect
      .element(page.getByTestId('timeline-options'))
      .toMatchTextContent('"takenBefore":"2025-01-01T00:00:00.000Z"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');

    await userEvent.click(page.getByRole('button', { name: 'filter_remove_chip' }));

    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-anchor')).toMatchTextContent('null');
  });

  it('does not render browse grouping controls in album select-assets or select-thumbnail modes', async () => {
    await renderPage();

    await userEvent.click(page.getByLabelText('add_photos'));
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"grouping"');

    await userEvent.click(page.getByLabelText('Close'));
    await userEvent.click(page.getByLabelText('album_options'));
    await userEvent.click(page.getByText('select_album_cover'));

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"grouping"');
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toMatchTextContent(JSON.stringify({ grouping: 'day', hasHandler: false }));
  });

  it('resets both filter states and label caches when navigating to another album', async () => {
    const firstAlbum = factory.album({ id: 'album-1', assetCount: 2 });
    const secondAlbum = factory.album({ id: 'album-2', assetCount: 2 });
    const view = await renderPage(firstAlbum);

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('First Album Person');

    // A real navigation to another album always moves page.url/page.params in lockstep with
    // data.album (the URL change is what drives the new load in the first place). Move them here
    // too, so this proves filters reset because the new album's URL carries none of its own —
    // not merely because a mock forgot to move.
    mockPage.reset('https://gallery.test/albums/album-2', {
      routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      params: { albumId: 'album-2' },
    });

    queryClient.setQueryData(getAlbumInfoQuery(secondAlbum.id).queryKey, secondAlbum);
    await view.rerender({ component: AlbumPage, componentProps: { params: { albumId: secondAlbum.id } } });

    await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));
    await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Second Album Person');
    await expect.element(page.getByText('First Album Person')).not.toBeInTheDocument();
  });

  it('merges grouping and the filter bar into one toolbar row in browse mode', async () => {
    await renderPage();

    // activate a filter so the bar renders
    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    const grouping = page.getByTestId('timeline-desktop-grouping-control').element();
    const bar = page.getByTestId('active-filters-bar').element();
    // grouping wrapper and the bar's flex-1 column share the FilterToolbar root
    expect(grouping.parentElement).toBe(bar.parentElement?.parentElement);
  });

  it('shows the add-all-to-collection button once an album filter is active', async () => {
    await renderPage();

    await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
    await userEvent.click(page.getByTestId('people-item-person-view'));

    await expect.element(page.getByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('does not show the add-all-to-collection button without an active album filter', async () => {
    await renderPage();

    await expect.element(page.getByTestId('timeline-options')).toBeInTheDocument();
    await expect.element(page.getByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  // Slice 6 — the owner chip on an album is named from the album users the page already holds, so
  // it costs no request. (There is no album chip here: E9 drops `?albumId=` at hydrate.)
  it('names the owner chip from the album users in scope, without a request', async () => {
    const album = factory.album({ id: 'album-1', assetCount: 2 });
    const owner = album.albumUsers[0].user;
    mockPage.url = new URL(`https://gallery.test/albums/album-1?owner=${owner.id}`);

    await renderPage(album);

    await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent(owner.name);
    await expect.element(page.getByTestId('active-filters-bar')).not.toMatchTextContent(owner.id);
    expect(sdkMock.getUser).not.toHaveBeenCalled();
  });

  // Nested (not a sibling describe) so it shares this outer describe's beforeEach — the mockPage
  // reset and gotoMock re-arm above are what make the round-trip tests below load-bearing.
  describe('album detail filters are URL-backed', () => {
    const album1 = () => factory.album({ id: 'album-1', assetCount: 2 });

    it('hydrates the album timeline filters from the URL', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4&lens=RF24-70mm');
      await renderPage(album1());

      const options = page.getByTestId('timeline-options');
      await expect.element(options).toMatchTextContent('"make":"Apple"');
      await expect.element(options).toMatchTextContent('"rating":4');
      await expect.element(options).toMatchTextContent('"lensModel":"RF24-70mm"');
      await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    });

    it('writes a filter chosen in the panel back to the URL', async () => {
      await renderPage(album1());

      await expect.element(page.getByTestId('people-item-person-view')).toBeInTheDocument();
      await userEvent.click(page.getByTestId('people-item-person-view'));

      await vi.waitFor(() =>
        expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?people=person-view', {
          replace: true,
          reset: false,
        }),
      );
    });

    it('writes chip removal back to the URL', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');
      await renderPage(album1());

      await userEvent.click(page.getByRole('button', { name: 'filter_remove_chip' }));

      await vi.waitFor(() =>
        expect(gotoMock).toHaveBeenCalledWith('/albums/album-1', {
          replace: true,
          reset: false,
        }),
      );
    });

    // Back/forward: SvelteKit swaps page.url without remounting the page component. The $effect must
    // notice and re-hydrate — this is the same code path a reload and a shared URL take.
    it('re-hydrates when the URL changes underneath it (back/forward)', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4');
      await renderPage(album1());

      await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"rating":4');

      // The browser Back button: no remount, just a new URL.
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

      await vi.waitFor(() => {
        const options = page.getByTestId('timeline-options').element();
        expect(options.textContent).toContain('"make":"Apple"');
        expect(options.textContent).not.toContain('"rating"');
      });
    });

    // D2 (was THE transient-year carry-over test). selectedYear is IN the URL codec now: picking a year
    // writes `?year=2024`, so it survives the page's own goto() round trip on its own — no
    // carry-over slot smuggling it across. Picking a year and THEN a second filter must keep both.
    it('writes a picked year to the URL and keeps it across a second filter change', async () => {
      await renderPage(album1());

      await userEvent.click(page.getByTestId('year-btn-2024'));
      await expect
        .element(page.getByTestId('timeline-options'))
        .toMatchTextContent('"takenAfter":"2024-01-01T00:00:00.000Z"');
      // A year IS in the URL codec, so picking one writes.
      await vi.waitFor(() => expect(gotoMock).toHaveBeenCalled());
      const [yearTarget] = gotoMock.mock.calls.at(-1) as [string];
      expect(yearTarget).toContain('year=2024');

      await userEvent.click(page.getByTestId('people-item-person-view'));

      await vi.waitFor(() => {
        const [target] = gotoMock.mock.calls.at(-1) as [string];
        expect(target).toContain('people=person-view');
        expect(target).toContain('year=2024');
      });
      await vi.waitFor(() => {
        const options = page.getByTestId('timeline-options').element().textContent ?? '';
        expect(options).toContain('"personIds":["person-view"]');
        // survived the round trip
        expect(options).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
      });
      await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('2024');
    });

    // D2 — a shared album link carries the year.
    it('hydrates a shared ?year= link into the picker, the chip and the timeline query', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?year=2023');
      await renderPage(album1());

      await vi.waitFor(() => {
        const options = page.getByTestId('timeline-options').element().textContent ?? '';
        expect(options).toContain('"takenAfter":"2023-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2024-01-01T00:00:00.000Z"');
      });
      await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('2023');
    });

    // replaceScrollTarget (navigation.ts) writes `?at=<assetId>` into the URL when the asset viewer
    // closes. The year is URL-backed (D2), so it survives on its own — and `?at=` must still not
    // read as a filter change, or the page rebuilds an identical FilterState (and with it the
    // timeline options object) on every viewer close.
    it('keeps the year when the asset viewer closes (?at= is not a filter change)', async () => {
      await renderPage(album1());

      await userEvent.click(page.getByTestId('year-btn-2024'));
      await expect
        .element(page.getByTestId('timeline-options'))
        .toMatchTextContent('"takenAfter":"2024-01-01T00:00:00.000Z"');

      // Simulate the asset viewer closing: replaceScrollTarget appends `at` to the CURRENT url,
      // which now carries year=2024 (the page wrote it, and gotoMock landed page.url on it).
      const withAt = new URL(mockPage.url);
      withAt.searchParams.set('at', 'asset-1');
      mockPage.url = withAt;

      await vi.waitFor(() => {
        const options = page.getByTestId('timeline-options').element().textContent ?? '';
        expect(options).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
      });
      await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('2024');
    });

    // E9 — the route already scopes the query to this album, and the server's albumId is a SCALAR
    // driving one inner join, so a second album cannot be AND-ed. A stray param must be IGNORED,
    // not merely redundant.
    it('E9: ignores a stray albumId param and keeps its own album scope', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?albumId=album-2&make=Apple');
      await renderPage(album1());

      const options = page.getByTestId('timeline-options');
      await expect.element(options).toMatchTextContent('"make":"Apple"');
      await expect.element(options).toMatchTextContent('"albumId":"album-1"');
      await expect.element(options).not.toMatchTextContent('album-2');
    });

    // The picker filters the asset PICKER, not the album timeline. They must never reach the URL.
    it('does not write picker filters to the URL', async () => {
      await renderPage(album1());

      await userEvent.click(page.getByLabelText('add_photos'));
      await expect.element(page.getByTestId('people-item-person-picker')).toBeInTheDocument();
      gotoMock.mockClear();
      await userEvent.click(page.getByTestId('people-item-person-picker'));

      await expect.element(page.getByTestId('active-chip')).toMatchTextContent('Picker Person');
      expect(gotoMock).not.toHaveBeenCalled();
    });

    // Regression test for e2e/src/specs/web/album.e2e-spec.ts:150 ("reuses album filters for select
    // cover but keeps a separate picker state for add assets"). Both opening AND closing the
    // add-photos picker call navigate({ assetGridRouteSearchParams: { at } }) with no real `at` —
    // replaceScrollTarget must preserve the album's `?tags=…` query through that round trip, or the
    // URL-backed $effect re-hydrates albumFilters from a filter-less URL and the chip vanishes.
    it('keeps the album tag filter across opening and closing the add-photos picker', async () => {
      await renderPage(album1());

      await expect.element(page.getByTestId('tags-item-tag-view')).toBeInTheDocument();
      await userEvent.click(page.getByTestId('tags-item-tag-view'));
      await expect.element(page.getByTestId('active-chip')).toMatchTextContent('First Album Tag');

      await userEvent.click(page.getByLabelText('add_photos'));
      // The picker shows its OWN (empty) filter state, not the album's — this is expected, not the bug.
      await expect.element(page.getByTestId('active-chip')).not.toBeInTheDocument();

      await userEvent.click(page.getByLabelText('Close'));
      await expect.element(page.getByTestId('active-chip')).toMatchTextContent('First Album Tag');
    });

    // Finding (#767c): the grid and the map of one album must agree on what a shared/bookmarked
    // filter URL means. The map already forwards description/filename/ocr/isInAlbum/isNotInAlbum
    // (buildAlbumMapMarkerOptions); the timeline query must forward them too, or a URL like this
    // renders a "1 filter" chip over the ENTIRE unfiltered album.
    it('hydrates the album description filter from the URL and forwards it to the timeline query', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?description=beach');
      await renderPage(album1());

      await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"description":"beach"');
      await expect.element(page.getByTestId('active-filters-bar')).toBeInTheDocument();
    });

    it('passes the album filters to the album map', async () => {
      queryClient.setQueryData(getUserConfigQuery().queryKey, defaultUserConfig);
      sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

      await renderPage(factory.album({ id: 'album-1', assetCount: 2 }));

      await vi.waitFor(() =>
        expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
          expect.objectContaining({ albumId: 'album-1', make: 'Apple' }),
          expect.anything(),
        ),
      );
    });
  });

  // #986: an album is a searchable page, so a query launched from one runs against that album
  // instead of bouncing the user to /photos and searching their whole library.
  describe('page-aware search', () => {
    const album1 = () => factory.album({ id: 'album-1', assetCount: 2 });

    it('runs the search in place instead of showing the browse timeline', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');

      await renderPage(album1());

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'beach');
      await expect.element(page.getByTestId('timeline-options')).not.toBeInTheDocument();
    });

    it('scopes the search to the album it was launched from', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');

      await renderPage(album1());

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-album-ids', 'album-1');
    });

    it('shows the browse timeline when there is no query', async () => {
      await renderPage(album1());

      await expect.element(page.getByTestId('timeline-options')).toBeInTheDocument();
      await expect.element(page.getByTestId('smart-search-results')).not.toBeInTheDocument();
    });

    it('hydrates filters from the URL into the search', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach&make=Apple');

      await renderPage(album1());

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-filter-make', 'Apple');
    });

    it('keeps the query in the URL when a filter changes during a search', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');
      // In query mode the panel's options come from the SEARCH facets, not the album's suggestion
      // endpoint. The id MUST differ from the browse mock's `person-view` (see getFilterSuggestions
      // above): with the same id the row exists in both modes and the test passes even if the
      // query-mode branch is deleted.
      sdkMock.searchSmartFacets.mockResolvedValue({
        total: 3,
        timeBuckets: [],
        countries: [],
        cities: [],
        cameraMakes: [],
        cameraModels: [],
        tags: [],
        people: [{ id: 'person-from-facets', name: 'Search Person' }],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      } as never);
      await renderPage(album1());

      await expect.element(page.getByTestId('people-item-person-from-facets')).toBeInTheDocument();
      await userEvent.click(page.getByTestId('people-item-person-from-facets'));

      await vi.waitFor(() => {
        const [target] = gotoMock.mock.calls.at(-1) as [string];
        expect(target).toContain('q=beach');
        expect(target).toContain('people=person-from-facets');
      });
    });

    it('re-hydrates when the URL changes under it (back/forward, shared link)', async () => {
      await renderPage(album1());

      await expect.element(page.getByTestId('timeline-options')).toBeInTheDocument();

      mockPage.url = new URL('https://gallery.test/albums/album-1?q=sunset');

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'sunset');
    });

    // The navbar sort dropdown renders on every searchable page, browse mode included, so an
    // explicit ?sort= has to reach the browse query or the control visibly does nothing.
    it('lets an explicit sort override the album order in browse mode', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?sort=asc');

      await renderPage(factory.album({ id: 'album-1', assetCount: 2, order: AssetOrder.Desc }));

      await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"order":"asc"');
    });

    it("keeps the album's own order in browse mode when the URL carries no sort", async () => {
      await renderPage(factory.album({ id: 'album-1', assetCount: 2, order: AssetOrder.Asc }));

      await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"order":"asc"');
    });

    const facetsWith = (people: Array<{ id: string; name: string }> = []) =>
      ({
        total: 3,
        timeBuckets: [],
        countries: [],
        cities: [],
        cameraMakes: [],
        cameraModels: [],
        tags: [],
        people,
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
      }) as never;

    // `vi.clearAllMocks()` in the outer beforeEach clears call history but NOT implementations, so
    // a `mockResolvedValue` (or the never-resolving promise one test below installs) would leak
    // into every later test in the file. Reset the facets mock per test.
    beforeEach(() => {
      sdkMock.searchSmartFacets.mockReset();
      sdkMock.searchSmartFacets.mockResolvedValue(facetsWith());
    });

    // The bar's label prints the SEARCH total, so the collect call has to run the same search.
    // Dropping the query sends it down the metadata branch, which then adds every asset in the
    // album — "Add all 3" quietly adding 800.
    it('carries the query into add-all-to-collection so it collects the matches, not the album', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');
      // Spied, not rendered: the real modal mounts CollectionPickerModal, which needs album/space
      // data this suite does not stub. The assertion is about what the page HANDS the modal.
      const showSpy = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
      await renderPage(album1());

      await userEvent.click(page.getByTestId('add-all-to-collection'));

      await vi.waitFor(() => expect(showSpy).toHaveBeenCalled());
      const props = showSpy.mock.calls.at(-1)![1] as unknown as { terms: { query?: string } };
      expect(props.terms.query).toBe('beach');
      expect(props).toMatchObject({ smartSearchEnabled: true, total: 3 });
      showSpy.mockRestore();
    });

    // Search mode unmounts <Timeline>, so `timelineManager` is undefined (direct `?q=` load) or
    // destroyed (typed query). Every bulk handler used to dereference it unguarded: the favourite
    // path threw, and the delete path silently no-opped while the asset stayed on screen.
    it('offers bulk handlers in search mode that act on the results, not the unmounted timeline', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');
      await renderPage(album1());

      await expect.element(page.getByTestId('smart-search-results')).toBeInTheDocument();

      const options = registerSelectionContextMock.mock.calls.at(-1)![0];
      const onFavorite = options.getOnFavorite();
      const onDelete = options.getOnDelete();

      expect(onFavorite).toBeTypeOf('function');
      expect(onDelete).toBeTypeOf('function');
      // Would throw on `undefined.update(...)` before the fix.
      expect(() => onFavorite!(['asset-1'], true)).not.toThrow();
    });

    // The provider's query-mode branch returns early, so without name capture the chip renders the
    // raw `person:<uuid>` token the facets emitted.
    it('names a person chip picked from the search facets', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');
      sdkMock.searchSmartFacets.mockResolvedValue(facetsWith([{ id: 'person-from-facets', name: 'Search Person' }]));
      await renderPage(album1());

      await expect.element(page.getByTestId('people-item-person-from-facets')).toBeInTheDocument();
      await userEvent.click(page.getByTestId('people-item-person-from-facets'));

      await expect.element(page.getByTestId('active-filters-bar')).toMatchTextContent('Search Person');
    });

    // Until the new facets land, the previous query's total keeps annotating the new results.
    it('drops the previous query facets when the query changes', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=beach');
      await renderPage(album1());

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-total', '3');

      // A slow response for the new query — the stale total must not survive in the meantime.
      sdkMock.searchSmartFacets.mockImplementation((() => new Promise(() => {})) as never);
      mockPage.url = new URL('https://gallery.test/albums/album-1?q=mountain');

      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-search-query', 'mountain');
      await expect.element(page.getByTestId('smart-search-results')).toHaveAttribute('data-total', '');
    });
  });
});
