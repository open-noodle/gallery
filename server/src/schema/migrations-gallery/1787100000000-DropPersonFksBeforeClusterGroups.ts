import { Kysely, sql } from 'kysely';

/**
 * Runs immediately BEFORE upstream's `1787148183729-ClusterGroups`.
 *
 * That migration replaces `person`'s primary key with the composite `(ownerId, personGroupId)`:
 *
 *   ALTER TABLE "person" DROP CONSTRAINT "person_pkey";
 *
 * Postgres refuses that while any foreign key still depends on `person_pkey`. Gallery has three
 * such keys that upstream knows nothing about, so upstream's migration aborts on a Gallery database
 * with `2BP01 ... constraint face_repair_decline_suspectedOwnerId_fkey depends on index person_pkey`.
 *
 * Dropping them here clears the way. They are re-created against `person_group` in
 * `1791000000000-RepointFaceReviewToPersonGroup`, which runs after upstream's migration.
 *
 * The window between the two migrations is the only point where these columns are unconstrained;
 * nothing runs in between except upstream's own schema work.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "face_person_verdict" DROP CONSTRAINT "face_person_verdict_personId_fkey";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" DROP CONSTRAINT "face_repair_decline_personId_fkey";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" DROP CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey";`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "face_person_verdict" ADD CONSTRAINT "face_person_verdict_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`ALTER TABLE "face_repair_decline" ADD CONSTRAINT "face_repair_decline_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(
    db,
  );
  await sql`ALTER TABLE "face_repair_decline" ADD CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey" FOREIGN KEY ("suspectedOwnerId") REFERENCES "person" ("id") ON UPDATE CASCADE ON DELETE CASCADE;`.execute(
    db,
  );
}
