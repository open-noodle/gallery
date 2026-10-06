import { Kysely } from 'kysely';
import { AssetVisibility, TimeBucketSize } from 'src/enum.js';
import { AssetRepository, TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { FilterSuggestionsOptions, SearchRepository } from 'src/repositories/search.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { AssetFilter } from 'src/utils/asset-filter.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

/**
 * One filter, one asset set: the timeline, the filter-suggestion universe, the smart-search facets,
 * the filtered map and search results (smart and metadata) must agree on which assets a filter-panel
 * filter matches (src/utils/asset-filter.ts). Tag suggestions and the space people lists route their
 * taken range through the same module; their own medium specs cover them.
 */
let defaultDatabase: Kysely<DB>;
const embedding = `[${Array.from({ length: 512 }, () => '0.01').join(',')}]`;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AssetRepository, SearchRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  const { user } = await ctx.newUser();

  type Exif = {
    country: string | null;
    state: string | null;
    city: string | null;
    make: string;
    model: string;
    lensModel?: string;
    rating: number | null;
  };
  const add = async (localDateTime: string, fileCreatedAt: string, exif: Exif) => {
    const { asset } = await ctx.newAsset({
      ownerId: user.id,
      localDateTime: new Date(localDateTime),
      fileCreatedAt: new Date(fileCreatedAt),
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newExif({ assetId: asset.id, latitude: 1, longitude: 1, ...exif });
    await ctx.database.insertInto('smart_search').values({ assetId: asset.id, embedding }).execute();
    return asset.id;
  };

  const ids = {
    // Taken Jan 1 05:00 at UTC+10: January by the timeline's localDateTime, December 31 by fileCreatedAt.
    newYearSydney: await add('2024-01-01T05:00:00Z', '2023-12-31T19:00:00Z', {
      country: 'Australia',
      state: 'NSW',
      city: 'Sydney',
      make: 'Canon',
      model: 'R5',
      lensModel: 'RF50',
      rating: 5,
    }),
    midJanuary: await add('2024-01-15T12:00:00Z', '2024-01-15T12:00:00Z', {
      country: null,
      state: null,
      city: null,
      make: 'Nikon',
      model: 'Z6',
      rating: 3,
    }),
    // Exactly the exclusive upper bound the clients send for January.
    februaryMidnight: await add('2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z', {
      country: 'France',
      state: 'IDF',
      city: 'Paris',
      make: 'Nikon',
      model: 'Z6',
      rating: null,
    }),
    december: await add('2023-12-20T12:00:00Z', '2023-12-20T12:00:00Z', {
      country: 'France',
      state: 'IDF',
      city: 'Paris',
      make: 'Canon',
      model: 'R5',
      rating: 1,
    }),
  };

  const auth = factory.auth({ user: { id: user.id } });
  const assetRepository = ctx.get(AssetRepository);
  const searchRepository = ctx.get(SearchRepository);
  const sharedSpaceRepository = ctx.get(SharedSpaceRepository);

  const surfaces = {
    timeline: async (filter: AssetFilter) => {
      const options = { userIds: [user.id], bucketSize: TimeBucketSize.Month, ...filter } as TimeBucketOptions;
      const buckets = await assetRepository.getTimeBuckets(options, auth);
      const assets = await Promise.all(
        buckets.map(async ({ timeBucket }) => {
          const bucket = await assetRepository.getTimeBucket(timeBucket, options, auth);
          return JSON.parse(bucket.assets).id as string[];
        }),
      );
      return assets.flat();
    },
    suggestions: async (filter: AssetFilter) => {
      const rows = await searchRepository['buildFilteredAssetIds'](
        [user.id],
        filter as FilterSuggestionsOptions,
      ).execute();
      return rows.map((row) => row.id);
    },
    map: async (filter: AssetFilter) => {
      const markers = await sharedSpaceRepository.getFilteredMapMarkers({
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
        ...filter,
        takenAfter: filter.takenAfter as Date | undefined,
        takenBefore: filter.takenBefore as Date | undefined,
      });
      return markers.map((marker) => marker.id);
    },
    smartSearch: async (filter: AssetFilter) => {
      const { items } = await searchRepository.searchSmart(
        { page: 1, size: 100 },
        {
          embedding,
          userIds: [user.id],
          ...filter,
          takenAfter: filter.takenAfter as Date | undefined,
          takenBefore: filter.takenBefore as Date | undefined,
        },
      );
      return items.map((item) => item.id);
    },
    metadataSearch: async (filter: AssetFilter) => {
      const { items } = await searchRepository.searchMetadata(
        { page: 1, size: 100 },
        {
          userIds: [user.id],
          ...filter,
          takenAfter: filter.takenAfter as Date | undefined,
          takenBefore: filter.takenBefore as Date | undefined,
          // Metadata search keeps upstream's exact rating unless asked; only its taken range moved.
          ratingIsMinimum: true,
        },
      );
      return items.map((item) => item.id);
    },
  };

  const facetTotal = async (filter: AssetFilter) => {
    const { total } = await searchRepository.getSmartSearchFacets({
      embedding,
      userIds: [user.id],
      ...filter,
      takenAfter: filter.takenAfter as Date | undefined,
      takenBefore: filter.takenBefore as Date | undefined,
    });
    return total;
  };

  return { ids, surfaces, facetTotal };
};

// Clients send a month as a UTC-midnight wall-clock range with an exclusive upper bound.
const january = { takenAfter: new Date('2024-01-01T00:00:00Z'), takenBefore: new Date('2024-02-01T00:00:00Z') };

describe('asset filter parity', () => {
  const cases: Array<[string, AssetFilter, Array<keyof Awaited<ReturnType<typeof setup>>['ids']>]> = [
    ['no filter', {}, ['newYearSydney', 'midJanuary', 'februaryMidnight', 'december']],
    ['January, by local taken date, upper bound exclusive', january, ['newYearSydney', 'midJanuary']],
    ['city: null means no city', { city: null }, ['midJanuary']],
    ['city', { city: 'Paris' }, ['februaryMidnight', 'december']],
    ['country', { country: 'France' }, ['februaryMidnight', 'december']],
    ['country: null', { country: null }, ['midJanuary']],
    ['state', { state: 'NSW' }, ['newYearSydney']],
    ['make', { make: 'Canon' }, ['newYearSydney', 'december']],
    ['model', { model: 'Z6' }, ['midJanuary', 'februaryMidnight']],
    ['lens', { lensModel: 'RF50' }, ['newYearSydney']],
    ['rating is a minimum', { rating: 3 }, ['newYearSydney', 'midJanuary']],
    ['rating: null means unrated', { rating: null }, ['februaryMidnight']],
    ['January and a make', { ...january, make: 'Nikon' }, ['midJanuary']],
  ];

  it.each(cases)('%s', async (_, filter, expected) => {
    const { ids, surfaces, facetTotal } = await setup();
    const expectedIds = expected.map((key) => ids[key]).toSorted((a, b) => a.localeCompare(b));

    const actual: Record<string, unknown> = { facetTotal: await facetTotal(filter) };
    for (const [surface, query] of Object.entries(surfaces)) {
      const found = await query(filter);
      actual[surface] = found.toSorted((a, b) => a.localeCompare(b));
    }
    expect(actual).toEqual({
      timeline: expectedIds,
      suggestions: expectedIds,
      map: expectedIds,
      smartSearch: expectedIds,
      metadataSearch: expectedIds,
      facetTotal: expectedIds.length,
    });
  });
});
