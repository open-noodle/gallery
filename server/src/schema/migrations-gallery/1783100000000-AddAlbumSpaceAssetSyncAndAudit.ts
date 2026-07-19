import { Kysely, sql } from 'kysely';

// #764 Slice 5 — sync substrate for cross-owner contributions.
//
// 1. Add updateId/updatedAt to album_space_asset (createId/createdAt already exist from 1783000000000)
//    + the standard updated_at BEFORE-UPDATE trigger, so the contributed sync arm mirrors album_asset.
// 2. Create album_space_asset_audit + a statement-level AFTER-DELETE trigger that tombstones every
//    deleted contribution (explicit removal + FK cascade), driving SharedSpaceAlbumToAssetSync deletes.
export async function up(db: Kysely<any>): Promise<void> {
  // --- 1. Sync watermark columns on album_space_asset ---
  await sql`ALTER TABLE "album_space_asset" ADD COLUMN "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`ALTER TABLE "album_space_asset" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`CREATE INDEX "album_space_asset_updateId_idx" ON "album_space_asset" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_space_asset_updatedAt"
  BEFORE UPDATE ON "album_space_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_space_asset_updatedAt', '{"type":"trigger","name":"album_space_asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"album_space_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"album_space_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  // --- 2. Delete-audit table ---
  await sql`
    CREATE TABLE "album_space_asset_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7() PRIMARY KEY,
      "albumId"   uuid NOT NULL,
      "assetId"   uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp()
    );
  `.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_albumId_id_idx" ON "album_space_asset_audit" ("albumId", "id");`.execute(
    db,
  );
  await sql`CREATE INDEX "album_space_asset_audit_albumId_idx" ON "album_space_asset_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_assetId_idx" ON "album_space_asset_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_audit_deletedAt_idx" ON "album_space_asset_audit" ("deletedAt");`.execute(
    db,
  );

  // --- 3. AFTER-DELETE statement-level trigger → tombstone every deleted contribution ---
  await sql`CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO album_space_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_space_asset_delete_audit"
  AFTER DELETE ON "album_space_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_space_asset_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_space_asset_delete_audit', '{"type":"function","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_space_asset_audit (\\"albumId\\", \\"assetId\\")\\n      SELECT \\"albumId\\", \\"assetId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_space_asset_delete_audit', '{"type":"trigger","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"album_space_asset_delete_audit\\"\\n  AFTER DELETE ON \\"album_space_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_space_asset_delete_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'trigger_album_space_asset_updatedAt',
    'function_album_space_asset_delete_audit',
    'trigger_album_space_asset_delete_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_space_asset_delete_audit" ON "album_space_asset";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_space_asset_delete_audit();`.execute(db);
  await sql`DROP TABLE IF EXISTS "album_space_asset_audit";`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_space_asset_updatedAt" ON "album_space_asset";`.execute(db);
  await sql`DROP INDEX IF EXISTS "album_space_asset_updateId_idx";`.execute(db);
  await sql`ALTER TABLE "album_space_asset" DROP COLUMN IF EXISTS "updatedAt";`.execute(db);
  await sql`ALTER TABLE "album_space_asset" DROP COLUMN IF EXISTS "updateId";`.execute(db);
}
