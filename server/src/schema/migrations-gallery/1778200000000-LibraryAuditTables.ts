import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "library_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "libraryId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "library_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "library_audit_libraryId_idx" ON "library_audit" ("libraryId")`.execute(db);
  await sql`CREATE INDEX "library_audit_userId_idx" ON "library_audit" ("userId")`.execute(db);
  await sql`CREATE INDEX "library_audit_deletedAt_idx" ON "library_audit" ("deletedAt")`.execute(db);

  await sql`
    CREATE TABLE "library_asset_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "assetId" uuid NOT NULL,
      "libraryId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "library_asset_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "library_asset_audit_assetId_idx" ON "library_asset_audit" ("assetId")`.execute(db);
  await sql`CREATE INDEX "library_asset_audit_libraryId_idx" ON "library_asset_audit" ("libraryId")`.execute(db);
  await sql`CREATE INDEX "library_asset_audit_deletedAt_idx" ON "library_asset_audit" ("deletedAt")`.execute(db);

  await sql`
    CREATE TABLE "shared_space_library_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "libraryId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_library_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_library_audit_spaceId_idx" ON "shared_space_library_audit" ("spaceId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_library_audit_libraryId_idx" ON "shared_space_library_audit" ("libraryId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_library_audit_deletedAt_idx" ON "shared_space_library_audit" ("deletedAt")`.execute(
    db,
  );

  // Functions: helper + three trigger fan-out bodies. Mirrors the pattern from
  // 1778100000000-SharedSpaceAuditTables.ts — canonical SQL lifted from
  // `pnpm migrations:debug` after decorators + registerFunction declarations
  // were added.

  await sql`CREATE OR REPLACE FUNCTION user_has_library_path(target_library_id uuid, target_user_id uuid, exclude_space_id uuid)
  RETURNS boolean
  STABLE LANGUAGE SQL
  AS $$
    SELECT
      EXISTS (
        SELECT 1 FROM library l
        WHERE l."id" = target_library_id
          AND l."ownerId" = target_user_id
          AND l."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_library ssl2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssl2."spaceId"
        WHERE ssl2."libraryId" = target_library_id
          AND ssm2."userId" = target_user_id
          AND ssl2."spaceId" <> exclude_space_id
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_library ssl3
        INNER JOIN shared_space ss3 ON ss3."id" = ssl3."spaceId"
        WHERE ssl3."libraryId" = target_library_id
          AND ss3."createdById" = target_user_id
          AND ssl3."spaceId" <> exclude_space_id
      );
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_delete_library_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- BEFORE DELETE row-level trigger so shared_space_library and
      -- shared_space_member rows for this space are still visible. The companion
      -- shared_space_library_delete_audit and shared_space_member_delete_library_audit
      -- AFTER triggers skip on cascade (their EXISTS shared_space guards fail), so
      -- this BEFORE-row trigger is the single source of truth for library_audit
      -- emission on whole-space deletion.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT DISTINCT "libraryId", "userId" FROM (
        SELECT ssl."libraryId", ssm."userId"
        FROM shared_space_library ssl
        INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssl."spaceId"
        WHERE ssl."spaceId" = OLD."id"
          AND NOT user_has_library_path(ssl."libraryId", ssm."userId", OLD."id")
        UNION
        SELECT ssl."libraryId", OLD."createdById"
        FROM shared_space_library ssl
        WHERE ssl."spaceId" = OLD."id"
          AND NOT user_has_library_path(ssl."libraryId", OLD."createdById", OLD."id")
      ) AS targets;

      RETURN OLD;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_library_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- 1. Always record the join-row delete so clients drop sharedSpaceLibraryEntity.
      INSERT INTO shared_space_library_audit ("spaceId", "libraryId")
      SELECT "spaceId", "libraryId" FROM "old";

      -- 2. Fan out library_audit per affected member only if no other path remains.
      --    Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row
      --    shared_space_delete_library_audit trigger handles that case.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT o."libraryId", ssm."userId"
      FROM "old" o
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_library_path(o."libraryId", ssm."userId", o."spaceId");

      -- 3. Creator of the unlinked space. INNER JOIN shared_space naturally skips
      --    during shared_space cascade because the parent row is gone.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT o."libraryId", ss."createdById"
      FROM "old" o
      INNER JOIN shared_space ss ON ss."id" = o."spaceId"
      WHERE NOT user_has_library_path(o."libraryId", ss."createdById", o."spaceId");

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_member_delete_library_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row
      -- shared_space_delete_library_audit trigger handles that case.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT ssl."libraryId", o."userId"
      FROM "old" o
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_library_path(ssl."libraryId", o."userId", o."spaceId");

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION asset_library_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_asset_audit ("assetId", "libraryId")
      SELECT "id", "libraryId" FROM "old" WHERE "libraryId" IS NOT NULL;
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_delete_library_audit"
  BEFORE DELETE ON "shared_space"
  FOR EACH ROW
  EXECUTE FUNCTION shared_space_delete_library_audit();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "asset_library_delete_audit"
  AFTER DELETE ON "asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN (pg_trigger_depth() <= 1)
  EXECUTE FUNCTION asset_library_delete_audit();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_library_delete_audit"
  AFTER DELETE ON "shared_space_library"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_library_delete_audit();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_delete_library_audit"
  AFTER DELETE ON "shared_space_member"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_delete_library_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_user_has_library_path', '{"type":"function","name":"user_has_library_path","sql":"CREATE OR REPLACE FUNCTION user_has_library_path(target_library_id uuid, target_user_id uuid, exclude_space_id uuid)\\n  RETURNS boolean\\n  STABLE LANGUAGE SQL\\n  AS $$\\n    SELECT\\n      EXISTS (\\n        SELECT 1 FROM library l\\n        WHERE l.\\"id\\" = target_library_id\\n          AND l.\\"ownerId\\" = target_user_id\\n          AND l.\\"deletedAt\\" IS NULL\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_library ssl2\\n        INNER JOIN shared_space_member ssm2 ON ssm2.\\"spaceId\\" = ssl2.\\"spaceId\\"\\n        WHERE ssl2.\\"libraryId\\" = target_library_id\\n          AND ssm2.\\"userId\\" = target_user_id\\n          AND ssl2.\\"spaceId\\" <> exclude_space_id\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_library ssl3\\n        INNER JOIN shared_space ss3 ON ss3.\\"id\\" = ssl3.\\"spaceId\\"\\n        WHERE ssl3.\\"libraryId\\" = target_library_id\\n          AND ss3.\\"createdById\\" = target_user_id\\n          AND ssl3.\\"spaceId\\" <> exclude_space_id\\n      );\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_delete_library_audit', '{"type":"function","name":"shared_space_delete_library_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_delete_library_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- BEFORE DELETE row-level trigger so shared_space_library and\\n      -- shared_space_member rows for this space are still visible. The companion\\n      -- shared_space_library_delete_audit and shared_space_member_delete_library_audit\\n      -- AFTER triggers skip on cascade (their EXISTS shared_space guards fail), so\\n      -- this BEFORE-row trigger is the single source of truth for library_audit\\n      -- emission on whole-space deletion.\\n      INSERT INTO library_audit (\\"libraryId\\", \\"userId\\")\\n      SELECT DISTINCT \\"libraryId\\", \\"userId\\" FROM (\\n        SELECT ssl.\\"libraryId\\", ssm.\\"userId\\"\\n        FROM shared_space_library ssl\\n        INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ssl.\\"spaceId\\"\\n        WHERE ssl.\\"spaceId\\" = OLD.\\"id\\"\\n          AND NOT user_has_library_path(ssl.\\"libraryId\\", ssm.\\"userId\\", OLD.\\"id\\")\\n        UNION\\n        SELECT ssl.\\"libraryId\\", OLD.\\"createdById\\"\\n        FROM shared_space_library ssl\\n        WHERE ssl.\\"spaceId\\" = OLD.\\"id\\"\\n          AND NOT user_has_library_path(ssl.\\"libraryId\\", OLD.\\"createdById\\", OLD.\\"id\\")\\n      ) AS targets;\\n\\n      RETURN OLD;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_library_delete_audit', '{"type":"function","name":"shared_space_library_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_library_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- 1. Always record the join-row delete so clients drop sharedSpaceLibraryEntity.\\n      INSERT INTO shared_space_library_audit (\\"spaceId\\", \\"libraryId\\")\\n      SELECT \\"spaceId\\", \\"libraryId\\" FROM \\"old\\";\\n\\n      -- 2. Fan out library_audit per affected member only if no other path remains.\\n      --    Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row\\n      --    shared_space_delete_library_audit trigger handles that case.\\n      INSERT INTO library_audit (\\"libraryId\\", \\"userId\\")\\n      SELECT o.\\"libraryId\\", ssm.\\"userId\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = o.\\"spaceId\\"\\n      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o.\\"spaceId\\")\\n        AND NOT user_has_library_path(o.\\"libraryId\\", ssm.\\"userId\\", o.\\"spaceId\\");\\n\\n      -- 3. Creator of the unlinked space. INNER JOIN shared_space naturally skips\\n      --    during shared_space cascade because the parent row is gone.\\n      INSERT INTO library_audit (\\"libraryId\\", \\"userId\\")\\n      SELECT o.\\"libraryId\\", ss.\\"createdById\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space ss ON ss.\\"id\\" = o.\\"spaceId\\"\\n      WHERE NOT user_has_library_path(o.\\"libraryId\\", ss.\\"createdById\\", o.\\"spaceId\\");\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_delete_library_audit', '{"type":"function","name":"shared_space_member_delete_library_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_member_delete_library_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row\\n      -- shared_space_delete_library_audit trigger handles that case.\\n      INSERT INTO library_audit (\\"libraryId\\", \\"userId\\")\\n      SELECT ssl.\\"libraryId\\", o.\\"userId\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space_library ssl ON ssl.\\"spaceId\\" = o.\\"spaceId\\"\\n      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o.\\"spaceId\\")\\n        AND NOT user_has_library_path(ssl.\\"libraryId\\", o.\\"userId\\", o.\\"spaceId\\");\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_asset_library_delete_audit', '{"type":"function","name":"asset_library_delete_audit","sql":"CREATE OR REPLACE FUNCTION asset_library_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_asset_audit (\\"assetId\\", \\"libraryId\\")\\n      SELECT \\"id\\", \\"libraryId\\" FROM \\"old\\" WHERE \\"libraryId\\" IS NOT NULL;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_delete_library_audit', '{"type":"trigger","name":"shared_space_delete_library_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_delete_library_audit\\"\\n  BEFORE DELETE ON \\"shared_space\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION shared_space_delete_library_audit();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_library_delete_audit', '{"type":"trigger","name":"asset_library_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"asset_library_delete_audit\\"\\n  AFTER DELETE ON \\"asset\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  WHEN (pg_trigger_depth() <= 1)\\n  EXECUTE FUNCTION asset_library_delete_audit();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_library_delete_audit', '{"type":"trigger","name":"shared_space_library_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_library_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_library\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_library_delete_audit();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_delete_library_audit', '{"type":"trigger","name":"shared_space_member_delete_library_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_delete_library_audit\\"\\n  AFTER DELETE ON \\"shared_space_member\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_delete_library_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_user_has_library_path',
    'function_shared_space_delete_library_audit',
    'function_shared_space_library_delete_audit',
    'function_shared_space_member_delete_library_audit',
    'function_asset_library_delete_audit',
    'trigger_shared_space_delete_library_audit',
    'trigger_asset_library_delete_audit',
    'trigger_shared_space_library_delete_audit',
    'trigger_shared_space_member_delete_library_audit'
  )`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_delete_library_audit" ON "shared_space_member"`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_library_delete_audit" ON "shared_space_library"`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_delete_library_audit" ON "shared_space"`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "asset_library_delete_audit" ON "asset"`.execute(db);
  // Trigger functions must drop before user_has_library_path since they reference it.
  await sql`DROP FUNCTION IF EXISTS shared_space_delete_library_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_library_delete_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_delete_library_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS asset_library_delete_audit()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS user_has_library_path(uuid, uuid, uuid)`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_library_audit"`.execute(db);
  await sql`DROP TABLE IF EXISTS "library_asset_audit"`.execute(db);
  await sql`DROP TABLE IF EXISTS "library_audit"`.execute(db);
}
