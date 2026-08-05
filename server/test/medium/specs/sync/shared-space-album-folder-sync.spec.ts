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

/** Insert a folder directly — the repository helper is server-side and already exists. */
const newFolder = async (db: Kysely<DB>, spaceId: string, name: string, parentId: string | null = null) =>
  db
    .insertInto('shared_space_album_folder')
    .values({ spaceId, parentId, name, createdById: null })
    .returningAll()
    .executeTakeFirstOrThrow();

describe('shared_space_album_folder_audit', () => {
  // Without a tombstone a deleted folder simply stops being emitted, and a client that already
  // synced it has no way to learn it is gone — it would linger in the local tree forever.
  it('records a row carrying the deleted folder id and its space', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();

    expect(audit).toHaveLength(1);
    expect(audit[0].spaceId).toBe(space.id);
    // `id` is the audit row's OWN uuidv7 — it is the sync cursor, not the folder's id.
    expect(audit[0].id).not.toBe(folder.id);
    expect(audit[0].deletedAt).toBeInstanceOf(Date);
  });

  it('records one row per folder when several are deleted at once', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const a = await newFolder(db, space.id, 'A');
    const b = await newFolder(db, space.id, 'B');

    await db.deleteFrom('shared_space_album_folder').where('spaceId', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();

    expect(audit.map((r) => r.folderId).sort()).toEqual([a.id, b.id].sort());
  });

  // Deleting a SPACE cascades its folders. Those deletes must still tombstone, or a client that
  // loses access keeps the folder rows locally.
  it('records tombstones when folders cascade from a space delete', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();
    expect(audit).toHaveLength(1);
  });
});
