import { Kysely, sql } from 'kysely';

// Moves Gallery's two job stamps off upstream's asset_job_status into a fork-owned sidecar keyed by
// asset id, so the upstream table keeps upstream's columns only.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "asset_job_status_gallery" (
      "assetId" uuid NOT NULL,
      "petsDetectedAt" timestamp with time zone,
      "classifiedAt" timestamp with time zone,
      CONSTRAINT "asset_job_status_gallery_pkey" PRIMARY KEY ("assetId"),
      CONSTRAINT "asset_job_status_gallery_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`
    INSERT INTO "asset_job_status_gallery" ("assetId", "petsDetectedAt", "classifiedAt")
    SELECT "assetId", "petsDetectedAt", "classifiedAt"
    FROM "asset_job_status"
    WHERE "petsDetectedAt" IS NOT NULL OR "classifiedAt" IS NOT NULL;
  `.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "petsDetectedAt";`.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "classifiedAt";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" ADD COLUMN "petsDetectedAt" timestamp with time zone;`.execute(db);
  await sql`ALTER TABLE "asset_job_status" ADD COLUMN "classifiedAt" timestamp with time zone;`.execute(db);
  await sql`
    INSERT INTO "asset_job_status" ("assetId", "petsDetectedAt", "classifiedAt")
    SELECT "assetId", "petsDetectedAt", "classifiedAt" FROM "asset_job_status_gallery"
    ON CONFLICT ("assetId") DO UPDATE
    SET "petsDetectedAt" = excluded."petsDetectedAt", "classifiedAt" = excluded."classifiedAt";
  `.execute(db);
  await sql`DROP TABLE "asset_job_status_gallery";`.execute(db);
}
