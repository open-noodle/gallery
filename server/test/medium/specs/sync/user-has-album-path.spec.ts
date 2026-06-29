import { Kysely, sql } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const hasPath = async (albumId: string, userId: string, excludeSpaceId: string) => {
  const res = await sql<{
    ok: boolean;
  }>`SELECT user_has_album_path(${albumId}::uuid, ${userId}::uuid, ${excludeSpaceId}::uuid) AS ok`.execute(db);
  return res.rows[0].ok;
};

const NIL = '00000000-0000-0000-0000-000000000000'; // a "no excluded space" sentinel

describe('user_has_album_path', () => {
  it('true via album ownership (deletedAt NULL)', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    expect(await hasPath(album.id, user.id, NIL)).toBe(true);
  });

  it('false when the owning album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();
    // ownership branch requires deletedAt IS NULL; no other path exists
    expect(await hasPath(album.id, user.id, NIL)).toBe(false);
  });

  it('true via a manual album_user row of any role', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer })
      .execute();
    expect(await hasPath(album.id, viewer.id, NIL)).toBe(true);
  });

  it('true via membership in another space that links the album (excluding the given space)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s2.id, albumId: album.id, addedById: owner.id })
      .execute();
    // exclude a DIFFERENT space → s2 path still counts
    expect(await hasPath(album.id, member.id, NIL)).toBe(true);
    // exclude s2 itself → that path is removed; member has no other path
    expect(await hasPath(album.id, member.id, s2.id)).toBe(false);
  });

  it('true via being the creator of another space that links the album', async () => {
    const ctx = new SyncTestContext(db);
    const { user: creator } = await ctx.newUser();
    const { user: albumOwner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: albumOwner.id });
    const { space } = await ctx.newSharedSpace({ createdById: creator.id });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: creator.id })
      .execute();
    expect(await hasPath(album.id, creator.id, NIL)).toBe(true);
    expect(await hasPath(album.id, creator.id, space.id)).toBe(false);
  });

  it('false when the user has no path at all', async () => {
    const ctx = new SyncTestContext(db);
    const { user: stranger } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    expect(await hasPath(album.id, stranger.id, NIL)).toBe(false);
  });

  // --- RBAC F2: soft-deleted albums must NOT count as valid paths ---

  it('false via branch 2 (member in another space) when the album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s1.id, albumId: album.id, addedById: owner.id })
      .execute();
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s2.id, albumId: album.id, addedById: owner.id })
      .execute();

    // member reaches album via s2; excluding s1 → branch 2 should be true
    expect(await hasPath(album.id, member.id, s1.id)).toBe(true);

    // soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    // branch 2 must now return false (soft-deleted album is not a valid path)
    expect(await hasPath(album.id, member.id, s1.id)).toBe(false);
  });

  it('false via branch 3 (creator of another space) when the album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user: albumOwner } = await ctx.newUser();
    const { user: creator } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: albumOwner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: albumOwner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: creator.id });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s1.id, albumId: album.id, addedById: albumOwner.id })
      .execute();
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s2.id, albumId: album.id, addedById: creator.id })
      .execute();

    // creator of s2; excluding s1 → branch 3 should be true
    expect(await hasPath(album.id, creator.id, s1.id)).toBe(true);

    // soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    // branch 3 must now return false (soft-deleted album is not a valid path)
    expect(await hasPath(album.id, creator.id, s1.id)).toBe(false);
  });

  it('regression: branch 1 (album_user) already returns false for soft-deleted album', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer })
      .execute();
    expect(await hasPath(album.id, viewer.id, NIL)).toBe(true);
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();
    expect(await hasPath(album.id, viewer.id, NIL)).toBe(false);
  });
});
