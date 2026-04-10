import { Kysely, sql } from 'kysely';

// Adds createId to the upstream `library` table and createId/updateId/updatedAt
// to the `shared_space_library` join table so LibrarySync and SharedSpaceLibrarySync
// can use the standard BaseSync.upsertQuery / backfillQuery helpers, which key off
// updateId for incremental sync and createId for backfill enumeration. Mirrors
// 1778110000000-AddSharedSpaceMemberSyncColumns for shared_space_member.

export async function up(db: Kysely<any>): Promise<void> {
  // library: only createId is missing. updateId/updatedAt and the library_updatedAt
  // trigger already exist from upstream (migrations/1752267649968-StandardizeNames).
  await sql`ALTER TABLE "library" ADD COLUMN "createId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`CREATE INDEX "library_createId_idx" ON "library" ("createId");`.execute(db);

  // shared_space_library: needs the full set. createdAt already exists (from the
  // table definition); add createId, updateId, updatedAt + the standard updated_at
  // trigger. There is no after_insert trigger because parent updateId bumping is
  // not required — clients pull the new join row directly via SharedSpaceLibrarySync.
  await sql`ALTER TABLE "shared_space_library" ADD COLUMN "createId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_library" ADD COLUMN "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_library" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_library_createId_idx" ON "shared_space_library" ("createId");`.execute(db);
  await sql`CREATE INDEX "shared_space_library_updateId_idx" ON "shared_space_library" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_library_updatedAt"
  BEFORE UPDATE ON "shared_space_library"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  // Schema-tools migration_overrides — sql lifted via `pnpm migrations:debug` after
  // adding the matching @UpdatedAtTrigger declaration on shared-space-library.table.ts.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_library_updatedAt', '{"type":"trigger","name":"shared_space_library_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_library_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_library\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_library_updatedAt';`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_library_updatedAt" ON "shared_space_library";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_library_updateId_idx";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_library_createId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_space_library" DROP COLUMN IF EXISTS "updatedAt";`.execute(db);
  await sql`ALTER TABLE "shared_space_library" DROP COLUMN IF EXISTS "updateId";`.execute(db);
  await sql`ALTER TABLE "shared_space_library" DROP COLUMN IF EXISTS "createId";`.execute(db);
  await sql`DROP INDEX IF EXISTS "library_createId_idx";`.execute(db);
  await sql`ALTER TABLE "library" DROP COLUMN IF EXISTS "createId";`.execute(db);
}
