import { Kysely, sql } from 'kysely';

// gallery-fork (#1041): per-member "hide this album from MY timeline".
//
// Seeding is exported separately because a medium test cannot re-run `up()` (the DDL would
// conflict) but must still prove the seeding rule. See the migration spec.
export async function seedHiddenRowsFromSharedFlag(db: Kysely<unknown>): Promise<void> {
  // Preserve today's behaviour: an album currently hidden via the SHARED flag is hidden from every
  // member's personal timeline. Without this, those photos would APPEAR on upgrade — content
  // arriving unannounced reads as a leak even though no access boundary moved.
  await sql`
    INSERT INTO "shared_space_album_hidden" ("spaceId", "albumId", "userId")
    SELECT ssa."spaceId", ssa."albumId", ssm."userId"
    FROM "shared_space_album" ssa
    INNER JOIN "shared_space_member" ssm ON ssm."spaceId" = ssa."spaceId"
    WHERE ssa."showInTimeline" = false
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_album_hidden" (
      "spaceId" uuid NOT NULL,
      "albumId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "shared_space_album_hidden_pkey" PRIMARY KEY ("spaceId", "albumId", "userId"),
      CONSTRAINT "shared_space_album_hidden_spaceId_albumId_fkey"
        FOREIGN KEY ("spaceId", "albumId")
        REFERENCES "shared_space_album" ("spaceId", "albumId") ON UPDATE NO ACTION ON DELETE CASCADE,
      CONSTRAINT "shared_space_album_hidden_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "shared_space_album_hidden_spaceId_albumId_idx" ON "shared_space_album_hidden" ("spaceId", "albumId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_albumId_idx" ON "shared_space_album_hidden" ("albumId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_userId_idx" ON "shared_space_album_hidden" ("userId")`.execute(db);
  await sql`CREATE INDEX "shared_space_album_hidden_createId_idx" ON "shared_space_album_hidden" ("createId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_updateId_idx" ON "shared_space_album_hidden" ("updateId")`.execute(
    db,
  );

  await sql`
    CREATE TABLE "shared_space_album_hidden_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "albumId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_hidden_audit_pkey" PRIMARY KEY ("id")
    )
  `.execute(db);

  await sql`CREATE INDEX "shared_space_album_hidden_audit_spaceId_idx" ON "shared_space_album_hidden_audit" ("spaceId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_audit_albumId_idx" ON "shared_space_album_hidden_audit" ("albumId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_audit_userId_idx" ON "shared_space_album_hidden_audit" ("userId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_audit_deletedAt_idx" ON "shared_space_album_hidden_audit" ("deletedAt")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_hidden_audit_userId_id_idx" ON "shared_space_album_hidden_audit" ("userId", "id")`.execute(
    db,
  );

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_hidden_updatedAt"
  BEFORE UPDATE ON "shared_space_album_hidden"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_hidden_updatedAt', '{"type":"trigger","name":"shared_space_album_hidden_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_hidden_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_album_hidden\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  await sql`CREATE OR REPLACE FUNCTION shared_space_album_hidden_delete_audit()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO shared_space_album_hidden_audit ("spaceId", "albumId", "userId")
      SELECT "spaceId", "albumId", "userId" FROM "old";
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_hidden_delete_audit"
  AFTER DELETE ON "shared_space_album_hidden"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION shared_space_album_hidden_delete_audit();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_shared_space_album_hidden_delete_audit', '{"type":"function","name":"shared_space_album_hidden_delete_audit","sql":"CREATE OR REPLACE FUNCTION shared_space_album_hidden_delete_audit()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO shared_space_album_hidden_audit (\\"spaceId\\", \\"albumId\\", \\"userId\\")\\n      SELECT \\"spaceId\\", \\"albumId\\", \\"userId\\" FROM \\"old\\";\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb);`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_hidden_delete_audit', '{"type":"trigger","name":"shared_space_album_hidden_delete_audit","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_hidden_delete_audit\\"\\n  AFTER DELETE ON \\"shared_space_album_hidden\\"\\n  REFERENCING OLD TABLE AS \\"old\\"\\n  FOR EACH STATEMENT\\n  EXECUTE FUNCTION shared_space_album_hidden_delete_audit();"}'::jsonb);`.execute(
    db,
  );

  await seedHiddenRowsFromSharedFlag(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'trigger_shared_space_album_hidden_updatedAt',
    'function_shared_space_album_hidden_delete_audit',
    'trigger_shared_space_album_hidden_delete_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_hidden_delete_audit" ON "shared_space_album_hidden";`.execute(
    db,
  );
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_hidden_updatedAt" ON "shared_space_album_hidden";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_hidden";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_hidden_audit";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_album_hidden_delete_audit;`.execute(db);
}
