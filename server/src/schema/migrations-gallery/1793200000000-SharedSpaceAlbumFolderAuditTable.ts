import { Kysely, sql } from 'kysely';

// Space album folders (mobile parity) Task 1 — sync substrate for folder deletes.
//
// Create shared_space_album_folder_audit + a statement-level AFTER-DELETE trigger on
// shared_space_album_folder that tombstones every deleted folder (explicit delete + FK cascade
// from a shared_space delete), driving SharedSpaceAlbumFolderSync.getDeletes (Task 2). Simpler
// than shared_space_album_delete_audit — folders carry no per-member grants, so the trigger only
// inserts the tombstone row.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_album_folder_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7() PRIMARY KEY,
      "spaceId"   uuid NOT NULL,
      "folderId"  uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp()
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_folder_audit_spaceId_idx" ON "shared_space_album_folder_audit" ("spaceId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_audit_folderId_idx" ON "shared_space_album_folder_audit" ("folderId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_audit_deletedAt_idx" ON "shared_space_album_folder_audit" ("deletedAt");`.execute(
    db,
  );

  await sql`CREATE OR REPLACE FUNCTION shared_space_album_folder_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_folder_audit ("spaceId", "folderId")
      SELECT "spaceId", "id" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_folder_delete_audit"
  AFTER DELETE ON "shared_space_album_folder"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_album_folder_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_album_folder_delete_audit', '{"type":"function","name":"shared_space_album_folder_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_album_folder_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_folder_audit (\\"spaceId\\", \\"folderId\\")\\n      SELECT \\"spaceId\\", \\"id\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_folder_delete_audit', '{"type":"trigger","name":"shared_space_album_folder_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_folder_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_album_folder\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_album_folder_delete_audit();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_shared_space_album_folder_delete_audit',
    'trigger_shared_space_album_folder_delete_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_folder_delete_audit" ON "shared_space_album_folder";`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS shared_space_album_folder_delete_audit();`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_folder_audit";`.execute(db);
}
