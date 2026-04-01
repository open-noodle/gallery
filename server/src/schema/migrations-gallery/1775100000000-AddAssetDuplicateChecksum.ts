import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "asset_duplicate_checksum" (
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "ownerId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "checksum" bytea NOT NULL,
      PRIMARY KEY ("ownerId", "checksum")
    )
  `.execute(db);
  await sql`CREATE INDEX "asset_duplicate_checksum_assetId_idx" ON "asset_duplicate_checksum" ("assetId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "asset_duplicate_checksum_assetId_idx"`.execute(db);
  await sql`DROP TABLE IF EXISTS "asset_duplicate_checksum"`.execute(db);
}
