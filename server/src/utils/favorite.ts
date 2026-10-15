// Per-user favorites overlay (#763). Correlated EXISTS against the `asset_favorite` table
// (slice 0), replacing the old ownership-masking form `asset."isFavorite" and asset."ownerId" =
// :me`, which could only ever be true for the asset's owner. See
// specs/2026-07-20-per-user-favorites-design.md §5.2. `asset."isFavorite"` is now the owner's projection
// of this overlay; where code may still read it directly is listed in src/utils/favorite-grep-gate.spec.ts.
//
// Follows the correlated-EXISTS idiom established in src/utils/shared-space-album-scope.ts
// (see `spaceDirectAssetExists` / `spaceAlbumAssetExists`): an `ExpressionBuilder<DB, keyof DB>`
// so the helper composes into any query regardless of what's already joined, and `eb.exists(...)`
// over a subquery projecting a literal `1`.
//
// `assetIdRef` is a plain `string` (not a typed `ReferenceExpression<DB, keyof DB>` like
// `correlateAssetId` in shared-space-album-scope.ts) so it keeps working when the asset table is
// aliased or the correlation target is a CTE column not present in the static `DB` schema (e.g.
// `getTimeBucket`'s `.with('asset', ...)` / `.with('cte', ...)` chain) — `sql.ref` interpolates it
// as a raw identifier instead of being resolved against the schema at compile time.
import { BadRequestException } from '@nestjs/common';
import { AliasableExpression, ExpressionBuilder, SqlBool, sql } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

/**
 * Per-user favorites (#763). Correlated EXISTS against the `asset_favorite` overlay: true iff
 * `userId` has favorited the asset referenced by `assetIdRef`.
 *
 * Usable in SELECT position (projects a boolean column, e.g. `.select((eb) =>
 * [favoriteExistsFor(eb, userId).as('isFavorite')])`) and in WHERE position (filters to the
 * user's favorites, e.g. `.where((eb) => favoriteExistsFor(eb, userId))`). Negate with
 * `eb.not(favoriteExistsFor(eb, userId))` for "not favorited by me".
 *
 * Return type is `AliasableExpression<SqlBool>` rather than the plain `Expression<SqlBool>` used
 * by the analogous helpers in shared-space-album-scope.ts — those are only ever used in WHERE
 * position, but this helper must also work in SELECT position, which needs the `.as(...)` method
 * that only `AliasableExpression` (what `eb.exists()` actually returns) provides. It's still
 * assignable everywhere a plain `Expression<SqlBool>` is expected (e.g. into `eb.not(...)`), since
 * `AliasableExpression` extends `Expression`.
 */
export function favoriteExistsFor(
  eb: ExpressionBuilder<DB, keyof DB>,
  userId: string,
  assetIdRef: string = 'asset.id',
): AliasableExpression<SqlBool> {
  return eb.exists(
    eb
      .selectFrom('asset_favorite')
      .select(eb.lit(1).as('exists'))
      .whereRef('asset_favorite.assetId', '=', sql.ref(assetIdRef))
      .where('asset_favorite.userId', '=', asUuid(userId)),
  );
}

/**
 * `isFavorite` on a partner or album asset row of the sync stream. A fork-aware client gets the viewer's own
 * overlay and hears of changes through AssetFavoritesV1. A stock client never syncs that stream and a non-owner's
 * favourite does not move `asset.updateId`, so it gets upstream's owner-only value, which stays correct.
 */
export const syncFavoriteFor = (eb: ExpressionBuilder<DB, 'asset'>, userId: string, forkAwareClient?: boolean) =>
  forkAwareClient
    ? favoriteExistsFor(eb as ExpressionBuilder<DB, keyof DB>, userId)
    : eb.case().when('asset.ownerId', '=', userId).then(eb.ref('asset.isFavorite')).else(eb.val(false)).end();

/**
 * The user whose favorites a response should reflect, or undefined when there is none. A
 * shared-link session's `auth.user` is the link OWNER (validateSharedLinkKey/Slug), not the
 * anonymous visitor — projecting their overlay would show a visitor which of the album's
 * photos (including other contributors' photos) the owner favorited. Undefined makes every
 * `$if(!!authUserId, …)` projection skip, so mapAsset reports false.
 */
export const favoriteViewerId = (auth: AuthDto): string | undefined => (auth.sharedLink ? undefined : auth.user.id);

/** Filtering by favorite state would leak the link owner's favorites just like projecting it. */
export const rejectSharedLinkFavoriteFilter = (auth: AuthDto, isFavorite: boolean | undefined | null) => {
  if (auth.sharedLink && isFavorite !== undefined && isFavorite !== null) {
    throw new BadRequestException('Shared link sessions cannot filter by favorite');
  }
};
