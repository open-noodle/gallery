import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_tool_call" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "toolName" character varying NOT NULL,
      "status" character varying NOT NULL,
      "approvalDecision" character varying,
      "requestSummary" text NOT NULL,
      "responseSummary" text,
      "redactedRequestMetadata" jsonb NOT NULL,
      "redactedResponseMetadata" jsonb,
      "dataClass" character varying NOT NULL,
      "assetCount" integer NOT NULL,
      "albumCount" integer NOT NULL,
      "providerSnapshot" jsonb NOT NULL,
      "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "completedAt" timestamp with time zone,
      "error" text,
      CONSTRAINT "agent_tool_call_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_tool_call_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_tool_call_sessionId_status_idx" ON "agent_tool_call" ("sessionId", "status")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_tool_call_sessionId_startedAt_id_idx" ON "agent_tool_call" ("sessionId", "startedAt", "id")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_tool_call_sessionId_idx" ON "agent_tool_call" ("sessionId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_tool_call_sessionId_idx"`.execute(db);
  await sql`DROP INDEX "agent_tool_call_sessionId_startedAt_id_idx"`.execute(db);
  await sql`DROP INDEX "agent_tool_call_sessionId_status_idx"`.execute(db);
  await sql`DROP TABLE "agent_tool_call"`.execute(db);
}
