import { Kysely } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const grantsFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();
const albumUpdateId = async (albumId: string) => {
  const row = await db.selectFrom('album').select('updateId').where('id', '=', albumId).executeTakeFirstOrThrow();
  return row.updateId;
};

describe('shared_space_album_after_insert_user (link → grant members)', () => {
  it('grants shared_space_album_user to every current member and bumps album.updateId', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: m1 } = await ctx.newUser();
    const { user: m2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m1.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m2.id, role: SharedSpaceRole.Viewer });
    const before = await albumUpdateId(album.id);

    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    const grants = await grantsFor(album.id);
    expect(new Set(grants.map((g) => g.userId))).toEqual(new Set([owner.id, m1.id, m2.id]));
    expect(grants.every((g) => g.createId)).toBe(true);
    expect(await albumUpdateId(album.id)).not.toEqual(before);
  });

  it('is idempotent on re-link (ON CONFLICT DO NOTHING — no duplicate grants)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    // a second (idempotent) insert attempt must not create duplicate grants
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    expect(await grantsFor(album.id)).toHaveLength(1);
  });
});

describe('shared_space_member_after_insert_album (join → grant linked albums)', () => {
  it('grants for every album already linked to the joined space and bumps each album.updateId', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: joiner } = await ctx.newUser();
    const { album: a1 } = await ctx.newAlbum({ ownerId: owner.id });
    const { album: a2 } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: a1.id, addedById: owner.id })
      .execute();
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: a2.id, addedById: owner.id })
      .execute();
    const a1Before = await albumUpdateId(a1.id);

    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: joiner.id, role: SharedSpaceRole.Viewer });

    const a1Grants = await grantsFor(a1.id);
    const a2Grants = await grantsFor(a2.id);
    expect(a1Grants.some((g) => g.userId === joiner.id)).toBe(true);
    expect(a2Grants.some((g) => g.userId === joiner.id)).toBe(true);
    expect(await albumUpdateId(a1.id)).not.toEqual(a1Before);
  });

  it('no-ops when the joined space has no linked albums', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: joiner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: joiner.id, role: SharedSpaceRole.Viewer });
    const grants = await db.selectFrom('shared_space_album_user').selectAll().where('userId', '=', joiner.id).execute();
    expect(grants).toHaveLength(0);
  });
});

// ── E2: documentation test — simultaneous member-insert + album-link race ────
//
// Two triggers handle grant creation:
//   A1 (shared_space_album_after_insert_user): album-link → grants all current members
//   A2 (shared_space_member_after_insert_album): member-join → grants all already-linked albums
//
// LOW-PROBABILITY HAZARD: if a member INSERT and an album-link INSERT land in
// two concurrent transactions, each trigger sees only the rows committed before
// its READ snapshot.  In the worst case:
//   - T1 reads shared_space_member (to fan-out grants) before T2 commits the
//     member row → T1 misses the new member.
//   - T2 reads shared_space_album (to fan-out grants) before T1 commits the
//     album row → T2 misses the new album.
//   Both triggers complete without error; neither wrote a grant for the
//   (new-member, new-album) pair.
//
// This mirrors the equivalent hazard in the library trigger set (see
// library-audit-triggers.spec.ts trigger_simultaneous_member_and_library_unlink).
//
// RESOLUTION (M7): getCreatedAfter (SharedSpaceAlbumSync) reads FROM the
// shared_space_album_user grant table itself, so a grant that was never
// inserted has no row to re-deliver — the backfill stream does NOT self-heal
// this on reconnect. The actual fix is reconcileAlbumGrants (see
// shared-space-album-grant-reconcile.spec.ts's M7 tests), which now runs
// bidirectionally (INSERT missing grants for any (member, linked-album) pair
// with a live path, in addition to its pre-existing revoke sweep) and is
// enqueued post-commit from linkAlbum and addMember — the two create-side
// paths that can hit this race.
//
// This test documents the *sequential* outcome (each event fires after the other
// is committed) and asserts both grants ARE written — confirming the happy-path
// behavior that the race can interfere with.
describe('(doc) simultaneous member-insert + album-link race — sequential simulation', () => {
  it('both grants are written when the two events are strictly ordered', async () => {
    // Sequential simulation: member joins, then album is linked.
    // In a real concurrent scenario the second trigger might not see the first
    // row yet (see comment above), leaving exactly one grant instead of two.
    // This test documents the expected sequential outcome.
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: lateMember } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });

    // Event 1 (strictly before event 2): member joins the space.
    // A2 fires but finds no linked albums → no grant yet for lateMember.
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: lateMember.id, role: SharedSpaceRole.Viewer });
    const grantsAfterJoin = await db
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('userId', '=', lateMember.id)
      .execute();
    expect(grantsAfterJoin).toHaveLength(0); // no albums linked yet

    // Event 2 (strictly after event 1): album is linked.
    // A1 fires and now sees lateMember in shared_space_member → grant written.
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();
    const grantsAfterLink = await db
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('userId', '=', lateMember.id)
      .execute();
    expect(grantsAfterLink.some((g) => g.albumId === album.id)).toBe(true);
  });
});

describe('re-link after unlink refreshes the grant createId (albums-9)', () => {
  it('bumps createId on ON CONFLICT when the grant survived via another path', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });

    // Link into both spaces → one grant for member (PK dedups). It survives an s1 unlink via s2.
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });
    await ctx.newSharedSpaceAlbum({ spaceId: s2.id, albumId: album.id, addedById: owner.id });
    const grantsBefore = await grantsFor(album.id);
    const grantBefore = grantsBefore.find((g) => g.userId === member.id)!;

    await db.deleteFrom('shared_space_album').where('spaceId', '=', s1.id).where('albumId', '=', album.id).execute();
    // grant retained via s2 (user_has_album_path true)
    const grantsAfterUnlink = await grantsFor(album.id);
    expect(grantsAfterUnlink.some((g) => g.userId === member.id)).toBe(true);

    // Re-link into s1 → ON CONFLICT DO UPDATE refreshes the surviving grant's createId
    await ctx.newSharedSpaceAlbum({ spaceId: s1.id, albumId: album.id, addedById: owner.id });

    const grantsAfter = await grantsFor(album.id);
    const grantAfter = grantsAfter.find((g) => g.userId === member.id)!;
    expect(grantAfter.createId > grantBefore.createId).toBe(true);
  });

  it('a fresh legitimate grant (no prior path) is a plain insert, not a resurrection', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    // unlink → sole path gone → grant revoked
    await db.deleteFrom('shared_space_album').where('spaceId', '=', space.id).where('albumId', '=', album.id).execute();
    const grantsAfterUnlink = await grantsFor(album.id);
    expect(grantsAfterUnlink.some((g) => g.userId === member.id)).toBe(false);

    // re-link → plain INSERT (no conflict), member re-granted exactly once
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    const grantsAfterRelink = await grantsFor(album.id);
    expect(grantsAfterRelink.filter((g) => g.userId === member.id)).toHaveLength(1);
  });
});

describe('member re-join refreshes a surviving grant createId (#752 launch review F-A)', () => {
  it('re-adding a member refreshes a surviving grant createId so backfill re-fires', async () => {
    const ctx = new SyncTestContext(db);
    // Given: member M in space S; M is also an album_user Editor of album L, so removing M from S
    // leaves the shared_space_album_user(M, L) grant in place (user_has_album_path stays true).
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await ctx.newAlbumUser({ albumId: album.id, userId: member.id, role: AlbumUserRole.Editor });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id }); // link → grant created

    const readGrant = () =>
      db
        .selectFrom('shared_space_album_user')
        .select('createId')
        .where('userId', '=', member.id)
        .where('albumId', '=', album.id)
        .executeTakeFirst();

    const before = await readGrant();
    // Remove M from S — the delete-audit trigger keeps the grant (survives via album_user).
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.id)
      .execute();
    const afterRemoval = await readGrant();
    expect(afterRemoval?.createId).toBe(before?.createId); // precondition: grant survived, createId stale

    // When: M is re-added → the member-join trigger fires against the surviving grant.
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });

    // Then: the grant's createId was refreshed (and createdAt bumped) so backfill re-fires.
    const afterRejoin = await readGrant();
    expect(afterRejoin?.createId).not.toBe(before?.createId);
  });
});
