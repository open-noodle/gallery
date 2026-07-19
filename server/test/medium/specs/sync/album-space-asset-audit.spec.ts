import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Schema-level guarantees for album_space_asset's sync substrate (#764 Slice 5):
//   - updateId bumps on UPDATE (the BEFORE-UPDATE trigger), enabling restore re-emit
//   - deleting a contribution row (explicit or FK cascade) writes an album_space_asset_audit row
//   - the audit trigger is statement-level (a multi-row delete writes one audit row per deleted row)

let db: Kysely<DB>;

const seedContribution = async (ctx: SyncTestContext) => {
  const { user: owner } = await ctx.newUser();
  const { user: contributor } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: contributor.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id, addedById: contributor.id });
  return { owner, contributor, album, asset, space };
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('album_space_asset sync substrate', () => {
  it('bumps updateId when the row is updated', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    const before = await db
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    await db
      .updateTable('album_space_asset')
      .set({ updatedAt: new Date() })
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    const after = await db
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    expect(after.updateId).not.toBe(before.updateId);
  });

  it('writes an album_space_asset_audit row when a contribution is deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    await db.deleteFrom('album_space_asset').where('albumId', '=', album.id).where('assetId', '=', asset.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(audit).toHaveLength(1);
    expect(audit[0].id).toBeDefined();
  });

  it('writes an audit row on FK cascade (asset delete)', async () => {
    const ctx = new SyncTestContext(db);
    const { album, asset } = await seedContribution(ctx);

    await db.deleteFrom('asset').where('id', '=', asset.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('assetId', '=', asset.id)
      .execute();

    expect(audit).toHaveLength(1);
  });

  it('is statement-level: a multi-row delete writes one audit row per deleted contribution', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: a1.id, spaceId: space.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: a2.id, spaceId: space.id });

    await db.deleteFrom('album_space_asset').where('albumId', '=', album.id).execute();

    const audit = await db
      .selectFrom('album_space_asset_audit')
      .select('assetId')
      .where('albumId', '=', album.id)
      .execute();

    expect(audit.map((r) => r.assetId).sort()).toEqual([a1.id, a2.id].sort());
  });
});
