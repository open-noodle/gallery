import { Kysely, sql } from 'kysely';

// Phase 2A slice A3: delete-side triggers for shared_space_album_user grants.
//
// Four PL/pgSQL functions + four triggers:
//   - shared_space_album_user_delete_after_audit: AFTER INSERT on
//     shared_space_album_user_audit; consumer that deletes the matching grant row.
//   - shared_space_album_delete_audit: AFTER DELETE on shared_space_album; fan-out
//     that writes the link audit (ungated) and the gated grant audit.
//   - shared_space_member_delete_album_audit: AFTER DELETE on shared_space_member;
//     fan-out that writes only the gated grant audit.
//   - shared_space_delete_album_audit: BEFORE DELETE on shared_space (row-level);
//     fan-out for whole-space deletes so member/album rows are still visible.
//
// Mirrors the library delete-side blueprint (1778300000000-AddLibraryUserTable.ts)
// with album instead of library and the album audit-table column shapes.

export async function up(db: Kysely<any>): Promise<void> {
  // Consumer: when a shared_space_album_user_audit row is inserted, delete the
  // corresponding shared_space_album_user grant row unconditionally. Trusts the
  // gate at insertion time — every path that inserts into
  // shared_space_album_user_audit already checks NOT user_has_album_path(...).
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_user_delete_after_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      DELETE FROM shared_space_album_user ssau
      USING inserted_rows ir
      WHERE ssau."userId" = ir."userId"
        AND ssau."albumId" = ir."albumId";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_user_delete_after_audit"
  AFTER INSERT ON "shared_space_album_user_audit"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_album_user_delete_after_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_album_user_delete_after_audit', '{"type":"function","name":"shared_space_album_user_delete_after_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_album_user_delete_after_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      DELETE FROM shared_space_album_user ssau\\n      USING inserted_rows ir\\n      WHERE ssau.\\"userId\\" = ir.\\"userId\\"\\n        AND ssau.\\"albumId\\" = ir.\\"albumId\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_user_delete_after_audit', '{"type":"trigger","name":"shared_space_album_user_delete_after_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_user_delete_after_audit\\"\\n  AFTER INSERT ON \\"shared_space_album_user_audit\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_album_user_delete_after_audit();"}'::jsonb);`.execute(
    db,
  );

  // Fan-out: when an album is unlinked from a space (or cascade from
  // album/shared_space deletion), section 1 writes the link audit unconditionally;
  // sections 2+3 write the gated grant audit, skipping during whole-space delete
  // (BEFORE-row trigger owns it then).
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      -- 1. Always record the (space, album) link delete (ungated) so clients drop the space-album.
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT "spaceId", "albumId" FROM "old";

      -- 2. Gated grant revocation per member; skips during shared_space cascade (BEFORE-row handles it).
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ssm."userId"
      FROM "old" o
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(o."albumId", ssm."userId", o."spaceId");

      -- 3. Gated grant revocation for the space creator.
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ss."createdById"
      FROM "old" o
      INNER JOIN shared_space ss ON ss."id" = o."spaceId"
      WHERE NOT user_has_album_path(o."albumId", ss."createdById", o."spaceId");

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_delete_audit"
  AFTER DELETE ON "shared_space_album"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_album_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_album_delete_audit', '{"type":"function","name":"shared_space_album_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_album_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- 1. Always record the (space, album) link delete (ungated) so clients drop the space-album.\\n      INSERT INTO shared_space_album_audit (\\"spaceId\\", \\"albumId\\")\\n      SELECT \\"spaceId\\", \\"albumId\\" FROM \\"old\\";\\n\\n      -- 2. Gated grant revocation per member; skips during shared_space cascade (BEFORE-row handles it).\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT o.\\"albumId\\", ssm.\\"userId\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = o.\\"spaceId\\"\\n      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o.\\"spaceId\\")\\n        AND NOT user_has_album_path(o.\\"albumId\\", ssm.\\"userId\\", o.\\"spaceId\\");\\n\\n      -- 3. Gated grant revocation for the space creator.\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT o.\\"albumId\\", ss.\\"createdById\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space ss ON ss.\\"id\\" = o.\\"spaceId\\"\\n      WHERE NOT user_has_album_path(o.\\"albumId\\", ss.\\"createdById\\", o.\\"spaceId\\");\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_delete_audit', '{"type":"trigger","name":"shared_space_album_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_album\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_album_delete_audit();"}'::jsonb);`.execute(
    db,
  );

  // Fan-out: when a member leaves a space, revoke album grants for all albums
  // linked to that space, gated. No link audit — the album-space link persists.
  // Skips during whole-space cascade (EXISTS guard fails).
  await sql`CREATE OR REPLACE FUNCTION shared_space_member_delete_album_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssa."albumId", o."userId"
      FROM "old" o
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(ssa."albumId", o."userId", o."spaceId");
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_delete_album_audit"
  AFTER DELETE ON "shared_space_member"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_delete_album_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_delete_album_audit', '{"type":"function","name":"shared_space_member_delete_album_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_member_delete_album_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT ssa.\\"albumId\\", o.\\"userId\\"\\n      FROM \\"old\\" o\\n      INNER JOIN shared_space_album ssa ON ssa.\\"spaceId\\" = o.\\"spaceId\\"\\n      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o.\\"spaceId\\")\\n        AND NOT user_has_album_path(ssa.\\"albumId\\", o.\\"userId\\", o.\\"spaceId\\");\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_delete_album_audit', '{"type":"trigger","name":"shared_space_member_delete_album_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_delete_album_audit\\"\\n  AFTER DELETE ON \\"shared_space_member\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_delete_album_audit();"}'::jsonb);`.execute(
    db,
  );

  // BEFORE DELETE row-level trigger on shared_space: fires before FK cascades
  // remove shared_space_album and shared_space_member rows, so this is the
  // single source of truth for grant revocation on whole-space deletion.
  await sql`CREATE OR REPLACE FUNCTION shared_space_delete_album_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT DISTINCT "albumId", "userId" FROM (
        SELECT ssa."albumId", ssm."userId"
        FROM shared_space_album ssa
        INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", ssm."userId", OLD."id")
        UNION
        SELECT ssa."albumId", OLD."createdById"
        FROM shared_space_album ssa
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", OLD."createdById", OLD."id")
      ) AS targets;
      RETURN OLD;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_delete_album_audit"
  BEFORE DELETE ON "shared_space"
  FOR EACH ROW
  EXECUTE FUNCTION shared_space_delete_album_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_delete_album_audit', '{"type":"function","name":"shared_space_delete_album_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_delete_album_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT DISTINCT \\"albumId\\", \\"userId\\" FROM (\\n        SELECT ssa.\\"albumId\\", ssm.\\"userId\\"\\n        FROM shared_space_album ssa\\n        INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ssa.\\"spaceId\\"\\n        WHERE ssa.\\"spaceId\\" = OLD.\\"id\\"\\n          AND NOT user_has_album_path(ssa.\\"albumId\\", ssm.\\"userId\\", OLD.\\"id\\")\\n        UNION\\n        SELECT ssa.\\"albumId\\", OLD.\\"createdById\\"\\n        FROM shared_space_album ssa\\n        WHERE ssa.\\"spaceId\\" = OLD.\\"id\\"\\n          AND NOT user_has_album_path(ssa.\\"albumId\\", OLD.\\"createdById\\", OLD.\\"id\\")\\n      ) AS targets;\\n      RETURN OLD;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_delete_album_audit', '{"type":"trigger","name":"shared_space_delete_album_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_delete_album_audit\\"\\n  BEFORE DELETE ON \\"shared_space\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION shared_space_delete_album_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_shared_space_album_user_delete_after_audit',
    'trigger_shared_space_album_user_delete_after_audit',
    'function_shared_space_album_delete_audit',
    'trigger_shared_space_album_delete_audit',
    'function_shared_space_member_delete_album_audit',
    'trigger_shared_space_member_delete_album_audit',
    'function_shared_space_delete_album_audit',
    'trigger_shared_space_delete_album_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_delete_album_audit" ON "shared_space";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_delete_album_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_delete_album_audit" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_delete_album_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_delete_audit" ON "shared_space_album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_album_delete_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_user_delete_after_audit" ON "shared_space_album_user_audit";`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS shared_space_album_user_delete_after_audit();`.execute(db);
}
