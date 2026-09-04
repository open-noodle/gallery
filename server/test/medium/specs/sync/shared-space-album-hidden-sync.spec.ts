import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Repo-level tests for SharedSpaceAlbumHiddenSync:
//   - getUpserts: streams MY OWN shared_space_album_hidden rows only (userId equality, NOT
//     accessibleSpaces — a member must never receive a peer's hidden rows, S16).
//   - getDeletes: reads shared_space_album_hidden_audit scoped by userId equality (S16-delete).
//   - getBackfill: per-space backfill of my own hidden rows.

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return {
    ctx,
    db: defaultDatabase,
    sut: ctx.get(SyncRepository).sharedSpaceAlbumHidden,
    spaceRepo: ctx.get(SharedSpaceRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceAlbumHiddenSync.getUpserts', () => {
  it('streams my own hidden row as an upsert', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, owner.id);

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ spaceId: space.id, albumId: album.id, userId: owner.id });
  });

  it("S16: does NOT stream another member of the same space their peer's hidden row", async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: memberA } = await ctx.newUser();
    const { user: memberB } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // Member A hides the album — this is A's own private preference.
    await spaceRepo.hideAlbumForUser(space.id, album.id, memberA.id);

    // Sync as member B: B must receive NOTHING.
    const stream = sut.getUpserts({ nowId: NOW_ID, userId: memberB.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });

  it('a member who has hidden nothing receives an empty stream', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });

  it('does not stream rows for a soft-deleted album', async () => {
    const { ctx, db, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, owner.id);
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });
});

describe('SharedSpaceAlbumHiddenSync.getDeletes', () => {
  it('streams a delete when the member unhides', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, owner.id);
    await spaceRepo.unhideAlbumForUser(space.id, album.id, owner.id);

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.some((r: any) => r.albumId === album.id && r.spaceId === space.id && r.userId === owner.id)).toBe(
      true,
    );
  });

  it("S16-delete: does NOT stream another member's delete", async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: memberA } = await ctx.newUser();
    const { user: memberB } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, memberA.id);
    await spaceRepo.unhideAlbumForUser(space.id, album.id, memberA.id);

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: memberB.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });

  it('streams a delete when the row disappears via the unlink cascade', async () => {
    const { ctx, db, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, owner.id);

    // Unlinking the album from the space cascades to shared_space_album_hidden via the composite
    // FK, and the AFTER DELETE trigger writes the audit row.
    await db.deleteFrom('shared_space_album').where('spaceId', '=', space.id).where('albumId', '=', album.id).execute();

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: owner.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.some((r: any) => r.albumId === album.id && r.spaceId === space.id && r.userId === owner.id)).toBe(
      true,
    );
  });
});

describe('SharedSpaceAlbumHiddenSync.getBackfill', () => {
  it('backfills existing hidden rows for a newly-synced space', async () => {
    const { ctx, sut, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await spaceRepo.hideAlbumForUser(space.id, album.id, owner.id);

    const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id, owner.id);
    const result: any[] = await Array.fromAsync(stream);
    expect(result.some((r: any) => r.albumId === album.id && r.spaceId === space.id && r.userId === owner.id)).toBe(
      true,
    );
  });
});
