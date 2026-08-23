import { AlbumUserRole } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { albumFactory } from '@test-data/factories/album-factory';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import AlbumPage from './+page.svelte';

const { registerAlbumContextMock, registerSelectionContextMock, gotoMock, mockFeatureFlagsManager } = vi.hoisted(
  () => ({
    registerAlbumContextMock: vi.fn(),
    registerSelectionContextMock: vi.fn(),
    gotoMock: vi.fn(),
    mockFeatureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: { map: false } },
  }),
);

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
  invalidate: vi.fn().mockResolvedValue(undefined),
  onNavigate: vi.fn(),
}));
// The mock module and the spec import the SAME singleton, so assigning mockPage.url in a test is
// what the page's $effect sees.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockTimeline } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockTimeline };
});

vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerAlbumContext: registerAlbumContextMock,
  registerSelectionContext: registerSelectionContextMock,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFeatureFlagsManager as never,
}));

vi.mock('$lib/utils/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/navigation')>();
  return {
    ...actual,
    isAlbumsRoute: () => true,
    // Spy that DELEGATES to the real implementation (not a no-op stub): the picker open/close
    // handlers below call navigate({ assetGridRouteSearchParams: { at } }), which routes into the
    // real replaceScrollTarget/goto machinery against mockPage + gotoMock above. A no-op stub would
    // hide the exact bug this suite regression-tests (album.e2e-spec.ts:150 — closing the add-photos
    // picker silently drops the album's own filter query).
    navigate: vi.fn(actual.navigate),
  };
});

function renderPage(album = albumFactory.build({ assetCount: 2 })) {
  const owner = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)?.user ?? album.albumUsers[0]?.user;
  authManager.setUser(userAdminFactory.build({ id: owner?.id ?? 'album-owner' }));
  authManager.setPreferences(preferencesFactory.build());

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
    });
  });

  sdkMock.getSearchSuggestions.mockImplementation((() => Promise.resolve([] as string[])) as never);

  return render(TestWrapper, {
    component: AlbumPage,
    componentProps: {
      data: {
        album,
        asset: undefined,
        error: undefined,
        meta: { title: album.albumName },
      },
    },
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
    Element.prototype.animate = getAnimateMock();
    mockFeatureFlagsManager.value.map = false;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('renders the filter panel in view mode and select-assets mode', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('discovery-panel')).toBeInTheDocument());
    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('discovery-panel')).toBeInTheDocument());
  });

  it('hides the filter panel when the active dataset is empty and no filters are active', async () => {
    renderPage(albumFactory.build({ assetCount: 0 }));

    await waitFor(() => expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument());
  });

  // Unlike the pages built on UserPageLayout, this route's <main> is transparent, so the panel's
  // bg-light surface sits directly on the darker app background instead of blending into a card.
  // It therefore has to shape itself: rounded to the app's 16px surface radius and held off the
  // bottom edge, rather than running as a flush slab to the foot of the window.
  it('shapes the filter panel as a rounded card lifted off the bottom edge', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('filter-panel-shell')).toBeInTheDocument());

    const clip = screen.getByTestId('album-filter-panel-surface');
    expect(clip).toContainElement(screen.getByTestId('filter-panel-shell'));
    // rounded-lg is 16px in this theme — the same radius UserPageLayout gives every other page.
    expect(clip.className).toContain('rounded-lg');
    expect(clip.className).toContain('overflow-hidden');
    // py-4: inset equally from the app bar above and the window edge below, so the card doesn't
    // sit flush against either.
    expect(clip.parentElement?.className).toContain('py-4');
  });

  it('registers cmdk selection context for album view mode only', async () => {
    renderPage();

    expect(registerSelectionContextMock).toHaveBeenCalledOnce();
    const options = registerSelectionContextMock.mock.calls[0][0];
    expect(options.canAddToAlbum()).toBe(true);
    expect(options.getAssets()).toBe(assetMultiSelectManager.assets);
    expect(options.getOnFavorite()).toEqual(expect.any(Function));
    expect(options.getOnArchive()).toEqual(expect.any(Function));
    expect(options.getOnDelete()).toEqual(expect.any(Function));
    expect(options.getOnUndoDelete()).toEqual(expect.any(Function));

    await fireEvent.click(screen.getByLabelText('add_photos'));
    expect(options.getAssets()).toEqual([]);
    expect(options.canAddToAlbum()).toBe(false);
    expect(options.getOnFavorite()).toBeUndefined();
    expect(options.getOnArchive()).toBeUndefined();
    expect(options.getOnDelete()).toBeUndefined();
    expect(options.getOnUndoDelete()).toBeUndefined();
  });

  it('does not expose timeline-backed cmdk callbacks before the album timeline manager is bound', () => {
    renderPage(albumFactory.build({ id: 'without-bound-timeline-manager', assetCount: 2 }));

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
    renderPage(albumFactory.build({ id: 'timeline-months-only', assetCount: 2 }));

    await waitFor(() => expect(screen.getByTestId('discovery-panel')).toBeInTheDocument());
  });

  it('keeps separate filter state for view and select-assets, and reuses view filters for select-thumbnail', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Album Person');

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('people-item-person-picker')).toBeInTheDocument());
    expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('people-item-person-picker'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Picker Person');

    await fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Album Person');

    await fireEvent.click(screen.getByLabelText('add_photos'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Picker Person');

    await fireEvent.click(screen.getByLabelText('Close'));
    await user.click(screen.getByLabelText('album_options'));
    await user.click(screen.getByText('select_album_cover'));
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Album Person');
  });

  it('applies favorites independently in album view and picker modes', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('favorites-only')).toBeInTheDocument());
    await user.click(screen.getByTestId('favorites-only'));

    expect(screen.getByTestId('active-chip')).toHaveTextContent('favorites');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"isFavorite":true');

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('favorites-only')).toBeInTheDocument());
    expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('favorites-only'));

    expect(screen.getByTestId('active-chip')).toHaveTextContent('favorites');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId":"');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"isFavorite":true');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"withPartners":true');
  });

  it('keeps timelineAlbumId in picker options after filters change and shows filtered empty state', async () => {
    renderPage();
    const user = userEvent.setup();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('tags-item-tag-no-match')).toBeInTheDocument());
    expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');

    await user.click(screen.getByTestId('tags-item-tag-picker'));
    expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');

    await user.click(screen.getByTestId('tags-item-tag-no-match'));
    expect(screen.getByText('No photos available to add match your filters')).toBeInTheDocument();
    await user.click(screen.getByText('Clear all filters'));
    await waitFor(() =>
      expect(screen.queryByText('No photos available to add match your filters')).not.toBeInTheDocument(),
    );
  });

  it('keeps already-in-album assets disabled after picker filters change', async () => {
    renderPage();
    const user = userEvent.setup();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('tags-item-tag-picker')).toBeInTheDocument());
    await user.click(screen.getByTestId('tags-item-tag-picker'));

    expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');
    expect(screen.getByTestId('mock-disabled-asset')).toHaveAttribute('data-disabled', 'true');
  });

  it('renders album browse grouping controls and passes mobile grouping props', async () => {
    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
  });

  it('changes album grouping without changing album filters or URL state', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    await user.click(screen.getByTestId('timeline-grouping-year'));

    expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"year"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Album Person');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });

  it('clicking album year and month buckets zooms without temporal chips', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('activate-year-bucket'));
    await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"'));
    expect(screen.getByTestId('timeline-options').textContent).toContain('"albumId"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));

    await user.click(screen.getByTestId('activate-month-bucket'));
    await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"day"'));
    expect(screen.getByTestId('timeline-options').textContent).toContain('"albumId"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015, month: 8 }));
  });

  it('album bucket activation preserves non-time album filters without adding temporal chips', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    await user.click(screen.getByTestId('activate-year-bucket'));

    await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"'));
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Album Person');
    expect(screen.getByTestId('active-filters-bar')).not.toHaveTextContent('2015');
    expect(screen.getByTestId('timeline-options').textContent).toContain('"albumId"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
  });

  it('ignores album bucket activation while selection mode is active', async () => {
    renderPage();
    assetMultiSelectManager.selectAsset(timelineAssetFactory.build({ id: 'selected-asset' }));

    await userEvent.setup().click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('explicit album timeline filters still show chips and clear without changing grouping', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('timeline-grouping-month'));
    await user.click(await screen.findByTestId('year-btn-2024'));

    await waitFor(() => {
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2024');
      expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
      expect(screen.getByTestId('timeline-options').textContent).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
      expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"');
    });

    await user.click(screen.getByRole('button', { name: 'filter_remove_chip' }));

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenAfter"');
      expect(screen.getByTestId('timeline-options').textContent).not.toContain('"takenBefore"');
      expect(screen.getByTestId('timeline-options').textContent).toContain('"grouping":"month"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
  });

  it('does not render browse grouping controls in album select-assets or select-thumbnail modes', async () => {
    renderPage();
    const user = userEvent.setup();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument());
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"grouping"');

    await fireEvent.click(screen.getByLabelText('Close'));
    await user.click(screen.getByLabelText('album_options'));
    await user.click(screen.getByText('select_album_cover'));

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-options').textContent).not.toContain('"grouping"');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: false }),
    );
  });

  it('resets both filter states and label caches when navigating to another album', async () => {
    const firstAlbum = albumFactory.build({ id: 'album-1', assetCount: 2 });
    const secondAlbum = albumFactory.build({ id: 'album-2', assetCount: 2 });
    const view = renderPage(firstAlbum);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('First Album Person');

    // A real navigation to another album always moves page.url/page.params in lockstep with
    // data.album (the URL change is what drives the new load in the first place). Move them here
    // too, so this proves filters reset because the new album's URL carries none of its own —
    // not merely because a mock forgot to move.
    mockPage.reset('https://gallery.test/albums/album-2', {
      routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      params: { albumId: 'album-2' },
    });

    await view.rerender({
      component: AlbumPage,
      componentProps: {
        data: {
          album: secondAlbum,
          asset: undefined,
          error: undefined,
          meta: { title: secondAlbum.albumName },
        },
      },
    });

    await waitFor(() => expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument());
    expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Second Album Person');
    expect(screen.queryByText('First Album Person')).not.toBeInTheDocument();
  });

  it('merges grouping and the filter bar into one toolbar row in browse mode', async () => {
    renderPage();
    const user = userEvent.setup();

    // activate a filter so the bar renders
    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));

    const grouping = await screen.findByTestId('timeline-desktop-grouping-control');
    const bar = screen.getByTestId('active-filters-bar');
    // grouping wrapper and the bar's flex-1 column share the FilterToolbar root
    expect(grouping.parentElement).toBe(bar.parentElement?.parentElement);
  });

  it('shows the add-all-to-collection button once an album filter is active', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));

    expect(await screen.findByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('does not show the add-all-to-collection button without an active album filter', async () => {
    renderPage();

    await screen.findByTestId('timeline-options');
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  // Slice 6 — the owner chip on an album is named from the album users the page already holds, so
  // it costs no request. (There is no album chip here: E9 drops `?albumId=` at hydrate.)
  it('names the owner chip from the album users in scope, without a request', async () => {
    const album = albumFactory.build({ id: 'album-1', assetCount: 2 });
    const owner = album.albumUsers[0].user;
    mockPage.url = new URL(`https://gallery.test/albums/album-1?owner=${owner.id}`);

    renderPage(album);

    await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toHaveTextContent(owner.name));
    expect(screen.getByTestId('active-filters-bar')).not.toHaveTextContent(owner.id);
    expect(sdkMock.getUser).not.toHaveBeenCalled();
  });

  // Nested (not a sibling describe) so it shares this outer describe's beforeEach — the mockPage
  // reset and gotoMock re-arm above are what make the round-trip tests below load-bearing.
  describe('album detail filters are URL-backed', () => {
    const album1 = () => albumFactory.build({ id: 'album-1', assetCount: 2 });

    it('hydrates the album timeline filters from the URL', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4&lens=RF24-70mm');
      renderPage(album1());

      const options = await screen.findByTestId('timeline-options');
      await waitFor(() => {
        expect(options.textContent).toContain('"make":"Apple"');
        expect(options.textContent).toContain('"rating":4');
        expect(options.textContent).toContain('"lensModel":"RF24-70mm"');
      });
      expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
    });

    it('writes a filter chosen in the panel back to the URL', async () => {
      renderPage(album1());
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
      await user.click(screen.getByTestId('people-item-person-view'));

      await waitFor(() =>
        expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?people=person-view', {
          replaceState: true,
          keepFocus: true,
          noScroll: true,
        }),
      );
    });

    it('writes chip removal back to the URL', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');
      renderPage(album1());
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'filter_remove_chip' }));

      await waitFor(() =>
        expect(gotoMock).toHaveBeenCalledWith('/albums/album-1', {
          replaceState: true,
          keepFocus: true,
          noScroll: true,
        }),
      );
    });

    // Back/forward: SvelteKit swaps page.url without remounting the page component. The $effect must
    // notice and re-hydrate — this is the same code path a reload and a shared URL take.
    it('re-hydrates when the URL changes underneath it (back/forward)', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple&rating=4');
      renderPage(album1());

      await waitFor(() => expect(screen.getByTestId('timeline-options').textContent).toContain('"rating":4'));

      // The browser Back button: no remount, just a new URL.
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

      await waitFor(() => {
        const options = screen.getByTestId('timeline-options');
        expect(options.textContent).toContain('"make":"Apple"');
        expect(options.textContent).not.toContain('"rating"');
      });
    });

    // D2 (was THE transient-year carry-over test). selectedYear is IN the URL codec now: picking a year
    // writes `?year=2024`, so it survives the page's own goto() round trip on its own — no
    // carry-over slot smuggling it across. Picking a year and THEN a second filter must keep both.
    it('writes a picked year to the URL and keeps it across a second filter change', async () => {
      renderPage(album1());
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('year-btn-2024'));
      await waitFor(() =>
        expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"'),
      );
      // A year IS in the URL codec, so picking one writes.
      await waitFor(() => expect(gotoMock).toHaveBeenCalled());
      const [yearTarget] = gotoMock.mock.calls.at(-1) as [string];
      expect(yearTarget).toContain('year=2024');

      await user.click(await screen.findByTestId('people-item-person-view'));

      await waitFor(() => {
        const [target] = gotoMock.mock.calls.at(-1) as [string];
        expect(target).toContain('people=person-view');
        expect(target).toContain('year=2024');
      });
      await waitFor(() => {
        const options = screen.getByTestId('timeline-options').textContent ?? '';
        expect(options).toContain('"personIds":["person-view"]');
        // survived the round trip
        expect(options).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
      });
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2024');
    });

    // D2 — a shared album link carries the year.
    it('hydrates a shared ?year= link into the picker, the chip and the timeline query', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?year=2023');
      renderPage(album1());

      await waitFor(() => {
        const options = screen.getByTestId('timeline-options').textContent ?? '';
        expect(options).toContain('"takenAfter":"2023-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2024-01-01T00:00:00.000Z"');
      });
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2023');
    });

    // replaceScrollTarget (navigation.ts) writes `?at=<assetId>` into the URL when the asset viewer
    // closes. The year is URL-backed (D2), so it survives on its own — and `?at=` must still not
    // read as a filter change, or the page rebuilds an identical FilterState (and with it the
    // timeline options object) on every viewer close.
    it('keeps the year when the asset viewer closes (?at= is not a filter change)', async () => {
      renderPage(album1());
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('year-btn-2024'));
      await waitFor(() =>
        expect(screen.getByTestId('timeline-options').textContent).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"'),
      );

      // Simulate the asset viewer closing: replaceScrollTarget appends `at` to the CURRENT url,
      // which now carries year=2024 (the page wrote it, and gotoMock landed page.url on it).
      const withAt = new URL(mockPage.url);
      withAt.searchParams.set('at', 'asset-1');
      mockPage.url = withAt;

      await waitFor(() => {
        const options = screen.getByTestId('timeline-options').textContent ?? '';
        expect(options).toContain('"takenAfter":"2024-01-01T00:00:00.000Z"');
        expect(options).toContain('"takenBefore":"2025-01-01T00:00:00.000Z"');
      });
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2024');
    });

    // E9 — the route already scopes the query to this album, and the server's albumId is a SCALAR
    // driving one inner join, so a second album cannot be AND-ed. A stray param must be IGNORED,
    // not merely redundant.
    it('E9: ignores a stray albumId param and keeps its own album scope', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?albumId=album-2&make=Apple');
      renderPage(album1());

      const options = await screen.findByTestId('timeline-options');
      await waitFor(() => expect(options.textContent).toContain('"make":"Apple"'));
      expect(options.textContent).toContain('"albumId":"album-1"');
      expect(options.textContent).not.toContain('album-2');
    });

    // The picker filters the asset PICKER, not the album timeline. They must never reach the URL.
    it('does not write picker filters to the URL', async () => {
      renderPage(album1());
      const user = userEvent.setup();

      await fireEvent.click(screen.getByLabelText('add_photos'));
      await waitFor(() => expect(screen.getByTestId('people-item-person-picker')).toBeInTheDocument());
      gotoMock.mockClear();
      await user.click(screen.getByTestId('people-item-person-picker'));

      expect(screen.getByTestId('active-chip')).toHaveTextContent('Picker Person');
      expect(gotoMock).not.toHaveBeenCalled();
    });

    // Regression test for e2e/src/specs/web/album.e2e-spec.ts:150 ("reuses album filters for select
    // cover but keeps a separate picker state for add assets"). Both opening AND closing the
    // add-photos picker call navigate({ assetGridRouteSearchParams: { at } }) with no real `at` —
    // replaceScrollTarget must preserve the album's `?tags=…` query through that round trip, or the
    // URL-backed $effect re-hydrates albumFilters from a filter-less URL and the chip vanishes.
    it('keeps the album tag filter across opening and closing the add-photos picker', async () => {
      renderPage(album1());
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByTestId('tags-item-tag-view')).toBeInTheDocument());
      await user.click(screen.getByTestId('tags-item-tag-view'));
      expect(screen.getByTestId('active-chip')).toHaveTextContent('First Album Tag');

      await fireEvent.click(screen.getByLabelText('add_photos'));
      // The picker shows its OWN (empty) filter state, not the album's — this is expected, not the bug.
      expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();

      await fireEvent.click(screen.getByLabelText('Close'));
      expect(screen.getByTestId('active-chip')).toHaveTextContent('First Album Tag');
    });

    // Finding (#767c): the grid and the map of one album must agree on what a shared/bookmarked
    // filter URL means. The map already forwards description/filename/ocr/isInAlbum/isNotInAlbum
    // (buildAlbumMapMarkerOptions); the timeline query must forward them too, or a URL like this
    // renders a "1 filter" chip over the ENTIRE unfiltered album.
    it('hydrates the album description filter from the URL and forwards it to the timeline query', async () => {
      mockPage.url = new URL('https://gallery.test/albums/album-1?description=beach');
      renderPage(album1());

      const options = await screen.findByTestId('timeline-options');
      await waitFor(() => expect(options.textContent).toContain('"description":"beach"'));
      expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
    });

    it('passes the album filters to the album map', async () => {
      mockFeatureFlagsManager.value.map = true;
      sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
      mockPage.url = new URL('https://gallery.test/albums/album-1?make=Apple');

      renderPage(albumFactory.build({ id: 'album-1', assetCount: 2 }));

      await waitFor(() =>
        expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
          expect.objectContaining({ albumId: 'album-1', make: 'Apple' }),
          expect.anything(),
        ),
      );
    });
  });
});
