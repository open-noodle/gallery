import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" ADD COLUMN "physicalUsageInBytes" bigint NOT NULL DEFAULT 0;`.execute(db);

  // Before this migration "quotaUsageInBytes" held physical bytes (originals + thumbnails +
  // transcodes). Preserve that measurement in the new column so admins who opt in immediately
  // see a real number rather than zero until the next nightly scan.
  await sql`UPDATE "user" SET "physicalUsageInBytes" = "quotaUsageInBytes";`.execute(db);

  // Reset "quotaUsageInBytes" to upstream semantics: originals only, external libraries excluded.
  await sql`
    UPDATE "user"
    SET "quotaUsageInBytes" = (
      SELECT coalesce(sum("asset_exif"."fileSizeInByte"), 0)
      FROM "asset"
      LEFT JOIN "asset_exif" ON "asset_exif"."assetId" = "asset"."id"
      WHERE "asset"."libraryId" IS NULL
        AND "asset"."ownerId" = "user"."id"
    );
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" DROP COLUMN "physicalUsageInBytes";`.execute(db);
}
