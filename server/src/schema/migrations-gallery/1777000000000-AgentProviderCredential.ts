import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_provider_credential" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL,
      "providerType" character varying NOT NULL,
      "label" character varying NOT NULL,
      "baseUrl" character varying,
      "encryptedSecret" text NOT NULL,
      "secretVersion" integer NOT NULL DEFAULT 1,
      "models" character varying[] NOT NULL,
      "defaultModel" character varying,
      "lastUsedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_provider_credential_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_provider_credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_provider_credential_userId_idx" ON "agent_provider_credential" ("userId")`.execute(db);
  await sql`CREATE INDEX "agent_provider_credential_updateId_idx" ON "agent_provider_credential" ("updateId")`.execute(
    db,
  );
  await sql`
    CREATE OR REPLACE TRIGGER "agent_provider_credential_updatedAt"
    BEFORE UPDATE ON "agent_provider_credential"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_provider_credential_updatedAt', '{"type":"trigger","name":"agent_provider_credential_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_provider_credential_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_provider_credential\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" = 'trigger_agent_provider_credential_updatedAt'
  `.execute(db);

  await sql`DROP TRIGGER IF EXISTS "agent_provider_credential_updatedAt" ON "agent_provider_credential"`.execute(db);
  await sql`DROP TABLE "agent_provider_credential"`.execute(db);
}
