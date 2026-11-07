import { scrollTimelineToTemporalAnchor } from '#lib/gallery/timeline/timeline-anchor.ts';
import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { getTimelineMonthByDate } from '#lib/managers/timeline-manager/internal/search-support.svelte.ts';
import { fromISODateTimeUTCToObject, fromTimelinePlainDateTime } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import {
  AssetOrderBy,
  AssetVisibility,
  TimeBucketSize,
  type AssetResponseDto,
  type TimeBucketAssetResponseDto,
  type TimeBucketsResponseDto,
} from '@immich/sdk';
import { Settings } from 'luxon';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { TimelineManager } from './timeline-manager.svelte';
import type { TimelineAsset } from './types';

async function getAssets(timelineManager: TimelineManager) {
  const assets = [];
  for await (const asset of timelineManager.assetsIterator()) {
    assets.push(asset);
  }
  return assets;
}

const toResponseDto = (...timelineAsset: TimelineAsset[]) => {
  const bucketAssets: TimeBucketAssetResponseDto = {
    city: [],
    country: [],
    duration: [],
    id: [],
    visibility: [],
    isFavorite: [],
    isImage: [],
    isTrashed: [],
    livePhotoVideoId: [],
    fileCreatedAt: [],
    localOffsetHours: [],
    createdAt: [],
    ownerId: [],
    projectionType: [],
    ratio: [],
    stack: [],
    thumbhash: [],
  };
  for (const asset of timelineAsset) {
    const fileCreatedAt = fromTimelinePlainDateTime(asset.fileCreatedAt).toISO();
    bucketAssets.city?.push(asset.city);
    bucketAssets.country?.push(asset.country);
    bucketAssets.duration.push(asset.duration!);
    bucketAssets.id.push(asset.id);
    bucketAssets.visibility.push(asset.visibility);
    bucketAssets.isFavorite.push(asset.isFavorite);
    bucketAssets.isImage.push(asset.isImage);
    bucketAssets.isTrashed.push(asset.isTrashed);
    bucketAssets.livePhotoVideoId.push(asset.livePhotoVideoId!);
    bucketAssets.fileCreatedAt.push(fileCreatedAt);
    bucketAssets.createdAt.push(fromTimelinePlainDateTime(asset.createdAt).toISO());
    bucketAssets.ownerId.push(asset.ownerId);
    bucketAssets.projectionType.push(asset.projectionType!);
    bucketAssets.ratio.push(asset.ratio);
    bucketAssets.stack?.push(asset.stack ? [asset.stack.id, asset.stack.assetCount.toString()] : null);
    bucketAssets.thumbhash.push(asset.thumbhash!);
  }

  return bucketAssets;
};

function deriveLocalDateTimeFromFileCreatedAt(arg: TimelineAsset): TimelineAsset {
  return {
    ...arg,
    localDateTime: arg.fileCreatedAt,
  };
}

type Context = { api: Mock['api'] };

const mockTimeBuckets = (
  api: Mock['api'],
  timeBuckets: TimeBucketsResponseDto[],
  bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto>,
) =>
  api.on({
    getTimeBuckets: () => ({ json: timeBuckets }),
    getTimeBucket: ({ params }) => ({ json: bucketAssetsResponse[params.timeBucket] }),
  });

describe('TimelineManager', () => {
  describe('init', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({
        getTimeBuckets: () => ({
          json: [
            { count: 1, timeBucket: '2024-03-01' },
            { count: 100, timeBucket: '2024-02-01' },
            { count: 3, timeBucket: '2024-01-01' },
          ],
        }),
        getTimeBucket: () => new Promise(() => {}),
      });
      await timelineManager.updateViewport({ width: 1588, height: 1000 });
      await tick();
    });

    test('should load months in viewport', ({ api }) => {
      expect(api.getTimeBuckets.calls).toHaveLength(1);
      expect(api.getTimeBucket.calls).toHaveLength(2);
    });

    test('connects websocket events for main timeline', async ({ api }) => {
      const freshManager = new TimelineManager();
      const connectSpy = vi.spyOn(freshManager, 'connect');
      api.on({ getTimeBuckets: () => ({ json: [] }) });
      await freshManager.updateViewport({ width: 1588, height: 1000 });
      expect(connectSpy).toHaveBeenCalled();
      freshManager.destroy();
    });

    test('calculates month height', () => {
      const plainMonths = timelineManager.months.map((month) => ({
        year: month.yearMonth.year,
        month: month.yearMonth.month,
        height: month.height,
      }));

      expect(plainMonths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ year: 2024, month: 3, height: 283 }),
          expect.objectContaining({ year: 2024, month: 2, height: 3808 }),
          expect.objectContaining({ year: 2024, month: 1, height: 283 }),
        ]),
      );
    });

    test('calculates timeline height', () => {
      expect(timelineManager.totalViewerHeight).toBe(4434);
    });
  });

  describe('isEmptyForOptions', () => {
    test('reports empty only for the options it actually loaded', async ({ api }) => {
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      const timelineManager = new TimelineManager();
      const loadedOptions = { visibility: AssetVisibility.Timeline, personIds: ['person-1'] };
      await timelineManager.updateOptions(loadedOptions);
      await timelineManager.updateViewport({ width: 1588, height: 1000 });
      await tick();

      expect(timelineManager.isInitialized).toBe(true);
      expect(timelineManager.assetCount).toBe(0);

      // Empty for exactly the options it loaded...
      expect(timelineManager.isEmptyForOptions({ visibility: AssetVisibility.Timeline, personIds: ['person-1'] })).toBe(
        true,
      );

      // ...but NOT for different options it has not reloaded for yet. While a filter change is
      // pending, `assetCount` still reflects the previous query, so a bare `assetCount === 0`
      // would wrongly look "empty" — which on the photos/spaces pages hides+unmounts the filter
      // panel and steals focus from a text input mid-typing.
      expect(timelineManager.isEmptyForOptions({ visibility: AssetVisibility.Timeline, personIds: ['person-2'] })).toBe(
        false,
      );
    });

    test('is not empty before any options have loaded', () => {
      const timelineManager = new TimelineManager();
      expect(timelineManager.isEmptyForOptions({ visibility: AssetVisibility.Timeline })).toBe(false);
    });
  });

  describe('reload', () => {
    test('rebuilds the month objects on every reload, so views keyed on them remount their month DOM', async ({
      api,
    }) => {
      api.on({ getTimeBuckets: () => ({ json: [{ timeBucket: '2024-01-01', count: 1 }] }) });
      const timelineManager = new TimelineManager();

      await timelineManager.updateOptions({ visibility: AssetVisibility.Timeline, personIds: ['person-1'] });
      const [first] = timelineManager.months;

      await timelineManager.updateOptions({ visibility: AssetVisibility.Timeline, personIds: ['person-2'] });
      const [second] = timelineManager.months;

      expect(second.viewId).toBe(first.viewId);
      expect(second).not.toBe(first);
    });
  });

  describe('loadTimelineMonth', () => {
    let timelineManager: TimelineManager;
    const bucketAssets: Record<string, TimelineAsset[]> = {
      '2024-01-03': factory
        .many(1, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-03-01T00:00:00.000Z'),
          }),
        ),
      '2024-01-01': factory
        .many(3, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-01T00:00:00.000Z'),
          }),
        ),
    };
    const bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
      Object.entries(bucketAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
    );
    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      mockTimeBuckets(
        api,
        [
          { count: 1, timeBucket: '2024-03-01' },
          { count: 3, timeBucket: '2024-01-01' },
        ],
        bucketAssetsResponse,
      );
      await timelineManager.updateViewport({ width: 1588, height: 0 });
    });

    test('loads a month', async ({ api }) => {
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })?.getAssets().length).toEqual(0);
      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      expect(api.getTimeBucket.calls).toHaveLength(1);
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })?.getAssets().length).toEqual(3);
    });

    test('ignores invalid months', async ({ api }) => {
      await timelineManager.loadTimelineMonth({ year: 2023, month: 1 });
      expect(api.getTimeBucket).not.toHaveBeenCalled();
    });

    test('cancels month loading', async () => {
      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })!;
      void timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      const abortSpy = vi.spyOn(month!.loader!.cancelToken!, 'abort');
      month?.cancel();
      expect(abortSpy).toHaveBeenCalledOnce();
      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })?.getAssets().length).toEqual(3);
    });

    test('prevents loading months multiple times', async ({ api }) => {
      await Promise.all([
        timelineManager.loadTimelineMonth({ year: 2024, month: 1 }),
        timelineManager.loadTimelineMonth({ year: 2024, month: 1 }),
      ]);
      expect(api.getTimeBucket.calls).toHaveLength(1);

      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      expect(api.getTimeBucket.calls).toHaveLength(1);
    });

    test('allows loading a canceled month', async () => {
      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })!;
      const loadPromise = timelineManager.loadTimelineMonth({ year: 2024, month: 1 });

      month.cancel();
      await loadPromise;
      expect(month?.getAssets().length).toEqual(0);

      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      expect(month!.getAssets().length).toEqual(3);
    });
  });

  describe('upsertAssets', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 1588, height: 1000 });
    });

    test('is empty initially', () => {
      expect(timelineManager.months.length).toEqual(0);
      expect(timelineManager.assetCount).toEqual(0);
    });

    test('adds assets to new month', () => {
      const asset = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([asset]);

      expect(timelineManager.months.length).toEqual(1);
      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getAssets().length).toEqual(1);
      expect(timelineManager.months[0].yearMonth.year).toEqual(2024);
      expect(timelineManager.months[0].yearMonth.month).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().id).toEqual(asset.id);
    });

    test('adds assets to existing month', () => {
      const [assetOne, assetTwo] = factory
        .many(2, () =>
          factory.timelineAsset({
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
          }),
        )
        .map((asset) => deriveLocalDateTimeFromFileCreatedAt(asset));
      timelineManager.upsertAssets([assetOne]);
      timelineManager.upsertAssets([assetTwo]);

      expect(timelineManager.months.length).toEqual(1);
      expect(timelineManager.assetCount).toEqual(2);
      expect(timelineManager.months[0].getAssets().length).toEqual(2);
      expect(timelineManager.months[0].yearMonth.year).toEqual(2024);
      expect(timelineManager.months[0].yearMonth.month).toEqual(1);
    });

    test('orders assets in months by descending date', () => {
      const assetOne = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const assetTwo = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-15T12:00:00.000Z'),
        }),
      );
      const assetThree = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-16T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([assetOne, assetTwo, assetThree]);

      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 });
      expect(month).not.toBeNull();
      expect(month?.getAssets().length).toEqual(3);
      expect(month?.getAssets()[0].id).toEqual(assetOne.id);
      expect(month?.getAssets()[1].id).toEqual(assetThree.id);
      expect(month?.getAssets()[2].id).toEqual(assetTwo.id);
    });

    test('orders months by descending date', () => {
      const assetOne = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const assetTwo = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-04-20T12:00:00.000Z'),
        }),
      );
      const assetThree = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2023-01-20T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([assetOne, assetTwo, assetThree]);

      expect(timelineManager.months.length).toEqual(3);
      expect(timelineManager.months[0].yearMonth.year).toEqual(2024);
      expect(timelineManager.months[0].yearMonth.month).toEqual(4);

      expect(timelineManager.months[1].yearMonth.year).toEqual(2024);
      expect(timelineManager.months[1].yearMonth.month).toEqual(1);

      expect(timelineManager.months[2].yearMonth.year).toEqual(2023);
      expect(timelineManager.months[2].yearMonth.month).toEqual(1);
    });

    test('updates existing asset', () => {
      const updateAssetsSpy = vi.spyOn(timelineManager, 'upsertAssets');
      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset());
      timelineManager.upsertAssets([asset]);

      expect(updateAssetsSpy).toHaveBeenCalledWith([asset]);
      expect(timelineManager.assetCount).toEqual(1);
    });

    test('ignores new assets that do not match the tag filter', async () => {
      await timelineManager.updateOptions({ tagId: 'tag-1' });

      const matching = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ tags: ['tag-1'] }));
      const unrelated = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ tags: ['tag-2'] }));

      timelineManager.upsertAssets([matching, unrelated]);

      expect(await getAssets(timelineManager)).toEqual([matching]);
    });

    // disabled due to the wasm Justified Layout import
    test('ignores trashed assets when isTrashed is true', async () => {
      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ isTrashed: false }));
      const trashedAsset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ isTrashed: true }));

      const timelineManager = new TimelineManager();
      await timelineManager.updateOptions({ isTrashed: true });
      timelineManager.upsertAssets([asset, trashedAsset]);
      expect(await getAssets(timelineManager)).toEqual([trashedAsset]);
    });
  });

  describe('upsertAssets - updating existing', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 1588, height: 1000 });
    });

    test('updates an asset', () => {
      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ isFavorite: false }));
      const updatedAsset = { ...asset, isFavorite: true };

      timelineManager.upsertAssets([asset]);
      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().isFavorite).toEqual(false);

      timelineManager.upsertAssets([updatedAsset]);
      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().isFavorite).toEqual(true);
    });

    test('asset moves months when asset date changes', () => {
      const asset = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const updatedAsset = deriveLocalDateTimeFromFileCreatedAt({
        ...asset,
        fileCreatedAt: fromISODateTimeUTCToObject('2024-03-20T12:00:00.000Z'),
      });

      timelineManager.upsertAssets([asset]);
      expect(timelineManager.months.length).toEqual(1);
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })).not.toBeUndefined();
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })?.getAssets().length).toEqual(1);

      timelineManager.upsertAssets([updatedAsset]);
      expect(timelineManager.months.length).toEqual(2);
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })).not.toBeUndefined();
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 })?.getAssets().length).toEqual(0);
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 3 })).not.toBeUndefined();
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 3 })?.getAssets().length).toEqual(1);
    });

    test('asset is removed during upsert when TimelineManager if visibility changes', async () => {
      await timelineManager.updateOptions({
        visibility: AssetVisibility.Archive,
      });
      const fixture = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          visibility: AssetVisibility.Archive,
        }),
      );

      timelineManager.upsertAssets([fixture]);
      expect(timelineManager.assetCount).toEqual(1);

      const updated = Object.freeze({ ...fixture, visibility: AssetVisibility.Timeline });
      timelineManager.upsertAssets([updated]);
      expect(timelineManager.assetCount).toEqual(0);

      timelineManager.upsertAssets([{ ...fixture, visibility: AssetVisibility.Archive }]);
      expect(timelineManager.assetCount).toEqual(1);
    });

    test('asset is removed during upsert when TimelineManager if isFavorite changes', async () => {
      await timelineManager.updateOptions({
        isFavorite: true,
      });
      const fixture = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          isFavorite: true,
        }),
      );

      timelineManager.upsertAssets([fixture]);
      expect(timelineManager.assetCount).toEqual(1);

      const updated = Object.freeze({ ...fixture, isFavorite: false });
      timelineManager.upsertAssets([updated]);
      expect(timelineManager.assetCount).toEqual(0);

      timelineManager.upsertAssets([{ ...fixture, isFavorite: true }]);
      expect(timelineManager.assetCount).toEqual(1);
    });

    test('asset is removed during upsert when TimelineManager if isTrashed changes', async () => {
      await timelineManager.updateOptions({
        isTrashed: true,
      });
      const fixture = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          isTrashed: true,
        }),
      );

      timelineManager.upsertAssets([fixture]);
      expect(timelineManager.assetCount).toEqual(1);

      const updated = Object.freeze({ ...fixture, isTrashed: false });
      timelineManager.upsertAssets([updated]);
      expect(timelineManager.assetCount).toEqual(0);

      timelineManager.upsertAssets([{ ...fixture, isTrashed: true }]);
      expect(timelineManager.assetCount).toEqual(1);
    });
  });

  describe('AssetUpdate events', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 1588, height: 1000 });
      await timelineManager.updateOptions({ albumId: 'album-id' });
    });

    afterEach(() => {
      timelineManager.destroy();
    });

    test('ignores unknown assets for album timelines', () => {
      eventManager.emit('AssetUpdate', factory.asset());

      expect(timelineManager.assetCount).toEqual(0);
      expect(timelineManager.months).toHaveLength(0);
    });

    test('updates existing assets in the timeline', () => {
      const existing = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset({ isFavorite: false }));

      timelineManager.upsertAssets([existing]);
      eventManager.emit(
        'AssetUpdate',
        factory.asset({
          id: existing.id,
          ownerId: existing.ownerId,
          isFavorite: true,
          isTrashed: existing.isTrashed,
          visibility: existing.visibility,
        }),
      );

      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().isFavorite).toEqual(true);
    });
  });

  describe('live event asset insertion', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 1588, height: 1000 });
    });

    afterEach(() => {
      timelineManager.destroy();
    });

    test('does not insert live event assets with a different owner into a user-scoped timeline', async () => {
      await timelineManager.updateOptions({ userId: 'partner-id', visibility: AssetVisibility.Timeline });

      const asset = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          ownerId: 'current-user-id',
          visibility: AssetVisibility.Timeline,
        }),
      );

      timelineManager.upsertAssetsFromLiveEvent([asset]);

      expect(timelineManager.assetCount).toEqual(0);
    });

    test('inserts live event assets for the matching owner into a user-scoped timeline', async () => {
      await timelineManager.updateOptions({ userId: 'partner-id', visibility: AssetVisibility.Timeline });

      const asset = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          ownerId: 'partner-id',
          visibility: AssetVisibility.Timeline,
        }),
      );

      timelineManager.upsertAssetsFromLiveEvent([asset]);

      expect(timelineManager.assetCount).toEqual(1);
    });

    test('does not insert unknown live event assets into album timelines', async () => {
      await timelineManager.updateOptions({ albumId: 'album-id' });

      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset());

      timelineManager.upsertAssetsFromLiveEvent([asset]);

      expect(timelineManager.assetCount).toEqual(0);
    });

    // Gallery: Space-scoped timelines are scoped like upstream's album/person ones. Upstream's
    // guard enumerates only its own scope options, so these two cases pin the fork's scopes.
    test('does not insert unknown live event assets into Space timelines', async () => {
      await timelineManager.updateOptions({ spaceId: 'space-id' });

      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset());

      timelineManager.upsertAssetsFromLiveEvent([asset]);

      expect(timelineManager.assetCount).toEqual(0);
    });

    test('does not insert unknown live event assets into Space album timelines', async () => {
      await timelineManager.updateOptions({ timelineSpaceId: 'space-id' });

      const asset = deriveLocalDateTimeFromFileCreatedAt(factory.timelineAsset());

      timelineManager.upsertAssetsFromLiveEvent([asset]);

      expect(timelineManager.assetCount).toEqual(0);
    });

    test('updates existing live event assets in scoped timelines', async () => {
      await timelineManager.updateOptions({ albumId: 'album-id' });

      const asset = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          isFavorite: false,
        }),
      );

      timelineManager.upsertAssets([asset]);
      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().isFavorite).toEqual(false);

      timelineManager.upsertAssetsFromLiveEvent([
        {
          ...asset,
          isFavorite: true,
        },
      ]);

      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months[0].getFirstAsset().isFavorite).toEqual(true);
    });
  });

  describe('removeAssets', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 1588, height: 1000 });
    });

    test('ignores invalid IDs', () => {
      timelineManager.upsertAssets(
        factory
          .many(2, () =>
            factory.timelineAsset({
              fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
            }),
          )
          .map((asset) => deriveLocalDateTimeFromFileCreatedAt(asset)),
      );
      timelineManager.removeAssets(['', 'invalid', '4c7d9acc']);

      expect(timelineManager.assetCount).toEqual(2);
      expect(timelineManager.months.length).toEqual(1);
      expect(timelineManager.months[0].getAssets().length).toEqual(2);
    });

    test('removes asset from month', () => {
      const [assetOne, assetTwo] = factory
        .many(2, () =>
          factory.timelineAsset({
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
          }),
        )
        .map((asset) => deriveLocalDateTimeFromFileCreatedAt(asset));
      timelineManager.upsertAssets([assetOne, assetTwo]);
      timelineManager.removeAssets([assetOne.id]);

      expect(timelineManager.assetCount).toEqual(1);
      expect(timelineManager.months.length).toEqual(1);
      expect(timelineManager.months[0].getAssets().length).toEqual(1);
    });

    test('does not remove month when empty', () => {
      const assets = factory
        .many(2, () =>
          factory.timelineAsset({
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
          }),
        )
        .map((asset) => deriveLocalDateTimeFromFileCreatedAt(asset));
      timelineManager.upsertAssets(assets);
      timelineManager.removeAssets(assets.map((asset) => asset.id));

      expect(timelineManager.assetCount).toEqual(0);
      expect(timelineManager.months.length).toEqual(1);
    });
  });

  describe('firstAsset', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });
      await timelineManager.updateViewport({ width: 0, height: 0 });
    });

    test('empty store returns null', () => {
      expect(timelineManager.getFirstAsset()).toBeUndefined();
    });

    test('populated store returns first asset', () => {
      const assetOne = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const assetTwo = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-15T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([assetOne, assetTwo]);
      expect(timelineManager.getFirstAsset()).toEqual(assetOne);
    });
  });

  describe('getLaterAsset', () => {
    let timelineManager: TimelineManager;
    const bucketAssets: Record<string, TimelineAsset[]> = {
      '2024-03-01': factory
        .many(1, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-03-01T00:00:00.000Z'),
          }),
        ),
      '2024-02-01': factory
        .many(6, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-02-01T00:00:00.000Z'),
          }),
        ),
      '2024-01-01': factory
        .many(3, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-01T00:00:00.000Z'),
          }),
        ),
    };
    const bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
      Object.entries(bucketAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
    );

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      mockTimeBuckets(
        api,
        [
          { count: 1, timeBucket: '2024-03-01' },
          { count: 6, timeBucket: '2024-02-01' },
          { count: 3, timeBucket: '2024-01-01' },
        ],
        bucketAssetsResponse,
      ).on({ getAssetInfo: () => ({ status: 404 }) });
      await timelineManager.updateViewport({ width: 1588, height: 1000 });
    });

    test('returns null for invalid assetId', async () => {
      expect(() => timelineManager.getLaterAsset({ id: 'invalid' } as AssetResponseDto)).not.toThrow();
      expect(await timelineManager.getLaterAsset({ id: 'invalid' } as AssetResponseDto)).toBeUndefined();
    });

    test('returns previous assetId', async () => {
      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 1 });

      const a = month!.getAssets()[0];
      const b = month!.getAssets()[1];
      const previous = await timelineManager.getLaterAsset(b);
      expect(previous).toEqual(a);
    });

    test('returns previous assetId spanning multiple months', async () => {
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 3 });

      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 2 });
      const previousMonth = getTimelineMonthByDate(timelineManager, { year: 2024, month: 3 });
      const a = month!.getAssets()[0];
      const b = previousMonth!.getAssets()[0];
      const previous = await timelineManager.getLaterAsset(a);
      expect(previous).toEqual(b);
    });

    test('loads previous month', async () => {
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });
      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 2 });
      const previousMonth = getTimelineMonthByDate(timelineManager, { year: 2024, month: 3 });
      const a = month!.getFirstAsset();
      const b = previousMonth!.getFirstAsset();
      const loadTimelineMonthSpy = vi.spyOn(month!.loader!, 'execute');
      const previousMonthSpy = vi.spyOn(previousMonth!.loader!, 'execute');
      const previous = await timelineManager.getLaterAsset(a);
      expect(previous).toEqual(b);
      expect(loadTimelineMonthSpy).not.toHaveBeenCalled();
      expect(previousMonthSpy).not.toHaveBeenCalled();
    });

    test('skips removed assets', async () => {
      await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 3 });

      const [assetOne, assetTwo, assetThree] = await getAssets(timelineManager);
      timelineManager.removeAssets([assetTwo.id]);
      expect(await timelineManager.getLaterAsset(assetThree)).toEqual(assetOne);
    });

    test('returns null when no more assets', async () => {
      await timelineManager.loadTimelineMonth({ year: 2024, month: 3 });
      expect(await timelineManager.getLaterAsset(timelineManager.months[0].getFirstAsset())).toBeUndefined();
    });
  });

  describe('getTimelineMonthIndexByAssetId', () => {
    let timelineManager: TimelineManager;

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });

      await timelineManager.updateViewport({ width: 0, height: 0 });
    });

    test('returns null for invalid months', () => {
      expect(getTimelineMonthByDate(timelineManager, { year: -1, month: -1 })).toBeUndefined();
      expect(getTimelineMonthByDate(timelineManager, { year: 2024, month: 3 })).toBeUndefined();
    });

    test('returns the month index', () => {
      const assetOne = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const assetTwo = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-02-15T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([assetOne, assetTwo]);

      expect(timelineManager.getTimelineMonthByAssetId(assetTwo.id)?.yearMonth.year).toEqual(2024);
      expect(timelineManager.getTimelineMonthByAssetId(assetTwo.id)?.yearMonth.month).toEqual(2);
      expect(timelineManager.getTimelineMonthByAssetId(assetOne.id)?.yearMonth.year).toEqual(2024);
      expect(timelineManager.getTimelineMonthByAssetId(assetOne.id)?.yearMonth.month).toEqual(1);
    });

    test('ignores removed months', () => {
      const assetOne = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
        }),
      );
      const assetTwo = deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({
          fileCreatedAt: fromISODateTimeUTCToObject('2024-02-15T12:00:00.000Z'),
        }),
      );
      timelineManager.upsertAssets([assetOne, assetTwo]);

      timelineManager.removeAssets([assetTwo.id]);
      expect(timelineManager.getTimelineMonthByAssetId(assetOne.id)?.yearMonth.year).toEqual(2024);
      expect(timelineManager.getTimelineMonthByAssetId(assetOne.id)?.yearMonth.month).toEqual(1);
    });
  });

  describe('getRandomAsset', () => {
    let timelineManager: TimelineManager;
    const bucketAssets: Record<string, TimelineAsset[]> = {
      '2024-03-01': factory
        .many(1, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-03-01T00:00:00.000Z'),
          }),
        ),
      '2024-02-01': factory
        .many(10, () => factory.timelineAsset())
        .map((asset, idx) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            // here we make sure that not all assets are on the first day of the month
            fileCreatedAt: fromISODateTimeUTCToObject(`2024-02-0${idx < 7 ? 1 : 2}T00:00:00.000Z`),
          }),
        ),
      '2024-01-01': factory
        .many(3, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            fileCreatedAt: fromISODateTimeUTCToObject('2024-01-01T00:00:00.000Z'),
          }),
        ),
    };

    const bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
      Object.entries(bucketAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
    );

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      mockTimeBuckets(
        api,
        [
          { count: 1, timeBucket: '2024-03-01' },
          { count: 10, timeBucket: '2024-02-01' },
          { count: 3, timeBucket: '2024-01-01' },
        ],
        bucketAssetsResponse,
      );
      await timelineManager.updateViewport({ width: 1588, height: 0 });
    });

    test('gets all assets once', async () => {
      const assetCount = timelineManager.assetCount;
      expect(assetCount).toBe(14);
      const discoveredAssets: Set<string> = new Set();
      for (let idx = 0; idx < assetCount; idx++) {
        const asset = await timelineManager.getRandomAsset(idx);
        expect(asset).toBeDefined();
        const id = asset!.id;
        expect(discoveredAssets.has(id)).toBeFalsy();
        discoveredAssets.add(id);
      }

      expect(discoveredAssets.size).toBe(assetCount);
    });
  });

  describe('showAssetOwners', () => {
    const LS_KEY = 'album-show-asset-owners';

    beforeEach(() => {
      // ensure clean state
      globalThis.localStorage?.removeItem(LS_KEY);
    });

    test('persists across instances via localStorage', () => {
      const a = new TimelineManager();
      a.setShowAssetOwners(true);
      const b = new TimelineManager();
      expect(b.showAssetOwners).toBe(true);
    });
  });

  describe('retrieveRange', () => {
    test('uses createdAt ordering in the Recently Added view (orderBy=CreatedAt)', async ({ api }) => {
      // Simulate the "Recently Added" bug: two assets whose localDateTime order is
      // the reverse of their createdAt (upload) order. Before the fix, retrieveRange
      // compared localDateTime and selected the wrong range direction.
      const timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });
      await timelineManager.updateOptions({ orderBy: AssetOrderBy.CreatedAt });

      // assetA was taken recently (2024) but uploaded first (2025-01)
      const assetA = factory.timelineAsset({
        localDateTime: fromISODateTimeUTCToObject('2024-06-01T00:00:00.000Z'),
        createdAt: fromISODateTimeUTCToObject('2025-01-20T00:00:00.000Z'),
        fileCreatedAt: fromISODateTimeUTCToObject('2025-01-20T00:00:00.000Z'),
      });
      // assetB was taken long ago (2018) but uploaded second (2025-02)
      const assetB = factory.timelineAsset({
        localDateTime: fromISODateTimeUTCToObject('2018-03-15T00:00:00.000Z'),
        createdAt: fromISODateTimeUTCToObject('2025-02-10T00:00:00.000Z'),
        fileCreatedAt: fromISODateTimeUTCToObject('2025-02-10T00:00:00.000Z'),
      });
      // assetC is an unrelated asset that should not appear in the selection
      const assetC = factory.timelineAsset({
        localDateTime: fromISODateTimeUTCToObject('2022-01-01T00:00:00.000Z'),
        createdAt: fromISODateTimeUTCToObject('2025-03-01T00:00:00.000Z'),
        fileCreatedAt: fromISODateTimeUTCToObject('2025-03-01T00:00:00.000Z'),
      });

      timelineManager.upsertAssets([assetA, assetB, assetC]);

      // Shift-click from assetB (uploaded most recently) to assetA — the range
      // between them in the "Recently Added" timeline should contain only those two.
      const range = await timelineManager.retrieveRange({ id: assetB.id }, { id: assetA.id });
      const ids = range.map((a) => a.id);
      expect(ids).toContain(assetA.id);
      expect(ids).toContain(assetB.id);
      expect(ids).not.toContain(assetC.id);
    });
  });

  describe('space timeline with stacked photos', () => {
    let timelineManager: TimelineManager;
    const stackedAssets: Record<string, TimelineAsset[]> = {
      '2024-02-01': [
        deriveLocalDateTimeFromFileCreatedAt(
          factory.timelineAsset({
            fileCreatedAt: fromISODateTimeUTCToObject('2024-02-10T12:00:00.000Z'),
            stack: { id: 'stack-1', primaryAssetId: 'primary-1', assetCount: 3 },
          }),
        ),
        deriveLocalDateTimeFromFileCreatedAt(
          factory.timelineAsset({
            fileCreatedAt: fromISODateTimeUTCToObject('2024-02-05T12:00:00.000Z'),
            stack: null,
          }),
        ),
      ],
    };
    const stackedAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
      Object.entries(stackedAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
    );

    beforeEach<Context>(({ api }) => {
      timelineManager = new TimelineManager();
      mockTimeBuckets(api, [{ count: 2, timeBucket: '2024-02-01' }], stackedAssetsResponse);
    });

    test('passes spaceId and withStacked to getTimeBuckets', async ({ api }) => {
      await timelineManager.updateOptions({ spaceId: 'space-1', withStacked: true });
      await timelineManager.updateViewport({ width: 1588, height: 0 });

      expect(api.getTimeBuckets).toHaveBeenCalledWith({
        params: expect.objectContaining({ bucketSize: TimeBucketSize.Day, spaceId: 'space-1', withStacked: true }),
      });
    });

    test('passes spaceId and withStacked to getTimeBucket when loading a month', async ({ api }) => {
      await timelineManager.updateOptions({ spaceId: 'space-1', withStacked: true });
      await timelineManager.updateViewport({ width: 1588, height: 0 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });

      expect(api.getTimeBucket).toHaveBeenCalledWith({
        params: expect.objectContaining({ bucketSize: TimeBucketSize.Month, spaceId: 'space-1', withStacked: true }),
      });
    });

    test('loads stacked assets with stack data preserved', async () => {
      await timelineManager.updateOptions({ spaceId: 'space-1', withStacked: true });
      await timelineManager.updateViewport({ width: 1588, height: 0 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });

      const month = getTimelineMonthByDate(timelineManager, { year: 2024, month: 2 });
      expect(month).not.toBeUndefined();
      const assets = month!.getAssets();
      expect(assets.length).toEqual(2);

      const stackedAsset = assets.find((a: TimelineAsset) => a.stack !== null);
      expect(stackedAsset).toBeDefined();
      expect(stackedAsset!.stack!.assetCount).toEqual(3);

      const nonStackedAsset = assets.find((a: TimelineAsset) => a.stack === null);
      expect(nonStackedAsset).toBeDefined();
    });

    test('does not connect websocket events for space timelines', async () => {
      const connectSpy = vi.spyOn(timelineManager, 'connect');
      await timelineManager.updateOptions({ spaceId: 'space-1', withStacked: true });
      await timelineManager.updateViewport({ width: 1588, height: 1000 });

      expect(connectSpy).not.toHaveBeenCalled();
    });

    test('does not pass withStacked when it is not set in options', async ({ api }) => {
      await timelineManager.updateOptions({ spaceId: 'space-1' });
      await timelineManager.updateViewport({ width: 1588, height: 0 });

      expect(api.getTimeBuckets.calls).toHaveLength(1);
      const [calledWith] = api.getTimeBuckets.calls;
      expect(calledWith.params).toEqual(
        expect.objectContaining({ bucketSize: TimeBucketSize.Day, spaceId: 'space-1' }),
      );
      expect(calledWith.params?.withStacked).toBeUndefined();
    });
  });

  describe('album timeline with stacked photos', () => {
    let timelineManager: TimelineManager;
    const albumMember = () =>
      deriveLocalDateTimeFromFileCreatedAt(
        factory.timelineAsset({ fileCreatedAt: fromISODateTimeUTCToObject('2024-02-10T12:00:00.000Z') }),
      );
    const stackOf = (...assets: AssetResponseDto[]) => ({
      id: 'stack-1',
      primaryAssetId: assets[0].id,
      assets,
    });

    beforeEach<Context>(async ({ api }) => {
      timelineManager = new TimelineManager();
      api.on({ getTimeBuckets: () => ({ json: [] }) });
      await timelineManager.updateViewport({ width: 1588, height: 1000 });
      await timelineManager.updateOptions({ albumId: 'album-1', withStacked: true });
    });

    afterEach(() => {
      timelineManager.destroy();
    });

    // The server picks which album member stands for a stack, so the album reloads rather than patching locally.
    test.for(['StackCreate', 'StackUpdate'] as const)('reloads the album on %s', async (event, { api, settle }) => {
      const member = albumMember();
      timelineManager.upsertAssets([member]);
      const reloads = api.getTimeBuckets.calls.length;

      eventManager.emit(event, stackOf(factory.asset({ id: member.id }), factory.asset()));
      await settle();

      expect(api.getTimeBuckets.calls).toHaveLength(reloads + 1);
      expect(api.getTimeBuckets.calls.at(-1)?.params).toEqual(
        expect.objectContaining({ albumId: 'album-1', withStacked: true }),
      );
    });

    test('does not insert stack members the album does not hold on StackDelete', async ({ api, settle }) => {
      const outsider = factory.asset();
      const reloads = api.getTimeBuckets.calls.length;

      eventManager.emit('StackDelete', { id: 'stack-1', assets: [outsider] });
      await settle();

      expect(api.getTimeBuckets.calls).toHaveLength(reloads + 1);
      expect(timelineManager.getTimelineMonthByAssetId(outsider.id)).toBeUndefined();
    });

    // Removing (from the album, or to the trash) the photo that stands for a stack: a stack-mate may take its place.
    test('reloads the album when a removed photo stood for a stack, and only then', async ({ api, settle }) => {
      const stacked = { ...albumMember(), stack: { id: 'stack-1', primaryAssetId: 'p', assetCount: 3 } };
      const plain = albumMember();
      timelineManager.upsertAssets([stacked, plain]);
      const reloads = api.getTimeBuckets.calls.length;

      timelineManager.removeAssets([plain.id]);
      await settle();
      expect(api.getTimeBuckets.calls).toHaveLength(reloads);

      eventManager.emit('AlbumRemoveAssets', { assetIds: [stacked.id], albumIds: ['album-1'] });
      await settle();
      expect(api.getTimeBuckets.calls).toHaveLength(reloads + 1);
    });

    // The manager's own listener and the album page's AlbumStackEvents both fire for one event (Safari can miss the
    // former): one reload, and the page's options effect during it does not start another.
    test('runs one reload for triggers in the same task, and keeps its options while reloading', async ({
      api,
      settle,
    }) => {
      const reloads = api.getTimeBuckets.calls.length;

      expect(timelineManager.reloadAlbumStacks()).toBe(true);
      expect(timelineManager.reloadAlbumStacks()).toBe(true);
      eventManager.emit('AlbumAddAssets', { assetIds: ['a'], albumIds: ['album-1'] });
      await timelineManager.updateOptions({ albumId: 'album-1', withStacked: true });
      await settle();

      expect(api.getTimeBuckets.calls).toHaveLength(reloads + 1);
    });

    // Adding a photo (say the stack's primary, from the viewer's strip) can change which stack-mate shows.
    test('reloads the album when photos are added to it, not to another album', async ({ api, settle }) => {
      const reloads = api.getTimeBuckets.calls.length;

      eventManager.emit('AlbumAddAssets', { assetIds: ['a'], albumIds: ['other-album'] });
      await settle();
      expect(api.getTimeBuckets.calls).toHaveLength(reloads);

      eventManager.emit('AlbumAddAssets', { assetIds: ['a'], albumIds: ['album-1'] });
      await settle();
      expect(api.getTimeBuckets.calls).toHaveLength(reloads + 1);
    });
  });

  describe('album picker timeline', () => {
    let timelineManager: TimelineManager;
    const pickerOnlyAssets: Record<string, TimelineAsset[]> = {
      '2024-02-01': factory
        .many(1, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            id: 'picker-asset',
            fileCreatedAt: fromISODateTimeUTCToObject('2024-02-10T12:00:00.000Z'),
          }),
        ),
    };
    const albumOnlyAssets: Record<string, TimelineAsset[]> = {
      '2024-04-01': factory
        .many(1, () => factory.timelineAsset())
        .map((asset) =>
          deriveLocalDateTimeFromFileCreatedAt({
            ...asset,
            id: 'album-asset',
            fileCreatedAt: fromISODateTimeUTCToObject('2024-04-10T12:00:00.000Z'),
          }),
        ),
    };
    const emptyBucket = toResponseDto();
    const pickerOnlyResponses: Record<string, TimeBucketAssetResponseDto> = {
      '2024-02-01': toResponseDto(...pickerOnlyAssets['2024-02-01']),
      '2024-04-01': emptyBucket,
    };
    const albumOnlyResponses: Record<string, TimeBucketAssetResponseDto> = {
      '2024-02-01': emptyBucket,
      '2024-04-01': toResponseDto(...albumOnlyAssets['2024-04-01']),
    };

    beforeEach<Context>(({ api }) => {
      timelineManager = new TimelineManager();
      api.on({
        getTimeBuckets: ({ params = {} }) => ({
          json: params.albumId ? [{ count: 1, timeBucket: '2024-04-01' }] : [{ count: 1, timeBucket: '2024-02-01' }],
        }),
        getTimeBucket: ({ params }) => ({
          json: params.albumId ? albumOnlyResponses[params.timeBucket] : pickerOnlyResponses[params.timeBucket],
        }),
      });
    });

    test('unions filtered album months into picker timelines and marks them disabled', async ({ api }) => {
      await timelineManager.updateOptions({
        tagIds: ['tag-1'],
        timelineAlbumId: 'album-1',
        visibility: AssetVisibility.Timeline,
        withPartners: true,
      });
      await timelineManager.updateViewport({ width: 1588, height: 0 });

      expect(timelineManager.months.map((month) => month.viewId)).toEqual(['2024-4', '2024-2']);

      await timelineManager.loadTimelineMonth({ year: 2024, month: 4 });
      await timelineManager.loadTimelineMonth({ year: 2024, month: 2 });

      const loadedAssets = await getAssets(timelineManager);
      expect(loadedAssets.map((asset) => asset.id)).toEqual(['album-asset', 'picker-asset']);
      expect(timelineManager.albumAssets.has('album-asset')).toBe(true);
      expect(timelineManager.assetCount).toBe(2);
      expect(api.getTimeBuckets).toHaveBeenCalledWith({
        params: expect.objectContaining({
          albumId: 'album-1',
          bucketSize: TimeBucketSize.Day,
          tagIds: ['tag-1'],
          visibility: AssetVisibility.Timeline,
        }),
      });
      expect(api.getTimeBucket).toHaveBeenCalledWith({
        params: expect.objectContaining({
          albumId: 'album-1',
          bucketSize: TimeBucketSize.Month,
          tagIds: ['tag-1'],
          timeBucket: '2024-04-01',
        }),
      });
    });
  });

  describe('orderBy createdAt (recently-added)', () => {
    test('places assets into the createdAt month even when their localDateTime is a different month', async ({
      api,
      settle,
    }) => {
      const timelineManager = new TimelineManager();
      // "Recently added": assets created (added to Immich) in 2026-06 but TAKEN
      // (localDateTime) back in 2024-09 — exactly the staging /recently-added case.
      const assets = factory
        .many(3, () => factory.timelineAsset())
        .map((asset) => ({
          ...asset,
          createdAt: fromISODateTimeUTCToObject('2026-06-15T12:00:00.000Z'),
          localDateTime: fromISODateTimeUTCToObject('2024-09-23T18:00:00.000Z'),
          fileCreatedAt: fromISODateTimeUTCToObject('2024-09-23T18:00:00.000Z'),
        }));
      const response = toResponseDto(...assets);

      api.on({
        getTimeBuckets: () => ({ json: [{ count: 3, timeBucket: '2026-06-01' }] }),
        getTimeBucket: () => ({ json: response }),
      });

      await timelineManager.updateOptions({ orderBy: AssetOrderBy.CreatedAt });
      await timelineManager.updateViewport({ width: 1588, height: 1000 });
      await settle();

      // The month's assets land a few tasks after its request settles.
      await expect
        .poll(() => getTimelineMonthByDate(timelineManager, { year: 2026, month: 6 })?.getAssets().length)
        .toEqual(3);
    });

    test('buckets createdAt by its UTC month, not the browser-local month (boundary assets in a negative-offset timezone)', async ({
      api,
      settle,
    }) => {
      // The server groups time buckets by date_trunc('MONTH', createdAt AT TIME ZONE 'UTC')
      // and serializes createdAt as a naive-UTC string (e.g. a bulk import at
      // 2026-06-01T03:00). A viewer whose timezone is behind UTC must still see those
      // assets in the June bucket — otherwise the whole /recently-added page renders empty.
      // The browser runs in UTC for tests, so force luxon's local zone to a negative-offset one here.
      const previousZone = Settings.defaultZone;
      Settings.defaultZone = 'America/Anchorage';
      try {
        const timelineManager = new TimelineManager();
        const assets = factory
          .many(3, () => factory.timelineAsset())
          .map((asset) => ({
            ...asset,
            localDateTime: fromISODateTimeUTCToObject('2024-09-23T18:00:00.000Z'),
            fileCreatedAt: fromISODateTimeUTCToObject('2024-09-23T18:00:00.000Z'),
          }));
        const response = toResponseDto(...assets);
        // Exactly the server's naive-UTC createdAt format (03:00 UTC on the 1st).
        response.createdAt = response.createdAt.map(() => '2026-06-01T03:00:00.000');

        api.on({
          getTimeBuckets: () => ({ json: [{ count: 3, timeBucket: '2026-06-01' }] }),
          getTimeBucket: () => ({ json: response }),
        });

        await timelineManager.updateOptions({ orderBy: AssetOrderBy.CreatedAt });
        await timelineManager.updateViewport({ width: 1588, height: 1000 });
        await settle();

        // The month's assets land a few tasks after its request settles.
        await expect
          .poll(() => getTimelineMonthByDate(timelineManager, { year: 2026, month: 6 })?.getAssets().length)
          .toEqual(3);
      } finally {
        Settings.defaultZone = previousZone;
      }
    });
  });
});

describe('TimelineManager scroll scaling', () => {
  let timelineManager: TimelineManager;
  let fakeEl: { scrollTop: number; scrollTo: (o: { top: number }) => void };

  function deriveLocalDateTime(arg: TimelineAsset): TimelineAsset {
    return { ...arg, localDateTime: arg.fileCreatedAt };
  }

  const bucketAssets: Record<string, TimelineAsset[]> = {
    '2024-03-01': factory
      .many(1, () => factory.timelineAsset())
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-03-01T00:00:00.000Z') }),
      ),
    '2024-02-01': factory
      .many(100, () => factory.timelineAsset())
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-02-01T00:00:00.000Z') }),
      ),
    '2024-01-01': factory
      .many(3, () => factory.timelineAsset())
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-01-01T00:00:00.000Z') }),
      ),
  };
  const bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
    Object.entries(bucketAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
  );

  beforeEach<Context>(async ({ api }) => {
    timelineManager = new TimelineManager();
    mockTimeBuckets(
      api,
      [
        { count: 1, timeBucket: '2024-03-01' },
        { count: 100, timeBucket: '2024-02-01' },
        { count: 3, timeBucket: '2024-01-01' },
      ],
      bucketAssetsResponse,
    );
    await timelineManager.updateViewport({ width: 1588, height: 1000 });
    await tick();

    fakeEl = {
      scrollTop: 0,
      scrollTo({ top }: { top: number }) {
        fakeEl.scrollTop = top; // manager already clamped; store verbatim
      },
    };
    timelineManager.scrollableElement = fakeEl as unknown as HTMLElement;
  });

  test('9. is inert below the cap', () => {
    // totalViewerHeight == 8337, viewport == 1000, default cap is huge
    expect(timelineManager.domHeight).toBe(timelineManager.totalViewerHeight);
    expect(timelineManager.scrollScale).toBe(1);
    timelineManager.scrollTo(1000);
    expect(fakeEl.scrollTop).toBe(1000);
    expect(timelineManager.scrollTop).toBe(1000);
    expect(timelineManager.renderOffset).toBe(0);
  });

  test('10. reaches the tail under forced scaling (symptom #1)', () => {
    timelineManager.maxScrollHeight = 4000; // domHeight 4000, domScrollMax 3000, logicalScrollMax 7337
    timelineManager.scrollTo(timelineManager.maxScroll); // 7337
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // 3000
    expect(timelineManager.scrollTop).toBeCloseTo(timelineManager.maxScroll, 6); // 7337
  });

  test('11. clamps scrollTo to [0, domScrollMax]', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(10 * timelineManager.totalViewerHeight);
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // clamped to bottom
    timelineManager.scrollTo(0); // top reachable (spec edge #11)
    expect(fakeEl.scrollTop).toBe(0);
    timelineManager.scrollTo(-5000); // negative clamped to 0
    expect(fakeEl.scrollTop).toBe(0);
  });

  test('12. scrollBy moves the logical position by the given delta', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(2000);
    timelineManager.scrollBy(1000);
    expect(timelineManager.scrollTop).toBeCloseTo(3000, 6);
  });

  test('13. exposes a logical scrollTop end-to-end', () => {
    timelineManager.maxScrollHeight = 4000;
    fakeEl.scrollTop = timelineManager.domScrollMax; // 3000 (raw DOM)
    timelineManager.updateSlidingWindow();
    expect(timelineManager.scrollTop).toBeCloseTo(timelineManager.maxScroll, 6); // 7337
    expect(timelineManager.visibleWindow.top).toBeCloseTo(timelineManager.maxScroll, 6);
  });

  test('14. scrollBy preserves the logical delta the height compensation relies on', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(1500);
    const before = timelineManager.scrollTop;
    timelineManager.scrollBy(500); // mirrors month.height setter compensation
    expect(timelineManager.scrollTop - before).toBeCloseTo(500, 6);
  });

  test('15. preserves a deep anchor across Years/Months → All (symptom #2)', () => {
    timelineManager.maxScrollHeight = 4000;
    const reached = scrollTimelineToTemporalAnchor(timelineManager, { year: 2024, month: 1 });
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // 3000, reachable — not clamped short
    expect(reached).toBe(true);
  });

  test('16. re-derives the DOM↔logical mapping on a geometry change so renderOffset never goes stale', () => {
    timelineManager.maxScrollHeight = 4000; // force scaling: domScrollMax 3000, logicalScrollMax 7337
    timelineManager.scrollTo(2000); // logical; DOM scrollTop is now well below the logical position
    // Invariant after any scroll: renderOffset === domScrollTop − logicalScrollTop.
    expect(timelineManager.renderOffset).toBeCloseTo(fakeEl.scrollTop - timelineManager.scrollTop, 6);

    // A viewport resize changes the scale WITHOUT a scroll event. The cached logical position must be
    // re-derived under the new scale, otherwise the next scroll teleports the timeline by the drift.
    timelineManager.viewportHeight = 500; // was 1000

    expect(timelineManager.renderOffset).toBeCloseTo(fakeEl.scrollTop - timelineManager.scrollTop, 6);
  });
});
