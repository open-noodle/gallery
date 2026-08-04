import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Repo-level tests for SharedSpaceAlbumLinkSync:
//   - getBackfill: per-space backfill of shared_space_album join rows incl. showInTimeline
//   - getUpserts: streams join rows scoped by accessibleSpaces
//   - getDeletes: reads shared_space_album_audit (link-removal audit) scoped by accessibleSpaces

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumLink };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceAlbumLinkSync.getBackfill', () => {
  it('returns join rows for the given space including showInTimeline', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id, showInTimeline: true });

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id);
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
    const row = result.find((r: any) => r.albumId === album.id);
    expect(row).toBeDefined();
    expect(row.showInTimeline).toBe(true);
    expect(row.spaceId).toBe(space.id);
  });

  it('does not return join rows for a different space', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id });

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, s2.id);
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });
});

describe('SharedSpaceAlbumLinkSync.getUpserts', () => {
  it('returns join rows for accessible spaces (via membership)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
  });

  it('returns join rows for accessible spaces (via space creator path)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
  });

  it('does not return join rows for inaccessible spaces', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: stranger.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).not.toContain(album.id);
  });

  it('includes showInTimeline in the emitted payload', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    const row = result.find((r: any) => r.albumId === album.id);
    expect(row).toBeDefined();
    expect(row.showInTimeline).toBe(false);
  });
});

describe('SharedSpaceAlbumLinkSync.getDeletes', () => {
  it('returns rows from shared_space_album_audit for accessible spaces', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    // Insert a link-removal audit row (written by the A3 delete trigger on shared_space_album)
    await db.insertInto('shared_space_album_audit').values({ spaceId: space.id, albumId: album.id }).execute();

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.some((r: any) => r.albumId === album.id && r.spaceId === space.id)).toBe(true);
  });

  it('does not return audit rows for inaccessible spaces', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    await db.insertInto('shared_space_album_audit').values({ spaceId: space.id, albumId: album.id }).execute();

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: stranger.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });
});

describe('SharedSpaceAlbumLinkSync — soft-deleted album exclusion (Slice 8)', () => {
  it('getUpserts excludes a soft-deleted album link row but keeps live ones', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album: live } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: trashed } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: live.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    const albumIds = result.map((r: any) => r.albumId);
    expect(albumIds).toContain(live.id);
    expect(albumIds).not.toContain(trashed.id);
  });

  it('getBackfill excludes a soft-deleted album link row but keeps live ones', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album: live } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: trashed } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: live.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id);
    const result: any[] = await Array.fromAsync(stream);
    const albumIds = result.map((r: any) => r.albumId);
    expect(albumIds).toContain(live.id);
    expect(albumIds).not.toContain(trashed.id);
  });

  it('re-includes the link row after the album is restored', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();
    await db.updateTable('album').set({ deletedAt: null }).where('id', '=', album.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
  });
});

describe('SharedSpaceAlbumLinkSync — folder placement omitted from sync payload (S-01)', () => {
  // S-01: writing folderId bumps updateId (the table has an updatedAt trigger and an updateId
  // column), so reorganising an album into a folder re-emits its link row to mobile. That is
  // acceptable ONLY because folderId is absent from SHARED_SPACE_ALBUM_SYNC_COLUMNS, making the
  // re-emit an idempotent no-op upsert for a client that has never heard of folders.
  // If this test fails, someone added folderId to the sync payload — that is a mobile-facing
  // decision and needs its own spec, not a drive-by column addition here.
  it('does not leak folderId into the album link sync payload after a folder move', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const sharedSpaceRepository = ctx.get(SharedSpaceRepository);
    const folder = await sharedSpaceRepository.createAlbumFolder({
      spaceId: space.id,
      parentId: null,
      name: 'Trips',
      createdById: owner.id,
    });
    await sharedSpaceRepository.setAlbumLinkFolder(space.id, album.id, folder.id);

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    const row = result.find((r: any) => r.albumId === album.id);

    // The row still re-emits (that's the expected, harmless side effect of the updateId bump)…
    expect(row).toBeDefined();
    // …but its payload must never carry folderId.
    expect(row).not.toHaveProperty('folderId');
  });
});
