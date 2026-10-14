import { Kysely, sql } from 'kysely';

// asset."isFavorite" returns with upstream's meaning, the owner's favorite, as a projection of the
// asset_favorite overlay, which stays the source of truth for every user. The backfill runs before the
// triggers exist, so it does not echo into the overlay; its UPDATE bumps updateId once per owner favorite
// through asset_updatedAt, re-syncing those assets to stock clients. Trigger bodies: src/schema/functions.ts.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "isFavorite" boolean NOT NULL DEFAULT false;`.execute(db);
  await sql`
    UPDATE "asset"
       SET "isFavorite" = true
      FROM "asset_favorite" f
     WHERE f."assetId" = "asset"."id"
       AND f."userId" = "asset"."ownerId"
       AND NOT "asset"."isFavorite";
  `.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_favorite_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE asset SET "isFavorite" = true
      FROM inserted_rows
      WHERE asset.id = inserted_rows."assetId"
        AND asset."ownerId" = inserted_rows."userId"
        AND NOT asset."isFavorite";
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_favorite_after_delete()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE asset SET "isFavorite" = false
      FROM deleted_rows
      WHERE asset.id = deleted_rows."assetId"
        AND asset."ownerId" = deleted_rows."userId"
        AND asset."isFavorite";
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION asset_is_favorite_after_write()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      IF NEW."isFavorite" AND OLD."isFavorite" IS NOT TRUE THEN
        INSERT INTO asset_favorite ("userId", "assetId") VALUES (NEW."ownerId", NEW.id) ON CONFLICT DO NOTHING;
      ELSIF OLD."isFavorite" AND NOT NEW."isFavorite" THEN
        DELETE FROM asset_favorite WHERE "userId" = NEW."ownerId" AND "assetId" = NEW.id;
      END IF;
      RETURN NULL;
    END
  $$;`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_favorite_after_insert"
  AFTER INSERT ON "asset_favorite"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_favorite_after_insert();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_favorite_after_delete"
  AFTER DELETE ON "asset_favorite"
  REFERENCING OLD TABLE AS "deleted_rows"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_favorite_after_delete();`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "asset_is_favorite_after_write"
  AFTER INSERT OR UPDATE ON "asset"
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION asset_is_favorite_after_write();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_favorite_after_insert', '{"type":"function","name":"asset_favorite_after_insert","sql":"CREATE OR REPLACE FUNCTION asset_favorite_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset SET \\"isFavorite\\" = true\\n      FROM inserted_rows\\n      WHERE asset.id = inserted_rows.\\"assetId\\"\\n        AND asset.\\"ownerId\\" = inserted_rows.\\"userId\\"\\n        AND NOT asset.\\"isFavorite\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_favorite_after_delete', '{"type":"function","name":"asset_favorite_after_delete","sql":"CREATE OR REPLACE FUNCTION asset_favorite_after_delete()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE asset SET \\"isFavorite\\" = false\\n      FROM deleted_rows\\n      WHERE asset.id = deleted_rows.\\"assetId\\"\\n        AND asset.\\"ownerId\\" = deleted_rows.\\"userId\\"\\n        AND asset.\\"isFavorite\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_is_favorite_after_write', '{"type":"function","name":"asset_is_favorite_after_write","sql":"CREATE OR REPLACE FUNCTION asset_is_favorite_after_write()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      IF NEW.\\"isFavorite\\" AND OLD.\\"isFavorite\\" IS NOT TRUE THEN\\n        INSERT INTO asset_favorite (\\"userId\\", \\"assetId\\") VALUES (NEW.\\"ownerId\\", NEW.id) ON CONFLICT DO NOTHING;\\n      ELSIF OLD.\\"isFavorite\\" AND NOT NEW.\\"isFavorite\\" THEN\\n        DELETE FROM asset_favorite WHERE \\"userId\\" = NEW.\\"ownerId\\" AND \\"assetId\\" = NEW.id;\\n      END IF;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_favorite_after_insert', '{"type":"trigger","name":"asset_favorite_after_insert","sql":"CREATE OR REPLACE TRIGGER \\"asset_favorite_after_insert\\"\\n  AFTER INSERT ON \\"asset_favorite\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_favorite_after_insert();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_favorite_after_delete', '{"type":"trigger","name":"asset_favorite_after_delete","sql":"CREATE OR REPLACE TRIGGER \\"asset_favorite_after_delete\\"\\n  AFTER DELETE ON \\"asset_favorite\\"\\n  REFERENCING OLD TABLE AS \\"deleted_rows\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_favorite_after_delete();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_is_favorite_after_write', '{"type":"trigger","name":"asset_is_favorite_after_write","sql":"CREATE OR REPLACE TRIGGER \\"asset_is_favorite_after_write\\"\\n  AFTER INSERT OR UPDATE ON \\"asset\\"\\n  FOR EACH ROW\\n  WHEN (pg_trigger_depth() = 0)\\n  EXECUTE FUNCTION asset_is_favorite_after_write();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_asset_favorite_after_insert',
    'function_asset_favorite_after_delete',
    'function_asset_is_favorite_after_write',
    'trigger_asset_favorite_after_insert',
    'trigger_asset_favorite_after_delete',
    'trigger_asset_is_favorite_after_write'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "asset_favorite_after_insert" ON "asset_favorite";`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "asset_favorite_after_delete" ON "asset_favorite";`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "asset_is_favorite_after_write" ON "asset";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS asset_favorite_after_insert();`.execute(db);
  await sql`DROP FUNCTION IF EXISTS asset_favorite_after_delete();`.execute(db);
  await sql`DROP FUNCTION IF EXISTS asset_is_favorite_after_write();`.execute(db);
  await sql`ALTER TABLE "asset" DROP COLUMN "isFavorite";`.execute(db);
}
