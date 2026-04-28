import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetFileType, AssetVisibility, MemoryType } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

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

const newPersonAsset = async (
  ctx: ReturnType<typeof setup>['ctx'],
  { ownerId, personGroupId, localDateTime }: { ownerId: string; personGroupId: string; localDateTime: string },
) => {
  const { asset } = await ctx.newAsset({ ownerId, localDateTime });
  await Promise.all([
    ctx.newAssetFace({ assetId: asset.id, personGroupId }),
    ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` }),
  ]);
  return asset;
};

const newBirthdayPerson = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice', birthDate: '1990-06-13' });
  return { user, person };
};

describe(MemoryRepository.name, () => {
  const birthDate = { year: 1990, month: 6, day: 13 };
  const until = { year: 2025, month: 6, day: 13 };

  describe('getPersonBirthdayYears', () => {
    it('should return the distinct years with assets on the birthday, newest first', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const args = { ownerId: user.id, personGroupId: person.personGroupId };
      await newPersonAsset(ctx, { ...args, localDateTime: '2020-06-13T10:00:00.000Z' });
      await newPersonAsset(ctx, { ...args, localDateTime: '2022-06-13T08:00:00.000Z' });
      await newPersonAsset(ctx, { ...args, localDateTime: '2022-06-13T09:00:00.000Z' });
      await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T12:00:00.000Z' });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([2024, 2022, 2020]);
    });

    it('should ignore assets taken on other days', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      await newPersonAsset(ctx, {
        ownerId: user.id,
        personGroupId: person.personGroupId,
        localDateTime: '2024-06-14T12:00:00.000Z',
      });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets of other people', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const { person: otherPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
      await newPersonAsset(ctx, {
        ownerId: user.id,
        personGroupId: otherPerson.personGroupId,
        localDateTime: '2024-06-13T12:00:00.000Z',
      });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets without a preview file', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2024-06-13T12:00:00.000Z' });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore trashed assets', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const asset = await newPersonAsset(ctx, {
        ownerId: user.id,
        personGroupId: person.personGroupId,
        localDateTime: '2024-06-13T12:00:00.000Z',
      });
      await ctx.softDeleteAsset(asset.id);

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets that are not timeline-visible', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: '2024-06-13T12:00:00.000Z',
        visibility: AssetVisibility.Archive,
      });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets with a soft-deleted face', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2024-06-13T12:00:00.000Z' });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId, deletedAt: new Date() });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets with an invisible face', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime: '2024-06-13T12:00:00.000Z' });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId, isVisible: false });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should ignore assets taken before the person was born', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      await newPersonAsset(ctx, {
        ownerId: user.id,
        personGroupId: person.personGroupId,
        localDateTime: '1985-06-13T12:00:00.000Z',
      });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([]);
    });

    it('should include assets taken on the day of birth', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      await newPersonAsset(ctx, {
        ownerId: user.id,
        personGroupId: person.personGroupId,
        localDateTime: '1990-06-13T12:00:00.000Z',
      });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([1990]);
    });

    it('should ignore assets taken on or after the until date', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const args = { ownerId: user.id, personGroupId: person.personGroupId };
      await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T12:00:00.000Z' });
      await newPersonAsset(ctx, { ...args, localDateTime: '2025-06-13T12:00:00.000Z' });

      const years = await sut.getPersonBirthdayYears(user.id, person.personGroupId, birthDate, until);

      expect(years).toEqual([2024]);
    });
  });

  describe('getPersonAssetsByDate', () => {
    it('should return the newest assets of the given date, newest first, up to the limit', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const args = { ownerId: user.id, personGroupId: person.personGroupId };
      await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T01:00:00.000Z' });
      const nextNewest2024 = await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T02:00:00.000Z' });
      const newest2024 = await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T03:00:00.000Z' });
      await newPersonAsset(ctx, { ...args, localDateTime: '2023-06-13T01:00:00.000Z' });

      const assets = await sut.getPersonAssetsByDate(
        user.id,
        person.personGroupId,
        { year: 2024, month: 6, day: 13 },
        2,
      );

      expect(assets.map(({ id }) => id)).toEqual([newest2024.id, nextNewest2024.id]);
    });

    it('should return the single newest asset when the limit is 1', async () => {
      const { ctx, sut } = setup();
      const { user, person } = await newBirthdayPerson(ctx);
      const args = { ownerId: user.id, personGroupId: person.personGroupId };
      await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T01:00:00.000Z' });
      const newest2024 = await newPersonAsset(ctx, { ...args, localDateTime: '2024-06-13T02:00:00.000Z' });

      const assets = await sut.getPersonAssetsByDate(
        user.id,
        person.personGroupId,
        { year: 2024, month: 6, day: 13 },
        1,
      );

      expect(assets.map(({ id }) => id)).toEqual([newest2024.id]);
    });
  });

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
});
