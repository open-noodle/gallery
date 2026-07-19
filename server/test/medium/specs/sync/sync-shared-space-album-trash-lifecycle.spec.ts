import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const ctx = new SyncTestContext(defaultDatabase);
  const { auth } = await ctx.newSyncAuthUser(); // the syncing member
  return { auth, ctx, db: defaultDatabase };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const softDelete = (db: Kysely<DB>, albumId: string) =>
  db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', albumId).execute();
const restore = (db: Kysely<DB>, albumId: string) =>
  db.updateTable('album').set({ deletedAt: null }).where('id', '=', albumId).execute();

// Build: owner + album (with one asset) linked into a space the syncing member belongs to.
const scenario = async (ctx: SyncTestContext, memberId: string) => {
  const { user: owner } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberId, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
  return { owner, album, asset, space };
};

const ALBUM_TYPES = [SyncRequestType.SharedSpaceAlbumsV1, SyncRequestType.SharedSpaceAlbumLinksV1];

describe('shared-space album trash lifecycle (Slice 8, end-to-end)', () => {
  it('soft-delete emits a grant-delete AND a link-delete to the member', async () => {
    const { auth, ctx, db } = await setup();
    const { album, space } = await scenario(ctx, auth.user.id);

    // initial converged sync
    const initial = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, initial);

    await softDelete(db, album.id);

    const response = await ctx.syncStream(auth, ALBUM_TYPES);
    // grant-revocation → album drops (metadata + assets)
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumDeleteV1 && (r as any).data.albumId === album.id),
    ).toBe(true);
    // link tombstone → shelf link row drops
    expect(
      response.some(
        (r) =>
          r.type === SyncEntityType.SharedSpaceAlbumLinkDeleteV1 &&
          (r as any).data.albumId === album.id &&
          (r as any).data.spaceId === space.id,
      ),
    ).toBe(true);
    // Task 2: the soft-deleted link row must NOT be re-added by an upsert in the same stream
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumLinkV1 && (r as any).data.albumId === album.id),
    ).toBe(false);
  });

  it('restore re-delivers the album metadata + link + a fresh grant', async () => {
    const { auth, ctx, db } = await setup();
    const { album } = await scenario(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, initial);
    await softDelete(db, album.id);
    const afterDelete = await ctx.syncStream(auth, ALBUM_TYPES);
    await ctx.syncAckAll(auth, afterDelete);

    await restore(db, album.id);

    const response = await ctx.syncStream(auth, ALBUM_TYPES);
    // metadata re-delivered (SharedSpaceAlbumV1) and link re-delivered (SharedSpaceAlbumLinkV1)
    expect(response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumV1 && (r as any).data.id === album.id)).toBe(
      true,
    );
    expect(
      response.some((r) => r.type === SyncEntityType.SharedSpaceAlbumLinkV1 && (r as any).data.albumId === album.id),
    ).toBe(true);
  });

  it('re-delivers album assets after restore (grant re-created, non-empty album)', async () => {
    const { auth, ctx, db } = await setup();
    const { album, asset } = await scenario(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await softDelete(db, album.id);
    const afterDelete = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, afterDelete);

    await restore(db, album.id);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    // The re-created grant is a FRESH grant, so its assets re-deliver via the BACKFILL path
    // (SharedSpaceAlbumToAssetBackfillV1), not the upsert type — accept either.
    const assetIds = response
      .filter(
        (r) =>
          r.type === SyncEntityType.SharedSpaceAlbumToAssetV1 ||
          r.type === SyncEntityType.SharedSpaceAlbumToAssetBackfillV1,
      )
      .map((r) => (r as any).data.assetId);
    expect(assetIds).toContain(asset.id);
  });

  it('re-link delivers assets added while unlinked (albums-9 end-to-end)', async () => {
    const { auth, ctx, db } = await setup();
    const { owner, album } = await scenario(ctx, auth.user.id);
    // second space keeps a path so the grant survives the first unlink
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);

    // unlink from the first space (grant retained via s2), add an asset while unlinked
    const spaceAlbumLinks = await db
      .selectFrom('shared_space_album')
      .select('spaceId')
      .where('albumId', '=', album.id)
      .execute();
    const firstSpaceId = spaceAlbumLinks.find((r) => r.spaceId !== s2.id)!.spaceId;
    await db
      .deleteFrom('shared_space_album')
      .where('spaceId', '=', firstSpaceId)
      .where('albumId', '=', album.id)
      .execute();
    const { asset: added } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: added.id });

    // re-link into the first space → ON CONFLICT DO UPDATE refreshes createId → backfill re-runs
    await ctx.newSharedSpaceAlbum({ spaceId: firstSpaceId, albumId: album.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [
      SyncRequestType.SharedSpaceAlbumsV1,
      SyncRequestType.SharedSpaceAlbumToAssetsV1,
    ]);
    const assetIds = response
      .filter((r) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1)
      .map((r) => (r as any).data.assetId);
    expect(assetIds).toContain(added.id);
  });
});
