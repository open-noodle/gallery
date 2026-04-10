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

const isExifEvent = (r: { type: string }) =>
  r.type === SyncEntityType.LibraryAssetExifCreateV1 || r.type === SyncEntityType.LibraryAssetExifBackfillV1;

describe(SyncRequestType.LibraryAssetExifsV1, () => {
  it('emits exif rows for assets in accessible libraries (ownership path)', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'TestMake', model: 'TestModel' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter((r) => isExifEvent(r));
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string } }).data).toMatchObject({
      assetId: asset.id,
      make: 'TestMake',
    });
  });

  it('emits exif rows for assets in libraries reachable via a member-of space', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'PeerMake' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter((r) => isExifEvent(r));
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string } }).data.assetId).toBe(asset.id);
  });

  it('does not emit exif for assets in libraries the user cannot access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    const { asset } = await ctx.newAsset({ ownerId: stranger.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'StrangerMake' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = response.filter((r) => isExifEvent(r));
    expect(exifEvents).toHaveLength(0);
  });

  it('re-emits an exif row when properties change', async () => {
    // LibraryAssetExifSync uses a single getUpserts stream (same pattern as
    // PartnerAssetExifsSync) — updates flow through as LibraryAssetExifCreateV1
    // and the client upserts idempotently.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'OldMake' });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetExifsV1]);

    await ctx.newExif({ assetId: asset.id, make: 'NewMake' });

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const exifEvents = next.filter((r) => isExifEvent(r));
    expect(exifEvents).toHaveLength(1);
    expect((exifEvents[0] as { data: { assetId: string; make: string } }).data).toMatchObject({
      assetId: asset.id,
      make: 'NewMake',
    });
  });

  it('does not emit exif rows to a partner (partner has no library path)', async () => {
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    const { library } = await ctx.newLibrary({ ownerId: partner.id });
    const { asset } = await ctx.newAsset({ ownerId: partner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'PartnerMake' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    expect(response.filter((r) => isExifEvent(r))).toHaveLength(0);
  });

  it('stops emitting exif for assets in a soft-deleted library via the OWNER path', async () => {
    // Mirrors the LibraryAssetsV1 owner-path gate. See the soft-delete
    // asymmetry comment at sync.repository.ts:1080-1083.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'PreSoft' });

    const before = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    expect(before.filter((r) => isExifEvent(r))).toHaveLength(1);
    await ctx.syncAckAll(auth, before);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetExifsV1]);

    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();
    // Mutate exif — would stream if the gate was broken.
    await ctx.newExif({ assetId: asset.id, make: 'PostSoft' });

    const after = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    expect(after.filter((r) => isExifEvent(r))).toHaveLength(0);
  });

  it('KEEPS emitting exif for assets in a soft-deleted library via the MEMBER path', async () => {
    // Locks in the asymmetry documented at sync.repository.ts:1080-1083.
    // Members of a space linking a soft-deleted library continue to see the
    // exif rows until the library is hard-deleted.
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'MemberPath' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const events = response.filter((r) => isExifEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { assetId: string } }).data.assetId).toBe(asset.id);
  });

  it('streams exif with mostly-null fields without crashing the encoder', async () => {
    // An exif row where most optional columns are null must still stream
    // cleanly — tests the DTO nullable handling on the wire. (We set one
    // field so the upsert has at least one column to write; `make` is
    // representative of a very-sparse sidecar result.)
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: library.id });
    await ctx.newExif({ assetId: asset.id, make: 'Sparse' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const events = response.filter((r) => isExifEvent(r));
    expect(events).toHaveLength(1);
    const data = (events[0] as { data: { assetId: string; model: string | null; city: string | null } }).data;
    expect(data.assetId).toBe(asset.id);
    // Assert the null fields round-trip as null (not undefined, not missing).
    expect(data.model).toBeNull();
    expect(data.city).toBeNull();
  });

  it('streams exif rows for an asset moved between libraries', async () => {
    // UPDATE asset.libraryId = newLib. The exif row's assetId is unchanged
    // but the stream must re-qualify the asset under the new libraryId via
    // the JOIN with asset.libraryId IN accessibleLibraries.
    const { auth, ctx } = await setup();
    const { library: libA } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'A' });
    const { library: libB } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'B' });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, libraryId: libA.id });
    await ctx.newExif({ assetId: asset.id, make: 'LibA' });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibraryAssetExifsV1]);

    await defaultDatabase.updateTable('asset').set({ libraryId: libB.id }).where('id', '=', asset.id).execute();
    // Also touch the exif row so getUpserts has something to emit.
    await ctx.newExif({ assetId: asset.id, make: 'LibB' });

    const next = await ctx.syncStream(auth, [SyncRequestType.LibraryAssetExifsV1]);
    const events = next.filter((r) => isExifEvent(r));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: { assetId: string; make: string } }).data).toMatchObject({
      assetId: asset.id,
      make: 'LibB',
    });
  });
});
