import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Nullable with no default: null means "no editor has been asked whether this space wants a daily
  // challenge yet", which is what the Challenges page keys its one-time prompt off.
  await sql`ALTER TABLE "shared_space" ADD COLUMN "dailyChallengeEnabled" boolean`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space" DROP COLUMN IF EXISTS "dailyChallengeEnabled"`.execute(db);
}
