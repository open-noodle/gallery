// Fix B — the "no timeline spaces" fast path for the People-page accessibility predicate.
//
// Every space arm of that predicate (direct asset, linked library, linked album x2) joins the
// `timeline_spaces` CTE, so when a viewer belongs to no timeline-enabled space all four arms are
// provably unsatisfiable and the predicate collapses to `asset."ownerId" = <viewer>`. Postgres
// cannot know that at plan time — it evaluates the OR per row, which on a large library meant
// hundreds of thousands of index probes into `asset` that discarded nothing.
//
// These tests prove the collapse is sound by comparing the ASSET SETS the two predicate forms
// select over identical data, rather than by matching SQL text.
import { Kysely, sql } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { accessibleTimelineAssetPredicate } from 'src/utils/shared-space-album-scope';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

// Runs the predicate exactly as the repository does: inside a query that defines the
// `timeline_spaces` CTE it correlates against.
const selectAccessible = async (userId: string, hasTimelineSpaces: boolean): Promise<Set<string>> => {
  const predicate = accessibleTimelineAssetPredicate({ userId, hasTimelineSpaces });
  const result = await sql<{ id: string }>`
    WITH timeline_spaces AS (
      SELECT "spaceId"
      FROM shared_space_member
      WHERE "userId" = ${userId}
        AND "showInTimeline" = true
    )
    SELECT asset.id
    FROM asset
    WHERE asset."deletedAt" IS NULL
      AND asset.visibility = ${AssetVisibility.Timeline}
      AND (${predicate})
  `.execute(db);
  return new Set(result.rows.map((row) => row.id));
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('accessibleTimelineAssetPredicate', () => {
  it('selects the same assets either way for a viewer with no shared spaces at all', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();

    try {
      const { asset: mine } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newAsset({ ownerId: stranger.id, visibility: AssetVisibility.Timeline });

      const full = await selectAccessible(user.id, true);
      const short = await selectAccessible(user.id, false);

      expect(full).toEqual(short);
      expect(short.has(mine.id)).toBe(true);
      expect(short.size).toBe(1);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();
      await ctx.database.deleteFrom('user').where('id', '=', stranger.id).execute();
    }
  });

  it('selects the same assets either way when every membership has showInTimeline off', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    try {
      const { asset: ownAsset } = await ctx.newAsset({ ownerId: viewer.id, visibility: AssetVisibility.Timeline });
      const { asset: sharedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: owner.id });
      await ctx.database
        .updateTable('shared_space_member')
        .set({ showInTimeline: false })
        .where('spaceId', '=', space.id)
        .where('userId', '=', viewer.id)
        .execute();

      const full = await selectAccessible(viewer.id, true);
      const short = await selectAccessible(viewer.id, false);

      expect(full).toEqual(short);
      expect(short.has(ownAsset.id)).toBe(true);
      expect(short.has(sharedAsset.id)).toBe(false);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
      await ctx.database.deleteFrom('user').where('id', '=', viewer.id).execute();
    }
  });

  // Guards the two tests above from being vacuous: with a live timeline space the forms MUST differ,
  // otherwise "they agree" would prove nothing. This is also the regression that fires if a future
  // space arm is added that is not gated on timeline_spaces — the short form would start dropping
  // assets the full form still returns for a no-space viewer.
  it('differs once a timeline-enabled space actually shares an asset', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    try {
      const { asset: sharedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: owner.id });

      const full = await selectAccessible(viewer.id, true);
      const short = await selectAccessible(viewer.id, false);

      expect(full.has(sharedAsset.id)).toBe(true);
      expect(short.has(sharedAsset.id)).toBe(false);
      expect(full).not.toEqual(short);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
      await ctx.database.deleteFrom('user').where('id', '=', viewer.id).execute();
    }
  });

  it('still returns the viewer own assets when they do belong to a timeline space', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    try {
      const { asset: viewerAsset } = await ctx.newAsset({ ownerId: viewer.id, visibility: AssetVisibility.Timeline });
      const { asset: sharedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: sharedAsset.id, addedById: owner.id });

      const full = await selectAccessible(viewer.id, true);

      expect(full.has(viewerAsset.id)).toBe(true);
      expect(full.has(sharedAsset.id)).toBe(true);
    } finally {
      await ctx.database.deleteFrom('user').where('id', '=', owner.id).execute();
      await ctx.database.deleteFrom('user').where('id', '=', viewer.id).execute();
    }
  });
});
