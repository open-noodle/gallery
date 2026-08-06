import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_message" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "role" character varying NOT NULL,
      "content" jsonb NOT NULL,
      "providerMessageId" character varying,
      "toolCallId" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_message_sessionId_createdAt_id_idx" ON "agent_message" ("sessionId", "createdAt", "id")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_message_sessionId_idx" ON "agent_message" ("sessionId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_message_sessionId_idx"`.execute(db);
  await sql`DROP TABLE "agent_message"`.execute(db);
}
