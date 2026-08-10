import { mdiTune } from '@mdi/js';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { timeToLoadTheMap } from '$lib/constants';
import { SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
import MapPage from './+page.svelte';

const { gotoMock, mockPage, mockAssetViewerManager } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  mockPage: {
    url: new URL('https://gallery.test/map'),
    route: { id: '/(user)/map/[[photos=photos]]/[[assetId=id]]' },
    params: {},
  },
  mockAssetViewerManager: {
    isViewing: false,
    asset: undefined,
    showAssetViewer: vi.fn(),
    setAssetId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/state', () => ({ page: mockPage }));

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

vi.mock('./MapTimelinePanel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-timeline-panel-grouping.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/portal-passthrough.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: mockAssetViewerManager,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: true } },
}));

vi.mock('$lib/utils/navigation', () => ({ navigate: () => Promise.resolve() }));

function renderPage() {
  const props = {
    data: {
      meta: { title: 'Map' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof MapPage; componentProps: typeof props }>, {
    component: MapPage,
    componentProps: props,
  });
}

async function flushQueryDebounce() {
  await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
}

async function flushMapLoad() {
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(timeToLoadTheMap);
  await vi.dynamicImportSettled();
}

describe('Map page query intersection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    mockPage.url = new URL('https://gallery.test/map');
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
    sdkMock.searchSmart.mockResolvedValue({
      assets: { items: [], nextPage: null },
      albums: { items: [], nextPage: null },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('keeps the existing marker flow when q is absent', async () => {
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1);
      expect(sdkMock.searchSmart).not.toHaveBeenCalled();
      expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-1');
    });
  });

  it('exposes the full canonical section set in the map filter panel', () => {
    // #802 — the Map panel used to stop at 'albums', one section short of every other view.
    renderPage();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute(
      'data-sections',
      'timeline,people,location,camera,tags,rating,media,favorites,albums,text',
    );
  });

  // #802 — the Text section is only a real fix if the value actually reaches the marker query.
  // Before this change FilteredMapMarkerDto had no text fields at all, so the pins would have
  // kept showing assets the timeline had already filtered out.
  it('passes text filters to filtered map markers when set', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-text'));
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });
  });

  it('passes has-no-album to filtered map markers when selected', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-no-album-filter'));
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ isNotInAlbum: true }));
    });
  });

  it('passes has-album to filtered map markers when selected', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('select-has-album-filter'));
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }));
    });
  });

  it('intersects map markers with paginated searchSmart ids when q is present', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([
      { id: 'asset-1', lat: 1, lon: 2 } as never,
      { id: 'asset-2', lat: 2, lon: 3 } as never,
    ]);
    sdkMock.searchSmart.mockResolvedValueOnce({
      assets: { items: [{ id: 'asset-2' }], nextPage: null },
      albums: { items: [], nextPage: null },
    } as never);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      expect(screen.getByTestId('search-chip')).toHaveTextContent('beach');
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1);
      expect(sdkMock.searchSmart).toHaveBeenCalledWith(
        expect.objectContaining({
          smartSearchDto: expect.objectContaining({ query: 'beach', page: 1, size: 100 }),
        }),
      );
      expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-2');
    });
  });

  it('stops paging once every currently fetched marker id has been matched', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-2', lat: 2, lon: 3 } as never]);
    sdkMock.searchSmart.mockResolvedValueOnce({
      assets: { items: [{ id: 'asset-2' }], nextPage: 2 },
      albums: { items: [], nextPage: null },
    } as never);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.searchSmart).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-2');
    });
  });

  it('clears q through the URL while preserving the map hash', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach#12/48.8566/2.3522');

    renderPage();

    await fireEvent.click(screen.getByTestId('search-chip-close'));

    expect(gotoMock).toHaveBeenCalledWith('/map#12/48.8566/2.3522', {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  });

  it('anchors the active filters bar to the map content column instead of a hard-coded desktop offset', () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach');

    renderPage();

    const activeFiltersBar = screen.getByTestId('active-filters-bar');
    const overlay = activeFiltersBar.parentElement as HTMLElement | null;
    const contentColumn = overlay?.parentElement as HTMLElement | null;

    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('absolute');
    expect(overlay?.className).toContain('inset-x-0');
    expect(overlay?.className).not.toContain('sm:left-[280px]');
    expect(contentColumn?.className).toContain('relative');
  });

  it('keeps map FilterPanel temporal state untouched when the timeline panel activates a bucket', async () => {
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();
    await flushMapLoad();
    await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
    await fireEvent.click(screen.getByTestId('map-panel-activate-year'));

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute('data-bucket-activations', '1');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('keeps explicit map temporal filters synchronized with the FilterPanel and chips', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
    });
  });

  it('clears explicit map temporal filter state from map chips and the FilterPanel', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
    await fireEvent.click(screen.getByTestId('clear-all-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    });
  });

  it('does not leave explicit temporal state in the mobile filter overlay after clearing map chips', async () => {
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
    await fireEvent.click(screen.getByLabelText('Close filters'));
    await fireEvent.click(screen.getByTestId('clear-all-btn'));
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    });
  });

  it('uses the shared filter icon on the mobile toggle (#964)', () => {
    // Every other filter affordance — the desktop header toggle and the panel's own collapsed
    // button — is mdiTune. The map's hand-rolled mobile button was the only mdiFilterVariant.
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();

    const toggle = screen.getByTestId('map-mobile-filter-toggle');
    expect(toggle.querySelector(':scope svg path')).toHaveAttribute('d', mdiTune);
    expect(toggle).toHaveAccessibleName();
  });

  it('keeps the mobile filter overlay clear of the app chrome (#964)', async () => {
    // `fixed inset-0` starts the drawer at the top of the viewport, which buries the filter
    // panel's own header — the close button and the section menu — under the navigation bar.
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));

    const overlay = screen.getByTestId('map-mobile-filter-overlay');
    expect(overlay.className.split(/\s+/)).not.toContain('inset-0');
    expect(overlay.className).toContain('top-(--navbar-height)');
  });

  it('renders the mobile filter overlay outside the page stacking context (#964)', async () => {
    // The map content lives in an `isolate` stacking context, and the page header row paints on
    // top of it — so a z-index inside that subtree can never lift the drawer above the "Map"
    // title. It has to be portalled to the body instead.
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));

    const overlay = screen.getByTestId('map-mobile-filter-overlay');
    expect(overlay.closest('[data-testid="portal"]')).toHaveAttribute('data-portal-target', 'body');
    expect(overlay.closest('.isolate')).toBeNull();
  });

  it('dismisses the mobile filter overlay when the panel is closed (#964)', async () => {
    // Collapsing leaves the drawer mounted over a full-screen scrim with nothing but a 48px icon
    // strip in it — the "stuck open" half of the report. On mobile, closing means closing.
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));
    await fireEvent.click(screen.getByTestId('filter-panel-collapse'));

    expect(screen.queryByTestId('map-mobile-filter-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-panel-stub')).not.toBeInTheDocument();
  });

  it('reopens the mobile filter overlay expanded after it was closed from the panel (#964)', async () => {
    // The drawer owns the collapsed state, so a close must not persist as "collapsed" into the
    // next open — that would reopen the drawer showing the bare icon strip.
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 390 });

    renderPage();
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));
    await fireEvent.click(screen.getByTestId('filter-panel-collapse'));
    await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-collapsed', 'false');
  });

  it('shows the add-all-to-collection button when the map is filtered with markers', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);
    sdkMock.searchSmart.mockResolvedValueOnce({
      assets: { items: [{ id: 'asset-1' }], nextPage: null },
      albums: { items: [], nextPage: null },
    } as never);

    renderPage();
    await flushQueryDebounce();
    await flushMapLoad();

    expect(await screen.findByTestId('add-all-to-collection')).toBeInTheDocument();
  });
});
