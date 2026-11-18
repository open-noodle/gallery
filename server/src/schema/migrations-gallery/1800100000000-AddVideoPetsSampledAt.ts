import { Kysely, sql } from 'kysely';

// Video pets sampled across the whole video (specs/2026-11-16-video-pet-detection-design.md): the stamp that says pet
// detection sampled a video, as videoFacesSampledAt does for faces. The pets themselves use asset_face_video_frame.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status_gallery" ADD "videoPetsSampledAt" timestamp with time zone;`.execute(db);
}

// A marker only: an older Gallery has no use for it, and pet detection's Missing job sets it again by sampling.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status_gallery" DROP COLUMN "videoPetsSampledAt";`.execute(db);
}
