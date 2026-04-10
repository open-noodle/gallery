import { Kysely } from 'kysely';
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

describe('shared_space audit triggers', () => {
  it('fans out shared_space_audit rows to every member on space deletion', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db.selectFrom('shared_space_audit').select(['userId']).where('spaceId', '=', space.id).execute();

    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([owner.user.id, memberA.user.id, memberB.user.id]));
  });

  it('emits shared_space_audit for a single removed member', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', memberA.user.id)
      .execute();

    const rows = await db.selectFrom('shared_space_audit').select(['userId']).where('spaceId', '=', space.id).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(memberA.user.id);
  });

  it('fires shared_space_member_audit on member removal', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', memberA.user.id)
      .execute();

    const rows = await db
      .selectFrom('shared_space_member_audit')
      .select(['spaceId', 'userId'])
      .where('spaceId', '=', space.id)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(memberA.user.id);
  });

  it('does not double-populate shared_space_audit on space-delete cascade', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const memberA = await ctx.newUser();
    const memberB = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberA.user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberB.user.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db.selectFrom('shared_space_audit').selectAll().where('spaceId', '=', space.id).execute();

    // Exactly three rows: creator + two members. NOT six (would indicate double-firing).
    expect(rows).toHaveLength(3);
  });

  it('does not double-populate shared_space_asset_audit on space-delete cascade', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { asset: assetA } = await ctx.newAsset({ ownerId: owner.user.id });
    const { asset: assetB } = await ctx.newAsset({ ownerId: owner.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetA.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetB.id });

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    const rows = await db.selectFrom('shared_space_asset_audit').selectAll().where('spaceId', '=', space.id).execute();

    // Two (space, asset) pairs, exactly once each. NOT four.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.assetId))).toEqual(new Set([assetA.id, assetB.id]));
  });

  it('emits shared_space_asset_audit when an asset is removed from a space directly', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    await db.deleteFrom('shared_space_asset').where('spaceId', '=', space.id).where('assetId', '=', asset.id).execute();

    const rows = await db.selectFrom('shared_space_asset_audit').selectAll().where('spaceId', '=', space.id).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].assetId).toBe(asset.id);
  });

  it('emits shared_space_asset_audit when an asset is hard-deleted and cascades', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    await db.deleteFrom('asset').where('id', '=', asset.id).execute();

    const rows = await db.selectFrom('shared_space_asset_audit').selectAll().where('spaceId', '=', space.id).execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].assetId).toBe(asset.id);
  });

  it('bumps shared_space.updateId when a new member is added', async () => {
    const { ctx, db } = setup();
    const owner = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.user.id });
    const initial = await db
      .selectFrom('shared_space')
      .select('updateId')
      .where('id', '=', space.id)
      .executeTakeFirstOrThrow();
    const initialUpdateId = initial.updateId;

    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.user.id });

    const after = await db
      .selectFrom('shared_space')
      .select('updateId')
      .where('id', '=', space.id)
      .executeTakeFirstOrThrow();
    expect(after.updateId).not.toBe(initialUpdateId);
  });
});
