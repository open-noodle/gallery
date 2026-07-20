import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { favoriteExistsFor } from 'src/utils/favorite';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// #763 slice 0 — schema foundation only. No repository exists yet (deferred to slice 2, see
// docs/superpowers/plans/2026-07-20-per-user-favorites-slice-0.md Self-Review), so these tests
// exercise `asset_favorite` / `asset_favorite_audit` directly via the Kysely DB handle.

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

const backfillFavorites = (db: Kysely<DB>) =>
  sql`
    INSERT INTO "asset_favorite" ("userId", "assetId")
    SELECT "ownerId", "id" FROM "asset" WHERE "isFavorite" = true
    ON CONFLICT DO NOTHING;
  `.execute(db);

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('asset_favorite schema', () => {
  it('persists a row and reads it back by (userId, assetId)', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database.insertInto('asset_favorite').values({ userId: user.id, assetId: asset.id }).execute();

    const rows = await ctx.database
      .selectFrom('asset_favorite')
      .selectAll()
      .where('userId', '=', user.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].createId).toEqual(expect.any(String));
    expect(rows[0].updateId).toEqual(expect.any(String));
  });

  it('lets two users favorite the same asset independently', async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database
      .insertInto('asset_favorite')
      .values([
        { userId: userA.id, assetId: asset.id },
        { userId: userB.id, assetId: asset.id },
      ])
      .execute();

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('assetId', '=', asset.id).execute();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).toSorted()).toEqual([userA.id, userB.id].toSorted());
  });

  it('rejects a duplicate (userId, assetId) via the composite PK', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database.insertInto('asset_favorite').values({ userId: user.id, assetId: asset.id }).execute();

    await expect(
      ctx.database
        .insertInto('asset_favorite')
        .values({ userId: user.id, assetId: asset.id })
        .onConflict((oc) => oc.columns(['userId', 'assetId']).doNothing())
        .execute(),
    ).resolves.not.toThrow();

    const rows = await ctx.database
      .selectFrom('asset_favorite')
      .selectAll()
      .where('userId', '=', user.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(rows).toHaveLength(1);
  });

  it('cascade-deletes rows for every user when the asset is deleted', async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database
      .insertInto('asset_favorite')
      .values([
        { userId: userA.id, assetId: asset.id },
        { userId: userB.id, assetId: asset.id },
      ])
      .execute();

    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('assetId', '=', asset.id).execute();

    expect(rows).toHaveLength(0);
  });

  it("cascade-deletes a user's rows but leaves other users' rows for the same asset", async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database
      .insertInto('asset_favorite')
      .values([
        { userId: userA.id, assetId: asset.id },
        { userId: userB.id, assetId: asset.id },
      ])
      .execute();

    await ctx.database.deleteFrom('user').where('id', '=', userA.id).execute();

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('assetId', '=', asset.id).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userB.id);
  });

  it('writes an audit tombstone when a favorite row is deleted', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await ctx.database.insertInto('asset_favorite').values({ userId: user.id, assetId: asset.id }).execute();
    await ctx.database
      .deleteFrom('asset_favorite')
      .where('userId', '=', user.id)
      .where('assetId', '=', asset.id)
      .execute();

    const auditRows = await ctx.database
      .selectFrom('asset_favorite_audit')
      .selectAll()
      .where('userId', '=', user.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ userId: user.id, assetId: asset.id });
    expect(auditRows[0].deletedAt).toBeTruthy();
  });

  it('emits one audit row per row on a multi-row delete', async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database
      .insertInto('asset_favorite')
      .values([
        { userId: userA.id, assetId: asset.id },
        { userId: userB.id, assetId: asset.id },
      ])
      .execute();

    // Statement-level trigger check: both rows deleted in ONE DELETE statement. A trigger
    // mistakenly declared FOR EACH STATEMENT-without-transition-table (or FOR EACH ROW misused)
    // could record only once; this asserts one audit row per deleted row.
    await ctx.database.deleteFrom('asset_favorite').where('assetId', '=', asset.id).execute();

    const auditRows = await ctx.database
      .selectFrom('asset_favorite_audit')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();

    expect(auditRows).toHaveLength(2);
    expect(auditRows.map((row) => row.userId).toSorted()).toEqual([userA.id, userB.id].toSorted());
  });

  it('backfills one row per owner-favorited asset', async () => {
    const { ctx } = setup(await getKyselyDB());
    const { user: u1 } = await ctx.newUser();
    const { user: u2 } = await ctx.newUser();
    const { asset: assetA } = await ctx.newAsset({ ownerId: u1.id, isFavorite: true });
    const { asset: assetB } = await ctx.newAsset({ ownerId: u1.id, isFavorite: false });
    const { asset: assetC } = await ctx.newAsset({ ownerId: u2.id, isFavorite: true });

    await backfillFavorites(ctx.database);

    const rows = await ctx.database.selectFrom('asset_favorite').select(['userId', 'assetId']).execute();

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: u1.id, assetId: assetA.id },
        { userId: u2.id, assetId: assetC.id },
      ]),
    );
    expect(rows.some((row) => row.assetId === assetB.id)).toBe(false);
  });

  it('backfills cleanly on a database with zero favorites', async () => {
    const { ctx } = setup(await getKyselyDB());
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id, isFavorite: false });

    await backfillFavorites(ctx.database);

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().execute();

    expect(rows).toHaveLength(0);
  });
});

describe('favoriteExistsFor', () => {
  it('is true only for the user who favorited the asset', async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database.insertInto('asset_favorite').values({ userId: userA.id, assetId: asset.id }).execute();

    const rowForUserA = await ctx.database
      .selectFrom('asset')
      .select((eb) => ['asset.id', favoriteExistsFor(eb, userA.id).as('fav')])
      .where('asset.id', '=', asset.id)
      .executeTakeFirstOrThrow();

    const rowForUserB = await ctx.database
      .selectFrom('asset')
      .select((eb) => ['asset.id', favoriteExistsFor(eb, userB.id).as('fav')])
      .where('asset.id', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(rowForUserA.fav).toBe(true);
    expect(rowForUserB.fav).toBe(false);
  });

  it('is false for an asset with no favorite rows at all', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    const row = await ctx.database
      .selectFrom('asset')
      .select((eb) => ['asset.id', favoriteExistsFor(eb, user.id).as('fav')])
      .where('asset.id', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(row.fav).toBe(false);
  });

  it('usable as a WHERE predicate to filter to a user favorites', async () => {
    const { ctx } = setup();
    const { user: userA } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset: assetX } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: assetY } = await ctx.newAsset({ ownerId: owner.id });

    await ctx.database.insertInto('asset_favorite').values({ userId: userA.id, assetId: assetX.id }).execute();

    const rows = await ctx.database
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', [assetX.id, assetY.id])
      .where((eb) => favoriteExistsFor(eb, userA.id))
      .execute();

    expect(rows).toEqual([{ id: assetX.id }]);
  });
});
