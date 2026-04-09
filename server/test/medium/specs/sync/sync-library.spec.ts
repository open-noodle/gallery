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
});
