import { Kysely, sql } from 'kysely';

// Phase 2A slice A2: user_has_album_path() SQL function + two create-side
// triggers that populate shared_space_album_user and bump album.updateId.
//
// Mirrors the library_user create-side blueprint (1778300000000-AddLibraryUserTable.ts)
// with album instead of library. The A1 migration (1779000000000) already created
// the shared_space_album_user table; this migration only adds functions/triggers.

export async function up(db: Kysely<any>): Promise<void> {
  // user_has_album_path: four-branch access-path function used by delete-side
  // triggers (A3) to gate audit emission. Also the canonical "does this user
  // have any access path to this album?" predicate for the sync subsystem.
  await sql`CREATE OR REPLACE FUNCTION user_has_album_path(target_album_id uuid, target_user_id uuid, exclude_space_id uuid)
  RETURNS boolean
  STABLE LANGUAGE SQL
  AS $$
    SELECT
      EXISTS (
        SELECT 1 FROM album_user au
        INNER JOIN album a ON a."id" = au."albumId"
        WHERE au."albumId" = target_album_id
          AND au."userId" = target_user_id
          AND a."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssa2."spaceId"
        WHERE ssa2."albumId" = target_album_id
          AND ssm2."userId" = target_user_id
          AND ssa2."spaceId" <> exclude_space_id
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa3
        INNER JOIN shared_space ss3 ON ss3."id" = ssa3."spaceId"
        WHERE ssa3."albumId" = target_album_id
          AND ss3."createdById" = target_user_id
          AND ssa3."spaceId" <> exclude_space_id
      );
  $$;`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_user_has_album_path', '{"type":"function","name":"user_has_album_path","sql":"CREATE OR REPLACE FUNCTION user_has_album_path(target_album_id uuid, target_user_id uuid, exclude_space_id uuid)\\n  RETURNS boolean\\n  STABLE LANGUAGE SQL\\n  AS $$\\n    SELECT\\n      EXISTS (\\n        SELECT 1 FROM album_user au\\n        INNER JOIN album a ON a.\\"id\\" = au.\\"albumId\\"\\n        WHERE au.\\"albumId\\" = target_album_id\\n          AND au.\\"userId\\" = target_user_id\\n          AND a.\\"deletedAt\\" IS NULL\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa2\\n        INNER JOIN shared_space_member ssm2 ON ssm2.\\"spaceId\\" = ssa2.\\"spaceId\\"\\n        WHERE ssa2.\\"albumId\\" = target_album_id\\n          AND ssm2.\\"userId\\" = target_user_id\\n          AND ssa2.\\"spaceId\\" <> exclude_space_id\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa3\\n        INNER JOIN shared_space ss3 ON ss3.\\"id\\" = ssa3.\\"spaceId\\"\\n        WHERE ssa3.\\"albumId\\" = target_album_id\\n          AND ss3.\\"createdById\\" = target_user_id\\n          AND ssa3.\\"spaceId\\" <> exclude_space_id\\n      );\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  // shared_space_album_after_insert_user: when an album is linked to a space,
  // grant shared_space_album_user for every current member of that space and
  // bump album.updateId so AlbumSync re-delivers the metadata row.
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_after_insert_user"
  AFTER INSERT ON "shared_space_album"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_album_after_insert_user();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_album_after_insert_user', '{"type":"function","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"albumId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_after_insert_user', '{"type":"trigger","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_after_insert_user\\"\\n  AFTER INSERT ON \\"shared_space_album\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_album_after_insert_user();"}'::jsonb);`.execute(
    db,
  );

  // shared_space_member_after_insert_album: when a user joins a space, grant
  // shared_space_album_user for every album already linked to that space and
  // bump album.updateId so AlbumSync re-delivers those metadata rows.
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

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

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_after_insert_album"
  AFTER INSERT ON "shared_space_member"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_after_insert_album();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_after_insert_album', '{"type":"function","name":"shared_space_member_after_insert_album","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ir.\\"userId\\", ssa.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (\\n        SELECT DISTINCT ssa.\\"albumId\\"\\n        FROM inserted_rows ir\\n        INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = ir.\\"spaceId\\"\\n      );\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_after_insert_album', '{"type":"trigger","name":"shared_space_member_after_insert_album","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_after_insert_album\\"\\n  AFTER INSERT ON \\"shared_space_member\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_after_insert_album();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_user_has_album_path',
    'function_shared_space_album_after_insert_user',
    'trigger_shared_space_album_after_insert_user',
    'function_shared_space_member_after_insert_album',
    'trigger_shared_space_member_after_insert_album'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_after_insert_album" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_after_insert_album();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_after_insert_user" ON "shared_space_album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_album_after_insert_user();`.execute(db);
  await sql`DROP FUNCTION IF EXISTS user_has_album_path(uuid, uuid, uuid);`.execute(db);
}
