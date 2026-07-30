// #763 design §5.2 + edge case E10: favorite rows are NEVER cleaned up when a user loses access.
// `asset_favorite` is an overlay keyed by (userId, assetId) with no membership awareness of its
// own, so the ONLY thing keeping a departed member's favorite out of their favorites surfaces is
// the read path re-deriving visibility from LIVE membership on every request. That makes the
// invariant a pure query-scoping property — which is why this lives at the medium level (real
// Postgres) rather than in a service unit test: mocking `getSpaceIdsForTimeline` would assert the
// mock, not the SQL.
//
// The chain under test, driven through the REAL services so both halves run for real:
//   1. `SharedSpaceRepository.getSpaceIdsForTimeline(userId)` selects `shared_space_member` rows
//      for `userId` with `showInTimeline = true` — CURRENT membership, resolved per request.
//   2. `timeline.service.ts` `buildTimeBucketOptions` / `search.service.ts` `getTimelineSpaceIds`
//      set `timelineSpaceIds` from that, and ONLY when the result is non-empty.
//   3. `withTimeBucketAssetFilters` (asset.repository.ts) and `searchAssetBuilderLegacy`
//      (utils/database.ts) each apply the per-user favorite predicate
//      `favoriteExistsFor(eb, authUserId)` as a SEPARATE, ANDed `where` alongside the RBAC scope:
//      the `timelineSpaceIds` arm when spaces are in play, otherwise a bare
//      `asset.ownerId = anyUuid(userIds)`.
// So a revoked member's lingering overlay row can never surface the asset: it is excluded by the
// scope before the favorite predicate is reached.
//
// Both surfaces are covered because they are different query builders that each carry their own
// copy of the scope/favorite pairing, and a regression in one would not show up in the other:
//   - timeline / time-bucket path — `AssetRepository.getTimeBuckets` + `getTimeBucket`, what the
//     web Favorites route and the Photos timeline favorites filter actually call.
//   - search path — `SearchRepository.searchMetadata` -> `searchAssetBuilderLegacy`, what the
//     `/search` favorites filter and "add all to collection" call.
//
// E10 is also covered end-to-end by e2e/src/specs/server/api/asset-favorite.e2e-spec.ts, but only
// via bucket COUNTS on the timeline path, with no control asset — an accidentally
// returns-nothing query would still read as green there. Every assertion below pairs the
// must-disappear asset with a must-remain one in the SAME response.
import { Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { SearchService } from 'src/services/search.service';
import { TimelineService } from 'src/services/timeline.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

// Every seeded asset lands in this month bucket so a single getTimeBucket call sees them all.
const BUCKET = '2024-05-01';

// `withSharedSpaces` is what makes the space arm resolve at all, and timeBucketChecks rejects it
// unless an explicit non-archive visibility is supplied.
const FAVORITE_FILTER = {
  isFavorite: true,
  withSharedSpaces: true,
  visibility: AssetVisibility.Timeline,
} as const;

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  const timeline = newMediumService(TimelineService, {
    database,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  const search = newMediumService(SearchService, {
    database,
    real: [
      AccessRepository,
      AssetRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      TagRepository,
    ],
    mock: [LoggingRepository],
  });

  // Both services share one database, so either ctx seeds for both.
  return {
    ctx: timeline.ctx,
    timeline: timeline.sut,
    search: search.sut,
    spaces: timeline.ctx.get(SharedSpaceRepository),
  };
};

type Ctx = ReturnType<typeof setup>['ctx'];

// getTimeBucket's projection stage inner-joins asset_exif, so a seeded asset without an exif row
// is silently dropped from the bucket — which would make the absence assertions meaningless.
const seedAsset = async (ctx: Ctx, ownerId: string, localDateTime: Date) => {
  const { asset } = await ctx.newAsset({ ownerId, fileCreatedAt: localDateTime, localDateTime });
  await ctx.newExif({ assetId: asset.id, make: 'Canon', timeZone: 'UTC' });
  return asset;
};

const favorite = (ctx: Ctx, userId: string, assetId: string) =>
  ctx.database.insertInto('asset_favorite').values({ userId, assetId }).execute();

const revokeMembership = (ctx: Ctx, spaceId: string, userId: string) =>
  ctx.database.deleteFrom('shared_space_member').where('spaceId', '=', spaceId).where('userId', '=', userId).execute();

const favoriteBucketTotal = async (sut: TimelineService, auth: AuthDto) => {
  // Spread per call: timeBucketChecks mutates the dto (`dto.userId ||= auth.user.id`).
  const buckets = await sut.getTimeBuckets(auth, { ...FAVORITE_FILTER });
  return buckets.reduce((sum, bucket) => sum + Number(bucket.count), 0);
};

const favoriteBucketAssets = (sut: TimelineService, auth: AuthDto) =>
  sut.getTimeBucket(auth, { ...FAVORITE_FILTER, timeBucket: BUCKET });

const favoriteSearchIds = async (sut: SearchService, auth: AuthDto) => {
  const response = await sut.searchMetadata(auth, { ...FAVORITE_FILTER });
  return response.assets.items.map((item) => item.id);
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
}, 30_000);

describe('favorites and access revocation (#763 E10)', () => {
  it('hides a favorite on a space asset once the member leaves, while keeping their own favorites', async () => {
    const { ctx, timeline, search, spaces } = setup();

    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    // The owner's asset, reachable by the viewer ONLY through space membership.
    const ownerAsset = await seedAsset(ctx, owner.id, new Date('2024-05-10T12:00:00Z'));
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: ownerAsset.id, addedById: owner.id });

    // The control: the viewer's own asset, reachable regardless of any membership. Present in
    // every response below, so none of the absence assertions can pass on an empty result.
    const ownAsset = await seedAsset(ctx, viewer.id, new Date('2024-05-20T12:00:00Z'));

    // #763: canFavorite is deliberately NOT ownership-gated — a read-only Viewer may favorite
    // another member's asset. Inserted directly; the write path is covered by
    // asset-favorite.repository.spec.ts and the e2e suite.
    await favorite(ctx, viewer.id, ownerAsset.id);
    await favorite(ctx, viewer.id, ownAsset.id);

    // --- while the membership is live -------------------------------------------------------
    expect(await spaces.getSpaceIdsForTimeline(viewer.id)).toEqual([{ spaceId: space.id }]);
    expect(await favoriteBucketTotal(timeline, viewerAuth)).toBe(2);

    const bucketBefore = await favoriteBucketAssets(timeline, viewerAuth);
    expect(bucketBefore).toContain(ownerAsset.id);
    expect(bucketBefore).toContain(ownAsset.id);

    const searchBefore = await favoriteSearchIds(search, viewerAuth);
    expect(searchBefore.toSorted()).toEqual([ownerAsset.id, ownAsset.id].toSorted());

    // --- membership revoked -----------------------------------------------------------------
    await revokeMembership(ctx, space.id, viewer.id);

    // The mechanism: membership is re-resolved per request, so the space drops out of
    // `timelineSpaceIds` entirely and the queries fall back to `asset.ownerId = viewer`.
    expect(await spaces.getSpaceIdsForTimeline(viewer.id)).toEqual([]);

    expect(await favoriteBucketTotal(timeline, viewerAuth)).toBe(1);

    const bucketAfter = await favoriteBucketAssets(timeline, viewerAuth);
    expect(bucketAfter).not.toContain(ownerAsset.id);
    expect(bucketAfter).toContain(ownAsset.id);

    expect(await favoriteSearchIds(search, viewerAuth)).toEqual([ownAsset.id]);

    // §5.2: the overlay row is deliberately NOT cleaned up — visibility is re-derived, so
    // rejoining restores the favorite without re-favoriting. And the asset is still in the
    // space, which pins the drop-out on the membership loss rather than on the asset leaving.
    const rows = await ctx.database
      .selectFrom('asset_favorite')
      .selectAll()
      .where('userId', '=', viewer.id)
      .where('assetId', '=', ownerAsset.id)
      .execute();
    expect(rows).toHaveLength(1);

    const spaceAssets = await ctx.database
      .selectFrom('shared_space_asset')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('assetId', '=', ownerAsset.id)
      .execute();
    expect(spaceAssets).toHaveLength(1);
  });

  // Distinct code path from the test above: with another live membership the caller still has a
  // non-empty `timelineSpaceIds`, so the queries stay on the SPACE arm rather than falling back
  // to the bare ownerId predicate. The revoked space must simply be absent from the id list that
  // arm is scoped by — a narrowing, not a disabled branch.
  it('keeps the space arm active for remaining memberships and still excludes the revoked space', async () => {
    const { ctx, timeline, search, spaces } = setup();

    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const viewerAuth = factory.auth({ user: { id: viewer.id, email: viewer.email } });

    const { space: revokedSpace } = await ctx.newSharedSpace({ createdById: ownerA.id });
    await ctx.newSharedSpaceMember({ spaceId: revokedSpace.id, userId: ownerA.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: revokedSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const { space: keptSpace } = await ctx.newSharedSpace({ createdById: ownerB.id });
    await ctx.newSharedSpaceMember({ spaceId: keptSpace.id, userId: ownerB.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: keptSpace.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

    const revokedAsset = await seedAsset(ctx, ownerA.id, new Date('2024-05-11T12:00:00Z'));
    await ctx.newSharedSpaceAsset({ spaceId: revokedSpace.id, assetId: revokedAsset.id, addedById: ownerA.id });

    // The control lives in the OTHER space and is owned by neither the viewer nor ownerA, so it
    // can only be reached through the space arm — if that arm were disabled instead of narrowed,
    // this asset would vanish too and the test would fail loudly.
    const keptAsset = await seedAsset(ctx, ownerB.id, new Date('2024-05-21T12:00:00Z'));
    await ctx.newSharedSpaceAsset({ spaceId: keptSpace.id, assetId: keptAsset.id, addedById: ownerB.id });

    await favorite(ctx, viewer.id, revokedAsset.id);
    await favorite(ctx, viewer.id, keptAsset.id);

    expect(await favoriteBucketTotal(timeline, viewerAuth)).toBe(2);

    await revokeMembership(ctx, revokedSpace.id, viewer.id);

    expect(await spaces.getSpaceIdsForTimeline(viewer.id)).toEqual([{ spaceId: keptSpace.id }]);
    expect(await favoriteBucketTotal(timeline, viewerAuth)).toBe(1);

    const bucketAfter = await favoriteBucketAssets(timeline, viewerAuth);
    expect(bucketAfter).not.toContain(revokedAsset.id);
    expect(bucketAfter).toContain(keptAsset.id);

    expect(await favoriteSearchIds(search, viewerAuth)).toEqual([keptAsset.id]);
  });
});
