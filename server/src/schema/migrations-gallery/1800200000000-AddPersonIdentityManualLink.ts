import { Kysely, sql } from 'kysely';

// Joining two accounts' people (specs/2026-11-22-cross-account-identity-joins-design.md, 5a): when a member links a
// personal person to another scope by hand, the cross-owner repair must keep that link even though no shared photo
// backs it. Nothing else in the data records that a human made the link, so the merge engine stamps it here.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person_identity" ADD "manualLinkAt" timestamp with time zone;`.execute(db);
}

// The stamp has no earlier home to move back to. Dropping it only means the next repair treats those links as
// automatic, which an older Gallery never runs.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person_identity" DROP COLUMN "manualLinkAt";`.execute(db);
}
