import { mdiTune } from '@mdi/js';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { timeToLoadTheMap } from '$lib/constants';
import { SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import MapPage from './+page.svelte';

const { featureFlagsMock, gotoMock, mockAssetViewerManager } = vi.hoisted(() => ({
  featureFlagsMock: { value: { map: true } as Record<string, unknown> },
  gotoMock: vi.fn().mockResolvedValue(undefined),
  mockAssetViewerManager: {
    isViewing: false,
    asset: undefined,
    showAssetViewer: vi.fn(),
    setAssetId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// The mock module and the spec import the SAME singleton, so assigning mockPage.url in a test is
// what the page's $effect sees. A plain vi.hoisted object registers no signal for a Svelte 5
// `$effect` reading `page.url.search` (I5) — this reactive mock is the faithful stand-in for the
// real `page` from $app/state.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
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
  featureFlagsManager: featureFlagsMock,
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
    // A goto() actually moves page.url, which re-runs the page's URL $effect. If the effect's
    // lastHandled token guard is ever broken, this turns goto -> $effect -> goto into a real loop
    // and the test times out — the correct, loud failure.
    gotoMock.mockImplementation((href: string) => {
      mockPage.url = new URL(href, 'https://gallery.test');
      return Promise.resolve();
    });
    mockPage.reset('https://gallery.test/map', {
      routeId: '/(user)/map/[[photos=photos]]/[[assetId=id]]',
    });
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
    sdkMock.searchSmart.mockResolvedValue({
      assets: { items: [], nextPage: null },
      albums: { items: [], nextPage: null },
    } as never);
    // This whole describe block pins the pre-existing intersection loop, which only ever runs
    // when machineLearning.clip.maxDistance is configured in (0, 2) — a cutoff-limited
    // smart-search result set (#767c) — arrange onto that instance explicitly rather than
    // relying on an ambient default.
    featureFlagsMock.value = { ...featureFlagsMock.value, map: true, smartSearchHasCutoff: true };
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

describe('Map page filters are URL-backed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // Stand in for SvelteKit: a goto() actually changes page.url, which re-runs the page's URL
    // $effect. If the effect's lastHandled token guard is ever broken, this turns goto -> $effect ->
    // goto into a real loop and the test times out — which is the correct, loud failure.
    gotoMock.mockImplementation((href: string) => {
      mockPage.url = new URL(href, 'https://gallery.test');
      return Promise.resolve();
    });
    mockPage.reset('https://gallery.test/map', {
      routeId: '/(user)/map/[[photos=photos]]/[[assetId=id]]',
    });
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
    // None of this describe's tests exercise the q/searchSmart intersection — reset explicitly
    // rather than depend on whatever the previous describe block left behind.
    featureFlagsMock.value = { map: true };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the filters from the URL into the marker query', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&make=Apple&rating=4&lens=RF24-70mm');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', make: 'Apple', rating: 4, lensModel: 'RF24-70mm' }),
      ),
    );
    expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
  });

  // NB: the panel stub's `filter-panel-set-year` is deliberately NOT used here. It sets only the
  // transient selectedYear, which encodeFilterParams does not emit — so the rebuilt URL would be
  // identical, the no-op guard would fire, and goto would never be called. Use a stub button that
  // sets a URL-ENCODED filter: `filter-panel-set-country` (bindable-filter-panel.stub.svelte:112-122,
  // sets country: 'Germany' -> `country=Germany`).
  it('writes a filter change back to the URL, preserving spaceId, q and the viewport hash', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&q=ski#12/48.85/2.35');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target).toContain('/map?');
    expect(target).toContain('spaceId=space-1');
    expect(target).toContain('q=ski');
    expect(target).toContain('country=Germany');
    expect(target).toContain('#12/48.85/2.35');
  });

  // The transient-only case, from the other side: a year is not a URL param, so the rebuilt URL is
  // unchanged and the guard must swallow the write rather than churn history. (The full year +
  // URL-filter round trip is pinned below, now that this suite has a reactive page mock too — I5.)
  it('writes a year-only filter change to the URL, keeping the space scope', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1');

    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));
    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target).toContain('year=2015');
    expect(target).toContain('spaceId=space-1');
  });

  // The NIT decision, client side: a space and an album are two different scopes and the server
  // rejects their combination with a 400. Drop the album at hydrate so a hand-typed URL degrades to
  // a plain space map instead of an error.
  it('drops a stray albumId when the map is scoped to a space', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&albumId=album-9&make=Apple');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalled());
    const [options] = sdkMock.getFilteredMapMarkers.mock.calls.at(-1) as [Record<string, unknown>];
    expect(options).toMatchObject({ spaceId: 'space-1', make: 'Apple' });
    expect(options.albumId).toBeUndefined();
  });

  // …but WITHOUT a space, an albumId IS a legitimate map scope (that is what the server-side album
  // access fix in Step 1 is for).
  it('keeps an albumId scope on the global map', async () => {
    mockPage.url = new URL('https://gallery.test/map?albumId=album-9');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'album-9' })),
    );
  });

  // Slice 6 — this suite renders the REAL ActiveFiltersBar, so it is where the album chip's label is
  // pinned end to end: a pasted/reloaded `?albumId=` link has no session-cached name and no
  // suggestions feeder, so without by-id resolution the chip degrades to a raw UUID — the headline
  // failure mode of a shareable filter URL.
  it('names the album chip by id instead of showing the raw album id', async () => {
    sdkMock.getAlbumInfo.mockResolvedValue({ id: 'album-9', albumName: 'Iceland 2026' } as never);
    mockPage.url = new URL('https://gallery.test/map?albumId=album-9');

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      expect(sdkMock.getAlbumInfo).toHaveBeenCalledWith({ id: 'album-9' });
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Iceland 2026');
    });
    expect(screen.getByTestId('active-filters-bar')).not.toHaveTextContent('album-9');
  });

  // The real ✕, clicked on the real chip, inside a space scope (the spec's BDD: "and likewise when I
  // click it inside a Space") — the lens filter must leave the URL, and the space scope must stay.
  it('clears a lens chip from the URL when its ✕ is clicked in a space-scoped map', async () => {
    mockPage.url = new URL('https://gallery.test/map?spaceId=space-1&lens=RF24-70mm');

    renderPage();
    await flushQueryDebounce();

    const chips = await screen.findAllByTestId('active-chip');
    const lensChip = chips.find((chip) => chip.textContent?.includes('RF24-70mm'));
    expect(lensChip).toBeDefined();
    await fireEvent.click(lensChip!.querySelector('[data-testid="chip-close"]')!);

    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target).not.toContain('lens=');
    expect(target).toContain('spaceId=space-1');
  });

  // Finding 1 (#767 fresh instance): clearing the temporal chip INSIDE the timeline panel used to
  // only mutate the bound `filters` — the page never wrote the URL back, so from/to survived a
  // reload/Back/shared link. MapTimelinePanel must be wired with onFiltersChange={syncMapFilterUrl}
  // exactly like FilterPanel is (see the wiring above), so this proves the PAGE side of the fix.
  it('writes the URL when the temporal filter is cleared from inside the timeline panel', async () => {
    mockPage.url = new URL('https://gallery.test/map?from=2024-01-01&to=2024-06-30');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();
    await flushMapLoad();
    await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
    await fireEvent.click(screen.getByTestId('map-panel-clear-temporal-filter'));

    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target).not.toContain('from=');
    expect(target).not.toContain('to=');
  });

  // Task 10: the cluster panel's asset scope was captured ONCE from the markers at click time and
  // fed to the panel as a client-side `assetFilter` EXCLUSION set, which no filter change ever
  // recomputed. So the panel could only shrink: adding a filter left it answering from the old set,
  // and clearing one — from the left panel or from inside the panel itself — could never surface the
  // assets that had just started matching. It is derived from the CURRENT markers now, so it tracks
  // the filters in both directions.
  it('narrows the cluster selection when a filter change drops markers', async () => {
    sdkMock.getFilteredMapMarkers.mockResolvedValue([
      { id: 'asset-1', lat: 1, lon: 1 },
      { id: 'asset-2', lat: 3, lon: 3 },
      { id: 'asset-3', lat: 5, lon: 5 },
    ] as never);

    renderPage();
    await flushQueryDebounce();
    await flushMapLoad();
    await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));

    expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute(
      'data-selected-cluster-ids',
      'asset-1,asset-2,asset-3',
    );

    // A rating/country/… chip drops two of the three pins.
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 1 }] as never);
    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));
    await flushQueryDebounce();

    await waitFor(() =>
      expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute('data-selected-cluster-ids', 'asset-1'),
    );
  });

  // The direction that was outright impossible before: WIDENING.
  it('widens the cluster selection when a filter is cleared and new markers match', async () => {
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 1 }] as never);
    mockPage.url = new URL('https://gallery.test/map?country=Germany');

    renderPage();
    await flushQueryDebounce();
    await flushMapLoad();
    await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));

    expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute('data-selected-cluster-ids', 'asset-1');

    // Clearing the country brings two more assets — inside the same cluster's bbox — back into the
    // markers. They must reach the panel; the click-time snapshot could never let them in.
    sdkMock.getFilteredMapMarkers.mockResolvedValue([
      { id: 'asset-1', lat: 1, lon: 1 },
      { id: 'asset-2', lat: 1, lon: 1 },
      { id: 'asset-3', lat: 1, lon: 1 },
    ] as never);
    await fireEvent.click(screen.getByTestId('filter-panel-clear-location'));
    await flushQueryDebounce();

    await waitFor(() =>
      expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute(
        'data-selected-cluster-ids',
        'asset-1,asset-2,asset-3',
      ),
    );
  });

  // Back/forward: SvelteKit swaps page.url without remounting the page component. The $effect must
  // notice and re-hydrate — this is the same code path a reload and a shared URL take. Only provable
  // now that this suite's page mock is reactive (I5) — the old plain vi.hoisted object registered no
  // signal for a Svelte 5 $effect reading page.url.search, so reassigning it here would have been a
  // no-op the effect never saw.
  it('re-hydrates when the URL changes underneath the page (back/forward)', async () => {
    mockPage.url = new URL('https://gallery.test/map?make=Apple&rating=4');
    renderPage();
    await flushQueryDebounce();

    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ make: 'Apple', rating: 4 })),
    );

    // The browser Back button: no remount, just a new URL.
    mockPage.url = new URL('https://gallery.test/map?make=Apple');
    await flushQueryDebounce();

    await waitFor(() => {
      const [options] = sdkMock.getFilteredMapMarkers.mock.calls.at(-1) as [Record<string, unknown>];
      expect(options).toMatchObject({ make: 'Apple' });
      expect(options.rating).toBeUndefined();
    });
  });

  // C2's regression test. TimelineAssetViewer.handleClose -> replaceScrollTarget writes `?at=` onto
  // /map when an asset closes over a filtered map. The year is URL-backed (D2), so it survives on
  // its own — and `?at=` must still not read as a filter change, or the map re-runs its marker fetch
  // for an identical FilterState on every viewer close.
  it('keeps the year when the asset viewer closes (?at= is not a filter change)', async () => {
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));

    // Simulate the asset viewer closing: replaceScrollTarget appends `at` to the CURRENT url, which
    // now carries year=2015 (the page wrote it). This is a raw property set (not a fireEvent), so
    // nothing implicitly flushes the pending $effect the way fireEvent does — tick() forces that
    // flush. A plain waitFor here would be vacuous under fake timers: its own first synchronous
    // check runs BEFORE the effect flushes and sees the still-2015 value, so it would pass whether
    // or not the bug is present (compare I3).
    const withAt = new URL(mockPage.url);
    withAt.searchParams.set('at', 'asset-1');
    mockPage.url = withAt;
    await tick();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
  });

  // I4's regression test. Clicking the search chip's X calls clearCommittedQuery, which goto()s a
  // URL without `q` — that re-runs the re-hydrate effect and rebuilds `filters` from the URL alone
  // unless the transient year is carried over the same way syncMapFilterUrl does it. Reviewer-proven
  // repro: year 2015 -> "" after clicking the chip's X.
  it('keeps a transient year when the committed q chip is cleared', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=beach');
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));

    // fireEvent flushes pending effects itself (unlike a raw page.url mutation — see the tick() note
    // above), so the state right after this settles is the real post-effect state, not a stale one.
    await fireEvent.click(screen.getByTestId('search-chip-close'));

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
  });

  // D2 (was the transient-year carry-over test). A picked year is IN the URL codec now: it writes,
  // and survives a second URL-writing filter change on its own. The map's viewport hash (which lives
  // outside the FilterState codec entirely) survives the same write.
  it('writes a picked year to the URL and keeps it across a second filter change, preserving the viewport hash', async () => {
    mockPage.url = new URL('https://gallery.test/map#12/48.85/2.35');
    renderPage();
    await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));
    // A year IS in the URL codec, so picking one writes.
    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    const [yearTarget] = gotoMock.mock.calls.at(-1) as [string];
    expect(yearTarget).toContain('year=2015');
    expect(yearTarget).toContain('#12/48.85/2.35');

    await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

    await waitFor(() => {
      const [target] = gotoMock.mock.calls.at(-1) as [string];
      expect(target).toContain('country=Germany');
      expect(target).toContain('year=2015');
      expect(target).toContain('#12/48.85/2.35');
    });

    await waitFor(() => expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015'));
  });

  // D2 — a shared map link carries the year.
  it('hydrates a shared ?year= link into the picker, the chip and the marker query', async () => {
    mockPage.url = new URL('https://gallery.test/map?year=2023&month=6');

    renderPage();
    await flushQueryDebounce();

    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2023');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '6');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2023');
    await waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({
          takenAfter: '2023-06-01T00:00:00.000Z',
          takenBefore: '2023-07-01T00:00:00.000Z',
        }),
      ),
    );
  });
});

describe('Map page smart-search honesty (#767c)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    mockPage.url = new URL('https://gallery.test/map');
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
    // Default instance: clip.maxDistance = 0 ⇒ smart search cannot narrow anything.
    featureFlagsMock.value = { ...featureFlagsMock.value, map: true, smartSearchHasCutoff: false };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies every structured filter and says the smart-search term is not applied', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=ski&make=Apple&rating=4');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => {
      // the structured half of the filter IS honoured…
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ make: 'Apple', rating: 4 }));
      // …the smart-search half is not, and the map says so instead of pretending
      expect(screen.getByTestId('map-smart-search-notice')).toBeInTheDocument();
    });

    // The loop that pages the entire library and narrows nothing never runs here (R2).
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
    // The markers matching the structured filters are still shown — not a silent full library, and
    // not a silently empty map either.
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-1');
  });

  it('intersects and shows NO notice when the instance has a smart-search cutoff', async () => {
    // The regression guard for the configured instance: this is the test that fails if someone
    // "simplifies" the gate away by deleting the loop.
    featureFlagsMock.value = { ...featureFlagsMock.value, smartSearchHasCutoff: true };
    mockPage.url = new URL('https://gallery.test/map?q=ski');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([
      { id: 'asset-1', lat: 1, lon: 2 } as never,
      { id: 'asset-2', lat: 3, lon: 4 } as never,
    ]);
    sdkMock.searchSmart.mockResolvedValue({
      assets: { items: [{ id: 'asset-2' }], nextPage: null },
    } as never);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.searchSmart).toHaveBeenCalled());
    // Narrowed to the semantic match…
    await waitFor(() => expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'asset-2'));
    // …and no notice, because the term genuinely WAS applied.
    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });

  it('shows no notice when there is no smart-search term', async () => {
    mockPage.url = new URL('https://gallery.test/map?make=Apple');
    sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

    renderPage();
    await flushQueryDebounce();

    await waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalled());
    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });

  it('shows no notice for a whitespace-only q', async () => {
    mockPage.url = new URL('https://gallery.test/map?q=%20%20');

    renderPage();
    await flushQueryDebounce();

    expect(screen.queryByTestId('map-smart-search-notice')).not.toBeInTheDocument();
  });
});
