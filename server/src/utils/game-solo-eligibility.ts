import { Expression, ExpressionBuilder, Kysely, sql, SqlBool } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';
import { spaceAssetIdUnion, spaceAssetPathBranches } from 'src/utils/shared-space-album-scope';

/**
 * Which libraries a solo challenge draws from. The two flags are frozen onto the challenge row at
 * generation (see `game_challenge.includePartners` / `includeSpaces`) rather than re-read from the
 * player's live preference, so toggling a source off mid-game cannot retroactively make a round's
 * photo unservable.
 */
export interface SoloPoolSources {
  userId: string;
  withPartners: boolean;
  withSpaces: boolean;
}

/**
 * "Is this ONE known asset one the player can legitimately be shown right now?" - the correlated,
 * per-asset form of solo eligibility, used only by `getSoloEligibleRoundAsset`, which already has
 * the asset id and needs a single index probe per arm. `soloPoolAssetIdUnion` below expresses the
 * SAME set the other way round, for the candidate queries; the two must stay in step, and the
 * generated-SQL guards in game.repository.spec.ts pin both shapes.
 *
 * Two things it encodes:
 *
 *  - **The read arms**, own photos always and the other two only when the player asked for them.
 *    Shared albums are deliberately NOT an arm: no composable predicate exists for them - the
 *    authoritative definition of that read access is an id-list checker, unusable as a WHERE
 *    clause - and no other listing surface in the product includes them either.
 *
 *    Both of those arms are additionally narrowed by the player's own per-source timeline
 *    preference: `partner.inTimeline` on the partner arm, `shared_space_member.showInTimeline` on
 *    the space arm. The source toggle is a coarse global opt-in ("shared-space photos are fair
 *    game"); those flags are the finer, per-relationship expression of the same intent, and the
 *    finer one wins. A player who has hidden one space from their timeline has already said "not
 *    this one", and a game is not the place to overrule it - the fork has removed this gate once
 *    before, from album-scoped search, and had to put it back (see utils/database.ts). This is the
 *    PER-MEMBER flag; the per-LINK `shared_space_album.showInTimeline` is separately required by
 *    `requireShowInTimeline` below.
 *  - **The design §5 visibility rules**: `deletedAt IS NULL`, `type = IMAGE`, and
 *    `visibility = 'timeline'`, ANDed OUTSIDE the arm OR so no arm can widen them. That floor is
 *    written here rather than inherited from an access helper because each of those helpers admits
 *    a class this pool must exclude: the set of visibilities a space shares admits ARCHIVED
 *    photos, the partner access check admits HIDDEN ones, and the album access check gates on no
 *    visibility at all, so it admits the LOCKED folder. It is also why the round-image route must
 *    re-run this rather than resolving the frozen `assetId` through the unscoped
 *    `AssetRepository.getById`.
 */
export const eligibleSoloAsset = (
  eb: ExpressionBuilder<DB, keyof DB>,
  { userId, withPartners, withSpaces }: SoloPoolSources,
): Expression<SqlBool> => {
  const arms: Expression<SqlBool>[] = [eb('asset.ownerId', '=', asUuid(userId))];

  if (withPartners) {
    arms.push(
      eb.exists(
        eb
          .selectFrom('partner')
          .select(sql`1`.as('one'))
          .whereRef('partner.sharedById', '=', 'asset.ownerId')
          .where('partner.sharedWithId', '=', asUuid(userId))
          .where('partner.inTimeline', '=', true),
      ),
    );
  }

  if (withSpaces) {
    arms.push(
      eb.or(
        spaceAssetPathBranches(eb, {
          correlateAssetId: 'asset.id',
          correlateLibraryId: 'asset.libraryId',
          scope: { memberUserId: userId, memberShowInTimeline: true },
          requireShowInTimeline: true,
        }),
      ),
    );
  }

  return eb.and([
    eb('asset.deletedAt', 'is', null),
    eb('asset.type', '=', AssetType.Image),
    eb('asset.visibility', '=', AssetVisibility.Timeline),
    eb.or(arms),
  ]);
};

/**
 * The same set as `eligibleSoloAsset`, driven from the id sources instead of tested per asset row -
 * for the candidate queries, which select the pool rather than resolve one known asset.
 *
 * ALWAYS a union, even when the only arm is the player's own library. MEASURED against the 62,235
 * image reference library (design open question 16.1, EXPLAIN (ANALYZE, BUFFERS), jit off):
 *
 *   own only, plain `asset."ownerId" = me`   5,285 buffers    one Seq Scan on asset
 *   own only, one-armed union                5,282 buffers    the planner flattens it
 *   own + spaces, ORed arms                137,439 buffers    34,429 per-row index probes
 *   own + spaces, union                     17,597 buffers    hash join over the id set
 *
 * So the union is free in the default configuration and 7.8x cheaper as soon as a second source is
 * on. Adding ANY `OR` to the arm makes the planner abandon the single scan of `asset` for a nested
 * loop driven from `asset_exif` - the arm's own selectivity is irrelevant, the shape change is what
 * costs. This is the same lesson `spaceAssetIdUnion` exists to encode, and the reason there is one
 * shape here rather than a conditional: a second shape buys nothing measurable, and a driver
 * selected by a boolean can be restructured into selecting NEITHER driver, which scans every asset
 * in the database with no scope at all.
 *
 * Carries NO visibility rules: like `spaceAssetIdUnion`, it answers "which assets are reachable",
 * never "which are showable". Each caller ANDs the floor on at the point of use, outside these
 * arms, and the generated-SQL guards fail if one of them stops doing so.
 */
export const soloPoolAssetIdUnion = (db: Kysely<DB>, { userId, withPartners, withSpaces }: SoloPoolSources) => {
  let ids = db.selectFrom('asset').select('asset.id as assetId').where('asset.ownerId', '=', asUuid(userId));

  if (withPartners) {
    ids = ids.union(
      db
        .selectFrom('asset')
        .innerJoin('partner', (join) =>
          join
            .onRef('partner.sharedById', '=', 'asset.ownerId')
            .on('partner.sharedWithId', '=', asUuid(userId))
            .on('partner.inTimeline', '=', true),
        )
        .select('asset.id as assetId'),
    );
  }

  if (withSpaces) {
    ids = ids.union(spaceAssetIdUnion(db, { memberUserId: userId, memberShowInTimeline: true }));
  }

  return ids;
};
