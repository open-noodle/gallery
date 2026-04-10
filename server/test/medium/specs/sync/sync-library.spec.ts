import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.LibrariesV1, () => {
  it('emits libraries the user owns', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Owned library' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: library.id, name: 'Owned library', ownerId: auth.user.id }),
        type: SyncEntityType.LibraryV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);
  });

  it('emits libraries linked via a space the user is a member of', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Shared-via-member' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: owner.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(1);
    expect((libraryEvents[0] as { data: { id: string } }).data.id).toBe(library.id);
  });

  it('emits libraries linked via a space the user created (creator path, no member row)', async () => {
    // Defensive: exercises the creator branch of accessibleSpaces even though
    // SharedSpaceService.create always adds the creator as a member.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Creator-path' });
    // Second library owned by someone else, linked via space auth.user CREATED
    // but is NOT a member of.
    const { user: owner } = await ctx.newUser();
    const { library: otherLibrary } = await ctx.newLibrary({ ownerId: owner.id, name: 'Creator-path-other' });
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    // Deliberately do NOT call newSharedSpaceMember for auth.user.
    await ctx.newSharedSpaceLibrary({
      spaceId: space.id,
      libraryId: otherLibrary.id,
      addedById: auth.user.id,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    const ids = libraryEvents.map((e: { data: { id: string } }) => e.data.id);
    expect(ids).toEqual(expect.arrayContaining([library.id, otherLibrary.id]));
    expect(ids).toHaveLength(2);
  });

  it('does not emit libraries the user has no path to', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    await ctx.newLibrary({ ownerId: stranger.id, name: 'Unreachable' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(0);
  });

  it('does not emit soft-deleted libraries owned by the user', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Soft-deleted' });
    await defaultDatabase.updateTable('library').set({ deletedAt: new Date() }).where('id', '=', library.id).execute();

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(0);
  });

  it('emits an updated library row when a property changes', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Original' });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);

    await defaultDatabase.updateTable('library').set({ name: 'Renamed' }).where('id', '=', library.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    expect(next).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: library.id, name: 'Renamed' }),
        type: SyncEntityType.LibraryV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('emits a delete event from library_audit when a member is removed from the only space linking the library', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Lose-via-member-delete' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: owner.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);

    // Remove auth.user from the space — trigger fan-out writes a library_audit
    // row for auth.user because they have no other path to the library.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', auth.user.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.LibraryDeleteV1);
    expect(deleteEvents).toHaveLength(1);
    expect((deleteEvents[0] as { data: { libraryId: string } }).data.libraryId).toBe(library.id);
  });

  it("emits a partner's library via the creator path through the dispatch loop", async () => {
    // accessibleLibraries' ownership branch only matches libraries owned by the
    // current user. This test verifies that auth.user can ALSO see a library
    // owned by a partner (B) when auth.user is the creator of a space S that
    // links B's library — even though auth.user is not in shared_space_member
    // for S (the creator-only branch of accessibleSpaces), and even though
    // auth.user does not own the library. The library reaches auth.user via
    // shared_space_library → shared_space (createdById = auth.user).
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: partner.id, name: "Partner's library" });
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    // Deliberately do NOT call newSharedSpaceMember for auth.user — exercise
    // the pure creator branch.
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(1);
    expect((libraryEvents[0] as { data: { id: string; ownerId: string } }).data).toMatchObject({
      id: library.id,
      ownerId: partner.id,
    });
  });

  it('emits incremental update events when an accessible library is renamed after initial sync', async () => {
    // Plan Task 24's unit tests for LibrarySync.getUpserts cover the query-level
    // delta behavior. This test verifies the dispatch-loop integration: after a
    // user has acked the initial sync, renaming the library on the server must
    // produce a LibraryV1 event on the next sync (not just a stale-state miss).
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id, name: 'Original name' });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    expect(initial.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1)).toHaveLength(1);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);

    // Rename the library — the updated_at trigger advances library.updateId.
    await defaultDatabase
      .updateTable('library')
      .set({ name: 'Renamed library' })
      .where('id', '=', library.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(1);
    expect((libraryEvents[0] as { data: { id: string; name: string } }).data).toMatchObject({
      id: library.id,
      name: 'Renamed library',
    });

    await ctx.syncAckAll(auth, next);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);
  });

  it('does not emit libraries to a partner (partner relationship has no library path)', async () => {
    // Lock in the design: accessibleLibraries has three branches
    // (ownership, member-of-linked-space, creator-of-linked-space) and
    // explicitly does NOT include the partner relationship. Adding a
    // partner must not stream the partner's libraries.
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    await ctx.newLibrary({ ownerId: partner.id, name: "Partner's private library" });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(0);
  });

  it('does not emit libraries to a partner via a space the partner did not join', async () => {
    // Harder case: partner A owns a library and links it to a space. User B
    // is A's partner but NOT a member of the space and NOT the creator.
    // Partnership alone must not grant library access.
    const { auth, ctx } = await setup();
    const { user: partner } = await ctx.newUser();
    await ctx.newPartner({ sharedById: partner.id, sharedWithId: auth.user.id });
    const { library } = await ctx.newLibrary({ ownerId: partner.id });
    const { space } = await ctx.newSharedSpace({ createdById: partner.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(0);
  });

  it('emits a library with zero assets (empty library still appears in the stream)', async () => {
    // A library with no assets should still show up in LibrariesV1 so the
    // client can create its local library_entity row before assets arrive.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Empty library' });

    const response = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const libraryEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(libraryEvents).toHaveLength(1);
    expect((libraryEvents[0] as { data: { id: string } }).data.id).toBe(library.id);
  });

  it('advances the checkpoint across two consecutive renames with an intermediate ack', async () => {
    // Rename A → ack → rename B → resync. The second sync must see name B
    // (delta correctness) and NOT re-emit any earlier state.
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id, name: 'Rename A' });

    const first = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    await ctx.syncAckAll(auth, first);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);

    await defaultDatabase.updateTable('library').set({ name: 'Rename B' }).where('id', '=', library.id).execute();

    const second = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const secondEvents = second.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(secondEvents).toHaveLength(1);
    expect((secondEvents[0] as { data: { name: string } }).data.name).toBe('Rename B');

    await ctx.syncAckAll(auth, second);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.LibrariesV1]);

    await defaultDatabase.updateTable('library').set({ name: 'Rename C' }).where('id', '=', library.id).execute();

    const third = await ctx.syncStream(auth, [SyncRequestType.LibrariesV1]);
    const thirdEvents = third.filter((r: { type: string }) => r.type === SyncEntityType.LibraryV1);
    expect(thirdEvents).toHaveLength(1);
    expect((thirdEvents[0] as { data: { name: string } }).data.name).toBe('Rename C');
  });

  it('emits delete events to multiple users when they simultaneously lose access', async () => {
    // Unlinking a library from its only linking space should emit
    // library_audit rows for every member who loses their last path. Both
    // users call sync independently; each must see a LibraryDeleteV1 event
    // for the same library.
    const { auth: authA, ctx: ctxA } = await setup();
    const ctxB = new SyncTestContext(defaultDatabase);
    const { auth: authB } = await ctxB.newSyncAuthUser();

    const { user: owner } = await ctxA.newUser();
    const { library } = await ctxA.newLibrary({ ownerId: owner.id });
    const { space } = await ctxA.newSharedSpace({ createdById: owner.id });
    await ctxA.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctxA.newSharedSpaceMember({ spaceId: space.id, userId: authA.user.id, role: SharedSpaceRole.Editor });
    await ctxA.newSharedSpaceMember({ spaceId: space.id, userId: authB.user.id, role: SharedSpaceRole.Editor });
    await ctxA.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const initialA = await ctxA.syncStream(authA, [SyncRequestType.LibrariesV1]);
    const initialB = await ctxB.syncStream(authB, [SyncRequestType.LibrariesV1]);
    await ctxA.syncAckAll(authA, initialA);
    await ctxB.syncAckAll(authB, initialB);

    // Unlink library → both users fan out audit rows.
    await defaultDatabase
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const nextA = await ctxA.syncStream(authA, [SyncRequestType.LibrariesV1]);
    const nextB = await ctxB.syncStream(authB, [SyncRequestType.LibrariesV1]);

    const deletesA = nextA.filter(
      (r: { type: string; data: { libraryId?: string } }) =>
        r.type === SyncEntityType.LibraryDeleteV1 && r.data.libraryId === library.id,
    );
    const deletesB = nextB.filter(
      (r: { type: string; data: { libraryId?: string } }) =>
        r.type === SyncEntityType.LibraryDeleteV1 && r.data.libraryId === library.id,
    );
    expect(deletesA).toHaveLength(1);
    expect(deletesB).toHaveLength(1);
  });
});
