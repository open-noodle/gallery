import { Kysely, sql } from 'kysely';

// Adds the create-side mirror of library_audit: a denormalized (userId, libraryId)
// access-grant table with a per-user createId. Drives LibrarySync.getCreatedAfter
// so users who gain access to pre-existing libraries via shared-space links
// correctly receive the library metadata and its asset backfill on next sync.
//
// See docs/plans/2026-04-11-library-user-access-backfill-design.md for the full
// design, trade-offs, and rationale.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "library_user" (
      "userId"    uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "libraryId" uuid NOT NULL REFERENCES "library"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "library_user_pkey" PRIMARY KEY ("userId", "libraryId")
    );
  `.execute(db);

  // Hot-path index: LibrarySync.getCreatedAfter filters by userId then createId,
  // so a composite leading with userId lets the planner seek directly to the
  // user's slice and walk sorted. PK (userId, libraryId) doesn't serve this
  // query because it's ordered on the wrong column.
  await sql`CREATE INDEX "library_user_userId_createId_idx" ON "library_user" ("userId", "createId");`.execute(db);

  // --- Create-side triggers ---

  // library_after_insert: populate library_user for the library owner at
  // library creation. Explicitly propagates library.createId/createdAt rather
  // than letting the defaults mint fresh values, so existing clients' sync
  // checkpoints (already past library.createId) don't retrigger a completed
  // backfill for freshly-created owned libraries.
  await sql`CREATE OR REPLACE FUNCTION library_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "library_after_insert"
  AFTER INSERT ON "library"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION library_after_insert();`.execute(db);

  // migration_overrides entries so sql-tools' schema diff recognizes these
  // objects. Pattern lifted from 1778200000000-LibraryAuditTables.ts.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_library_after_insert', '{"type":"function","name":"library_after_insert","sql":"CREATE OR REPLACE FUNCTION library_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\", \\"createId\\", \\"createdAt\\")\\n      SELECT \\"ownerId\\", \\"id\\", \\"createId\\", \\"createdAt\\"\\n      FROM inserted_rows\\n      WHERE \\"ownerId\\" IS NOT NULL AND \\"deletedAt\\" IS NULL\\n      ON CONFLICT DO NOTHING;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_library_after_insert', '{"type":"trigger","name":"library_after_insert","sql":"CREATE OR REPLACE TRIGGER \\"library_after_insert\\"\\n  AFTER INSERT ON \\"library\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION library_after_insert();"}'::jsonb);`.execute(
    db,
  );

  // shared_space_member_after_insert_library: when a user joins a space,
  // grant library_user for every library linked to that space and bump
  // library.updateId so the library metadata row re-emits on next sync.
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert_library()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ir."userId", ssl."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssl."libraryId"
        FROM inserted_rows ir
        INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_after_insert_library"
  AFTER INSERT ON "shared_space_member"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_after_insert_library();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_after_insert_library', '{"type":"function","name":"shared_space_member_after_insert_library","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert_library()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\")\\n      SELECT DISTINCT ir.\\"userId\\", ssl.\\"libraryId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_library ssl ON ssl.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE library\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (\\n        SELECT DISTINCT ssl.\\"libraryId\\"\\n        FROM inserted_rows ir\\n        INNER JOIN shared_space_library ssl ON ssl.\\"spaceId\\" = ir.\\"spaceId\\"\\n      );\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_after_insert_library', '{"type":"trigger","name":"shared_space_member_after_insert_library","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_after_insert_library\\"\\n  AFTER INSERT ON \\"shared_space_member\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_after_insert_library();"}'::jsonb);`.execute(
    db,
  );

  // shared_space_library_after_insert_user: on library link, grant library_user
  // for every current member and bump library.updateId.
  await sql`CREATE OR REPLACE FUNCTION shared_space_library_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ssm."userId", ir."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "libraryId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_library_after_insert_user"
  AFTER INSERT ON "shared_space_library"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_library_after_insert_user();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_library_after_insert_user', '{"type":"function","name":"shared_space_library_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_library_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"libraryId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE library\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"libraryId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_library_after_insert_user', '{"type":"trigger","name":"shared_space_library_after_insert_user","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_library_after_insert_user\\"\\n  AFTER INSERT ON \\"shared_space_library\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_library_after_insert_user();"}'::jsonb);`.execute(
    db,
  );

  // --- Delete-side consumer ---
  //
  // library_user_delete_after_audit: when library_audit rows land, delete the
  // corresponding library_user rows UNCONDITIONALLY. Trusts the gating at
  // insertion time (every inserter gates on NOT user_has_library_path(...,
  // excludeSpaceId)). Re-checking here with NULL would be BROKEN during
  // shared_space hard-delete because the BEFORE DELETE trigger fires before
  // FK cascades run. See design doc.
  await sql`CREATE OR REPLACE FUNCTION library_user_delete_after_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      DELETE FROM library_user lu
      USING inserted_rows ir
      WHERE lu."userId" = ir."userId"
        AND lu."libraryId" = ir."libraryId";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "library_user_delete_after_audit"
  AFTER INSERT ON "library_audit"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION library_user_delete_after_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_library_user_delete_after_audit', '{"type":"function","name":"library_user_delete_after_audit","sql":"CREATE OR REPLACE FUNCTION library_user_delete_after_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      DELETE FROM library_user lu\\n      USING inserted_rows ir\\n      WHERE lu.\\"userId\\" = ir.\\"userId\\"\\n        AND lu.\\"libraryId\\" = ir.\\"libraryId\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_library_user_delete_after_audit', '{"type":"trigger","name":"library_user_delete_after_audit","sql":"CREATE OR REPLACE TRIGGER \\"library_user_delete_after_audit\\"\\n  AFTER INSERT ON \\"library_audit\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION library_user_delete_after_audit();"}'::jsonb);`.execute(
    db,
  );

  // --- Backfill from current state ---
  //
  // Pass 1: owned libraries inherit library.createId/createdAt so existing
  // synced clients don't re-backfill libraries they already have.
  await sql`
    INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
    SELECT "ownerId", "id", "createId", "createdAt"
    FROM library
    WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
    ON CONFLICT ("userId", "libraryId") DO NOTHING;
  `.execute(db);

  // Pass 2: transitive access via shared_space_library with fresh createIds
  // so users in the broken state get their missing libraries re-delivered on
  // next sync. Soft-deleted libraries are deliberately INCLUDED here —
  // matches accessibleLibraries' space-link branch behavior.
  await sql`
    INSERT INTO library_user ("userId", "libraryId")
    SELECT DISTINCT ssm."userId", ssl."libraryId"
    FROM shared_space_library ssl
    INNER JOIN shared_space_member ssm ON ssl."spaceId" = ssm."spaceId"
    ON CONFLICT ("userId", "libraryId") DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_library_after_insert',
    'trigger_library_after_insert',
    'function_shared_space_member_after_insert_library',
    'trigger_shared_space_member_after_insert_library',
    'function_shared_space_library_after_insert_user',
    'trigger_shared_space_library_after_insert_user',
    'function_library_user_delete_after_audit',
    'trigger_library_user_delete_after_audit'
  )`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "library_user_delete_after_audit" ON "library_audit";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS library_user_delete_after_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_library_after_insert_user" ON "shared_space_library";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_library_after_insert_user();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_after_insert_library" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_after_insert_library();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "library_after_insert" ON "library";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS library_after_insert();`.execute(db);
  await sql`DROP INDEX IF EXISTS "library_user_userId_createId_idx";`.execute(db);
  await sql`DROP TABLE IF EXISTS "library_user";`.execute(db);
}
