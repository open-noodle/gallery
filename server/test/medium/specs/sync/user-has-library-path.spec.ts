import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
};

const callFn = async (db: Kysely<DB>, libraryId: string, userId: string, excludeSpaceId: string): Promise<boolean> => {
  const result = await db.executeQuery(
    sql<{
      r: boolean;
    }>`SELECT user_has_library_path(${libraryId}::uuid, ${userId}::uuid, ${excludeSpaceId}::uuid) AS r`.compile(db),
  );
  return result.rows[0].r;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('user_has_library_path', () => {
  it('returns true for library owner', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    // exclude_space_id is arbitrary here because ownership is checked first.
    const { space: anySpace } = await ctx.newSharedSpace({ createdById: owner.user.id });

    const result = await callFn(db, library.id, owner.user.id, anySpace.id);

    expect(result).toBe(true);
  });

  it('returns true for member of another linked space', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: member.user.id });

    const result = await callFn(db, library.id, member.user.id, spaceA.id);

    expect(result).toBe(true);
  });

  it('returns true for creator of another linked space', async () => {
    const { ctx, db } = setup();
    const libraryOwner = await ctx.newUser();
    const otherCreator = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: libraryOwner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: libraryOwner.user.id });
    // spaceB is owned (created) by otherCreator but NOT a member row for him —
    // the path check must pick up the createdById branch, not just the member
    // table.
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: otherCreator.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });

    const result = await callFn(db, library.id, otherCreator.user.id, spaceA.id);

    expect(result).toBe(true);
  });

  it('returns false when the excluded space is the only path', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });

    const result = await callFn(db, library.id, member.user.id, space.id);

    expect(result).toBe(false);
  });

  it('ignores soft-deleted libraries on the owner branch', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const { space: anySpace } = await ctx.newSharedSpace({ createdById: owner.user.id });

    const result = await callFn(db, library.id, owner.user.id, anySpace.id);

    expect(result).toBe(false);
  });

  it('returns true when soft-deleted owner falls back to a member path', async () => {
    const { ctx, db } = setup();
    // The owner branch returns false (deletedAt set), but the member branch picks
    // up another linked space the user is in. The function's three-branch OR must
    // still resolve to true.
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.user.id });

    const result = await callFn(db, library.id, owner.user.id, spaceA.id);

    expect(result).toBe(true);
  });
});
