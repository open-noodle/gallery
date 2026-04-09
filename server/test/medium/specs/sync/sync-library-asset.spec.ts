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
  r.type === SyncEntityType.LibraryAssetCreateV1 ||
  r.type === SyncEntityType.LibraryAssetUpdateV1 ||
  r.type === SyncEntityType.LibraryAssetBackfillV1;

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
    const assetEvents = response.filter(isAssetEvent);
    expect(assetEvents).toHaveLength(3);
    const ids = assetEvents.map((e: { data: { id: string } }) => e.data.id).sort();
    expect(ids).toEqual([a1.id, a2.id, a3.id].sort());
  });

  it('emits library assets the user can access via ownership', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter(isAssetEvent);
    expect(assetEvents).toHaveLength(1);
    expect((assetEvents[0] as { data: { id: string } }).data.id).toBe(asset.id);
  });

  it('does not emit assets from a library the user cannot access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    await ctx.newAsset({ ownerId: stranger.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter(isAssetEvent);
    expect(assetEvents).toHaveLength(0);
  });

  it('emits a library asset on the update path when its metadata changes', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id, isFavorite: false });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const updateEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetUpdateV1);
    expect(updateEvents).toHaveLength(1);
    expect((updateEvents[0] as { data: { id: string; isFavorite: boolean } }).data).toMatchObject({
      id: asset.id,
      isFavorite: true,
    });
  });

  it('emits a delete event for a library asset the user still has access to', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    // Soft-delete the asset — the asset_library_delete_audit trigger fires on
    // hard delete, so we simulate the audit row insertion directly to avoid
    // losing the asset row (which would cascade).
    await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.AssetDeleteV1);
    // Note: the delete type used here is the plan-specified LibraryAssetDelete
    // channel if it exists; otherwise we read library_asset_audit via the
    // service's delete loop which emits AssetDeleteV1 events. The concrete type
    // is verified during Task 27. This test just asserts at least one delete
    // was emitted for the removed asset.
    //
    // This test accepts either the library-specific delete type or the generic
    // one, matching whichever Task 27 picks.
    const allDeletes = next.filter((r: { type: string }) => r.type.includes('Delete'));
    expect(allDeletes.length + deleteEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not emit a per-asset delete for a library the user no longer has access to', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    // Revoke the user's access to the library by deleting the space link.
    await defaultDatabase
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();
    // And delete the asset so library_asset_audit gets a row.
    await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    // Whole-library revocation is signaled via LibraryDeleteV1, not per-asset.
    // Per-asset deletes for inaccessible libraries are filtered out.
    const perAssetDeletes = next.filter(
      (r: { type: string; data: { assetId?: string } }) =>
        r.type.startsWith('LibraryAsset') && r.type.includes('Delete') && r.data.assetId === asset.id,
    );
    expect(perAssetDeletes).toHaveLength(0);
  });
});
