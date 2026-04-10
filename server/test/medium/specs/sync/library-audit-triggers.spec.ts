import { Kysely, sql } from 'kysely';
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

describe('library audit triggers', () => {
  it('trigger_member_removed_library_still_visible_via_other_space', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: member.user.id });

    // Remove the member from spaceA — they still see the library via spaceB.
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', member.user.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('trigger_member_removed_library_not_visible_anywhere_else', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', member.user.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].libraryId).toBe(library.id);
    expect(rows[0].userId).toBe(member.user.id);
  });

  it('trigger_member_removed_user_is_library_owner', async () => {
    const { ctx, db } = setup();
    // The "member" being removed is also the library owner — they should not get a library_audit
    // row because the ownership branch in user_has_library_path returns true.
    const owner = await ctx.newUser();
    const otherCreator = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: otherCreator.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.user.id });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', owner.user.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', owner.user.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('trigger_member_removed_user_is_creator_of_other_space', async () => {
    const { ctx, db } = setup();
    // member is the creator of spaceB, which also links the library, but not via membership.
    // user_has_library_path's creator branch should keep them visible.
    const libraryOwner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: libraryOwner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: libraryOwner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: member.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.user.id });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', member.user.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('trigger_library_unlinked_one_of_two_spaces', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    // memberA is in both spaces, memberB is only in spaceA.
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberB.user.id });

    // Unlink the library from spaceA.
    await db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', spaceA.id)
      .where('libraryId', '=', library.id)
      .execute();

    // memberB loses access (no other path) — memberA still has spaceB.
    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds.has(memberB.user.id)).toBe(true);
    expect(userIds.has(memberA.user.id)).toBe(false);
    expect(userIds.has(owner.user.id)).toBe(false); // owner branch keeps them visible

    // The shared_space_library_audit row was emitted regardless of who has paths left.
    const linkRows = await db
      .selectFrom('shared_space_library_audit')
      .selectAll()
      .where('spaceId', '=', spaceA.id)
      .where('libraryId', '=', library.id)
      .execute();
    expect(linkRows).toHaveLength(1);
  });

  it('trigger_library_unlinked_last_space', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds.has(memberA.user.id)).toBe(true);
    expect(userIds.has(memberB.user.id)).toBe(true);
    expect(userIds.has(owner.user.id)).toBe(false); // owner branch keeps owner visible
  });

  it('trigger_library_deleted_cascades_to_per_user_audit', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });

    // Hard-delete the library: cascades to shared_space_library DELETE which fires
    // shared_space_library_delete_audit per affected user.
    await db.deleteFrom('library').where('id', '=', library.id).execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    const userIds = new Set(rows.map((r) => r.userId));
    // memberA loses access; owner row depends on whether the library row is still visible
    // to the owner branch at trigger evaluation time. Library has been deleted, so
    // user_has_library_path's owner branch returns false → owner gets an audit row too.
    expect(userIds.has(memberA.user.id)).toBe(true);
    expect(userIds.has(owner.user.id)).toBe(true);
  });

  it('trigger_space_deleted_cascade', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    // Deleting a space cascades both to shared_space_library and shared_space_member.
    // Both delete-audit triggers fire — but library_audit rows for the affected users
    // should appear exactly once each per (libraryId, userId), not twice.
    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    // Expected: memberA, memberB rows for the unlinked library. Owner branch keeps owner
    // visible (library still exists). Each affected member gets exactly one audit row,
    // not two — even though both shared_space_library_delete_audit AND
    // shared_space_member_delete_library_audit fire during the cascade.
    const memberRows = rows.filter((r) => r.userId === memberA.user.id || r.userId === memberB.user.id);
    expect(memberRows).toHaveLength(2);
    const memberIds = new Set(memberRows.map((r) => r.userId));
    expect(memberIds).toEqual(new Set([memberA.user.id, memberB.user.id]));
  });

  it('trigger_creator_check_uses_createdById_not_member_table', async () => {
    const { ctx, db } = setup();
    // The space creator is NOT in shared_space_member by default. The creator branch
    // of the trigger and the path function must use shared_space.createdById directly.
    const libraryOwner = await ctx.newUser();
    const creator = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: libraryOwner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: libraryOwner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: creator.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    // creator is NOT a member of spaceA — the creator branch is the only path for them.

    // Unlink library from spaceB — creator loses their only path (since they're not in spaceA).
    await db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', spaceB.id)
      .where('libraryId', '=', library.id)
      .execute();

    // The trigger's "creator of the unlinked space" branch should fan out to creator.
    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', creator.user.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('trigger_asset_deleted_directly_with_library_id', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });
    // Sanity: another asset without libraryId — should NOT produce library_asset_audit.
    const { asset: nonLibraryAsset } = await ctx.newAsset({ ownerId: owner.user.id });

    await db.deleteFrom('asset').where('id', 'in', [asset.id, nonLibraryAsset.id]).execute();

    const rows = await db
      .selectFrom('library_asset_audit')
      .select(['assetId'])
      .where('assetId', 'in', [asset.id, nonLibraryAsset.id])
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].assetId).toBe(asset.id);
  });

  it('trigger_asset_cascade_from_library_delete', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });
    const { asset: a3 } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });

    // DELETE FROM library cascades to asset; asset_library_delete_audit fires
    // at pg_trigger_depth() = 1, which the trigger's WHEN clause permits.
    await db.deleteFrom('library').where('id', '=', library.id).execute();

    const rows = await db
      .selectFrom('library_asset_audit')
      .select(['assetId'])
      .where('assetId', 'in', [a1.id, a2.id, a3.id])
      .execute();
    expect(new Set(rows.map((r) => r.assetId))).toEqual(new Set([a1.id, a2.id, a3.id]));
  });

  it('trigger_space_deleted_with_multiple_libraries', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library: libX } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { library: libY } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { library: libZ } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libX.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libY.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: libZ.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    // The BEFORE-row shared_space_delete_library_audit trigger should fan out
    // 6 rows: (libX, libY, libZ) × (memberA, memberB). Owner is suppressed by
    // the ownership branch in user_has_library_path.
    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', 'in', [libX.id, libY.id, libZ.id])
      .execute();
    expect(rows).toHaveLength(6);
    const pairs = new Set(rows.map((r) => `${r.libraryId}|${r.userId}`));
    expect(pairs).toEqual(
      new Set([
        `${libX.id}|${memberA.user.id}`,
        `${libX.id}|${memberB.user.id}`,
        `${libY.id}|${memberA.user.id}`,
        `${libY.id}|${memberB.user.id}`,
        `${libZ.id}|${memberA.user.id}`,
        `${libZ.id}|${memberB.user.id}`,
      ]),
    );
  });

  it('trigger_space_deleted_creator_is_library_owner', async () => {
    const { ctx, db } = setup();
    // Creator owns the library AND creates a space linking it. Deleting the
    // space must NOT emit a library_audit row for the creator — the ownership
    // branch in user_has_library_path returns true even though the library
    // still exists at trigger time (BEFORE trigger fires before any cascade).
    const creator = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: creator.user.id });
    const { space } = await ctx.newSharedSpace({ createdById: creator.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds.has(member.user.id)).toBe(true);
    expect(userIds.has(creator.user.id)).toBe(false);
  });

  it('trigger_simultaneous_member_and_library_unlink', async () => {
    const { ctx, db } = setup();
    // Sequential simulation: remove member from spaceA, then unlink library from spaceB.
    // Each action emits its own audit rows independently — no double-fire.
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: member.user.id });

    // Step 1: remove from spaceA. Member still has spaceB → no audit.
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaceA.id)
      .where('userId', '=', member.user.id)
      .execute();

    let rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(0);

    // Step 2: unlink library from spaceB. Member loses last path → exactly one audit row.
    await db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', spaceB.id)
      .where('libraryId', '=', library.id)
      .execute();

    rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('trigger_user_delete_cascade_fires_asset_library_audit_once_per_asset', async () => {
    const { ctx, db } = setup();
    // Deepest cascade: DELETE user → library cascade → asset cascade.
    // asset_library_delete_audit has `WHEN (pg_trigger_depth() <= 1)` — we
    // assert it still fires exactly once per asset (not zero, not twice)
    // even though the statement originates on the user table.
    const owner = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { asset: a1 } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });
    const { asset: a2 } = await ctx.newAsset({ ownerId: owner.user.id, libraryId: library.id });

    await db.deleteFrom('user').where('id', '=', owner.user.id).execute();

    const rows = await db
      .selectFrom('library_asset_audit')
      .select(['assetId'])
      .where('assetId', 'in', [a1.id, a2.id])
      .execute();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.assetId, (counts.get(row.assetId) ?? 0) + 1);
    }
    expect(counts.get(a1.id)).toBe(1);
    expect(counts.get(a2.id)).toBe(1);
  });

  it('trigger_insert_shared_space_library_does_not_populate_library_audit', async () => {
    const { ctx, db } = setup();
    // Negative: audit triggers only fire on DELETE. Adding a space-library
    // link is a GAINING-access event, not a losing-access event, so
    // library_audit must stay empty.
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });
    // INSERT the link — the AFTER DELETE trigger should NOT fire.
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    expect(rows).toHaveLength(0);

    const linkRows = await db
      .selectFrom('shared_space_library_audit')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(linkRows).toHaveLength(0);
  });

  it('trigger_update_shared_space_library_does_not_populate_library_audit', async () => {
    const { ctx, db } = setup();
    // The UPDATE on shared_space_library (e.g. the updated_at trigger firing
    // when addedById is rewritten) must NOT write audit rows — the triggers
    // are AFTER DELETE only.
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const secondAdder = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.user.id });

    await db
      .updateTable('shared_space_library')
      .set({ addedById: secondAdder.user.id })
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('trigger_member_removed_with_three_other_library_paths', async () => {
    const { ctx, db } = setup();
    // Dedup stress: member has 4 spaces linking the same library. Removing
    // from 1 must not emit. Removing from 3 in sequence must not emit
    // (they still have space D). Only after removing from the 4th do they
    // get exactly one audit row.
    const owner = await ctx.newUser();
    const member = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const spaces = await Promise.all([0, 1, 2, 3].map(() => ctx.newSharedSpace({ createdById: owner.user.id })));
    for (const { space } of spaces) {
      await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.user.id });
    }

    // Remove from 3 — no audit, still has one path.
    for (const { space } of spaces.slice(0, 3)) {
      await db
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.user.id)
        .execute();
    }

    let rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(0);

    // Remove from the last — exactly one audit row.
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', spaces[3].space.id)
      .where('userId', '=', member.user.id)
      .execute();

    rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', member.user.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('trigger_space_deleted_subset_of_members_retain_path_via_other_space', async () => {
    const { ctx, db } = setup();
    // Whole-space delete where memberA has another path (spaceB) but memberB
    // does not. Expect memberB gets one audit row, memberA gets zero.
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberB.user.id });
    // memberB is ONLY in spaceA.

    await db.deleteFrom('shared_space').where('id', '=', spaceA.id).execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    const userIds = new Set(rows.map((r) => r.userId));
    expect(userIds.has(memberB.user.id)).toBe(true);
    expect(userIds.has(memberA.user.id)).toBe(false);
    expect(userIds.has(owner.user.id)).toBe(false);
  });

  it('trigger_space_deleted_all_members_have_other_paths', async () => {
    const { ctx, db } = setup();
    // Whole-space delete where EVERY member has a path via another space.
    // library_audit must stay empty (BEFORE-row trigger + user_has_library_path
    // returns true for each row → nothing to insert).
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: owner.user.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
    await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberB.user.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberB.user.id });

    await db.deleteFrom('shared_space').where('id', '=', spaceA.id).execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('trigger_partner_has_no_library_path', async () => {
    const { ctx, db } = setup();
    // Lock in the design: library access does not flow through the partner
    // relationship. user A and user B are partners; A owns a library; B's
    // user_has_library_path for A's library returns false, AND deleting a
    // space B isn't a member of (but that links A's library) does NOT emit
    // an audit row for B (the trigger only fans out to actual members or
    // creators, not partners).
    const userA = await ctx.newUser();
    const userB = await ctx.newUser();
    await ctx.newPartner({ sharedById: userA.user.id, sharedWithId: userB.user.id });
    const { library } = await ctx.newLibrary({ ownerId: userA.user.id });

    // A space A creates linking the library. B is NOT a member.
    const { space } = await ctx.newSharedSpace({ createdById: userA.user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    // user_has_library_path for partner B returns false.
    const result = await db.executeQuery(
      sql<{
        r: boolean;
      }>`SELECT user_has_library_path(${library.id}::uuid, ${userB.user.id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid) AS r`.compile(
        db,
      ),
    );
    expect(result.rows[0].r).toBe(false);

    // Unlink the library; B must not get any audit row.
    await db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', space.id)
      .where('libraryId', '=', library.id)
      .execute();

    const rows = await db
      .selectFrom('library_audit')
      .select(['libraryId', 'userId'])
      .where('libraryId', '=', library.id)
      .where('userId', '=', userB.user.id)
      .execute();
    expect(rows).toHaveLength(0);
  });
});
