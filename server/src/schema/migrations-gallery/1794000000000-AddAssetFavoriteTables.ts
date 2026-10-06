import { Kysely, sql } from 'kysely';

// Per-user favorites overlay (#763). A favorite is a fact about (user, asset), never about an
// asset alone — see docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §4, §4.1, §4.3.
//
// 1. `asset_favorite` — composite PK (userId, assetId), both FKs CASCADE, plus createId/updateId
//    sync watermarks. No update trigger: rows are only ever inserted or deleted, never mutated in
//    place (mirrors shared_space_album_user / album_space_asset).
// 2. `asset_favorite_audit` — delete-tombstone table + a statement-level AFTER DELETE trigger,
//    mirroring album_space_asset_audit. Created now, in slice 0, because slice 3 (dropping
//    asset."isFavorite") is irreversible and this table must exist before that point.
// 3. Backfill every existing owner favorite from asset."isFavorite" into the overlay. Does NOT
//    drop asset."isFavorite" — that is slice 3.
export async function up(db: Kysely<any>): Promise<void> {
  // --- 1. asset_favorite ---
  await sql`
    CREATE TABLE "asset_favorite" (
      "userId"    uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "assetId"   uuid NOT NULL REFERENCES "asset"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      "updateId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "asset_favorite_pkey" PRIMARY KEY ("userId", "assetId")
    );
  `.execute(db);
  await sql`CREATE INDEX "asset_favorite_assetId_idx" ON "asset_favorite" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_favorite_createId_idx" ON "asset_favorite" ("createId");`.execute(db);
  await sql`CREATE INDEX "asset_favorite_updateId_idx" ON "asset_favorite" ("updateId");`.execute(db);

  // --- 2. asset_favorite_audit + AFTER-DELETE statement-level trigger ---
  await sql`
    CREATE TABLE "asset_favorite_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7() PRIMARY KEY,
      "userId"    uuid NOT NULL,
      "assetId"   uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp()
    );
  `.execute(db);
  await sql`CREATE INDEX "asset_favorite_audit_userId_id_idx" ON "asset_favorite_audit" ("userId", "id");`.execute(db);
  await sql`CREATE INDEX "asset_favorite_audit_userId_idx" ON "asset_favorite_audit" ("userId");`.execute(db);
  await sql`CREATE INDEX "asset_favorite_audit_assetId_idx" ON "asset_favorite_audit" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_favorite_audit_deletedAt_idx" ON "asset_favorite_audit" ("deletedAt");`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION asset_favorite_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO asset_favorite_audit ("userId", "assetId")
      SELECT "userId", "assetId" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "asset_favorite_delete_audit"
  AFTER DELETE ON "asset_favorite"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION asset_favorite_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_favorite_delete_audit', '{"type":"function","name":"asset_favorite_delete_audit","sql":"CREATE OR REPLACE FUNCTION asset_favorite_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO asset_favorite_audit (\\"userId\\", \\"assetId\\")\\n      SELECT \\"userId\\", \\"assetId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_favorite_delete_audit', '{"type":"trigger","name":"asset_favorite_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"asset_favorite_delete_audit\\"\\n  AFTER DELETE ON \\"asset_favorite\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION asset_favorite_delete_audit();"}'::jsonb);`.execute(
    db,
  );

  // --- 3. Backfill existing owner favorites. Quoted camelCase identifiers are required — unquoted
  // identifiers fold to lowercase and this insert would fail against the generated schema. ---
  await sql`
    INSERT INTO "asset_favorite" ("userId", "assetId")
    SELECT "ownerId", "id" FROM "asset" WHERE "isFavorite" = true
    ON CONFLICT DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_asset_favorite_delete_audit',
    'trigger_asset_favorite_delete_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "asset_favorite_delete_audit" ON "asset_favorite";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS asset_favorite_delete_audit();`.execute(db);
  await sql`DROP TABLE IF EXISTS "asset_favorite_audit";`.execute(db);
  await sql`DROP TABLE IF EXISTS "asset_favorite";`.execute(db);
}
