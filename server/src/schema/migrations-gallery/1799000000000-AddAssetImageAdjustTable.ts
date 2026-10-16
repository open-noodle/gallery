import { Kysely, sql } from 'kysely';

// The editor's colour adjustment (exposure, contrast, saturation, invert) gets its own table instead of an `adjust`
// action in asset_edit, which stock Immich clients cannot decode (#1124). A database that ran a pre-release build of
// #1124 stored the adjustment as such an action: move it here, keeping the latest one per asset, and delete the row.
// Deleting the asset_edit row clears asset."isEdited" through asset_edit_delete when it was the only edit, so it is
// set again: the adjusted thumbnails are still the edited ones.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_image_adjust" (
  "assetId" uuid NOT NULL,
  "exposure" double precision NOT NULL DEFAULT 0,
  "contrast" double precision NOT NULL DEFAULT 0,
  "saturation" double precision NOT NULL DEFAULT 0,
  "invert" boolean NOT NULL DEFAULT false,
  CONSTRAINT "asset_image_adjust_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_image_adjust_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
  await sql`
    INSERT INTO "asset_image_adjust" ("assetId", "exposure", "contrast", "saturation", "invert")
    SELECT DISTINCT ON (e."assetId")
           e."assetId",
           coalesce((e."parameters"->>'exposure')::double precision, 0),
           coalesce((e."parameters"->>'contrast')::double precision, 0),
           coalesce((e."parameters"->>'saturation')::double precision, 0),
           coalesce((e."parameters"->>'invert')::boolean, false)
      FROM "asset_edit" e
     WHERE e."action" = 'adjust'
     ORDER BY e."assetId", e."sequence" DESC;
  `.execute(db);
  await sql`DELETE FROM "asset_edit" WHERE "action" = 'adjust';`.execute(db);
  await sql`
    UPDATE "asset" SET "isEdited" = true
      FROM "asset_image_adjust" a
     WHERE a."assetId" = "asset"."id" AND NOT "asset"."isEdited";
  `.execute(db);
}

// Gallery before this migration has no colour adjustment, and an `adjust` asset_edit row would break the sync of every
// stock and older Gallery app, so the values are not moved back. The edited files have the adjustment baked in:
// drop them and clear the thumbhash, so the missing-thumbnails job regenerates them from asset_edit alone (or the
// original when the adjustment was the only edit).
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE "asset"
       SET "thumbhash" = NULL,
           "isEdited" = EXISTS (SELECT FROM "asset_edit" e WHERE e."assetId" = "asset"."id")
      FROM "asset_image_adjust" a
     WHERE a."assetId" = "asset"."id";
  `.execute(db);
  await sql`
    DELETE FROM "asset_file"
     WHERE "isEdited"
       AND "assetId" IN (SELECT "assetId" FROM "asset_image_adjust");
  `.execute(db);
  await sql`DROP TABLE "asset_image_adjust";`.execute(db);
}
