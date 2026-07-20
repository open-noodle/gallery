import { Kysely, sql } from 'kysely';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { favoriteExistsFor } from 'src/utils/favorite';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// #763 slice 0 laid the schema foundation (`asset_favorite` / `asset_favorite_audit`), exercised
// below directly via the Kysely DB handle. Slice 2 (this file's `AssetFavoriteRepository` describe
// block, see docs/superpowers/plans/2026-07-20-per-user-favorites-slice-2.md Task 1) adds the
// repository that Task 2's write path calls.

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

const setupRepo = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [AssetFavoriteRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetFavoriteRepository) };
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

describe('AssetFavoriteRepository', () => {
  it('addAll creates one row per asset for the given user', async () => {
    const { ctx, sut } = setupRepo();
    const { user } = await ctx.newUser();
    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });

    await sut.addAll(user.id, [assetA.id, assetB.id]);

    const rows = await ctx.database
      .selectFrom('asset_favorite')
      .select(['userId', 'assetId'])
      .where('userId', '=', user.id)
      .execute();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.assetId).toSorted()).toEqual([assetA.id, assetB.id].toSorted());
  });

  it('addAll is idempotent — re-adding an existing favorite is a no-op, not a 500', async () => {
    const { ctx, sut } = setupRepo();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await sut.addAll(user.id, [asset.id]);

    await expect(sut.addAll(user.id, [asset.id])).resolves.not.toThrow();

    const rows = await ctx.database
      .selectFrom('asset_favorite')
      .selectAll()
      .where('userId', '=', user.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(rows).toHaveLength(1);
  });

  it('removeAll deletes only the given users rows', async () => {
    const { ctx, sut } = setupRepo();
    const { user: userA } = await ctx.newUser();
    const { user: userB } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await sut.addAll(userA.id, [asset.id]);
    await sut.addAll(userB.id, [asset.id]);

    await sut.removeAll(userA.id, [asset.id]);

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('assetId', '=', asset.id).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userB.id);
  });

  it('removeAll on a never-favorited asset is a no-op', async () => {
    const { ctx, sut } = setupRepo();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    await expect(sut.removeAll(user.id, [asset.id])).resolves.not.toThrow();

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('assetId', '=', asset.id).execute();

    expect(rows).toHaveLength(0);
  });

  it('addAll with an empty id list does nothing and does not throw', async () => {
    const { ctx, sut } = setupRepo();
    const { user } = await ctx.newUser();

    await expect(sut.addAll(user.id, [])).resolves.not.toThrow();

    const rows = await ctx.database.selectFrom('asset_favorite').selectAll().where('userId', '=', user.id).execute();

    expect(rows).toHaveLength(0);
  });

  // #763 slice 7 (E21): duplicate-merge calls mergeOnto BEFORE the source assets are deleted —
  // their own asset_favorite rows would otherwise CASCADE away with them. Duplicate detection is
  // owner-scoped (all sources share an owner), but other users can have favorited a source via
  // space access, which the old boolean-OR on the raw column could not express.
  describe('mergeOnto', () => {
    it('unions favorites from multiple source assets onto the keeper, per user', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { user: userA } = await ctx.newUser();
      const { user: userB } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source1 } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source2 } = await ctx.newAsset({ ownerId: owner.id });

      // userA favorited source1, userB favorited source2 — two different users, two different
      // sources. The old global-column OR could only ever carry the owner's single boolean.
      await sut.addAll(userA.id, [source1.id]);
      await sut.addAll(userB.id, [source2.id]);

      await sut.mergeOnto(keeper.id, [source1.id, source2.id]);

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .select('userId')
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows.map((row) => row.userId).toSorted()).toEqual([userA.id, userB.id].toSorted());
    });

    it('dedups when the same user favorited multiple sources — exactly one keeper row (E8)', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { user: userA } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source1 } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source2 } = await ctx.newAsset({ ownerId: owner.id });

      await sut.addAll(userA.id, [source1.id, source2.id]);

      await expect(sut.mergeOnto(keeper.id, [source1.id, source2.id])).resolves.not.toThrow();

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .select('userId')
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userA.id);
    });

    it('does not conflict with a favorite the keeper already carries', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { user: userA } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source } = await ctx.newAsset({ ownerId: owner.id });

      // userA already favorited the keeper directly, AND favorited the source being merged in.
      await sut.addAll(userA.id, [keeper.id, source.id]);

      await expect(sut.mergeOnto(keeper.id, [source.id])).resolves.not.toThrow();

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .select('userId')
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userA.id);
    });

    it('creates no rows when no source was favorited', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source } = await ctx.newAsset({ ownerId: owner.id });

      await sut.mergeOnto(keeper.id, [source.id]);

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .selectAll()
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows).toHaveLength(0);
    });

    it('with an empty source list does nothing and does not throw', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });

      await expect(sut.mergeOnto(keeper.id, [])).resolves.not.toThrow();

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .selectAll()
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows).toHaveLength(0);
    });

    // §5.2: visibility is re-derived on read, never enforced by deleting rows on access loss —
    // mergeOnto has no notion of "current access" at all, it only reads existing asset_favorite
    // rows. A favorite from a user who has since lost access to the source still transfers here;
    // whether it's visible to that user afterwards is entirely a read-path/access-filter concern.
    it('transfers a source favorite regardless of the favoriting users current access', async () => {
      const { ctx, sut } = setupRepo();
      const { user: owner } = await ctx.newUser();
      const { user: formerMember } = await ctx.newUser();
      const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: source } = await ctx.newAsset({ ownerId: owner.id });

      await sut.addAll(formerMember.id, [source.id]);

      await sut.mergeOnto(keeper.id, [source.id]);

      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .select('userId')
        .where('assetId', '=', keeper.id)
        .execute();

      expect(rows.map((row) => row.userId)).toEqual([formerMember.id]);
    });
  });
});
