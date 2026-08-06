import { Kysely, sql } from 'kysely';

// #869: every "is this asset in the Locked Folder?" gate now also anti-joins against the motion videos
// of locked live photos (`isNotLockedAsset`). Without this index that anti-join has to scan `asset` for
// `visibility = 'locked'` on every search.
//
// The predicate deliberately does NOT filter on `visibility = 'locked'`: that enum value is added by
// `ALTER TYPE ... ADD VALUE` (1746844028242-AddLockedVisibilityEnum), and on a fresh database every
// migration runs inside a single transaction, where Postgres refuses to use a not-yet-committed enum
// value. Carrying `visibility` as the second index column buys the same index-only anti-join instead.
//
// Both statements are idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), matching
// 1782000000000-AddAssetExifDescriptionTrigramIndex. A bare CREATE would fail the whole migration —
// and with it server boot — against a database where the index already exists, which is exactly what
// happens when an admin hand-applies the schema-check drift advice (the reason
// 1784800000000-RepairSharedSpaceAlbumGrantDrift had to be written).
//
// The `sql` stored in migration_overrides deliberately keeps the plain `CREATE INDEX` form with no
// `IF NOT EXISTS`: sql-tools compares that string against what `asIndexCreate` emits for the @Index
// decorator on AssetTable, so any extra keyword there would read as permanent schema drift.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS "asset_livePhotoVideoId_visibility_idx" ON "asset" ("livePhotoVideoId", "visibility") WHERE ("livePhotoVideoId" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_livePhotoVideoId_visibility_idx', '{"type":"index","name":"asset_livePhotoVideoId_visibility_idx","sql":"CREATE INDEX \\"asset_livePhotoVideoId_visibility_idx\\" ON \\"asset\\" (\\"livePhotoVideoId\\", \\"visibility\\") WHERE (\\"livePhotoVideoId\\" IS NOT NULL);"}'::jsonb) ON CONFLICT ("name") DO NOTHING;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "asset_livePhotoVideoId_visibility_idx";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_livePhotoVideoId_visibility_idx';`.execute(
    db,
  );
}
