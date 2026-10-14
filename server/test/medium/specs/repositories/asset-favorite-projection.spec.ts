import { Kysely, sql } from 'kysely';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// asset."isFavorite" is the owner's projection of asset_favorite: the forward triggers copy overlay changes
// onto the column, the reverse triggers copy column writes (a stock Immich server) into the overlay.
let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AssetFavoriteRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetFavoriteRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

const assetState = (ctx: Ctx, assetId: string) =>
  ctx.database
    .selectFrom('asset')
    .select(['isFavorite', 'updateId'])
    .where('id', '=', assetId)
    .executeTakeFirstOrThrow();

const columnValue = (ctx: Ctx, assetId: string) => assetState(ctx, assetId).then(({ isFavorite }) => isFavorite);

const favoriteUsers = async (ctx: Ctx, assetId: string) => {
  const rows = await ctx.database
    .selectFrom('asset_favorite')
    .select('userId')
    .where('assetId', '=', assetId)
    .execute();
  return rows.map(({ userId }) => userId).toSorted();
};

const auditUsers = async (ctx: Ctx, assetId: string) => {
  const rows = await ctx.database
    .selectFrom('asset_favorite_audit')
    .select('userId')
    .where('assetId', '=', assetId)
    .execute();
  return rows.map(({ userId }) => userId);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('asset.isFavorite owner projection', () => {
  it('sets and clears the column and bumps updateId when the owner toggles a favorite', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    const initial = await assetState(ctx, asset.id);

    await sut.addAll(owner.id, [asset.id]);
    const favorited = await assetState(ctx, asset.id);
    expect(favorited.isFavorite).toBe(true);
    expect(favorited.updateId).not.toBe(initial.updateId);

    await sut.removeAll(owner.id, [asset.id]);
    const unfavorited = await assetState(ctx, asset.id);
    expect(unfavorited.isFavorite).toBe(false);
    expect(unfavorited.updateId).not.toBe(favorited.updateId);
  });

  it('leaves the column and updateId alone when another user toggles a favorite', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    const initial = await assetState(ctx, asset.id);

    await sut.addAll(member.id, [asset.id]);
    await expect(assetState(ctx, asset.id)).resolves.toEqual(initial);
    await sut.removeAll(member.id, [asset.id]);
    await expect(assetState(ctx, asset.id)).resolves.toEqual(initial);
  });

  it('keeps the owner favorite when another user unfavorites', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });

    await sut.addAll(owner.id, [asset.id]);
    await sut.addAll(member.id, [asset.id]);
    await sut.removeAll(member.id, [asset.id]);

    expect(await columnValue(ctx, asset.id)).toBe(true);
    expect(await favoriteUsers(ctx, asset.id)).toEqual([owner.id]);
  });

  it('turns an INSERT with isFavorite = true into the owner overlay row', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { asset: favorite } = await ctx.newAsset({ ownerId: owner.id, isFavorite: true });
    const { asset: plain } = await ctx.newAsset({ ownerId: owner.id });

    expect(await favoriteUsers(ctx, favorite.id)).toEqual([owner.id]);
    expect(await favoriteUsers(ctx, plain.id)).toEqual([]);
    expect(await columnValue(ctx, favorite.id)).toBe(true);
  });

  it('turns a direct column update into the owner overlay row and back, with a delete tombstone', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.database.insertInto('asset_favorite').values({ userId: member.id, assetId: asset.id }).execute();

    const { updateId } = await ctx.database
      .updateTable('asset')
      .set({ isFavorite: true })
      .where('id', '=', asset.id)
      .returning('updateId')
      .executeTakeFirstOrThrow();
    expect(await favoriteUsers(ctx, asset.id)).toEqual([owner.id, member.id].toSorted());
    // The overlay insert's own forward UPDATE matched nothing, so the row was written once.
    await expect(assetState(ctx, asset.id)).resolves.toEqual({ isFavorite: true, updateId });

    await ctx.database.updateTable('asset').set({ isFavorite: false }).where('id', '=', asset.id).execute();
    expect(await favoriteUsers(ctx, asset.id)).toEqual([member.id]);
    expect(await auditUsers(ctx, asset.id)).toEqual([owner.id]);
  });

  it('ignores updates that do not change the column', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await sut.addAll(owner.id, [asset.id]);

    await ctx.database.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();
    await ctx.database
      .updateTable('asset')
      .set({ originalFileName: 'renamed.jpg' })
      .where('id', '=', asset.id)
      .execute();

    expect(await favoriteUsers(ctx, asset.id)).toEqual([owner.id]);
    expect(await auditUsers(ctx, asset.id)).toEqual([]);
  });

  it('projects a duplicate merge onto the keeper', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset: keeper } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: source } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: memberOnly } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: memberKeeper } = await ctx.newAsset({ ownerId: owner.id });
    await sut.addAll(owner.id, [source.id]);
    await sut.addAll(member.id, [memberOnly.id]);

    await sut.mergeOnto(keeper.id, [source.id]);
    await sut.mergeOnto(memberKeeper.id, [memberOnly.id]);

    expect(await columnValue(ctx, keeper.id)).toBe(true);
    expect(await columnValue(ctx, memberKeeper.id)).toBe(false);
  });

  it('deletes a favorited asset and its owner cleanly', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    await sut.addAll(owner.id, [asset.id]);
    await sut.addAll(member.id, [asset.id]);

    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();
    expect(await favoriteUsers(ctx, asset.id)).toEqual([]);
    await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
  });

  it('keeps 10,000 assets consistent through bulk toggles in both directions', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const ids = Array.from({ length: 10_000 }, () => newUuid());
    await ctx.database
      .insertInto('asset')
      .columns([
        'id',
        'ownerId',
        'checksum',
        'checksumAlgorithm',
        'originalPath',
        'originalFileName',
        'type',
        'fileCreatedAt',
        'fileModifiedAt',
        'localDateTime',
      ])
      .expression(
        sql`SELECT id, ${owner.id}::uuid, decode(md5(id::text), 'hex'), 'sha1', '/bulk/' || id, 'bulk.jpg', 'IMAGE', now(), now(), now()
            FROM unnest(${ids}::uuid[]) AS id`,
      )
      .execute();
    // Planner statistics, as a live database has them; without them the forward trigger's join picks a nested loop.
    await sql`ANALYZE asset`.execute(ctx.database);
    const counts = () =>
      sql<{ column: number; overlay: number }>`
        SELECT count(*) FILTER (WHERE a."isFavorite")::int AS "column",
               count(f."assetId")::int AS overlay
          FROM asset a
          LEFT JOIN asset_favorite f ON f."assetId" = a.id AND f."userId" = a."ownerId"
         WHERE a."ownerId" = ${owner.id}
      `
        .execute(ctx.database)
        .then(({ rows }) => rows[0]);

    await sut.addAll(owner.id, ids);
    await expect(counts()).resolves.toEqual({ column: 10_000, overlay: 10_000 });
    await sut.removeAll(owner.id, ids);
    await expect(counts()).resolves.toEqual({ column: 0, overlay: 0 });

    await ctx.database.updateTable('asset').set({ isFavorite: true }).where('ownerId', '=', owner.id).execute();
    await expect(counts()).resolves.toEqual({ column: 10_000, overlay: 10_000 });
    await ctx.database.updateTable('asset').set({ isFavorite: false }).where('ownerId', '=', owner.id).execute();
    await expect(counts()).resolves.toEqual({ column: 0, overlay: 0 });
  }, 120_000);
});
