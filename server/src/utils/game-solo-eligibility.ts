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
 *    clause - and no other listing surface in the product includes them either. The partner arm
 *    honours the per-partner timeline preference, matching timeline and search rather than map:
 *    the player has already said "do not show me their photos", and a game is not the place to
 *    overrule it.
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
          scope: { memberUserId: userId },
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
 * Returns `undefined` when the player asked for nothing but their own library, and that is the
 * point of the return type: with both toggles off the pool is exactly `asset."ownerId" = me`, an
 * indexed predicate, and routing it through a one-armed union instead would join `asset` to itself
 * and read every candidate row twice. The caller applies the plain predicate in that case. Every
 * OTHER combination has to come through here, because an `OR` across the arms defeats that same
 * index and degrades stage 1 to a full scan of the whole `asset` table - the lesson the space pool
 * already learned, and the reason `spaceAssetIdUnion` exists at all.
 *
 * Carries NO visibility rules: like `spaceAssetIdUnion`, it answers "which assets are reachable",
 * never "which are showable". Each caller ANDs the floor on at the point of use, outside these
 * arms, and the generated-SQL guards fail if one of them stops doing so.
 */
export const soloPoolAssetIdUnion = (db: Kysely<DB>, { userId, withPartners, withSpaces }: SoloPoolSources) => {
  if (!withPartners && !withSpaces) {
    return;
  }

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
    ids = ids.union(spaceAssetIdUnion(db, { memberUserId: userId }));
  }

  return ids;
};
