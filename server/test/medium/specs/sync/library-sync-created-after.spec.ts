import { Kysely } from 'kysely';
import { accessibleLibraries, SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Unit tests for LibrarySync.getCreatedAfter. These tests PIN the expected
// behavior of the post-fix query. The current (pre-rewrite) implementation
// reads from `library` and keys off `library.createId`; the new
// implementation (plan Task 13) reads from `library_user` and keys off
// `library_user.createId`. The set-equality and value-space-shift tests are
// regression guards that must pass against the rewrite.

let defaultDatabase: Kysely<DB>;

// A uuid_v7 value effectively at infinity — used as `nowId` so the query's
// `createId < nowId` clause never filters anything out.
const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).library };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('LibrarySync.getCreatedAfter', () => {
  it('returns libraries the user owns', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: user.id, afterCreateId: undefined });
    expect(rows.map((r) => r.id)).toContain(library.id);
  });

  it('returns libraries the user accesses via shared_space_library', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: peer.id, afterCreateId: undefined });
    expect(rows.map((r) => r.id)).toContain(library.id);
  });

  it('returns empty for a user with no library access', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: user.id, afterCreateId: undefined });
    expect(rows).toHaveLength(0);
  });

  it('excludes a soft-deleted owned library when the user has no space-linked path', async () => {
    const { ctx, db, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: user.id, afterCreateId: undefined });
    expect(rows.find((r) => r.id === library.id)).toBeUndefined();
  });

  it('includes a soft-deleted library when the user has a space-linked path to it', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: peer.id, afterCreateId: undefined });
    expect(rows.map((r) => r.id)).toContain(library.id);
  });

  it('set equality with accessibleLibraries', async () => {
    // Seed a user with a mix of owned, owned-but-soft-deleted, and
    // transitive libraries. getCreatedAfter(afterCreateId=null) must return
    // exactly the same set as accessibleLibraries(userId).
    const { ctx, db, sut } = setup();
    const { user } = await ctx.newUser();
    const { library: owned } = await ctx.newLibrary({ ownerId: user.id });

    const { library: softDeleted } = await ctx.newLibrary({ ownerId: user.id });
    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', softDeleted.id).execute();

    const { user: peer } = await ctx.newUser();
    const { library: transitive } = await ctx.newLibrary({ ownerId: peer.id });
    const { space } = await ctx.newSharedSpace({ createdById: peer.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: transitive.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id });

    const getCreatedAfterRows = await sut.getCreatedAfter({
      nowId: NOW_ID,
      userId: user.id,
      afterCreateId: undefined,
    });
    const getCreatedAfterIds = new Set(getCreatedAfterRows.map((r) => r.id));
    const accessibleRows = await db
      .selectFrom('library')
      .select('id')
      .where('library.id', 'in', (eb) => accessibleLibraries(eb, user.id))
      .execute();
    const accessibleIds = new Set(accessibleRows.map((r) => r.id));

    expect(getCreatedAfterIds).toEqual(accessibleIds);
    expect(getCreatedAfterIds.has(owned.id)).toBe(true);
    expect(getCreatedAfterIds.has(softDeleted.id)).toBe(false);
    expect(getCreatedAfterIds.has(transitive.id)).toBe(true);
  });

  // Regression guard for the deploy-time checkpoint value-space shift. Before
  // the fix, `afterCreateId` was a `library.createId` watermark; after, it's
  // a `library_user.createId` watermark. Carry a pre-fix-value-space
  // checkpoint over the boundary and assert the query returns a consistent
  // superset of the user's accessible libraries.
  it('handles a pre-fix-value-space afterCreateId checkpoint without returning a wrong set', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    // Pre-fix clients stored `library.createId` as their checkpoint.
    const preFixCheckpoint = library.createId;

    const rows = await sut.getCreatedAfter({
      nowId: NOW_ID,
      userId: peer.id,
      afterCreateId: preFixCheckpoint,
    });
    const returnedIds = new Set(rows.map((r) => r.id));

    // Every accessible library for peer appears in the result.
    const accessibleRows = await db
      .selectFrom('library')
      .select('id')
      .where('library.id', 'in', (eb) => accessibleLibraries(eb, peer.id))
      .execute();
    const accessible = new Set(accessibleRows.map((r) => r.id));
    for (const id of accessible) {
      expect(returnedIds.has(id)).toBe(true);
    }
    // No libraries the user shouldn't have access to.
    for (const id of returnedIds) {
      expect(accessible.has(id)).toBe(true);
    }
  });
});
