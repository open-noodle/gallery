import { Reflector } from '@nestjs/core';
import { DateTime, Settings } from 'luxon';
import { JobName, MemoryType, MetadataKey, QueueName, SystemMetadataKey, UserMetadataKey } from 'src/enum.js';
import { RULE_DAILY_LIMIT, RuleMemoryService } from 'src/gallery/services/rule-memory.service.js';
import { RuleMemoryData } from 'src/types.js';
import { MemoryFactory } from 'test/factories/memory.factory.js';
import { getForMemory } from 'test/mappers.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

/** `count` rule memories already visible on `memoryAt`, shaped as `memory.search` returns them. */
const visibleRuleMemories = (ownerId: string, memoryAt: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    getForMemory(
      MemoryFactory.create({
        ownerId,
        type: MemoryType.Rule,
        memoryAt: new Date(memoryAt),
        data: { ruleId: 'existing', dedupeKey: `existing-${index}`, title: 'Existing' } satisfies RuleMemoryData,
      }),
    ),
  );

const day = (iso: string) => new Date(iso);

/** N distinct asset ids. Floors are real, so fixtures need volume to survive them. */
const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

/** Shape a row the way `getForOverlapReconcile` returns it. */
const overlapRow = (overrides: {
  id: string;
  assets: string[];
  type?: MemoryType;
  data?: unknown;
  isSaved?: boolean;
  showAt?: Date | null;
  hideAt?: Date | null;
}) => ({
  id: overrides.id,
  type: overrides.type ?? MemoryType.Rule,
  data: overrides.data ?? { ruleId: 'season_recap', dedupeKey: 'k', score: 130 },
  isSaved: overrides.isSaved ?? false,
  showAt: overrides.showAt === undefined ? day('2026-09-01T00:00:00Z') : overrides.showAt,
  hideAt: overrides.hideAt === undefined ? day('2026-09-01T23:59:59Z') : overrides.hideAt,
  assets: overrides.assets.map((id) => ({ id })),
});

describe(RuleMemoryService.name, () => {
  let sut: RuleMemoryService;
  let mocks: ServiceMocks;

  /**
   * One `systemMetadata.get` mock answers EVERY key, so it must be keyed. Returning the
   * memories-state object for `SystemConfig` too would feed junk into config parsing — which is
   * why the existing tests in this file pass `null`.
   */
  const stubMetadata = () =>
    mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) =>
      Promise.resolve(
        key === SystemMetadataKey.MemoriesState
          ? { lastOnThisDayDate: '2026-09-30T00:00:00.000Z', lastRuleDate: '2026-09-30T00:00:00.000Z' }
          : null,
      ),
    );

  // Both cursors sit in the future so the two generation loops no-op and only reconciliation runs.
  const runJob = async () => {
    const user = factory.userAdmin();
    mocks.user.getList.mockResolvedValue([user]);
    stubMetadata();
    await sut.onRuleMemoriesCreate();
    return user;
  };

  // Keyed for the same reason as `stubMetadata` above: one `get` mock answers every key, and
  // handing a memories-state object to SystemConfig would feed junk into config parsing. Used
  // by the 'overlap backfill' tests, which each need a different starting MemoriesState.
  const runWithState = async (state: Record<string, unknown>) => {
    const user = factory.userAdmin();
    mocks.user.getList.mockResolvedValue([user]);
    mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) =>
      Promise.resolve(
        key === SystemMetadataKey.MemoriesState
          ? {
              lastOnThisDayDate: '2026-09-30T00:00:00.000Z',
              lastRuleDate: '2026-09-30T00:00:00.000Z',
              ...state,
            }
          : null,
      ),
    );
    await sut.onRuleMemoriesCreate();
    return user;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(RuleMemoryService));
    mocks.memory.search.mockResolvedValue([]);
    mocks.memoryRuleAsset.deleteOnThisDay.mockResolvedValue(void 0);
    mocks.memoryRuleAsset.getMemoryAssetsForPeriod.mockResolvedValue([]);
    mocks.memoryRuleAsset.getMemoryFacesForPeriod.mockResolvedValue([]);
    mocks.memoryRuleAsset.getMemoryPersonDailyCounts.mockResolvedValue([]);
    mocks.memoryRuleAsset.getMemoryAssetsForPersonWindow.mockResolvedValue([]);
    mocks.user.getMetadata.mockResolvedValue([]);
    // Without these, every `onMemoriesCreate` test outside the `reconcileMemoryOverlap` /
    // `overlap backfill` describe blocks hits an unstubbed mock, `rows.length` throws a
    // TypeError inside the reconcile try/catch, and the whole reconcile+backfill code path runs
    // dead (see F3). Stubbing to a no-op here keeps that path live everywhere.
    mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([]);
    mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(null);
  });

  describe('onRuleMemoriesCreate', () => {
    it('should run as the MemoryRuleGenerate job on the background queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.onRuleMemoriesCreate);

      expect(config).toEqual({ name: JobName.MemoryRuleGenerate, queue: QueueName.BackgroundTask });
    });

    // OD-3: birthday memories are upstream's MemoryType.Birthday, written by MemoryGenerate, not a rule.
    it('should persist lastRuleDate and never look up birthdays', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      mocks.user.getList.mockResolvedValue([factory.userAdmin()]);
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      expect(mocks.person.forBirthdayMemories).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.MemoriesState,
        expect.objectContaining({ lastRuleDate: '2026-04-23T00:00:00.000Z' }),
      );

      vi.useRealTimers();
    });

    it('should skip recent trip rule memories when recent trip memories are disabled', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockImplementation((key) =>
        Promise.resolve(
          key === SystemMetadataKey.SystemConfig
            ? { memories: { recentTrips: false } }
            : {
                lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
                lastRuleDate: '2026-04-22T00:00:00.000Z',
              },
        ),
      );
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not create rule memories when all generated memory rules are disabled', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockImplementation((key) =>
        Promise.resolve(
          key === SystemMetadataKey.SystemConfig
            ? { memories: { recentTrips: false } }
            : {
                lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
                lastRuleDate: '2026-04-22T00:00:00.000Z',
              },
        ),
      );
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).not.toHaveBeenCalled();
      expect(mocks.memory.create).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should only evaluate rules through today, not future precompute dates', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-20T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      const birthdayRule = { id: 'birthday', evaluate: vi.fn().mockResolvedValue([]) };
      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([birthdayRule] as never);

      await sut.onRuleMemoriesCreate();

      expect(birthdayRule.evaluate.mock.calls.map(([input]) => input.target.toISODate())).toEqual([
        '2026-04-21',
        '2026-04-22',
        '2026-04-23',
      ]);

      vi.useRealTimers();
    });

    it('should skip an already-generated candidate, keep the rest in score order, and fail soft', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memoryRuleAsset.hasRuleMemory
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const failingRule = { id: 'broken', evaluate: vi.fn().mockRejectedValue(new Error('boom')) };
      const scoringRule = {
        id: 'scoring',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'birthday',
            dedupeKey: 'k-1',
            title: 'First',
            score: 100,
            assetIds: ['asset-1'],
            memoryAt: DateTime.fromISO('2026-04-23T00:00:00Z'),
          },
          {
            ruleId: 'birthday',
            dedupeKey: 'k-2',
            title: 'Second',
            score: 90,
            assetIds: ['asset-2'],
            memoryAt: DateTime.fromISO('2026-04-23T00:00:00Z'),
          },
          {
            ruleId: 'birthday',
            dedupeKey: 'k-3',
            title: 'Third',
            score: 10,
            assetIds: ['asset-3'],
            memoryAt: DateTime.fromISO('2026-04-23T00:00:00Z'),
          },
        ]),
      };

      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([failingRule, scoringRule] as never);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memory.create).toHaveBeenCalledTimes(2);
      expect(mocks.memoryRuleAsset.hasRuleMemory.mock.calls).toEqual([
        [user.id, 'birthday', 'k-1'],
        [user.id, 'birthday', 'k-2'],
        [user.id, 'birthday', 'k-3'],
      ]);
      expect(mocks.memory.create.mock.calls[0]?.[0].data).toMatchObject({ title: 'First', dedupeKey: 'k-1' });
      expect(mocks.memory.create.mock.calls[1]?.[0].data).toMatchObject({ title: 'Third', dedupeKey: 'k-3' });

      vi.useRealTimers();
    });

    it('should delete the superseded on_this_day memory once the standing-in rule memory is created', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const rule = {
        id: 'on_this_day_place',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'on_this_day_place',
            dedupeKey: 'place_day:2023-04-23:portugal:lisbon',
            title: 'On this day in Lisbon',
            score: 100,
            assetIds: ['asset-1'],
            memoryAt: DateTime.fromISO('2023-04-23T00:00:00Z'),
            supersedesOnThisDayYears: [2021, 2023],
          },
          {
            ruleId: 'on_this_day_place',
            dedupeKey: 'place_day:2026-04-23:portugal:porto',
            title: 'On this day in Porto',
            score: 90,
            assetIds: ['asset-2'],
            memoryAt: DateTime.fromISO('2022-04-23T00:00:00Z'),
            supersedesOnThisDayYears: [],
          },
        ]),
      };

      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([rule] as never);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memory.create).toHaveBeenCalledTimes(2);
      // Every year the candidate declared is removed, and only those years — the second
      // candidate declared none, so it removes nothing. All on the one trigger day.
      expect(mocks.memoryRuleAsset.deleteOnThisDay.mock.calls).toEqual([
        [{ ownerId: user.id, year: 2021, showAt: new Date('2026-04-23T00:00:00.000Z') }],
        [{ ownerId: user.id, year: 2023, showAt: new Date('2026-04-23T00:00:00.000Z') }],
      ]);

      vi.useRealTimers();
    });

    it('should not delete an on_this_day memory when the superseding candidate was never created', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      // The rule memory already exists from an earlier run, so the candidate is skipped.
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(true);

      const rule = {
        id: 'on_this_day_place',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'on_this_day_place',
            dedupeKey: 'place_day:2026-04-23:portugal:lisbon',
            title: 'On this day in Lisbon',
            score: 100,
            assetIds: ['asset-1'],
            memoryAt: DateTime.fromISO('2023-04-23T00:00:00Z'),
            supersedesOnThisDayYears: [2023],
          },
        ]),
      };

      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([rule] as never);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memory.create).not.toHaveBeenCalled();
      expect(mocks.memoryRuleAsset.deleteOnThisDay).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should respect the daily rule cap across reruns when a rule memory already exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      // every slot but one is already taken by memories still visible today
      mocks.memory.search.mockResolvedValue(visibleRuleMemories(user.id, '2026-04-23T00:00:00Z', RULE_DAILY_LIMIT - 1));
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const scoringRule = {
        id: 'scoring',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'birthday',
            dedupeKey: 'k-1',
            title: 'First',
            score: 100,
            assetIds: ['asset-1'],
            memoryAt: DateTime.fromISO('2026-04-23T00:00:00Z'),
          },
          {
            ruleId: 'birthday',
            dedupeKey: 'k-2',
            title: 'Second',
            score: 90,
            assetIds: ['asset-2'],
            memoryAt: DateTime.fromISO('2026-04-23T00:00:00Z'),
          },
        ]),
      };

      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([scoringRule] as never);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memory.search).toHaveBeenCalledWith(user.id, {
        type: MemoryType.Rule,
        for: new Date('2026-04-23T00:00:00Z'),
      });
      expect(mocks.memory.create).toHaveBeenCalledTimes(1);
      expect(mocks.memory.create.mock.calls[0]?.[0].data).toMatchObject({ title: 'First', dedupeKey: 'k-1' });

      vi.useRealTimers();
    });

    it('prefers a fallback birthday candidate over recent trip when only one rule slot remains', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-26T00:00:00.000Z',
        lastRuleDate: '2026-04-23T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      // every slot but one is already taken by memories still visible today
      mocks.memory.search.mockResolvedValue(visibleRuleMemories(user.id, '2026-04-24T00:00:00Z', RULE_DAILY_LIMIT - 1));
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const birthdayRule = {
        id: 'birthday',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'birthday',
            dedupeKey: 'birthday:person-1:2026-04-24',
            title: 'Happy birthday, Pierre',
            subtitle: 'Recent photos of Pierre',
            score: 254,
            assetIds: ['a-1', 'a-2', 'a-3', 'a-4'],
            memoryAt: DateTime.fromISO('2026-04-24T00:00:00Z'),
          },
        ]),
      };
      const recentTripRule = {
        id: 'recent_trip',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'recent_trip',
            dedupeKey: 'recent_trip:germany:nurnberg:2026-04-24',
            title: 'Recent trip to Nurnberg, Germany',
            subtitle: '20 photos over 30 days',
            score: 220,
            assetIds: ['t-1', 't-2', 't-3'],
            memoryAt: DateTime.fromISO('2026-04-24T00:00:00Z'),
          },
        ]),
      };

      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([recentTripRule, birthdayRule] as never);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memory.create).toHaveBeenCalledTimes(1);
      expect(mocks.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: user.id,
          type: MemoryType.Rule,
          data: expect.objectContaining({
            ruleId: 'birthday',
            title: 'Happy birthday, Pierre',
            subtitle: 'Recent photos of Pierre',
            score: 254,
          }),
        }),
        new Set(['a-1', 'a-2', 'a-3', 'a-4']),
      );

      vi.useRealTimers();
    });

    it('should not advance the rule cursor when any owner run fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const userA = factory.userAdmin();
      const userB = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([userA, userB]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      vi.spyOn(sut as any, 'createRuleMemories')
        .mockResolvedValueOnce(undefined as never)
        .mockRejectedValueOnce(new Error('boom'));

      await sut.onRuleMemoriesCreate();

      expect(mocks.systemMetadata.set).not.toHaveBeenCalledWith(
        SystemMetadataKey.MemoriesState,
        expect.objectContaining({ lastRuleDate: '2026-04-23T00:00:00.000Z' }),
      );

      vi.useRealTimers();
    });

    it('should evaluate a rule only for users who enabled it', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const userA = factory.userAdmin();
      const userB = factory.userAdmin({
        metadata: [{ key: UserMetadataKey.Preferences, value: { memories: { types: { recent_trip: false } } } }],
      });
      mocks.user.getList.mockResolvedValue([userA, userB]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memoryRuleAsset.getMemoryLocationClusters.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      // recent-trip runs only for userA
      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).toHaveBeenCalledWith(userA.id, expect.anything());
      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).not.toHaveBeenCalledWith(userB.id, expect.anything());

      vi.useRealTimers();
    });

    it('should never evaluate a rule disabled by the admin types map', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockImplementation((key) =>
        Promise.resolve(
          key === SystemMetadataKey.SystemConfig
            ? { memories: { types: { recent_trip: false } } }
            : { lastOnThisDayDate: '2026-04-25T00:00:00.000Z', lastRuleDate: '2026-04-22T00:00:00.000Z' },
        ),
      );
      mocks.asset.getByDayOfYear.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should still generate rule memories when the master switch is off (display-only)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-23T12:00:00Z'));

      const user = factory.userAdmin({
        metadata: [{ key: UserMetadataKey.Preferences, value: { memories: { enabled: false } } }],
      });
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-04-25T00:00:00.000Z',
        lastRuleDate: '2026-04-22T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memoryRuleAsset.getMemoryLocationClusters.mockResolvedValue([]);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memoryRuleAsset.getMemoryLocationClusters).toHaveBeenCalled();

      vi.useRealTimers();
    });

    // Slice 3: rule candidates may declare a multi-day visibility window via visibleForDays.
    it.each([
      {
        label: 'extends hideAt across a multi-day window',
        visibleForDays: 7 as number | undefined,
        hideAt: '2026-07-07T23:59:59.999Z',
      },
      { label: 'defaults to a single day when absent', visibleForDays: undefined, hideAt: '2026-07-01T23:59:59.999Z' },
      {
        label: 'treats visibleForDays of 1 as a single day',
        visibleForDays: 1 as number | undefined,
        hideAt: '2026-07-01T23:59:59.999Z',
      },
    ])('$label', async ({ visibleForDays, hideAt }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-07-03T00:00:00.000Z',
        lastRuleDate: '2026-06-30T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memory.search.mockResolvedValue([]);
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const rule = {
        id: 'month_recap',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'month_recap',
            dedupeKey: 'month_recap:2023-07',
            title: 'July 2023',
            score: 100,
            assetIds: ['a-1'],
            memoryAt: DateTime.fromISO('2023-07-15T00:00:00Z'),
            ...(visibleForDays !== undefined && { visibleForDays }),
          },
        ]),
      };
      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([rule] as never);

      await sut.onRuleMemoriesCreate();
      vi.useRealTimers();

      const created = mocks.memory.create.mock.calls[0]?.[0];
      expect(created?.showAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(created?.hideAt).toEqual(new Date(hideAt));
    });

    it('caps a multi-day recap rule to one memory per day, leaving a slot for a daily rule', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));

      const user = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([user]);
      mocks.systemMetadata.get.mockResolvedValue({
        lastOnThisDayDate: '2026-07-03T00:00:00.000Z',
        lastRuleDate: '2026-06-30T00:00:00.000Z',
      });
      mocks.asset.getByDayOfYear.mockResolvedValue([]);
      mocks.memory.search.mockResolvedValue([]);
      mocks.memoryRuleAsset.hasRuleMemory.mockResolvedValue(false);
      mocks.memory.create.mockResolvedValue(MemoryFactory.create() as any);

      const recapRule = {
        id: 'month_recap',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'month_recap',
            dedupeKey: 'month_recap:2023-07',
            title: 'July 2023',
            score: 100,
            assetIds: ['a'],
            memoryAt: DateTime.fromISO('2023-07-15T00:00:00Z'),
            visibleForDays: 7,
          },
          {
            ruleId: 'month_recap',
            dedupeKey: 'month_recap:2022-07',
            title: 'July 2022',
            score: 95,
            assetIds: ['b'],
            memoryAt: DateTime.fromISO('2022-07-15T00:00:00Z'),
            visibleForDays: 7,
          },
        ]),
      };
      const dailyRule = {
        id: 'on_this_day_place',
        evaluate: vi.fn().mockResolvedValue([
          {
            ruleId: 'on_this_day_place',
            dedupeKey: 'on_this_day_place:2023',
            title: 'On this day in Lisbon',
            score: 80,
            assetIds: ['c'],
            memoryAt: DateTime.fromISO('2023-07-01T00:00:00Z'),
          },
        ]),
      };
      vi.spyOn(sut as any, 'getMemoryRules').mockReturnValue([recapRule, dailyRule] as never);

      await sut.onRuleMemoriesCreate();

      // The second month_recap year is dropped even though slots remain: one card per multi-day rule.
      expect(mocks.memory.create).toHaveBeenCalledTimes(2);
      expect(mocks.memory.create.mock.calls.map((call) => (call[0].data as { dedupeKey: string }).dedupeKey)).toEqual([
        'month_recap:2023-07',
        'on_this_day_place:2023',
      ]);

      vi.useRealTimers();
    });
  });

  describe('reconcileMemoryOverlap', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(day('2026-09-01T12:00:00Z'));
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([]);
      mocks.memory.removeAssetIds.mockResolvedValue(void 0);
      mocks.memory.delete.mockResolvedValue(void 0);
      // Unused until Task 6 adds the backfill; stubbed now so these tests still pass then.
      // `MemoriesState.overlapBackfilledAt` does not exist yet — it must NOT appear above.
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(null);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('S5: makes no writes when the owner has no memories', async () => {
      await runJob();

      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('strips the lower-scoring memory rather than the higher one', async () => {
      const shared = 'shared-0';
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'season', assets: [shared, ...ids('s', 11)], data: { ruleId: 'season_recap', score: 130 } }),
        overlapRow({ id: 'month', assets: [shared, ...ids('m', 9)], data: { ruleId: 'month_recap', score: 110 } }),
      ] as any);

      await runJob();

      // season keeps 12 (>= 10); month keeps 9 (>= 8) after losing the shared one.
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('month', [shared]);
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('deletes an on_this_day card left under its floor', async () => {
      const shared = ids('x', 2);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'season',
          assets: [...shared, ...ids('s', 10)],
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({ id: 'otd', assets: shared, type: MemoryType.OnThisDay, data: { year: 2025 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).toHaveBeenCalledExactlyOnceWith('otd');
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalledWith('otd', expect.anything());
    });

    it('S1: does not force apart memories whose windows never overlap', async () => {
      const shared = ids('x', 10);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'first',
          assets: shared,
          showAt: day('2026-09-01T00:00:00Z'),
          hideAt: day('2026-09-01T23:59:59Z'),
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({
          id: 'later',
          assets: shared,
          showAt: day('2026-09-03T00:00:00Z'),
          hideAt: day('2026-09-03T23:59:59Z'),
          data: { ruleId: 'month_recap', score: 110 },
        }),
      ] as any);

      await runJob();

      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('S2: strips a multi-day memory once, unioned across every day it is visible', async () => {
      const shared = ids('x', 2);
      const spanning = { hideAt: day('2026-09-04T23:59:59Z') };
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'season',
          assets: [...shared, ...ids('s', 10)],
          ...spanning,
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({
          id: 'month',
          assets: [...shared, ...ids('m', 8)],
          ...spanning,
          data: { ruleId: 'month_recap', score: 110 },
        }),
      ] as any);

      await runJob();

      // Both are visible on all four days. Day 1 strips the shared pair; days 2-4 see the already
      // stripped set and add nothing, so exactly one write goes out.
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('month', shared);
    });

    it('S3: deletes a memory once even when it is visible on several days', async () => {
      const shared = ids('x', 2);
      const spanning = { hideAt: day('2026-09-04T23:59:59Z') };
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'season',
          assets: [...shared, ...ids('s', 10)],
          ...spanning,
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({ id: 'otd', assets: shared, ...spanning, type: MemoryType.OnThisDay, data: { year: 2025 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).toHaveBeenCalledExactlyOnceWith('otd');
    });

    it('S4: reaches a look-ahead on_this_day written three days ahead', async () => {
      const shared = ids('x', 2);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'season',
          assets: [...shared, ...ids('s', 10)],
          hideAt: day('2026-09-04T23:59:59Z'),
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({
          id: 'otd-ahead',
          assets: shared,
          showAt: day('2026-09-04T00:00:00Z'),
          hideAt: day('2026-09-04T23:59:59Z'),
          type: MemoryType.OnThisDay,
          data: { year: 2025 },
        }),
      ] as any);

      await runJob();

      // Proves the window really extends to today + DAYS: otd-ahead is only visible on the 4th.
      expect(mocks.memory.delete).toHaveBeenCalledExactlyOnceWith('otd-ahead');
    });

    it('S6: reconciles rule memories unaffected by a DIFFERENT disabled memory-type preference', async () => {
      const user = factory.userAdmin();
      user.metadata = [
        { key: UserMetadataKey.Preferences, value: { memories: { types: { on_this_day: false } } } },
      ] as any;
      mocks.user.getList.mockResolvedValue([user]);
      stubMetadata();

      const shared = 'shared-0';
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'season', assets: [shared, ...ids('s', 11)], data: { ruleId: 'season_recap', score: 130 } }),
        overlapRow({ id: 'month', assets: [shared, ...ids('m', 9)], data: { ruleId: 'month_recap', score: 110 } }),
      ] as any);

      await sut.onRuleMemoriesCreate();

      // Neither row here is `on_this_day`, so disabling that unrelated type does not exempt these
      // two rule memories from reconciliation. This is NOT proof that reconciliation is
      // preference-independent in general — see F1: a row whose OWN type is disabled is dropped
      // from consideration entirely (`isMemoryTypeVisible`, ~memory.service.ts:249).
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('month', [shared]);
    });

    it('S7: never deletes or strips a saved memory, and lets it claim first', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'saved', assets: ['a'], isSaved: true, type: MemoryType.OnThisDay, data: { year: 2025 } }),
        overlapRow({ id: 'rule', assets: ['a', ...ids('s', 11)], data: { ruleId: 'season_recap', score: 130 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).not.toHaveBeenCalled();
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('rule', ['a']);
    });

    it('S7b: never touches an API-created memory with no showAt/hideAt', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'manual',
          assets: ['a'],
          showAt: null,
          hideAt: null,
          type: MemoryType.OnThisDay,
          data: { year: 2025 },
        }),
        overlapRow({ id: 'rule', assets: ['a', ...ids('s', 11)], data: { ruleId: 'season_recap', score: 130 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).not.toHaveBeenCalled();
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('rule', ['a']);
    });

    it('S7c: never deletes a rule memory whose ruleId is no longer in the registry', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'orphan', assets: [], data: { ruleId: 'a_rule_we_deleted', score: 500 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    // Pins the claim-order guarantee spec §5.2 is built on: a rule memory must claim ahead of a
    // plain on_this_day card. Both sides get enough unshared assets to clear their own floor no
    // matter who claims first, so an inverted RANK_ON_THIS_DAY/RANK_RULE ordering changes the
    // outcome (which memory gets stripped) rather than being masked by an under-floor delete.
    it('pins claim order: a rule memory claims ahead of on_this_day', async () => {
      const shared = ids('x', 2);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'season',
          assets: [...shared, ...ids('s', 10)],
          data: { ruleId: 'season_recap', score: 130 },
        }),
        overlapRow({
          id: 'otd',
          assets: [...shared, ...ids('o', 3)],
          type: MemoryType.OnThisDay,
          data: { year: 2025 },
        }),
      ] as any);

      await runJob();

      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('otd', shared);
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalledWith('season', expect.anything());
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    // F4: `data.score` is untyped JSON — a non-numeric value must not poison the comparator.
    // Both memories clear their own floor (2) on their own-only assets alone, so whichever one
    // claims the shared asset merely gets STRIPPED of it rather than deleted — that keeps the two
    // possible outcomes ('bad' stripped vs. 'good' stripped) cleanly distinguishable instead of
    // both collapsing to "deleted". `bad` is listed FIRST: an unguarded `RANK_RULE + score`
    // string-concatenates ("1000000oops"), and comparing that against `good`'s numeric priority
    // coerces to NaN in the sort comparator, which (verified empirically on Node's engine) leaves
    // the pre-sort array order untouched — so pre-fix, `bad` wrongly keeps top claim order and
    // strips `good`, exactly backwards from the intended "non-numeric sorts as 0" behaviour.
    it('F4: a non-numeric score sorts as 0, below every scored rule memory', async () => {
      const shared = 'shared-0';
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'bad',
          assets: [shared, ...ids('bad-only-', 2)],
          data: { ruleId: 'recent_trip', dedupeKey: 'bad', score: 'oops' as unknown as number },
        }),
        overlapRow({
          id: 'good',
          assets: [shared, ...ids('good-only-', 2)],
          data: { ruleId: 'trip_anniversary', dedupeKey: 'good', score: 200 },
        }),
      ] as any);

      await runJob();

      // `good` (score 200) outranks `bad` (non-numeric -> treated as 0), claims the shared asset,
      // and keeps everything (no strip needed). `bad` loses the shared asset but still clears its
      // own floor of 2 on its two own-only assets, so it survives, stripped, rather than deleted.
      expect(mocks.memory.removeAssetIds).toHaveBeenCalledExactlyOnceWith('bad', [shared]);
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('S9: deletes a memory whose assets are all archived, trashed or hidden', async () => {
      // The repository query already filtered them out, so the service simply sees an empty list.
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'empty', assets: [], data: { ruleId: 'month_recap', score: 110 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).toHaveBeenCalledExactlyOnceWith('empty');
    });

    it('S10: makes no writes on a second run over already-reconciled memories', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'season', assets: ids('s', 12), data: { ruleId: 'season_recap', score: 130 } }),
        overlapRow({ id: 'month', assets: ids('m', 10), data: { ruleId: 'month_recap', score: 110 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    it('S11: logs and continues when reconciliation fails for one user', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockRejectedValue(new Error('boom'));

      await expect(runJob()).resolves.not.toThrow();

      // Matched on message text, not just "an error happened somewhere": `onMemoriesCreate` has
      // several independently try/caught phases, so an unqualified `toHaveBeenCalled()` would
      // also pass for an unrelated failure (e.g. on_this_day/rule generation) and prove nothing
      // about reconciliation specifically.
      expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to reconcile memory overlap'));
    });

    it('S12: reserves strictly per owner', async () => {
      const first = factory.userAdmin();
      const second = factory.userAdmin();
      mocks.user.getList.mockResolvedValue([first, second]);
      stubMetadata();
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'season', assets: ids('s', 12), data: { ruleId: 'season_recap', score: 130 } }),
      ] as any);

      await sut.onRuleMemoriesCreate();

      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledWith(first.id, expect.anything());
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledWith(second.id, expect.anything());
      // The same rows came back for both owners and neither stripped the other.
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
    });

    it('S13: is a no-op when a superseded on_this_day card is already gone', async () => {
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({ id: 'place', assets: ids('p', 5), data: { ruleId: 'on_this_day_place', score: 120 } }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).not.toHaveBeenCalled();
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
    });

    // F1: a memory whose type the owner has DISABLED is invisible in `search` (memory.service.ts
    // isMemoryTypeVisible), but before this fix nothing stopped it from claiming assets in the
    // sweep — including outranking and sinking a lower-ranked, VISIBLE card below its floor. This
    // reproduces the exact concrete failure from the review finding: the user disables
    // `month_recap` (the reporter's own workaround), the existing month_recap memory stays in the
    // table invisibly, and the nightly sweep still let it claim shared assets from the `on_this_day`
    // card, deleting a card the user could actually see. Must fail against pre-fix code.
    it('F1: a memory whose type is disabled for the owner does not claim, and does not sink a visible lower-ranked card below its floor', async () => {
      const user = factory.userAdmin();
      user.metadata = [
        { key: UserMetadataKey.Preferences, value: { memories: { types: { month_recap: false } } } },
      ] as any;
      mocks.user.getList.mockResolvedValue([user]);
      stubMetadata();

      const shared = ids('x', 2);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        // Clears its own floor (8) on its own if it were allowed to claim: shared(2) + own(6) = 8.
        overlapRow({ id: 'month', assets: [...shared, ...ids('m', 6)], data: { ruleId: 'month_recap', score: 119 } }),
        // Floor 3; without the shared pair it would drop to 2 and be deleted under the bug.
        overlapRow({
          id: 'otd',
          assets: [...shared, ...ids('o', 2)],
          type: MemoryType.OnThisDay,
          data: { year: 2025 },
        }),
      ] as any);

      await sut.onRuleMemoriesCreate();

      // `month` is invisible to this owner, so it must be dropped entirely — it neither claims
      // (no strip on `otd`) nor is itself touched (no strip/delete on `month`, even though 8 of
      // its own assets would clear its floor and 3 of `otd`'s would not clear its own if the two
      // ever competed). `otd` keeps every one of its 4 assets and survives untouched.
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
      expect(mocks.memory.delete).not.toHaveBeenCalled();
    });

    // OD-3: upstream's birthday memory is shown like any other, so it takes part in the sweep. It
    // has no registry key, so it is unmanaged: it claims its photos (the ones taken on the birthday,
    // which that day's on_this_day card also holds) and is never stripped or deleted itself.
    it('F1b: a birthday row (immich-30831) claims its photos as an unmanaged memory', async () => {
      const shared = ids('x', 2);
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([
        overlapRow({
          id: 'birthday',
          assets: [...shared, ...ids('b', 3)],
          type: MemoryType.Birthday,
          data: { personId: 'person-1', personName: 'Alice', year: 1990 },
        }),
        // Floor 3; losing the shared pair leaves 2, so it is deleted.
        overlapRow({
          id: 'otd',
          assets: [...shared, ...ids('o', 2)],
          type: MemoryType.OnThisDay,
          data: { year: 2025 },
        }),
      ] as any);

      await runJob();

      expect(mocks.memory.delete).toHaveBeenCalledExactlyOnceWith('otd');
      expect(mocks.memory.removeAssetIds).not.toHaveBeenCalled();
    });
  });

  describe('overlap backfill', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
      mocks.memoryRuleAsset.getForOverlapReconcile.mockResolvedValue([]);
      mocks.memory.removeAssetIds.mockResolvedValue(void 0);
      mocks.memory.delete.mockResolvedValue(void 0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('B1: walks from the oldest memory to today and records the cursor', async () => {
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(new Date('2026-09-01T00:00:00Z'));

      await runWithState({});

      // 1st, 2nd, 3rd of September for the backfill, plus the nightly window pass.
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledTimes(4);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.MemoriesState,
        expect.objectContaining({ overlapBackfilledAt: expect.stringContaining('2026-09-03') }),
      );
    });

    // The guard is `overlapBackfilledAt >= today`, so this is only a no-op WITHIN the same UTC
    // day the cursor already reached — not "once and never again". The next night `today`
    // advances past the recorded cursor, the guard fails, and the backfill runs its cheap
    // one-day catch-up slice (`cursor+1 .. today`) again — see B3 and spec §6.9.
    it('B2: does no backfill work when the cursor has already reached today (same UTC day)', async () => {
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(new Date('2026-01-01T00:00:00Z'));

      await runWithState({ overlapBackfilledAt: '2026-09-03T00:00:00.000Z' });

      // Only the nightly window pass — the backfill short-circuits before even querying.
      expect(mocks.memoryRuleAsset.getOldestMemoryDate).not.toHaveBeenCalled();
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledTimes(1);
    });

    it('guards the cursor in UTC regardless of the host timezone', async () => {
      // vitest pins TZ=UTC for the whole process (server/test/vitest.config.mjs), so an unzoned
      // `fromISO` would still resolve to UTC here and this hazard would go untested. Overriding
      // Luxon's own default zone is the only way to exercise it; always restored below so it
      // cannot leak into other tests.
      const originalZone = Settings.defaultZone;
      Settings.defaultZone = 'America/New_York';
      try {
        mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(new Date('2026-01-01T00:00:00Z'));

        await runWithState({ overlapBackfilledAt: '2026-09-03T00:00:00.000Z' });

        // Same as B2: the guard must still short-circuit before querying, even though the host
        // (and now Luxon's default) zone is west of UTC.
        expect(mocks.memoryRuleAsset.getOldestMemoryDate).not.toHaveBeenCalled();
      } finally {
        Settings.defaultZone = originalZone;
      }
    });

    it('B3: resumes from the recorded cursor rather than restarting', async () => {
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(new Date('2026-01-01T00:00:00Z'));

      await runWithState({ overlapBackfilledAt: '2026-09-02T00:00:00.000Z' });

      // Only the 3rd remains, plus the nightly window pass.
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledTimes(2);
    });

    it('B4/B6: records completion without walking when there are no memories at all', async () => {
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(null);

      await runWithState({});

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.MemoriesState,
        expect.objectContaining({ overlapBackfilledAt: expect.any(String) }),
      );
      // Only the nightly window pass.
      expect(mocks.memoryRuleAsset.getForOverlapReconcile).toHaveBeenCalledTimes(1);
    });

    it('B5: runs the backfill before the nightly window pass', async () => {
      mocks.memoryRuleAsset.getOldestMemoryDate.mockResolvedValue(new Date('2026-09-03T00:00:00Z'));
      const windows: { from: Date; to: Date }[] = [];
      mocks.memoryRuleAsset.getForOverlapReconcile.mockImplementation((_ownerId: string, window: any) => {
        windows.push(window);
        return Promise.resolve([]);
      });

      await runWithState({});

      // Backfill covers a single day; the nightly pass spans today..today+3.
      expect(windows).toHaveLength(2);
      expect(windows[1]!.to.getTime() - windows[1]!.from.getTime()).toBeGreaterThan(
        windows[0]!.to.getTime() - windows[0]!.from.getTime(),
      );
    });
  });
});
