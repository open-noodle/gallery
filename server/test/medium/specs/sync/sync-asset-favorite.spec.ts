import { Kysely } from 'kysely';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// #763 slice 6 (design doc §4.3): asset_favorite is its own synced entity, because a non-owner's
// favorite write must never bump asset.updateId — that would amplify a personal write into a
// cross-user re-sync of the underlying asset. Modeled directly on sync-asset-edit.spec.ts / AssetEditSync:
// flat caller-scoped table, getUpserts + getDeletes, no backfill loop.

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.AssetFavoritesV1, () => {
  it('should sync an existing favorite on initial sync', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);
    await favoriteRepo.addAll(user.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: { assetId: asset.id },
        type: SyncEntityType.AssetFavoriteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);
  });

  it('should sync a new favorite created after the checkpoint', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    // Establish a checkpoint with nothing favorited yet.
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);

    await favoriteRepo.addAll(user.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: { assetId: asset.id },
        type: SyncEntityType.AssetFavoriteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);
  });

  it('should sync an unfavorite as a tombstone delete', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);
    await favoriteRepo.addAll(user.id, [asset.id]);

    const response1 = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    await ctx.syncAckAll(auth, response1);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);

    await favoriteRepo.removeAll(user.id, [asset.id]);

    const response2 = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response2).toEqual([
      {
        ack: expect.any(String),
        data: { assetId: asset.id },
        type: SyncEntityType.AssetFavoriteDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response2);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);
  });

  // §3 core invariant: "No cross-user read. A favorite row for user B never surfaces in user
  // A's response payload ... sync stream." Both users favorite the SAME asset — the classic
  // trap here is forgetting `.where('asset_favorite.userId', '=', options.userId)`, which would
  // let A's stream also pick up B's row on that assetId (same assetId, so it wouldn't fail on a
  // simple "wrong id" assertion; it fails on emitting two events instead of one).
  it('should isolate favorites per user on the same asset, in both directions (§3)', async () => {
    const { auth: authA, user: userA, ctx } = await setup();
    const { user: userB } = await ctx.newUser();
    const { session: sessionB } = await ctx.newSession({ userId: userB.id });
    const authB = factory.auth({ session: sessionB, user: userB });

    const { asset } = await ctx.newAsset({ ownerId: userA.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    await favoriteRepo.addAll(userA.id, [asset.id]);
    await favoriteRepo.addAll(userB.id, [asset.id]);

    const responseA = await ctx.syncStream(authA, [SyncRequestType.AssetFavoritesV1]);
    expect(responseA).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    const responseB = await ctx.syncStream(authB, [SyncRequestType.AssetFavoritesV1]);
    expect(responseB).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(authA, responseA);
    await ctx.syncAckAll(authB, responseB);
    await ctx.assertSyncIsComplete(authA, [SyncRequestType.AssetFavoritesV1]);
    await ctx.assertSyncIsComplete(authB, [SyncRequestType.AssetFavoritesV1]);

    // Reverse direction: unfavoriting user B's row must not surface as a delete in user A's
    // stream — isolation holds for the tombstone side too, not just the upsert side.
    await favoriteRepo.removeAll(userB.id, [asset.id]);
    await ctx.assertSyncIsComplete(authA, [SyncRequestType.AssetFavoritesV1]);

    const responseB2 = await ctx.syncStream(authB, [SyncRequestType.AssetFavoritesV1]);
    expect(responseB2).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteDeleteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  // E26: mobile unfavorite-while-offline-then-resync must converge to the user's actual intent,
  // with no duplicate or stale terminal state left over from the intermediate toggle.
  it('should converge after favorite -> unfavorite -> favorite across checkpoints (E26)', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    await favoriteRepo.addAll(user.id, [asset.id]);
    const response1 = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response1).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, response1);

    await favoriteRepo.removeAll(user.id, [asset.id]);
    const response2 = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response2).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteDeleteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, response2);

    await favoriteRepo.addAll(user.id, [asset.id]);
    const response3 = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1]);
    expect(response3).toEqual([
      { ack: expect.any(String), data: { assetId: asset.id }, type: SyncEntityType.AssetFavoriteV1 },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, response3);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetFavoritesV1]);

    // A full resync from empty must converge to the same terminal state. The delete-audit
    // tombstone for the intermediate unfavorite is still inside the (uncleaned) audit table, so
    // a full resync legitimately replays it — same as every other delete-then-upsert entity in
    // this file (e.g. AssetOcrSync's upsert-deletes-then-inserts, sync-asset-ocr.spec.ts
    // "should update asset OCR"). Convergence means: applied in the order sent (deletes before
    // upserts, per syncAssetFavoritesV1), the LAST event for this assetId is the upsert — the
    // client ends up favorited, not stuck on a stale delete.
    const fullResync = await ctx.syncStream(auth, [SyncRequestType.AssetFavoritesV1], true);
    const events = fullResync.filter(
      (event): event is { type: SyncEntityType; data: { assetId: string } } =>
        (event.type === SyncEntityType.AssetFavoriteV1 || event.type === SyncEntityType.AssetFavoriteDeleteV1) &&
        event.data.assetId === asset.id,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: SyncEntityType.AssetFavoriteV1 });
  });
});

// §4.3: a NON-OWNER's favorite write must not amplify onto the AssetsV2 stream — if it bumped
// asset.updateId, every device that already has the asset would re-sync it just because
// someone else favorited it. An OWNER's favorite does bump it, exactly as the pre-#763 column
// write did, so apps that predate AssetFavoritesV1 still propagate it to the owner's other devices.
const getUpdateId = (ctx: SyncTestContext, assetId: string) =>
  ctx.database.selectFrom('asset').select('updateId').where('id', '=', assetId).executeTakeFirstOrThrow();

describe('§4.3 cross-stream amplification', () => {
  it('does not re-emit the asset on AssetsV2 when a non-owner favorites it', async () => {
    const { auth, user, ctx } = await setup();
    const { user: other } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    const assetsResponse = await ctx.syncStream(auth, [SyncRequestType.AssetsV2]);
    await ctx.syncAckAll(auth, assetsResponse);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetsV2]);

    const before = await getUpdateId(ctx, asset.id);
    await favoriteRepo.addAll(other.id, [asset.id]);
    await favoriteRepo.removeAll(other.id, [asset.id]);
    const after = await getUpdateId(ctx, asset.id);

    expect(after.updateId).toBe(before.updateId);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetsV2]);
  });

  it('re-emits the asset on AssetsV2 with the new state when the owner favorites or unfavorites it', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    await ctx.syncAckAll(auth, await ctx.syncStream(auth, [SyncRequestType.AssetsV2]));

    await favoriteRepo.addAll(user.id, [asset.id]);
    const favorited = await ctx.syncStream(auth, [SyncRequestType.AssetsV2]);
    expect(favorited).toEqual([
      expect.objectContaining({
        type: SyncEntityType.AssetV2,
        data: expect.objectContaining({ id: asset.id, isFavorite: true }),
      }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.syncAckAll(auth, favorited);

    await favoriteRepo.removeAll(user.id, [asset.id]);
    const unfavorited = await ctx.syncStream(auth, [SyncRequestType.AssetsV2]);
    expect(unfavorited).toEqual([
      expect.objectContaining({
        type: SyncEntityType.AssetV2,
        data: expect.objectContaining({ id: asset.id, isFavorite: false }),
      }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('does not bump the asset when the favorite state did not change', async () => {
    const { user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const favoriteRepo = ctx.get(AssetFavoriteRepository);

    await favoriteRepo.addAll(user.id, [asset.id]);
    const before = await getUpdateId(ctx, asset.id);
    await favoriteRepo.addAll(user.id, [asset.id]);
    const after = await getUpdateId(ctx, asset.id);

    expect(after.updateId).toBe(before.updateId);
  });
});
