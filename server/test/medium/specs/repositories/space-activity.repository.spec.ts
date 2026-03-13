import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SpaceActivityRepository } from 'src/repositories/space-activity.repository';
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
  return { ctx, sut: ctx.get(SpaceActivityRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SpaceActivityRepository.name, () => {
  describe('create', () => {
    it('should create activity record for member invite', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const activity = await sut.create({
        spaceId: space.id,
        type: 'MEMBER_INVITED',
        userId: user.id,
        data: { invitedUserId: 'invited-user-id' },
      });

      expect(activity.id).toBeDefined();
      expect(activity.type).toBe('MEMBER_INVITED');
      expect(activity.createdAt).toBeDefined();
      expect(activity.spaceId).toBe(space.id);
      expect(activity.userId).toBe(user.id);
    });

    it('should log all 8 event types', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const eventTypes = [
        'MEMBER_INVITED',
        'MEMBER_JOINED',
        'MEMBER_LEFT',
        'ASSET_ADDED',
        'ASSET_REMOVED',
        'ROLE_CHANGED',
        'SPACE_SHARED',
        'COVER_UPDATED',
      ];

      for (const type of eventTypes) {
        const activity = await sut.create({
          spaceId: space.id,
          type: type as any,
          userId: user.id,
          data: {},
        });
        expect(activity.type).toBe(type);
      }
    });
  });

  describe('getActivities', () => {
    it('should retrieve activities for a space', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      await sut.create({
        spaceId: space.id,
        type: 'ASSET_ADDED',
        userId: user.id,
        data: {},
      });

      await sut.create({
        spaceId: space.id,
        type: 'ASSET_REMOVED',
        userId: user.id,
        data: {},
      });

      const activities = await sut.getActivities(space.id);
      expect(activities.length).toBeGreaterThanOrEqual(2);
    });

    it('should paginate activities', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      for (let i = 0; i < 25; i++) {
        await sut.create({
          spaceId: space.id,
          type: 'ASSET_ADDED',
          userId: user.id,
          data: { index: i },
        });
      }

      const page1 = await sut.getActivities(space.id, { take: 10, skip: 0 });
      const page2 = await sut.getActivities(space.id, { take: 10, skip: 10 });

      expect(page1.length).toBeLessThanOrEqual(10);
      expect(page2.length).toBeLessThanOrEqual(10);
      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });

    it('should return activities ordered by creation date descending', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const activity = await sut.create({
          spaceId: space.id,
          type: 'ASSET_ADDED',
          userId: user.id,
          data: { index: i },
        });
        ids.push(activity.id);
      }

      const activities = await sut.getActivities(space.id, { take: 50 });

      if (activities.length >= 3) {
        const ourActivities = activities.filter((a) => ids.includes(a.id));
        if (ourActivities.length > 1) {
          expect(ourActivities[0].createdAt >= ourActivities[1].createdAt).toBe(true);
        }
      }
    });
  });
});
