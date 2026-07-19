import { Kysely } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

const linksFor = (spaceId: string) =>
  db.selectFrom('shared_space_album').selectAll().where('spaceId', '=', spaceId).execute();

describe('removeOwnedAlbumLinksAddedBy (albums-6)', () => {
  it('unlinks an album the departing member added AND owns', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser(); // space owner + album owner
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: member.id }); // member OWNS this album
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: member.id });
    expect(await linksFor(space.id)).toHaveLength(1);

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([album.id]);
    expect(await linksFor(space.id)).toHaveLength(0);
    // the delete-audit trigger tombstoned the (space, album) link
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('spaceId', '=', space.id)
      .execute();
    expect(linkAudit).toHaveLength(1);
  });

  it('does NOT unlink an album the member added but does NOT own', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    // owner owns the album; member is only an editor of it (album_user role=editor)
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: member.id, role: AlbumUserRole.Editor })
      .execute();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: member.id });

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([]);
    expect(await linksFor(space.id)).toHaveLength(1); // link preserved
  });

  it('does NOT unlink an owned album that a DIFFERENT user added', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: member.id }); // member owns it
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    // owner added the link, not member
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([]);
    expect(await linksFor(space.id)).toHaveLength(1);
  });

  // M9: a departing member's link to their own TRASHED album used to survive departure
  // (the subquery filtered `album.deletedAt IS NULL`), because the soft-delete trigger
  // tombstones grants but leaves the shared_space_album LINK row in place. A later
  // restore then re-created grants for S's current members — re-sharing an album the
  // owner had already removed themselves from the space with.
  it('unlinks an album the departing member added AND owns even while it is TRASHED, so a later restore does NOT re-share it (M9)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser(); // space owner
    const { user: member } = await ctx.newUser(); // departing member + album owner
    const { album } = await ctx.newAlbum({ ownerId: member.id }); // member OWNS this album
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: member.id });
    expect(await linksFor(space.id)).toHaveLength(1);

    // member trashes their own album — the soft-delete trigger tombstones grants but the
    // shared_space_album link row survives (by design, so a quick restore re-syncs cleanly).
    await ctx.softDeleteAlbum(album.id);
    expect(await linksFor(space.id)).toHaveLength(1);

    // member leaves the space
    const unlinked = await sut.removeOwnedAlbumLinksAddedBy(space.id, member.id);

    expect(unlinked).toEqual([album.id]);
    expect(await linksFor(space.id)).toHaveLength(0);

    // member restores their album — it must NOT reappear for S's members, and no grants exist
    await db.updateTable('album').set({ deletedAt: null }).where('id', '=', album.id).execute();

    expect(await linksFor(space.id)).toHaveLength(0);
    const grants = await db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', album.id).execute();
    expect(grants).toHaveLength(0);
  });
});
