import { Kysely } from 'kysely';
import { AssetVisibility, TimeBucketSize } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { mediumFactory, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

// #763 slice 4 (design §10.10): a favorite-filtered timeline first page that crosses TEN shared
// spaces the caller belongs to but owns none of — the branch in withTimeBucketAssetFilters
// (asset.repository.ts) that ORs `asset.ownerId = caller` against the timelineSpaceIds
// spaceAssetPathBranches, then narrows to the caller's own asset_favorite overlay. A regression
// tripwire, not a strict SLA — see memory `project_people_page_slow_accessible_faces` for the
// JIT-class regression this shape exists to catch: a fine plan at small scale that falls off a
// cliff once the corpus crosses a cost threshold no earlier, smaller medium test exercised.

interface TimeBucketAssets {
  id: string[];
}

const SPACE_COUNT = 10;
const ASSETS_PER_OWNER = 1000;
const TOTAL_ASSETS = SPACE_COUNT * ASSETS_PER_OWNER;
const CHUNK_SIZE = 1000;
const PERF_CEILING_MS = 5000;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
}, 30_000);

describe('favorite cross-scope timeline performance (#763 slice 4)', () => {
  it('returns a favorite-filtered, 10-space cross-scope first page within the perf budget', async () => {
    const { ctx, sut } = setup();
    const database = ctx.database;

    const { user: caller } = await ctx.newUser();

    // 10 spaces, each owned by a different user — the caller is a member (showInTimeline,
    // the factory default) of every one but owns zero assets, so the measured query must take
    // the cross-owner spaceAssetPathBranches arm for every row it returns.
    const spaceIds: string[] = [];
    const assetRows: ReturnType<typeof mediumFactory.assetInsert>[] = [];

    for (let s = 0; s < SPACE_COUNT; s++) {
      const { user: owner } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: caller.id });
      spaceIds.push(space.id);

      for (let a = 0; a < ASSETS_PER_OWNER; a++) {
        const index = s * ASSETS_PER_OWNER + a;
        const takenAt = new Date(Date.now() - index * 60 * 60 * 1000);
        assetRows.push(
          mediumFactory.assetInsert({
            ownerId: owner.id,
            originalFileName: `perf-${index}.jpg`,
            fileCreatedAt: takenAt,
            fileModifiedAt: takenAt,
            localDateTime: takenAt,
          }),
        );
      }
    }

    // Bulk-insert everything in 1,000-row chunks — never row-by-row for 10k+ rows.
    for (const assetChunk of chunk(assetRows, CHUNK_SIZE)) {
      await database.insertInto('asset').values(assetChunk).execute();
    }

    // getTimeBucket's projection stage inner-joins asset_exif — a real asset always has one, so
    // the perf shape needs it too (otherwise the join silently drops every seeded row).
    const exifRows = assetRows.map((asset) => ({ assetId: asset.id }));
    for (const exifChunk of chunk(exifRows, CHUNK_SIZE)) {
      await database.insertInto('asset_exif').values(exifChunk).execute();
    }

    const spaceAssetRows = assetRows.map((asset, index) => ({
      spaceId: spaceIds[Math.floor(index / ASSETS_PER_OWNER)],
      assetId: asset.id,
      addedById: null,
    }));
    for (const spaceAssetChunk of chunk(spaceAssetRows, CHUNK_SIZE)) {
      await database.insertInto('shared_space_asset').values(spaceAssetChunk).execute();
    }

    // The caller favorites every seeded asset — none of which they own.
    const favoriteRows = assetRows.map((asset) => ({ userId: caller.id, assetId: asset.id }));
    for (const favoriteChunk of chunk(favoriteRows, CHUNK_SIZE)) {
      await database.insertInto('asset_favorite').values(favoriteChunk).execute();
    }

    // Mirrors timeline.service.ts buildTimeBucketOptions output for a favorite-filtered,
    // withSharedSpaces timeline request.
    const options = {
      isFavorite: true,
      timelineSpaceIds: spaceIds,
      userIds: [caller.id],
      authUserId: caller.id,
      visibility: AssetVisibility.Timeline,
      withStacked: true,
      bucketSize: TimeBucketSize.Month,
    };

    // Warm-up: untimed, so the measured calls below aren't paying for cold caches / plan
    // compilation.
    await sut.getTimeBuckets(options);

    const bucketsStart = performance.now();
    const buckets = await sut.getTimeBuckets(options);
    const bucketsMs = performance.now() - bucketsStart;

    // Sanity: the seeded favorites must actually be what's being measured — a query that
    // silently returned nothing would still be "fast".
    const totalFavorites = buckets.reduce((sum, bucket) => sum + Number(bucket.count), 0);
    expect(totalFavorites).toBe(TOTAL_ASSETS);
    expect(buckets.length).toBeGreaterThan(0);

    const auth = factory.auth({ user: { id: caller.id } });
    const firstBucket = buckets[0].timeBucket;

    const bucketStart = performance.now();
    const page = await sut.getTimeBucket(firstBucket, options, auth);
    const bucketMs = performance.now() - bucketStart;

    const parsed = JSON.parse(page.assets) as TimeBucketAssets;
    expect(parsed.id.length).toBeGreaterThan(0);

    // This line's numbers go into the PR description — keep it grep-able.
    console.log(
      `[perf #763 slice-4] buckets=${bucketsMs.toFixed(1)}ms firstBucket=${bucketMs.toFixed(1)}ms (10 spaces / 10k favorites)`,
    );

    // Generous — expected ~tens of ms. This tripwire is meant to catch the People-page-JIT
    // class of regression, not CI jitter.
    expect(bucketsMs).toBeLessThan(PERF_CEILING_MS);
    expect(bucketMs).toBeLessThan(PERF_CEILING_MS);
  }, 120_000);
});
