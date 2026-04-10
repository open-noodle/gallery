import { Kysely } from 'kysely';
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
});
