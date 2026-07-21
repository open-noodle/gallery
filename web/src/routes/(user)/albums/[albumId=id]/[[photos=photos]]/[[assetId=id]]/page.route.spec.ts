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
import AlbumPage from './+page.svelte';

const { registerAlbumContextMock, registerSelectionContextMock } = vi.hoisted(() => ({
  registerAlbumContextMock: vi.fn(),
  registerSelectionContextMock: vi.fn(),
}));

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockTimeline } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockTimeline };
});

vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerAlbumContext: registerAlbumContextMock,
  registerSelectionContext: registerSelectionContextMock,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    value: { map: false },
  } as never,
}));

vi.mock('$lib/utils/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/navigation')>();
  return {
    ...actual,
    isAlbumsRoute: () => true,
    navigate: vi.fn().mockResolvedValue(undefined),
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
    assetMultiSelectManager.clear();
    Element.prototype.animate = getAnimateMock();
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
});
