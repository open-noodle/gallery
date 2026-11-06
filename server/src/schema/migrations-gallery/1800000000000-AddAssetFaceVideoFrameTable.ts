import { Kysely, sql } from 'kysely';

// Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md): one row per video face,
// pointing at its best frame in `<assetId>_faces/` beside the thumbnails, and the stamp that says a video was sampled.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_face_video_frame" (
  "faceId" uuid NOT NULL,
  "path" text NOT NULL,
  "timeSeconds" double precision NOT NULL,
  "quality" real NOT NULL,
  "sightings" jsonb NOT NULL DEFAULT '[]',
  "version" smallint NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_face_video_frame_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "asset_face" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "asset_face_video_frame_pkey" PRIMARY KEY ("faceId")
);`.execute(db);
  await sql`ALTER TABLE "asset_job_status_gallery" ADD "videoFacesSampledAt" timestamp with time zone;`.execute(db);
}

// The frames are derived data an older Gallery cannot use. The faces themselves stay in asset_face, and the crop
// routes of an older Gallery cut them from the poster instead. The files stay on disk, where nothing reads them.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status_gallery" DROP COLUMN "videoFacesSampledAt";`.execute(db);
  await sql`DROP TABLE "asset_face_video_frame";`.execute(db);
}
