import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Slice 11 (F23): backs the admin resolutions page's listNegativeVerdicts — `WHERE status IN ('rejected',
  // 'ignored') ORDER BY createdAt DESC, id DESC LIMIT/OFFSET`, unscoped by any owner/person id. Without this,
  // that query sorts the whole table on every page request.
  await sql`CREATE INDEX "face_person_verdict_status_createdAt_id_idx" ON "face_person_verdict" ("status", "createdAt", "id")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "face_person_verdict_status_createdAt_id_idx"`.execute(db);
}
