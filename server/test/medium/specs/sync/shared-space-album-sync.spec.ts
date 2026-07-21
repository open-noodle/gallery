import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Repo-level tests for SharedSpaceAlbumSync:
//   - getCreatedAfter: reads shared_space_album_user grant table, keyed by createId
//   - getUpserts: streams album metadata scoped to accessibleSpaceAlbums (excludes soft-deleted)
//   - getDeletes: reads shared_space_album_user_audit (the gated grant-revocation audit), NOT album_audit
//
// HYBRID-CLONE GOTCHA: getDeletes must read shared_space_album_user_audit, NOT album_audit.
// This mirrors LibrarySync.getDeletes reading library_audit (a per-user access-revocation log).

let defaultDatabase: Kysely<DB>;

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbum };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceAlbumSync.getCreatedAfter', () => {
  it('returns album grant rows for a member added via the create-side trigger', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    // Link triggers A2 grant trigger which inserts into shared_space_album_user
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: member.id, afterCreateId: undefined });
    expect(rows.map((r) => r.id)).toContain(album.id);
  });

  it('is ordered by createId asc and afterCreateId filters from that value onwards', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album: a1 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: a2 } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: a1.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: a2.id, addedById: owner.id });

    const all = await sut.getCreatedAfter({ nowId: NOW_ID, userId: member.id, afterCreateId: undefined });
    expect(all.length).toBeGreaterThanOrEqual(2);
    // All rows should be ordered by createId asc
    for (let i = 1; i < all.length; i++) {
      expect(all[i].createId >= all[i - 1].createId).toBe(true);
    }
    // Using afterCreateId = last createId returns only that one (or more at same value)
    const lastCreateId = all.at(-1)!.createId;
    const last = await sut.getCreatedAfter({ nowId: NOW_ID, userId: member.id, afterCreateId: lastCreateId });
    expect(last.length).toBeGreaterThanOrEqual(1);
    expect(last.map((r) => r.id)).toContain(all.at(-1)!.id);
  });

  it('returns empty for a non-member', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const rows = await sut.getCreatedAfter({ nowId: NOW_ID, userId: stranger.id, afterCreateId: undefined });
    expect(rows).toHaveLength(0);
  });

  it('excludes soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // Confirm grant is visible before soft-delete
    const rowsBefore = await sut.getCreatedAfter({ nowId: NOW_ID, userId: member.id, afterCreateId: undefined });
    expect(rowsBefore.map((r) => r.id)).toContain(album.id);

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const rowsAfter = await sut.getCreatedAfter({ nowId: NOW_ID, userId: member.id, afterCreateId: undefined });
    expect(rowsAfter.map((r) => r.id)).not.toContain(album.id);
  });
});

describe('SharedSpaceAlbumSync.getUpserts', () => {
  it('returns album metadata for albums accessible via space grant', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const nowId = NOW_ID;
    // Direct stream() call — collect via for-await
    const stream = sut.getUpserts({ nowId, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).toContain(album.id);
  });

  it('excludes soft-deleted albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Soft-delete the album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: member.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).not.toContain(album.id);
  });

  it('does not return albums the user has no grant for', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: stranger.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.id)).not.toContain(album.id);
  });
});

describe('SharedSpaceAlbumSync.getDeletes (hybrid-clone: reads shared_space_album_user_audit, NOT album_audit)', () => {
  it('returns rows from shared_space_album_user_audit scoped to the user', async () => {
    const { ctx, db, sut } = setup();
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });

    // Insert a grant-revocation audit row directly (this is what the A3 delete triggers write)
    await db.insertInto('shared_space_album_user_audit').values({ albumId: album.id, userId: user.id }).execute();

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: user.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result.map((r: any) => r.albumId)).toContain(album.id);
  });

  it('does not return audit rows for other users', async () => {
    const { ctx, db, sut } = setup();
    const { user: u1 } = await ctx.newUser();
    const { user: u2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: u1.id });

    // Audit row for u1, querying as u2
    await db.insertInto('shared_space_album_user_audit').values({ albumId: album.id, userId: u1.id }).execute();

    const stream = sut.getDeletes({ nowId: NOW_ID, userId: u2.id });
    const result: any[] = await Array.fromAsync(stream);
    expect(result).toHaveLength(0);
  });
});

describe('accessibleSpaceAlbums set-equality guard', () => {
  it('getUpserts returns exactly the set of non-soft-deleted space-accessible albums', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album: a1 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: a2 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: softDeleted } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: a1.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: a2.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: softDeleted.id });

    // Soft-delete one album
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', softDeleted.id).execute();

    const stream = sut.getUpserts({ nowId: NOW_ID, userId: member.id });
    const upsertRows: any[] = await Array.fromAsync(stream);
    const upsertIds = new Set(upsertRows.map((r: any) => r.id));

    // accessibleSpaceAlbums should match: a1 and a2 but NOT softDeleted
    const accessibleRows = await db
      .selectFrom('shared_space_album')
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .select('shared_space_album.albumId as id')
      .where('album.deletedAt', 'is', null)
      .where(
        'shared_space_album.spaceId',
        'in',
        db.selectFrom('shared_space_member').select('spaceId').where('userId', '=', member.id),
      )
      .execute();
    const accessibleIds = new Set(accessibleRows.map((r) => r.id));

    expect(upsertIds.has(a1.id)).toBe(true);
    expect(upsertIds.has(a2.id)).toBe(true);
    expect(upsertIds.has(softDeleted.id)).toBe(false);
    // Verify overlap (upsert result is a subset of accessible)
    for (const id of upsertIds) {
      expect(accessibleIds.has(id)).toBe(true);
    }
  });
});

describe('SharedSpaceAlbumSync.getUpserts post-grant re-delivery (E3)', () => {
  // Pins getUpserts independently from getCreatedAfter so a regression in the
  // upsert stream cannot be masked by the backfill/created-after path.
  // Scenario: member gains a grant because an album is linked to their space
  // (shared_space_album INSERT → trigger bumps album.updateId).
  // After the bump, getUpserts with ack.updateId at the pre-bump value MUST
  // include the album — asserted DIRECTLY against getUpserts, not inferred
  // from any other stream.
  it('re-delivers album via getUpserts after member gains a grant (updateId bump)', async () => {
    const { ctx, db, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });

    // Snapshot album.updateId BEFORE the link (and its updateId-bumping trigger).
    const preBump = await db
      .selectFrom('album')
      .select(['updateId'])
      .where('id', '=', album.id)
      .executeTakeFirstOrThrow();

    // Link the album to the space — triggers fire: grant inserted into
    // shared_space_album_user AND album.updateId bumped.
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    // Call getUpserts with ack at the pre-bump updateId.  Because
    // album.updateId is now > ack.updateId, the upsert stream MUST include
    // the album — this is the re-delivery contract.
    const stream = sut.getUpserts({
      nowId: NOW_ID,
      userId: member.id,
      ack: { type: SyncEntityType.SharedSpaceAlbumV1, updateId: preBump.updateId },
    });
    const result: { id: string }[] = [];
    for await (const row of stream) {
      result.push(row as { id: string });
    }
    expect(result.map((r) => r.id)).toContain(album.id);
  });
});
