import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // The UTC date this challenge is the daily for; NULL for a player-created one.
  await sql`ALTER TABLE "game_challenge" ADD COLUMN "dailyOn" date`.execute(db);

  // A PARTIAL unique index, and it is load-bearing: the daily is generated lazily by whichever
  // member of the space happens to open the page first that day, so two concurrent readers really
  // do both try to insert one. This is what makes the loser fail instead of creating a second,
  // divergent daily - the service catches the violation and re-reads the winner's row.
  await sql`
    CREATE UNIQUE INDEX "game_challenge_daily_uq"
      ON "game_challenge" ("spaceId", "dailyOn") WHERE "dailyOn" IS NOT NULL`.execute(db);

  // A daily has no human author, so createdById cannot stay NOT NULL.
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "createdById" DROP NOT NULL`.execute(db);

  // ...and while it is being rewritten, ON DELETE CASCADE becomes SET NULL. Cascading here meant
  // deleting a user destroyed every challenge they had created in a SHARED space, taking all the
  // other members' rounds, guesses and scores with it. A shared space's game history belongs to the
  // space, not to whoever pressed "new challenge".
  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT "game_challenge_createdById_fkey"`.execute(db);
  await sql`
    ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT "game_challenge_createdById_fkey"`.execute(db);
  // Any daily (createdById IS NULL) has to go before the column can be NOT NULL again.
  await sql`DELETE FROM "game_challenge" WHERE "createdById" IS NULL`.execute(db);
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "createdById" SET NOT NULL`.execute(db);
  await sql`
    ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE`.execute(db);

  await sql`DROP INDEX IF EXISTS "game_challenge_daily_uq"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "dailyOn"`.execute(db);
}
