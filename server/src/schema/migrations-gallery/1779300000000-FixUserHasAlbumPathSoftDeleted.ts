import { Kysely, sql } from 'kysely';

// RBAC F2: fix user_has_album_path() to exclude soft-deleted albums from
// branches 2 (member in another space) and 3 (creator of another space).
//
// Previously, branches 2 and 3 joined shared_space_album without checking
// album.deletedAt, so a soft-deleted album still linked to another space was
// treated as a valid access path. This caused under-revocation: grants were
// retained even after the album was soft-deleted.
//
// Fix: add INNER JOIN album + AND a."deletedAt" IS NULL to branches 2 and 3,
// matching the existing check already present in branch 1 (album_user).

export async function up(db: Kysely<any>): Promise<void> {
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
        INNER JOIN album a2 ON a2."id" = ssa2."albumId"
        WHERE ssa2."albumId" = target_album_id
          AND ssm2."userId" = target_user_id
          AND ssa2."spaceId" <> exclude_space_id
          AND a2."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa3
        INNER JOIN shared_space ss3 ON ss3."id" = ssa3."spaceId"
        INNER JOIN album a3 ON a3."id" = ssa3."albumId"
        WHERE ssa3."albumId" = target_album_id
          AND ss3."createdById" = target_user_id
          AND ssa3."spaceId" <> exclude_space_id
          AND a3."deletedAt" IS NULL
      );
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"user_has_album_path","sql":"CREATE OR REPLACE FUNCTION user_has_album_path(target_album_id uuid, target_user_id uuid, exclude_space_id uuid)\\n  RETURNS boolean\\n  STABLE LANGUAGE SQL\\n  AS $$\\n    SELECT\\n      EXISTS (\\n        SELECT 1 FROM album_user au\\n        INNER JOIN album a ON a.\\"id\\" = au.\\"albumId\\"\\n        WHERE au.\\"albumId\\" = target_album_id\\n          AND au.\\"userId\\" = target_user_id\\n          AND a.\\"deletedAt\\" IS NULL\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa2\\n        INNER JOIN shared_space_member ssm2 ON ssm2.\\"spaceId\\" = ssa2.\\"spaceId\\"\\n        INNER JOIN album a2 ON a2.\\"id\\" = ssa2.\\"albumId\\"\\n        WHERE ssa2.\\"albumId\\" = target_album_id\\n          AND ssm2.\\"userId\\" = target_user_id\\n          AND ssa2.\\"spaceId\\" <> exclude_space_id\\n          AND a2.\\"deletedAt\\" IS NULL\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa3\\n        INNER JOIN shared_space ss3 ON ss3.\\"id\\" = ssa3.\\"spaceId\\"\\n        INNER JOIN album a3 ON a3.\\"id\\" = ssa3.\\"albumId\\"\\n        WHERE ssa3.\\"albumId\\" = target_album_id\\n          AND ss3.\\"createdById\\" = target_user_id\\n          AND ssa3.\\"spaceId\\" <> exclude_space_id\\n          AND a3.\\"deletedAt\\" IS NULL\\n      );\\n  $$;"}'::jsonb
  WHERE "name" = 'function_user_has_album_path';`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Restore the previous (buggy) definition that lacked the deletedAt checks on
  // branches 2 and 3. Mirrors the body originally installed by migration
  // 1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts.
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

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"user_has_album_path","sql":"CREATE OR REPLACE FUNCTION user_has_album_path(target_album_id uuid, target_user_id uuid, exclude_space_id uuid)\\n  RETURNS boolean\\n  STABLE LANGUAGE SQL\\n  AS $$\\n    SELECT\\n      EXISTS (\\n        SELECT 1 FROM album_user au\\n        INNER JOIN album a ON a.\\"id\\" = au.\\"albumId\\"\\n        WHERE au.\\"albumId\\" = target_album_id\\n          AND au.\\"userId\\" = target_user_id\\n          AND a.\\"deletedAt\\" IS NULL\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa2\\n        INNER JOIN shared_space_member ssm2 ON ssm2.\\"spaceId\\" = ssa2.\\"spaceId\\"\\n        WHERE ssa2.\\"albumId\\" = target_album_id\\n          AND ssm2.\\"userId\\" = target_user_id\\n          AND ssa2.\\"spaceId\\" <> exclude_space_id\\n      )\\n      OR EXISTS (\\n        SELECT 1\\n        FROM shared_space_album ssa3\\n        INNER JOIN shared_space ss3 ON ss3.\\"id\\" = ssa3.\\"spaceId\\"\\n        WHERE ssa3.\\"albumId\\" = target_album_id\\n          AND ss3.\\"createdById\\" = target_user_id\\n          AND ssa3.\\"spaceId\\" <> exclude_space_id\\n      );\\n  $$;"}'::jsonb
  WHERE "name" = 'function_user_has_album_path';`.execute(db);
}
