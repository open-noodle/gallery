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

const isJoinEvent = (r: { type: string }) =>
  r.type === SyncEntityType.SharedSpaceLibraryV1 || r.type === SyncEntityType.SharedSpaceLibraryBackfillV1;

describe(SyncRequestType.SharedSpaceLibrariesV1, () => {
  it('emits join rows the user can access via space membership', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceLibrariesV1]);
    const joinEvents = response.filter((r) => isJoinEvent(r));
    expect(joinEvents).toHaveLength(1);
    expect((joinEvents[0] as { data: { spaceId: string; libraryId: string } }).data).toMatchObject({
      spaceId: space.id,
      libraryId: library.id,
    });
  });

  it('emits join rows the user can access via the space-creator path', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    // No newSharedSpaceMember — exercise the pure creator branch.
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceLibrariesV1]);
    const joinEvents = response.filter((r) => isJoinEvent(r));
    expect(joinEvents).toHaveLength(1);
    expect((joinEvents[0] as { data: { libraryId: string } }).data.libraryId).toBe(library.id);
  });

  it('does not emit join rows for spaces the user cannot access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: stranger.id });
    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: stranger.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: stranger.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceLibrariesV1]);
    const joinEvents = response.filter((r) => isJoinEvent(r));
    expect(joinEvents).toHaveLength(0);
  });

  it('emits a delete event when a library is unlinked from an accessible space', async () => {
    const { auth, ctx } = await setup();
    const { library } = await ctx.newLibrary({ ownerId: auth.user.id });
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: auth.user.id });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceLibrariesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceLibrariesV1]);

    await defaultDatabase
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceLibrariesV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceLibraryDeleteV1);
    expect(deleteEvents).toHaveLength(1);
    expect((deleteEvents[0] as { data: { spaceId: string; libraryId: string } }).data).toMatchObject({
      spaceId: space.id,
      libraryId: library.id,
    });
  });
});
