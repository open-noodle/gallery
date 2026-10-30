import { Kysely, sql } from 'kysely';

// Spatial Scene depth maps (specs/2026-10-29-spatial-scene-design.md): one row per processed photo, pointing at its
// `<assetId>_depth.png` beside the thumbnails.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_spatial_scene" (
  "assetId" uuid NOT NULL,
  "path" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "boundarySharpness" real NOT NULL,
  "edgeDensity" real NOT NULL,
  "foregroundRatio" real NOT NULL,
  "focus" real NOT NULL,
  "modelName" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_spatial_scene_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_spatial_scene_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
}

// Depth maps are derived data with nowhere to go in an older Gallery, and the Spatial Scene job rebuilds them after
// an upgrade, so nothing is moved back. The files stay on disk, where nothing reads them.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "asset_spatial_scene";`.execute(db);
}
