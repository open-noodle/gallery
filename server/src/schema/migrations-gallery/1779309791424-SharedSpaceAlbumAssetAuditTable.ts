import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_space_album_asset_audit" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "albumId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_asset_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_asset_audit_albumId_idx" ON "shared_space_album_asset_audit" ("albumId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_asset_audit_assetId_idx" ON "shared_space_album_asset_audit" ("assetId")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_asset_audit_deletedAt_idx" ON "shared_space_album_asset_audit" ("deletedAt")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_space_album_asset_audit"`.execute(db);
}
