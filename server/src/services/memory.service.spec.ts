import { BadRequestException } from '@nestjs/common';
import { defaults } from 'src/dtos/config.dto.js';
import { JobName, MemoryType, SystemMetadataKey, UserMetadataKey } from 'src/enum.js';
import { MemoryService } from 'src/services/memory.service.js';
import { OnThisDayData, RuleMemoryData } from 'src/types.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { MemoryFactory } from 'test/factories/memory.factory.js';
import { getForMemory } from 'test/mappers.js';
import { factory, newUuid, newUuids } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const stockAuth = (userId: string) => ({ ...factory.auth({ user: { id: userId } }), stockClient: true as const });
const legacyAppAuth = (userId: string) => ({
  ...factory.auth({ user: { id: userId } }),
  legacyGalleryApp: true as const,
});

describe(MemoryService.name, () => {
  let sut: MemoryService;
  let mocks: ServiceMocks;

  const nothingHidden = { hiddenSpaceIds: [], hiddenAlbumIds: [], hiddenAlbumSpacePairs: [], hiddenLibraryIds: [] };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MemoryService));
    mocks.memory.search.mockResolvedValue([]);
    mocks.memory.searchAccessible.mockResolvedValue([]);
    mocks.user.getMetadata.mockResolvedValue([]);
    mocks.person.forBirthdayMemories.mockResolvedValue([]);
    // #1041: memory reads resolve the viewer's scope; default to "nothing hidden, no visible spaces".
    vi.spyOn(sut, 'resolveViewerScope').mockResolvedValue({ hiddenScope: nothingHidden, visibleSpaceIds: [] });
  });

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('onMemoryCleanup', () => {
    it('should clean up memories using configured retention days', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ memories: { retentionDays: 0 } });
      mocks.memory.cleanup.mockResolvedValue([]);

      await sut.onMemoriesCleanup();

      expect(mocks.memory.cleanup).toHaveBeenCalledWith(0);
    });

    it('should clean up memories using default retention days', async () => {
      mocks.systemMetadata.get.mockResolvedValue({});
      mocks.memory.cleanup.mockResolvedValue([]);

      await sut.onMemoriesCleanup();

      expect(mocks.memory.cleanup).toHaveBeenCalledWith(defaults.memories.retentionDays);
    });
  });

  describe('onMemoriesCreate', () => {
    it('should generate memories for all users', async () => {
      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onMemoriesCreate();

      expect(mocks.user.getList).toHaveBeenCalledWith({ withDeleted: false });
      expect(mocks.systemMetadata.set).toHaveBeenCalled();
    });

    it('should skip dates that have already been processed', async () => {
      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      // Set lastOnThisDayDate to far in the future so all dates are skipped
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      await sut.onMemoriesCreate();

      // Should not create any memories since all dates were already processed
      expect(mocks.asset.getByDayOfYear).not.toHaveBeenCalled();
    });

    it('should create on-this-day memories when assets exist', async () => {
      const user = factory.userAdmin();
      const asset = AssetFactory.create({ ownerId: user.id });
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.asset.getByDayOfYear.mockResolvedValue([{ year: 2023, assets: [asset] }] as any);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      await sut.onMemoriesCreate();

      expect(mocks.memory.create).toHaveBeenCalled();
    });

    it('should handle errors during memory creation gracefully', async () => {
      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.asset.getByDayOfYear.mockRejectedValue(new Error('Database error'));

      // Should not throw; errors are caught internally
      await sut.onMemoriesCreate();

      // Should still update system metadata even on error
      expect(mocks.systemMetadata.set).toHaveBeenCalled();
    });

    it('should queue the rule-memory job once on-this-day generation is done', async () => {
      mocks.user.getList.mockResolvedValue([factory.userAdmin()]);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onMemoriesCreate();

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.MemoryRuleGenerate });
      expect(mocks.job.queue.mock.invocationCallOrder[0]).toBeGreaterThan(
        Math.max(...mocks.systemMetadata.set.mock.invocationCallOrder),
      );
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).not.toHaveBeenCalled();
    });

    it('should skip on-this-day generation when the user disabled that type', async () => {
      const user = factory.userAdmin({
        metadata: [{ key: UserMetadataKey.Preferences, value: { memories: { types: { on_this_day: false } } } }],
      });
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onMemoriesCreate();

      expect(mocks.asset.getByDayOfYear).not.toHaveBeenCalled();
    });

    it('should skip on-this-day generation when an admin disabled that type globally', async () => {
      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockImplementation((key) =>
        Promise.resolve(
          key === SystemMetadataKey.SystemConfig ? { memories: { types: { on_this_day: false } } } : null,
        ),
      );

      await sut.onMemoriesCreate();

      expect(mocks.asset.getByDayOfYear).not.toHaveBeenCalled();
    });

    // OD-3: birthday memories are Immich's own generator, with no Gallery toggle in front of it.
    it("should run upstream's birthday generator for every user and day, even with on-this-day disabled", async () => {
      const user = factory.userAdmin({
        metadata: [{ key: UserMetadataKey.Preferences, value: { memories: { types: { on_this_day: false } } } }],
      });
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue(null);

      await sut.onMemoriesCreate();

      expect(mocks.person.forBirthdayMemories).toHaveBeenCalledWith(user.id, expect.anything());
    });
  });

  describe('search', () => {
    it('should search memories with assets', async () => {
      const [userId] = newUuids();

      const asset = AssetFactory.create();
      const memory1 = MemoryFactory.from({ ownerId: userId }).asset(asset).build();
      const memory2 = MemoryFactory.create({ ownerId: userId });
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory1), getForMemory(memory2)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: memory1.id,
            assets: expect.arrayContaining([expect.objectContaining({ id: asset.id })]),
          }),
        ]),
      );
    });

    it('should map empty result', async () => {
      mocks.memory.searchAccessible.mockResolvedValue([]);
      await expect(sut.search(factory.auth(), {})).resolves.toEqual([]);
    });

    it('should pass search dto to repository', async () => {
      const auth = factory.auth();
      const dto = { type: MemoryType.OnThisDay, isSaved: true };
      mocks.memory.searchAccessible.mockResolvedValue([]);

      await sut.search(auth, dto);

      // #1041: the viewer's hidden scope (§6.2) and the visible spaces carrying §3's rescue arm.
      expect(sut.resolveViewerScope).toHaveBeenCalledWith(auth, 'memories');
      expect(mocks.memory.searchAccessible).toHaveBeenCalledWith(auth.user.id, dto, nothingHidden, []);
    });

    it('should only return assets the user can access', async () => {
      const [userId] = newUuids();
      const visibleAsset = AssetFactory.create();
      const hiddenAsset = AssetFactory.create();
      const memory = MemoryFactory.from({ ownerId: userId }).asset(visibleAsset).asset(hiddenAsset).build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([visibleAsset.id]));

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([
        expect.objectContaining({
          id: memory.id,
          assets: [expect.objectContaining({ id: visibleAsset.id })],
        }),
      ]);
    });

    it('should expose server-owned title and subtitle for rule memories', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        data: {
          ruleId: 'birthday',
          dedupeKey: 'birthday:person-1:2026-04-23',
          title: 'Happy birthday, Alice',
          subtitle: 'Photos from different years',
        } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();

      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([
        expect.objectContaining({
          id: memory.id,
          type: MemoryType.Rule,
          title: 'Happy birthday, Alice',
          subtitle: 'Photos from different years',
        }),
      ]);
    });

    it('should hide an on-this-day memory when the user disabled that type', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({ ownerId: userId, type: MemoryType.OnThisDay, data: { year: 2020 } })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.user.getMetadata.mockResolvedValue([
        { key: UserMetadataKey.Preferences, value: { memories: { types: { on_this_day: false } } } },
      ]);

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([]);
    });

    it('should return an on-this-day memory when the type is enabled', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({ ownerId: userId, type: MemoryType.OnThisDay, data: { year: 2020 } })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([
        expect.objectContaining({ id: memory.id }),
      ]);
    });

    it('should hide a rule memory when the user disabled its type', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        data: { ruleId: 'season_recap', dedupeKey: 'k', title: 'Summer' } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.user.getMetadata.mockResolvedValue([
        { key: UserMetadataKey.Preferences, value: { memories: { types: { season_recap: false } } } },
      ]);

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([]);
    });

    it('should hide a memory whose type an admin disabled globally', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        data: { ruleId: 'recent_trip', dedupeKey: 'k', title: 'Trip' } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.systemMetadata.get.mockResolvedValue({ memories: { types: { recent_trip: false } } });

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([]);
    });

    it('should keep a saved memory even when its type is disabled', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        isSaved: true,
        data: { ruleId: 'season_recap', dedupeKey: 'k', title: 'Summer' } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.user.getMetadata.mockResolvedValue([
        { key: UserMetadataKey.Preferences, value: { memories: { types: { season_recap: false } } } },
      ]);

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([
        expect.objectContaining({ id: memory.id }),
      ]);
    });

    it('should keep a memory with an unknown rule id', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        data: { ruleId: 'foreign_rule', dedupeKey: 'k', title: 'Foreign' } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(memory)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.user.getMetadata.mockResolvedValue([
        { key: UserMetadataKey.Preferences, value: { memories: { types: { foreign_rule: false } } } },
      ]);

      await expect(sut.search(factory.auth({ user: { id: userId } }), {})).resolves.toEqual([
        expect.objectContaining({ id: memory.id }),
      ]);
    });
  });

  describe('statistics', () => {
    it('should return memory statistics', async () => {
      const auth = factory.auth();
      const dto = { type: MemoryType.OnThisDay };
      const stats = { total: 5 };
      mocks.memory.statisticsAccessible.mockResolvedValue(stats as any);

      const result = await sut.statistics(auth, dto);

      expect(result).toEqual(stats);
      expect(mocks.memory.statisticsAccessible).toHaveBeenCalledWith(auth.user.id, dto, [
        MemoryType.OnThisDay,
        MemoryType.Rule,
        MemoryType.Birthday,
      ]);
    });

    it('should count on-this-day and birthday memories for a stock client', async () => {
      const auth = stockAuth(newUuid());
      mocks.memory.statisticsAccessible.mockResolvedValue({ total: 1 });

      await sut.statistics(auth, {});

      expect(mocks.memory.statisticsAccessible).toHaveBeenCalledWith(auth.user.id, {}, [
        MemoryType.OnThisDay,
        MemoryType.Birthday,
      ]);
    });

    it('should not count birthday memories for a Gallery app older than 5.8.0', async () => {
      const auth = legacyAppAuth(newUuid());
      mocks.memory.statisticsAccessible.mockResolvedValue({ total: 1 });

      await sut.statistics(auth, {});

      expect(mocks.memory.statisticsAccessible).toHaveBeenCalledWith(auth.user.id, {}, [
        MemoryType.OnThisDay,
        MemoryType.Rule,
      ]);
    });
  });

  describe('stock clients', () => {
    it('should not list rule memories to a stock client', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const onThisDay = MemoryFactory.from({ ownerId: userId }).asset(asset).build();
      const rule = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Rule,
        data: { ruleId: 'season_recap', dedupeKey: 'k', title: 'Summer' } satisfies RuleMemoryData,
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(onThisDay), getForMemory(rule)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));

      const stock = await sut.search(stockAuth(userId), {});
      expect(stock.map(({ id }) => id)).toEqual([onThisDay.id]);

      const gallery = await sut.search(factory.auth({ user: { id: userId } }), {});
      expect(gallery.map(({ id }) => id)).toEqual([onThisDay.id, rule.id]);
    });

    it('should not return a rule memory by id to a stock client', async () => {
      const userId = newUuid();
      const rule = MemoryFactory.create({
        ownerId: userId,
        type: MemoryType.Rule,
        data: { ruleId: 'season_recap', dedupeKey: 'k', title: 'Summer' } satisfies RuleMemoryData,
      });
      mocks.memory.get.mockResolvedValue(getForMemory(rule));
      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([rule.id]));

      await expect(sut.get(stockAuth(userId), rule.id)).rejects.toBeInstanceOf(BadRequestException);
      await expect(sut.get(factory.auth({ user: { id: userId } }), rule.id)).resolves.toMatchObject({ id: rule.id });
    });
    // OD-3: upstream lists birthday memories to every client; only a Gallery app older than 5.8.0 cannot decode one.
    it('should list a birthday memory to stock clients and current Gallery clients, not to an older Gallery app', async () => {
      const userId = newUuid();
      const asset = AssetFactory.create();
      const onThisDay = MemoryFactory.from({ ownerId: userId }).asset(asset).build();
      const birthday = MemoryFactory.from({
        ownerId: userId,
        type: MemoryType.Birthday,
        data: { personId: newUuid(), personName: 'Alice', year: 1990 },
      })
        .asset(asset)
        .build();
      mocks.memory.searchAccessible.mockResolvedValue([getForMemory(onThisDay), getForMemory(birthday)]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));

      const ids = async (auth: ReturnType<typeof factory.auth>) => {
        const memories = await sut.search(auth, {});
        return memories.map(({ id }) => id);
      };
      await expect(ids(stockAuth(userId))).resolves.toEqual([onThisDay.id, birthday.id]);
      await expect(ids(factory.auth({ user: { id: userId } }))).resolves.toEqual([onThisDay.id, birthday.id]);
      await expect(ids(legacyAppAuth(userId))).resolves.toEqual([onThisDay.id]);
    });

    it('should return a birthday memory by id to a stock client', async () => {
      const userId = newUuid();
      const birthday = MemoryFactory.create({
        ownerId: userId,
        type: MemoryType.Birthday,
        data: { personId: newUuid(), personName: 'Alice', year: 1990 },
      });
      mocks.memory.get.mockResolvedValue(getForMemory(birthday));
      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([birthday.id]));

      await expect(sut.get(stockAuth(userId), birthday.id)).resolves.toMatchObject({ id: birthday.id });
    });
  });

  describe('get', () => {
    it('should throw an error when no access', async () => {
      await expect(sut.get(factory.auth(), 'not-found')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw an error when the memory is not found', async () => {
      const [memoryId] = newUuids();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memoryId]));
      mocks.memory.get.mockResolvedValue(void 0);

      await expect(sut.get(factory.auth(), memoryId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should get a memory by id', async () => {
      const userId = newUuid();
      const memory = MemoryFactory.create({ ownerId: userId });

      mocks.memory.get.mockResolvedValue(getForMemory(memory));
      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));

      await expect(sut.get(factory.auth({ user: { id: userId } }), memory.id)).resolves.toMatchObject({
        id: memory.id,
      });

      // #1041: the viewer id, their hidden scope (§6.2) and the visible spaces carrying §3's rescue arm.
      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        expect.objectContaining({ user: expect.objectContaining({ id: userId }) }),
        'memories',
      );
      expect(mocks.memory.get).toHaveBeenCalledWith(memory.id, userId, nothingHidden, []);
      expect(mocks.access.memory.checkOwnerAccess).toHaveBeenCalledWith(memory.ownerId, new Set([memory.id]));
    });
  });

  describe('create', () => {
    it('should skip assets the user does not have access to', async () => {
      const [assetId, userId] = newUuids();
      const memory = MemoryFactory.create({ ownerId: userId });

      mocks.memory.create.mockResolvedValue(getForMemory(memory));

      await expect(
        sut.create(factory.auth({ user: { id: userId } }), {
          type: MemoryType.OnThisDay,
          data: memory.data as OnThisDayData,
          memoryAt: memory.memoryAt,
          isSaved: memory.isSaved,
          assetIds: [assetId],
        }),
      ).resolves.toMatchObject({ assets: [] });

      // #763: create threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.create).toHaveBeenCalledWith(
        {
          type: memory.type,
          data: memory.data,
          ownerId: memory.ownerId,
          memoryAt: memory.memoryAt,
          isSaved: memory.isSaved,
        },
        new Set(),
        userId,
      );
    });

    it('should create a memory', async () => {
      const [assetId, userId] = newUuids();
      const asset = AssetFactory.create({ id: assetId, ownerId: userId });
      const memory = MemoryFactory.from().asset(asset).build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.memory.create.mockResolvedValue(getForMemory(memory));

      await expect(
        sut.create(factory.auth({ user: { id: userId } }), {
          type: MemoryType.OnThisDay,
          data: memory.data as OnThisDayData,
          assetIds: memory.assets.map((asset) => asset.id),
          memoryAt: memory.memoryAt,
        }),
      ).resolves.toBeDefined();

      // #763: create threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: userId }),
        new Set([assetId]),
        userId,
      );
    });

    it('should create a memory without assets', async () => {
      const memory = MemoryFactory.create();

      mocks.memory.create.mockResolvedValue(getForMemory(memory));

      await expect(
        sut.create(factory.auth(), {
          type: MemoryType.OnThisDay,
          data: memory.data as OnThisDayData,
          memoryAt: memory.memoryAt,
        }),
      ).resolves.toBeDefined();
    });

    it('should pass all optional fields when creating a memory', async () => {
      const userId = newUuid();
      const memory = MemoryFactory.create({ ownerId: userId });
      const showAt = new Date();
      const hideAt = new Date();
      const seenAt = new Date();

      mocks.memory.create.mockResolvedValue(memory as any);

      await sut.create(factory.auth({ user: { id: userId } }), {
        type: memory.type,
        data: memory.data as OnThisDayData,
        memoryAt: memory.memoryAt,
        isSaved: true,
        showAt,
        hideAt,
        seenAt,
      });

      // #763: create threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: userId,
          isSaved: true,
          showAt,
          hideAt,
          seenAt,
        }),
        new Set(),
        userId,
      );
    });
  });

  describe('update', () => {
    it('should require access', async () => {
      await expect(sut.update(factory.auth(), 'not-found', { isSaved: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.memory.update).not.toHaveBeenCalled();
    });

    it('should update a memory', async () => {
      const memory = MemoryFactory.create();
      const auth = factory.auth();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.update.mockResolvedValue(getForMemory(memory));

      await expect(sut.update(auth, memory.id, { isSaved: true })).resolves.toBeDefined();

      // #763: update threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.update).toHaveBeenCalledWith(
        memory.id,
        expect.objectContaining({ isSaved: true }),
        auth.user.id,
      );
    });

    it('should update a memory with seenAt', async () => {
      const memory = MemoryFactory.create();
      const seenAt = new Date();
      const auth = factory.auth();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.update.mockResolvedValue(memory as any);

      await sut.update(auth, memory.id, { seenAt });

      // #763: update threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.update).toHaveBeenCalledWith(memory.id, expect.objectContaining({ seenAt }), auth.user.id);
    });

    it('should update a memory with memoryAt', async () => {
      const memory = MemoryFactory.create();
      const memoryAt = new Date();
      const auth = factory.auth();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.update.mockResolvedValue(memory as any);

      await sut.update(auth, memory.id, { memoryAt });

      // #763: update threads the caller's id to project isFavoriteForUser.
      expect(mocks.memory.update).toHaveBeenCalledWith(memory.id, expect.objectContaining({ memoryAt }), auth.user.id);
    });
  });

  describe('remove', () => {
    it('should require access', async () => {
      await expect(sut.remove(factory.auth(), newUuid())).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('should delete a memory', async () => {
      const memoryId = newUuid();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memoryId]));
      mocks.memory.delete.mockResolvedValue();

      await expect(sut.remove(factory.auth(), memoryId)).resolves.toBeUndefined();

      expect(mocks.memory.delete).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('addAssets', () => {
    // immich-28950 gates this on Permission.AssetUpdate and means "owner only" by it. In this fork
    // AssetUpdate ALSO admits space editors, so adopting the constant verbatim let an editor pin
    // another member's asset into their own memory — creating exactly the cross-owner memory_asset
    // rows upstream's DeleteMismatchedMemoryAssets migration deletes, and which MemoryService.get
    // keeps serving after the editor loses space access (it re-checks MemoryRead only, with no
    // per-asset filter). Hence the explicit owner check.
    it('should refuse an asset the caller only reaches as a space editor', async () => {
      const assetId = newUuid();
      const memory = MemoryFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.get.mockResolvedValue(getForMemory(memory));
      mocks.memory.getAssetIds.mockResolvedValue(new Set());
      // Not the owner, but an editor of a space containing the asset.
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));

      await expect(sut.addAssets(factory.auth(), memory.id, { ids: [assetId] })).resolves.toEqual([
        { error: 'no_permission', id: assetId, success: false },
      ]);

      expect(mocks.memory.addAssetIds).not.toHaveBeenCalled();
    });

    it('should require memory access', async () => {
      const [memoryId, assetId] = newUuids();

      await expect(sut.addAssets(factory.auth(), memoryId, { ids: [assetId] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.memory.addAssetIds).not.toHaveBeenCalled();
    });

    it('should require asset access', async () => {
      const assetId = newUuid();
      const memory = MemoryFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.get.mockResolvedValue(getForMemory(memory));
      mocks.memory.getAssetIds.mockResolvedValue(new Set());

      await expect(sut.addAssets(factory.auth(), memory.id, { ids: [assetId] })).resolves.toEqual([
        { error: 'no_permission', id: assetId, success: false },
      ]);

      expect(mocks.memory.addAssetIds).not.toHaveBeenCalled();
    });

    it('should skip assets already in the memory', async () => {
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from().asset(asset).build();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.get.mockResolvedValue(getForMemory(memory));
      mocks.memory.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await expect(sut.addAssets(factory.auth(), memory.id, { ids: [asset.id] })).resolves.toEqual([
        { error: 'duplicate', id: asset.id, success: false },
      ]);

      expect(mocks.memory.addAssetIds).not.toHaveBeenCalled();
    });

    it('should add assets', async () => {
      const assetId = newUuid();
      const memory = MemoryFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.memory.get.mockResolvedValue(getForMemory(memory));
      mocks.memory.update.mockResolvedValue(getForMemory(memory));
      mocks.memory.getAssetIds.mockResolvedValue(new Set());
      mocks.memory.addAssetIds.mockResolvedValue();

      await expect(sut.addAssets(factory.auth(), memory.id, { ids: [assetId] })).resolves.toEqual([
        { id: assetId, success: true },
      ]);

      expect(mocks.memory.addAssetIds).toHaveBeenCalledWith(memory.id, [assetId]);
    });

    it('should update memory updatedAt when assets are successfully added', async () => {
      const assetId = newUuid();
      const memory = MemoryFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.memory.get.mockResolvedValue(memory as any);
      mocks.memory.update.mockResolvedValue(memory as any);
      mocks.memory.getAssetIds.mockResolvedValue(new Set());
      mocks.memory.addAssetIds.mockResolvedValue();

      await sut.addAssets(factory.auth(), memory.id, { ids: [assetId] });

      expect(mocks.memory.update).toHaveBeenCalledWith(memory.id, { updatedAt: expect.any(Date) });
    });

    it('should not update memory updatedAt when no assets are successfully added', async () => {
      const asset = AssetFactory.create();
      const memory = MemoryFactory.from().asset(asset).build();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.get.mockResolvedValue(memory as any);
      mocks.memory.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await sut.addAssets(factory.auth(), memory.id, { ids: [asset.id] });

      expect(mocks.memory.update).not.toHaveBeenCalled();
    });
  });

  describe('removeAssets', () => {
    it('should require memory access', async () => {
      await expect(sut.removeAssets(factory.auth(), 'not-found', { ids: ['asset1'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
    });

    it('should skip assets not in the memory', async () => {
      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set(['memory1']));
      mocks.memory.getAssetIds.mockResolvedValue(new Set());

      await expect(sut.removeAssets(factory.auth(), 'memory1', { ids: ['not-found'] })).resolves.toEqual([
        { error: 'not_found', id: 'not-found', success: false },
      ]);

      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
    });

    it('should remove assets', async () => {
      const memory = MemoryFactory.create();
      const asset = AssetFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.memory.getAssetIds.mockResolvedValue(new Set([asset.id]));
      mocks.memory.removeAssetIds.mockResolvedValue();
      mocks.memory.update.mockResolvedValue(getForMemory(memory));

      await expect(sut.removeAssets(factory.auth(), memory.id, { ids: [asset.id] })).resolves.toEqual([
        { id: asset.id, success: true },
      ]);

      expect(mocks.memory.removeAssetIds).toHaveBeenCalledWith(memory.id, [asset.id]);
    });

    it('should update memory updatedAt when assets are successfully removed', async () => {
      const memory = MemoryFactory.create();
      const asset = AssetFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.memory.getAssetIds.mockResolvedValue(new Set([asset.id]));
      mocks.memory.removeAssetIds.mockResolvedValue();
      mocks.memory.update.mockResolvedValue(memory as any);

      await sut.removeAssets(factory.auth(), memory.id, { ids: [asset.id] });

      expect(mocks.memory.update).toHaveBeenCalledWith(
        memory.id,
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
    });

    it('should not update memory updatedAt when no assets are successfully removed', async () => {
      const memory = MemoryFactory.create();

      mocks.access.memory.checkOwnerAccess.mockResolvedValue(new Set([memory.id]));
      mocks.memory.getAssetIds.mockResolvedValue(new Set());

      await sut.removeAssets(factory.auth(), memory.id, { ids: ['not-found'] });

      expect(mocks.memory.update).not.toHaveBeenCalled();
    });
  });
});
