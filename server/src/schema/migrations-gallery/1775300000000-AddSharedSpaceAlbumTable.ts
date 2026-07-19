import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "shared_space_album" (
  "spaceId" uuid NOT NULL,
  "albumId" uuid NOT NULL,
  "addedById" uuid,
  "showInTimeline" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "shared_space_album_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_space" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_album_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "shared_space_album_pkey" PRIMARY KEY ("spaceId", "albumId")
);`.execute(db);
  await sql`CREATE INDEX "shared_space_album_albumId_idx" ON "shared_space_album" ("albumId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_addedById_idx" ON "shared_space_album" ("addedById");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_createId_idx" ON "shared_space_album" ("createId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_updateId_idx" ON "shared_space_album" ("updateId");`.execute(db);

  await sql`CREATE OR REPLACE TRIGGER "shared_space_album_updatedAt"
  BEFORE UPDATE ON "shared_space_album"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_shared_space_album_updatedAt', '{"type":"trigger","name":"shared_space_album_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"shared_space_album_updatedAt\\"\\n  BEFORE UPDATE ON \\"shared_space_album\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_shared_space_album_updatedAt';`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_updatedAt" ON "shared_space_album";`.execute(db);
  await sql`DROP TABLE "shared_space_album";`.execute(db);
}
