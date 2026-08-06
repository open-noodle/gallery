import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_session" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL,
      "providerCredentialId" uuid,
      "credentialSnapshot" jsonb NOT NULL,
      "modelSnapshot" jsonb NOT NULL,
      "permissionPreset" character varying NOT NULL,
      "permissionPlanSnapshot" jsonb NOT NULL,
      "approvalMode" character varying NOT NULL,
      "runnerEndpoint" character varying,
      "runnerSessionId" character varying,
      "runnerCapabilitiesSnapshot" jsonb,
      "status" character varying NOT NULL DEFAULT 'created',
      "initialContextSnapshot" jsonb NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "endedAt" timestamp with time zone,
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_session_providerCredentialId_fkey" FOREIGN KEY ("providerCredentialId") REFERENCES "agent_provider_credential"("id") ON UPDATE CASCADE ON DELETE SET NULL
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_session_userId_idx" ON "agent_session" ("userId")`.execute(db);
  await sql`CREATE INDEX "agent_session_userId_status_idx" ON "agent_session" ("userId", "status")`.execute(db);
  await sql`CREATE INDEX "agent_session_updateId_idx" ON "agent_session" ("updateId")`.execute(db);
  await sql`
    CREATE OR REPLACE TRIGGER "agent_session_updatedAt"
    BEFORE UPDATE ON "agent_session"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_session_updatedAt', '{"type":"trigger","name":"agent_session_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_session_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_session\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" = 'trigger_agent_session_updatedAt'
  `.execute(db);

  await sql`DROP TRIGGER IF EXISTS "agent_session_updatedAt" ON "agent_session"`.execute(db);
  await sql`DROP TABLE "agent_session"`.execute(db);
}
