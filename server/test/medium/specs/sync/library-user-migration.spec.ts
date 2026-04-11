import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Tests for the library_user migration backfill SQL. The SQL body below is a
// verbatim copy of Pass 1 + Pass 2 in
// server/src/schema/migrations-gallery/1778300000000-AddLibraryUserTable.ts —
// keep the two in sync if you change either.
//
// These tests simulate the upgrade scenario: triggers + factory-inserted rows
// populate library_user at test setup time, we DELETE the table to mimic the
// post-create-tables-but-pre-backfill moment of a real upgrade, then re-run
// the backfill SQL and assert the resulting state.

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
};

const runBackfill = async (db: Kysely<DB>) => {
  await sql`
    INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
    SELECT "ownerId", "id", "createId", "createdAt"
    FROM library
    WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
    ON CONFLICT ("userId", "libraryId") DO NOTHING;
  `.execute(db);

  await sql`
    INSERT INTO library_user ("userId", "libraryId")
    SELECT DISTINCT ssm."userId", ssl."libraryId"
    FROM shared_space_library ssl
    INNER JOIN shared_space_member ssm ON ssl."spaceId" = ssm."spaceId"
    ON CONFLICT ("userId", "libraryId") DO NOTHING;
  `.execute(db);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('library_user migration backfill', () => {
  it('owner rows use library.createId and createdAt (Pass 1)', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    // Simulate upgrade state: library exists, library_user empty for this
    // (user, library) pair.
    await db.deleteFrom('library_user').where('userId', '=', user.id).where('libraryId', '=', library.id).execute();

    await runBackfill(db);

    const row = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .where('libraryId', '=', library.id)
      .executeTakeFirstOrThrow();
    expect(row.createId).toBe(library.createId);
    expect(row.createdAt).toEqual(library.createdAt);
  });

  it('transitive rows use a fresh createId (Pass 2)', async () => {
    const { ctx, db } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    // Clear what the triggers populated to simulate upgrade state.
    await db.deleteFrom('library_user').where('libraryId', '=', library.id).execute();

    // Capture a pre-backfill uuid_v7 marker via raw SQL so the Kysely API
    // shape doesn't matter.
    const marker = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(db);
    const backfillStart = marker.rows[0].id;

    await runBackfill(db);

    const peerRow = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', peer.id)
      .where('libraryId', '=', library.id)
      .executeTakeFirstOrThrow();
    // Fresh createId, strictly greater than the pre-backfill marker AND the
    // library's original createId. Pass 2 does not propagate library.createId.
    expect(peerRow.createId > backfillStart).toBe(true);
    expect(peerRow.createId > library.createId).toBe(true);
  });

  it('Pass 2 preserves owner rows via ON CONFLICT DO NOTHING', async () => {
    // Owner owns the library AND is a member of a space that also links it.
    // Pass 1 inserts owner's row with library.createId, Pass 2 would attempt
    // a fresh createId, but ON CONFLICT preserves Pass 1.
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id });

    await db.deleteFrom('library_user').where('libraryId', '=', library.id).execute();

    await runBackfill(db);

    const rows = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].createId).toBe(library.createId);
    expect(rows[0].createdAt).toEqual(library.createdAt);
  });

  it('is idempotent: re-running both passes is a no-op', async () => {
    const { ctx, db } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    await db.deleteFrom('library_user').where('libraryId', '=', library.id).execute();

    await runBackfill(db);
    const firstSnapshot = await db
      .selectFrom('library_user')
      .select(['userId', 'libraryId', 'createId', 'createdAt'])
      .where('libraryId', '=', library.id)
      .orderBy('userId')
      .orderBy('libraryId')
      .execute();

    await runBackfill(db);
    const secondSnapshot = await db
      .selectFrom('library_user')
      .select(['userId', 'libraryId', 'createId', 'createdAt'])
      .where('libraryId', '=', library.id)
      .orderBy('userId')
      .orderBy('libraryId')
      .execute();

    expect(secondSnapshot).toEqual(firstSnapshot);
  });

  it('includes soft-deleted libraries in Pass 2 when linked to a space', async () => {
    // Matches accessibleLibraries behavior for the space-link branch: a
    // soft-deleted library is still reachable for members via the
    // shared_space_library path until hard-deleted.
    const { ctx, db } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: peer } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

    // Soft-delete the library.
    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    await db.deleteFrom('library_user').where('libraryId', '=', library.id).execute();

    await runBackfill(db);

    // peer still gets a row (Pass 2, no deletedAt filter).
    const peerRow = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', peer.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(peerRow).toHaveLength(1);
    // owner does NOT (Pass 1 excludes deletedAt IS NOT NULL).
    const ownerRow = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', owner.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(ownerRow).toHaveLength(0);
  });

  it('skips soft-deleted owned libraries in Pass 1 when there is no space path', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    await db.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();
    await db.deleteFrom('library_user').where('libraryId', '=', library.id).execute();

    await runBackfill(db);

    const rows = await db
      .selectFrom('library_user')
      .selectAll()
      .where('userId', '=', user.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(rows).toHaveLength(0);
  });
});
