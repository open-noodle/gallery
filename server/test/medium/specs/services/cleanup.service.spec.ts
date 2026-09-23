import { Kysely } from 'kysely';
import { AssetStatus, CleanupQueue } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { CleanupRepository } from 'src/repositories/cleanup.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { CleanupService } from 'src/services/cleanup.service.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(CleanupService, {
    database: db || defaultDatabase,
    real: [AssetRepository, CleanupRepository],
    mock: [EventRepository, JobRepository, LoggingRepository],
  });

  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  return { sut, ctx };
};

const getAssetRow = (ctx: MediumTestContext, id: string) =>
  ctx.database.selectFrom('asset').select(['id', 'status', 'deletedAt']).where('id', '=', id).executeTakeFirst();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(CleanupService.name, () => {
  describe('commit', () => {
    it('trashes an owned asset in the database', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([asset.id]);
      expect(res.skipped).toEqual([]);
      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetTrashAll', {
        assetIds: [asset.id],
        userId: user.id,
      });

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.status).toBe(AssetStatus.Trashed);
      expect(row!.deletedAt).not.toBeNull();
    });

    it('skips an already-trashed asset without changing its deletedAt', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const deletedAt = new Date('2024-01-01T00:00:00Z');
      const { asset } = await ctx.newAsset({ ownerId: user.id, deletedAt, status: AssetStatus.Trashed });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([]);
      expect(res.skipped).toEqual([{ id: asset.id, reason: 'already_trashed' }]);
      expect(ctx.getMock(EventRepository).emit).not.toHaveBeenCalled();

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    });

    it("reports another user's asset id as not_found, without touching it", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: other.id });
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [asset.id],
        favoriteIds: [],
        keepIds: [],
      });

      expect(res.trashed).toEqual([]);
      expect(res.skipped).toEqual([{ id: asset.id, reason: 'not_found' }]);

      const row = await getAssetRow(ctx, asset.id);
      expect(row!.status).toBe(AssetStatus.Active);
      expect(row!.deletedAt).toBeNull();
    });

    it('writes a cleanup_day_review row when completeMonthDay is given', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      await sut.commit(auth, {
        queue: CleanupQueue.Rewind,
        trashIds: [],
        favoriteIds: [],
        keepIds: [],
        completeMonthDay: 923,
      });

      const reviews = await ctx.get(CleanupRepository).getDayReviews(user.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].monthDay).toBe(923);
    });
  });

  describe('getCalendar', () => {
    it('returns 366 days', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user: { id: user.id } });

      const res = await sut.getCalendar(auth, 'UTC');
      expect(res.days).toHaveLength(366);
    });
  });
});
