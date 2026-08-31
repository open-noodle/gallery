import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "family_union" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "status" character varying NOT NULL DEFAULT 'partnered',
      "startDate" date,
      "endDate" date,
      "partnerKey" text,
      "createdById" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "family_union_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "family_union_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE SET NULL
    );
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "family_union_updatedAt"
      BEFORE UPDATE ON "family_union"
      FOR EACH ROW
      EXECUTE FUNCTION updated_at();
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_union_updatedAt', '{"type":"trigger","name":"family_union_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_union_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_union\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );

  await sql`
    CREATE TABLE "family_union_partner" (
      "unionId" uuid NOT NULL,
      "identityId" uuid NOT NULL,
      CONSTRAINT "family_union_partner_pkey" PRIMARY KEY ("unionId", "identityId"),
      CONSTRAINT "family_union_partner_unionId_fkey" FOREIGN KEY ("unionId") REFERENCES "family_union" ("id") ON DELETE CASCADE,
      CONSTRAINT "family_union_partner_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE CASCADE
    );
  `.execute(db);

  await sql`
    CREATE TABLE "family_union_child" (
      "unionId" uuid NOT NULL,
      "identityId" uuid NOT NULL,
      CONSTRAINT "family_union_child_pkey" PRIMARY KEY ("unionId", "identityId"),
      CONSTRAINT "family_union_child_unionId_fkey" FOREIGN KEY ("unionId") REFERENCES "family_union" ("id") ON DELETE CASCADE,
      CONSTRAINT "family_union_child_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE CASCADE
    );
  `.execute(db);

  await sql`
    CREATE TABLE "family_access" (
      "userId" uuid NOT NULL,
      "level" character varying NOT NULL,
      "grantedById" uuid,
      "grantedAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "family_access_pkey" PRIMARY KEY ("userId"),
      CONSTRAINT "family_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE,
      CONSTRAINT "family_access_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "user" ("id") ON DELETE SET NULL
    );
  `.execute(db);

  await sql`CREATE INDEX "family_union_updateId_idx" ON "family_union" ("updateId")`.execute(db);
  await sql`CREATE INDEX "family_union_createdById_idx" ON "family_union" ("createdById")`.execute(db);
  await sql`CREATE INDEX "family_union_partner_identityId_idx" ON "family_union_partner" ("identityId")`.execute(db);
  await sql`CREATE INDEX "family_union_child_identityId_idx" ON "family_union_child" ("identityId")`.execute(db);
  await sql`CREATE INDEX "family_access_grantedById_idx" ON "family_access" ("grantedById")`.execute(db);

  await sql`CREATE UNIQUE INDEX "family_union_partner_key_uq" ON "family_union" ("partnerKey") WHERE "partnerKey" IS NOT NULL`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_family_union_partner_key_uq', '{"type":"index","name":"family_union_partner_key_uq","sql":"CREATE UNIQUE INDEX \\"family_union_partner_key_uq\\" ON \\"family_union\\" (\\"partnerKey\\") WHERE (\\"partnerKey\\" IS NOT NULL);"}'::jsonb) ON CONFLICT ("name") DO NOTHING;`.execute(
    db,
  );

  await sql`ALTER TABLE "face_identity" ADD "gender" character varying`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "face_identity" DROP COLUMN "gender"`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_family_union_partner_key_uq';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_union_updatedAt';`.execute(db);
  await sql`DROP TRIGGER "family_union_updatedAt" ON "family_union"`.execute(db);
  await sql`DROP TABLE "family_access"`.execute(db);
  await sql`DROP TABLE "family_union_child"`.execute(db);
  await sql`DROP TABLE "family_union_partner"`.execute(db);
  await sql`DROP TABLE "family_union"`.execute(db);
}
