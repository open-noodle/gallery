import { AssetOrder, TimeBucketSize } from '@immich/sdk';
import { tick } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { fromISODateTimeUTCToObject } from '$lib/utils/timeline-util';
import { timelineAssetFactory, toResponseDto } from '@test-data/factories/asset-factory';
import { mergeTimeBuckets } from './internal/album-picker-support';
import { toTimeBucketRequest, toTimeBucketsRequest } from './internal/request-options';
import {
  aggregateDayBucketsByMonth,
  getTimeBucketSizeForGrouping,
  layoutTimelineBuckets,
  REPRESENTATIVE_TIMELINE_BUCKET_GAP,
  REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT,
  TimelineBucket,
} from './timeline-bucket.svelte';
import { TimelineManager } from './timeline-manager.svelte';

function buildTimelineAssetAt(id: string, isoDate: string) {
  const date = fromISODateTimeUTCToObject(isoDate);
  return {
    ...timelineAssetFactory.build({ id, fileCreatedAt: date }),
    localDateTime: date,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

class TestTimelineManager extends TimelineManager {
  public addSegmentsForTest(assets: Parameters<TimelineManager['upsertAssets']>[0]) {
    this.addAssetsUpsertSegments(assets);
  }
}

describe('timeline grouping bucket helpers', () => {
  describe('mergeTimeBuckets', () => {
    it('sums counts when merging duplicate buckets', () => {
      const merged = mergeTimeBuckets(
        [{ timeBucket: '2024-01-01', count: 2 }],
        [{ timeBucket: '2024-01-01', count: 3 }],
        AssetOrder.Desc,
      );

      expect(merged).toEqual([
        {
          timeBucket: '2024-01-01',
          count: 5,
        },
      ]);
    });

    it('sums counts when secondary bucket has no corresponding primary', () => {
      const merged = mergeTimeBuckets(
        [{ timeBucket: '2024-01-01', count: 2 }],
        [{ timeBucket: '2024-01-01', count: 3 }],
        AssetOrder.Desc,
      );

      expect(merged).toEqual([
        {
          timeBucket: '2024-01-01',
          count: 5,
        },
      ]);
    });

    it('passes through buckets that only exist in the secondary query', () => {
      const merged = mergeTimeBuckets([], [{ timeBucket: '2023-01-01', count: 1 }], AssetOrder.Desc);

      expect(merged).toEqual([
        {
          timeBucket: '2023-01-01',
          count: 1,
        },
      ]);
    });
  });

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
      });
      // representative fields are null until setRepresentative is called (from bucket-covers)
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
        representativeAssetId: null,
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

    it('setRepresentative applies cover data to the bucket', () => {
      const bucket = new TimelineBucket({ topSectionHeight: 0 }, 'year', {
        timeBucket: '2015-01-01',
        count: 438,
      });
      expect(bucket.representativeAssetId).toBeNull();
      bucket.setRepresentative({
        representativeAssetId: 'asset-2015',
        representativeThumbhash: 'thumbhash-2015',
        representativeRatio: 1.25,
      });
      expect(bucket.representativeAssetId).toBe('asset-2015');
      expect(bucket.representativeThumbhash).toBe('thumbhash-2015');
      expect(bucket.representativeRatio).toBe(1.25);
    });

    it('normalizes missing representative metadata to null', () => {
      const bucket = new TimelineBucket({ topSectionHeight: 0 }, 'year', {
        timeBucket: '2015-01-01',
        count: 438,
      });

      expect(bucket).toMatchObject({
        representativeAssetId: null,
        representativeThumbhash: null,
        representativeRatio: null,
      });
    });

    it('keeps representative bucket top relative to the manager top section', () => {
      const manager = { topSectionHeight: 12 };
      const bucket = new TimelineBucket(manager, 'year', {
        timeBucket: '2015-01-01',
        count: 438,
      });

      bucket.setTop(100);
      manager.topSectionHeight = 24;

      expect(bucket.top).toBe(124);
    });

    it('builds a month representative bucket without UTC/local date drift', () => {
      const manager = { topSectionHeight: 0 };
      const bucket = new TimelineBucket(manager, 'month', {
        timeBucket: '2011-08-01',
        count: 12,
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

    it('aggregates day buckets into a month with only timeBucket and count', () => {
      const months = aggregateDayBucketsByMonth([
        { timeBucket: '2024-02-29', count: 2 },
        { timeBucket: '2024-02-01', count: 3 },
      ]);

      expect(months[0]).toMatchObject({
        timeBucket: '2024-02-01',
        count: 5,
      });
      expect(months[0]).not.toHaveProperty('representativeAssetId');
      expect(months[0]).not.toHaveProperty('representativeThumbhash');
      expect(months[0]).not.toHaveProperty('representativeRatio');
    });

    it('lays out thousands of representative buckets with stable cumulative top positions', () => {
      const manager = { topSectionHeight: 20 };
      const buckets = Array.from({ length: 1500 }, (_, index) => {
        const year = 3024 - index;
        return new TimelineBucket(manager, 'year', { timeBucket: `${year}-01-01`, count: 1 });
      });
      layoutTimelineBuckets(buckets);
      expect(buckets[0].top).toBe(20);
      expect(buckets[1].top).toBe(20 + REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP);
      expect(buckets.at(-1)?.top).toBe(
        20 + 1499 * (REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP),
      );
    });
  });
});

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
    await tick();

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
      { timeBucket: '2015-01-01', count: 438 },
      { timeBucket: '2007-01-01', count: 12 },
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
    expect(timelineManager.bodySectionHeight).toBe(
      2 * REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT + REPRESENTATIVE_TIMELINE_BUCKET_GAP,
    );
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual([
      'year:2015-01-01',
      'year:2007-01-01',
    ]);
    expect(timelineManager.timelineBuckets[0]).toMatchObject({
      grouping: 'year',
      count: 438,
      representativeAssetId: null,
      representativeThumbhash: null,
      representativeRatio: null,
      date: { year: 2015 },
    });
  });

  it('requests month buckets and exposes representative month buckets', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([
      { timeBucket: '2011-08-01', count: 21 },
      { timeBucket: '2010-01-01', count: 23 },
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
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 8 }])
      .mockResolvedValueOnce([{ timeBucket: '2023-01-01', count: 3 }]);

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
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 2 }])
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 3 }]);

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
    expect(timelineManager.timelineBuckets[0]).toMatchObject({ count: 5 });
  });

  it('does not let representative modes create detailed month segments through asset upserts', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 3 }]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });
    timelineManager.upsertAssets([buildTimelineAssetAt('new-asset', '2024-01-15T12:00:00.000Z')]);

    expect(timelineManager.grouping).toBe('year');
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['year:2024-01-01']);
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.assetCount).toBe(3);
  });

  it('loads detailed day-mode assets by month with an explicit month bucket size', async () => {
    const asset = buildTimelineAssetAt('asset-jan-1', '2024-01-15T12:00:00.000Z');
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-15', count: 1 }]);
    sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(asset));

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'day' });
    await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

    expect(sdkMock.getTimeBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketSize: TimeBucketSize.Month,
        timeBucket: '2024-01-01',
      }),
      expect.anything(),
    );
    expect(timelineManager.months[0].getAssets().map((loadedAsset) => loadedAsset.id)).toEqual(['asset-jan-1']);
  });

  it('loads detailed album-picker assets with an explicit month bucket size', async () => {
    const pickerAsset = buildTimelineAssetAt('picker-asset', '2024-01-15T12:00:00.000Z');
    const albumAsset = buildTimelineAssetAt('album-asset', '2024-01-16T12:00:00.000Z');
    sdkMock.getTimeBuckets
      .mockResolvedValueOnce([{ timeBucket: '2024-01-15', count: 1 }])
      .mockResolvedValueOnce([{ timeBucket: '2024-01-16', count: 1 }]);
    sdkMock.getTimeBucket
      .mockResolvedValueOnce(toResponseDto(pickerAsset))
      .mockResolvedValueOnce(toResponseDto(albumAsset));

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'day', timelineAlbumId: 'album-1' });
    await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

    expect(sdkMock.getTimeBucket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        albumId: 'album-1',
        bucketSize: TimeBucketSize.Month,
        timeBucket: '2024-01-01',
      }),
      expect.anything(),
    );
  });

  it('loads detailed timeline-space assets with an explicit month bucket size', async () => {
    const libraryAsset = buildTimelineAssetAt('library-asset', '2024-01-15T12:00:00.000Z');
    const spaceAsset = buildTimelineAssetAt('space-asset', '2024-01-16T12:00:00.000Z');
    sdkMock.getTimeBuckets.mockResolvedValueOnce([{ timeBucket: '2024-01-15', count: 1 }]);
    sdkMock.getTimeBucket
      .mockResolvedValueOnce(toResponseDto(libraryAsset))
      .mockResolvedValueOnce(toResponseDto(spaceAsset));

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'day', timelineSpaceId: 'space-1' });
    await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

    expect(sdkMock.getTimeBucket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        bucketSize: TimeBucketSize.Month,
        spaceId: 'space-1',
        timeBucket: '2024-01-01',
      }),
      expect.anything(),
    );
  });

  it('restores detailed day-mode APIs after visiting representative grouping', async () => {
    const asset = buildTimelineAssetAt('asset-detail', '2024-01-02T12:00:00.000Z');
    sdkMock.getTimeBuckets
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 1 }])
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 1 }])
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

  it('keeps day-mode range selection working after visiting representative grouping', async () => {
    const laterAsset = buildTimelineAssetAt('asset-later', '2024-01-02T12:00:00.000Z');
    const earlierAsset = buildTimelineAssetAt('asset-earlier', '2024-01-01T12:00:00.000Z');
    sdkMock.getTimeBuckets
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 2 }])
      .mockResolvedValueOnce([{ timeBucket: '2024-01-01', count: 2 }])
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

  it('does not let representative modes create detailed month segments through protected segment upserts', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 3 }]);

    const timelineManager = new TestTimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });
    timelineManager.addSegmentsForTest([buildTimelineAssetAt('new-asset', '2024-01-15T12:00:00.000Z')]);

    expect(timelineManager.grouping).toBe('year');
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['year:2024-01-01']);
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.assetCount).toBe(3);
  });

  it('does not let representative update and remove operations mutate detailed month state', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 3 }]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });
    const updateResult = timelineManager.update(['asset-1'], () => undefined);
    const removeResult = timelineManager.removeAssets(['asset-1']);

    expect(updateResult).toEqual({
      updated: new Set(),
      notUpdated: new Set(['asset-1']),
      changedGeometry: false,
    });
    expect(removeResult).toEqual(['asset-1']);
    expect(timelineManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(['year:2024-01-01']);
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.assetCount).toBe(3);
  });

  it('handles an empty representative bucket model without trailing representative gap', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });

    expect(timelineManager.timelineBuckets).toEqual([]);
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.assetCount).toBe(0);
    expect(timelineManager.bodySectionHeight).toBe(0);
  });

  it('does not add a trailing representative gap for a single bucket', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 4 }]);

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });

    expect(timelineManager.bodySectionHeight).toBe(REPRESENTATIVE_TIMELINE_BUCKET_HEIGHT);
  });

  it('initializes thousands of representative buckets without loading bucket assets', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue(
      Array.from({ length: 2500 }, (_, index) => ({
        timeBucket: `${4524 - index}-01-01`,
        count: 1,
      })),
    );

    const timelineManager = new TimelineManager();
    await timelineManager.updateOptions({ grouping: 'year' });

    expect(timelineManager.timelineBuckets).toHaveLength(2500);
    expect(timelineManager.assetCount).toBe(2500);
    expect(sdkMock.getTimeBucket).not.toHaveBeenCalled();
  });

  it('reinitializes consistently after destroy and remount with the same options', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 2 }]);

    const firstManager = new TimelineManager();
    await firstManager.updateOptions({ grouping: 'year' });
    const firstViewIds = firstManager.timelineBuckets.map((bucket) => bucket.viewId);
    firstManager.destroy();

    const secondManager = new TimelineManager();
    await secondManager.updateOptions({ grouping: 'year' });

    expect(secondManager.timelineBuckets.map((bucket) => bucket.viewId)).toEqual(firstViewIds);
    expect(secondManager.isInitialized).toBe(true);
  });

  it('ignores stale bucket responses from rapid grouping changes', async () => {
    const yearBuckets = createDeferred<Awaited<ReturnType<typeof sdkMock.getTimeBuckets>>>();
    const monthBuckets = createDeferred<Awaited<ReturnType<typeof sdkMock.getTimeBuckets>>>();
    sdkMock.getTimeBuckets.mockReturnValueOnce(yearBuckets.promise).mockReturnValueOnce(monthBuckets.promise);

    const timelineManager = new TimelineManager();
    const yearUpdate = timelineManager.updateOptions({ grouping: 'year' });
    const monthUpdate = timelineManager.updateOptions({ grouping: 'month' });
    await vi.waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalledTimes(2));

    monthBuckets.resolve([{ timeBucket: '2024-05-01', count: 5 }]);
    await monthUpdate;

    yearBuckets.resolve([{ timeBucket: '2023-01-01', count: 99 }]);
    await yearUpdate;

    expect(timelineManager.grouping).toBe('month');
    expect(timelineManager.timelineBuckets.map((bucket) => [bucket.grouping, bucket.timeBucket, bucket.count])).toEqual(
      [['month', '2024-05-01', 5]],
    );
    expect(timelineManager.isInitialized).toBe(true);
  });

  it('ignores stale bucket responses from rapid filter changes', async () => {
    const staleBuckets = createDeferred<Awaited<ReturnType<typeof sdkMock.getTimeBuckets>>>();
    const currentBuckets = createDeferred<Awaited<ReturnType<typeof sdkMock.getTimeBuckets>>>();
    sdkMock.getTimeBuckets.mockReturnValueOnce(staleBuckets.promise).mockReturnValueOnce(currentBuckets.promise);

    const timelineManager = new TimelineManager();
    const staleUpdate = timelineManager.updateOptions({ grouping: 'year', personIds: ['person-1'] });
    const currentUpdate = timelineManager.updateOptions({ grouping: 'year', personIds: ['person-2'] });
    await vi.waitFor(() => expect(sdkMock.getTimeBuckets).toHaveBeenCalledTimes(2));

    currentBuckets.resolve([{ timeBucket: '2022-01-01', count: 7 }]);
    await currentUpdate;

    staleBuckets.resolve([{ timeBucket: '2021-01-01', count: 100 }]);
    await staleUpdate;

    expect(timelineManager.timelineBuckets.map((bucket) => [bucket.timeBucket, bucket.count])).toEqual([
      ['2022-01-01', 7],
    ]);
    expect(timelineManager.isInitialized).toBe(true);
  });

  it('ignores late bucket responses after destroy and leaves the manager uninitialized', async () => {
    const buckets = createDeferred<Awaited<ReturnType<typeof sdkMock.getTimeBuckets>>>();
    sdkMock.getTimeBuckets.mockReturnValueOnce(buckets.promise);

    const timelineManager = new TimelineManager();
    const update = timelineManager.updateOptions({ grouping: 'year' });
    timelineManager.destroy();

    buckets.resolve([{ timeBucket: '2024-01-01', count: 8 }]);
    await update;

    expect(timelineManager.isInitialized).toBe(false);
    expect(timelineManager.months).toEqual([]);
    expect(timelineManager.timelineBuckets).toEqual([]);
  });
});
