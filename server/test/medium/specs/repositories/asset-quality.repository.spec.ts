import { Kysely } from 'kysely';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

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
});

describe('asset_quality schema (slice A2)', () => {
  it('stores and reads back per-asset quality scores', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database
      .insertInto('asset_quality')
      .values({ assetId: asset.id, sharpness: 82, exposure: 91, brightness: 47, quality: 78 })
      .execute();

    const row = await ctx.database
      .selectFrom('asset_quality')
      .selectAll()
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({ assetId: asset.id, sharpness: 82, exposure: 91, brightness: 47, quality: 78 });
  });

  it('allows null scores for an unscored asset', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database.insertInto('asset_quality').values({ assetId: asset.id }).execute();

    const row = await ctx.database
      .selectFrom('asset_quality')
      .selectAll()
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({ assetId: asset.id, sharpness: null, exposure: null, brightness: null, quality: null });
  });

  it('cascades the delete when the asset is removed', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.database.insertInto('asset_quality').values({ assetId: asset.id, quality: 50 }).execute();

    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

    const rows = await ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).execute();
    expect(rows).toEqual([]);
  });

  it('defaults asset_job_status.qualityScoredAt to null and persists it via upsertJobStatus', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.newJobStatus({ assetId: asset.id });
    const before = await ctx.database
      .selectFrom('asset_job_status')
      .select('qualityScoredAt')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(before.qualityScoredAt).toBeNull();

    const scoredAt = new Date('2026-05-31T00:00:00.000Z');
    await sut.upsertJobStatus({ assetId: asset.id, qualityScoredAt: scoredAt });
    const after = await ctx.database
      .selectFrom('asset_job_status')
      .select('qualityScoredAt')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(after.qualityScoredAt).toEqual(scoredAt);
  });
});
