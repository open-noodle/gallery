import { TimeBucketSize } from '@immich/sdk';
import { describe, expect, it } from 'vitest';

import type { Changes } from './rest-response';
import { getTimeBuckets } from './rest-response';

const changes: Changes = {
  albumAdditions: [],
  assetDeletions: [],
  assetArchivals: [],
  assetFavorites: [],
};

describe('timeline e2e rest response bucket grouping', () => {
  it('aggregates mock buckets by year with representative metadata', () => {
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

    expect(getTimeBuckets(data, undefined, undefined, undefined, undefined, changes, TimeBucketSize.Year)).toEqual([
      {
        timeBucket: '2015-01-01',
        count: 3,
        representativeAssetId: 'asset-1',
        representativeThumbhash: 'thumb-1',
        representativeRatio: 1.5,
      },
    ]);
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
    ).toEqual([
      {
        timeBucket: '2015-08-01',
        count: 1,
        representativeAssetId: 'asset-1',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]);
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
    ).toEqual([
      {
        timeBucket: '2015-12-01',
        count: 1,
        representativeAssetId: 'asset-1',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]);
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
      {
        timeBucket: '2016-01-01',
        count: 1,
        representativeAssetId: 'asset-3',
        representativeThumbhash: null,
        representativeRatio: 1.25,
      },
      {
        timeBucket: '2015-01-01',
        count: 1,
        representativeAssetId: 'asset-1',
        representativeThumbhash: null,
        representativeRatio: 1,
      },
    ]);
  });
});
