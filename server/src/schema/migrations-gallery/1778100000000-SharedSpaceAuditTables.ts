import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_audit_spaceId_idx" ON "shared_space_audit" ("spaceId")`.execute(db);
  await sql`CREATE INDEX "shared_space_audit_userId_idx" ON "shared_space_audit" ("userId")`.execute(db);
  await sql`CREATE INDEX "shared_space_audit_deletedAt_idx" ON "shared_space_audit" ("deletedAt")`.execute(db);

  await sql`
    CREATE TABLE "shared_space_member_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_member_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_member_audit_spaceId_idx" ON "shared_space_member_audit" ("spaceId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_member_audit_userId_idx" ON "shared_space_member_audit" ("userId")`.execute(db);
  await sql`CREATE INDEX "shared_space_member_audit_deletedAt_idx" ON "shared_space_member_audit" ("deletedAt")`.execute(
    db,
  );

  await sql`
    CREATE TABLE "shared_space_asset_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_asset_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_asset_audit_spaceId_idx" ON "shared_space_asset_audit" ("spaceId")`.execute(db);
  await sql`CREATE INDEX "shared_space_asset_audit_assetId_idx" ON "shared_space_asset_audit" ("assetId")`.execute(db);
  await sql`CREATE INDEX "shared_space_asset_audit_deletedAt_idx" ON "shared_space_asset_audit" ("deletedAt")`.execute(
    db,
  );

  // Trigger functions and triggers — fan-out audit emission, mirroring the album_audit pattern.

  await sql`CREATE OR REPLACE FUNCTION shared_space_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- BEFORE DELETE row-level trigger so shared_space_member rows are still
      -- visible. Emits one shared_space_audit row per (member or creator) for the
      -- deleted space. The UNION dedups the common case where the creator is also
      -- a member. The companion shared_space_member_delete_audit trigger does NOT
      -- insert into shared_space_audit during cascade, so this is the single source
      -- of truth on space deletion.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT DISTINCT "spaceId", "userId" FROM (
        SELECT ssm."spaceId", ssm."userId"
        FROM shared_space_member ssm
        WHERE ssm."spaceId" = OLD."id"
        UNION
        SELECT OLD."id" AS "spaceId", OLD."createdById" AS "userId"
      ) AS targets;

      RETURN OLD;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_member_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- Always emit the join-row delete to shared_space_member_audit.
      INSERT INTO shared_space_member_audit ("spaceId", "userId")
      SELECT "spaceId", "userId" FROM "old";

      -- Emit to shared_space_audit only when the parent shared_space row still
      -- exists (i.e. this is a direct member removal, not a cascade from a
      -- shared_space delete). For cascades, the parent shared_space_delete_audit
      -- BEFORE-row trigger has already emitted the audit rows.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT o."spaceId", o."userId"
      FROM "old" o
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId");

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_asset_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_asset_audit ("spaceId", "assetId")
      SELECT "spaceId", "assetId" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_delete_audit"
  BEFORE DELETE ON "shared_space"
  FOR EACH ROW
  EXECUTE FUNCTION shared_space_delete_audit();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_delete_audit"
  AFTER DELETE ON "shared_space_member"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_delete_audit();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_asset_delete_audit"
  AFTER DELETE ON "shared_space_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() <= 1)
  EXECUTE FUNCTION shared_space_asset_delete_audit();`.execute(db);

  // Register the trigger functions and triggers as known fork additions so the
  // sql-tools schema diff sees the same canonical sql on both sides. The exact
  // strings below were lifted from `pnpm migrations:debug` after the matching
  // registerFunction + decorator declarations were added.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_delete_audit', '{"type":"function","name":"shared_space_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- BEFORE DELETE row-level trigger so shared_space_member rows are still\\n      -- visible. Emits one shared_space_audit row per (member or creator) for the\\n      -- deleted space. The UNION dedups the common case where the creator is also\\n      -- a member. The companion shared_space_member_delete_audit trigger does NOT\\n      -- insert into shared_space_audit during cascade, so this is the single source\\n      -- of truth on space deletion.\\n      INSERT INTO shared_space_audit (\\"spaceId\\", \\"userId\\")\\n      SELECT DISTINCT \\"spaceId\\", \\"userId\\" FROM (\\n        SELECT ssm.\\"spaceId\\", ssm.\\"userId\\"\\n        FROM shared_space_member ssm\\n        WHERE ssm.\\"spaceId\\" = OLD.\\"id\\"\\n        UNION\\n        SELECT OLD.\\"id\\" AS \\"spaceId\\", OLD.\\"createdById\\" AS \\"userId\\"\\n      ) AS targets;\\n\\n      RETURN OLD;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_delete_audit', '{"type":"function","name":"shared_space_member_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_member_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- Always emit the join-row delete to shared_space_member_audit.\\n      INSERT INTO shared_space_member_audit (\\"spaceId\\", \\"userId\\")\\n      SELECT \\"spaceId\\", \\"userId\\" FROM \\"old\\";\\n\\n      -- Emit to shared_space_audit only when the parent shared_space row still\\n      -- exists (i.e. this is a direct member removal, not a cascade from a\\n      -- shared_space delete). For cascades, the parent shared_space_delete_audit\\n      -- BEFORE-row trigger has already emitted the audit rows.\\n      INSERT INTO shared_space_audit (\\"spaceId\\", \\"userId\\")\\n      SELECT o.\\"spaceId\\", o.\\"userId\\"\\n      FROM \\"old\\" o\\n      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o.\\"spaceId\\");\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_asset_delete_audit', '{"type":"function","name":"shared_space_asset_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_asset_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_asset_audit (\\"spaceId\\", \\"assetId\\")\\n      SELECT \\"spaceId\\", \\"assetId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_delete_audit', '{"type":"trigger","name":"shared_space_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_delete_audit\\"\\n  BEFORE DELETE ON \\"shared_space\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION shared_space_delete_audit();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_asset_delete_audit', '{"type":"trigger","name":"shared_space_asset_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_asset_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION shared_space_asset_delete_audit();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_delete_audit', '{"type":"trigger","name":"shared_space_member_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_member\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_delete_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_shared_space_delete_audit',
    'function_shared_space_member_delete_audit',
    'function_shared_space_asset_delete_audit',
    'trigger_shared_space_delete_audit',
    'trigger_shared_space_member_delete_audit',
    'trigger_shared_space_asset_delete_audit'
  )`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_asset_delete_audit" ON "shared_space_asset"`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_delete_audit" ON "shared_space_member"`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_delete_audit" ON "shared_space"`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_asset_delete_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_delete_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_delete_audit()`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_asset_audit"`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_member_audit"`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_audit"`.execute(db);
}
