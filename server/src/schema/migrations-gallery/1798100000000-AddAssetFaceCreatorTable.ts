import { Kysely, sql } from 'kysely';

// Moves who drew a face box by hand (space face-assign endpoint) off the upstream `asset_face` table
// into the fork-owned `asset_face_creator` sidecar. A face with no row is not editor-drawn, which is
// what decides whether a space editor may delete the box (never `sourceType`, see
// 2026-08-23-space-editor-face-assignment-design.md §6.6).
//
// CASCADE on `userId` keeps the old SET NULL meaning: deleting the user drops the row, and the face
// stops counting as editor-drawn.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "asset_face_creator" (
      "assetFaceId" uuid NOT NULL REFERENCES "asset_face" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      "userId"      uuid NOT NULL REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "asset_face_creator_pkey" PRIMARY KEY ("assetFaceId")
    );
  `.execute(db);
  await sql`CREATE INDEX "asset_face_creator_userId_idx" ON "asset_face_creator" ("userId");`.execute(db);

  await sql`
    INSERT INTO "asset_face_creator" ("assetFaceId", "userId")
    SELECT "id", "createdBy" FROM "asset_face" WHERE "createdBy" IS NOT NULL;
  `.execute(db);

  await sql`DROP INDEX IF EXISTS "asset_face_createdBy_idx";`.execute(db);
  await sql`ALTER TABLE "asset_face" DROP COLUMN IF EXISTS "createdBy";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_face" ADD COLUMN "createdBy" uuid REFERENCES "user" ("id") ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_face_createdBy_idx" ON "asset_face" ("createdBy");`.execute(db);

  await sql`
    UPDATE "asset_face" SET "createdBy" = afc."userId"
      FROM "asset_face_creator" afc
     WHERE afc."assetFaceId" = "asset_face"."id";
  `.execute(db);

  await sql`DROP TABLE IF EXISTS "asset_face_creator";`.execute(db);
}
