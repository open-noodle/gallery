import { Kysely, sql } from 'kysely';

// Asset versions (specs/2026-11-07-asset-versions-design.md): every file of a combined shot has a row in one table,
// the base photo shown in the timeline and the versions hidden behind it, with what was read from each file and what
// the base photo's picture is rendered from. The fork's per-asset job table gets the stamp the Versions job's
// "Missing" run goes by.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_version" (
  "versionAssetId" uuid NOT NULL,
  "assetId" uuid,
  "role" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "source" character varying,
  "rule" character varying NOT NULL,
  "priorVisibility" character varying,
  "wasStacked" boolean NOT NULL DEFAULT false,
  "read" jsonb,
  "lookSourceAssetId" uuid,
  "lookSourceModifiedAt" timestamp with time zone,
  "lookUpdatedAt" timestamp with time zone,
  "lookQueuedAt" timestamp with time zone,
  "syncedAt" timestamp with time zone,
  "cleanupQueuedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_version_versionAssetId_fkey" FOREIGN KEY ("versionAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_version_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "asset_version_lookSourceAssetId_fkey" FOREIGN KEY ("lookSourceAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "asset_version_pkey" PRIMARY KEY ("versionAssetId"),
  CONSTRAINT "asset_version_role_chk" CHECK ("role" IN ('base_photo', 'version')),
  CONSTRAINT "asset_version_base_photo_chk" CHECK (("role" = 'base_photo') = ("versionAssetId" = "assetId")),
  CONSTRAINT "asset_version_look_chk" CHECK ("role" = 'base_photo' OR ("lookUpdatedAt" IS NULL AND "lookSourceAssetId" IS NULL AND "lookSourceModifiedAt" IS NULL AND "lookQueuedAt" IS NULL))
);`.execute(db);
  await sql`CREATE INDEX "asset_version_assetId_idx" ON "asset_version" ("assetId")`.execute(db);
  await sql`CREATE INDEX "asset_version_lookSourceAssetId_idx" ON "asset_version" ("lookSourceAssetId")`.execute(db);
  await sql`ALTER TABLE "asset_job_status_gallery" ADD "versionsReadAt" timestamp with time zone`.execute(db);
  await sql`ALTER TABLE "asset_job_status_gallery" ADD "versionsParserVersion" integer`.execute(db);
}

// An older Gallery has no versions, so each one becomes a photo of its own again, the way it was before it went behind
// its base photo: stacked under it only if it shared a stack with it then. scripts/revert-to-immich.sql does the same.
export async function down(db: Kysely<any>): Promise<void> {
  await resetLooks(db);
  await showVersions(db);
  await sql`DROP TABLE "asset_version";`.execute(db);
  await sql`ALTER TABLE "asset_job_status_gallery" DROP COLUMN "versionsReadAt"`.execute(db);
  await sql`ALTER TABLE "asset_job_status_gallery" DROP COLUMN "versionsParserVersion"`.execute(db);
}

// A base photo whose picture was rendered from another file shows its own file again: its edited files have that
// picture baked in, so they go, and with the thumbhash cleared the missing-thumbnails job makes them again from what
// is left (crop, rotate, mirror, a colour adjustment), or the plain thumbnails when nothing is. The same as the revert
// script, and as it does for colour adjustments. Every look counts, also one whose source file is gone.
async function resetLooks(db: Kysely<any>) {
  const looks = sql`(SELECT "versionAssetId" FROM "asset_version" WHERE "role" = 'base_photo' AND "lookUpdatedAt" IS NOT NULL)`;
  await sql`UPDATE "asset" SET "thumbhash" = NULL,
  "isEdited" = EXISTS (SELECT FROM "asset_edit" e WHERE e."assetId" = "asset"."id")
    OR EXISTS (SELECT FROM "asset_image_adjust" j WHERE j."assetId" = "asset"."id")
WHERE "asset"."id" IN ${looks}`.execute(db);
  // its size was the shown file's: back to its own file's, upright (unless Gallery's editor has cropped it, whose
  // size the edit job sets)
  await sql`UPDATE "asset" SET
  "width" = CASE WHEN x."orientation" IN ('5', '6', '7', '8') THEN x."exifImageHeight" ELSE x."exifImageWidth" END,
  "height" = CASE WHEN x."orientation" IN ('5', '6', '7', '8') THEN x."exifImageWidth" ELSE x."exifImageHeight" END
FROM "asset_exif" x
WHERE x."assetId" = "asset"."id" AND "asset"."id" IN ${looks} AND x."exifImageWidth" > 0 AND x."exifImageHeight" > 0
  AND NOT EXISTS (SELECT FROM "asset_edit" e WHERE e."assetId" = "asset"."id")`.execute(db);
  await sql`DELETE FROM "asset_file" WHERE "isEdited" AND "assetId" IN ${looks}`.execute(db);
}

async function showVersions(db: Kysely<any>) {
  // a base photo that a version shared a stack with, and that is in none now (a stack left with one asset was
  // dissolved), gets one, with itself on top; a locked photo is in no stack
  await sql`INSERT INTO "stack" ("primaryAssetId", "ownerId")
SELECT p."id", p."ownerId" FROM "asset" p
WHERE p."stackId" IS NULL AND p."visibility" <> 'locked'
  AND EXISTS (SELECT 1 FROM "asset_version" v WHERE v."assetId" = p."id" AND v."role" = 'version' AND v."wasStacked")`.execute(
    db,
  );
  await sql`UPDATE "asset" p SET "stackId" = s."id" FROM "stack" s
WHERE s."primaryAssetId" = p."id" AND p."stackId" IS NULL AND p."visibility" <> 'locked'
  AND EXISTS (SELECT 1 FROM "asset_version" v WHERE v."assetId" = p."id" AND v."role" = 'version' AND v."wasStacked")`.execute(
    db,
  );
  // each version is shown again as its base photo is now where that is a decision about the shot (locked with a
  // locked photo, archived with an archived one, in the trash with a trashed one), else archived if it was archived
  // before; and it joins the base photo's stack only if it shared one with it. The base photo itself stays as it is
  await sql`UPDATE "asset" a SET
  "stackId" = CASE WHEN v."wasStacked" AND p."visibility" <> 'locked' THEN p."stackId" END,
  "visibility" = CASE
    WHEN p."visibility" = 'locked' THEN 'locked'::asset_visibility_enum
    WHEN p."visibility" = 'archive' OR v."priorVisibility" = 'archive' THEN 'archive'::asset_visibility_enum
    ELSE 'timeline'::asset_visibility_enum END,
  "deletedAt" = COALESCE(a."deletedAt", p."deletedAt"),
  -- trash is the timestamp and the status together: Restore and Empty Trash select by status
  "status" = CASE WHEN a."deletedAt" IS NULL AND p."deletedAt" IS NOT NULL THEN p."status" ELSE a."status" END
FROM "asset_version" v JOIN "asset" p ON p."id" = v."assetId"
WHERE a."id" = v."versionAssetId" AND v."role" = 'version'`.execute(db);
  // a version whose base photo is already gone is shown on its own, in the timeline or the archive as before
  await sql`UPDATE "asset" a SET "visibility" = CASE
    WHEN v."priorVisibility" = 'archive' THEN 'archive'::asset_visibility_enum
    ELSE 'timeline'::asset_visibility_enum END
FROM "asset_version" v WHERE a."id" = v."versionAssetId" AND v."role" = 'version' AND v."assetId" IS NULL`.execute(db);
}
