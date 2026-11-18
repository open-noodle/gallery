import { Kysely, sql } from 'kysely';

// Spatial Scene per-photo choice (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"): offer it on a photo,
// or stop offering it, whatever the automatic choice says. No row means the automatic choice.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_spatial_scene_offer" (
  "assetId" uuid NOT NULL,
  "offered" boolean NOT NULL,
  CONSTRAINT "asset_spatial_scene_offer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_spatial_scene_offer_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
}

// An older Gallery has nowhere to keep this choice: it offers Spatial Scene by the admin's offer mode alone, which is
// what a photo without a row gets here. The choice is lost, so the photos it applied to go back to the automatic one.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "asset_spatial_scene_offer";`.execute(db);
}
