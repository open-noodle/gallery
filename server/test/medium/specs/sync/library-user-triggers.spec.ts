import { Kysely } from 'kysely';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncEntityType } from 'src/enum';
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

      const rows = await db
        .selectFrom('library_user')
        .selectAll()
        .where('libraryId', '=', library.id)
        .execute();
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
});
