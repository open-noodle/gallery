// Slice 1 (#753 follow-up #1): purge already-synced ALBUM-linked space assets
// from member devices when the owner flips an asset OUT of the space-shareable
// set (Timeline/Archive) to Hidden, and re-add it on restore. Locked is already
// covered by asset.service.updateAll -> albumRepository.removeAssetsFromAll,
// which deletes the album_asset row and fires the shared album_asset_audit.
// This slice closes only the Hidden gap, via a space-only audit table
// (shared_space_album_asset_audit) unioned into SharedSpaceAlbumToAssetSync.
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { v4 } from 'uuid';

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Seed a space owned by `ownerId`, a linked album containing one asset. `member`
// (defaults to owner) is added to the space so it can sync the album asset.
const seedSpaceWithAlbumAsset = async (
  ctx: SyncTestContext,
  ownerId: string,
  opts: { memberId?: string; role?: SharedSpaceRole; showInTimeline?: boolean } = {},
) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  if (opts.memberId && opts.memberId !== ownerId) {
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: opts.memberId,
      role: opts.role ?? SharedSpaceRole.Editor,
    });
  }
  const { album } = await ctx.newAlbum({ ownerId });
  const { asset } = await ctx.newAsset({ ownerId });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: opts.showInTimeline ?? true });
  return { space, album, asset };
};

describe('SharedSpaceAlbumToAssetSync — album visibility purge/restore', () => {
  it('A1: emits a delete for an album-linked asset flipped to Hidden after it was acked, excluding the owner (gaps-5)', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, { memberId: memberAuth.user.id });

    // Simulate an already-synced device for BOTH the owner and the member.
    const ownerInitial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(ownerAuth, ownerInitial);
    const memberInitial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, memberInitial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const memberNext = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const memberDeletes = memberNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1,
    );
    expect(memberDeletes).toHaveLength(1);
    expect((memberDeletes[0] as { data: { albumId: string; assetId: string } }).data).toMatchObject({
      albumId: album.id,
      assetId: asset.id,
    });

    // gaps-5: the album owner must NOT receive a delete for their own hidden asset.
    const ownerNext = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const ownerDeletes = ownerNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1,
    );
    expect(ownerDeletes).toHaveLength(0);
  });

  it('A2: re-emits the album membership when the asset is restored to Timeline after a purge', async () => {
    const { auth, ctx } = await setup();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);
    const afterPurge = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, afterPurge);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const upserts = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1);
    const emitted = upserts.map((e) => (e as { data: { albumId: string; assetId: string } }).data);
    expect(emitted).toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));
  });

  it('A3: Locked path delivers delete via album_asset_audit (removeAssetsFromAll) — no shared_space_album_asset_audit row', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await seedSpaceWithAlbumAsset(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    // Locked path: removeAssetsFromAll deletes the album_asset row, firing album_asset_audit trigger.
    // No emitAlbumAssetVisibilityPurge call here.
    await ctx.get(AlbumRepository).removeAssetsFromAll([asset.id]);

    // Assert no shared_space_album_asset_audit row was written for this asset.
    const auditRows = await ctx.database
      .selectFrom('shared_space_album_asset_audit')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();
    expect(auditRows).toHaveLength(0);

    // But the member's sync should still deliver a delete (via album_asset_audit).
    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(1);
  });

  it('A4: no bleed to normal albums not linked to any space', async () => {
    const { auth, ctx } = await setup();
    // Create a normal (non-space-linked) album with an asset
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    // Assert no shared_space_album_asset_audit row was written.
    const auditRows = await ctx.database
      .selectFrom('shared_space_album_asset_audit')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();
    expect(auditRows).toHaveLength(0);

    // And the non-space sync yields no album delete.
    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(0);
  });

  it('A5: multi-album fan-out — delete emitted for each (albumId, assetId) pair', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { space } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
    // gaps-5: the space owner never receives a delete for their own asset — sync as a separate member.
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });

    const { album: album1 } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
    const { album: album2 } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id });

    await ctx.newAlbumAsset({ albumId: album1.id, assetId: asset.id });
    await ctx.newAlbumAsset({ albumId: album2.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album2.id });

    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(2);
    const pairs = deletes.map((d) => (d as { data: { albumId: string; assetId: string } }).data);
    expect(pairs).toContainEqual(expect.objectContaining({ albumId: album1.id, assetId: asset.id }));
    expect(pairs).toContainEqual(expect.objectContaining({ albumId: album2.id, assetId: asset.id }));
  });

  it('A6: Viewer-role member receives the delete (parity with Editor)', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: viewerAuth } = await ctx.newSyncAuthUser();

    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, {
      memberId: viewerAuth.user.id,
      role: SharedSpaceRole.Viewer,
    });

    const initial = await ctx.syncStream(viewerAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(viewerAuth, initial);
    await ctx.assertSyncIsComplete(viewerAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const next = await ctx.syncStream(viewerAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(1);
    expect((deletes[0] as { data: { albumId: string; assetId: string } }).data).toMatchObject({
      albumId: album.id,
      assetId: asset.id,
    });
  });

  it('A7: non-member of the space receives no album delete', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: nonMemberAuth } = await ctx.newSyncAuthUser();

    await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id);

    const { asset: otherAsset } = await ctx.newAsset({ ownerId: ownerAuth.user.id });
    // Use a fresh asset to call purge — non-member should see nothing
    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([otherAsset.id]);

    const next = await ctx.syncStream(nonMemberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes).toHaveLength(0);
  });

  it('A8: no album re-add after Locked — album_asset row was deleted, restore finds nothing', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await seedSpaceWithAlbumAsset(ctx, auth.user.id);

    // Locked path removes the album_asset row permanently.
    await ctx.get(AlbumRepository).removeAssetsFromAll([asset.id]);

    // Sync and ack the delete delivered by removeAssetsFromAll.
    const afterLocked = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, afterLocked);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    // Attempt restore — no album_asset row to bump.
    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const upserts = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1);
    expect(upserts).toHaveLength(0);
  });

  it('A9: showInTimeline=false linked album still fires purge and restore', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, {
      memberId: memberAuth.user.id,
      showInTimeline: false,
    });

    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const afterPurge = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = afterPurge.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1,
    );
    expect(deletes).toHaveLength(1);
    expect((deletes[0] as { data: { albumId: string; assetId: string } }).data).toMatchObject({
      albumId: album.id,
      assetId: asset.id,
    });

    await ctx.syncAckAll(memberAuth, afterPurge);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);

    const afterRestore = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const upserts = afterRestore.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1);
    expect(upserts).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ albumId: album.id, assetId: asset.id }) }),
    );
  });

  it('X2: album emit methods are a no-op on an empty id list', async () => {
    const { ctx } = await setup();
    await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([])).resolves.not.toThrow();
    await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([])).resolves.not.toThrow();
  });

  it('X3: calling emitAlbumAssetVisibilityPurge twice is idempotent — member converges to absent', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, { memberId: memberAuth.user.id });

    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    // Double-purge — duplicate tombstones are written but should not cause errors.
    await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id])).resolves.not.toThrow();
    await expect(ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id])).resolves.not.toThrow();

    // The member must receive at least one delete for the asset (convergence to absent).
    const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);

    // Ack all deletes; next sync must be empty (device has converged).
    await ctx.syncAckAll(memberAuth, next);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    // Verify the album association data is correct on at least one delete event.
    expect(
      deletes.some(
        (e) =>
          (e as { data: { albumId: string; assetId: string } }).data.albumId === album.id &&
          (e as { data: { albumId: string; assetId: string } }).data.assetId === asset.id,
      ),
    ).toBe(true);
  });

  // X4: the unioned getDeletes (album_asset_audit + shared_space_album_asset_audit)
  // runs under ONE client checkpoint. Deletes from both sources in one window must
  // all deliver, and a single ack must advance past both (next sync empty).
  it('X4: union checkpoint correctness — ack advances past both audit sources; next sync empty', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    // gaps-5: the space-arm (shared_space_album_asset_audit) tombstone is now owner-gated, so this must
    // sync as a non-owner member to observe deletes from BOTH union arms in the same window.
    const { auth: memberAuth } = await ctx.newSyncAuthUser();

    // Seed a space with TWO linked albums, same asset in both.
    const { space } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });
    const { album: albumA } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
    const { album: albumB } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id });
    await ctx.newAlbumAsset({ albumId: albumA.id, assetId: asset.id });
    await ctx.newAlbumAsset({ albumId: albumB.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumA.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: albumB.id });

    // Member syncs and acks to simulate an already-synced device.
    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    // Produce one tombstone from EACH union arm in the same window:
    // Arm 1 (album_asset_audit): remove asset from album A — fires the album_asset_audit trigger.
    await ctx.get(AlbumRepository).removeAssetIds(albumA.id, [asset.id]);
    // Arm 2 (shared_space_album_asset_audit): emit visibility purge for album B (still has the row).
    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    // Sync — must deliver deletes from BOTH sources (≥2 deletes covering albumA and albumB).
    const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    expect(deletes.length, 'expected deletes from both audit sources').toBeGreaterThanOrEqual(2);

    const pairs = deletes.map((d) => (d as { data: { albumId: string; assetId: string } }).data);
    expect(pairs).toContainEqual(expect.objectContaining({ albumId: albumA.id, assetId: asset.id }));
    expect(pairs).toContainEqual(expect.objectContaining({ albumId: albumB.id, assetId: asset.id }));

    // Ack all deletes — the single checkpoint must advance past both audit tables.
    await ctx.syncAckAll(memberAuth, next);

    // Next sync MUST be empty: no re-delivery from either arm, no skip.
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  });

  it('R1 (album): cleanupAuditTable prunes old shared_space_album_asset_audit rows but retains recent ones', async () => {
    const { ctx } = await setup();

    const tableName = 'shared_space_album_asset_audit';
    const oldDeletedAt = DateTime.now().minus({ days: 40 }).toISO();
    const recentDeletedAt = DateTime.now().minus({ days: 10 }).toISO();

    // Insert one old row (should be pruned) and one recent row (should be retained).
    const oldRow = await ctx.database
      .insertInto(tableName)
      .values({ albumId: v4(), assetId: v4(), deletedAt: oldDeletedAt })
      .returning('id')
      .executeTakeFirstOrThrow();

    const recentRow = await ctx.database
      .insertInto(tableName)
      .values({ albumId: v4(), assetId: v4(), deletedAt: recentDeletedAt })
      .returning('id')
      .executeTakeFirstOrThrow();

    await ctx.get(SyncRepository).sharedSpaceAlbumToAsset.cleanupAuditTable(31);

    const remaining = await ctx.database.selectFrom(tableName).select('id').execute();
    const remainingIds = remaining.map((r) => r.id);

    expect(remainingIds).not.toContain(oldRow.id);
    expect(remainingIds).toContain(recentRow.id);
  });

  // correctness-1 (album): restore-then-hide in one window must not resurrect a now-Hidden album asset.
  it('correctness-1: album restore-then-hide within one window converges to absent for a member', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, { memberId: memberAuth.user.id });

    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const upserts = next
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1)
      .map((e) => (e as { data: { albumId: string; assetId: string } }).data);
    const deletes = next
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1)
      .map((e) => (e as { data: { albumId: string; assetId: string } }).data);

    expect(deletes).toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));
    expect(upserts).not.toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));

    await ctx.syncAckAll(memberAuth, next);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  });

  // correctness-1 edge: an album linked into TWO spaces gates the Hidden asset in both members' streams.
  it('correctness-1: album linked into two spaces gates a Hidden asset in both members', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberA } = await ctx.newSyncAuthUser();
    const { auth: memberB } = await ctx.newSyncAuthUser();
    const { album } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
    const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

    const { space: spaceB } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberB.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

    // Both members sync + ack the asset while visible.
    for (const auth of [memberA, memberB]) {
      const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      await ctx.syncAckAll(auth, initial);
      await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    }

    // Hide + purge.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

    for (const auth of [memberA, memberB]) {
      const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
      // Each member gets exactly one delete (their own space's album link) and no re-add.
      expect(deletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
      await ctx.syncAckAll(auth, next);
      const afterAck = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const upserts = afterAck.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1);
      expect(upserts.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);
    }
  });
});

describe('contribution visibility parity (album_space_asset)', () => {
  it('purge tombstones a contributed asset so getDeletes drops it for members', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const sharedSpace = ctx.get(SharedSpaceRepository);
    const toAsset = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    await sharedSpace.emitAlbumAssetVisibilityPurge([asset.id]);

    const audit = await defaultDatabase
      .selectFrom('album_space_asset_audit')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();
    expect(audit).toHaveLength(1);

    const deletes: any[] = await Array.fromAsync(toAsset.getDeletes({ nowId: NOW_ID, userId: member.id }));
    expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('restore bumps the contribution updateId so getUpserts re-emits it', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const sharedSpace = ctx.get(SharedSpaceRepository);
    const toAsset = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    // Member of the contribution's space so the getUpserts re-emit is actually observable
    // (and the #764/§8.3 space-correlation gate passes).
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    const before = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();

    await sharedSpace.emitAlbumAssetVisibilityRestore([asset.id]);

    const after = await defaultDatabase
      .selectFrom('album_space_asset')
      .select('updateId')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(after.updateId).not.toBe(before.updateId);

    // Stronger: the restore's updateId bump must actually drive getUpserts to re-emit the contribution
    // to a member who acked BEFORE the restore (ack = pre-restore updateId).
    const upserts: any[] = await Array.fromAsync(
      toAsset.getUpserts({
        nowId: NOW_ID,
        userId: member.id,
        ack: { type: SyncEntityType.SharedSpaceAlbumToAssetV1, updateId: before.updateId },
      }),
    );
    expect(upserts.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);
  });

  it('C1: Locked path (removeAssetsFromAll) drops a contribution — getDeletes emits, row gone, no resurrection', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const albums = ctx.get(AlbumRepository);
    const toAsset = ctx.get(SyncRepository).sharedSpaceAlbumToAsset;
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
    await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });

    // The Locked branch of applyVisibilityTransitionSideEffects calls removeAssetsFromAll. This must ALSO
    // clear the cross-owner contribution (album_space_asset), firing the delete trigger so already-synced
    // members drop the edge — else a Locked contribution leaks on-device forever.
    await albums.removeAssetsFromAll([asset.id]);

    // The contribution row is gone.
    const remaining = await defaultDatabase
      .selectFrom('album_space_asset')
      .selectAll()
      .where('assetId', '=', asset.id)
      .execute();
    expect(remaining).toHaveLength(0);

    // getDeletes delivers (L, X) to the member (via the album_space_asset_audit delete trigger).
    const deletes: any[] = await Array.fromAsync(toAsset.getDeletes({ nowId: NOW_ID, userId: member.id }));
    expect(deletes.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(true);

    // No resurrection — the row is deleted, so getUpserts must not re-emit it (matches owned-Locked A8).
    const upserts: any[] = await Array.fromAsync(toAsset.getUpserts({ nowId: NOW_ID, userId: member.id }));
    expect(upserts.some((r) => r.albumId === album.id && r.assetId === asset.id)).toBe(false);
  });
});
