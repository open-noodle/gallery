import {
  AssetOrder,
  getTimeBucketCovers,
  getTimeBuckets,
  TimeBucketSize,
  type TimeBucketCoverResponseDto,
  type TimeBucketsResponseDto,
} from '@immich/sdk';
import { getTimelineAlbumQueryOptions, mergeTimeBuckets } from '$lib/gallery/timeline/album-picker-support';
import { toTimeBucketsRequest } from '$lib/gallery/timeline/request-options';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type {
  TimelineBucketDate,
  TimelineGrouping,
  TimelineManagerOptions,
} from '$lib/managers/timeline-manager/types';

export const REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT = 296;
export const REPRESENTATIVE_TIMELINE_BUCKET_GAP = 32;

type TimelineBucketManager = {
  topSectionHeight: number;
};

export function getTimeBucketSizeForGrouping(grouping: TimelineGrouping): TimeBucketSize {
  switch (grouping) {
    case 'year': {
      return TimeBucketSize.Year;
    }
    case 'month': {
      return TimeBucketSize.Month;
    }
    case 'day': {
      return TimeBucketSize.Day;
    }
  }
}

function getMonthBucket(timeBucket: string) {
  const [year, month] = timeBucket.split('-', 2);
  return `${year}-${month}-01`;
}

function getBucketDate(grouping: TimelineGrouping, timeBucket: string): TimelineBucketDate {
  const [year, month, day] = timeBucket.split('-').map(Number);

  if (grouping === 'year') {
    return { year };
  }

  if (grouping === 'month') {
    return { year, month };
  }

  return { year, month, day };
}

export function aggregateDayBucketsByMonth(
  timeBuckets: TimeBucketsResponseDto[],
  order: AssetOrder = AssetOrder.Desc,
): TimeBucketsResponseDto[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const months = new Map<string, TimeBucketsResponseDto>();

  for (const bucket of timeBuckets) {
    const timeBucket = getMonthBucket(bucket.timeBucket);
    const existing = months.get(timeBucket);
    months.set(timeBucket, {
      timeBucket,
      count: (existing?.count ?? 0) + bucket.count,
    });
  }

  return [...months.values()].sort((a, b) =>
    order === AssetOrder.Asc ? a.timeBucket.localeCompare(b.timeBucket) : b.timeBucket.localeCompare(a.timeBucket),
  );
}

export function layoutTimelineBuckets(buckets: TimelineBucket[]) {
  let top = 0;

  for (const bucket of buckets) {
    bucket.setTop(top);
    top += bucket.height + REPRESENTATIVE_TIMELINE_BUCKET_GAP;
  }
}

export class TimelineBucket {
  readonly grouping: TimelineGrouping;
  readonly timeBucket: string;
  readonly count: number;
  representativeAssetId = $state<string | null>(null);
  representativeThumbhash = $state<string | null>(null);
  representativeRatio = $state<number | null>(null);
  readonly date: TimelineBucketDate;
  readonly isLoaded = true;
  readonly height = REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT;

  #top = $state(0);
  #manager: TimelineBucketManager;

  constructor(manager: TimelineBucketManager, grouping: TimelineGrouping, timeBucket: TimeBucketsResponseDto) {
    this.#manager = manager;
    this.grouping = grouping;
    this.timeBucket = timeBucket.timeBucket;
    this.count = timeBucket.count;
    this.date = getBucketDate(grouping, timeBucket.timeBucket);
  }

  setRepresentative(cover: {
    representativeAssetId: string | null;
    representativeThumbhash: string | null;
    representativeRatio: number | null;
  }) {
    this.representativeAssetId = cover.representativeAssetId;
    this.representativeThumbhash = cover.representativeThumbhash;
    this.representativeRatio = cover.representativeRatio;
  }

  get viewId() {
    return `${this.grouping}:${this.timeBucket}`;
  }

  get top() {
    return this.#top + this.#manager.topSectionHeight;
  }

  setTop(top: number) {
    this.#top = top;
  }
}

type TimelineBucketLayoutHost = TimelineBucketManager & {
  grouping: TimelineGrouping;
  timelineBuckets: TimelineBucket[];
};

/**
 * Gallery's day/month/year grouping as one layout object. Upstream's `TimelineManager` keeps its months for the
 * day view and guards into this object (`grouping !== 'day'`) for the year/month cards: fetching and merging the
 * time buckets, laying them out, their height and count, and the lazily loaded cover of each card.
 */
export class TimelineBucketLayout {
  #host: TimelineBucketLayoutHost;
  #options: TimelineManagerOptions = {};
  #generation = 0;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #coverRequested = new Set<string>();

  constructor(host: TimelineBucketLayoutHost) {
    this.#host = host;
  }

  get height() {
    const buckets = this.#host.timelineBuckets;
    if (buckets.length === 0) {
      return 0;
    }

    return (
      buckets.reduce((height, bucket) => height + bucket.height, 0) +
      (buckets.length - 1) * REPRESENTATIVE_TIMELINE_BUCKET_GAP
    );
  }

  get count() {
    let count = 0;
    for (const bucket of this.#host.timelineBuckets) {
      count += bucket.count;
    }
    return count;
  }

  /** The time buckets of `options` at `grouping`, merged with those of its `timelineAlbumId` overlay. */
  async fetch(options: TimelineManagerOptions, grouping: TimelineGrouping, signal: AbortSignal) {
    const bucketSize = getTimeBucketSizeForGrouping(grouping);
    const albumQueryOptions = getTimelineAlbumQueryOptions(options, bucketSize);
    const [timebuckets, albumTimebuckets] = await Promise.all([
      getTimeBuckets({ ...authManager.params, ...toTimeBucketsRequest(options, bucketSize) }, { signal }),
      albumQueryOptions
        ? getTimeBuckets({ ...authManager.params, ...albumQueryOptions }, { signal })
        : Promise.resolve([]),
    ]);
    return albumTimebuckets.length > 0 ? mergeTimeBuckets(timebuckets, albumTimebuckets, options.order) : timebuckets;
  }

  /**
   * Shows `timeBuckets` as the bucket list and returns what the manager builds its months from: the day buckets
   * summed per month in day grouping, none otherwise.
   */
  apply(options: TimelineManagerOptions, grouping: TimelineGrouping, timeBuckets: TimeBucketsResponseDto[]) {
    this.#generation++;
    this.#options = options;
    this.#coverRequested.clear();
    this.#host.timelineBuckets = timeBuckets.map((timeBucket) => new TimelineBucket(this.#host, grouping, timeBucket));
    this.layout();
    return grouping === 'day' ? aggregateDayBucketsByMonth(timeBuckets, options.order) : [];
  }

  /** Drops the buckets; a cover response still in flight is discarded. */
  clear() {
    this.#generation++;
    this.#host.timelineBuckets = [];
  }

  layout() {
    layoutTimelineBuckets(this.#host.timelineBuckets);
  }

  async loadCovers(timeBuckets: string[]) {
    const grouping = this.#host.grouping;
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

    const generation = this.#generation;
    const bucketSize = getTimeBucketSizeForGrouping(grouping);
    const requestOptions = toTimeBucketsRequest(this.#options, bucketSize);
    const albumOptions = getTimelineAlbumQueryOptions(this.#options, bucketSize);
    let mainCovers: TimeBucketCoverResponseDto[];
    let albumCovers: TimeBucketCoverResponseDto[];
    try {
      // Requests are not aborted on re-init by design — the stale-generation guard below prevents stale
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
    if (generation !== this.#generation) {
      return;
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byBucket = new Map(mainCovers.map((c) => [c.timeBucket, c]));
    // Album covers take precedence over main covers when an album overlay is active
    for (const cover of albumCovers) {
      byBucket.set(cover.timeBucket, cover);
    }
    for (const bucket of this.#host.timelineBuckets) {
      const cover = byBucket.get(bucket.timeBucket);
      if (cover) {
        bucket.setRepresentative(cover);
      }
    }
  }
}
