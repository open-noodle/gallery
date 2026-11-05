import { Kysely, sql } from 'kysely';

// Data Saver video (specs/2026-11-01-data-saver-video-design.md): one row per processed video, pointing at its
// `<assetId>_ds.mp4` beside the encoded videos, or null when the video is already small enough.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_data_saver_video" (
  "assetId" uuid NOT NULL,
  "path" text,
  "settings" text NOT NULL,
  "fromEdited" boolean NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_data_saver_video_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_data_saver_video_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
}

// The copies are derived data with nowhere to go in an older Gallery, and the job rebuilds them after an upgrade, so
// nothing is moved back. The files stay on disk, where nothing reads them.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "asset_data_saver_video";`.execute(db);
}
