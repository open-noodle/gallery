import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { OcrRepository } from 'src/repositories/ocr.repository';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetService } from 'src/services/asset.service';
import { newMediumService, SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

// Drives the real AssetService.updateAll (not raw repo mutation) so the visibility-restore wiring in
// asset.service.ts's applyVisibilityTransitionSideEffects is actually exercised end-to-end. Mirrors
// setupAssetService in sync-space-visibility-purge-cross-path.spec.ts.
const setupAssetService = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(AssetService, {
    database: db || defaultDatabase,
    real: [
      AssetRepository,
      AssetEditRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
      SharedLinkAssetRepository,
      SharedSpaceRepository,
      StackRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository, OcrRepository, MapRepository],
  });
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return { sut, ctx };
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

  // L4: direct/album restore bump their join-row updateId (EXIF, keyed on it, re-delivers). The library
  // arm has no join row — the asset row re-upserts automatically (its own updateId is bumped by the
  // visibility UPDATE), but asset_exif.updateId is never touched by a visibility flip, so
  // LibraryAssetExifSync.getUpserts (gated on asset_exif.updateId > ack) never re-streams it: a restored
  // library asset shows empty EXIF forever on an already-synced member device. Drives the real
  // AssetService.updateAll (not raw repo mutation) so the actual restore-branch wiring is exercised.
  it('L4: re-delivers a library asset EXIF to a member after a hide -> restore round trip', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { sut: assetSut } = setupAssetService(owner.ctx.database);

    const { library } = await owner.ctx.newLibrary({ ownerId: owner.auth.user.id });
    const { asset } = await owner.ctx.newAsset({
      ownerId: owner.auth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await owner.ctx.newExif({ assetId: asset.id, make: 'L4Make' });

    const { space } = await owner.ctx.newSharedSpace({ createdById: owner.auth.user.id });
    await owner.ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: owner.auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await owner.ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id, role: SharedSpaceRole.Editor });
    await owner.ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.auth.user.id });

    const types = [SyncRequestType.LibraryAssetsV1, SyncRequestType.LibraryAssetExifsV1];

    // Member already synced the asset + its EXIF (already-synced device).
    const initial = await owner.ctx.syncStream(member.auth, types);
    expect(initial.filter((r) => isExifEvent(r))).toHaveLength(1);
    await owner.ctx.syncAckAll(member.auth, initial);
    await owner.ctx.assertSyncIsComplete(member.auth, types);

    // Owner hides through the real service — the library purge tombstone fires and the member drops it.
    await assetSut.updateAll(owner.auth, { ids: [asset.id], visibility: AssetVisibility.Hidden });
    const afterHide = await owner.ctx.syncStream(member.auth, types);
    await owner.ctx.syncAckAll(member.auth, afterHide);
    await owner.ctx.assertSyncIsComplete(member.auth, types);

    // Owner un-hides through the real service.
    await assetSut.updateAll(owner.auth, { ids: [asset.id], visibility: AssetVisibility.Timeline });

    const restored = await owner.ctx.syncStream(member.auth, types);
    const restoredExif = restored.filter((r) => isExifEvent(r));
    expect(
      restoredExif.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id),
      "member's next /sync must re-deliver the asset's EXIF after the restore",
    ).toBe(true);
  });
});
