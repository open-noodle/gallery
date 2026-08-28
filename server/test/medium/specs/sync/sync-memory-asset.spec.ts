import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { MemoryRepository } from 'src/repositories/memory.repository';
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

describe(SyncEntityType.MemoryToAssetV1, () => {
  it('should detect and sync a memory to asset relation', async () => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { memory } = await ctx.newMemory({ ownerId: user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.MemoryToAssetsV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          memoryId: memory.id,
          assetId: asset.id,
        },
        type: 'MemoryToAssetV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoryToAssetsV1]);
  });

  it('should detect and sync a deleted memory to asset relation', async () => {
    const { auth, user, ctx } = await setup();
    const memoryRepo = ctx.get(MemoryRepository);
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { memory } = await ctx.newMemory({ ownerId: user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });
    await memoryRepo.removeAssetIds(memory.id, [asset.id]);

    const response = await ctx.syncStream(auth, [SyncRequestType.MemoryToAssetsV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          assetId: asset.id,
          memoryId: memory.id,
        },
        type: 'MemoryToAssetDeleteV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoryToAssetsV1]);
  });

  it('should not sync a memory to asset relation or delete for an unrelated user', async () => {
    const { auth, ctx } = await setup();
    const memoryRepo = ctx.get(MemoryRepository);
    const { auth: auth2, user: user2 } = await ctx.newSyncAuthUser();
    const { asset } = await ctx.newAsset({ ownerId: user2.id });
    const { memory } = await ctx.newMemory({ ownerId: user2.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });

    expect(await ctx.syncStream(auth2, [SyncRequestType.MemoryToAssetsV1])).toEqual([
      expect.objectContaining({ type: SyncEntityType.MemoryToAssetV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoryToAssetsV1]);

    await memoryRepo.removeAssetIds(memory.id, [asset.id]);

    expect(await ctx.syncStream(auth2, [SyncRequestType.MemoryToAssetsV1])).toEqual([
      expect.objectContaining({ type: SyncEntityType.MemoryToAssetDeleteV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoryToAssetsV1]);
  });
  // gallery-fork regression: a memory may legitimately reference an asset owned by someone else
  // and reached through a shared space — MemoryRepository.search gates memory assets on
  // visibility, not ownership, and the seeded demo memories rely on exactly that. Mobile's
  // memory_asset_entity FKs assetId → remote_asset_entity, so if the MemoryToAssetV1 link row
  // streams before the SharedSpaceAsset* row that creates the asset locally, the Drift batch dies
  // with SQLITE_CONSTRAINT_FOREIGNKEY (787), the stream aborts, the batch is never acked, and the
  // client re-runs the same failing checkpoint forever. Asset rows must land first.
  it('should stream a space-shared asset before the memory link that references it', async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();

    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Viewer });

    // Owned by the peer, reachable by the syncing user only through the space.
    const { asset } = await ctx.newAsset({ ownerId: peer.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    // ...but referenced by a memory the syncing user owns.
    const { memory } = await ctx.newMemory({ ownerId: auth.user.id });
    await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [
      SyncRequestType.MemoriesV1,
      SyncRequestType.MemoryToAssetsV1,
      SyncRequestType.SharedSpacesV1,
      SyncRequestType.SharedSpaceMembersV1,
      SyncRequestType.SharedSpaceAssetsV1,
    ]);

    const types = (response as { type: string }[]).map((event) => event.type);
    const assetIndex = types.findIndex((type) =>
      [
        SyncEntityType.SharedSpaceAssetCreateV1,
        SyncEntityType.SharedSpaceAssetUpdateV1,
        SyncEntityType.SharedSpaceAssetBackfillV1,
      ].includes(type as SyncEntityType),
    );
    const memoryIndex = types.indexOf(SyncEntityType.MemoryV1);
    const linkIndex = types.indexOf(SyncEntityType.MemoryToAssetV1);

    expect(assetIndex).toBeGreaterThan(-1);
    expect(linkIndex).toBeGreaterThan(-1);
    expect(assetIndex).toBeLessThan(linkIndex);
    expect(memoryIndex).toBeLessThan(linkIndex);
  });
});
