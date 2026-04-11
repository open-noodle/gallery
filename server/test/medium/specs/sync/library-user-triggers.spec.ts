import { Kysely } from 'kysely';
import { SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('library_user triggers', () => {
  describe('library_after_insert', () => {
    it('inserts a library_user row for the owner with library.createId', async () => {
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

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

    it('does not insert a library_user row when deletedAt is set at insert time', async () => {
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();
      // Direct insert so we can set deletedAt at creation time.
      const library = await db
        .insertInto('library')
        .values({
          name: 'already-deleted',
          ownerId: user.id,
          importPaths: ['/import'],
          exclusionPatterns: [],
          deletedAt: new Date(),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const rows = await db.selectFrom('library_user').selectAll().where('libraryId', '=', library.id).execute();
      expect(rows).toHaveLength(0);
    });

    it('inserts one library_user row per library when multiple libraries are created in one statement', async () => {
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();

      const libraries = await db
        .insertInto('library')
        .values([
          { name: 'bulk-1', ownerId: user.id, importPaths: ['/import'], exclusionPatterns: [] },
          { name: 'bulk-2', ownerId: user.id, importPaths: ['/import'], exclusionPatterns: [] },
          { name: 'bulk-3', ownerId: user.id, importPaths: ['/import'], exclusionPatterns: [] },
          { name: 'bulk-4', ownerId: user.id, importPaths: ['/import'], exclusionPatterns: [] },
          { name: 'bulk-5', ownerId: user.id, importPaths: ['/import'], exclusionPatterns: [] },
        ])
        .returning(['id', 'createId', 'createdAt'])
        .execute();
      expect(libraries).toHaveLength(5);

      const rows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', user.id)
        .where(
          'libraryId',
          'in',
          libraries.map((l) => l.id),
        )
        .execute();
      expect(rows).toHaveLength(5);

      // Each library_user row's createId must match its library's createId.
      const byLibraryId = new Map(rows.map((r) => [r.libraryId, r]));
      for (const lib of libraries) {
        const userRow = byLibraryId.get(lib.id);
        expect(userRow).toBeDefined();
        expect(userRow!.createId).toBe(lib.createId);
      }
      // All 5 createIds are distinct (pins VOLATILE immich_uuid_v7 per-row
      // evaluation for both the library INSERT and the trigger's copy).
      const uniqueCreateIds = new Set(rows.map((r) => r.createId));
      expect(uniqueCreateIds.size).toBe(5);
    });
  });

  describe('shared_space_member_after_insert_library', () => {
    it('grants library_user for every library linked to the space the new member joined', async () => {
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: newMember } = await ctx.newUser();

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });

      // Three libraries, all owned by owner, all linked to the space.
      const { library: libraryA } = await ctx.newLibrary({ ownerId: owner.id });
      const { library: libraryB } = await ctx.newLibrary({ ownerId: owner.id });
      const { library: libraryC } = await ctx.newLibrary({ ownerId: owner.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libraryA.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libraryB.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libraryC.id });

      // Capture library.updateId BEFORE the trigger bumps them.
      const beforeUpdateIds = await db
        .selectFrom('library')
        .select(['id', 'updateId'])
        .where('id', 'in', [libraryA.id, libraryB.id, libraryC.id])
        .execute();

      // Add newMember — trigger fires.
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: newMember.id });

      // Each library should have a library_user row for newMember.
      const rows = await db
        .selectFrom('library_user')
        .select(['libraryId', 'createId'])
        .where('userId', '=', newMember.id)
        .execute();
      expect(rows.map((r) => r.libraryId).toSorted()).toEqual([libraryA.id, libraryB.id, libraryC.id].toSorted());

      // CreateIds should be freshly-minted (distinct).
      const uniqueCreateIds = new Set(rows.map((r) => r.createId));
      expect(uniqueCreateIds.size).toBe(3);

      // library.updateId bumped for all three libraries.
      const afterUpdateIds = await db
        .selectFrom('library')
        .select(['id', 'updateId'])
        .where('id', 'in', [libraryA.id, libraryB.id, libraryC.id])
        .execute();
      const beforeById = new Map(beforeUpdateIds.map((r) => [r.id, r.updateId]));
      for (const after of afterUpdateIds) {
        expect(after.updateId).not.toBe(beforeById.get(after.id));
      }
    });

    it('is a no-op when the space has zero linked libraries', async () => {
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: newMember } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });

      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: newMember.id });

      const rows = await db.selectFrom('library_user').selectAll().where('userId', '=', newMember.id).execute();
      expect(rows).toHaveLength(0);
    });

    it('ON CONFLICT DO NOTHING preserves an existing owner library_user row', async () => {
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      // Owner already has a row from library_after_insert with library.createId.
      const ownerRowBefore = await db
        .selectFrom('library_user')
        .select(['createId'])
        .where('userId', '=', user.id)
        .where('libraryId', '=', library.id)
        .executeTakeFirstOrThrow();
      expect(ownerRowBefore.createId).toBe(library.createId);

      // Link the library to a space and add a new member. The trigger's
      // INSERT...ON CONFLICT won't touch the owner's existing row, but it
      // will grant access to peer.
      const { space } = await ctx.newSharedSpace({ createdById: user.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
      const { user: peer } = await ctx.newUser();
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

      // Owner's row is unchanged.
      const ownerRowAfter = await db
        .selectFrom('library_user')
        .select(['createId'])
        .where('userId', '=', user.id)
        .where('libraryId', '=', library.id)
        .executeTakeFirstOrThrow();
      expect(ownerRowAfter.createId).toBe(library.createId);

      // Peer got a row with a fresh createId.
      const peerRow = await db
        .selectFrom('library_user')
        .select(['createId'])
        .where('userId', '=', peer.id)
        .where('libraryId', '=', library.id)
        .executeTakeFirstOrThrow();
      expect(peerRow.createId).not.toBe(library.createId);
    });

    it('LibrarySync.getUpserts re-delivers the library to the new member after the updateId bump', async () => {
      const { ctx, db } = setup();
      const syncRepo = ctx.get(SyncRepository);
      const { user: owner } = await ctx.newUser();
      const { user: newMember } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

      // Snapshot library.updateId before the trigger bumps it.
      const preBump = await db
        .selectFrom('library')
        .select(['updateId'])
        .where('id', '=', library.id)
        .executeTakeFirstOrThrow();

      // newMember joins → shared_space_member_after_insert_library fires
      // and bumps library.updateId.
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: newMember.id });

      // A dummyNowId past any possible uuid_v7, and ack at the pre-bump
      // updateId. The new updateId is > ack, so the upsert stream should
      // include this library.
      const upsertStream = syncRepo.library.getUpserts({
        nowId: 'ffffffff-ffff-7fff-bfff-ffffffffffff',
        userId: newMember.id,
        ack: { type: SyncEntityType.LibraryV1, updateId: preBump.updateId },
      });
      const rows: { id: string }[] = [];
      for await (const row of upsertStream) {
        rows.push(row);
      }
      expect(rows.map((r) => r.id)).toContain(library.id);
    });
  });

  describe('shared_space_library_after_insert_user', () => {
    it('grants library_user for every member of the space when a library is linked', async () => {
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: memberA } = await ctx.newUser();
      const { user: memberB } = await ctx.newUser();

      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.id });

      const { library } = await ctx.newLibrary({ ownerId: owner.id });

      const before = await db
        .selectFrom('library')
        .select(['updateId'])
        .where('id', '=', library.id)
        .executeTakeFirstOrThrow();

      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

      // memberA and memberB should both get library_user rows.
      const rows = await db.selectFrom('library_user').select(['userId']).where('libraryId', '=', library.id).execute();
      const userIds = rows.map((r) => r.userId);
      expect(userIds).toContain(owner.id); // from library_after_insert
      expect(userIds).toContain(memberA.id);
      expect(userIds).toContain(memberB.id);

      // library.updateId was bumped.
      const after = await db
        .selectFrom('library')
        .select(['updateId'])
        .where('id', '=', library.id)
        .executeTakeFirstOrThrow();
      expect(after.updateId).not.toBe(before.updateId);
    });

    // Documentation test: pins the "creator is always a member" asymmetry
    // flagged in the design's Known Limitations section. If the invariant
    // breaks (e.g., a future refactor of SharedSpaceService.create), the
    // create-side trigger will silently fail to populate library_user for
    // a creator-but-not-member, while the delete-side defensively preserves
    // them. This test documents that state so whoever touches space creation
    // knows the consequence.
    it('(known limitation) does not populate library_user for a space creator who is not a member', async () => {
      const { ctx, db } = setup();
      const { user: creator } = await ctx.newUser();
      const { user: libOwner } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: libOwner.id });

      // Direct insert of a shared_space WITHOUT a shared_space_member row
      // for the creator.
      const space = await db
        .insertInto('shared_space')
        .values({ name: 'orphan-creator', createdById: creator.id })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

      // shared_space_library_after_insert_user (Task 9) joins on
      // shared_space_member; there's no row for creator, so no library_user
      // is created for them. library_after_insert already populated libOwner,
      // but NOT the creator.
      const rows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', creator.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(rows).toHaveLength(0);
    });
  });

  describe('library_user_delete_after_audit', () => {
    it('removes library_user when a member leaves a space and has no other path', async () => {
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id });

      // Sanity: viewer has the library_user row.
      const before = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', viewer.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(before).toHaveLength(1);

      // Viewer leaves (delete the shared_space_member row).
      await db
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', viewer.id)
        .execute();

      const after = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', viewer.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(after).toHaveLength(0);
    });

    it('preserves library_user for the owner when another member leaves a space linking their library', async () => {
      // Pins two properties together:
      //   1. The audit chain's gate skips the owner when peer leaves. The
      //      consumer trigger's DELETE ... USING inserted_rows only touches
      //      userIds present in the `new` NEW TABLE — owner is not there.
      //   2. The DELETE scope is strict — no side-effect on other rows.
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: peer } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: owner.id });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: peer.id });

      // Sanity: both have rows.
      expect(
        await db.selectFrom('library_user').selectAll().where('libraryId', '=', library.id).execute(),
      ).toHaveLength(2);

      // Peer leaves.
      await db
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', peer.id)
        .execute();

      // Owner's row survives.
      const ownerRows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', owner.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(ownerRows).toHaveLength(1);
      // Peer's row is gone.
      const peerRows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', peer.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(peerRows).toHaveLength(0);
    });

    it('removes library_user for all affected members when a shared_space is hard-deleted (cascade path)', async () => {
      // REGRESSION GUARD for the dropped defensive clause. Under the original
      // design, the `NOT user_has_library_path(..., NULL)` filter would run
      // inside the BEFORE DELETE trigger of shared_space, BEFORE the FK
      // cascade removed shared_space_library / shared_space_member rows — so
      // it would see the still-alive path and incorrectly preserve library_user
      // rows for members who should have lost access.
      const { ctx, db } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewerA } = await ctx.newUser();
      const { user: viewerB } = await ctx.newUser();
      const { user: spaceCreator } = await ctx.newUser();
      const { library: lib1 } = await ctx.newLibrary({ ownerId: owner.id });
      const { library: lib2 } = await ctx.newLibrary({ ownerId: owner.id });
      const { space } = await ctx.newSharedSpace({ createdById: spaceCreator.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: lib1.id });
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: lib2.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewerA.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewerB.id });
      // spaceCreator is NOT auto-added as member by newSharedSpace, so the
      // user_has_library_path "creator-of-a-linked-space" branch covers them.

      // Sanity snapshot: owner's 2 rows + viewerA's 2 + viewerB's 2 = 6.
      // spaceCreator has no library_user row because the trigger only runs
      // for member-insert, not creator-insert.
      const beforeRows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('libraryId', 'in', [lib1.id, lib2.id])
        .execute();
      expect(beforeRows).toHaveLength(6);

      // Hard-delete the whole space. BEFORE-trigger fan-out inserts into
      // library_audit for every (viewerA|B, library) pair that loses its
      // only path, and for spaceCreator (via the creator branch) — though
      // spaceCreator has no library_user row, so nothing changes for them.
      // Owner's rows are NOT touched (owned path remains).
      await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

      // Only owner's two rows remain.
      const remaining = await db
        .selectFrom('library_user')
        .selectAll()
        .where('libraryId', 'in', [lib1.id, lib2.id])
        .execute();
      expect(remaining).toHaveLength(2);
      expect(remaining.every((r) => r.userId === owner.id)).toBe(true);
    });

    it('trusts the inserter gate: a manual library_audit insert deletes library_user unconditionally', async () => {
      // The consumer does NOT re-check user_has_library_path. Any code path
      // inserting into library_audit MUST gate beforehand — the consumer
      // deletes whatever it's told to.
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      const before = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', user.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(before).toHaveLength(1);

      // Manually insert into library_audit, bypassing the gating path.
      await db.insertInto('library_audit').values({ libraryId: library.id, userId: user.id }).execute();

      const after = await db
        .selectFrom('library_user')
        .selectAll()
        .where('userId', '=', user.id)
        .where('libraryId', '=', library.id)
        .execute();
      expect(after).toHaveLength(0);
    });

    it('hard-deleting a library removes library_user rows via FK cascade (no library_audit involvement)', async () => {
      const { ctx, db } = setup();
      const { user } = await ctx.newUser();
      const { library } = await ctx.newLibrary({ ownerId: user.id });

      const before = await db.selectFrom('library_user').selectAll().where('libraryId', '=', library.id).execute();
      expect(before).toHaveLength(1);

      const auditBefore = await db
        .selectFrom('library_audit')
        .selectAll()
        .where('libraryId', '=', library.id)
        .execute();

      await db.deleteFrom('library').where('id', '=', library.id).execute();

      const after = await db.selectFrom('library_user').selectAll().where('libraryId', '=', library.id).execute();
      expect(after).toHaveLength(0);

      const auditAfter = await db.selectFrom('library_audit').selectAll().where('libraryId', '=', library.id).execute();
      expect(auditAfter).toHaveLength(auditBefore.length);
    });
  });
});
