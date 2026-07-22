import { Kysely, sql } from 'kysely';

// Repairs databases damaged by acting on the schema-drift warning that v5.2.0-rc.0 emitted.
//
// rc.0 shipped migrations 1783100000000 + 1783700000000 without the matching declarations in
// src/schema/functions.ts, so every rc.0 install booted with `Detected schema drift` and
// `immich-admin schema-check` printed remediation SQL that pointed the WRONG way — it reverted
// the #752 F-A fix and tried to drop #764's delete-audit. An admin who pasted that into psql
// (which continues past errors by default) ends up with:
//   - shared_space_member_after_insert_album back on `ON CONFLICT DO NOTHING` -> F-A returns:
//     a re-added member whose grant survived removal keeps its original createId, the
//     grant-keyed backfill never re-fires, and contributions made during their absence stay
//     permanently undeliverable to that member's devices.
//   - both album_space_asset_delete_audit override rows deleted (the DROP FUNCTION itself fails
//     on the trigger dependency, so the function usually survives — but not if they used CASCADE).
//
// Fixing functions.ts alone cannot heal that: those migrations are already recorded as applied,
// so nothing re-runs. Worse, the reverted function is INVISIBLE to drift detection, because
// sql-tools compares migration_overrides rows rather than live function bodies — so if the paste
// updated the function but not its override row, schema-check reports nothing at all.
//
// Every statement below is idempotent and asserts the state a healthy database already has, so
// this is a no-op rewrite for anyone who never touched their schema. All DDL is byte-identical to
// src/schema/functions.ts and the originating migrations — migration-override-parity.spec.ts and
// trigger-override-parity.spec.ts pin it.
export async function up(db: Kysely<any>): Promise<void> {
  // --- #752 F-A: member-join album grant must refresh createId on conflict ---
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssa."albumId"
        FROM inserted_rows ir
        INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_after_insert_album', '{"type":"function","name":"shared_space_member_after_insert_album","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ir.\\"userId\\", ssa.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (\\n        SELECT DISTINCT ssa.\\"albumId\\"\\n        FROM inserted_rows ir\\n        INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      );\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(db);

  // --- #764: cross-owner contribution delete-audit (function + statement AFTER DELETE trigger) ---
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

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_space_asset_delete_audit', '{"type":"function","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO album_space_asset_audit (\\"albumId\\", \\"assetId\\")\\n      SELECT \\"albumId\\", \\"assetId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_space_asset_delete_audit', '{"type":"trigger","name":"album_space_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"album_space_asset_delete_audit\\"\\n  AFTER DELETE ON \\"album_space_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_space_asset_delete_audit();"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(db);
}

// Intentionally a no-op. This migration only re-asserts the state every other migration already
// established; "undoing" it would mean deliberately restoring the reverted, broken definitions.
export async function down(): Promise<void> {
  // no-op
}
