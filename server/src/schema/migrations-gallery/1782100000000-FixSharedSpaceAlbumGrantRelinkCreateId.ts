import { Kysely, sql } from 'kysely';

// Slice 8 (albums-9): re-linking an album whose grant survived via another path
// reused the original createId (ON CONFLICT DO NOTHING), so a client past that
// checkpoint got no backfill and missed assets added while unlinked. Refresh the
// createId on conflict so getCreatedAfter re-delivers.
//
// Only the re-link create-side trigger (shared_space_album INSERT) is changed here;
// shared_space_member_after_insert_album (member-join) kept DO NOTHING until
// 1783700000000 (#752 launch review F-A) fixed the identical bug on that trigger.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT (\\"userId\\", \\"albumId\\")\\n      DO UPDATE SET \\"createId\\" = immich_uuid_v7(), \\"createdAt\\" = now();\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"albumId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_album_after_insert_user';`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
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

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"shared_space_album_after_insert_user","sql":"CREATE OR REPLACE FUNCTION shared_space_album_after_insert_user()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_user (\\"userId\\", \\"albumId\\")\\n      SELECT DISTINCT ssm.\\"userId\\", ir.\\"albumId\\"\\n      FROM inserted_rows ir\\n      INNER JOIN shared_space_member ssm ON ssm.\\"spaceId\\" = ir.\\"spaceId\\"\\n      ON CONFLICT DO NOTHING;\\n\\n      UPDATE album\\n      SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"albumId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_shared_space_album_after_insert_user';`.execute(db);
}
