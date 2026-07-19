// Slice 4.B: purge already-synced DIRECT space assets from member devices when
// the owner flips an asset OUT of the space-shareable set (Timeline/Archive) to
// Hidden or Locked, and re-add it when flipped back.
//
// Slice 4.A gated the sync READ streams so a NEW/full sync never receives
// Hidden/Locked. But a device that ALREADY synced an asset while it was
// Timeline/Archive keeps the bytes when the owner later flips it to
// Hidden/Locked — the SharedSpaceToAssetSync delete stream only fires on
// JOIN-ROW deletion, and a visibility flip deletes no shared_space_asset row.
//
// This slice closes the DIRECT path (`shared_space_asset` /
// `shared_space_asset_audit`, which is space-only). On flip to Hidden/Locked we
// emit a shared_space_asset_audit tombstone for every referencing row so
// getDeletes purges member devices. On flip back to Timeline/Archive we bump
// shared_space_asset.updateId so getUpserts re-adds.
//
// Album-path Hidden already-synced purge, the library path, and mobile-client
// end-to-end verification are documented follow-ups (out of scope here).

import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
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

// Seed a space owned by `ownerId`, with `ownerId` as Owner, plus a directly-added
// asset. `memberId` (if given) is added as a non-owner Editor so it can sync the
// asset separately from the owner. NOTE: the DIRECT arm is intentionally NOT owner-gated
// (its audit table is dual-purpose — see SharedSpaceToAssetSync.getDeletes), so the owner
// also receives the direct purge tombstone. Returns the space + asset. The caller acks the
// current sync state to simulate an already-synced device before flipping visibility.
const seedSpaceWithDirectAsset = async (ctx: SyncTestContext, ownerId: string, memberId?: string) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  if (memberId && memberId !== ownerId) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberId, role: SharedSpaceRole.Editor });
  }
  const { asset } = await ctx.newAsset({ ownerId });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
  return { space, asset };
};

describe('SharedSpaceToAssetSync — visibility purge/restore (direct path)', () => {
  it('emits a direct-path delete tombstone to both the member and the owner when flipped to Hidden', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id, memberAuth.user.id);

    // Simulate an already-synced device for both the owner and the member.
    const ownerInitial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(ownerAuth, ownerInitial);
    const memberInitial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(memberAuth, memberInitial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Owner flips the asset to Hidden — DIRECT-path purge emits a tombstone.
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

    const memberNext = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const memberDeletes = memberNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1,
    );
    expect(memberDeletes).toHaveLength(1);
    expect((memberDeletes[0] as { data: { spaceId: string; assetId: string } }).data).toMatchObject({
      spaceId: space.id,
      assetId: asset.id,
    });

    // The DIRECT arm is dual-purpose and NOT owner-gated, so the owner receives the tombstone too
    // (gaps-5's owner-exclusion applies only to the purge-only album/library arms). Benign: restore round-trips.
    const ownerNext = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const ownerDeletes = ownerNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1,
    );
    expect(ownerDeletes).toHaveLength(1);
  });

  it('emits a direct-path delete tombstone to both the member and the owner when flipped to Locked', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id, memberAuth.user.id);

    const ownerInitial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(ownerAuth, ownerInitial);
    const memberInitial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(memberAuth, memberInitial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Locked purge uses the same direct-path tombstone mechanism.
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

    const memberNext = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const memberDeletes = memberNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1,
    );
    expect(memberDeletes).toHaveLength(1);
    expect((memberDeletes[0] as { data: { spaceId: string; assetId: string } }).data).toMatchObject({
      spaceId: space.id,
      assetId: asset.id,
    });

    const ownerNext = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const ownerDeletes = ownerNext.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1,
    );
    expect(ownerDeletes).toHaveLength(1);
  });

  it('re-emits an upsert for a directly-added asset restored to Timeline after being purged', async () => {
    const { auth, ctx } = await setup();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, auth.user.id);

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Purge, ack the delete, then restore.
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);
    const afterPurge = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(auth, afterPurge);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Restore to Timeline — updateId bump must re-emit the join row via getUpserts.
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([asset.id]);

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const upsertEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetV1);
    const emitted = upsertEvents.map((e) => (e as { data: { spaceId: string; assetId: string } }).data);
    expect(emitted).toContainEqual(expect.objectContaining({ spaceId: space.id, assetId: asset.id }));
  });

  it('emits nothing when purging an asset that is not in any space', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });

    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const deleteEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1);
    const joinEvents = response.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
    );
    expect(deleteEvents).toHaveLength(0);
    expect(joinEvents).toHaveLength(0);
  });

  it('is a no-op on an empty id list', async () => {
    const { ctx } = await setup();
    await expect(ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([])).resolves.not.toThrow();
    await expect(ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([])).resolves.not.toThrow();
  });

  // gaps-5 regression guard: shared_space_asset_audit is DUAL-PURPOSE — the visibility-purge arm added
  // above excludes the owner, but a PHYSICAL asset delete (asset row gone, FK cascade fires
  // shared_space_asset_delete_audit) must still reach the owner, since the owner's own device also needs
  // to drop the asset. The LEFT JOIN + null-owner disjunct in getDeletes exists precisely for this case.
  it('a PHYSICAL asset delete still reaches the owner via getDeletes (LEFT JOIN null-owner regression)', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id);

    const initial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(ownerAuth, initial);
    await ctx.assertSyncIsComplete(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Hard-delete the asset row — cascades to shared_space_asset, firing shared_space_asset_delete_audit
    // (the OLD row values are captured; the asset row itself is now gone).
    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

    const next = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1);
    expect(deleteEvents).toHaveLength(1);
    expect((deleteEvents[0] as { data: { spaceId: string; assetId: string } }).data).toMatchObject({
      spaceId: space.id,
      assetId: asset.id,
    });
  });

  // correctness-1: restore bumps the join-row updateId; a later hide writes a tombstone. In one sync
  // window the handler streams deletes BEFORE upserts, so without the gate the pending updateId-bumped
  // link row RE-ADDS the now-Hidden asset after the delete drops it (resurrection). The flat gate on
  // getUpserts blocks the re-add → the member converges to ABSENT.
  it('correctness-1: restore-then-hide within one window does NOT resurrect the asset for a member', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id, memberAuth.user.id);

    // Member already synced the asset while Timeline.
    const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(memberAuth, initial);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

    // Restore (updateId bump) then hide (tombstone), both after the ack, in one window.
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([asset.id]);
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

    const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const upserts = next
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetV1)
      .map((e) => (e as { data: { spaceId: string; assetId: string } }).data);
    const deletes = next
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1)
      .map((e) => (e as { data: { spaceId: string; assetId: string } }).data);

    // The tombstone drops the link; the flat gate blocks the stale-updateId re-add → converge to absent.
    expect(deletes).toContainEqual(expect.objectContaining({ spaceId: space.id, assetId: asset.id }));
    expect(upserts).not.toContainEqual(expect.objectContaining({ spaceId: space.id, assetId: asset.id }));

    // Ack all; the next window must be empty (no re-delivery from the stale updateId).
    await ctx.syncAckAll(memberAuth, next);
    await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  });

  // correctness-1 edge: a member backfilling a space AFTER an asset was purged/hidden must not receive
  // the tombstoned link row via the backfill path.
  it('correctness-1: backfill after a purge does NOT re-deliver the Hidden asset link row', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id);

    // Hide + purge before any member has synced.
    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

    // A fresh member joins and backfills the space.
    const { auth: memberAuth } = await ctx.newSyncAuthUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });

    const next = await ctx.syncStream(memberAuth, [
      SyncRequestType.SharedSpacesV1,
      SyncRequestType.SharedSpaceToAssetsV1,
    ]);
    const joinEvents = next.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
    );
    expect(joinEvents.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);
  });

  // Owner-stream consistency with slice 3: the owner-gated tombstone means an already-synced owner keeps
  // their own Hidden asset (no delete). The FLAT upsert gate (slice 4) means a FRESH owner backfill omits
  // that same Hidden link row — identical to the SharedSpaceAssetsV1 content stream, which also omits it.
  // Pins the flat decision; the deferred "owner sees own hidden" feature would flip BOTH streams together.
  it('owner consistency: owner drops an already-synced Hidden asset (direct delete) and a fresh backfill omits it (flat gate)', async () => {
    const { auth: ownerAuth, ctx } = await setup();
    const { asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id);

    const initial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    await ctx.syncAckAll(ownerAuth, initial);
    await ctx.assertSyncIsComplete(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

    await defaultDatabase
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Hidden })
      .where('id', '=', asset.id)
      .execute();
    await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

    // The DIRECT arm is not owner-gated (dual-purpose table), so the owner DOES receive the delete —
    // which is the consistent outcome: it converges the already-synced device to the same state the flat
    // backfill gate produces (asset omitted). gaps-5's owner-exclusion applies only to the album/library arms.
    const afterHide = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
    const ownerDeletes = afterHide.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1,
    );
    expect(ownerDeletes).toHaveLength(1);

    // slice 4 flat gate: a FRESH (reset) backfill omits the owner's own Hidden link row...
    const reset = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1], true);
    const resetLinks = reset.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
    );
    expect(resetLinks.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);

    // ...matching the content stream, which also omits it for the owner (both flat).
    const content = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceAssetsV1], true);
    const contentAssetEvents = content.filter(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetBackfillV1,
    );
    expect(contentAssetEvents.map((e) => (e as { data: { id: string } }).data.id)).not.toContain(asset.id);
  });
});
