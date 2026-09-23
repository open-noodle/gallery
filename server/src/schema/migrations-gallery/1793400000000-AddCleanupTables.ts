import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "asset_localMonthDay_idx" ON "asset" ("ownerId", ((extract(month from ("localDateTime" at time zone 'UTC')) * 100 + extract(day from ("localDateTime" at time zone 'UTC')))::smallint)) WHERE ("deletedAt" IS NULL AND "visibility" IN ('timeline', 'archive') AND "isOffline" = false AND "libraryId" IS NULL);`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_exif_fileSizeInByte_idx" ON "asset_exif" ("fileSizeInByte");`.execute(db);
  await sql`ALTER TABLE "asset_job_status" ADD "qualityAnalyzedAt" timestamp with time zone;`.execute(db);
  await sql`CREATE TABLE "asset_quality" (
  "assetId" uuid NOT NULL,
  "ownerId" uuid NOT NULL,
  "sharpness" real,
  "brightness" real,
  "clippedDark" real,
  "clippedBright" real,
  "isScreenshot" boolean NOT NULL DEFAULT false,
  "version" smallint NOT NULL,
  CONSTRAINT "asset_quality_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_quality_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_quality_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`CREATE INDEX "asset_quality_ownerId_screenshot_idx" ON "asset_quality" ("ownerId") WHERE ("isScreenshot" = true);`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_quality_ownerId_sharpness_idx" ON "asset_quality" ("ownerId", "sharpness");`.execute(
    db,
  );
  await sql`CREATE TABLE "cleanup_day_review" (
  "userId" uuid NOT NULL,
  "monthDay" smallint NOT NULL,
  "reviewedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "cleanup_day_review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "cleanup_day_review_pkey" PRIMARY KEY ("userId", "monthDay")
);`.execute(db);
  await sql`CREATE TABLE "cleanup_decision" (
  "userId" uuid NOT NULL,
  "queue" character varying NOT NULL,
  "assetId" uuid NOT NULL,
  "decision" character varying NOT NULL DEFAULT 'keep',
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cleanup_decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "cleanup_decision_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "cleanup_decision_pkey" PRIMARY KEY ("userId", "queue", "assetId")
);`.execute(db);
  await sql`CREATE INDEX "cleanup_decision_assetId_idx" ON "cleanup_decision" ("assetId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_localMonthDay_idx', '{"type":"index","name":"asset_localMonthDay_idx","sql":"CREATE INDEX \\"asset_localMonthDay_idx\\" ON \\"asset\\" (\\"ownerId\\", ((extract(month from (\\"localDateTime\\" at time zone ''UTC'')) * 100 + extract(day from (\\"localDateTime\\" at time zone ''UTC'')))::smallint)) WHERE (\\"deletedAt\\" IS NULL AND \\"visibility\\" IN (''timeline'', ''archive'') AND \\"isOffline\\" = false AND \\"libraryId\\" IS NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_quality_ownerId_screenshot_idx', '{"type":"index","name":"asset_quality_ownerId_screenshot_idx","sql":"CREATE INDEX \\"asset_quality_ownerId_screenshot_idx\\" ON \\"asset_quality\\" (\\"ownerId\\") WHERE (\\"isScreenshot\\" = true);"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_exif_fileSizeInByte_idx";`.execute(db);
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "qualityAnalyzedAt";`.execute(db);
  await sql`DROP INDEX "asset_localMonthDay_idx";`.execute(db);
  await sql`DROP TABLE "asset_quality";`.execute(db);
  await sql`DROP TABLE "cleanup_day_review";`.execute(db);
  await sql`DROP TABLE "cleanup_decision";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_localMonthDay_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_quality_ownerId_screenshot_idx';`.execute(db);
}
