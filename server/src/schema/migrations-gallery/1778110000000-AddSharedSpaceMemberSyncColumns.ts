import { Kysely, sql } from 'kysely';

// Adds createId/createdAt/updateId/updatedAt columns to shared_space_member so that
// SharedSpaceMemberSync can use the standard BaseSync.upsertQuery / backfillQuery
// helpers, which key off updateId for incremental sync. Also wires the standard
// updated_at trigger and an after-insert trigger that bumps the parent shared_space
// row's updateId so members joining a space cause the space row to re-emit.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space_member" ADD COLUMN "createId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_member" ADD COLUMN "createdAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_member" ADD COLUMN "updateId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_member" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL DEFAULT now();`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_member_createId_idx" ON "shared_space_member" ("createId");`.execute(db);
  await sql`CREATE INDEX "shared_space_member_updateId_idx" ON "shared_space_member" ("updateId");`.execute(db);

  // Backfill `createdAt` from the existing `joinedAt` column so existing rows have a
  // sensible creation timestamp. createId/updateId stay at their defaults (random
  // uuid_v7 from clock_timestamp()), which is fine for incremental sync.
  await sql`UPDATE "shared_space_member" SET "createdAt" = "joinedAt";`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION shared_space_member_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      UPDATE shared_space SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "spaceId" FROM inserted_rows);
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_updatedAt"
  BEFORE UPDATE ON "shared_space_member"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_member_after_insert"
  AFTER INSERT ON "shared_space_member"
  REFERENCING NEW TABLE AS "inserted_rows"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_member_after_insert();`.execute(db);

  // Schema-tools migration_overrides — sql lifted via `pnpm migrations:debug` after
  // adding the matching registerFunction + @TriggerFunction declarations.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_member_after_insert', '{"type":"function","name":"shared_space_member_after_insert","sql":"CREATE OR REPLACE FUNCTION shared_space_member_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      UPDATE shared_space SET \\"updatedAt\\" = clock_timestamp(), \\"updateId\\" = immich_uuid_v7(clock_timestamp())\\n      WHERE \\"id\\" IN (SELECT DISTINCT \\"spaceId\\" FROM inserted_rows);\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_updatedAt', '{"type":"trigger","name":"shared_space_member_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_member\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_member_after_insert', '{"type":"trigger","name":"shared_space_member_after_insert","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_member_after_insert\\"\\n  AFTER INSERT ON \\"shared_space_member\\"\\n  REFERENCING NEW TABLE AS \\"inserted_rows\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_member_after_insert();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_shared_space_member_after_insert',
    'trigger_shared_space_member_updatedAt',
    'trigger_shared_space_member_after_insert'
  )`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_after_insert" ON "shared_space_member";`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_updatedAt" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_after_insert();`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_member_updateId_idx";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_member_createId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_space_member" DROP COLUMN IF EXISTS "updatedAt";`.execute(db);
  await sql`ALTER TABLE "shared_space_member" DROP COLUMN IF EXISTS "updateId";`.execute(db);
  await sql`ALTER TABLE "shared_space_member" DROP COLUMN IF EXISTS "createdAt";`.execute(db);
  await sql`ALTER TABLE "shared_space_member" DROP COLUMN IF EXISTS "createId";`.execute(db);
}
