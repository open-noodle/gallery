import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_operation_plan" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "status" character varying NOT NULL DEFAULT 'proposed',
      "summary" text NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_operation_plan_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_operation_plan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_operation_plan_sessionId_revision_key" UNIQUE ("sessionId", "revision")
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_operation_plan_sessionId_status_idx" ON "agent_operation_plan" ("sessionId", "status")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_operation_plan_updateId_idx" ON "agent_operation_plan" ("updateId")`.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "agent_operation_plan_updatedAt"
    BEFORE UPDATE ON "agent_operation_plan"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_operation_plan_updatedAt', '{"type":"trigger","name":"agent_operation_plan_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_operation_plan_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_operation_plan\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
  `.execute(db);

  await sql`
    CREATE TABLE "agent_operation" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "planId" uuid NOT NULL,
      "type" character varying NOT NULL,
      "position" integer NOT NULL,
      "summary" text NOT NULL,
      "targetKind" character varying NOT NULL,
      "targetId" uuid,
      "temporaryTargetId" character varying,
      "assetIds" jsonb NOT NULL,
      "payload" jsonb NOT NULL,
      "dependencyIds" jsonb NOT NULL,
      "riskLevel" character varying NOT NULL DEFAULT 'low',
      "enabled" boolean NOT NULL DEFAULT true,
      "status" character varying NOT NULL DEFAULT 'proposed',
      "result" jsonb,
      "error" text,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_operation_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_operation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "agent_operation_plan"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_operation_planId_idx" ON "agent_operation" ("planId")`.execute(db);
  await sql`CREATE INDEX "agent_operation_planId_status_idx" ON "agent_operation" ("planId", "status")`.execute(db);
  await sql`CREATE INDEX "agent_operation_planId_position_idx" ON "agent_operation" ("planId", "position")`.execute(db);
  await sql`CREATE INDEX "agent_operation_updateId_idx" ON "agent_operation" ("updateId")`.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "agent_operation_updatedAt"
    BEFORE UPDATE ON "agent_operation"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_operation_updatedAt', '{"type":"trigger","name":"agent_operation_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_operation_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_operation\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_agent_operation_updatedAt'`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "agent_operation_updatedAt" ON "agent_operation"`.execute(db);
  await sql`DROP INDEX "agent_operation_updateId_idx"`.execute(db);
  await sql`DROP INDEX "agent_operation_planId_position_idx"`.execute(db);
  await sql`DROP INDEX "agent_operation_planId_status_idx"`.execute(db);
  await sql`DROP INDEX "agent_operation_planId_idx"`.execute(db);
  await sql`DROP TABLE "agent_operation"`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_agent_operation_plan_updatedAt'`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "agent_operation_plan_updatedAt" ON "agent_operation_plan"`.execute(db);
  await sql`DROP INDEX "agent_operation_plan_updateId_idx"`.execute(db);
  await sql`DROP INDEX "agent_operation_plan_sessionId_status_idx"`.execute(db);
  await sql`DROP TABLE "agent_operation_plan"`.execute(db);
}
