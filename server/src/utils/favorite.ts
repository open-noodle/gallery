// Per-user favorites overlay (#763). Correlated EXISTS against the `asset_favorite` table
// (slice 0), replacing the old ownership-masking form `asset."isFavorite" and asset."ownerId" =
// :me`, which could only ever be true for the asset's owner. See
// docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §5.2.
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
import { AliasableExpression, ExpressionBuilder, SqlBool, sql } from 'kysely';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

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
