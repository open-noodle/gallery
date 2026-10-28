import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB, wait } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const ctx = new SyncTestContext(defaultDatabase);
  const { auth } = await ctx.newSyncAuthUser();
  return { auth, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

type Auth = Awaited<ReturnType<typeof setup>>['auth'];
type StackEvent = { type: SyncEntityType; data: { id: string; primaryAssetId: string } };

const types = [SyncRequestType.SharedSpaceStacksV1];

const stacks = (response: unknown[]) =>
  (response as StackEvent[]).filter(
    (event) => event.type !== SyncEntityType.SyncAckV1 && 'primaryAssetId' in event.data,
  );

const stackIds = (response: unknown[]) => [...new Set(stacks(response).map((event) => event.data.id))];

const syncAndAck = async (ctx: SyncTestContext, auth: Auth) => {
  const response = await ctx.syncStream(auth, types);
  await ctx.syncAckAll(auth, response);
  return response;
};

/** A space owned by a peer, with the syncing user as an editor. */
const newPeerSpace = async (ctx: SyncTestContext, userId: string) => {
  const { user: peer } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: peer.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId, role: SharedSpaceRole.Editor });
  return { peer, space };
};

/** A space the syncing user is not in. */
const newStrangerSpace = async (ctx: SyncTestContext) => {
  const { user: stranger } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: stranger.id, role: SharedSpaceRole.Owner });
  return { stranger, space };
};

/** An edit and its original, stacked with the edit as the cover. */
const newStack = async (
  ctx: SyncTestContext,
  ownerId: string,
  { libraryId, visibility }: { libraryId?: string; visibility?: AssetVisibility } = {},
) => {
  const { asset: edit } = await ctx.newAsset({ ownerId, libraryId, visibility });
  const { asset: original } = await ctx.newAsset({ ownerId, libraryId });
  const { stack } = await ctx.newStack({ ownerId }, [edit.id, original.id]);
  return { stack, edit, original, assetIds: [edit.id, original.id] };
};

const share = async (ctx: SyncTestContext, spaceId: string, assetIds: string[]) => {
  for (const assetId of assetIds) {
    await ctx.newSharedSpaceAsset({ spaceId, assetId });
  }
};

/** Bumps an asset row, as any metadata change does. */
const touch = (assetId: string) =>
  defaultDatabase.updateTable('asset').set({ originalFileName: 'touched.jpg' }).where('id', '=', assetId).execute();

const show = (assetId: string) =>
  defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Timeline })
    .where('id', '=', assetId)
    .execute();

const setCover = (ctx: SyncTestContext, stackId: string, primaryAssetId: string) =>
  ctx.get(StackRepository).update(stackId, { primaryAssetId });

describe(SyncRequestType.SharedSpaceStacksV1, () => {
  describe('photos added to a space', () => {
    it("sends a member's stack", async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, assetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, assetIds);

      const response = await syncAndAck(ctx, auth);
      expect(stacks(response).map(({ data }) => data)).toContainEqual({
        id: stack.id,
        ownerId: peer.id,
        primaryAssetId: stack.primaryAssetId,
        createdAt: (stack.createdAt as Date).toISOString(),
        updatedAt: (stack.updatedAt as Date).toISOString(),
      });
      expect(stackIds(response)).toEqual([stack.id]);
      await ctx.assertSyncIsComplete(auth, types);
    });

    it('sends a stack whose photos are shared after the first sync', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, assetIds } = await newStack(ctx, peer.id);
      const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, otherAssetIds);
      await syncAndAck(ctx, auth);

      await share(ctx, space.id, assetIds);

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
    });

    it('sends a stack made from photos already shared', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { asset: edit } = await ctx.newAsset({ ownerId: peer.id });
      const { asset: original } = await ctx.newAsset({ ownerId: peer.id });
      await share(ctx, space.id, [edit.id, original.id]);
      await syncAndAck(ctx, auth);

      await wait(2);
      const { stack } = await ctx.newStack({ ownerId: peer.id }, [edit.id, original.id]);

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
      await ctx.assertSyncIsComplete(auth, types);
    });

    it('sends a new cover', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, edit, original } = await newStack(ctx, peer.id);
      // The original's row comes first, so only the stack row can bring the new cover.
      await share(ctx, space.id, [original.id]);
      await wait(2);
      await share(ctx, space.id, [edit.id]);
      await syncAndAck(ctx, auth);

      await wait(2);
      await setCover(ctx, stack.id, original.id);

      expect(stacks(await syncAndAck(ctx, auth)).map(({ data }) => data)).toEqual([
        expect.objectContaining({ id: stack.id, primaryAssetId: original.id }),
      ]);
    });

    it('sends the stack of a trashed cover, so that restoring it shows the stack', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, assetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, assetIds);
      await defaultDatabase.updateTable('asset').set({ deletedAt: new Date() }).where('id', 'in', assetIds).execute();

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
    });

    it('sends the stack again when its cover is shown again', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const hidden = await newStack(ctx, peer.id, { visibility: AssetVisibility.Hidden });
      await share(ctx, space.id, hidden.assetIds);
      await wait(2);
      const visible = await newStack(ctx, peer.id);
      await share(ctx, space.id, visible.assetIds);
      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([visible.stack.id]);

      await show(hidden.edit.id);
      await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([hidden.edit.id]);

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([hidden.stack.id]);
    });

    it('does not send a stack whose cover is not in the space', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { original } = await newStack(ctx, peer.id);
      await share(ctx, space.id, [original.id]);

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('does not send the stack of a locked cover', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { assetIds } = await newStack(ctx, peer.id, { visibility: AssetVisibility.Locked });
      await share(ctx, space.id, assetIds);

      await ctx.assertSyncIsComplete(auth, types);
    });

    it("does not send the user's own stacks, which StacksV1 sends", async () => {
      const { auth, ctx } = await setup();
      const { space } = await newPeerSpace(ctx, auth.user.id);
      const { assetIds: otherAssetIds } = await newStack(ctx, auth.user.id);
      await share(ctx, space.id, otherAssetIds);

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('does not send stacks from a space the user is not in', async () => {
      const { auth, ctx } = await setup();
      const { stranger, space } = await newStrangerSpace(ctx);
      const { assetIds: otherAssetIds } = await newStack(ctx, stranger.id);
      await share(ctx, space.id, otherAssetIds);

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('backfills the stacks of a space the user joins', async () => {
      const { auth, ctx } = await setup();
      const { stranger, space: oldSpace } = await newStrangerSpace(ctx);
      const { stack: oldStack, assetIds } = await newStack(ctx, stranger.id);
      await share(ctx, oldSpace.id, assetIds);
      await wait(2);
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, otherAssetIds);
      await syncAndAck(ctx, auth);

      await ctx.newSharedSpaceMember({ spaceId: oldSpace.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });

      const response = await syncAndAck(ctx, auth);
      expect(stacks(response)).toEqual([
        expect.objectContaining({
          type: SyncEntityType.SharedSpaceStackBackfillV1,
          data: expect.objectContaining({ id: oldStack.id }),
        }),
      ]);
      await ctx.assertSyncIsComplete(auth, types);
    });

    it('stops sending a stack once the user has left the space', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, original, assetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, assetIds);
      await syncAndAck(ctx, auth);

      await ctx.get(SharedSpaceRepository).removeMember(space.id, auth.user.id);
      await setCover(ctx, stack.id, original.id);

      await ctx.assertSyncIsComplete(auth, types);
    });

    it("sends a delete when a member's stack is deleted", async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, assetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, assetIds);
      await syncAndAck(ctx, auth);

      await ctx.get(StackRepository).delete(stack.id);

      expect(await syncAndAck(ctx, auth)).toEqual([
        {
          ack: expect.stringContaining(SyncEntityType.SharedSpaceStackDeleteV1),
          type: SyncEntityType.SharedSpaceStackDeleteV1,
          data: { stackId: stack.id },
        },
        expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
      ]);
    });

    it('does not send stack deletes of users the user shares no space with', async () => {
      const { auth, ctx } = await setup();
      const { user: stranger } = await ctx.newUser();
      const { stack } = await newStack(ctx, stranger.id);
      await ctx.get(StackRepository).delete(stack.id);

      await ctx.assertSyncIsComplete(auth, types);
    });
  });

  describe('photos in an album linked to a space', () => {
    it("sends a member's stack from the album", async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, assetIds } = await newStack(ctx, peer.id);
      const { album } = await ctx.newAlbum({ ownerId: peer.id }, assetIds);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
      await ctx.assertSyncIsComplete(auth, types);
    });

    it('sends a stack whose cover is added to the album after the first sync', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, edit } = await newStack(ctx, peer.id);
      const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
      const { album } = await ctx.newAlbum({ ownerId: peer.id }, otherAssetIds);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await syncAndAck(ctx, auth);

      await ctx.newAlbumAsset({ albumId: album.id, assetId: edit.id });

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
    });

    it('sends a stack a member contributes to the album after the first sync', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      const { stack, edit } = await newStack(ctx, peer.id);
      const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
      await share(ctx, space.id, otherAssetIds);
      await syncAndAck(ctx, auth);

      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: edit.id, spaceId: space.id, addedById: peer.id });

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
    });

    it('does not send a contribution to a member of another space the album is linked to', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { space: otherSpace } = await newStrangerSpace(ctx);
      const { album } = await ctx.newAlbum({ ownerId: peer.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await ctx.newSharedSpaceAlbum({ spaceId: otherSpace.id, albumId: album.id });
      const { edit } = await newStack(ctx, peer.id);
      await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: edit.id, spaceId: otherSpace.id, addedById: peer.id });

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('does not send stacks from an album linked to a space the user is not in', async () => {
      const { auth, ctx } = await setup();
      const { stranger, space } = await newStrangerSpace(ctx);
      const { assetIds: otherAssetIds } = await newStack(ctx, stranger.id);
      const { album } = await ctx.newAlbum({ ownerId: stranger.id }, otherAssetIds);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('sends a new cover', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack, edit, original } = await newStack(ctx, peer.id);
      // The original's row comes first, so only the stack row can bring the new cover.
      const { album } = await ctx.newAlbum({ ownerId: peer.id }, [original.id]);
      await wait(2);
      await ctx.newAlbumAsset({ albumId: album.id, assetId: edit.id });
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await syncAndAck(ctx, auth);

      await wait(2);
      await setCover(ctx, stack.id, original.id);

      expect(stacks(await syncAndAck(ctx, auth)).map(({ data }) => data)).toEqual([
        expect.objectContaining({ id: stack.id, primaryAssetId: original.id }),
      ]);
    });

    it('sends the stack again when its cover is shown again', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const hidden = await newStack(ctx, peer.id, { visibility: AssetVisibility.Hidden });
      const { album } = await ctx.newAlbum({ ownerId: peer.id }, hidden.assetIds);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await wait(2);
      const visible = await newStack(ctx, peer.id);
      for (const assetId of visible.assetIds) {
        await ctx.newAlbumAsset({ albumId: album.id, assetId });
      }
      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([visible.stack.id]);

      await show(hidden.edit.id);
      await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([hidden.edit.id]);

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([hidden.stack.id]);
    });

    it('backfills the stacks of an album linked later', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { stack: oldStack, assetIds: oldAssetIds } = await newStack(ctx, peer.id);
      const { album: oldAlbum } = await ctx.newAlbum({ ownerId: peer.id }, oldAssetIds);
      await wait(2);
      const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
      const { album } = await ctx.newAlbum({ ownerId: peer.id }, otherAssetIds);
      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
      await syncAndAck(ctx, auth);

      await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: oldAlbum.id });

      expect(stacks(await syncAndAck(ctx, auth))).toEqual([
        expect.objectContaining({
          type: SyncEntityType.SharedSpaceStackAlbumBackfillV1,
          data: expect.objectContaining({ id: oldStack.id }),
        }),
      ]);
      await ctx.assertSyncIsComplete(auth, types);
    });
  });

  describe('photos in a library linked to a space', () => {
    it("sends a member's stack from the library", async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { library } = await ctx.newLibrary({ ownerId: peer.id });
      const { stack } = await newStack(ctx, peer.id, { libraryId: library.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: peer.id });

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([stack.id]);
      await ctx.assertSyncIsComplete(auth, types);
    });

    it('does not send stacks from a library linked to a space the user is not in', async () => {
      const { auth, ctx } = await setup();
      const { stranger, space } = await newStrangerSpace(ctx);
      const { library } = await ctx.newLibrary({ ownerId: stranger.id });
      await newStack(ctx, stranger.id, { libraryId: library.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: stranger.id });

      await ctx.assertSyncIsComplete(auth, types);
    });

    it('sends a new cover', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { library } = await ctx.newLibrary({ ownerId: peer.id });
      const { stack, edit, original } = await newStack(ctx, peer.id, { libraryId: library.id });
      // The cover's row comes last, so only the stack row can bring the new cover.
      await wait(2);
      await touch(edit.id);
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: peer.id });
      await syncAndAck(ctx, auth);

      await wait(2);
      await setCover(ctx, stack.id, original.id);

      expect(stacks(await syncAndAck(ctx, auth)).map(({ data }) => data)).toEqual([
        expect.objectContaining({ id: stack.id, primaryAssetId: original.id }),
      ]);
    });

    it('sends the stack again when its cover is shown again', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { library } = await ctx.newLibrary({ ownerId: peer.id });
      const hidden = await newStack(ctx, peer.id, { libraryId: library.id, visibility: AssetVisibility.Hidden });
      await wait(2);
      const visible = await newStack(ctx, peer.id, { libraryId: library.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: peer.id });
      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([visible.stack.id]);

      await show(hidden.edit.id);

      expect(stackIds(await syncAndAck(ctx, auth))).toEqual([hidden.stack.id]);
    });

    it('backfills the stacks of a library linked later', async () => {
      const { auth, ctx } = await setup();
      const { peer, space } = await newPeerSpace(ctx, auth.user.id);
      const { library: oldLibrary } = await ctx.newLibrary({ ownerId: peer.id });
      const { stack: oldStack } = await newStack(ctx, peer.id, { libraryId: oldLibrary.id });
      await wait(2);
      const { library } = await ctx.newLibrary({ ownerId: peer.id });
      await newStack(ctx, peer.id, { libraryId: library.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: peer.id });
      await syncAndAck(ctx, auth);

      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: oldLibrary.id, addedById: peer.id });

      expect(stacks(await syncAndAck(ctx, auth))).toEqual([
        expect.objectContaining({
          type: SyncEntityType.SharedSpaceStackLibraryBackfillV1,
          data: expect.objectContaining({ id: oldStack.id }),
        }),
      ]);
      await ctx.assertSyncIsComplete(auth, types);
    });
  });

  it('backfills the linked albums and libraries of a space the user joins', async () => {
    const { auth, ctx } = await setup();
    const { stranger, space: oldSpace } = await newStrangerSpace(ctx);
    const { stack: albumStack, assetIds } = await newStack(ctx, stranger.id);
    const { album } = await ctx.newAlbum({ ownerId: stranger.id }, assetIds);
    await ctx.newSharedSpaceAlbum({ spaceId: oldSpace.id, albumId: album.id });
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    const { stack: libraryStack } = await newStack(ctx, stranger.id, { libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: oldSpace.id, libraryId: library.id, addedById: stranger.id });
    await wait(2);
    const { peer, space } = await newPeerSpace(ctx, auth.user.id);
    const { assetIds: otherAssetIds } = await newStack(ctx, peer.id);
    await share(ctx, space.id, otherAssetIds);
    await syncAndAck(ctx, auth);

    await ctx.newSharedSpaceMember({ spaceId: oldSpace.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });

    const response = await syncAndAck(ctx, auth);
    expect(stacks(response).map(({ type, data }) => [type, data.id])).toEqual([
      [SyncEntityType.SharedSpaceStackAlbumBackfillV1, albumStack.id],
      [SyncEntityType.SharedSpaceStackLibraryBackfillV1, libraryStack.id],
    ]);
    await ctx.assertSyncIsComplete(auth, types);
  });
});
