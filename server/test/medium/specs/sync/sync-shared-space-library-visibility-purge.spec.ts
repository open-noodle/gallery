// Slice 2 (#753 follow-up #2): purge already-synced LIBRARY-linked space assets
// from member devices on Hidden/Locked — but never from the library OWNER, who
// keeps their asset. Restore is automatic (the visibility UPDATE bumps
// asset.updateId; LibraryAssetSync.getUpserts re-emits when the gate flips), so
// there is no restore emit (asserted by L3). Space-only tombstones live in
// shared_space_library_asset_audit, unioned (owner-gated) into LibraryAssetSync.
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { v4 } from 'uuid';

let defaultDatabase: Kysely<DB>;
const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};
beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// owner owns the library + asset; `member` is a separate synced Editor. Returns
// the space, library, asset, and the member's auth for its own sync stream.
const seedSpaceWithLibraryAsset = async (
  ctx: SyncTestContext,
  ownerId: string,
  memberAuth: Awaited<ReturnType<SyncTestContext['newSyncAuthUser']>>,
  role: SharedSpaceRole = SharedSpaceRole.Editor,
) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role });
  const { library } = await ctx.newLibrary({ ownerId });
  const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  return { space, library, asset };
};

describe('LibraryAssetSync — library visibility purge (space members, not owner)', () => {
  it('L1/L2: purges a Hidden library asset from the member but not the owner', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

    // member syncs + acks the library asset while visible
    const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, initial);

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    // member: delete delivered
    const memberNext = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const memberDeletes = memberNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(memberDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);

    // owner: NO delete (owner keeps their own asset)
    const ownerNext = await owner.ctx.syncStream(owner.auth, [SyncRequestType.LibraryAssetsV1]);
    const ownerDeletes = ownerNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(ownerDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);
  });

  it('L3: restores a library asset to the member automatically on un-hide (no restore emit)', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

    const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, initial);

    // Hide for real (bumps asset.updateId, gate now excludes) + emit the purge tombstone.
    await owner.ctx.get(AssetRepository).updateAll([asset.id], { visibility: AssetVisibility.Hidden });
    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);
    const afterHide = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, afterHide);

    // Un-hide for real — NO restore emit is called. getUpserts must re-emit.
    await owner.ctx.get(AssetRepository).updateAll([asset.id], { visibility: AssetVisibility.Timeline });

    const restored = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const creates = restored.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetCreateV1);
    expect(creates.some((e) => (e as { data: { id: string } }).data.id === asset.id)).toBe(true);
  });

  it('L4: purges a Locked library asset from the member', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

    const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, initial);

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    const next = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(deletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
  });

  it('L5: emitLibraryAssetVisibilityPurge does not write tombstones for assets NOT in a space-linked library', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();

    // Space with a library, but asset is in a DIFFERENT library not linked to any space
    const { space } = await owner.ctx.newSharedSpace({ createdById: owner.auth.user.id });
    await owner.ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: owner.auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await owner.ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id, role: SharedSpaceRole.Editor });

    const { library: spaceLibrary } = await owner.ctx.newLibrary({ ownerId: owner.auth.user.id });
    await owner.ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: spaceLibrary.id });

    // Asset is in a DIFFERENT library (not linked to the space)
    const { library: otherLibrary } = await owner.ctx.newLibrary({ ownerId: owner.auth.user.id });
    const { asset } = await owner.ctx.newAsset({
      ownerId: owner.auth.user.id,
      libraryId: otherLibrary.id,
      visibility: AssetVisibility.Timeline,
    });

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    // Member should NOT get a delete for an asset that was never in a space-linked library
    const memberNext = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const memberDeletes = memberNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(memberDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);
  });

  it('L6: Viewer-role member also receives the delete (parity with Editor)', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member, SharedSpaceRole.Viewer);

    const initial = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(member.auth, initial);

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    const next = await owner.ctx.syncStream(member.auth, [SyncRequestType.LibraryAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(deletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
  });

  it('L7: a user not in the space does not receive a library delete', async () => {
    const owner = await setup();
    const member = await owner.ctx.newSyncAuthUser();
    const nonMember = await owner.ctx.newSyncAuthUser();
    const { asset } = await seedSpaceWithLibraryAsset(owner.ctx, owner.auth.user.id, member);

    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    const nonMemberNext = await owner.ctx.syncStream(nonMember.auth, [SyncRequestType.LibraryAssetsV1]);
    const nonMemberDeletes = nonMemberNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1,
    );
    expect(nonMemberDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);
  });

  it('X2: emitLibraryAssetVisibilityPurge is a no-op on an empty id list', async () => {
    const { ctx } = await setup();
    await expect(ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([])).resolves.not.toThrow();
  });

  it('R1 (library): cleanupAuditTable prunes old shared_space_library_asset_audit rows; retains recent; does not regress library_asset_audit', async () => {
    const { ctx } = await setup();

    const libraryAuditTable = 'shared_space_library_asset_audit';
    const oldDeletedAt = DateTime.now().minus({ days: 40 }).toISO();
    const recentDeletedAt = DateTime.now().minus({ days: 10 }).toISO();

    // Insert an old and a recent row into the space library audit table.
    const oldRow = await ctx.database
      .insertInto(libraryAuditTable)
      .values({ libraryId: v4(), assetId: v4(), deletedAt: oldDeletedAt })
      .returning('id')
      .executeTakeFirstOrThrow();

    const recentRow = await ctx.database
      .insertInto(libraryAuditTable)
      .values({ libraryId: v4(), assetId: v4(), deletedAt: recentDeletedAt })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Also insert a stale row into the shared library_asset_audit table to verify
    // that the existing cleanup behaviour is not regressed.
    const staleLibraryRow = await ctx.database
      .insertInto('library_asset_audit')
      .values({ libraryId: v4(), assetId: v4(), deletedAt: oldDeletedAt })
      .returning('id')
      .executeTakeFirstOrThrow();

    await ctx.get(SyncRepository).libraryAsset.cleanupAuditTable(31);

    const remainingSpaceLibrary = await ctx.database.selectFrom(libraryAuditTable).select('id').execute();
    const remainingSpaceLibraryIds = remainingSpaceLibrary.map((r) => r.id);
    expect(remainingSpaceLibraryIds).not.toContain(oldRow.id);
    expect(remainingSpaceLibraryIds).toContain(recentRow.id);

    // Stale library_asset_audit row must also have been pruned (regression guard).
    const remainingLibraryAudit = await ctx.database.selectFrom('library_asset_audit').select('id').execute();
    const remainingLibraryAuditIds = remainingLibraryAudit.map((r) => r.id);
    expect(remainingLibraryAuditIds).not.toContain(staleLibraryRow.id);
  });

  // security-7: a member who is ALSO the owner's partner keeps partner-entitled access to the asset (a
  // partner may see Hidden). The library purge tombstone must NOT reach them, or their client drops the
  // remote_asset row despite the partner entitlement. A non-partner member still gets the purge (control).
  it('S7: a partner-and-member does NOT receive the library purge; a non-partner member does', async () => {
    const owner = await setup();
    const partnerMember = await owner.ctx.newSyncAuthUser();
    const plainMember = await owner.ctx.newSyncAuthUser();

    // Space with a linked library + one Timeline asset; both members are Editors.
    const { space } = await owner.ctx.newSharedSpace({ createdById: owner.auth.user.id });
    await owner.ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: owner.auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await owner.ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: partnerMember.user.id,
      role: SharedSpaceRole.Editor,
    });
    await owner.ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: plainMember.user.id,
      role: SharedSpaceRole.Editor,
    });
    const { library } = await owner.ctx.newLibrary({ ownerId: owner.auth.user.id });
    const { asset } = await owner.ctx.newAsset({
      ownerId: owner.auth.user.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await owner.ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    // Owner shares with partnerMember (owner = sharedById, partnerMember = sharedWithId).
    await owner.ctx.newPartner({ sharedById: owner.auth.user.id, sharedWithId: partnerMember.user.id });

    // Both members sync + ack the asset while visible.
    for (const auth of [partnerMember.auth, plainMember.auth]) {
      const initial = await owner.ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
      await owner.ctx.syncAckAll(auth, initial);
    }

    // Owner hides → library purge tombstone written for the space-linked library.
    await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

    // Partner-and-member: NO delete (partner entitlement preserved).
    const partnerNext = await owner.ctx.syncStream(partnerMember.auth, [SyncRequestType.LibraryAssetsV1]);
    const partnerDeletes = partnerNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(partnerDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);

    // Plain member (no partner): still purged.
    const plainNext = await owner.ctx.syncStream(plainMember.auth, [SyncRequestType.LibraryAssetsV1]);
    const plainDeletes = plainNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
    expect(plainDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
  });
});
