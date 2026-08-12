import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "face_repair_scan_flagged_face" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "scanId" uuid NOT NULL,
      "assetFaceId" uuid NOT NULL,
      "personId" uuid NOT NULL,
      "suspectedOwnerId" uuid NOT NULL,
      CONSTRAINT "face_repair_scan_flagged_face_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_repair_scan_flagged_face_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "face_repair_scan" ("id") ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX "face_repair_scan_flagged_face_scanId_personId_idx" ON "face_repair_scan_flagged_face" ("scanId", "personId")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "face_repair_scan_flagged_face"`.execute(db);
}
