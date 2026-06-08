import { TimeBucketSize } from '@immich/sdk';
import { describe, expect, it } from 'vitest';

import type { Changes } from './rest-response';
import { getTimeBucketCovers, getTimeBuckets } from './rest-response';

const changes: Changes = {
  albumAdditions: [],
  assetDeletions: [],
  assetArchivals: [],
  assetFavorites: [],
};

describe('timeline e2e rest response bucket grouping', () => {
  it('aggregates mock buckets by year — counts only, no representative fields', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            {
              id: 'asset-1',
              thumbhash: 'thumb-1',
              ratio: 1.5,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
            { id: 'asset-2', thumbhash: null, ratio: 0.8, isTrashed: false, visibility: 'timeline', isFavorite: false },
          ],
        ],
        [
          '2015-09',
          [
            {
              id: 'asset-3',
              thumbhash: 'thumb-3',
              ratio: 1,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
          ],
        ],
      ]),
    } as never;

    const result = getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Year);
    expect(result).toEqual([{ timeBucket: '2015-01-01', count: 3 }]);
    expect(result[0]).not.toHaveProperty('representativeAssetId');
    expect(result[0]).not.toHaveProperty('representativeThumbhash');
    expect(result[0]).not.toHaveProperty('representativeRatio');
  });

  it('filters mock buckets by selected temporal range before aggregating by month', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [{ id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
        [
          '2016-01',
          [{ id: 'asset-2', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    expect(
      getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Month, {
        takenAfter: '2015-01-01',
        takenBefore: '2015-12-31',
      }),
    ).toEqual([{ timeBucket: '2015-08-01', count: 1 }]);
  });

  it('treats takenBefore as an exclusive temporal boundary', () => {
    const data = {
      buckets: new Map([
        [
          '2015-12',
          [{ id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
        [
          '2016-01',
          [{ id: 'asset-2', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    expect(
      getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Month, {
        takenAfter: '2015-01-01T00:00:00.000Z',
        takenBefore: '2016-01-01T00:00:00.000Z',
      }),
    ).toEqual([{ timeBucket: '2015-12-01', count: 1 }]);
  });

  it('applies asset filters before aggregation and sorts buckets newest first', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            { id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: true },
            { id: 'asset-2', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false },
          ],
        ],
        [
          '2016-01',
          [{ id: 'asset-3', thumbhash: null, ratio: 1.25, isTrashed: false, visibility: 'timeline', isFavorite: true }],
        ],
      ]),
    } as never;

    expect(getTimeBuckets(data, undefined, undefined, true, undefined, changes, TimeBucketSize.Year)).toEqual([
      { timeBucket: '2016-01-01', count: 1 },
      { timeBucket: '2015-01-01', count: 1 },
    ]);
  });
});

describe('getTimeBucketCovers', () => {
  it('returns representative metadata for requested buckets — picks first asset per bucket', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            {
              id: 'asset-1',
              thumbhash: 'thumb-1',
              ratio: 1.5,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
            { id: 'asset-2', thumbhash: null, ratio: 0.8, isTrashed: false, visibility: 'timeline', isFavorite: false },
          ],
        ],
        [
          '2015-09',
          [
            {
              id: 'asset-3',
              thumbhash: 'thumb-3',
              ratio: 1,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
          ],
        ],
        [
          '2016-06',
          [{ id: 'asset-4', thumbhash: null, ratio: 1.2, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    // Request covers only for 2015-08 and 2015-09
    const covers = getTimeBucketCovers(data, changes, TimeBucketSize.Year, ['2015-01-01']);
    expect(covers).toEqual([
      {
        timeBucket: '2015-01-01',
        representativeAssetId: 'asset-1',
        representativeThumbhash: 'thumb-1',
        representativeRatio: 1.5,
      },
    ]);
  });

  it('returns an empty array when no requested buckets match', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [{ id: 'asset-1', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    expect(getTimeBucketCovers(data, changes, TimeBucketSize.Year, ['2020-01-01'])).toEqual([]);
    expect(getTimeBucketCovers(data, changes, TimeBucketSize.Year, [])).toEqual([]);
  });

  it('returns month-level covers when bucketSize is month', () => {
    const data = {
      buckets: new Map([
        [
          '2015-08',
          [
            {
              id: 'aug-asset',
              thumbhash: 'aug-thumb',
              ratio: 2,
              isTrashed: false,
              visibility: 'timeline',
              isFavorite: false,
            },
          ],
        ],
        [
          '2015-09',
          [{ id: 'sep-asset', thumbhash: null, ratio: 1, isTrashed: false, visibility: 'timeline', isFavorite: false }],
        ],
      ]),
    } as never;

    const covers = getTimeBucketCovers(data, changes, TimeBucketSize.Month, ['2015-08-01', '2015-09-01']);
    expect(covers).toHaveLength(2);
    expect(covers.find((c) => c.timeBucket === '2015-08-01')).toEqual({
      timeBucket: '2015-08-01',
      representativeAssetId: 'aug-asset',
      representativeThumbhash: 'aug-thumb',
      representativeRatio: 2,
    });
    expect(covers.find((c) => c.timeBucket === '2015-09-01')).toEqual({
      timeBucket: '2015-09-01',
      representativeAssetId: 'sep-asset',
      representativeThumbhash: null,
      representativeRatio: 1,
    });
  });
});
