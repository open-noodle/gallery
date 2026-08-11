// Coverage gap probe for Fix B (PR #976).
//
// The equivalence tests in accessible-timeline-asset-predicate.medium.spec.ts cannot observe a space
// arm that has lost its `timeline_spaces` gate. Every scenario they build in which a space is NOT
// timeline-enabled is a scenario in which `hasTimelineSpaces` is false — so the predicate COLLAPSES
// and the space arms are never emitted at all. The broken arm is masked by the very fast path the
// tests exist to justify.
//
// Observing it requires a viewer who is in at least one timeline-enabled space (so the FULL predicate
// runs) while the resource under test is linked through a DIFFERENT, non-timeline space. Then a
// missing gate leaks the second space's assets.
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

describe('accessibleTimelineAssetPredicate space-arm gating', () => {
  it('does not reach a linked library through a space the viewer has muted, while another space is live', async () => {
    const { ctx } = setup();
    const { user: source } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    try {
      // A live timeline space, so hasTimelineSpaces is true and the FULL predicate runs.
      const { space: liveSpace } = await ctx.newSharedSpace({ createdById: source.id });
      await ctx.newSharedSpaceMember({ spaceId: liveSpace.id, userId: source.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: liveSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      const { asset: liveAsset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: liveSpace.id, assetId: liveAsset.id, addedById: source.id });

      // A second space the viewer has muted, carrying a linked library.
      const { library } = await ctx.newLibrary({ ownerId: source.id });
      const { asset: mutedAsset } = await ctx.newAsset({
        ownerId: source.id,
        libraryId: library.id,
        visibility: AssetVisibility.Timeline,
      });
      const { space: mutedSpace } = await ctx.newSharedSpace({ createdById: source.id });
      await ctx.newSharedSpaceMember({ spaceId: mutedSpace.id, userId: source.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: mutedSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceLibrary({ spaceId: mutedSpace.id, libraryId: library.id, addedById: source.id });
      await ctx.database
        .updateTable('shared_space_member')
        .set({ showInTimeline: false })
        .where('spaceId', '=', mutedSpace.id)
        .where('userId', '=', viewer.id)
        .execute();

      const accessible = await selectAccessible(viewer.id, true);

      // The live space still grants its asset...
      expect(accessible.has(liveAsset.id)).toBe(true);
      // ...but the muted space's linked library must not leak. Fails if the library arm loses its gate.
      expect(accessible.has(mutedAsset.id)).toBe(false);
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [source.id, viewer.id]).execute();
    }
  });

  it('does not reach a linked album through a space the viewer has muted, while another space is live', async () => {
    const { ctx } = setup();
    const { user: source } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();

    try {
      const { space: liveSpace } = await ctx.newSharedSpace({ createdById: source.id });
      await ctx.newSharedSpaceMember({ spaceId: liveSpace.id, userId: source.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: liveSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      const { asset: liveAsset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
      await ctx.newSharedSpaceAsset({ spaceId: liveSpace.id, assetId: liveAsset.id, addedById: source.id });

      const { asset: mutedAsset } = await ctx.newAsset({ ownerId: source.id, visibility: AssetVisibility.Timeline });
      const { album } = await ctx.newAlbum({ ownerId: source.id });
      await ctx.newAlbumAsset({ albumId: album.id, assetId: mutedAsset.id });
      const { space: mutedSpace } = await ctx.newSharedSpace({ createdById: source.id });
      await ctx.newSharedSpaceMember({ spaceId: mutedSpace.id, userId: source.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceMember({ spaceId: mutedSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
      await ctx.newSharedSpaceAlbum({ spaceId: mutedSpace.id, albumId: album.id, addedById: source.id });
      await ctx.database
        .updateTable('shared_space_member')
        .set({ showInTimeline: false })
        .where('spaceId', '=', mutedSpace.id)
        .where('userId', '=', viewer.id)
        .execute();

      const accessible = await selectAccessible(viewer.id, true);

      expect(accessible.has(liveAsset.id)).toBe(true);
      expect(accessible.has(mutedAsset.id)).toBe(false);
    } finally {
      await ctx.database.deleteFrom('user').where('id', 'in', [source.id, viewer.id]).execute();
    }
  });
});
