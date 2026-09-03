import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import Timeline from './Timeline.svelte';

const testState = vi.hoisted(() => ({
  representativeBucket: {
    grouping: 'year' as const,
    timeBucket: '2015-01-01',
    viewId: 'year:2015-01-01',
    date: { year: 2015 },
    count: 1,
    top: 0,
    height: 296,
    isLoaded: true,
    representativeAssetId: null,
    representativeThumbhash: null,
    representativeRatio: null,
  } as {
    grouping: 'year' | 'month' | 'day';
    timeBucket: string;
    viewId: string;
    date: { year: number; month?: number; day?: number };
    count: number;
    top: number;
    height: number;
    isLoaded: boolean;
    representativeAssetId: string | null;
    representativeThumbhash: string | null;
    representativeRatio: number | null;
  },
  grouping: 'day' as 'year' | 'month' | 'day',
  maxMd: false,
  pointerCoarse: false,
  isViewing: false,
  assetCount: 1,
  months: [] as unknown[],
  keepStaleGroupingOnUpdate: false,
  viewportHeight: 600,
  viewportWidth: 390,
  hasScrollableElement: true,
  scrollCalls: [] as number[],
  scrollTop: 0,
  maxScroll: 1,
  scrollToUpdatesAfterCalls: 1,
  domHeight: 296,
  renderOffset: 0,
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://gallery.test/photos'),
    route: { id: '/(user)/photos' },
  },
}));

vi.mock('$lib/components/timeline/actions/TimelineKeyboardActions.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Scrubber.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/HotModuleReload.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    get asset() {
      return undefined;
    },
    get isViewing() {
      return testState.isViewing;
    },
    gridScrollTarget: undefined,
  },
}));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: {
    get maxMd() {
      return testState.maxMd;
    },
    get pointerCoarse() {
      return testState.pointerCoarse;
    },
  },
}));

vi.mock('$lib/stores/preferences.store', async () => {
  const { readable } = await import('svelte/store');
  return {
    lang: readable('en-US'),
    // `utils.ts` derives `memoryLaneTitle` from this at module load, so the mock must carry it.
    locale: readable('en-US'),
  };
});

vi.mock('$lib/managers/timeline-manager/timeline-manager.svelte', () => ({
  TimelineManager: class TimelineManagerMock {
    grouping = testState.grouping;
    months = testState.months;
    timelineBuckets = [testState.representativeBucket];
    visibleWindow = { top: 0, bottom: 600 };
    isInitialized = true;
    assetCount = testState.assetCount;
    topSectionHeight = 0;
    bodySectionHeight = 296;
    bottomSectionHeight = 0;
    totalViewerHeight = 296;
    get domHeight() {
      return testState.domHeight;
    }
    get renderOffset() {
      return testState.renderOffset;
    }
    get viewportHeight() {
      return testState.viewportHeight;
    }
    set viewportHeight(value: number) {
      if (value !== 0) {
        testState.viewportHeight = value;
      }
    }
    get viewportWidth() {
      return testState.viewportWidth;
    }
    set viewportWidth(value: number) {
      if (value !== 0) {
        testState.viewportWidth = value;
      }
    }
    get hasEmptyViewport() {
      return testState.viewportHeight === 0 || testState.viewportWidth === 0;
    }
    showAssetOwners = false;
    albumAssets = new Set<string>();
    suspendTransitions = false;
    limitedScroll = false;
    get maxScroll() {
      return testState.maxScroll;
    }
    maxScrollPercent = 1;
    get scrollTop() {
      return testState.scrollTop;
    }
    get scrollableElement() {
      return testState.hasScrollableElement ? ({} as HTMLElement) : undefined;
    }
    set scrollableElement(value: HTMLElement | undefined) {
      testState.hasScrollableElement = Boolean(value);
    }
    scrolling = false;
    destroy = vi.fn();
    updateOptions = vi.fn((options?: { grouping?: 'year' | 'month' | 'day' }) => {
      if (!testState.keepStaleGroupingOnUpdate) {
        this.grouping = options?.grouping ?? 'day';
      }
    });
    setLayoutOptions = vi.fn();
    updateSlidingWindow = vi.fn();
    scrollTo = vi.fn((top: number) => {
      testState.scrollCalls.push(top);
      if (testState.scrollCalls.length >= testState.scrollToUpdatesAfterCalls) {
        testState.scrollTop = top;
      }
    });
    loadCoversForBuckets = vi.fn(() => Promise.resolve());
    loadTimelineMonth = vi.fn();
    getTimelineMonthByAssetId = vi.fn();
    findTimelineMonthForAsset = vi.fn();
    retrieveRange = vi.fn(() => Promise.resolve([]));
    getRandomAsset = vi.fn();
  },
}));

function assetInteraction(overrides: Partial<{ selectionActive: boolean }> = {}) {
  return {
    selectionActive: false,
    selectedGroup: new Set<string>(),
    assets: [],
    candidates: [],
    hasSelectedAsset: () => false,
    hasSelectionCandidate: () => false,
    addGroupToMultiselectGroup: vi.fn(),
    removeGroupFromMultiselectGroup: vi.fn(),
    addAssetToMultiselectGroup: vi.fn(),
    removeAssetFromMultiselectGroup: vi.fn(),
    selectAsset: vi.fn(),
    clearCandidates: vi.fn(),
    clear: vi.fn(),
    setAssetSelectionStart: vi.fn(),
    setAssetSelectionCandidates: vi.fn(),
    ...overrides,
  } as never;
}

function renderTimeline(props: Record<string, unknown> = {}) {
  return render(Timeline, {
    enableRouting: false,
    options: { grouping: testState.grouping },
    grouping: testState.grouping,
    assetInteraction: assetInteraction(),
    onTimelineBucketActivate: () => {},
    ...props,
  });
}

describe('Timeline representative grouping integration', () => {
  beforeEach(() => {
    testState.grouping = 'day';
    testState.maxMd = false;
    testState.pointerCoarse = false;
    testState.isViewing = false;
    testState.assetCount = 1;
    testState.months = [];
    testState.keepStaleGroupingOnUpdate = false;
    testState.viewportHeight = 600;
    testState.viewportWidth = 390;
    testState.hasScrollableElement = true;
    testState.scrollCalls = [];
    testState.scrollTop = 0;
    testState.maxScroll = 1;
    testState.scrollToUpdatesAfterCalls = 1;
    testState.domHeight = 296;
    testState.renderOffset = 0;
    testState.representativeBucket = {
      grouping: 'year',
      timeBucket: '2015-01-01',
      viewId: 'year:2015-01-01',
      date: { year: 2015 },
      count: 1,
      top: 0,
      height: 296,
      isLoaded: true,
      representativeAssetId: null,
      representativeThumbhash: null,
      representativeRatio: null,
    };
  });

  it('renders representative buckets instead of month groups in year mode', async () => {
    testState.grouping = 'year';

    renderTimeline({ onGroupingChange: () => {} });

    expect(await screen.findByTestId('timeline-representative-buckets')).toHaveAttribute('data-grouping', 'year');
    expect(screen.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();
  });

  it('shows the mobile grouping control only when a handler exists and overlays are inactive', async () => {
    testState.grouping = 'month';
    testState.maxMd = true;

    renderTimeline({ onGroupingChange: () => {} });

    expect(await screen.findByTestId('timeline-mobile-grouping-control-shell')).toBeInTheDocument();

    cleanup();
    renderTimeline({ assetInteraction: assetInteraction({ selectionActive: true }), onGroupingChange: () => {} });
    expect(screen.queryByTestId('timeline-mobile-grouping-control-shell')).not.toBeInTheDocument();

    cleanup();
    testState.isViewing = true;
    renderTimeline({ onGroupingChange: () => {} });
    expect(screen.queryByTestId('timeline-mobile-grouping-control-shell')).not.toBeInTheDocument();

    cleanup();
    testState.isViewing = false;
    renderTimeline();
    expect(screen.queryByTestId('timeline-mobile-grouping-control-shell')).not.toBeInTheDocument();
  });

  it('keeps the mobile grouping control in sync with the timeline manager grouping', async () => {
    testState.grouping = 'day';
    testState.maxMd = true;

    renderTimeline({
      options: { grouping: 'month' },
      grouping: 'day',
      onGroupingChange: () => {},
    });

    expect(await screen.findByTestId('timeline-representative-buckets')).toHaveAttribute('data-grouping', 'month');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'false');
  });

  it('waits for the manager grouping to match options before resolving a temporal anchor', () => {
    const onTemporalAnchorResolved = vi.fn();
    testState.grouping = 'month';
    testState.keepStaleGroupingOnUpdate = true;
    testState.representativeBucket = {
      grouping: 'month',
      timeBucket: '2015-08-01',
      viewId: 'month:2015-08-01',
      date: { year: 2015, month: 8 },
      count: 1,
      top: 240,
      height: 296,
      isLoaded: true,
      representativeAssetId: null,
      representativeThumbhash: null,
      representativeRatio: null,
    };

    renderTimeline({
      options: { grouping: 'day' },
      grouping: 'day',
      temporalAnchor: { year: 2015, month: 8 },
      onTemporalAnchorResolved,
    });

    expect(onTemporalAnchorResolved).not.toHaveBeenCalled();
  });

  it('waits for viewport geometry before resolving a day-mode temporal anchor', () => {
    const onTemporalAnchorResolved = vi.fn();
    testState.grouping = 'day';
    testState.viewportHeight = 0;
    testState.viewportWidth = 0;
    testState.months = [{ yearMonth: { year: 2015, month: 8 }, top: 0 }] as unknown[];

    renderTimeline({
      options: { grouping: 'day' },
      grouping: 'day',
      temporalAnchor: { year: 2015, month: 8 },
      onTemporalAnchorResolved,
    });

    expect(onTemporalAnchorResolved).not.toHaveBeenCalled();
  });

  it('waits for the scroll container before resolving a day-mode temporal anchor', () => {
    const onTemporalAnchorResolved = vi.fn();
    testState.grouping = 'day';
    testState.hasScrollableElement = false;
    testState.months = [{ yearMonth: { year: 2015, month: 8 }, top: 480 }] as unknown[];

    renderTimeline({
      options: { grouping: 'day' },
      grouping: 'day',
      temporalAnchor: { year: 2015, month: 8 },
      onTemporalAnchorResolved,
    });

    expect(onTemporalAnchorResolved).not.toHaveBeenCalled();
  });

  it('retries a day-mode temporal anchor until the scroll position reaches the target', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) =>
        setTimeout(() => {
          testState.viewportHeight = 600;
          testState.viewportWidth = 390;
          callback(performance.now());
        }, 0) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

    try {
      const onTemporalAnchorResolved = vi.fn();
      testState.grouping = 'day';
      testState.maxScroll = 2000;
      testState.scrollToUpdatesAfterCalls = 2;
      testState.months = [{ yearMonth: { year: 2015, month: 8 }, top: 1200, height: 240 }] as unknown[];

      renderTimeline({
        options: { grouping: 'day' },
        grouping: 'day',
        temporalAnchor: { year: 2015, month: 8 },
        onTemporalAnchorResolved,
      });

      await waitFor(() => expect(onTemporalAnchorResolved).toHaveBeenCalledOnce());
      expect(testState.scrollCalls).toEqual([1200, 1200]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not run the routing scroll-to-top fallback while a temporal anchor is pending', async () => {
    testState.grouping = 'day';
    testState.months = [];

    renderTimeline({
      enableRouting: true,
      options: { grouping: 'day' },
      grouping: 'day',
      temporalAnchor: { year: 2015, month: 8 },
    });

    await tick();

    expect(testState.scrollCalls).not.toContain(0);
  });

  it('uses the All label in the mobile grouping control on coarse-pointer web devices', async () => {
    const changes: TimelineGrouping[] = [];
    testState.grouping = 'day';
    testState.maxMd = false;
    testState.pointerCoarse = true;

    renderTimeline({
      onGroupingChange: (grouping: TimelineGrouping) => {
        changes.push(grouping);
      },
    });

    const shell = await screen.findByTestId('timeline-mobile-grouping-control-shell');
    expect(within(shell).getByRole('button', { name: 'timeline_grouping_all' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(shell).getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');

    await fireEvent.click(within(shell).getByRole('button', { name: 'timeline_grouping_years' }));

    expect(changes).toEqual(['year']);
  });

  it('renders the empty snippet when the initialized timeline has zero assets', () => {
    testState.assetCount = 0;
    testState.months = [
      {
        viewId: 'month:2015-01',
        isInOrNearViewport: false,
        isLoaded: false,
        top: 0,
        height: 100,
        title: 'January 2015',
      },
    ];

    renderTimeline({
      empty: createRawSnippet(() => ({ render: () => '<div>No assets found</div>' })),
    });

    expect(screen.getByText('No assets found')).toBeInTheDocument();
  });
});

describe('Timeline scroll-space scaling', () => {
  beforeEach(() => {
    testState.grouping = 'day';
    testState.assetCount = 1;
    testState.viewportHeight = 600;
    testState.viewportWidth = 390;
    testState.domHeight = 296;
    testState.renderOffset = 0;
    testState.months = [];
  });

  it('sizes the virtual timeline to domHeight, not totalViewerHeight', () => {
    testState.domHeight = 200; // < totalViewerHeight (296)
    const { container } = renderTimeline();
    const virtual = container.querySelector('#virtual-timeline') as HTMLElement;
    expect(virtual).toHaveStyle({ height: '200px' });
  });

  it('offsets the month skeleton transform by renderOffset', () => {
    testState.renderOffset = 50;
    testState.months = [
      {
        viewId: 'month:2015-01',
        isInOrNearViewport: false,
        isLoaded: false,
        top: 1200,
        height: 240,
        title: 'Jan 2015',
      },
    ];
    renderTimeline();
    // assert on the raw inline style so CSS normalization (e.g. `0`→`0px`) can't cause a false negative;
    // the template emits exactly `translate3d(0,${top + renderOffset}px,0)`
    const skeleton = screen.getByTestId('timeline-month-skeleton');
    expect(skeleton.getAttribute('style')).toMatch(/translate3d\(\s*0(?:px)?\s*,\s*1250px\s*,\s*0(?:px)?\s*\)/);
  });

  it('offsets the lead-out spacer transform by renderOffset', () => {
    // topSectionHeight 0 + bodySectionHeight 296 + renderOffset 50 = 346
    testState.renderOffset = 50;
    const { getByTestId } = renderTimeline();
    expect(getByTestId('timeline-leadout').getAttribute('style')).toMatch(
      /translate3d\(\s*0(?:px)?\s*,\s*346px\s*,\s*0(?:px)?\s*\)/,
    );
  });

  it('offsets the lead-in/top section transform by renderOffset so it stays flush with the first month', () => {
    // The top section renders at logical position 0, so its DOM position must be `0 + renderOffset`.
    // Without this, an above-cap library (renderOffset != 0) draws the first month over the still-visible
    // lead-in as it scrolls, because months use `top + renderOffset` and the top section did not.
    testState.renderOffset = 50;
    const { getByTestId } = renderTimeline();
    expect(getByTestId('timeline-top-section').getAttribute('style')).toMatch(
      /translate3d\(\s*0(?:px)?\s*,\s*50px\s*,\s*0(?:px)?\s*\)/,
    );
  });
});

describe('Timeline top section stacking', () => {
  beforeEach(() => {
    testState.grouping = 'day';
    testState.assetCount = 1;
    testState.viewportHeight = 600;
    testState.viewportWidth = 390;
    testState.domHeight = 296;
    testState.renderOffset = 0;
    testState.months = [];
  });

  // The top section and every month layer are transform-positioned siblings, so each one is its own
  // stacking context with `z-index: auto` — painting order then falls back to DOM order and the month
  // layers cover whatever the top section overflows downwards. Header overlays that hang below the
  // section (the person page's name-suggestion dropdown, #878) were painted under the day-title row
  // and swallowed its clicks. A `z-index` on the top section is the only lift that works: an overlay's
  // own z-index is trapped inside this section's stacking context.
  it('paints the top section above the month layers so overflowing header overlays stay clickable', () => {
    testState.months = [
      {
        viewId: 'month:2015-01',
        isInOrNearViewport: false,
        isLoaded: false,
        top: 0,
        height: 240,
        title: 'Jan 2015',
      },
    ];

    const { getByTestId } = renderTimeline();

    expect(Number(getByTestId('timeline-top-section').style.zIndex)).toBeGreaterThan(0);
  });

  it('leaves the month layers at the default stacking level', () => {
    // The lift above only holds while months stay at `z-index: auto`. If a month layer ever gains its
    // own z-index, the top section's has to be re-derived against it rather than silently losing.
    testState.months = [
      {
        viewId: 'month:2015-01',
        isInOrNearViewport: false,
        isLoaded: false,
        top: 0,
        height: 240,
        title: 'Jan 2015',
      },
    ];

    const { getByTestId } = renderTimeline();

    expect(getByTestId('timeline-month-skeleton').style.zIndex).toBe('');
  });
});
