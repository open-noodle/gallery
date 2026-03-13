import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
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
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SharedSpaceRepository.name, () => {
  describe('logActivity', () => {
    it('should log an activity record', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'asset_add' });

      const rows = await ctx.database
        .selectFrom('shared_space_activity')
        .selectAll()
        .where('spaceId', '=', space.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        spaceId: space.id,
        userId: user.id,
        type: 'asset_add',
      });
    });

    it('should default data to empty object when not provided', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'member_join' });

      const rows = await ctx.database
        .selectFrom('shared_space_activity')
        .selectAll()
        .where('spaceId', '=', space.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].data).toEqual({});
    });

    it('should store activity metadata', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({
        spaceId: space.id,
        userId: user.id,
        type: 'asset_add',
        data: { assetCount: 5 },
      });

      const rows = await ctx.database
        .selectFrom('shared_space_activity')
        .selectAll()
        .where('spaceId', '=', space.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].data).toEqual({ assetCount: 5 });
    });
  });

  describe('getActivities', () => {
    it('should return activities ordered by createdAt desc', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'first' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'second' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'third' });

      const activities = await sut.getActivities(space.id);

      expect(activities).toHaveLength(3);
      expect(activities[0].type).toBe('third');
      expect(activities[1].type).toBe('second');
      expect(activities[2].type).toBe('first');
    });

    it('should return user data with activities', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser({ name: 'Test User', email: 'testuser@example.com' });
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'asset_add' });

      const activities = await sut.getActivities(space.id);

      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        userId: user.id,
        name: 'Test User',
        email: 'testuser@example.com',
      });
    });

    it('should paginate with limit and offset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'type_1' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'type_2' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'type_3' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'type_4' });
      await sut.logActivity({ spaceId: space.id, userId: user.id, type: 'type_5' });

      // Order is desc by createdAt: type_5, type_4, type_3, type_2, type_1
      const activities = await sut.getActivities(space.id, 2, 1);

      expect(activities).toHaveLength(2);
      expect(activities[0].type).toBe('type_4');
      expect(activities[1].type).toBe('type_3');
    });

    it('should handle activities from deleted users', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: deletedUser } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'editor' });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: deletedUser.id, role: 'editor' });

      await sut.logActivity({ spaceId: space.id, userId: deletedUser.id, type: 'asset_add' });

      // Hard-delete the user (FK ON DELETE SET NULL sets userId to null)
      await ctx.database.deleteFrom('shared_space_member').where('userId', '=', deletedUser.id).execute();
      await ctx.database.deleteFrom('user').where('id', '=', deletedUser.id).execute();

      const activities = await sut.getActivities(space.id);

      expect(activities).toHaveLength(1);
      expect(activities[0].userId).toBeNull();
      expect(activities[0].name).toBeNull();
      expect(activities[0].email).toBeNull();
    });
  });
});
