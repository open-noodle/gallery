import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_session_activity_event" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "kind" character varying NOT NULL,
      "status" character varying NOT NULL,
      "source" character varying NOT NULL,
      "summary" text,
      "counts" jsonb,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "agent_session_activity_event_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_session_activity_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_session_activity_event_sessionId_createdAt_id_idx" ON "agent_session_activity_event" ("sessionId", "createdAt", "id")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_session_activity_event_sessionId_idx" ON "agent_session_activity_event" ("sessionId")`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_session_activity_event_sessionId_idx"`.execute(db);
  await sql`DROP INDEX "agent_session_activity_event_sessionId_createdAt_id_idx"`.execute(db);
  await sql`DROP TABLE "agent_session_activity_event"`.execute(db);
}
