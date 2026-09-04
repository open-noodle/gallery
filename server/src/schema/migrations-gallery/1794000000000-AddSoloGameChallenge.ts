import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "spaceId" DROP NOT NULL`.execute(db);

  // CASCADE, unlike createdById's SET NULL: a solo challenge is personal and has no other
  // stakeholder, so it dies with its owner. A solo challenge leaves createdById NULL rather than
  // setting both - two different FK actions firing on one row for one deletion event is a trap,
  // and the authorship it would record is already carried here.
  await sql`ALTER TABLE "game_challenge" ADD COLUMN "ownerId" uuid`.execute(db);
  await sql`ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE`.execute(db);
  await sql`CREATE INDEX "game_challenge_ownerId_idx" ON "game_challenge" ("ownerId")`.execute(db);

  // Frozen onto the row at generation, for the same reason scaleKm/scaleDays are: re-resolving
  // eligibility from live preferences would 404 every round image of a game in flight the moment
  // the player toggled a source off.
  await sql`ALTER TABLE "game_challenge" ADD COLUMN "includePartners" boolean NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE "game_challenge" ADD COLUMN "includeSpaces" boolean NOT NULL DEFAULT false`.execute(db);

  await sql`ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_scope_chk"
    CHECK (num_nonnulls("spaceId", "ownerId") = 1)`.execute(db);

  // The existing index is REPLACED, not supplemented: its WHERE clause gains an explicit
  // "spaceId" IS NOT NULL so the two indexes describe disjoint row sets. The override row below
  // stores the statement VERBATIM and the schema comparer matches on that string, so the DROP,
  // the CREATE and the override payload must be edited together or the server logs schema drift
  // on every boot.
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_daily_uq"`.execute(db);

  await sql`CREATE UNIQUE INDEX "game_challenge_daily_uq" ON "game_challenge" ("spaceId", "dailyOn") WHERE ("spaceId" IS NOT NULL AND "dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_daily_uq', '{"type":"index","name":"game_challenge_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_daily_uq\\" ON \\"game_challenge\\" (\\"spaceId\\", \\"dailyOn\\") WHERE (\\"spaceId\\" IS NOT NULL AND \\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );

  // The second index is not optional. Postgres treats NULLs as distinct in a unique index, so
  // once spaceId is nullable the index above stops constraining solo rows entirely, and the
  // lazy-generation race the first index exists to LOSE would start winning twice - producing two
  // divergent dailies for one user on one day.
  await sql`CREATE UNIQUE INDEX "game_challenge_owner_daily_uq" ON "game_challenge" ("ownerId", "dailyOn") WHERE ("ownerId" IS NOT NULL AND "dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_owner_daily_uq', '{"type":"index","name":"game_challenge_owner_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_owner_daily_uq\\" ON \\"game_challenge\\" (\\"ownerId\\", \\"dailyOn\\") WHERE (\\"ownerId\\" IS NOT NULL AND \\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_owner_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_owner_daily_uq"`.execute(db);

  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_daily_uq"`.execute(db);
  await sql`CREATE UNIQUE INDEX "game_challenge_daily_uq" ON "game_challenge" ("spaceId", "dailyOn") WHERE ("dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_daily_uq', '{"type":"index","name":"game_challenge_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_daily_uq\\" ON \\"game_challenge\\" (\\"spaceId\\", \\"dailyOn\\") WHERE (\\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );

  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT IF EXISTS "game_challenge_scope_chk"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "includeSpaces"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "includePartners"`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_ownerId_idx"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT IF EXISTS "game_challenge_ownerId_fkey"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "ownerId"`.execute(db);

  // Only safe because down() implies no solo challenges are wanted; delete them first so the
  // NOT NULL can be restored.
  await sql`DELETE FROM "game_challenge" WHERE "spaceId" IS NULL`.execute(db);
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "spaceId" SET NOT NULL`.execute(db);
}
