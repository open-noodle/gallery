import {
  AssetOrder,
  AssetOrderBy,
  getAssetInfo,
  getTimeBucketCovers,
  getTimeBuckets,
  type AssetResponseDto,
  type TimeBucketCoverResponseDto,
  type TimeBucketsResponseDto,
} from '@immich/sdk';
import { clamp, isEqual } from 'lodash-es';
import { SvelteDate, SvelteSet } from 'svelte/reactivity';
import { VirtualScrollManager } from '$lib/managers/VirtualScrollManager/VirtualScrollManager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { GroupInsertionCache } from '$lib/managers/timeline-manager/group-insertion-cache.svelte';
import {
  getTimelineAlbumQueryOptions,
  mergeTimeBuckets,
} from '$lib/managers/timeline-manager/internal/album-picker-support';
import { updateTimelineMonthViewportProximity } from '$lib/managers/timeline-manager/internal/intersection-support.svelte';
import { updateGeometry } from '$lib/managers/timeline-manager/internal/layout-support.svelte';
import { loadFromTimeBuckets } from '$lib/managers/timeline-manager/internal/load-support.svelte';
import { toTimeBucketsRequest } from '$lib/managers/timeline-manager/internal/request-options';
import {
  findClosestTimelineMonthForDate,
  findTimelineMonthForAsset as findTimelineMonthForAssetUtil,
  findTimelineMonthForDate,
  getAssetWithOffset,
  getTimelineMonthByDate,
  retrieveRange as retrieveRangeUtil,
} from '$lib/managers/timeline-manager/internal/search-support.svelte';
import { WebsocketSupport } from '$lib/managers/timeline-manager/internal/websocket-support.svelte';
import { userPreferencesManager } from '$lib/managers/user-preferences-manager.svelte';
import { CancellableTask } from '$lib/utils/cancellable-task';
import {
  getOrderingDate,
  isAssetResponseDto,
  setDifference,
  toTimelineAsset,
  type TimelineDateTime,
  type TimelineYearMonth,
} from '$lib/utils/timeline-util';
import { isMismatched, updateObject } from './internal/utils.svelte';
import {
  REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  TimelineBucket,
  aggregateDayBucketsByMonth,
  getTimeBucketSizeForGrouping,
  layoutTimelineBuckets,
} from './timeline-bucket.svelte';
import { TimelineDay } from './timeline-day.svelte';
import { TimelineMonth } from './timeline-month.svelte';
import {
  DEFAULT_TIMELINE_GROUPING,
  type AssetDescriptor,
  type Direction,
  type MoveAsset,
  type ScrubberMonth,
  type TimelineAsset,
  type TimelineGrouping,
  type TimelineManagerOptions,
  type Viewport,
} from './types';

type ViewportTopMonthIntersection = {
  month: TimelineMonth | undefined;
  // Where viewport top intersects month (0 = month top, 1 = month bottom)
  viewportTopRatioInMonth: number;
  // Where month bottom is in viewport (0 = viewport top, 1 = viewport bottom)
  monthBottomViewportRatio: number;
};
export class TimelineManager extends VirtualScrollManager {
  override bottomSectionHeight = $state(60);

  override bodySectionHeight = $derived.by(() => {
    if (this.grouping !== 'day') {
      if (this.timelineBuckets.length === 0) {
        return 0;
      }

      return (
        this.timelineBuckets.reduce((height, bucket) => height + bucket.height, 0) +
        (this.timelineBuckets.length - 1) * REPRESENTATIVE_TIMELINE_BUCKET_GAP
      );
    }

    let height = 0;
    for (const month of this.months) {
      height += month.height;
    }
    return height;
  });

  assetCount = $derived.by(() => {
    if (this.grouping !== 'day') {
      let count = 0;
      for (const bucket of this.timelineBuckets) {
        count += bucket.count;
      }
      return count;
    }

    let count = 0;
    for (const month of this.months) {
      count += month.assetsCount;
    }
    return count;
  });

  isInitialized = $state(false);
  /** Increments on every (re)load. Views `{#key}` their bucket DOM on it to drop stale nodes. */
  reloadToken = $state(0);
  isScrollingOnLoad = false;
  grouping: TimelineGrouping = $state(DEFAULT_TIMELINE_GROUPING);
  timelineBuckets: TimelineBucket[] = $state([]);
  months: TimelineMonth[] = $state([]);
  albumAssets: Set<string> = new SvelteSet();
  scrubberMonths: ScrubberMonth[] = $state([]);
  scrubberTimelineHeight: number = $state(0);
  viewportTopMonthIntersection: ViewportTopMonthIntersection | undefined;
  limitedScroll = $derived(this.maxScrollPercent < 0.5);
  initTask = new CancellableTask(
    undefined,
    () => {
      this.disconnect();
      this.isInitialized = false;
    },
    () => void 0,
  );

  static #INIT_OPTIONS = {};
  #websocketSupport: WebsocketSupport | undefined;
  #options: TimelineManagerOptions = TimelineManager.#INIT_OPTIONS;
  #updatingViewportProximities = false;
  #scrollableElement: HTMLElement | undefined = $state();
  #unsubscribes: Array<() => void> = [];
  #initSequence = 0;
  #destroyed = false;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #coverRequested = new Set<string>();

  get showAssetOwners() {
    return userPreferencesManager.showAssetOwners;
  }

  setShowAssetOwners(value: boolean) {
    userPreferencesManager.showAssetOwners = value;
  }

  toggleShowAssetOwners() {
    userPreferencesManager.showAssetOwners = !userPreferencesManager.showAssetOwners;
  }

  constructor() {
    super();

    this.#unsubscribes.push(
      eventManager.on({
        AssetUpdate: (asset: AssetResponseDto) => {
          const timelineAsset = toTimelineAsset(asset);
          if (this.#options.albumId || this.#options.personId) {
            this.#updateAssets([timelineAsset]);
          } else {
            this.upsertAssets([timelineAsset]);
          }
        },
        AssetsUnarchive: (assets) => this.upsertAssets(assets),
      }),
    );
  }

  override get scrollTop(): number {
    return this.#scrollableElement?.scrollTop ?? 0;
  }

  set scrollableElement(element: HTMLElement | undefined) {
    this.#scrollableElement = element;
  }

  scrollTo(top: number) {
    this.#scrollableElement?.scrollTo({ top });
    this.updateSlidingWindow();
  }

  scrollBy(y: number) {
    this.#scrollableElement?.scrollBy(0, y);
    this.updateSlidingWindow();
  }

  async *assetsIterator(options?: {
    startTimelineMonth?: TimelineMonth;
    startTimelineDay?: TimelineDay;
    startAsset?: TimelineAsset;
    direction?: Direction;
  }) {
    const direction = options?.direction ?? 'earlier';
    let { startTimelineDay, startAsset } = options ?? {};
    for (const timelineMonth of this.timelineMonthIterator({
      direction,
      startTimelineMonth: options?.startTimelineMonth,
    })) {
      await this.loadTimelineMonth(timelineMonth.yearMonth, { cancelable: false });
      yield* timelineMonth.assetsIterator({ startTimelineDay, startAsset, direction });
      startTimelineDay = startAsset = undefined;
    }
  }

  *timelineMonthIterator(options?: { direction?: Direction; startTimelineMonth?: TimelineMonth }) {
    const isEarlier = options?.direction === 'earlier';
    let startIndex = options?.startTimelineMonth
      ? this.months.indexOf(options.startTimelineMonth)
      : isEarlier
        ? 0
        : this.months.length - 1;

    while (startIndex >= 0 && startIndex < this.months.length) {
      yield this.months[startIndex];
      startIndex += isEarlier ? 1 : -1;
    }
  }

  connect() {
    if (this.#websocketSupport) {
      throw new Error('TimelineManager already connected');
    }
    this.#websocketSupport = new WebsocketSupport(this);
    this.#websocketSupport.connectWebsocketEvents();
  }

  disconnect() {
    if (!this.#websocketSupport) {
      return;
    }
    this.#websocketSupport.disconnectWebsocketEvents();
    this.#websocketSupport = undefined;
  }

  #calculateMonthBottomViewportRatio(month: TimelineMonth | undefined) {
    if (!month) {
      return 0;
    }
    const windowHeight = this.visibleWindow.bottom - this.visibleWindow.top;
    const bottomOfMonth = month.top + month.height;
    const bottomOfMonthInViewport = bottomOfMonth - this.visibleWindow.top;
    return clamp(bottomOfMonthInViewport / windowHeight, 0, 1);
  }

  #calculateVewportTopRatioInMonth(month: TimelineMonth | undefined) {
    if (!month) {
      return 0;
    }
    return clamp((this.visibleWindow.top - month.top) / month.height, 0, 1);
  }

  override updateViewportProximities() {
    if (
      this.#updatingViewportProximities ||
      !this.isInitialized ||
      this.grouping !== 'day' ||
      this.visibleWindow.bottom === this.visibleWindow.top
    ) {
      return;
    }
    this.#updatingViewportProximities = true;

    for (const month of this.months) {
      updateTimelineMonthViewportProximity(this, month);
      if (month.isInOrNearViewport && month.isLoaded) {
        for (const day of month.timelineDays) {
          day.updateAssetBoundaries();
        }
      }
    }

    const month = this.months.find((month) => month.isInViewport);
    const viewportTopRatioInMonth = this.#calculateVewportTopRatioInMonth(month);
    const monthBottomViewportRatio = this.#calculateMonthBottomViewportRatio(month);

    this.viewportTopMonthIntersection = {
      month,
      monthBottomViewportRatio,
      viewportTopRatioInMonth,
    };

    this.#updatingViewportProximities = false;
  }

  clearDeferredLayout(month: TimelineMonth) {
    const hasDeferred = month.timelineDays.some((group) => group.deferredLayout);
    if (hasDeferred) {
      updateGeometry(this, month, { invalidateHeight: true, noDefer: true });
      for (const group of month.timelineDays) {
        group.deferredLayout = false;
      }
    }
  }

  async #initializeTimelineBuckets(signal: AbortSignal, sequence: number) {
    const grouping = this.grouping;
    const bucketSize = getTimeBucketSizeForGrouping(grouping);
    const requestOptions = toTimeBucketsRequest(this.#options, bucketSize);
    const albumQueryOptions = getTimelineAlbumQueryOptions(this.#options, bucketSize);
    const [timebuckets, albumTimebuckets] = await Promise.all([
      getTimeBuckets(
        {
          ...authManager.params,
          ...requestOptions,
        },
        { signal },
      ),
      albumQueryOptions
        ? getTimeBuckets(
            {
              ...authManager.params,
              ...albumQueryOptions,
            },
            { signal },
          )
        : Promise.resolve([]),
    ]);
    if (signal.aborted || this.#destroyed || sequence !== this.#initSequence) {
      return;
    }
    const mergedTimebuckets =
      albumTimebuckets.length > 0 ? mergeTimeBuckets(timebuckets, albumTimebuckets, this.#options.order) : timebuckets;

    this.#coverRequested.clear();
    this.timelineBuckets = mergedTimebuckets.map((timeBucket) => new TimelineBucket(this, grouping, timeBucket));
    layoutTimelineBuckets(this.timelineBuckets);
    this.months = grouping === 'day' ? this.#createTimelineMonthsFromDayBuckets(mergedTimebuckets) : [];
    this.albumAssets.clear();
    this.updateViewportGeometry(false);
  }

  #createTimelineMonthsFromDayBuckets(timeBuckets: TimeBucketsResponseDto[]) {
    return aggregateDayBucketsByMonth(timeBuckets, this.#options.order).map((timeBucket) => {
      const date = new SvelteDate(timeBucket.timeBucket);
      return new TimelineMonth(
        this,
        { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
        timeBucket.count,
        false,
        this.#options.order,
        this.#options.orderBy,
      );
    });
  }

  /**
   * True only when the timeline has finished loading results for exactly `options` (not a
   * stale prior query) AND that result set is empty. Pages use this instead of reading
   * `assetCount` directly: right after a filter changes, `assetCount` still reflects the
   * previous query for a tick (the reload is async), so a naive `assetCount === 0` check can
   * momentarily look "empty" and unmount the filter panel — stealing focus from an input the
   * user is typing in. Gating on the loaded options closing that window.
   */
  isEmptyForOptions(options: TimelineManagerOptions): boolean {
    return (
      this.isInitialized &&
      this.assetCount === 0 &&
      this.#options !== TimelineManager.#INIT_OPTIONS &&
      isEqual(this.#options, options)
    );
  }

  async updateOptions(options: TimelineManagerOptions) {
    if (this.#destroyed) {
      return;
    }
    if (options.deferInit) {
      return;
    }
    if (this.#options !== TimelineManager.#INIT_OPTIONS && isEqual(this.#options, options)) {
      return;
    }

    this.suspendTransitions = true;
    try {
      await this.initTask.reset();
      await this.#init(options);
      this.updateViewportGeometry(false);
      this.#createScrubberMonths();
    } finally {
      this.suspendTransitions = false;
    }
  }

  async #init(options: TimelineManagerOptions) {
    const sequence = ++this.#initSequence;
    // Bump on every (re)load so views can `{#key}` their bucket DOM on it. Rapid filter changes
    // can otherwise leave the keyed {#each months} with stale month nodes mounted (manager state
    // is correct, but the DOM keeps an old month — they overlap). Remounting on reload clears it.
    this.reloadToken++;
    this.isInitialized = false;
    this.disconnect();
    this.initTask.cancel();
    this.grouping = options.grouping ?? DEFAULT_TIMELINE_GROUPING;
    this.months = [];
    this.timelineBuckets = [];
    this.albumAssets.clear();
    const status = await this.initTask.execute(async (signal) => {
      this.#options = options;
      await this.#initializeTimelineBuckets(signal, sequence);
    }, true);
    if (sequence !== this.#initSequence) {
      return;
    }
    if (status !== 'LOADED' || this.#destroyed) {
      this.isInitialized = false;
      return;
    }
    this.isInitialized = true;
    if (this.#options.albumId || this.#options.personId || this.#options.spaceId) {
      return;
    }
    this.connect();
  }

  public override destroy() {
    this.#destroyed = true;
    this.#initSequence++;
    this.initTask.cancel();
    this.disconnect();
    this.isInitialized = false;
    this.months = [];
    this.timelineBuckets = [];

    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe();
    }

    super.destroy();
  }

  async updateViewport(viewport: Viewport) {
    if (viewport.height === 0 && viewport.width === 0) {
      return;
    }

    if (this.viewportHeight === viewport.height && this.viewportWidth === viewport.width) {
      return;
    }

    if (!this.initTask.executed) {
      await (this.initTask.loading ? this.initTask.waitUntilCompletion() : this.#init(this.#options));
    }

    const changedWidth = viewport.width !== this.viewportWidth;
    this.viewportHeight = viewport.height;
    this.viewportWidth = viewport.width;
    this.updateViewportGeometry(changedWidth);
  }

  protected override updateViewportGeometry(changedWidth: boolean) {
    if (!this.isInitialized || this.hasEmptyViewport) {
      return;
    }
    if (this.grouping !== 'day') {
      layoutTimelineBuckets(this.timelineBuckets);
      return;
    }
    for (const month of this.months) {
      updateGeometry(this, month, { invalidateHeight: changedWidth });
    }
    this.updateViewportProximities();
    if (changedWidth) {
      this.#createScrubberMonths();
    }
  }

  #createScrubberMonths() {
    if (this.grouping !== 'day') {
      this.scrubberMonths = [];
      this.scrubberTimelineHeight = this.totalViewerHeight;
      return;
    }

    this.scrubberMonths = this.months.map((month) => ({
      assetCount: month.assetsCount,
      year: month.yearMonth.year,
      month: month.yearMonth.month,
      title: month.title,
      height: month.height,
    }));
    this.scrubberTimelineHeight = this.totalViewerHeight;
  }

  async loadCoversForBuckets(timeBuckets: string[]) {
    const grouping = this.grouping;
    if (grouping === 'day') {
      return;
    }
    const todo = timeBuckets.filter((tb) => !this.#coverRequested.has(tb));
    if (todo.length === 0) {
      return;
    }
    for (const tb of todo) {
      this.#coverRequested.add(tb);
    }

    const sequence = this.#initSequence;
    const bucketSize = getTimeBucketSizeForGrouping(grouping);
    const requestOptions = toTimeBucketsRequest(this.#options, bucketSize);
    const albumOptions = getTimelineAlbumQueryOptions(this.#options, bucketSize);
    let mainCovers: TimeBucketCoverResponseDto[];
    let albumCovers: TimeBucketCoverResponseDto[];
    try {
      // Requests are not aborted on re-init by design — the stale-sequence guard below prevents stale
      // application, and cover fetches are light GETs bounded to the currently visible bucket set.
      [mainCovers, albumCovers] = await Promise.all([
        getTimeBucketCovers({ ...authManager.params, ...requestOptions, timeBuckets: todo }),
        albumOptions
          ? getTimeBucketCovers({ ...authManager.params, ...albumOptions, timeBuckets: todo })
          : Promise.resolve([]),
      ]);
    } catch {
      for (const tb of todo) {
        this.#coverRequested.delete(tb);
      }
      return;
    }
    if (this.#destroyed || sequence !== this.#initSequence) {
      return;
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byBucket = new Map(mainCovers.map((c) => [c.timeBucket, c]));
    // Album covers take precedence over main covers when an album overlay is active
    for (const cover of albumCovers) {
      byBucket.set(cover.timeBucket, cover);
    }
    for (const bucket of this.timelineBuckets) {
      const cover = byBucket.get(bucket.timeBucket);
      if (cover) {
        bucket.setRepresentative(cover);
      }
    }
  }

  async loadTimelineMonth(yearMonth: TimelineYearMonth, options?: { cancelable: boolean }): Promise<void> {
    if (!this.#isDetailedTimeline()) {
      return;
    }

    const cancelable = options?.cancelable ?? true;
    const timelineMonth = getTimelineMonthByDate(this, yearMonth);
    if (!timelineMonth) {
      return;
    }

    if (timelineMonth.loader?.executed) {
      return;
    }

    const executionStatus = await timelineMonth.loader?.execute(async (signal: AbortSignal) => {
      await loadFromTimeBuckets(this, timelineMonth, this.#options, signal);
    }, cancelable);
    if (executionStatus === 'LOADED') {
      updateGeometry(this, timelineMonth, { invalidateHeight: false });
      this.updateViewportProximities();
    }
  }

  upsertAssets(assets: TimelineAsset[]) {
    if (!this.#isDetailedTimeline()) {
      return;
    }

    const notUpdated = this.#updateAssets(assets);
    const notExcluded = notUpdated.filter((asset) => !this.isExcluded(asset));
    this.addAssetsUpsertSegments([...notExcluded]);
  }

  upsertAssetsFromLiveEvent(assets: TimelineAsset[]) {
    const notUpdated = this.#updateAssets(assets);
    const insertable = notUpdated.filter((asset) => this.canInsertAssetFromLiveEvent(asset));
    this.addAssetsUpsertSegments(insertable);
  }

  async findTimelineMonthForAsset(asset: AssetDescriptor | AssetResponseDto) {
    if (!this.isInitialized) {
      await this.initTask.waitUntilExecution();
    }

    const { id } = asset;
    let { timelineMonth } = findTimelineMonthForAssetUtil(this, id) ?? {};
    if (timelineMonth) {
      return timelineMonth;
    }

    const response = isAssetResponseDto(asset)
      ? asset
      : await getAssetInfo({ ...authManager.params, id }).catch(() => null);
    if (!response) {
      return;
    }

    const timelineAsset = toTimelineAsset(response);
    if (this.isExcluded(timelineAsset)) {
      return;
    }

    timelineMonth = await this.#loadTimelineMonthAtTime(
      getOrderingDate(timelineAsset, this.#options.orderBy || AssetOrderBy.TakenAt),
      { cancelable: false },
    );
    if (timelineMonth?.findAssetById({ id })) {
      return timelineMonth;
    }
  }

  async #loadTimelineMonthAtTime(yearMonth: TimelineYearMonth, options?: { cancelable: boolean }) {
    await this.loadTimelineMonth(yearMonth, options);
    return getTimelineMonthByDate(this, yearMonth);
  }

  getTimelineMonthByAssetId(assetId: string) {
    const timelineMonthInfo = findTimelineMonthForAssetUtil(this, assetId);
    return timelineMonthInfo?.timelineMonth;
  }

  // note: the `index` input is expected to be in the range [0, assetCount). This
  // value can be passed to make the method deterministic, which is mainly useful
  // for testing.
  async getRandomAsset(index?: number): Promise<TimelineAsset | undefined> {
    const randomAssetIndex = index ?? Math.floor(Math.random() * this.assetCount);

    let accumulatedCount = 0;

    let randomMonth: TimelineMonth | undefined = undefined;
    for (const month of this.months) {
      if (randomAssetIndex < accumulatedCount + month.assetsCount) {
        randomMonth = month;
        break;
      }

      accumulatedCount += month.assetsCount;
    }
    if (!randomMonth) {
      return;
    }
    await this.loadTimelineMonth(randomMonth.yearMonth, { cancelable: false });

    let randomDay: TimelineDay | undefined = undefined;
    for (const day of randomMonth.timelineDays) {
      if (randomAssetIndex < accumulatedCount + day.viewerAssets.length) {
        randomDay = day;
        break;
      }

      accumulatedCount += day.viewerAssets.length;
    }
    if (!randomDay) {
      return;
    }

    return randomDay.viewerAssets[randomAssetIndex - accumulatedCount].asset;
  }

  /**
   * Executes callback on assets, handling moves between groups and removals due to filter criteria.
   */
  update(ids: string[], callback: (asset: TimelineAsset) => void) {
    if (!this.#isDetailedTimeline()) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      return { updated: new Set<string>(), notUpdated: new Set(ids), changedGeometry: false };
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    return this.#runAssetCallback(new Set(ids), callback);
  }

  removeAssets(ids: string[]) {
    if (!this.#isDetailedTimeline()) {
      return ids;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const result = this.#runAssetCallback(new Set(ids), () => ({ remove: true }));
    return [...result.notUpdated];
  }

  protected upsertSegmentForAsset(asset: TimelineAsset) {
    const dateTime = getOrderingDate(asset, this.#options.orderBy || AssetOrderBy.TakenAt);
    let month = getTimelineMonthByDate(this, dateTime);

    if (!month) {
      month = new TimelineMonth(this, dateTime, 1, true, this.#options.order, this.#options.orderBy);
      this.months.push(month);
    }
    return month;
  }

  /**
   * Adds assets to existing segments, creating new segments as needed.
   *
   * This is an internal method that assumes the provided assets are not already
   * present in the timeline. For updating existing assets, use updateAssetOperation().
   */
  protected addAssetsUpsertSegments(assets: TimelineAsset[]) {
    if (!this.#isDetailedTimeline()) {
      return;
    }

    if (assets.length === 0) {
      return;
    }
    const context = new GroupInsertionCache();
    const monthCount = this.months.length;
    for (const asset of assets) {
      this.upsertSegmentForAsset(asset).addTimelineAsset(asset, context);
    }
    if (this.months.length !== monthCount) {
      this.postCreateSegments();
    }
    this.postUpsert(context);
  }

  #updateAssets(assets: TimelineAsset[]) {
    if (!this.#isDetailedTimeline()) {
      return assets;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const cache = new Map<string, TimelineAsset>(assets.map((asset) => [asset.id, asset]));
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const idsToUpdate = new Set(cache.keys());
    const result = this.#runAssetCallback(idsToUpdate, (asset) => void updateObject(asset, cache.get(asset.id)));
    const notUpdated: TimelineAsset[] = Array.from(result.notUpdated, (assetId) => cache.get(assetId)!);
    return notUpdated;
  }

  #runAssetCallback(ids: Set<string>, callback: (asset: TimelineAsset) => void | { remove?: boolean }) {
    if (ids.size === 0) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      return { updated: new Set<string>(), notUpdated: ids, changedGeometry: false };
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const changedTimelineMonths = new Set<TimelineMonth>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    let notUpdated = new Set(ids);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const updated = new Set<string>();
    const assetsToMoveSegments: MoveAsset[][] = [];
    for (const month of this.months) {
      if (notUpdated.size === 0) {
        break;
      }
      const result = month.runAssetCallback(notUpdated, callback);
      if (result.moveAssets.length > 0) {
        assetsToMoveSegments.push(result.moveAssets);
      }
      if (result.changedGeometry) {
        changedTimelineMonths.add(month);
      }
      notUpdated = setDifference(notUpdated, result.processedIds);
      for (const id of result.processedIds) {
        updated.add(id);
      }
    }
    const assetsToAdd = [];
    for (const segment of assetsToMoveSegments) {
      for (const moveAsset of segment) {
        assetsToAdd.push(moveAsset.asset);
      }
    }
    this.addAssetsUpsertSegments(assetsToAdd);
    const changedGeometry = changedTimelineMonths.size > 0;
    for (const month of changedTimelineMonths) {
      updateGeometry(this, month, { invalidateHeight: true });
    }
    if (changedGeometry) {
      this.updateViewportProximities();
    }
    return { updated, notUpdated, changedGeometry };
  }

  override refreshLayout() {
    if (!this.#isDetailedTimeline()) {
      layoutTimelineBuckets(this.timelineBuckets);
      this.updateViewportProximities();
      return;
    }

    for (const month of this.months) {
      updateGeometry(this, month, { invalidateHeight: true });
    }
    this.updateViewportProximities();
  }

  getFirstAsset(): TimelineAsset | undefined {
    return this.months[0]?.getFirstAsset();
  }

  async getLaterAsset(
    assetDescriptor: AssetDescriptor | AssetResponseDto,
    interval: 'asset' | 'day' | 'month' | 'year' = 'asset',
  ): Promise<TimelineAsset | undefined> {
    return await getAssetWithOffset(this, assetDescriptor, interval, 'later');
  }

  async getEarlierAsset(
    assetDescriptor: AssetDescriptor | AssetResponseDto,
    interval: 'asset' | 'day' | 'month' | 'year' = 'asset',
  ): Promise<TimelineAsset | undefined> {
    return await getAssetWithOffset(this, assetDescriptor, interval, 'earlier');
  }

  async getClosestAssetToDate(dateTime: TimelineDateTime) {
    let timelineMonth = findTimelineMonthForDate(this, dateTime);
    if (!timelineMonth) {
      // if exact match not found, find closest
      timelineMonth = findClosestTimelineMonthForDate(this.months, dateTime);
      if (!timelineMonth) {
        return;
      }
    }
    await this.loadTimelineMonth(dateTime, { cancelable: false });
    const asset = timelineMonth.findClosest(dateTime);
    if (asset) {
      return asset;
    }
    for await (const asset of this.assetsIterator({ startTimelineMonth: timelineMonth })) {
      return asset;
    }
  }

  async retrieveRange(start: AssetDescriptor, end: AssetDescriptor) {
    return retrieveRangeUtil(this, start, end);
  }

  isExcluded(asset: TimelineAsset) {
    return (
      isMismatched(this.#options.visibility, asset.visibility) ||
      isMismatched(this.#options.isFavorite, asset.isFavorite) ||
      isMismatched(this.#options.isTrashed, asset.isTrashed) ||
      (this.#options.tagId && asset.tags && !asset.tags.includes(this.#options.tagId)) ||
      (this.#options.assetFilter !== undefined && !this.#options.assetFilter.has(asset.id))
    );
  }

  canInsertAssetFromLiveEvent(asset: TimelineAsset) {
    if (this.isExcluded(asset)) {
      return false;
    }
    if (this.#options.albumId || this.#options.personId || this.#options.timelineAlbumId) {
      return false;
    }
    if (this.#options.userId && !this.#options.withPartners && asset.ownerId !== this.#options.userId) {
      return false;
    }
    return true;
  }

  getAssetOrder() {
    return this.#options.order ?? AssetOrder.Desc;
  }

  getOrderBy() {
    return this.#options.orderBy ?? AssetOrderBy.TakenAt;
  }

  #isDetailedTimeline() {
    return this.grouping === 'day';
  }

  protected postCreateSegments(): void {
    this.months.sort((a, b) => {
      return a.yearMonth.year === b.yearMonth.year
        ? b.yearMonth.month - a.yearMonth.month
        : b.yearMonth.year - a.yearMonth.year;
    });
  }

  protected postUpsert(context: GroupInsertionCache): void {
    for (const group of context.existingTimelineDays) {
      group.sortAssets(this.#options.order);
    }

    for (const timelineMonth of context.bucketsWithNewTimelineDays) {
      timelineMonth.sortTimelineDays();
    }

    for (const month of context.updatedBuckets) {
      month.sortTimelineDays();
      updateGeometry(this, month, { invalidateHeight: true });
    }
    this.updateViewportProximities();
  }
}
