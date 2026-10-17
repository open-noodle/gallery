import { type SmartSearchFacetsResponseDto } from '@immich/sdk';
import type { ActionItem } from '@immich/ui';
import { flushSync } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { createFilterState, type FilterPanelConfig, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { TimelineManagerOptions } from '$lib/managers/timeline-manager/types';
import { storeTypedSearchNames } from '$lib/utils/typed-search/typed-search-name-cache';
import { assetFactory, timelineAssetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import { createAlbumTimeline } from './album-timeline';
import { FilteredTimelineController, type FilteredTimelineConfig } from './filtered-timeline-controller.svelte';
import { createPhotosTimeline } from './photos-timeline';
import { createRecentlyAddedTimeline } from './recently-added-timeline.svelte';
import { createSpaceTimeline } from './space-timeline';

const { gotoMock, registerSelectionContextMock, topVisibleAnchorMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
  registerSelectionContextMock: vi.fn(),
  topVisibleAnchorMock: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});
vi.mock('$lib/managers/global-search-manager.svelte', () => ({
  globalSearchManager: { registerSearchablePageFilters: vi.fn(() => vi.fn()) },
}));
vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerSelectionContext: registerSelectionContextMock,
}));
vi.mock('$lib/utils/filter-name-resolution', () => ({ resolveFilterNames: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/gallery/timeline/timeline-anchor', () => ({
  getTimelineTopVisibleAnchor: topVisibleAnchorMock,
}));

const emptySuggestions = () => ({
  countries: [],
  cities: [],
  cameraMakes: [],
  cameraModels: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
});

const facets = (total: number) =>
  ({ ...emptySuggestions(), total, timeBuckets: [] }) as unknown as SmartSearchFacetsResponseDto;

const stubTimeline = () => ({
  assetCount: 3,
  isInitialized: true,
  months: [{}],
  isEmptyForOptions: vi.fn(() => false),
  update: vi.fn(),
  removeAssets: vi.fn(),
  upsertAssets: vi.fn(),
});

let timeline: ReturnType<typeof stubTimeline>;
let browseConfig: FilterPanelConfig;
const roots: Array<() => void> = [];

const baseConfig = (overrides: Partial<FilteredTimelineConfig> = {}): FilteredTimelineConfig => ({
  name: 'test',
  getTimelineManager: () => timeline as unknown as TimelineManager,
  scope: () => ({ withSharedSpaces: true }),
  timelineOptions: (filters: FilterState) => ({ isFavorite: filters.isFavorite }) as TimelineManagerOptions,
  browseConfig: () => browseConfig,
  ...overrides,
});

/** Builds inside an effect root (the controller registers effects) and flushes its first run. */
const create = (build: () => FilteredTimelineController, after?: (controller: FilteredTimelineController) => void) => {
  let controller!: FilteredTimelineController;
  roots.push(
    $effect.root(() => {
      controller = build();
      after?.(controller);
    }),
  );
  flushSync();
  return controller;
};

const createController = (overrides: Partial<FilteredTimelineConfig> = {}) =>
  create(() => new FilteredTimelineController(baseConfig(overrides)));

const navigate = (url: string) => {
  mockPage.url = new URL(url, 'https://gallery.test');
  flushSync();
};

/** A facet fetch that only settles when the test says so, exposing its abort signal. */
const pendingFacets = () => {
  let resolve!: (value: SmartSearchFacetsResponseDto) => void;
  let reject!: (error: unknown) => void;
  let signal: AbortSignal | undefined;
  sdkMock.searchSmartFacets.mockImplementationOnce((_dto, options) => {
    signal = options?.signal ?? undefined;
    return new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    resolve: (v: SmartSearchFacetsResponseDto) => resolve(v),
    reject: (e: unknown) => reject(e),
    signal: () => signal,
  };
};

describe('FilteredTimelineController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    timeline = stubTimeline();
    browseConfig = {
      sections: [],
      suggestionsProvider: vi.fn(() => Promise.resolve(emptySuggestions())),
      baselineProvider: vi.fn(() =>
        Promise.resolve({ ...emptySuggestions(), people: [{ id: 'p9', name: 'Bob' }], tags: [] }),
      ),
    };
    authManager.setUser(userAdminFactory.build({ id: 'me' }));
    authManager.setPreferences(preferencesFactory.build());
    mockPage.reset('https://gallery.test/photos');
  });

  afterEach(() => {
    for (const cleanup of roots.splice(0)) {
      cleanup();
    }
    assetMultiSelectManager.clear();
    authManager.reset();
  });

  // 1
  describe('searchable URL sync', () => {
    it('does not stamp sort=desc on a browse URL and replaces state without scrolling', () => {
      const sut = createController();
      sut.onFiltersChange({ ...sut.filters, isFavorite: true });
      expect(gotoMock).toHaveBeenCalledTimes(1);
      const [url, options] = gotoMock.mock.calls[0];
      expect(url).toContain('favorite=true');
      expect(url).not.toContain('sort=');
      expect(options).toEqual({ replaceState: true, keepFocus: true, noScroll: true });
    });

    it('keeps sort=desc when a query is committed or the sort is explicit', () => {
      navigate('/photos?q=cat');
      const sut = createController();
      sut.onFiltersChange({ ...sut.filters, sortOrder: 'desc' });
      expect(gotoMock.mock.calls[0][0]).toContain('sort=desc');

      gotoMock.mockClear();
      navigate('/photos?sort=desc');
      const explicit = createController();
      explicit.onFiltersChange({ ...explicit.filters, isFavorite: true });
      expect(gotoMock.mock.calls[0][0]).toContain('sort=desc');
    });

    it('does not navigate when the URL would not change', () => {
      navigate('/photos?favorite=true');
      const sut = createController();
      sut.onFiltersChange(sut.filters);
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  // 2
  describe('filter-state URL mode', () => {
    it('ignores ?at= churn and does not rewrite a reordered but equivalent URL', () => {
      navigate('/albums/a1?favorite=true&type=image');
      const sut = createController({ urlMode: 'filter-state', hydrate: () => ({ ...createFilterState() }) });
      const before = sut.filters;

      navigate('/albums/a1?favorite=true&type=image&at=asset-1');
      expect(sut.filters).toBe(before);

      navigate('/albums/a1?type=image&favorite=true');
      sut.onFiltersChange({ ...createFilterState(), isFavorite: true, mediaType: 'image' });
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  // 3
  describe('query change', () => {
    it('aborts in-flight facets, fires onQueryChange once and keeps searchable results', async () => {
      navigate('/photos?q=cat');
      const onQueryChange = vi.fn();
      const sut = createController({ onQueryChange });
      // Facets for the old query are loaded, so the "cleared" assertion below can fail.
      sdkMock.searchSmartFacets.mockResolvedValueOnce(facets(3));
      await sut.loadSmartFacets(sut.filters);
      expect(sut.smartFacets?.total).toBe(3);
      const fetch = pendingFacets();
      void sut.loadSmartFacets({ ...sut.filters, isFavorite: true });
      sut.searchResults = [assetFactory.build()];

      navigate('/photos?q=dog');
      expect(fetch.signal()?.aborted).toBe(true);
      expect(sut.smartFacets).toBeUndefined();
      expect(sut.searchResults).toHaveLength(1);
      expect(onQueryChange).toHaveBeenCalledTimes(1);

      navigate('/photos?q=dog&favorite=true');
      expect(sut.filters.isFavorite).toBe(true);
      expect(onQueryChange).toHaveBeenCalledTimes(1);
      fetch.reject(new DOMException('aborted', 'AbortError'));
      await Promise.resolve();
    });

    it('clears the results in filter-state mode', () => {
      navigate('/albums/a1?q=cat');
      const sut = createController({ urlMode: 'filter-state', hydrate: () => createFilterState() });
      sut.searchResults = [assetFactory.build()];
      navigate('/albums/a1?q=dog');
      expect(sut.searchResults).toEqual([]);
    });
  });

  // 4
  describe('loadSmartFacets', () => {
    beforeEach(() => navigate('/photos?q=cat'));

    it('memoises on the request shape; a sortOrder change does not refetch', async () => {
      sdkMock.searchSmartFacets.mockResolvedValue(facets(5));
      const sut = createController();
      await sut.loadSmartFacets(sut.filters);
      await sut.loadSmartFacets({ ...sut.filters, sortOrder: 'asc' });
      expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
      expect(sut.smartFacets?.total).toBe(5);
    });

    it('reuses the in-flight promise for the same key', async () => {
      const fetch = pendingFacets();
      const sut = createController();
      const first = sut.loadSmartFacets(sut.filters);
      const second = sut.loadSmartFacets(sut.filters);
      expect(second).toBe(first);
      expect(sdkMock.searchSmartFacets).toHaveBeenCalledTimes(1);
      fetch.resolve(facets(2));
      expect(await first).toEqual(facets(2));
      expect(sut.smartFacets?.total).toBe(2);
    });

    it('resolves a failed fetch to the previous facets and logs only when not aborted', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      sdkMock.searchSmartFacets.mockResolvedValueOnce(facets(7)).mockRejectedValueOnce(new Error('boom'));
      const sut = createController();
      await sut.loadSmartFacets(sut.filters);
      expect(await sut.loadSmartFacets({ ...sut.filters, isFavorite: true })).toEqual(facets(7));
      expect(error).toHaveBeenCalledTimes(1);

      error.mockClear();
      const fetch = pendingFacets();
      const aborted = sut.loadSmartFacets({ ...sut.filters, mediaType: 'video' });
      // An explicit second fetch: the superseding request must not fall through to another test's mock.
      const superseding = pendingFacets();
      const latest = sut.loadSmartFacets({ ...sut.filters, mediaType: 'image' });
      expect(fetch.signal()?.aborted).toBe(true);
      expect(superseding.signal()?.aborted).toBe(false);
      fetch.reject(new DOMException('aborted', 'AbortError'));
      await aborted;
      expect(error).not.toHaveBeenCalled();
      superseding.resolve(facets(1));
      expect(await latest).toEqual(facets(1));
      error.mockRestore();
    });
  });

  // 5
  describe('panel config in query mode', () => {
    beforeEach(() => navigate('/photos?q=cat'));

    it('rejects suggestions with facetFailure=throw and resolves empty with facetFailure=empty', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      sdkMock.searchSmartFacets.mockRejectedValue(new Error('down'));
      const thrower = createController();
      await expect(thrower.panelConfig.suggestionsProvider!(thrower.filters)).rejects.toThrow();

      const empty = createController({ facetFailure: 'empty' });
      await expect(empty.panelConfig.suggestionsProvider!(empty.filters)).resolves.toEqual(emptySuggestions());
    });

    it('has no baseline in query mode unless queryModeProviders is false', async () => {
      const sut = createController();
      await expect(sut.panelConfig.baselineProvider!()).resolves.toBeUndefined();
      expect(browseConfig.baselineProvider).not.toHaveBeenCalled();

      const album = createController({ queryModeProviders: false });
      const baseline = await album.panelConfig.baselineProvider!();
      expect(baseline?.people).toEqual([{ id: 'p9', name: 'Bob' }]);
      expect(album.personNames.get('p9')).toBe('Bob');
    });
  });

  // 6
  describe('grouping and zoom', () => {
    it('is inert outside the browse timeline', () => {
      const sut = createController({ isBrowse: () => false });
      expect(sut.timelineProps).toEqual({
        onTimelineBucketActivate: undefined,
        temporalAnchor: undefined,
        onTemporalAnchorResolved: undefined,
        grouping: 'day',
        onGroupingChange: undefined,
      });
      expect(sut.options).not.toHaveProperty('grouping');
    });

    it('ignores a bucket click when zoom is off or a selection is active', () => {
      const bucket = { grouping: 'year' as const, date: { year: 2020 } };
      const noZoom = createController({ canZoom: () => false });
      noZoom.onTimelineBucketActivate(bucket);
      expect(noZoom.grouping).toBe('day');

      const sut = createController();
      assetMultiSelectManager.selectAsset(timelineAssetFactory.build());
      sut.onTimelineBucketActivate(bucket);
      expect(sut.grouping).toBe('day');

      assetMultiSelectManager.clear();
      sut.onTimelineBucketActivate(bucket);
      expect(sut.grouping).toBe('month');
      expect(sut.temporalAnchor).toEqual({ year: 2020 });
    });

    it('anchors a grouping change at the top visible bucket', () => {
      topVisibleAnchorMock.mockReturnValue({ year: 2019, month: 4 });
      const sut = createController();
      sut.onGroupingChange('month');
      expect(sut.grouping).toBe('month');
      expect(sut.temporalAnchor).toEqual({ year: 2019, month: 4 });
      expect(sut.options).toMatchObject({ grouping: 'month' });
    });
  });

  // 7
  describe('filter edits', () => {
    it('resets the anchor only for temporal edits in searchable mode', () => {
      const sut = createController();
      sut.temporalAnchor = { year: 2020 };
      sut.onFiltersChange({ ...sut.filters, isFavorite: true });
      expect(sut.temporalAnchor).toEqual({ year: 2020 });
      sut.onFiltersChange({ ...sut.filters, selectedYear: 2021 });
      expect(sut.temporalAnchor).toBeUndefined();

      const album = createController({ urlMode: 'filter-state', hydrate: () => createFilterState() });
      album.temporalAnchor = { year: 2020 };
      album.onFiltersChange({ ...album.filters, selectedYear: 2021 });
      expect(album.temporalAnchor).toEqual({ year: 2020 });
    });

    it('clears the temporal filter on a timeline chip removal in filter-state mode', () => {
      const sut = createController({ urlMode: 'filter-state', hydrate: () => createFilterState() });
      sut.filters = { ...sut.filters, selectedYear: 2020, selectedMonth: 3, isFavorite: true };
      sut.onRemoveFilter('timeline');
      expect(sut.filters.selectedYear).toBeUndefined();
      expect(sut.filters.selectedMonth).toBeUndefined();
      expect(sut.filters.isFavorite).toBe(true);
    });

    it('does not write the URL on clear-all while a query is committed', () => {
      navigate('/photos?q=cat&favorite=true');
      const sut = createController();
      sut.onClearAll();
      expect(sut.filters.isFavorite).toBeUndefined();
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  // 8
  describe('bulk handlers', () => {
    it('act on the search results in query mode and the timeline in browse mode', () => {
      navigate('/photos?q=cat');
      const sut = createController();
      const asset = assetFactory.build({ isFavorite: false });
      sut.searchResults = [asset];
      sut.onFavorite([asset.id], true);
      expect(sut.searchResults[0].isFavorite).toBe(true);
      expect(timeline.update).not.toHaveBeenCalled();
      sut.onUndoDelete([]);
      expect(sut.searchReloadToken).toBe(1);
      sut.onSpaceAddAssets({ hiddenFromMyTimeline: true });
      expect(sut.timelineReloadToken).toBe(0);

      navigate('/photos');
      sut.onFavorite(['a'], true);
      expect(timeline.update).toHaveBeenCalledWith(['a'], expect.any(Function));
      sut.onAssetDelete(['a']);
      expect(timeline.removeAssets).toHaveBeenCalledWith(['a']);
      sut.onSpaceAddAssets({ hiddenFromMyTimeline: true });
      expect(sut.timelineReloadToken).toBe(1);
      sut.onSpaceAddAssets({});
      expect(sut.timelineReloadToken).toBe(1);
    });

    it('hides browse-only actions while search results show, keeping their own condition', () => {
      const onAction = vi.fn();
      const actions: Record<'Stack' | 'Unstack', ActionItem> = {
        Stack: { title: 'stack', onAction },
        Unstack: { title: 'unstack', onAction, $if: () => false },
      };

      navigate('/photos?q=cat');
      const sut = createController();
      const guarded = sut.browseOnly(actions);
      expect(guarded.Stack.$if?.()).toBe(false);

      navigate('/photos');
      expect(guarded.Stack.$if?.()).toBe(true);
      expect(guarded.Unstack.$if?.()).toBe(false);
      expect(guarded.Stack.onAction).toBe(onAction);
    });

    it('registers no handlers while the route cannot act', () => {
      const sut = createController();
      sut.registerSelectionContext({ canAct: () => false });
      const options = registerSelectionContextMock.mock.calls[0][0];
      expect(options.getOnFavorite()).toBeUndefined();
      expect(options.getOnDelete()).toBeUndefined();

      sut.registerSelectionContext();
      expect(registerSelectionContextMock.mock.calls[1][0].getOnFavorite()).toBe(sut.onFavorite);
    });
  });

  // 9: a persistent route switching entity must keep the typed-search names for the new URL,
  // whichever of its entity effect and the controller's URL effect runs first.
  describe('entity switch', () => {
    const switchTo = (url: string, setEntity: (id: string) => void, id: string) => {
      storeTypedSearchNames(url, { personNames: new Map([['p1', 'Ann']]), tagNames: new Map() });
      mockPage.url = new URL(url, 'https://gallery.test');
      setEntity(id);
      flushSync();
    };

    it('keeps the consumed names when reset() runs after the URL effect', () => {
      navigate('/spaces/a');
      let entity = $state('a');
      let seen = 'a';
      const sut = create(
        () => new FilteredTimelineController(baseConfig()),
        (controller) => {
          $effect(() => {
            if (entity !== seen) {
              seen = entity;
              controller.reset();
            }
          });
        },
      );

      switchTo('/spaces/b?people=p1', (id) => (entity = id), 'b');
      expect(sut.filters.personIds).toEqual(['p1']);
      expect(sut.personNames.get('p1')).toBe('Ann');
    });

    it('does not report a query change when the entity effect is a pre-effect (route pattern)', () => {
      navigate('/spaces/a?q=cat');
      const onQueryChange = vi.fn();
      let entity = $state('a');
      let seen = 'a';
      const sut = create(
        () => new FilteredTimelineController(baseConfig({ onQueryChange })),
        (controller) => {
          $effect.pre(() => {
            if (entity !== seen) {
              seen = entity;
              controller.reset();
            }
          });
        },
      );

      switchTo('/spaces/b?people=p1', (id) => (entity = id), 'b');
      expect(onQueryChange).not.toHaveBeenCalled();
      expect(sut.query).toBe('');
      expect(sut.personNames.get('p1')).toBe('Ann');
    });
  });

  // 10
  describe('keys and per-route scope', () => {
    it('derives storage and panel keys', () => {
      const sut = createController({ entityKey: () => 'e1' });
      expect(sut.storageKey).toBe('gallery-filter-visible-sections-test');
      expect(sut.panelKey).toBe('e1:test-browse');
      expect(createController({ storageKey: 'custom' }).storageKey).toBe('custom');

      navigate('/photos?q=cat');
      expect(createController().panelKey).toBe(':test-search-cat');
    });

    it.each([
      ['photos', '/photos?q=cat', () => createPhotosTimeline(() => undefined), { withSharedSpaces: true }],
      [
        'recently-added',
        '/recently-added?q=cat',
        () => createRecentlyAddedTimeline(() => undefined),
        { withSharedSpaces: undefined, spaceId: undefined, albumIds: undefined },
      ],
      [
        'space',
        '/spaces/s1?q=cat',
        () =>
          createSpaceTimeline({
            getSpace: () => ({ id: 's1' }) as never,
            getMembers: () => [],
            getTimelineManager: () => undefined,
            canZoom: () => true,
            onQueryChange: () => {},
          }),
        { spaceId: 's1', withSharedSpaces: undefined },
      ],
      [
        'album',
        '/albums/a1?q=cat',
        () =>
          createAlbumTimeline({
            name: 'album',
            getAlbum: () => ({ id: 'a1', albumUsers: [] }) as never,
            getTimelineManager: () => undefined,
            isBrowse: () => true,
          }),
        { albumIds: ['a1'], spaceId: undefined, withSharedSpaces: undefined },
      ],
    ])('%s scopes its facet request', async (_name, url, build, expected) => {
      navigate(url);
      sdkMock.searchSmartFacets.mockResolvedValue(facets(1));
      const sut = create(build);
      await sut.loadSmartFacets(sut.filters);
      const dto = sdkMock.searchSmartFacets.mock.calls[0][0].smartSearchFacetsDto;
      expect(dto).toMatchObject({ query: 'cat' });
      for (const [key, value] of Object.entries(expected)) {
        expect(dto[key as keyof typeof dto]).toEqual(value);
      }
    });
  });
});
