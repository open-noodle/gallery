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
    expect(screen.getByRole('button', { name: /2015, 1 photo/i })).toBeInTheDocument();
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
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => {
        testState.viewportHeight = 600;
        testState.viewportWidth = 390;
        callback(performance.now());
      }, 0) as unknown as number;
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

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
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
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
      onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
    });

    const shell = await screen.findByTestId('timeline-mobile-grouping-control-shell');
    expect(within(shell).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(shell).getByTestId('timeline-grouping-day')).toHaveTextContent('All');

    await fireEvent.click(within(shell).getByRole('button', { name: 'Years' }));

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
