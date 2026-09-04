import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "shared_space_album_folder" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "spaceId" uuid NOT NULL,
  "parentId" uuid,
  "name" character varying NOT NULL,
  "createdById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "shared_space_album_folder_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_space" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "shared_space_album_folder" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_folder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "shared_space_album_folder_pkey" PRIMARY KEY ("id")
);`.execute(db);

  await sql`CREATE INDEX "shared_space_album_folder_spaceId_idx" ON "shared_space_album_folder" ("spaceId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_parentId_idx" ON "shared_space_album_folder" ("parentId") WHERE ("parentId" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_shared_space_album_folder_parentId_idx', '{"type":"index","name":"shared_space_album_folder_parentId_idx","sql":"CREATE INDEX \\"shared_space_album_folder_parentId_idx\\" ON \\"shared_space_album_folder\\" (\\"parentId\\") WHERE (\\"parentId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_createdById_idx" ON "shared_space_album_folder" ("createdById");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_createId_idx" ON "shared_space_album_folder" ("createId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folder_updateId_idx" ON "shared_space_album_folder" ("updateId");`.execute(
    db,
  );

  // Two partial unique indexes, not one: PG14 has no NULLS NOT DISTINCT, so a single index
  // over (spaceId, parentId, lower(name)) would let two ROOT folders share a name.
  await sql`CREATE UNIQUE INDEX "shared_space_album_folder_nested_name_key" ON "shared_space_album_folder" ("spaceId", "parentId", LOWER(BTRIM("name"))) WHERE ("parentId" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_shared_space_album_folder_nested_name_key', '{"type":"index","name":"shared_space_album_folder_nested_name_key","sql":"CREATE UNIQUE INDEX \\"shared_space_album_folder_nested_name_key\\" ON \\"shared_space_album_folder\\" (\\"spaceId\\", \\"parentId\\", LOWER(BTRIM(\\"name\\"))) WHERE (\\"parentId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "shared_space_album_folder_root_name_key" ON "shared_space_album_folder" ("spaceId", LOWER(BTRIM("name"))) WHERE ("parentId" IS NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_shared_space_album_folder_root_name_key', '{"type":"index","name":"shared_space_album_folder_root_name_key","sql":"CREATE UNIQUE INDEX \\"shared_space_album_folder_root_name_key\\" ON \\"shared_space_album_folder\\" (\\"spaceId\\", LOWER(BTRIM(\\"name\\"))) WHERE (\\"parentId\\" IS NULL);"}'::jsonb);`.execute(
    db,
  );

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_folder_updatedAt"
  BEFORE UPDATE ON "shared_space_album_folder"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_folder_updatedAt', '{"type":"trigger","name":"shared_space_album_folder_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_folder_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_album_folder\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  await sql`ALTER TABLE "shared_space_album" ADD "folderId" uuid;`.execute(db);
  await sql`ALTER TABLE "shared_space_album" ADD CONSTRAINT "shared_space_album_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "shared_space_album_folder" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_folderId_idx" ON "shared_space_album" ("folderId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_space_album_folderId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_space_album" DROP CONSTRAINT IF EXISTS "shared_space_album_folderId_fkey";`.execute(db);
  await sql`ALTER TABLE "shared_space_album" DROP COLUMN IF EXISTS "folderId";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_album_folder_updatedAt';`.execute(
    db,
  );
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_folder_updatedAt" ON "shared_space_album_folder";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'index_shared_space_album_folder_root_name_key',
    'index_shared_space_album_folder_nested_name_key',
    'index_shared_space_album_folder_parentId_idx'
  );`.execute(db);
  await sql`DROP TABLE "shared_space_album_folder";`.execute(db);
}
