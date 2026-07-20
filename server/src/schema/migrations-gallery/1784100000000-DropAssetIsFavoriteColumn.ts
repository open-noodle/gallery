import { Kysely, sql } from 'kysely';

// Per-user favorites overlay (#763), slice 3 — the point of no return. The legacy
// asset."isFavorite" column has been dead weight since slice 0 backfilled it into
// `asset_favorite` (1784000000000-AddAssetFavoriteTables): every write path (updateFavorites) has
// routed through the overlay since slice 1, every read path (mapAsset's isFavoriteForUser, the
// owner-scoped job.service.ts websocket payloads, the plugin-facing workflowAssetV1 projection) has
// resolved from the overlay since slice 1b/2, and the grep gate (favorite-grep-gate.spec.ts) has
// been failing any new `asset.isFavorite` read since. `asset_favorite` is the single source of
// truth going forward — this migration removes the column it replaced.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset" DROP COLUMN "isFavorite";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset" ADD COLUMN "isFavorite" boolean NOT NULL DEFAULT false;`.execute(db);

  // Quoted camelCase identifiers are required — unquoted identifiers fold to lowercase and this
  // update would fail against the generated schema. Only the OWNER's favorite backfills, matching
  // the raw column's pre-#763 semantics (it could only ever be true for the asset's owner) — see
  // src/utils/favorite.ts favoriteExistsForOwner's doc comment for the same reasoning.
  await sql`
    UPDATE "asset"
       SET "isFavorite" = true
      FROM "asset_favorite" f
     WHERE f."assetId" = "asset"."id"
       AND f."userId" = "asset"."ownerId";
  `.execute(db);
}
