import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT "person_face_suggestion_status_chk"
  `.execute(db);

  await sql`
    UPDATE "person_face_suggestion"
    SET "status" = 'rejected'
    WHERE "status" = 'dismissed'
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_status_chk"
    CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'ignored'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT "person_face_suggestion_status_chk"
  `.execute(db);

  await sql`
    UPDATE "person_face_suggestion"
    SET "status" = 'dismissed'
    WHERE "status" IN ('rejected', 'ignored')
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_status_chk"
    CHECK ("status" IN ('pending', 'confirmed', 'dismissed'))
  `.execute(db);
}
