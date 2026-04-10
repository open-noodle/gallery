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

describe(SyncRequestType.SharedSpacesV1, () => {
  it('emits a space whose only access path is the creator branch (no member row)', async () => {
    // Documents the design's "creator path only, no member row" case (design line 184).
    // The Gallery service always adds the creator as a member, but the
    // accessibleSpaces helper supports the pure-creator branch as a defensive
    // path. If the service invariant ever broke (e.g. a future feature creates
    // spaces via direct DB insert), this test ensures the sync stream still
    // emits the creator's own spaces.
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    // Deliberately do NOT call newSharedSpaceMember.

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: space.id, createdById: auth.user.id }),
        type: SyncEntityType.SharedSpaceV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync a shared space with the correct properties to its creator', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: space.id,
          name: space.name,
          createdById: auth.user.id,
        }),
        type: SyncEntityType.SharedSpaceV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1]);
  });

  it('should sync a shared space to a member who is not the creator', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
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

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: space.id, createdById: owner.id }),
        type: SyncEntityType.SharedSpaceV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should not sync a shared space to a user with no access', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(response).toEqual([expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 })]);
  });

  it('should sync a delete to all members when a space is removed', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1]);

    await defaultDatabase.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(next).toEqual([
      {
        ack: expect.any(String),
        data: { spaceId: space.id },
        type: SyncEntityType.SharedSpaceDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, next);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1]);
  });

  it('should re-sync an updated shared space when properties change', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id, name: 'Original' });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1]);

    await defaultDatabase
      .updateTable('shared_space')
      .set({ name: 'Renamed', description: 'Updated description' })
      .where('id', '=', space.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(next).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: space.id, name: 'Renamed', description: 'Updated description' }),
        type: SyncEntityType.SharedSpaceV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync a delete when a single member is removed', async () => {
    const { auth, ctx } = await setup();
    const { user: owner } = await ctx.newUser();
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

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1]);

    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', auth.user.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1]);
    expect(next).toEqual([
      {
        ack: expect.any(String),
        data: { spaceId: space.id },
        type: SyncEntityType.SharedSpaceDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });
});
