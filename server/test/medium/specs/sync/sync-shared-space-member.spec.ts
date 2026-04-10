import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB, wait } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.SharedSpaceMembersV1, () => {
  it('emits a member row for the current user as owner of their own space', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    expect(response).toEqual([
      expect.objectContaining({
        type: SyncEntityType.SharedSpaceMemberV1,
        data: expect.objectContaining({
          spaceId: space.id,
          userId: auth.user.id,
          role: SharedSpaceRole.Owner,
        }),
      }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('emits all members of an accessible space on first sync', async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Editor,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    const memberPayloads = response
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceMemberV1)
      .map((r: { data: { userId: string; role: string } }) => r.data);

    expect(memberPayloads).toHaveLength(2);
    expect(new Set(memberPayloads.map((p) => p.userId))).toEqual(new Set([auth.user.id, peer.id]));
  });

  it('does NOT include lastViewedAt in the emitted member payload', async () => {
    const { auth, ctx } = await setup();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    const memberRow = response.find(
      (r: { type: string }) =>
        r.type === SyncEntityType.SharedSpaceMemberBackfillV1 || r.type === SyncEntityType.SharedSpaceMemberV1,
    );
    expect(memberRow).toBeDefined();
    expect(Object.keys((memberRow as { data: object }).data)).not.toContain('lastViewedAt');
  });

  it('does not sync members of a space the user has no access to', async () => {
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: stranger.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    expect(response).toEqual([expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 })]);
  });

  it('re-emits a member row when its role changes after the initial ack (getUpdates path)', async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Editor,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceMembersV1]);

    await defaultDatabase
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Viewer })
      .where('spaceId', '=', space.id)
      .where('userId', '=', peer.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    const memberEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceMemberV1);
    expect(memberEvents).toHaveLength(1);
    expect((memberEvents[0] as { data: { userId: string; role: string } }).data).toMatchObject({
      userId: peer.id,
      role: SharedSpaceRole.Viewer,
    });
  });

  it('backfills historical members when the user is added to a pre-existing space', async () => {
    // The backfill loop drains members of a space the user just gained access
    // to, but only those whose updateId is BEFORE the user's upsertCheckpoint
    // (newer ones come through the normal upserts pass instead). Pattern
    // mirrors `should backfill album users when a user shares an album with you`
    // in sync-album-user.spec.ts.
    const { auth, ctx } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { space: oldSpace } = await ctx.newSharedSpace({ createdById: stranger.id });
    // Old members in oldSpace, BEFORE auth.user has any sync activity.
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: stranger.id,
      role: SharedSpaceRole.Owner,
    });
    await wait(2);
    // Auth.user gets a separate "current" space so the first sync produces a
    // non-empty upsertCheckpoint.
    const { space: currentSpace } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: currentSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceMembersV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpacesV1, SyncRequestType.SharedSpaceMembersV1]);

    // Now add auth.user to the OLD space — gains access retroactively to the
    // pre-existing member rows.
    await ctx.newSharedSpaceMember({
      spaceId: oldSpace.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    const backfillEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceMemberBackfillV1);
    // The historical stranger member should arrive as a backfill event.
    expect(backfillEvents.length).toBeGreaterThanOrEqual(1);
    expect(backfillEvents.some((r: { data: { userId: string } }) => r.data.userId === stranger.id)).toBe(true);
  });

  it('does NOT emit a member-delete event to the removed user via the member sync channel', async () => {
    // The channel split: SharedSpaceSync.getDeletes (shared_space_audit) handles
    // "you lost access to a space"; SharedSpaceMemberSync.getDeletes
    // (shared_space_member_audit) handles "this peer left this space" and is
    // scoped via accessibleSpaces, which excludes the removed user.
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

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceMembersV1]);

    // The current user (auth.user) is removed.
    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', auth.user.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    const deleteEvents = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceMemberDeleteV1);
    expect(deleteEvents).toHaveLength(0);
  });

  it('emits a member-delete event to the owner when a peer is removed from their space', async () => {
    const { auth, ctx } = await setup();
    const { user: peer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: auth.user.id });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    await ctx.newSharedSpaceMember({
      spaceId: space.id,
      userId: peer.id,
      role: SharedSpaceRole.Editor,
    });

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceMembersV1]);

    await defaultDatabase
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', peer.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceMembersV1]);
    expect(next).toEqual([
      {
        ack: expect.any(String),
        data: { spaceId: space.id, userId: peer.id },
        type: SyncEntityType.SharedSpaceMemberDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });
});
