import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const isAssetEvent = (r: { type: string }) =>
  r.type === SyncEntityType.LibraryAssetCreateV1 || r.type === SyncEntityType.LibraryAssetBackfillV1;

describe(SyncRequestType.LibraryAssetsV1, () => {
  it('emits each asset exactly once even when the library is linked to multiple spaces', async () => {
    // Correctness-critical dedup property: library L has 3 assets, 2 spaces A+B
    // both linking L, user in both. Expect 3 asset events, not 6 — unlike
    // SharedSpaceAssetSync where (space, asset) pairs produce write amplification.
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Multi-linked' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id, addedById: owner.id });

    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    expect(assetEvents).toHaveLength(3);
    const ids = assetEvents.map((e: { data: { id: string } }) => e.data.id).toSorted();
    expect(ids).toEqual([a1.id, a2.id, a3.id].toSorted());
  });

  it('emits library assets the user can access via ownership', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string } }).data.id).toBe(asset.id);
  });

  it('does not emit assets from a library the user cannot access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    await ctx.newAsset({ ownerId: stranger.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    expect(assetEvents).toHaveLength(0);
  });

  it('re-emits a library asset when its metadata changes', async () => {
    // Unlike SharedSpaceAssetSync (which splits CreateV1 vs UpdateV1 via the
    // stable shared_space_asset.updateId gate), library assets have no
    // per-pairing join-row updateId. LibraryAssetSync mirrors PartnerAssetsSync
    // and uses a single getUpserts stream — metadata changes flow through as
    // LibraryAssetCreateV1 and the client applies them idempotently.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id, isFavorite: false });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = next.filter((r) => isAssetEvent(r));
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });

  it('emits a LibraryAssetDeleteV1 event when a library asset is deleted', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    // Hard delete the asset — the asset_library_delete_audit trigger fires and
    // inserts a library_asset_audit row scoped to the asset's libraryId.
    await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const deleteEvents = next.filter(
      (r: { type: string; data: { assetId?: string } }) =>
        r.type === SyncEntityType.LibraryAssetDeleteV1 && r.data.assetId === asset.id,
    );
    expect(deleteEvents).toHaveLength(1);
  });

  it('does not emit a LibraryAssetDeleteV1 event for a library the user cannot access', async () => {
    // Privacy property: per-asset deletes are scoped by libraryId IN
    // accessibleLibraries. Stranger's library asset deletes must not leak.
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    const { asset } = await ctx.newAsset({ ownerId: stranger.id, libraryId: library.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const deleteEvents = next.filter(
      (r: { type: string; data: { assetId?: string } }) =>
        r.type === SyncEntityType.LibraryAssetDeleteV1 && r.data.assetId === asset.id,
    );
    expect(deleteEvents).toHaveLength(0);
  });

  it('emits LibraryDeleteV1 (not per-asset deletes) as the primary channel for whole-library revocation', async () => {
    // When a user loses access to a whole library via a space unlink,
    // LibrarySync.getDeletes emits a LibraryDeleteV1 event — the client uses
    // this to drop all assets belonging to that library locally, without
    // needing per-asset delete events. library_asset_audit rows for deleted
    // assets DO still flow through (the audit table has no libraryId column,
    // so we cannot filter by access at read time), but they are harmless:
    // the client idempotently ignores deletes for unknown assets.
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);

    // Revoke the user's access by unlinking the library from the space.
    await defaultDatabase
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1, SyncRequestType.LibraryAssetsV1]);
    const libraryDeletes = next.filter(
      (r: { type: string; data: { libraryId?: string } }) =>
        r.type === SyncEntityType.LibraryDeleteV1 && r.data.libraryId === library.id,
    );
    expect(libraryDeletes.length).toBeGreaterThanOrEqual(1);
  });
});
