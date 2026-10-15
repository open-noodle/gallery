import { Kysely, sql } from 'kysely';

// The restore record for a person dissolve (specs/2026-09-06-dissolve-person-design.md, Revision 2): which detected
// faces each dissolve hid, so the Face Cleanup "Dissolved" page can bring them back.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "face_dissolve" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "ownerId" uuid NOT NULL,
  "personGroupId" uuid NOT NULL,
  "personName" character varying NOT NULL DEFAULT '',
  "scope" character varying NOT NULL,
  "actorId" uuid,
  "hiddenCount" integer NOT NULL,
  "deletedCount" integer NOT NULL,
  "unassignedCount" integer NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "restoredAt" timestamp with time zone,
  CONSTRAINT "face_dissolve_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "face_dissolve_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "face_dissolve_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "face_dissolve_createdAt_id_idx" ON "face_dissolve" ("createdAt", "id");`.execute(db);
  await sql`CREATE INDEX "face_dissolve_ownerId_idx" ON "face_dissolve" ("ownerId");`.execute(db);
  await sql`CREATE TABLE "face_dissolve_face" (
  "dissolveId" uuid NOT NULL,
  "assetFaceId" uuid NOT NULL,
  CONSTRAINT "face_dissolve_face_dissolveId_fkey" FOREIGN KEY ("dissolveId") REFERENCES "face_dissolve" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "face_dissolve_face_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "face_dissolve_face_pkey" PRIMARY KEY ("dissolveId", "assetFaceId")
);`.execute(db);
  await sql`CREATE INDEX "face_dissolve_face_assetFaceId_idx" ON "face_dissolve_face" ("assetFaceId");`.execute(db);
}

// Dropped rather than moved back: the record has no upstream home. The hidden faces themselves stay hidden in
// upstream's own column (asset_face.deletedAt), so a build without this table keeps every dissolve's effect and
// loses only the ability to restore it.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "face_dissolve_face";`.execute(db);
  await sql`DROP TABLE "face_dissolve";`.execute(db);
}
