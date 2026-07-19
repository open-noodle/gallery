import { Kysely, sql } from 'kysely';

// Slice 8: album soft-delete/restore trigger for the shared_space_album lifecycle.
// One AFTER UPDATE statement trigger on album, body-guarded to real deletedAt
// NULL<->NOT-NULL transitions. On soft-delete it revokes all shared_space_album_user
// grants (via shared_space_album_user_audit + the existing consumer) and tombstones
// the space->album links (shared_space_album_audit). On restore it re-creates the
// grants with fresh createId (ON CONFLICT DO UPDATE) and bumps shared_space_album.updateId.
//
// Mirrors the create/delete-side trigger migrations (1779100000000 / 1779200000000):
// CREATE OR REPLACE FUNCTION + CREATE OR REPLACE TRIGGER + a migration_overrides row
// per function and per trigger.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION album_soft_delete_shared_space_album()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE (o."deletedAt" IS NULL) <> (n."deletedAt" IS NULL)
      ) THEN
        RETURN NULL;
      END IF;

      -- soft-delete: revoke all grants for the trashed albums
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssau."albumId", ssau."userId"
      FROM shared_space_album_user ssau
      WHERE ssau."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- soft-delete: tombstone all space->album links for the trashed albums
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT ssa."spaceId", ssa."albumId"
      FROM shared_space_album ssa
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- restore: re-create grants for members of every space still linking each album
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ssa."albumId"
      FROM shared_space_album ssa
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      )
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      -- restore: bump shared_space_album.updateId so the link row re-delivers
      UPDATE shared_space_album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      );

      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "album_soft_delete_shared_space_album"
  AFTER UPDATE ON "album"
  REFERENCING OLD TABLE AS "old_rows" NEW TABLE AS "new_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_soft_delete_shared_space_album();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_soft_delete_shared_space_album', '{"type":"function","name":"album_soft_delete_shared_space_album","sql":"CREATE OR REPLACE FUNCTION album_soft_delete_shared_space_album()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      IF NOT EXISTS (\\n        SELECT 1\\n        FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE (o.\\"deletedAt\\" IS NULL) <> (n.\\"deletedAt\\" IS NULL)\\n      ) THEN\\n        RETURN NULL;\\n      END IF;\\n\\n      -- soft-delete: revoke all grants for the trashed albums\\n      INSERT INTO shared_space_album_user_audit (\\"albumId\\", \\"userId\\")\\n      SELECT ssau.\\"albumId\\", ssau.\\"userId\\"\\n      FROM shared_space_album_user ssau\\n      WHERE ssau.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NULL AND n.\\"deletedAt\\" IS NOT NULL\\n      );\\n\\n      -- soft-delete: tombstone all space->album links for the trashed albums\\n      INSERT INTO shared_space_album_audit (\\"spaceId\\", \\"albumId\\")\\n      SELECT ssa.\\"spaceId\\", ssa.\\"albumId\\"\\n      FROM shared_space_album ssa\\n      WHERE ssa.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NULL AND n.\\"deletedAt\\" IS NOT NULL\\n      );\\n\\n      -- restore: re-create grants for members of every space still linking each album\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ssa.\\"albumId\\"\\n      FROM shared_space_album ssa\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ssa.\\"spaceId\\"\\n      WHERE ssa.\\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NOT NULL AND n.\\"deletedAt\\" IS NULL\\n      )\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      -- restore: bump shared_space_album.updateId so the link row re-delivers\\n      UPDATE shared_space_album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"albumId\\" IN (\\n        SELECT n.\\"id\\" FROM new_rows n\\n        INNER JOIN old_rows o ON o.\\"id\\" = n.\\"id\\"\\n        WHERE o.\\"deletedAt\\" IS NOT NULL AND n.\\"deletedAt\\" IS NULL\\n      );\\n\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_soft_delete_shared_space_album', '{"type":"trigger","name":"album_soft_delete_shared_space_album","sql":"CREATE OR REPLACE TRIGGER \\"album_soft_delete_shared_space_album\\"\\n  AFTER UPDATE ON \\"album\\"\\n  REFERENCING OLD TABLE AS \\"old_rows\\" NEW TABLE AS \\"new_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION album_soft_delete_shared_space_album();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_album_soft_delete_shared_space_album',
    'trigger_album_soft_delete_shared_space_album'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "album_soft_delete_shared_space_album" ON "album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_soft_delete_shared_space_album();`.execute(db);
}
