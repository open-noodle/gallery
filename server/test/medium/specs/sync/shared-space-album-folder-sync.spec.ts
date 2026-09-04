import { Kysely } from 'kysely';
import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';
import { SyncRepository } from 'src/repositories/sync.repository';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** Insert a folder directly — the repository helper is server-side and already exists. */
const newFolder = async (db: Kysely<DB>, spaceId: string, name: string, parentId: string | null = null) =>
  db
    .insertInto('shared_space_album_folder')
    .values({ spaceId, parentId, name, createdById: null })
    .returningAll()
    .executeTakeFirstOrThrow();

describe('shared_space_album_folder_audit', () => {
  // Without a tombstone a deleted folder simply stops being emitted, and a client that already
  // synced it has no way to learn it is gone — it would linger in the local tree forever.
  it('records a row carrying the deleted folder id and its space', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();

    expect(audit).toHaveLength(1);
    expect(audit[0].spaceId).toBe(space.id);
    // `id` is the audit row's OWN uuidv7 — it is the sync cursor, not the folder's id.
    expect(audit[0].id).not.toBe(folder.id);
    expect(audit[0].deletedAt).toBeInstanceOf(Date);
  });

  it('records one row per folder when several are deleted at once', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const a = await newFolder(db, space.id, 'A');
    const b = await newFolder(db, space.id, 'B');

    await db.deleteFrom('shared_space_album_folder').where('spaceId', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();

    expect(audit.map((r) => r.folderId).sort()).toEqual([a.id, b.id].sort());
  });

  // Deleting a SPACE cascades its folders. Those deletes must still tombstone, or a client that
  // loses access keeps the folder rows locally.
  it('records tombstones when folders cascade from a space delete', async () => {
    const { ctx, db } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const folder = await newFolder(db, space.id, 'Trips');

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const audit = await db
      .selectFrom('shared_space_album_folder_audit')
      .selectAll()
      .where('folderId', '=', folder.id)
      .execute();
    expect(audit).toHaveLength(1);
  });
});

const NOW_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
const BEFORE_UPDATE_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

const syncSetup = () => {
  const ctx = new SyncTestContext(defaultDatabase);
  return { ctx, db: defaultDatabase, sut: ctx.get(SyncRepository).sharedSpaceAlbumFolder };
};

describe('SharedSpaceAlbumFolderSync', () => {
  // V-01
  it('V-01: streams a space folder to a member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: owner.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).toContain(folder.id);
    const row = result.find((r) => r.id === folder.id);
    expect(row.spaceId).toBe(space.id);
    expect(row.name).toBe('Trips');
    expect(row.parentId).toBeNull();
  });

  // V-02 — the privacy gate. A folder name is member-only information ("Divorce", "Medical"),
  // so a non-member must receive nothing, not an empty-but-present row.
  it('V-02: streams NOTHING to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Divorce');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).not.toContain(folder.id);
  });

  // V-03
  it('V-03: streams a tombstone to a member after a delete', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: owner.id, nowId: NOW_ID }));

    const row = result.find((r) => r.folderId === folder.id);
    expect(row).toBeDefined();
    expect(row.spaceId).toBe(space.id);
  });

  // V-04 — the same privacy gate on the delete arm. Easy to miss when cloning getUpserts.
  it('V-04: streams NO tombstones to a non-member', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const folder = await newFolder(db, space.id, 'Trips');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folder.id).execute();

    const result: any[] = await Array.fromAsync(sut.getDeletes({ userId: stranger.id, nowId: NOW_ID }));

    expect(result.map((r) => r.folderId)).not.toContain(folder.id);
  });

  // M-4 — the privacy gate must scope to spaces the caller is actually a MEMBER of, not merely
  // "is a member of at least one space anywhere". V-02/V-04/V-07 above all use a user who is a
  // member of NO space, so a mis-implementation like `EXISTS (SELECT 1 FROM shared_space_member
  // WHERE userId = X)` (any space, uncorrelated to the folder's own space) would fail those tests
  // too — a member of zero spaces fails that check regardless. Giving the member a SECOND space
  // they do NOT belong to is what actually distinguishes "scoped to my spaces" from "member of
  // any space": only the correct (per-space) gate excludes the other space's folder here.
  it("M-4: a member of one space does not see another space's folders via getUpserts", async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space: mine } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: mine.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
    const myFolder = await newFolder(db, mine.id, 'Trips');
    const otherFolder = await newFolder(db, other.id, 'Secret');

    const result: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));

    expect(result.map((r) => r.id)).toContain(myFolder.id);
    expect(result.map((r) => r.id)).not.toContain(otherFolder.id);
  });

  // V-05
  it('V-05: backfills a space folders for a member, and not another space', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
    const mine = await newFolder(db, space.id, 'Trips');
    const theirs = await newFolder(db, other.id, 'Elsewhere');

    const result: any[] = await Array.fromAsync(
      sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, space.id),
    );

    expect(result.map((r) => r.id)).toContain(mine.id);
    expect(result.map((r) => r.id)).not.toContain(theirs.id);
  });

  // V-07 — a user who LOSES access stops receiving both arms. Membership is evaluated per query,
  // so this is really a check that neither arm caches or short-circuits the gate.
  it('V-07: a revoked member receives neither folders nor tombstones', async () => {
    const { ctx, db, sut } = syncSetup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });
    const kept = await newFolder(db, space.id, 'Trips');
    const removed = await newFolder(db, space.id, 'Archive');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', removed.id).execute();

    // Sanity: while a member, both arms deliver.
    const memberUpserts: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));
    expect(memberUpserts.map((r) => r.id)).toContain(kept.id);

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.id)
      .execute();

    const upserts: any[] = await Array.fromAsync(sut.getUpserts({ userId: member.id, nowId: NOW_ID }));
    const deletes: any[] = await Array.fromAsync(sut.getDeletes({ userId: member.id, nowId: NOW_ID }));

    expect(upserts.map((r) => r.id)).not.toContain(kept.id);
    expect(deletes.map((r) => r.folderId)).not.toContain(removed.id);
  });
});

// ── Handler-level stream tests (Task 4 review-fix) ──────────────────────────
// Every test above drives SharedSpaceAlbumFolderSync (the repository class) directly, bypassing
// the actual service handler. `syncSharedSpaceAlbumFoldersV1` in sync.service.ts (~68 lines of
// checkpoint/backfill plumbing: ack gating on the delete AND upsert arms, the per-space backfill
// loop, and final wire-shape assembly) therefore had zero coverage of its own. These five tests
// drive the real handler end to end via `ctx.syncStream()`, modelled on the ctx.syncStream /
// syncAckAll / assertSyncIsComplete pattern in sync-shared-space-album.spec.ts (~L61-99) and the
// delete-event round-trip shape in shared-space-album-link-sync.spec.ts.

const streamSetup = async () => {
  const ctx = new SyncTestContext(defaultDatabase);
  const { auth, user } = await ctx.newSyncAuthUser();
  return { ctx, db: defaultDatabase, auth, user };
};

describe('SharedSpaceAlbumFoldersV1 sync stream (handler level)', () => {
  // Required test 1: upsert delivery + wire shape.
  it('delivers folder upserts to a member with the documented wire shape and no updateId leak', async () => {
    const { ctx, db, auth } = await streamSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    const root = await newFolder(db, space.id, 'Trips');
    const child = await newFolder(db, space.id, 'Summer', root.id);

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const upserts = response.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1);

    expect(upserts).toHaveLength(2);
    const rootEvent = upserts.find((r: { data: { id: string } }) => r.data.id === root.id) as { data: any };
    const childEvent = upserts.find((r: { data: { id: string } }) => r.data.id === child.id) as { data: any };
    expect(rootEvent).toBeDefined();
    expect(childEvent).toBeDefined();

    // Documented shape: id, spaceId, parentId, name, createdAt, updatedAt — and nothing else.
    // In particular, updateId (selected internally to drive the ack cursor) must not leak into data.
    expect(Object.keys(rootEvent.data).sort()).toEqual(['createdAt', 'id', 'name', 'parentId', 'spaceId', 'updatedAt']);
    expect(rootEvent.data).toMatchObject({ id: root.id, spaceId: space.id, parentId: null, name: 'Trips' });
    expect(childEvent.data).toMatchObject({ id: child.id, spaceId: space.id, parentId: root.id, name: 'Summer' });
    expect(rootEvent.data).not.toHaveProperty('updateId');
    expect(childEvent.data).not.toHaveProperty('updateId');
  });

  // Required test 2: ack/checkpoint.
  it('delivers nothing after ack, then delivers exactly a renamed folder on the next stream', async () => {
    const { ctx, db, auth } = await streamSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    const folderA = await newFolder(db, space.id, 'Trips');
    const folderB = await newFolder(db, space.id, 'Archive');

    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const initialUpserts = initial.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1);
    expect(initialUpserts.map((r: { data: { id: string } }) => r.data.id).sort()).toEqual(
      [folderA.id, folderB.id].sort(),
    );
    await ctx.syncAckAll(auth, initial);

    // Second stream, no changes since ack: must deliver nothing but the completion marker.
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);

    // Rename folderA — must be the ONLY thing the next stream delivers.
    await db
      .updateTable('shared_space_album_folder')
      .set({ name: 'Trips (renamed)' })
      .where('id', '=', folderA.id)
      .execute();

    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const nextUpserts = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1);
    expect(nextUpserts).toHaveLength(1);
    expect((nextUpserts[0] as { data: { id: string; name: string } }).data).toMatchObject({
      id: folderA.id,
      name: 'Trips (renamed)',
    });
  });

  // Required test 3: tombstones to a member, wire shape, and delete-arm checkpoint idempotency.
  it('delivers a tombstone carrying only folderId, and does not re-deliver it once acked', async () => {
    const { ctx, db, auth } = await streamSetup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    const folderA = await newFolder(db, space.id, 'Trips');
    const folderB = await newFolder(db, space.id, 'Archive');

    // Drain + ack the initial upserts so the delete arm is exercised in isolation.
    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    await ctx.syncAckAll(auth, initial);

    await db.deleteFrom('shared_space_album_folder').where('id', '=', folderA.id).execute();

    const afterFirstDelete = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const firstTombstones = afterFirstDelete.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderDeleteV1,
    );
    expect(firstTombstones).toHaveLength(1);
    // Wire shape: ONLY folderId — no spaceId, despite the repository selecting it internally to
    // gate the audit query.
    expect(Object.keys((firstTombstones[0] as { data: Record<string, unknown> }).data)).toEqual(['folderId']);
    expect((firstTombstones[0] as { data: { folderId: string } }).data.folderId).toBe(folderA.id);
    await ctx.syncAckAll(auth, afterFirstDelete);

    // A second delete must deliver ONLY the new tombstone — folderA's must not resurface. This is
    // what actually exercises the delete arm's own checkpoint, not just first-time delivery.
    await db.deleteFrom('shared_space_album_folder').where('id', '=', folderB.id).execute();

    const afterSecondDelete = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const secondTombstones = afterSecondDelete.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderDeleteV1,
    );
    expect(secondTombstones).toHaveLength(1);
    expect((secondTombstones[0] as { data: { folderId: string } }).data.folderId).toBe(folderB.id);
  });

  // Required test 4: late-joiner backfill, exercising membership-createId-driven space selection.
  it('backfills pre-existing folders to a member added after the folders already existed', async () => {
    const { ctx, db, auth } = await streamSetup();
    const { user: owner } = await ctx.newUser();

    // Target space: folders created BEFORE auth.user is ever granted access to it.
    const { space: target } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: target.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const folderA = await newFolder(db, target.id, 'Trips');
    const folderB = await newFolder(db, target.id, 'Archive');

    // Seed space: gives auth.user an upsert checkpoint BEFORE they ever see `target`. Without this,
    // auth.user's very first stream for this type would have no checkpoint yet, so `target`'s
    // folders would deliver via the plain upsert arm instead of the backfill arm (see the tests
    // above, none of which involve a prior space) — the backfill loop only actually streams rows
    // when the member's upsert checkpoint already exists and the newly accessible space's rows
    // predate it.
    const { space: seed } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: seed.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: seed.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    const seedFolder = await newFolder(db, seed.id, 'Seed');

    const seedRound = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    expect(
      seedRound
        .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1)
        .map((r: { data: { id: string } }) => r.data.id),
    ).toEqual([seedFolder.id]);
    await ctx.syncAckAll(auth, seedRound);

    // Grant access to `target` — its folders predate the checkpoint just established, so this is
    // the "create folders first, then add a member" late-joiner scenario end to end.
    const { member: targetMembership } = await ctx.newSharedSpaceMember({
      spaceId: target.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Viewer,
    });

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);

    const backfillEvents = response.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderBackfillV1,
    ) as Array<{ data: Record<string, unknown> }>;
    expect(backfillEvents.map((r) => (r.data as { id: string }).id).sort()).toEqual([folderA.id, folderB.id].sort());
    // Pin the backfill payload's wire shape exactly, the same way test 1 pins the upsert event's.
    // The backfill arm is a SEPARATE `send` call site from the upsert arm sharing the same DTO —
    // nothing stops that call site from leaking updateId onto the wire independently of the
    // upsert arm (data.id alone would not catch it).
    for (const event of backfillEvents) {
      expect(Object.keys(event.data).sort()).toEqual(['createdAt', 'id', 'name', 'parentId', 'spaceId', 'updatedAt']);
    }

    // These predate the checkpoint, so backfill must be the SOLE delivery path for them this round.
    const upsertEvents = response.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1);
    expect(upsertEvents).toHaveLength(0);

    // The completion ack's id component must be the membership's OWN createId — not merely
    // something that starts with the right prefix and ends with "|complete". If the wrong id were
    // ever passed to sendEntityBackfillCompleteAck, isEntityBackfillComplete would never match on
    // a later round and the backfill would silently re-run forever.
    const completionAck = response.find((r: { type: string }) => r.type === SyncEntityType.SyncAckV1) as
      { ack: string } | undefined;
    expect(completionAck).toBeDefined();
    expect(completionAck!.ack).toBe(
      `${SyncEntityType.SharedSpaceAlbumFolderBackfillV1}|${targetMembership.createId}|complete`,
    );

    // Idempotency: once the completion ack is itself acked, the backfill arm must not re-run —
    // the same property tests 2 and 3 already prove for the upsert and delete arms.
    await ctx.syncAckAll(auth, response);
    const idempotentRound = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);
    const idempotentBackfillEvents = idempotentRound.filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderBackfillV1,
    );
    expect(idempotentBackfillEvents).toHaveLength(0);
  });

  // Required test 5 (M-4 positive control): an accessible space's folder arrives, while an
  // entirely separate, inaccessible space's folder and tombstone do not. The positive control
  // (includedFolder arriving) proves this specific stream call, for this specific user, would
  // actually have delivered the excluded space's folder/tombstone had the exclusion been broken —
  // ruling out "the arm returns nothing for everyone", which tests 1-4 in this file already do by
  // streaming as a real member and getting real events back.
  it('delivers folders for an accessible space, but excludes an entirely separate space', async () => {
    const { ctx, db, auth } = await streamSetup();
    const { user: owner } = await ctx.newUser();

    // Excluded space: auth.user has NO access. One live folder, one tombstoned folder.
    const { space: excludedSpace } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: excludedSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
    const excludedFolder = await newFolder(db, excludedSpace.id, 'Divorce');
    const excludedTombstoned = await newFolder(db, excludedSpace.id, 'Medical');
    await db.deleteFrom('shared_space_album_folder').where('id', '=', excludedTombstoned.id).execute();

    // Included space: auth.user IS a member, with its own folder — the positive control.
    const { space: includedSpace } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: includedSpace.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: includedSpace.id, userId: auth.user.id, role: SharedSpaceRole.Editor });
    const includedFolder = await newFolder(db, includedSpace.id, 'Trips');

    const response = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumFoldersV1]);

    const upsertIds = response
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderV1)
      .map((r: { data: { id: string } }) => r.data.id);
    const tombstoneFolderIds = response
      .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumFolderDeleteV1)
      .map((r: { data: { folderId: string } }) => r.data.folderId);

    // Positive control: the accessible space's folder DOES arrive.
    expect(upsertIds).toContain(includedFolder.id);
    // The inaccessible space's folder and tombstone do NOT arrive.
    expect(upsertIds).not.toContain(excludedFolder.id);
    expect(tombstoneFolderIds).not.toContain(excludedTombstoned.id);
  });
});
