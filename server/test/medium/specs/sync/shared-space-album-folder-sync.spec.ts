import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
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

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const syncSetup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumFolder };
};

describe('SharedSpaceAlbumFolderSync', () => {
  // V-01
  it('V-01: streams a space folder to a member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: owner.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).toContain(folder.id);
    const row = result.find((r) => r.id === folder.id);
    expect(row.spaceId).toBe(space.id);
    expect(row.name).toBe('Trips');
    expect(row.parentId).toBeNull();
  });

  // V-02 — the privacy gate. A folder name is member-only information ("Divorce", "Medical"),
  // so a non-member must receive nothing, not an empty-but-present row.
  it('V-02: streams NOTHING to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Divorce');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).not.toContain(folder.id);
  });

  // V-03
  it('V-03: streams a tombstone to a member after a delete', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: owner.id, nowId: NOW_ID }));

    const row = result.find((r) => r.folderId === folder.id);
    expect(row).toBeDefined();
    expect(row.spaceId).toBe(space.id);
  });

  // V-04 — the same privacy gate on the delete arm. Easy to miss when cloning getUpserts.
  it('V-04: streams NO tombstones to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.folderId)).not.toContain(folder.id);
  });

  // V-05
  it('V-05: backfills a space folders for a member, and not another space', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
    const mine = await newFolder(db, space.id, 'Trips');
    const theirs = await newFolder(db, other.id, 'Elsewhere');

    const result: any[] = await Array.fromAsync(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id),
    );

    expect(result.map((r) => r.id)).toContain(mine.id);
    expect(result.map((r) => r.id)).not.toContain(theirs.id);
  });

  // V-07 — a user who LOSES access stops receiving both arms. Membership is evaluated per query,
  // so this is really a check that neither arm caches or short-circuits the gate.
  it('V-07: a revoked member receives neither folders nor tombstones', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const kept = await newFolder(db, space.id, 'Trips');
    const removed = await newFolder(db, space.id, 'Archive');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', removed.id).execute();

    // Sanity: while a member, both arms deliver.
    const memberUpserts: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));
    expect(memberUpserts.map((r) => r.id)).toContain(kept.id);

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.id)
      .execute();

    const upserts: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));
    const deletes: any[] = await Array.fromAsync(sut.getDeletes({ userId: member.id, nowId: NOW_ID }));

    expect(upserts.map((r) => r.id)).not.toContain(kept.id);
    expect(deletes.map((r) => r.folderId)).not.toContain(removed.id);
  });
});
