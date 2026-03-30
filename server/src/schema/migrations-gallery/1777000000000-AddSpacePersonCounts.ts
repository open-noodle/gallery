import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space_person" ADD "faceCount" integer NOT NULL DEFAULT 0`.execute(db);
  await sql`ALTER TABLE "shared_space_person" ADD "assetCount" integer NOT NULL DEFAULT 0`.execute(db);
  await sql`CREATE INDEX "shared_space_person_space_count_idx" ON "shared_space_person" ("spaceId", "isHidden", "assetCount")`.execute(
    db,
  );

  // Backfill counts for existing data
  await sql`
    UPDATE "shared_space_person" SET
      "faceCount" = (
        SELECT count(*)
        FROM "shared_space_person_face"
        WHERE "shared_space_person_face"."personId" = "shared_space_person"."id"
      ),
      "assetCount" = (
        SELECT count(distinct "asset_face"."assetId")
        FROM "shared_space_person_face"
        INNER JOIN "asset_face" ON "asset_face"."id" = "shared_space_person_face"."assetFaceId"
        WHERE "shared_space_person_face"."personId" = "shared_space_person"."id"
      )
    WHERE "id" IN (
      SELECT DISTINCT "personId" FROM "shared_space_person_face"
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_space_person_space_count_idx"`.execute(db);
  await sql`ALTER TABLE "shared_space_person" DROP COLUMN "assetCount"`.execute(db);
  await sql`ALTER TABLE "shared_space_person" DROP COLUMN "faceCount"`.execute(db);
}
