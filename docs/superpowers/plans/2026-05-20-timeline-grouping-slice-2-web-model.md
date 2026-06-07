# Timeline Grouping Slice 2 Web Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the web `TimelineManager` model for `year`, `month`, and `day` grouping, backed by the slice 1 bucket API, while preserving the current detailed day timeline behavior.

**Architecture:** Introduce a generic timeline bucket model beside the existing `TimelineMonth`/`TimelineDay` internals. `TimelineManager` requests bucket metadata at the selected grouping, exposes representative buckets for `year` and `month`, aggregates day metadata into current month containers for detailed mode, and ignores stale async results after grouping/filter changes.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, generated `@immich/sdk` timeline APIs, existing `TimelineManager`, existing virtual-scroll and timeline-month layout primitives.

---

## Scope

This slice implements only the web timeline model layer:

- Add `TimelineGrouping = 'year' | 'month' | 'day'`.
- Add a generic `TimelineBucket` model with granularity, date key, count, stable height/top, representative metadata, and loaded-state semantics.
- Make `TimelineManagerOptions` accept `grouping` while continuing to carry existing person, tag, album, space, favorite, trash, visibility, partner, shared-space, rating, location, type, and temporal filters.
- Request `/timeline/buckets` with the correct `TimeBucketSize` for the selected grouping.
- Preserve current day-mode detailed thumbnail behavior by aggregating day bucket metadata into month containers and loading detailed assets by month.
- Ensure year/month representative modes do not call `/timeline/bucket` to load every asset.
- Preserve representative metadata when album-picker bucket responses are merged.
- Cancel or ignore stale grouping/filter responses so older results cannot overwrite newer manager state.
- Cover edge cases in automated tests.

This slice deliberately does not implement the visual grouping control, representative card component, card-click temporal FilterPanel sync, active chips, route adoption, `GalleryViewer` parity, or mobile placement. Those are later slices in the spec.

## File Map

- Create: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
  - Grouping-specific Vitest coverage for pure helpers, album bucket merge behavior, manager grouping requests, stale responses, and day-mode regressions.
- Create: `web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts`
  - Generic bucket model, grouping-to-SDK mapping, fixed representative bucket layout, and day-bucket aggregation helpers.
- Create: `web/src/lib/managers/timeline-manager/internal/request-options.ts`
  - Shared conversion from `TimelineManagerOptions` to SDK request params with manager-only fields stripped and `bucketSize` set explicitly.
- Modify: `web/src/lib/managers/timeline-manager/types.ts`
  - Add `TimelineGrouping`, bucket descriptor types, `AssetApiGetTimeBucketRequest`, and omit raw `bucketSize` from manager options.
- Modify: `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`
  - Strip `grouping` from album query options and preserve representative metadata when merging primary/album buckets.
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`
  - Track active grouping, expose generic buckets, initialize from grouping-aware metadata requests, aggregate day buckets into `TimelineMonth`, and guard against stale async updates.
- Modify: `web/src/lib/managers/timeline-manager/internal/load-support.svelte.ts`
  - Explicitly request `TimeBucketSize.Month` for detailed day-mode asset bucket loads.

## TDD Rules For This Plan

Every task below starts with a failing test. Do not edit production code for a behavior until its red test has been run and observed failing for the expected reason.

Use these focused commands while executing tasks:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
pnpm --filter immich-web run check:typescript
```

Run the full web verification before considering the slice complete:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
pnpm --filter immich-web run check:typescript
```

## Implementation Tasks

### Task 1: Preserve Representative Metadata When Merging Album Buckets

**Files:**

- Create: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
- Modify: `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`

- [ ] **Step 1: Write the failing merge tests**

Create `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts` with this initial content:

```ts
import { AssetOrder, TimeBucketSize, type TimeBucketsResponseDto } from '@immich/sdk';

import { mergeTimeBuckets } from './internal/album-picker-support';

describe('timeline grouping bucket helpers', () => {
  describe('mergeTimeBuckets', () => {
    it('preserves the primary representative metadata when merging duplicate buckets', () => {
      const merged = mergeTimeBuckets(
        [
          {
            timeBucket: '2024-01-01',
            count: 2,
            representativeAssetId: 'primary-asset',
            representativeThumbhash: 'primary-thumbhash',
            representativeRatio: 1.5,
          },
        ],
        [
          {
            timeBucket: '2024-01-01',
            count: 3,
            representativeAssetId: 'album-asset',
            representativeThumbhash: 'album-thumbhash',
            representativeRatio: 0.8,
          },
        ],
        AssetOrder.Desc,
      );

      expect(merged).toEqual([
        {
          timeBucket: '2024-01-01',
          count: 5,
          representativeAssetId: 'primary-asset',
          representativeThumbhash: 'primary-thumbhash',
          representativeRatio: 1.5,
        },
      ]);
    });

    it('uses the album representative metadata when the primary bucket has no representative', () => {
      const merged = mergeTimeBuckets(
        [{ timeBucket: '2024-01-01', count: 2 }],
        [
          {
            timeBucket: '2024-01-01',
            count: 3,
            representativeAssetId: 'album-asset',
            representativeThumbhash: 'album-thumbhash',
            representativeRatio: 0.8,
          },
        ],
        AssetOrder.Desc,
      );

      expect(merged).toEqual([
        {
          timeBucket: '2024-01-01',
          count: 5,
          representativeAssetId: 'album-asset',
          representativeThumbhash: 'album-thumbhash',
          representativeRatio: 0.8,
        },
      ]);
    });

    it('preserves representative metadata for buckets that only exist in the album query', () => {
      const merged = mergeTimeBuckets(
        [],
        [
          {
            timeBucket: '2023-01-01',
            count: 1,
            representativeAssetId: 'album-only-asset',
            representativeThumbhash: null,
            representativeRatio: null,
          },
        ],
        AssetOrder.Desc,
      );

      expect(merged).toEqual([
        {
          timeBucket: '2023-01-01',
          count: 1,
          representativeAssetId: 'album-only-asset',
          representativeThumbhash: null,
          representativeRatio: null,
        },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run the red test**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: at least the duplicate-bucket and album-only representative assertions fail because `mergeTimeBuckets()` currently replaces merged bucket objects with `{ timeBucket, count }`.

- [ ] **Step 3: Implement the minimal merge fix**

In `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`, add this helper above `mergeTimeBuckets`:

```ts
function getRepresentativeMetadata(
  preferred: TimeBucketsResponseDto | undefined,
  fallback: TimeBucketsResponseDto,
): Pick<TimeBucketsResponseDto, 'representativeAssetId' | 'representativeThumbhash' | 'representativeRatio'> {
  const source = preferred?.representativeAssetId ? preferred : fallback;

  return {
    representativeAssetId: source.representativeAssetId,
    representativeThumbhash: source.representativeThumbhash,
    representativeRatio: source.representativeRatio,
  };
}
```

Replace the duplicate bucket `merged.set()` call inside the secondary loop with:

```ts
const representativeMetadata = getRepresentativeMetadata(existing, bucket);
merged.set(bucket.timeBucket, {
  timeBucket: bucket.timeBucket,
  count: (existing?.count ?? 0) + bucket.count,
  ...representativeMetadata,
});
```

The primary loop remains:

```ts
for (const bucket of primary) {
  merged.set(bucket.timeBucket, { ...bucket });
}
```

- [ ] **Step 4: Run the green test**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: the three `mergeTimeBuckets` tests pass.

- [ ] **Step 5: Commit this focused change**

```bash
git add web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts web/src/lib/managers/timeline-manager/internal/album-picker-support.ts
git commit -m "test(web): cover timeline bucket representative merge"
```

### Task 2: Add Generic Timeline Bucket Helpers

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
- Create: `web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts`
- Create: `web/src/lib/managers/timeline-manager/internal/request-options.ts`
- Modify: `web/src/lib/managers/timeline-manager/types.ts`
- Modify: `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`

- [ ] **Step 1: Add failing helper tests**

Append these imports to `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`:

```ts
import {
  REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT,
  TimelineBucket,
  aggregateDayBucketsByMonth,
  getTimeBucketSizeForGrouping,
  layoutTimelineBuckets,
} from './timeline-bucket.svelte';
import { toTimeBucketRequest, toTimeBucketsRequest } from './internal/request-options';
```

Append these tests inside the existing top-level `describe('timeline grouping bucket helpers', () => { ... })` block:

```ts
describe('grouping helpers', () => {
  it.each([
    ['year', TimeBucketSize.Year],
    ['month', TimeBucketSize.Month],
    ['day', TimeBucketSize.Day],
  ] as const)('maps grouping %s to SDK bucket size %s', (grouping, bucketSize) => {
    expect(getTimeBucketSizeForGrouping(grouping)).toBe(bucketSize);
  });

  it('strips manager-only fields from bucket metadata requests', () => {
    const assetFilter = new Set(['asset-1']);

    expect(
      toTimeBucketsRequest(
        {
          grouping: 'year',
          timelineAlbumId: 'album-1',
          timelineSpaceId: 'space-1',
          deferInit: false,
          assetFilter,
          personIds: ['person-1'],
          tagIds: ['tag-1'],
          takenAfter: '2024-01-01T00:00:00.000Z',
          takenBefore: '2025-01-01T00:00:00.000Z',
        },
        TimeBucketSize.Year,
      ),
    ).toEqual({
      bucketSize: TimeBucketSize.Year,
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2025-01-01T00:00:00.000Z',
    });
  });

  it('strips manager-only fields from single bucket asset requests', () => {
    expect(
      toTimeBucketRequest(
        {
          grouping: 'day',
          timelineAlbumId: 'album-1',
          timelineSpaceId: 'space-1',
          personId: 'person-1',
        },
        '2024-01-01T00:00:00.000Z',
        TimeBucketSize.Month,
      ),
    ).toEqual({
      bucketSize: TimeBucketSize.Month,
      personId: 'person-1',
      timeBucket: '2024-01-01T00:00:00.000Z',
    });
  });

  it('builds a year representative bucket with stable metadata and fallback values', () => {
    const manager = { topSectionHeight: 12 };
    const bucket = new TimelineBucket(manager, 'year', {
      timeBucket: '2015-01-01',
      count: 438,
      representativeAssetId: 'asset-2015',
      representativeThumbhash: null,
      representativeRatio: null,
    });

    expect({
      grouping: bucket.grouping,
      timeBucket: bucket.timeBucket,
      count: bucket.count,
      representativeAssetId: bucket.representativeAssetId,
      representativeThumbhash: bucket.representativeThumbhash,
      representativeRatio: bucket.representativeRatio,
      year: bucket.date.year,
      month: bucket.date.month,
      day: bucket.date.day,
      height: bucket.height,
      top: bucket.top,
      isLoaded: bucket.isLoaded,
    }).toEqual({
      grouping: 'year',
      timeBucket: '2015-01-01',
      count: 438,
      representativeAssetId: 'asset-2015',
      representativeThumbhash: null,
      representativeRatio: null,
      year: 2015,
      month: undefined,
      day: undefined,
      height: REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT,
      top: 12,
      isLoaded: true,
    });
  });

  it('builds a month representative bucket without UTC/local date drift', () => {
    const manager = { topSectionHeight: 0 };
    const bucket = new TimelineBucket(manager, 'month', {
      timeBucket: '2011-08-01',
      count: 12,
      representativeAssetId: 'asset-august',
      representativeThumbhash: 'thumbhash',
      representativeRatio: 1.25,
    });

    expect(bucket.date).toEqual({ year: 2011, month: 8 });
    expect(bucket.viewId).toBe('month:2011-08-01');
  });

  it('aggregates day buckets into month counts across year and leap-day boundaries', () => {
    const months = aggregateDayBucketsByMonth([
      { timeBucket: '2024-02-29', count: 2 },
      { timeBucket: '2024-02-01', count: 3 },
      { timeBucket: '2024-01-01', count: 5 },
      { timeBucket: '2023-12-31', count: 7 },
    ]);

    expect(months.map(({ timeBucket, count }) => ({ timeBucket, count }))).toEqual([
      { timeBucket: '2024-02-01', count: 5 },
      { timeBucket: '2024-01-01', count: 5 },
      { timeBucket: '2023-12-01', count: 7 },
    ]);
  });

  it('preserves ascending order when aggregating day buckets into months', () => {
    const months = aggregateDayBucketsByMonth(
      [
        { timeBucket: '2023-12-31', count: 7 },
        { timeBucket: '2024-01-01', count: 5 },
        { timeBucket: '2024-02-01', count: 3 },
        { timeBucket: '2024-02-29', count: 2 },
      ],
      AssetOrder.Asc,
    );

    expect(months.map(({ timeBucket, count }) => ({ timeBucket, count }))).toEqual([
      { timeBucket: '2023-12-01', count: 7 },
      { timeBucket: '2024-01-01', count: 5 },
      { timeBucket: '2024-02-01', count: 5 },
    ]);
  });

  it('lays out thousands of representative buckets with stable cumulative top positions', () => {
    const manager = { topSectionHeight: 20 };
    const buckets = Array.from({ length: 1500 }, (_, index) => {
      const year = 3024 - index;
      return new TimelineBucket(manager, 'year', {
        timeBucket: `${year}-01-01`,
        count: 1,
        representativeAssetId: `asset-${year}`,
        representativeThumbhash: null,
        representativeRatio: null,
      });
    });

    layoutTimelineBuckets(buckets);

    expect(buckets[0].top).toBe(20);
    expect(buckets[1].top).toBe(20 + REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP);
    expect(buckets.at(-1)?.top).toBe(
      20 + 1499 * (REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP),
    );
  });
});
```

- [ ] **Step 2: Run the red helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: the run fails because `timeline-bucket.svelte.ts`, `internal/request-options.ts`, and the exported grouping types do not exist.

- [ ] **Step 3: Add the grouping types**

In `web/src/lib/managers/timeline-manager/types.ts`, change the SDK imports and manager option types to:

```ts
import type { TimelineDate, TimelineDateTime, TimelineYearMonth } from '$lib/utils/timeline-util';
import type { AssetStackResponseDto, AssetVisibility } from '@immich/sdk';

export type TimelineGrouping = 'year' | 'month' | 'day';
export const DEFAULT_TIMELINE_GROUPING: TimelineGrouping = 'day';

export type AssetApiGetTimeBucketsRequest = Parameters<typeof import('@immich/sdk').getTimeBuckets>[0];
export type AssetApiGetTimeBucketRequest = Parameters<typeof import('@immich/sdk').getTimeBucket>[0];

export type TimelineManagerOptions = Omit<AssetApiGetTimeBucketsRequest, 'bucketSize' | 'size'> & {
  grouping?: TimelineGrouping;
  timelineAlbumId?: string;
  timelineSpaceId?: string;
  deferInit?: boolean;
  assetFilter?: Set<string>;
};

export type TimelineBucketDate = {
  year: number;
  month?: number;
  day?: number;
};
```

Leave the rest of `types.ts` unchanged.

- [ ] **Step 4: Add request option conversion helpers**

Create `web/src/lib/managers/timeline-manager/internal/request-options.ts`:

```ts
import type { TimeBucketSize } from '@immich/sdk';

import type { AssetApiGetTimeBucketRequest, AssetApiGetTimeBucketsRequest, TimelineManagerOptions } from '../types';

const MANAGER_ONLY_OPTION_KEYS = new Set<keyof TimelineManagerOptions>([
  'grouping',
  'timelineAlbumId',
  'timelineSpaceId',
  'deferInit',
  'assetFilter',
]);

function stripManagerOnlyOptions(options: TimelineManagerOptions): Omit<AssetApiGetTimeBucketsRequest, 'bucketSize'> {
  return Object.fromEntries(
    Object.entries(options).filter(([key, value]) => {
      return value !== undefined && !MANAGER_ONLY_OPTION_KEYS.has(key as keyof TimelineManagerOptions);
    }),
  ) as Omit<AssetApiGetTimeBucketsRequest, 'bucketSize'>;
}

export function toTimeBucketsRequest(
  options: TimelineManagerOptions,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketsRequest {
  return {
    ...stripManagerOnlyOptions(options),
    bucketSize,
  };
}

export function toTimeBucketRequest(
  options: TimelineManagerOptions,
  timeBucket: string,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketRequest {
  return {
    ...stripManagerOnlyOptions(options),
    bucketSize,
    timeBucket,
  };
}
```

- [ ] **Step 5: Add the generic bucket model**

Create `web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts`:

```ts
import { AssetOrder, TimeBucketSize, type TimeBucketsResponseDto } from '@immich/sdk';

import type { TimelineBucketDate, TimelineGrouping } from './types';

export const REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT = 296;
export const REPRESENTATIVE_TIMELINE_BUCKET_GAP = 32;

type BucketLayoutManager = {
  topSectionHeight: number;
};

export function getTimeBucketSizeForGrouping(grouping: TimelineGrouping): TimeBucketSize {
  return {
    year: TimeBucketSize.Year,
    month: TimeBucketSize.Month,
    day: TimeBucketSize.Day,
  }[grouping];
}

export function aggregateDayBucketsByMonth(
  timeBuckets: TimeBucketsResponseDto[],
  order: AssetOrder = AssetOrder.Desc,
): TimeBucketsResponseDto[] {
  const bucketsByMonth = new Map<string, TimeBucketsResponseDto>();

  for (const bucket of timeBuckets) {
    const date = parseBucketDate('day', bucket.timeBucket);
    const monthBucket = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-01`;
    const existing = bucketsByMonth.get(monthBucket);

    bucketsByMonth.set(monthBucket, {
      timeBucket: monthBucket,
      count: (existing?.count ?? 0) + bucket.count,
      representativeAssetId: existing?.representativeAssetId ?? bucket.representativeAssetId,
      representativeThumbhash: existing?.representativeThumbhash ?? bucket.representativeThumbhash,
      representativeRatio: existing?.representativeRatio ?? bucket.representativeRatio,
    });
  }

  return [...bucketsByMonth.values()].sort((a, b) =>
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
  readonly representativeAssetId: string | null;
  readonly representativeThumbhash: string | null;
  readonly representativeRatio: number | null;
  readonly date: TimelineBucketDate;
  readonly isLoaded = true;
  readonly height = REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT;

  #top = $state(0);
  #manager: BucketLayoutManager;

  constructor(manager: BucketLayoutManager, grouping: TimelineGrouping, bucket: TimeBucketsResponseDto) {
    this.#manager = manager;
    this.grouping = grouping;
    this.timeBucket = bucket.timeBucket;
    this.count = bucket.count;
    this.representativeAssetId = bucket.representativeAssetId ?? null;
    this.representativeThumbhash = bucket.representativeThumbhash ?? null;
    this.representativeRatio = bucket.representativeRatio ?? null;
    this.date = parseBucketDate(grouping, bucket.timeBucket);
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

function parseBucketDate(grouping: TimelineGrouping, timeBucket: string): TimelineBucketDate {
  const match = /^(\d{4,6})-(\d{2})-(\d{2})/.exec(timeBucket);
  if (!match) {
    throw new Error(`Invalid timeline bucket date: ${timeBucket}`);
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (grouping === 'year') {
    return { year };
  }

  if (grouping === 'month') {
    return { year, month };
  }

  return { year, month, day };
}
```

- [ ] **Step 6: Strip grouping from album query options**

In `web/src/lib/managers/timeline-manager/internal/album-picker-support.ts`, import `TimeBucketSize` and `toTimeBucketsRequest`:

```ts
import {
  AssetOrder,
  type TimeBucketSize,
  type TimeBucketAssetResponseDto,
  type TimeBucketsResponseDto,
} from '@immich/sdk';

import { toTimeBucketsRequest } from './request-options';
```

Replace `getTimelineAlbumQueryOptions()` with:

```ts
export function getTimelineAlbumQueryOptions(
  options: TimelineManagerOptions,
  bucketSize: TimeBucketSize,
): AssetApiGetTimeBucketsRequest | undefined {
  if (!options.timelineAlbumId) {
    return;
  }

  const requestOptions = toTimeBucketsRequest(options, bucketSize);
  const { userId: _userId, withPartners: _withPartners, withSharedSpaces: _withSharedSpaces, ...rest } = requestOptions;

  return { ...rest, albumId: options.timelineAlbumId };
}
```

- [ ] **Step 7: Run the green helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: all helper and merge tests pass.

- [ ] **Step 8: Run typecheck for the helper surface**

Run:

```bash
pnpm --filter immich-web run check:typescript
```

Expected: TypeScript fails only if callers of `getTimelineAlbumQueryOptions()` still need the new `bucketSize` argument. Fix those callers in later tasks when `TimelineManager` and `load-support` are updated.

### Task 3: Initialize TimelineManager From Grouping-Aware Bucket Metadata

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`

- [ ] **Step 1: Add failing manager initialization tests**

Append these imports to `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`:

```ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { tick } from 'svelte';

import { TimelineManager } from './timeline-manager.svelte';
```

Append this top-level `describe` block after the helper tests:

```ts
describe('TimelineManager grouping metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('defaults to day grouping, requests day buckets, and aggregates them into detailed month containers', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([
      { timeBucket: '2024-02-29', count: 2 },
      { timeBucket: '2024-02-01', count: 3 },
      { timeBucket: '2024-01-01', count: 5 },
      { timeBucket: '2023-12-31', count: 7 },
    ]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateViewport({ width: 1588, height: 0 });

    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ bucketSize: TimeBucketSize.Day }),
      expect.anything(),
    );
    expect(timelineManager.grouping).toBe('day');
    expect(timelineManager.timelineBuckets.map((bucket) => [bucket.grouping, bucket.timeBucket, bucket.count])).toEqual(
      [
        ['day', '2024-02-29', 2],
        ['day', '2024-02-01', 3],
        ['day', '2024-01-01', 5],
        ['day', '2023-12-31', 7],
      ],
    );
    expect(
      timelineManager.months.map((month) => ({
        year: month.yearMonth.year,
        month: month.yearMonth.month,
        count: month.assetsCount,
      })),
    ).toEqual([
      { year: 2024, month: 2, count: 5 },
      { year: 2024, month: 1, count: 5 },
      { year: 2023, month: 12, count: 7 },
    ]);
  });

  it('requests year buckets and exposes representative buckets without loading bucket assets', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([
      {
        timeBucket: '2015-01-01',
        count: 438,
        representativeAssetId: 'asset-2015',
        representativeThumbhash: 'thumbhash-2015',
        representativeRatio: 1.25,
      },
      {
        timeBucket: '2007-01-01',
        count: 12,
        representativeAssetId: 'asset-2007',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });
    await timelineManager.updateViewport({ width: 1200, height: 900 });

    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ bucketSize: TimeBucketSize.Year }),
      expect.anything(),
    );
    expect(sdkMock.getTimeBucket).not.toHaveBeenCalled();
    expect(timelineManager.grouping).toBe('year');
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.assetCount).toBe(450);
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual([
      'year:2015-01-01',
      'year:2007-01-01',
    ]);
    expect(timelineManager.timelineBuckets[0]).toMatchObject({
      grouping: 'year',
      count: 438,
      representativeAssetId: 'asset-2015',
      representativeThumbhash: 'thumbhash-2015',
      representativeRatio: 1.25,
      date: { year: 2015 },
    });
  });

  it('requests month buckets and exposes representative month buckets', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([
      {
        timeBucket: '2011-08-01',
        count: 21,
        representativeAssetId: 'asset-aug-2011',
        representativeThumbhash: 'thumbhash-aug',
        representativeRatio: 1.4,
      },
      {
        timeBucket: '2010-01-01',
        count: 23,
        representativeAssetId: 'asset-jan-2010',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'month' });

    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ bucketSize: TimeBucketSize.Month }),
      expect.anything(),
    );
    expect(sdkMock.getTimeBucket).not.toHaveBeenCalled();
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.date)).toEqual([
      { year: 2011, month: 8 },
      { year: 2010, month: 1 },
    ]);
  });

  it('forwards non-time and temporal filters to grouping bucket requests', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({
      grouping: 'year',
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      isFavorite: true,
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2025-01-01T00:00:00.000Z',
    });

    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketSize: TimeBucketSize.Year,
        personIds: ['person-1'],
        tagIds: ['tag-1'],
        isFavorite: true,
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
      expect.anything(),
    );
  });

  it('reloads bucket metadata when non-time filters change', async () => {
    sdkMock.getTimeBuckets
      .mockResolvedValueOnce([
        {
          timeBucket: '2024-01-01',
          count: 8,
          representativeAssetId: 'person-1-asset',
          representativeThumbhash: null,
          representativeRatio: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          timeBucket: '2023-01-01',
          count: 3,
          representativeAssetId: 'person-2-asset',
          representativeThumbhash: null,
          representativeRatio: null,
        },
      ]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year', personIds: ['person-1'] });
    await timelineManager.updateOptions({ grouping: 'year', personIds: ['person-2'] });

    expect(sdkMock.getTimeBuckets).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bucketSize: TimeBucketSize.Year, personIds: ['person-1'] }),
      expect.anything(),
    );
    expect(sdkMock.getTimeBuckets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bucketSize: TimeBucketSize.Year, personIds: ['person-2'] }),
      expect.anything(),
    );
    expect(timelineManager.timelineBuckets.map((bucket) => [bucket.timeBucket, bucket.count])).toEqual([
      ['2023-01-01', 3],
    ]);
  });

  it('clears temporal bounds without losing non-time filters', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({
      grouping: 'month',
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2025-01-01T00:00:00.000Z',
    });
    await timelineManager.updateOptions({
      grouping: 'month',
      personIds: ['person-1'],
      tagIds: ['tag-1'],
    });

    const secondRequest = sdkMock.getTimeBuckets.mock.calls[1][0];
    expect(secondRequest).toEqual(
      expect.objectContaining({
        bucketSize: TimeBucketSize.Month,
        personIds: ['person-1'],
        tagIds: ['tag-1'],
      }),
    );
    expect(secondRequest).not.toHaveProperty('takenAfter');
    expect(secondRequest).not.toHaveProperty('takenBefore');
  });

  it('uses the same grouping bucket size for album-picker merge queries', async () => {
    sdkMock.getTimeBuckets
      .mockResolvedValueOnce([
        {
          timeBucket: '2024-01-01',
          count: 2,
          representativeAssetId: 'library-asset',
          representativeThumbhash: 'library-thumbhash',
          representativeRatio: 1.2,
        },
      ])
      .mockResolvedValueOnce([
        {
          timeBucket: '2024-01-01',
          count: 3,
          representativeAssetId: 'album-asset',
          representativeThumbhash: 'album-thumbhash',
          representativeRatio: 0.9,
        },
      ]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year', timelineAlbumId: 'album-1' });

    expect(sdkMock.getTimeBuckets).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bucketSize: TimeBucketSize.Year }),
      expect.anything(),
    );
    expect(sdkMock.getTimeBuckets).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ albumId: 'album-1', bucketSize: TimeBucketSize.Year }),
      expect.anything(),
    );
    expect(timelineManager.timelineBuckets).toHaveLength(1);
    expect(timelineManager.timelineBuckets[0]).toMatchObject({
      count: 5,
      representativeAssetId: 'library-asset',
      representativeThumbhash: 'library-thumbhash',
      representativeRatio: 1.2,
    });
  });
});
```

- [ ] **Step 2: Run the red manager initialization tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: manager tests fail because `TimelineManager` does not expose `grouping`/`timelineBuckets`, does not pass `bucketSize`, does not pass request options as a second argument with `AbortSignal`, and still treats all bucket metadata as months.

- [ ] **Step 3: Add grouping state and generic bucket initialization**

In `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`, update the SDK and helper imports:

```ts
import {
  AssetOrder,
  getAssetInfo,
  getTimeBuckets,
  type AssetResponseDto,
  type TimeBucketsResponseDto,
} from '@immich/sdk';
import {
  TimelineBucket,
  aggregateDayBucketsByMonth,
  getTimeBucketSizeForGrouping,
  layoutTimelineBuckets,
} from './timeline-bucket.svelte';
import { DEFAULT_TIMELINE_GROUPING, type TimelineGrouping } from './types';
import { toTimeBucketsRequest } from './internal/request-options';
```

Update the type import from `./types` so it includes `TimelineGrouping` only once and keeps existing imported types.

Add these public fields near the existing `months` field:

```ts
  grouping: TimelineGrouping = $state(DEFAULT_TIMELINE_GROUPING);
  timelineBuckets: TimelineBucket[] = $state([]);
```

Replace `bodySectionHeight` with:

```ts
  override bodySectionHeight = $derived.by(() => {
    if (this.grouping !== 'day') {
      return this.timelineBuckets.reduce((height, bucket) => height + bucket.height, 0);
    }

    let height = 0;
    for (const month of this.months) {
      height += month.height;
    }
    return height;
  });
```

Replace `assetCount` with:

```ts
assetCount = $derived.by(() => {
  if (this.grouping !== 'day') {
    return this.timelineBuckets.reduce((count, bucket) => count + bucket.count, 0);
  }

  let count = 0;
  for (const month of this.months) {
    count += month.assetsCount;
  }
  return count;
});
```

Replace `#initializeTimelineMonths()` with:

```ts
  async #initializeTimelineBuckets(signal: AbortSignal) {
    const grouping = this.grouping;
    const bucketSize = getTimeBucketSizeForGrouping(grouping);
    const requestOptions = toTimeBucketsRequest(this.#options, bucketSize);
    const albumQueryOptions = getTimelineAlbumQueryOptions(this.#options, bucketSize);
    const [timeBuckets, albumTimeBuckets] = await Promise.all([
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

    const mergedTimeBuckets =
      albumTimeBuckets.length > 0 ? mergeTimeBuckets(timeBuckets, albumTimeBuckets, this.#options.order) : timeBuckets;

    this.timelineBuckets = mergedTimeBuckets.map((timeBucket) => new TimelineBucket(this, grouping, timeBucket));
    layoutTimelineBuckets(this.timelineBuckets);

    this.months = grouping === 'day' ? this.#createTimelineMonthsFromDayBuckets(mergedTimeBuckets) : [];
    this.albumAssets.clear();
    this.updateViewportGeometry(false);
  }
```

Add this helper method below `#initializeTimelineBuckets()`:

```ts
  #createTimelineMonthsFromDayBuckets(timeBuckets: TimeBucketsResponseDto[]) {
    return aggregateDayBucketsByMonth(timeBuckets, this.#options.order).map((timeBucket) => {
      const date = new SvelteDate(timeBucket.timeBucket);
      return new TimelineMonth(
        this,
        { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
        timeBucket.count,
        false,
        this.#options.order,
      );
    });
  }
```

Replace `#init(options)` with:

```ts
  async #init(options: TimelineManagerOptions) {
    this.isInitialized = false;
    this.grouping = options.grouping ?? DEFAULT_TIMELINE_GROUPING;
    this.months = [];
    this.timelineBuckets = [];
    this.albumAssets.clear();
    await this.initTask.execute(async (signal) => {
      this.#options = options;
      await this.#initializeTimelineBuckets(signal);
    }, true);
  }
```

Update `updateViewportGeometry()` so representative modes only lay out generic buckets:

```ts
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
```

Update `updateViewportProximities()`, `#createScrubberMonths()`, `refreshLayout()`, and `loadTimelineMonth()` with explicit day-mode guards:

```ts
if (this.grouping !== 'day') {
  return;
}
```

For `#createScrubberMonths()`, use:

```ts
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
```

- [ ] **Step 4: Run the green manager initialization tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: helper tests and the seven manager initialization tests pass.

- [ ] **Step 5: Run the existing manager spec**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
```

Expected: existing manager tests may fail only where they assert `getTimeBuckets` was called without `bucketSize`. Update those assertions to expect `bucketSize: TimeBucketSize.Day` for metadata requests while preserving their existing month/container and detailed asset behavior.

### Task 4: Cover Empty, Single, Large, Remount, And Stale Response Edge Cases

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`

- [ ] **Step 1: Add failing edge-case and stale-response tests**

Append these helpers near the top of `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`:

```ts
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
```

Append these tests inside `describe('TimelineManager grouping metadata', () => { ... })`:

```ts
it('includes gaps in representative bucket body height', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([
    {
      timeBucket: '2015-01-01',
      count: 438,
      representativeAssetId: 'asset-2015',
      representativeThumbhash: null,
      representativeRatio: null,
    },
    {
      timeBucket: '2007-01-01',
      count: 12,
      representativeAssetId: 'asset-2007',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });

  expect(timelineManager.bodySectionHeight).toBe(
    2 * REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  );
});

it('shows an initialized empty model when grouped buckets have no matches', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([]);

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year', personIds: ['missing-person'] });

  expect(timelineManager.isInitialized).toBe(true);
  expect(timelineManager.timelineBuckets).toEqual([]);
  expect(timelineManager.months).toEqual([]);
  expect(timelineManager.assetCount).toBe(0);
  expect(timelineManager.bodySectionHeight).toBe(0);
});

it('lays out a single representative bucket without adding a trailing gap', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([
    {
      timeBucket: '2024-01-01',
      count: 1,
      representativeAssetId: 'single-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });

  expect(timelineManager.timelineBuckets).toHaveLength(1);
  expect(timelineManager.timelineBuckets[0].top).toBe(timelineManager.topSectionHeight);
  expect(timelineManager.bodySectionHeight).toBe(REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT);
});

it('handles thousands of representative buckets without loading bucket assets', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue(
    Array.from({ length: 1500 }, (_, index) => ({
      timeBucket: `${String(3024 - index).padStart(4, '0')}-01-01`,
      count: 1,
      representativeAssetId: `asset-${index}`,
      representativeThumbhash: null,
      representativeRatio: null,
    })),
  );

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });

  expect(timelineManager.timelineBuckets).toHaveLength(1500);
  expect(sdkMock.getTimeBucket).not.toHaveBeenCalled();
  expect(timelineManager.bodySectionHeight).toBe(
    1500 * REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + 1499 * REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  );
});

it('initializes grouping consistently across remounts', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([
    {
      timeBucket: '2024-05-01',
      count: 4,
      representativeAssetId: 'asset-may',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);

  const firstManager = new TimelineManager();
  await firstManager.updateOptions({ grouping: 'month', personIds: ['person-1'] });
  firstManager.destroy();

  const secondManager = new TimelineManager();
  await secondManager.updateOptions({ grouping: 'month', personIds: ['person-1'] });

  expect(sdkMock.getTimeBuckets).toHaveBeenCalledTimes(2);
  expect(secondManager.grouping).toBe('month');
  expect(secondManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['month:2024-05-01']);
});

it('ignores stale bucket responses after rapid grouping changes', async () => {
  const yearBuckets = createDeferred<TimeBucketsResponseDto[]>();
  const monthBuckets = createDeferred<TimeBucketsResponseDto[]>();

  sdkMock.getTimeBuckets.mockImplementation(({ bucketSize }) => {
    if (bucketSize === TimeBucketSize.Year) {
      return yearBuckets.promise;
    }

    if (bucketSize === TimeBucketSize.Month) {
      return monthBuckets.promise;
    }

    return Promise.resolve([]);
  });

  const timelineManager = new TimelineManager();
  const yearUpdate = timelineManager.updateOptions({ grouping: 'year' });
  await tick();

  const monthUpdate = timelineManager.updateOptions({ grouping: 'month' });
  await tick();

  monthBuckets.resolve([
    {
      timeBucket: '2024-05-01',
      count: 2,
      representativeAssetId: 'month-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);
  await monthUpdate;

  yearBuckets.resolve([
    {
      timeBucket: '1999-01-01',
      count: 99,
      representativeAssetId: 'stale-year-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);
  await yearUpdate;

  expect(timelineManager.grouping).toBe('month');
  expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['month:2024-05-01']);
  expect(timelineManager.assetCount).toBe(2);
});

it('ignores stale bucket responses after rapid filter changes', async () => {
  const personOneBuckets = createDeferred<TimeBucketsResponseDto[]>();
  const personTwoBuckets = createDeferred<TimeBucketsResponseDto[]>();

  sdkMock.getTimeBuckets.mockImplementation(({ personIds }) => {
    if (personIds?.[0] === 'person-1') {
      return personOneBuckets.promise;
    }

    if (personIds?.[0] === 'person-2') {
      return personTwoBuckets.promise;
    }

    return Promise.resolve([]);
  });

  const timelineManager = new TimelineManager();
  const personOneUpdate = timelineManager.updateOptions({ grouping: 'year', personIds: ['person-1'] });
  await tick();

  const personTwoUpdate = timelineManager.updateOptions({ grouping: 'year', personIds: ['person-2'] });
  await tick();

  personTwoBuckets.resolve([
    {
      timeBucket: '2024-01-01',
      count: 2,
      representativeAssetId: 'person-2-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);
  await personTwoUpdate;

  personOneBuckets.resolve([
    {
      timeBucket: '1999-01-01',
      count: 99,
      representativeAssetId: 'stale-person-1-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);
  await personOneUpdate;

  expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['year:2024-01-01']);
  expect(timelineManager.assetCount).toBe(2);
});

it('ignores bucket responses that resolve after the manager is destroyed', async () => {
  const deferredBuckets = createDeferred<TimeBucketsResponseDto[]>();
  sdkMock.getTimeBuckets.mockReturnValue(deferredBuckets.promise);

  const timelineManager = new TimelineManager();
  const update = timelineManager.updateOptions({ grouping: 'year' });
  await tick();

  timelineManager.destroy();
  deferredBuckets.resolve([
    {
      timeBucket: '2024-01-01',
      count: 1,
      representativeAssetId: 'late-asset',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);
  await update;

  expect(timelineManager.isInitialized).toBe(false);
  expect(timelineManager.timelineBuckets).toEqual([]);
  expect(timelineManager.months).toEqual([]);
});
```

- [ ] **Step 2: Run the red edge-case tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: the representative body-height test fails because body height currently counts bucket heights without gaps; the stale-response tests fail because older requests can overwrite `timelineBuckets`; and the destroy test fails because late responses can mutate a destroyed manager.

- [ ] **Step 3: Fix representative body height and stale-result handling**

In `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`, add a helper method:

```ts
  #representativeBucketsHeight() {
    if (this.timelineBuckets.length === 0) {
      return 0;
    }

    return (
      this.timelineBuckets.length * REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT +
      (this.timelineBuckets.length - 1) * REPRESENTATIVE_TIMELINE_BUCKET_GAP
    );
  }
```

Import the constants:

```ts
  REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT,
```

Change the representative branch in `bodySectionHeight` to:

```ts
if (this.grouping !== 'day') {
  return this.#representativeBucketsHeight();
}
```

Add a stale-result sequence field near `#options`:

```ts
  #initializeSequence = 0;
```

Change `#initializeTimelineBuckets()` to accept the sequence:

```ts
  async #initializeTimelineBuckets(signal: AbortSignal, sequence: number) {
```

Add this stale guard after the awaited `Promise.all()` and before any state mutation:

```ts
if (signal.aborted || sequence !== this.#initializeSequence) {
  return;
}
```

Change `#init(options)` so each initialization has its own sequence:

```ts
const sequence = ++this.#initializeSequence;
await this.initTask.execute(async (signal) => {
  this.#options = options;
  await this.#initializeTimelineBuckets(signal, sequence);
}, true);
```

Update `destroy()` so it invalidates in-flight bucket responses:

```ts
  public override destroy() {
    this.#initializeSequence++;
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
```

- [ ] **Step 4: Run the green edge-case tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: empty, single-bucket, large-list, remount, stale-response, and destroyed-manager tests pass.

### Task 5: Preserve Day-Mode Detailed Timeline Behavior

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`
- Modify: `web/src/lib/managers/timeline-manager/internal/load-support.svelte.ts`
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`
- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`

- [ ] **Step 1: Add failing day-mode compatibility tests**

Extend the existing SDK import in `web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts`:

```ts
import { AssetOrder, TimeBucketSize, type TimeBucketAssetResponseDto, type TimeBucketsResponseDto } from '@immich/sdk';
```

Append the remaining imports:

```ts
import { AbortError } from '$lib/utils';
import { fromISODateTimeUTCToObject } from '$lib/utils/timeline-util';
import { timelineAssetFactory, toResponseDto } from '@test-data/factories/asset-factory';
```

Append these helpers near `createDeferred()`:

```ts
function buildTimelineAssetAt(id: string, isoDate: string) {
  const date = fromISODateTimeUTCToObject(isoDate);
  return {
    ...timelineAssetFactory.build({ id, fileCreatedAt: date }),
    localDateTime: date,
  };
}
```

Append these tests inside `describe('TimelineManager grouping metadata', () => { ... })`:

```ts
it('loads detailed day-mode assets by month with an explicit month bucket size', async () => {
  const asset = buildTimelineAssetAt('asset-jan-1', '2024-01-01T12:00:00.000Z');
  const bucketAssets: Record<string, TimeBucketAssetResponseDto> = {
    '2024-01-01T00:00:00.000Z': toResponseDto(asset),
  };

  sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 1 }]);
  sdkMock.getTimeBucket.mockImplementation(async ({ timeBucket }, { signal } = {}) => {
    await Promise.resolve();
    if (signal?.aborted) {
      throw new AbortError();
    }
    return bucketAssets[timeBucket];
  });

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'day' });
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

  expect(sdkMock.getTimeBucket).toHaveBeenCalledWith(
    expect.objectContaining({
      bucketSize: TimeBucketSize.Month,
      timeBucket: '2024-01-01T00:00:00.000Z',
    }),
    expect.anything(),
  );
  expect(timelineManager.months[0].getAssets().map((loadedAsset) => loadedAsset.id)).toEqual(['asset-jan-1']);
});

it('restores detailed day-mode APIs after visiting year and month grouping', async () => {
  const asset = buildTimelineAssetAt('asset-detail', '2024-01-02T12:00:00.000Z');

  sdkMock.getTimeBuckets
    .mockResolvedValueOnce([
      {
        timeBucket: '2024-01-01',
        count: 1,
        representativeAssetId: 'year-representative',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ])
    .mockResolvedValueOnce([
      {
        timeBucket: '2024-01-01',
        count: 1,
        representativeAssetId: 'month-representative',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ])
    .mockResolvedValueOnce([{ timeBucket: '2024-01-02', count: 1 }]);
  sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(asset));

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });
  await timelineManager.updateOptions({ grouping: 'month' });
  await timelineManager.updateOptions({ grouping: 'day' });
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

  expect(timelineManager.grouping).toBe('day');
  expect(timelineManager.months).toHaveLength(1);
  expect(await timelineManager.getRandomAsset(0)).toMatchObject({ id: 'asset-detail' });
  const loadedAssetIds: string[] = [];
  for await (const loadedAsset of timelineManager.assetsIterator()) {
    loadedAssetIds.push(loadedAsset.id);
  }
  expect(loadedAssetIds).toEqual(['asset-detail']);
});

it('keeps day-mode range selection working after visiting year and month grouping', async () => {
  const laterAsset = buildTimelineAssetAt('asset-later', '2024-01-02T12:00:00.000Z');
  const earlierAsset = buildTimelineAssetAt('asset-earlier', '2024-01-01T12:00:00.000Z');

  sdkMock.getTimeBuckets
    .mockResolvedValueOnce([
      {
        timeBucket: '2024-01-01',
        count: 2,
        representativeAssetId: 'year-representative',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ])
    .mockResolvedValueOnce([
      {
        timeBucket: '2024-01-01',
        count: 2,
        representativeAssetId: 'month-representative',
        representativeThumbhash: null,
        representativeRatio: null,
      },
    ])
    .mockResolvedValueOnce([
      { timeBucket: '2024-01-02', count: 1 },
      { timeBucket: '2024-01-01', count: 1 },
    ]);
  sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(laterAsset, earlierAsset));

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });
  await timelineManager.updateOptions({ grouping: 'month' });
  await timelineManager.updateOptions({ grouping: 'day' });
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

  const selectedRange = await timelineManager.retrieveRange({ id: laterAsset.id }, { id: earlierAsset.id });

  expect(selectedRange.map((asset) => asset.id)).toEqual([laterAsset.id, earlierAsset.id]);
});

it('does not let representative modes create detailed month segments through asset upserts', async () => {
  sdkMock.getTimeBuckets.mockResolvedValue([
    {
      timeBucket: '2024-01-01',
      count: 3,
      representativeAssetId: 'representative',
      representativeThumbhash: null,
      representativeRatio: null,
    },
  ]);

  const timelineManager = new TimelineManager();
  await timelineManager.updateOptions({ grouping: 'year' });
  timelineManager.upsertAssets([buildTimelineAssetAt('new-asset', '2024-01-15T12:00:00.000Z')]);

  expect(timelineManager.grouping).toBe('year');
  expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['year:2024-01-01']);
  expect(timelineManager.months).toEqual([]);
  expect(timelineManager.assetCount).toBe(3);
});
```

- [ ] **Step 2: Run the red compatibility tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
```

Expected: the first test fails until `load-support` passes `bucketSize: TimeBucketSize.Month`; the upsert guard fails until non-day grouping avoids mutating detailed month containers.

- [ ] **Step 3: Update detailed asset bucket loading**

In `web/src/lib/managers/timeline-manager/internal/load-support.svelte.ts`, import `TimeBucketSize` and `toTimeBucketRequest`:

```ts
import { TimeBucketSize, getTimeBucket } from '@immich/sdk';
import { toTimeBucketRequest } from './request-options';
```

Replace the primary `getTimeBucket()` request object with:

```ts
    {
      ...authManager.params,
      ...toTimeBucketRequest(options, timeBucket, TimeBucketSize.Month),
    },
```

Replace the album `getTimeBucket()` request object with:

```ts
      {
        ...authManager.params,
        ...albumQueryOptions,
        timeBucket,
        bucketSize: TimeBucketSize.Month,
      },
```

Replace the timeline space `getTimeBucket()` request object with:

```ts
      {
        ...authManager.params,
        ...toTimeBucketRequest(
          {
            ...options,
            spaceId: options.timelineSpaceId,
          },
          timeBucket,
          TimeBucketSize.Month,
        ),
      },
```

Update the `getTimelineAlbumQueryOptions()` call in this file to pass `TimeBucketSize.Month`:

```ts
const albumQueryOptions = getTimelineAlbumQueryOptions(options, TimeBucketSize.Month);
```

- [ ] **Step 4: Guard detailed mutation methods in representative modes**

In `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`, add this private helper:

```ts
  #isDetailedTimeline() {
    return this.grouping === 'day';
  }
```

At the start of detailed-only methods, return early for non-day grouping:

```ts
if (!this.#isDetailedTimeline()) {
  return;
}
```

Apply that guard to:

- `upsertAssets(assets: TimelineAsset[])`
- `update(ids: string[], callback: ...)`
- `removeAssets(ids: string[])`
- `protected addAssetsUpsertSegments(assets: TimelineAsset[])`
- `#updateAssets(assets: TimelineAsset[])`

For methods with non-void return values, use these exact fallbacks:

```ts
// update(...)
if (!this.#isDetailedTimeline()) {
  return {
    updated: new Set<string>(),
    notUpdated: new Set(ids),
    changedGeometry: false,
  };
}
```

```ts
// removeAssets(...)
if (!this.#isDetailedTimeline()) {
  return ids;
}
```

```ts
// #updateAssets(...)
if (!this.#isDetailedTimeline()) {
  return assets;
}
```

Do not guard read-only detailed APIs such as `assetsIterator()`, `getRandomAsset()`, or `findTimelineMonthForAsset()`. With `months = []`, those already return no assets in representative modes and work again after returning to day mode.

- [ ] **Step 5: Update existing manager tests to expect day metadata bucket size**

In `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`, import `TimeBucketSize` from `@immich/sdk`:

```ts
import { AssetVisibility, TimeBucketSize, type AssetResponseDto, type TimeBucketAssetResponseDto } from '@immich/sdk';
```

For existing init assertions that inspect `sdkMock.getTimeBuckets`, update them to preserve the original call count and add this expectation:

```ts
expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(
  expect.objectContaining({ bucketSize: TimeBucketSize.Day }),
  expect.anything(),
);
```

For existing `getTimeBucket` assertions in day-mode load tests, add:

```ts
expect(sdkMock.getTimeBucket).toHaveBeenCalledWith(
  expect.objectContaining({ bucketSize: TimeBucketSize.Month }),
  expect.anything(),
);
```

Do not change expected month heights, asset order, websocket behavior, range selection, or detailed asset navigation expectations.

- [ ] **Step 6: Run the green compatibility tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
```

Expected: new grouping tests pass and existing manager behavior remains green with updated bucket-size expectations.

### Task 6: Final Verification And Spec Coverage Review

**Files:**

- Read: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Read: `docs/superpowers/plans/2026-05-19-timeline-grouping-slice-1-server-api.md`
- Verify changed files from Tasks 1-5.

- [ ] **Step 1: Run focused grouping and manager tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
pnpm --filter immich-web run check:typescript
```

Expected: TypeScript passes with no manager option or SDK request type errors.

- [ ] **Step 3: Run a spec coverage checklist**

Confirm each requirement is covered by a test or explicitly deferred:

```md
- [ ] Updating grouping requests correct bucket size: covered by year/month/day metadata tests.
- [ ] Selecting person/tag/filter reloads only matching buckets: covered by filter forwarding and reload-on-filter-change tests.
- [ ] Clearing temporal state reloads broader buckets without losing non-time filters: covered by temporal-bound clearing test.
- [ ] Rapid grouping/filter changes cancel or ignore stale bucket responses: covered by stale response test.
- [ ] Route/component teardown invalidates in-flight bucket responses: covered by destroyed-manager stale response test.
- [ ] Grouping initializes consistently on first load and remount: covered by default day and remount tests.
- [ ] Empty bucket lists show initialized empty model: covered by empty model test.
- [ ] Representative bucket cards do not load all bucket assets: covered by `getTimeBucket` not called in year/month tests.
- [ ] Day mode preserves detailed timeline behavior: covered by detailed asset loading and existing manager spec.
- [ ] Existing websocket/update/delete/archive/favorite/stack/trash flows update active day timeline: covered by existing `timeline-manager.svelte.spec.ts`; confirm no regressions.
- [ ] Day-mode range selection and group selection still work after visiting year/month modes: range selection is covered by the explicit restore-after-visiting range test; group selection remains covered by existing detailed day-mode manager/component tests.
- [ ] Clicking year/month cards and FilterPanel temporal sync: deferred to slice 3 by design.
- [ ] Visual grouping control and representative card accessibility/layout: deferred to slice 4 by design.
- [ ] Route adoption and pages without FilterPanel active chips: deferred to slice 5 by design.
```

- [ ] **Step 4: Run edge-case checklist**

Confirm these edge cases are covered by tests in this slice:

```md
- [ ] No matching assets: empty model test.
- [ ] Single bucket with one asset: single-bucket layout test.
- [ ] Very large libraries with thousands of buckets: 1500-bucket layout test.
- [ ] Dec 31 / Jan 1 boundaries: day bucket aggregation test.
- [ ] Leap-day assets: day bucket aggregation test.
- [ ] Local capture dates that differ from UTC dates: manager treats server `timeBucket` strings as local timeline bucket keys and does not re-zone with local browser time; covered by parse/aggregation tests using raw date strings.
- [ ] Active non-time filters: request forwarding and reload-on-filter-change tests.
- [ ] Temporal `takenAfter`/`takenBefore` filters: request forwarding and temporal-bound clearing tests.
- [ ] In-flight bucket requests resolving after grouping/filter/route teardown changes: grouping stale response, filter stale response, and destroyed-manager tests.
- [ ] Representative asset removed after buckets loaded: not mutated in this slice; representative invalidation belongs with card/UI update handling in slice 4 or route adoption.
- [ ] Selection mode/asset viewer while grouping changes: no UI in this slice; detailed manager state remains isolated by grouping.
```

- [ ] **Step 5: Commit the completed slice**

Stage only files changed for slice 2:

```bash
git add \
  web/src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts \
  web/src/lib/managers/timeline-manager/timeline-bucket.svelte.ts \
  web/src/lib/managers/timeline-manager/internal/request-options.ts \
  web/src/lib/managers/timeline-manager/types.ts \
  web/src/lib/managers/timeline-manager/internal/album-picker-support.ts \
  web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts \
  web/src/lib/managers/timeline-manager/internal/load-support.svelte.ts \
  web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
git commit -m "feat(web): add timeline grouping manager model"
```

## Design Consistency Notes

- `year` and `month` are display groupings, not filters. The manager forwards existing filter options to the bucket API; temporal narrowing from card clicks is intentionally left for slice 3.
- Representative modes expose metadata-only buckets and do not fetch all assets, matching the performance section of the spec.
- `day` grouping requests day metadata so the bucket API contract is exercised, but detailed asset loading remains month-based to preserve the current day-header thumbnail timeline until a later detailed loader refactor is justified.
- The public model moves toward generic `timelineBuckets`, while `months` remains available for current detailed timeline consumers.
- The plan leaves UI card sizes as stable model constants. Slice 4 can tune these constants or move them behind a visual layout helper when the card component is implemented.
