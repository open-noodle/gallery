import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Task 5 (#764 slice 5) — service-level convergence guard for cross-owner contributions
// (album_space_asset). Drives the real SyncService seam via SyncTestContext.syncStream /
// syncAckAll / assertSyncIsComplete — the same harness sync-shared-space-album.spec.ts uses —
// end to end, proving three properties already delivered by Tasks 2-4:
//
//   1. Backfill-on-join: a member who JOINS a space that already has a contribution
//      backfills the membership edge AND the asset payload.
//   2. Watermark monotonicity: after acking at the max emitted updateId, a re-sync does
//      NOT re-emit the same contribution.
//   3. No spurious asset deletion: removing a contribution edge emits the (albumId, assetId)
//      delete, but the underlying asset row is never touched.
//
// This is a regression guard, not a strict red-first TDD spec — the behavior under test was
// implemented in Tasks 2-4 (commits d7ec235907, 59ac50a6e8, bf90f40e1f). See task-5-report.md
// for which assertions were red-first vs. green-from-start.

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const isMembershipEvent = (r: { type: string }) =>
  r.type === SyncEntityType.SharedSpaceAlbumToAssetV1 || r.type === SyncEntityType.SharedSpaceAlbumToAssetBackfillV1;

const isMembershipDeleteEvent = (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1;

const isAssetEvent = (r: { type: string }) =>
  r.type === SyncEntityType.SharedSpaceAlbumAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAlbumAssetBackfillV1;

describe('Contribution sync convergence (album_space_asset) — service-level', () => {
  it(
    'backfills a pre-existing contribution on join, is monotonic after ack, and never deletes ' +
      'the underlying asset when the contribution edge is removed',
    async () => {
      const { auth: memberAuth, ctx } = await setup();
      const { user: owner } = await ctx.newUser();
      const { user: carol } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: carol.id }); // owned by someone else — a contribution
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      // Contribution (album, asset, space) exists BEFORE member ever joins S.
      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id, addedById: carol.id });

      // Sanity: member is not yet in S, so the membership stream carries no trace of this edge.
      const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      expect(
        initial
          .filter((r) => isMembershipEvent(r))
          .some((r) => (r as { data: { albumId: string } }).data.albumId === album.id),
      ).toBe(false);
      await ctx.syncAckAll(memberAuth, initial);

      // ── 1. Backfill-on-join ──────────────────────────────────────────────────
      // member JOINS S (Editor) — fires the #752 grant trigger, exposing the pre-existing
      // contribution.
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });

      const membershipResponse = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const membershipEvents = membershipResponse.filter((r) => isMembershipEvent(r));
      expect(
        membershipEvents.some(
          (r) =>
            (r as { data: { albumId: string; assetId: string } }).data.albumId === album.id &&
            (r as { data: { albumId: string; assetId: string } }).data.assetId === asset.id,
        ),
      ).toBe(true);

      // The membership edge must be acked before the asset-payload stream fires for it
      // (existing house convention — see sync-shared-space-album.spec.ts scenario 1).
      await ctx.syncAckAll(memberAuth, membershipResponse);

      const assetResponse = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumAssetsV1]);
      const assetEvents = assetResponse.filter((r) => isAssetEvent(r));
      expect(assetEvents.some((r) => (r as { data: { id: string } }).data.id === asset.id)).toBe(true);
      await ctx.syncAckAll(memberAuth, assetResponse);

      // ── 2. Watermark monotonicity ────────────────────────────────────────────
      // Having acked at the max emitted updateId, re-running the membership sync must NOT
      // re-emit the same (albumId, assetId) contribution — assertSyncIsComplete demands the
      // stream carries nothing but SyncCompleteV1.
      await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

      // ── 3. No spurious asset deletion ────────────────────────────────────────
      // Removing the contribution edge (not the asset) must emit a delete for the edge only.
      await defaultDatabase
        .deleteFrom('album_space_asset')
        .where('albumId', '=', album.id)
        .where('assetId', '=', asset.id)
        .execute();

      const deleteResponse = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
      const deleteEvents = deleteResponse.filter((r) => isMembershipDeleteEvent(r));
      expect(
        deleteEvents.some(
          (r) =>
            (r as { data: { albumId: string; assetId: string } }).data.albumId === album.id &&
            (r as { data: { albumId: string; assetId: string } }).data.assetId === asset.id,
        ),
      ).toBe(true);

      // The underlying asset row must still exist — removing a contribution edge never
      // deletes the asset itself.
      const assetRow = await defaultDatabase
        .selectFrom('asset')
        .selectAll()
        .where('id', '=', asset.id)
        .executeTakeFirst();
      expect(assetRow).toBeDefined();
      expect(assetRow?.id).toBe(asset.id);
    },
  );
});
