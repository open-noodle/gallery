import { Kysely } from 'kysely';
import { MemoryType, SyncEntityType, SyncRequestType } from 'src/enum.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncEntityType.MemoryV1, () => {
  it('should detect and sync the first memory with the right properties', async () => {
    const { auth, user: user1, ctx } = await setup();
    const { memory } = await ctx.newMemory({ ownerId: user1.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.MemoriesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          id: memory.id,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          deletedAt: memory.deletedAt,
          type: memory.type,
          data: memory.data,
          hideAt: memory.hideAt,
          showAt: memory.showAt,
          seenAt: memory.seenAt,
          memoryAt: expect.any(String),
          isSaved: memory.isSaved,
          ownerId: memory.ownerId,
        },
        type: 'MemoryV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoriesV1]);
  });

  // OD-3: each client class gets the memory types, and the photo links of those types, that it can decode. Upstream
  // keeps `birthday` off V1; `rule` is Gallery's and reaches fork-aware clients (those requesting SharedSpacesV1) only.
  it.each([
    ['a stock client on V1', [SyncRequestType.MemoriesV1, SyncRequestType.MemoryToAssetsV1], ['on_this_day']],
    [
      'a stock client on V2',
      [SyncRequestType.MemoriesV2, SyncRequestType.MemoryToAssetsV2],
      ['birthday', 'on_this_day'],
    ],
    [
      'a Gallery client on V1',
      [SyncRequestType.MemoriesV1, SyncRequestType.MemoryToAssetsV1, SyncRequestType.SharedSpacesV1],
      ['on_this_day', 'rule'],
    ],
    [
      'a Gallery client on V2',
      [SyncRequestType.MemoriesV2, SyncRequestType.MemoryToAssetsV2, SyncRequestType.SharedSpacesV1],
      ['birthday', 'on_this_day', 'rule'],
    ],
  ])('should sync %s only the memory types it can decode, and still complete', async (_, types, expected) => {
    const { auth, user, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const memoryTypes = new Map<string, string>();
    for (const dto of [
      { type: MemoryType.OnThisDay, data: { year: 2020 } },
      { type: MemoryType.Rule, data: { ruleId: 'season_recap', dedupeKey: 'k' } },
      { type: MemoryType.Birthday, data: { personId: 'person-1', personName: 'Alice', year: 1990 } },
    ]) {
      const { memory } = await ctx.newMemory({ ownerId: user.id, ...dto });
      await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });
      memoryTypes.set(memory.id, dto.type);
    }

    const response = (await ctx.syncStream(auth, types)) as { type: string; data: Record<string, string> }[];
    const sent = (entityTypes: SyncEntityType[], key: string) =>
      response
        .filter(({ type }) => entityTypes.includes(type as SyncEntityType))
        .map(({ data }) => memoryTypes.get(data[key]) ?? 'unknown')
        .toSorted((a, b) => a.localeCompare(b));
    expect(sent([SyncEntityType.MemoryV1, SyncEntityType.MemoryV2], 'id')).toEqual(expected);
    expect(sent([SyncEntityType.MemoryToAssetV1, SyncEntityType.MemoryToAssetV2], 'memoryId')).toEqual(expected);

    await ctx.syncAckAll(auth, response as never);
    await ctx.assertSyncIsComplete(auth, types);
  });

  it('should detect and sync a deleted memory', async () => {
    const { auth, user, ctx } = await setup();
    const memoryRepo = ctx.get(MemoryRepository);
    const { memory } = await ctx.newMemory({ ownerId: user.id });
    await memoryRepo.delete(memory.id);

    const response = await ctx.syncStream(auth, [SyncRequestType.MemoriesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: {
          memoryId: memory.id,
        },
        type: 'MemoryDeleteV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoriesV1]);
  });

  it('should sync a memory and then an update to that same memory', async () => {
    const { auth, user, ctx } = await setup();
    const memoryRepo = ctx.get(MemoryRepository);
    const { memory } = await ctx.newMemory({ ownerId: user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.MemoriesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: memory.id }),
        type: 'MemoryV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await memoryRepo.update(memory.id, { seenAt: new Date() });
    const newResponse = await ctx.syncStream(auth, [SyncRequestType.MemoriesV1]);
    expect(newResponse).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: memory.id }),
        type: 'MemoryV1',
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, newResponse);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoriesV1]);
  });

  it('should not sync a memory or a memory delete for an unrelated user', async () => {
    const { auth, ctx } = await setup();
    const memoryRepo = ctx.get(MemoryRepository);
    const { user: user2 } = await ctx.newUser();
    const { memory } = await ctx.newMemory({ ownerId: user2.id });

    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoriesV1]);
    await memoryRepo.delete(memory.id);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.MemoriesV1]);
  });
});
