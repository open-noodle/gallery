import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const grantsFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();
const grantAuditFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user_audit').selectAll().where('albumId', '=', albumId).execute();
const linkAuditFor = (albumId: string) =>
  db.selectFrom('shared_space_album_audit').selectAll().where('albumId', '=', albumId).execute();

const softDelete = (albumId: string) =>
  db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', albumId).execute();
const restore = (albumId: string) =>
  db.updateTable('album').set({ deletedAt: null }).where('id', '=', albumId).execute();

// A space with owner (Owner member) + one Viewer member, linking `album`.
// newSharedSpaceAlbum fires the create-side grant trigger → both members granted.
const linkedSpace = async (ctx: SyncTestContext, ownerId: string, albumId: string, viewerId: string) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewerId, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId, addedById: ownerId });
  return space;
};

describe('album_soft_delete_shared_space_album — soft-delete branch', () => {
  it('tombstones every grant and every space→album link when the album is soft-deleted', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);
    const grantsBefore = await grantsFor(album.id);
    expect(grantsBefore.length).toBe(2); // owner + viewer

    await softDelete(album.id);

    // grants revoked (consumer deleted them after the audit insert)
    expect(await grantsFor(album.id)).toHaveLength(0);
    // one grant-revocation audit row per prior grant-holder
    const ga = await grantAuditFor(album.id);
    expect(ga.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id].sort());
    // one link tombstone per (space, album) link
    const la = await linkAuditFor(album.id);
    expect(la.map((r) => r.spaceId)).toEqual([space.id]);
  });

  it('does NOT act on a non-deletedAt update (updateId bump / rename)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await db.updateTable('album').set({ albumName: 'renamed' }).where('id', '=', album.id).execute();

    const grantsAfter = await grantsFor(album.id);
    expect(grantsAfter.length).toBe(2); // untouched
    expect(await grantAuditFor(album.id)).toHaveLength(0);
    expect(await linkAuditFor(album.id)).toHaveLength(0);
  });

  it('does NOT double-tombstone when softDeleteAll re-stamps an already-trashed album', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await softDelete(album.id);
    const grantAuditAfterFirst = await grantAuditFor(album.id);
    const linkAuditAfterFirst = await linkAuditFor(album.id);
    const auditAfterFirst = grantAuditAfterFirst.length;
    const linkAfterFirst = linkAuditAfterFirst.length;

    // re-stamp deletedAt to a new timestamp (NOT NULL → NOT NULL, no transition)
    await db.updateTable('album').set({ deletedAt: new Date() }).where('id', '=', album.id).execute();

    const grantAuditAfterSecond = await grantAuditFor(album.id);
    const linkAuditAfterSecond = await linkAuditFor(album.id);
    expect(grantAuditAfterSecond.length).toBe(auditAfterFirst); // no new rows
    expect(linkAuditAfterSecond.length).toBe(linkAfterFirst);
  });
});

describe('album_soft_delete_shared_space_album — restore branch', () => {
  it('re-creates every member grant with a FRESH createId on restore', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await linkedSpace(ctx, owner.id, album.id, viewer.id);
    const before = await grantsFor(album.id);
    const viewerCreateIdBefore = before.find((g) => g.userId === viewer.id)!.createId;

    await softDelete(album.id);
    expect(await grantsFor(album.id)).toHaveLength(0);

    await restore(album.id);

    const after = await grantsFor(album.id);
    expect(after.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id].sort());
    // re-created via plain INSERT → a new createId (default immich_uuid_v7()), strictly greater
    const viewerCreateIdAfter = after.find((g) => g.userId === viewer.id)!.createId;
    expect(viewerCreateIdAfter > viewerCreateIdBefore).toBe(true);
  });

  it('bumps shared_space_album.updateId on restore so the link row re-delivers', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);
    const linkRowBefore = await db
      .selectFrom('shared_space_album')
      .select('updateId')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    const updateIdBefore = linkRowBefore.updateId;

    await softDelete(album.id);
    await restore(album.id);

    const linkRowAfter = await db
      .selectFrom('shared_space_album')
      .select('updateId')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .executeTakeFirstOrThrow();
    const updateIdAfter = linkRowAfter.updateId;
    expect(updateIdAfter > updateIdBefore).toBe(true);
  });

  it('re-delivers a grant created DURING the trash window with a bumped createId (albums-3)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { user: latecomer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const space = await linkedSpace(ctx, owner.id, album.id, viewer.id);

    await softDelete(album.id); // grants revoked

    // A new member joins DURING the window → member-join create-side trigger inserts a grant
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: latecomer.id, role: SharedSpaceRole.Viewer });
    const grantsDuringWindow = await grantsFor(album.id);
    const windowGrant = grantsDuringWindow.find((g) => g.userId === latecomer.id)!;
    expect(windowGrant).toBeDefined();

    await restore(album.id);

    const after = await grantsFor(album.id);
    // latecomer's grant survived the ON CONFLICT and its createId was bumped
    const latecomerAfter = after.find((g) => g.userId === latecomer.id)!;
    expect(latecomerAfter.createId > windowGrant.createId).toBe(true);
    // and owner + viewer were re-created too
    expect(after.map((r) => r.userId).sort()).toEqual([owner.id, viewer.id, latecomer.id].sort());
  });
});

describe('album in two spaces during a trash window', () => {
  it('restore re-grants via the still-linked space without double-creating', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });

    await softDelete(album.id);
    // one space unlinks the trashed album during the window
    await db.deleteFrom('shared_space_album').where('spaceId', '=', s1.id).where('albumId', '=', album.id).execute();

    await restore(album.id);

    // exactly one grant for member (PK dedups; re-granted via s2 only)
    const grantsAfterRestore = await grantsFor(album.id);
    const memberGrants = grantsAfterRestore.filter((g) => g.userId === member.id);
    expect(memberGrants).toHaveLength(1);
  });
});
