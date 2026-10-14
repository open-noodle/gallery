import { Kysely, sql } from 'kysely';

// Drops the fork's `library."createId"` (and its index) so `library` is upstream's table again. Library
// sync keys off `library_user."createId"` (LibrarySync.getCreatedAfter), so the only reader left was the
// library_after_insert trigger, which now lets that column take its default (immich_uuid_v7()).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE OR REPLACE FUNCTION library_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createdAt")
      SELECT "ownerId", "id", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"library_after_insert","sql":"CREATE OR REPLACE FUNCTION library_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\", \\"createdAt\\")\\n      SELECT \\"ownerId\\", \\"id\\", \\"createdAt\\"\\n      FROM inserted_rows\\n      WHERE \\"ownerId\\" IS NOT NULL AND \\"deletedAt\\" IS NULL\\n      ON CONFLICT DO NOTHING;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_library_after_insert';`.execute(db);

  await sql`DROP INDEX IF EXISTS "library_createId_idx";`.execute(db);
  await sql`ALTER TABLE "library" DROP COLUMN IF EXISTS "createId";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "library" ADD COLUMN "createId" uuid NOT NULL DEFAULT immich_uuid_v7();`.execute(db);
  await sql`CREATE INDEX "library_createId_idx" ON "library" ("createId");`.execute(db);

  await sql`CREATE OR REPLACE FUNCTION library_after_insert()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS $$
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END
  $$;`.execute(db);

  await sql`UPDATE "migration_overrides"
  SET "value" = '{"type":"function","name":"library_after_insert","sql":"CREATE OR REPLACE FUNCTION library_after_insert()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      INSERT INTO library_user (\\"userId\\", \\"libraryId\\", \\"createId\\", \\"createdAt\\")\\n      SELECT \\"ownerId\\", \\"id\\", \\"createId\\", \\"createdAt\\"\\n      FROM inserted_rows\\n      WHERE \\"ownerId\\" IS NOT NULL AND \\"deletedAt\\" IS NULL\\n      ON CONFLICT DO NOTHING;\\n      RETURN NULL;\\n    END\\n  $$;"}'::jsonb
  WHERE "name" = 'function_library_after_insert';`.execute(db);
}
