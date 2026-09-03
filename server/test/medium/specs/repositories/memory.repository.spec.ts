import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetVisibility, MemoryType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(MemoryRepository) };
};

const selectMemoryIds = (ctx: ReturnType<typeof setup>['ctx']) =>
  ctx.database.selectFrom('memory').select('id').orderBy('id').execute();

const selectMemoryAssetRows = (ctx: ReturnType<typeof setup>['ctx']) =>
  ctx.database.selectFrom('memory_asset').select(['assetId', 'memoriesId']).execute();

const cleanupNow = () => DateTime.utc(2026, 4, 27) as DateTime<true>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(MemoryRepository.name, () => {
  describe('cleanup', () => {
    it('should delete only unsaved memories older than the retention period', async () => {
      const now = vi.spyOn(DateTime, 'now').mockReturnValue(cleanupNow());

      try {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const oldDate = new Date('2024-01-01T00:00:00Z');
        const newDate = new Date('2026-01-01T00:00:00Z');
        const { memory: oldUnsavedMemory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: oldDate,
          updatedAt: oldDate,
          isSaved: false,
        });
        const { memory: newUnsavedMemory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: newDate,
          updatedAt: newDate,
          isSaved: false,
        });
        const { memory: oldSavedMemory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: oldDate,
          updatedAt: oldDate,
          isSaved: true,
        });

        await sut.cleanup(365);

        const memories = await selectMemoryIds(ctx);
        const memoryIds = memories.map(({ id }) => id);
        expect(memoryIds).not.toContain(oldUnsavedMemory.id);
        expect(memoryIds).toEqual(expect.arrayContaining([newUnsavedMemory.id, oldSavedMemory.id]));
      } finally {
        now.mockRestore();
      }
    });

    it('should use the shown date when deciding retention for scheduled memories', async () => {
      const now = vi.spyOn(DateTime, 'now').mockReturnValue(cleanupNow());

      try {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const generatedDate = new Date('2026-04-20T00:00:00Z');
        const { memory: alreadyShownMemory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: generatedDate,
          updatedAt: generatedDate,
          showAt: new Date('2026-04-25T00:00:00Z'),
          isSaved: false,
        });
        const { memory: futureMemory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: generatedDate,
          updatedAt: generatedDate,
          showAt: new Date('2026-04-30T00:00:00Z'),
          isSaved: false,
        });

        await sut.cleanup(1);

        const memories = await selectMemoryIds(ctx);
        const memoryIds = memories.map(({ id }) => id);
        expect(memoryIds).not.toContain(alreadyShownMemory.id);
        expect(memoryIds).toContain(futureMemory.id);
      } finally {
        now.mockRestore();
      }
    });

    it('should keep old unsaved memories when retention is zero', async () => {
      const now = vi.spyOn(DateTime, 'now').mockReturnValue(cleanupNow());

      try {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { memory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          isSaved: false,
        });

        await sut.cleanup(0);

        const memories = await selectMemoryIds(ctx);
        const memoryIds = memories.map(({ id }) => id);
        expect(memoryIds).toContain(memory.id);
      } finally {
        now.mockRestore();
      }
    });

    it('should remove invalid asset links when retention is zero', async () => {
      const now = vi.spyOn(DateTime, 'now').mockReturnValue(cleanupNow());

      try {
        const { ctx, sut } = setup();
        const { user } = await ctx.newUser();
        const { memory } = await ctx.newMemory({
          ownerId: user.id,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          isSaved: false,
        });
        const { asset: timelineAsset } = await ctx.newAsset({
          ownerId: user.id,
          visibility: AssetVisibility.Timeline,
        });
        const { asset: archivedAsset } = await ctx.newAsset({
          ownerId: user.id,
          visibility: AssetVisibility.Archive,
        });
        await ctx.newMemoryAsset({ memoryId: memory.id, assetId: timelineAsset.id });
        await ctx.newMemoryAsset({ memoryId: memory.id, assetId: archivedAsset.id });

        await sut.cleanup(0);

        const memories = await selectMemoryIds(ctx);
        const memoryIds = memories.map(({ id }) => id);
        expect(memoryIds).toContain(memory.id);
        await expect(selectMemoryAssetRows(ctx)).resolves.toEqual([
          { assetId: timelineAsset.id, memoriesId: memory.id },
        ]);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe('hasRuleMemory', () => {
    it('should only match undeleted rule memories for the same owner, ruleId, and dedupeKey', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: otherUser } = await ctx.newUser();

      await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: {
          ruleId: 'birthday',
          dedupeKey: 'birthday:person-1:2026-04-23',
          title: 'Happy birthday, Alice',
        },
      });
      await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: {
          ruleId: 'birthday',
          dedupeKey: 'birthday:person-1:2026-04-24',
          title: 'Happy birthday, Alice',
        },
      });
      await ctx.newMemory({
        ownerId: otherUser.id,
        type: MemoryType.Rule,
        data: {
          ruleId: 'birthday',
          dedupeKey: 'birthday:person-1:2026-04-23',
          title: 'Happy birthday, Alice',
        },
      });
      const { memory: deletedMemory } = await ctx.newMemory({
        ownerId: user.id,
        type: MemoryType.Rule,
        data: {
          ruleId: 'recent_trip',
          dedupeKey: 'recent_trip:france:paris:2026-04-23',
          title: 'Recent trip to Paris, France',
        },
      });
      await ctx.database
        .updateTable('memory')
        .set({ deletedAt: new Date('2026-04-23T00:00:00Z') })
        .where('id', '=', deletedMemory.id)
        .execute();

      await expect(sut.hasRuleMemory(user.id, 'birthday', 'birthday:person-1:2026-04-23')).resolves.toBe(true);
      await expect(sut.hasRuleMemory(user.id, 'birthday', 'birthday:person-1:2026-04-25')).resolves.toBe(false);
      await expect(sut.hasRuleMemory(user.id, 'recent_trip', 'recent_trip:france:paris:2026-04-23')).resolves.toBe(
        false,
      );
    });
  });

  describe('getForOverlapReconcile', () => {
    const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-04T23:59:59Z') };

    it('R1: includes a memory with a null hideAt', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-09-02T00:00:00Z'),
        hideAt: null,
      });

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.map(({ id }) => id)).toContain(memory.id);
    });

    it('R2: includes a memory with a null showAt', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({ ownerId: user.id, showAt: null, hideAt: null });

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.map(({ id }) => id)).toContain(memory.id);
    });

    it('R3/R4: includes memories touching each window boundary', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory: endsAtFrom } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-08-20T00:00:00Z'),
        hideAt: window.from,
      });
      const { memory: startsAtTo } = await ctx.newMemory({
        ownerId: user.id,
        showAt: window.to,
        hideAt: new Date('2026-09-20T00:00:00Z'),
      });

      const rows = await sut.getForOverlapReconcile(user.id, window);
      const ids = rows.map(({ id }) => id);

      expect(ids).toEqual(expect.arrayContaining([endsAtFrom.id, startsAtTo.id]));
    });

    it('R5: excludes a memory that ended before the window', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-08-01T00:00:00Z'),
        hideAt: new Date('2026-08-10T00:00:00Z'),
      });

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.map(({ id }) => id)).not.toContain(memory.id);
    });

    it('R7: excludes another owner’s memory', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: other.id,
        showAt: new Date('2026-09-02T00:00:00Z'),
        hideAt: new Date('2026-09-02T23:59:59Z'),
      });

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.map(({ id }) => id)).not.toContain(memory.id);
    });

    it('R10/S8: excludes a trashed memory', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-09-02T00:00:00Z'),
        hideAt: new Date('2026-09-02T23:59:59Z'),
      });
      // ctx.newMemory's create() re-fetches through a builder that filters `deletedAt is null`,
      // so a memory can't be created pre-deleted — soft-delete it after the fact instead, as the
      // hasRuleMemory tests above do.
      await ctx.database
        .updateTable('memory')
        .set({ deletedAt: new Date('2026-09-02T06:00:00Z') })
        .where('id', '=', memory.id)
        .execute();

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.map(({ id }) => id)).not.toContain(memory.id);
    });

    it('R8: returns a memory with no assets, with an empty asset list', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-09-02T00:00:00Z'),
        hideAt: new Date('2026-09-02T23:59:59Z'),
      });

      const rows = await sut.getForOverlapReconcile(user.id, window);

      expect(rows.find(({ id }) => id === memory.id)?.assets).toEqual([]);
    });

    it('R6/R9: returns exactly the assets `search` returns for the same memory', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { memory } = await ctx.newMemory({
        ownerId: user.id,
        showAt: new Date('2026-09-02T00:00:00Z'),
        hideAt: new Date('2026-09-02T23:59:59Z'),
      });

      const { asset: visible } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: archived } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: trashed } = await ctx.newAsset({
        ownerId: user.id,
        visibility: AssetVisibility.Timeline,
        deletedAt: new Date(),
      });
      const { asset: hiddenPerson } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { person } = await ctx.newPerson({ ownerId: user.id, isHidden: true });
      await ctx.newAssetFace({ assetId: hiddenPerson.id, personGroupId: person.personGroupId });

      for (const asset of [visible, archived, trashed, hiddenPerson]) {
        await ctx.newMemoryAsset({ memoryId: memory.id, assetId: asset.id });
      }

      const reconcile = await sut.getForOverlapReconcile(user.id, window);
      const searched = await sut.search(user.id, { for: new Date('2026-09-02T12:00:00Z') });

      const reconcileIds = reconcile.find(({ id }) => id === memory.id)!.assets.map(({ id }) => id);
      const searchIds = searched.find(({ id }) => id === memory.id)!.assets.map(({ id }) => id);

      // Asserting the two queries against EACH OTHER, not a fixed list, is what stops them
      // drifting apart later. The floor must be measured over exactly what the card renders.
      expect(reconcileIds.toSorted()).toEqual(searchIds.toSorted());
      expect(reconcileIds).toEqual([visible.id]);
    });
  });

  describe('getOldestMemoryDate', () => {
    it('returns null when there are no memories', async () => {
      const { sut } = setup(await getKyselyDB());
      await expect(sut.getOldestMemoryDate()).resolves.toBeNull();
    });

    it('returns the earliest showAt across all owners', async () => {
      const db = await getKyselyDB();
      const { ctx, sut } = setup(db);
      const { user } = await ctx.newUser();
      await ctx.newMemory({ ownerId: user.id, showAt: new Date('2026-05-01T00:00:00Z') });
      await ctx.newMemory({ ownerId: user.id, showAt: new Date('2026-01-01T00:00:00Z') });

      await expect(sut.getOldestMemoryDate()).resolves.toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('falls back to createdAt for a memory with a null showAt', async () => {
      const db = await getKyselyDB();
      const { ctx, sut } = setup(db);
      const { user } = await ctx.newUser();
      await ctx.newMemory({
        ownerId: user.id,
        showAt: null,
        createdAt: new Date('2025-12-25T00:00:00Z'),
      });

      await expect(sut.getOldestMemoryDate()).resolves.toEqual(new Date('2025-12-25T00:00:00Z'));
    });
  });
});
