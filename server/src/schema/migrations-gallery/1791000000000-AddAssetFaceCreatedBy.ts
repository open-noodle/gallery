import { Kysely, sql } from 'kysely';

// Records who drew a face box by hand through the space face-assign endpoint
// (2026-08-23-space-editor-face-assignment-design.md §6.6). NULL for every existing row and
// for everything the detector produces -- `sourceType` cannot tell an editor-drawn box from an
// owner-drawn one (PersonService.createFace already writes 'manual' for both), so deletability
// of a box is decided by this column alone, never by sourceType. ON DELETE SET NULL so deleting
// a user does not cascade away the face rows they drew.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_face" ADD COLUMN "createdBy" uuid REFERENCES "user" ("id") ON DELETE SET NULL`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_face_createdBy_idx" ON "asset_face" ("createdBy")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "asset_face_createdBy_idx"`.execute(db);
  await sql`ALTER TABLE "asset_face" DROP COLUMN IF EXISTS "createdBy"`.execute(db);
}
