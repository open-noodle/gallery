import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "game_challenge" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId" uuid NOT NULL,
      "createdById" uuid NOT NULL,
      "name" character varying NOT NULL,
      "roundCount" integer NOT NULL,
      "scaleKm" double precision NOT NULL,
      "scaleDays" integer NOT NULL,
      "closedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "game_challenge_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_challenge_spaceId_fkey" FOREIGN KEY ("spaceId")
        REFERENCES "shared_space" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_challenge_createdById_fkey" FOREIGN KEY ("createdById")
        REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    )`.execute(db);
  await sql`CREATE INDEX "game_challenge_spaceId_idx" ON "game_challenge" ("spaceId")`.execute(db);
  await sql`CREATE INDEX "game_challenge_createdById_idx" ON "game_challenge" ("createdById")`.execute(db);
  await sql`CREATE INDEX "game_challenge_updateId_idx" ON "game_challenge" ("updateId")`.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "game_challenge_updatedAt"
      BEFORE UPDATE ON "game_challenge"
      FOR EACH ROW
      EXECUTE FUNCTION updated_at();
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_game_challenge_updatedAt', '{"type":"trigger","name":"game_challenge_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"game_challenge_updatedAt\\"\\n  BEFORE UPDATE ON \\"game_challenge\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  await sql`
    CREATE TABLE "game_round" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "challengeId" uuid NOT NULL,
      "index" integer NOT NULL,
      "type" character varying NOT NULL,
      "assetId" uuid,
      "answerLat" double precision,
      "answerLon" double precision,
      "answerDate" timestamp with time zone,
      CONSTRAINT "game_round_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_round_challenge_index_uq" UNIQUE ("challengeId", "index"),
      CONSTRAINT "game_round_challengeId_fkey" FOREIGN KEY ("challengeId")
        REFERENCES "game_challenge" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_round_assetId_fkey" FOREIGN KEY ("assetId")
        REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL
    )`.execute(db);
  await sql`CREATE INDEX "game_round_challengeId_idx" ON "game_round" ("challengeId")`.execute(db);
  await sql`CREATE INDEX "game_round_assetId_idx" ON "game_round" ("assetId")`.execute(db);

  await sql`
    CREATE TABLE "game_guess" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "roundId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "guessLat" double precision,
      "guessLon" double precision,
      "guessDate" timestamp with time zone,
      "distanceKm" double precision,
      "offsetDays" integer,
      "score" integer NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "game_guess_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "game_guess_round_user_uq" UNIQUE ("roundId", "userId"),
      CONSTRAINT "game_guess_roundId_fkey" FOREIGN KEY ("roundId")
        REFERENCES "game_round" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "game_guess_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    )`.execute(db);
  await sql`CREATE INDEX "game_guess_roundId_idx" ON "game_guess" ("roundId")`.execute(db);
  await sql`CREATE INDEX "game_guess_userId_idx" ON "game_guess" ("userId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "game_guess"`.execute(db);
  await sql`DROP TABLE IF EXISTS "game_round"`.execute(db);

  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_game_challenge_updatedAt'`.execute(db);

  await sql`DROP TABLE IF EXISTS "game_challenge"`.execute(db);
}
