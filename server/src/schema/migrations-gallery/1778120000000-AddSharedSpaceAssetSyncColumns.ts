import { Kysely, sql } from 'kysely';

// Adds createId/createdAt/updateId/updatedAt columns to shared_space_asset so that
// SharedSpaceAssetSync / SharedSpaceAssetExifSync / SharedSpaceToAssetSync can use
// the standard BaseSync helpers, which key off updateId for incremental sync.
//
// Mirrors the same pattern as 1778110000000-AddSharedSpaceMemberSyncColumns.ts.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space_asset" ADD COLUMN "createId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" ADD COLUMN "createdAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_asset" ADD COLUMN "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_asset_createId_idx" ON "shared_space_asset" ("createId");`.execute(db);
  await sql`CREATE INDEX "shared_space_asset_updateId_idx" ON "shared_space_asset" ("updateId");`.execute(db);

  // Backfill `createdAt` from the existing `addedAt` column.
  await sql`UPDATE "shared_space_asset" SET "createdAt" = "addedAt";`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_asset_updatedAt"
  BEFORE UPDATE ON "shared_space_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  // Schema-tools migration_overrides — sql lifted via `pnpm migrations:debug`.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_asset_updatedAt', '{"type":"trigger","name":"shared_space_asset_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_asset_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_asset\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_asset_updatedAt';`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_asset_updatedAt" ON "shared_space_asset";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_asset_updateId_idx";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_asset_createId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" DROP COLUMN IF EXISTS "updatedAt";`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" DROP COLUMN IF EXISTS "updateId";`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" DROP COLUMN IF EXISTS "createdAt";`.execute(db);
  await sql`ALTER TABLE "shared_space_asset" DROP COLUMN IF EXISTS "createId";`.execute(db);
}
