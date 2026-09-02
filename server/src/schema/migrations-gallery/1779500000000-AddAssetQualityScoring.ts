import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "asset_quality" (
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "sharpness" integer,
      "exposure" integer,
      "brightness" integer,
      "quality" integer,
      PRIMARY KEY ("assetId")
    )
  `.execute(db);
  await sql`ALTER TABLE "asset_job_status" ADD "qualityScoredAt" timestamp with time zone`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "qualityScoredAt"`.execute(db);
  await sql`DROP TABLE IF EXISTS "asset_quality"`.execute(db);
}
