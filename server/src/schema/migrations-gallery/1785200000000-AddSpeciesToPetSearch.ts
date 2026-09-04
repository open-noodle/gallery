import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Nullable: rows written before this migration have no species, and the recognition
  // person-creation fallback tolerates null. Written at embed time so the queue-all and nightly
  // paths — whose job data carries no label — can still stamp the species on a new pet person.
  await sql`ALTER TABLE "pet_search" ADD COLUMN "species" text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "pet_search" DROP COLUMN "species"`.execute(db);
}
