import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
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
    // needing per-asset delete events. Per-asset deletes that happen later
    // ARE scoped by libraryId via accessibleLibraries (see the dedicated
    // "does not emit a LibraryAssetDeleteV1 event for a library the user
    // cannot access" test above, which exercises the libraryId filter on
    // library_asset_audit).
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

  it('does not stream library assets to a partner (partner has no library path)', async () => {
    // Same design lock-in as LibrariesV1. Partners must not see each other's
    // library content via the sync stream.
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    const { library } = await ctx.newLibrary({ ownerId: partner.id });
    await ctx.newAsset({ ownerId: partner.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const assetEvents = response.filter((r) => isAssetEvent(r));
    expect(assetEvents).toHaveLength(0);
  });

  it('stops streaming assets from a soft-deleted library via the ownership path', async () => {
    // library.deletedAt set → owner branch of accessibleLibraries filters
    // the library out. The library's assets must no longer appear in
    // LibraryAssetsV1, even though the asset rows themselves still exist.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    // Pre-flight: library asset visible before soft delete.
    const before = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    expect(before.filter((r) => isAssetEvent(r))).toHaveLength(1);
    await ctx.syncAckAll(auth, before);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    // Mutate the asset so it would be streamed if the library gate was broken.
    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const after = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const afterEvents = after.filter((r) => isAssetEvent(r));
    expect(afterEvents).toHaveLength(0);
  });

  it('KEEPS streaming assets from a soft-deleted library via the member-of-space path', async () => {
    // Design decision documented at sync.repository.ts:1080-1083:
    // "soft-deleted libraries are excluded from the ownership branch but NOT
    // from the space-link branch". The rationale: soft-delete is a staging
    // state before hard-delete, and members of a space that links the
    // library should continue to see the content until the library is
    // hard-deleted (which then emits LibraryDeleteV1 as the authoritative
    // revocation event).
    //
    // This test LOCKS IN that asymmetry so a refactor of accessibleLibraries
    // cannot silently break either half. If you change the design to filter
    // soft-deletes uniformly, update this test AND the owner-branch test
    // above together.
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const before = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    expect(before.filter((r) => isAssetEvent(r))).toHaveLength(1);
    await ctx.syncAckAll(auth, before);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();
    await defaultDatabase.updateTable('asset').set({ isFavorite: true }).where('id', '=', asset.id).execute();

    const after = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = after.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { id: string } }).data.id).toBe(asset.id);
  });

  it('streams archived library assets as upserts (visibility change propagates)', async () => {
    // Setting visibility = archive is a property change; the existing
    // upsert stream must carry it through.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({
      ownerId: auth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Archive })
      .where('id', '=', asset.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = next.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { id: string; visibility: AssetVisibility } }).data).toMatchObject({
      id: asset.id,
      visibility: AssetVisibility.Archive,
    });
  });

  it('streams an asset moved between two libraries as an upsert', async () => {
    // UPDATE asset.libraryId = otherLib. The asset must re-flow through
    // LibraryAssetsV1 so the client's remote_asset_entity.library_id reflects
    // the new owner. Both libraries are accessible to the user (owner path)
    // so neither side-transition is a revocation.
    const { auth, ctx } = await setup();
    const { library: libA } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'A' });
    const { library: libB } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'B' });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: libA.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    await defaultDatabase.updateTable('asset').set({ libraryId: libB.id }).where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = next.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { id: string; libraryId: string } }).data).toMatchObject({
      id: asset.id,
      libraryId: libB.id,
    });
  });

  it('emits zero asset events for an empty library', async () => {
    // Empty library is a valid state. No asset events should be emitted
    // and the stream should still complete cleanly.
    const { auth, ctx } = await setup();
    await ctx.newLibrary({ ownerId: auth.user.id, name: 'Empty' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = response.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(0);
    expect(response.at(-1)).toMatchObject({ type: SyncEntityType.SyncCompleteV1 });
  });

  it('streams an asset with no exif row (LEFT JOIN correctness on the exif stream is independent)', async () => {
    // An asset exists in a library but has no asset_exif row at all.
    // LibraryAssetsV1 must still stream it — the exif stream is a separate
    // SyncRequestType that LEFT JOINs independently.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = response.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { id: string } }).data.id).toBe(asset.id);
  });

  it('streams a library asset added AFTER the initial sync + ack as a delta', async () => {
    // Checkpoint advancement through the LibraryAssetsV1 stream: ack an
    // initial state, then add a new asset, then sync again — the new asset
    // must show up in the delta.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    expect(initial.filter((r) => isAssetEvent(r))).toHaveLength(1);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetsV1]);

    const { asset: later } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    const events = next.filter((r) => isAssetEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { id: string } }).data.id).toBe(later.id);
  });
});
