import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_selection_handle" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "sourceToolCallId" uuid,
      "assetIds" jsonb NOT NULL,
      "assetCount" integer NOT NULL,
      "sampleAssetIds" jsonb NOT NULL,
      "expiresAt" timestamp with time zone NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_selection_handle_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_selection_handle_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_selection_handle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_selection_handle_sourceToolCallId_fkey" FOREIGN KEY ("sourceToolCallId") REFERENCES "agent_tool_call"("id") ON UPDATE CASCADE ON DELETE SET NULL
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_selection_handle_sessionId_userId_expiresAt_idx" ON "agent_selection_handle" ("sessionId", "userId", "expiresAt")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_selection_handle_sessionId_idx" ON "agent_selection_handle" ("sessionId")`.execute(db);
  await sql`CREATE INDEX "agent_selection_handle_userId_idx" ON "agent_selection_handle" ("userId")`.execute(db);
  await sql`CREATE INDEX "agent_selection_handle_sourceToolCallId_idx" ON "agent_selection_handle" ("sourceToolCallId")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_selection_handle_updateId_idx" ON "agent_selection_handle" ("updateId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_selection_handle_updateId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_sourceToolCallId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_userId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_sessionId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_sessionId_userId_expiresAt_idx"`.execute(db);
  await sql`DROP TABLE "agent_selection_handle"`.execute(db);
}
