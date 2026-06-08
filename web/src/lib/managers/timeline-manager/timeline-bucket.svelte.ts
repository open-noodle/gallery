import { AssetOrder, TimeBucketSize, type TimeBucketsResponseDto } from '@immich/sdk';
import type { TimelineBucketDate, TimelineGrouping } from './types';

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
  const [year, month] = timeBucket.split('-');
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
