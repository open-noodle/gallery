import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "person_face_suggestion" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "personId" uuid NOT NULL,
      "assetFaceId" uuid NOT NULL,
      "distance" double precision NOT NULL,
      "status" character varying NOT NULL DEFAULT 'pending',
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "person_face_suggestion_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "person_face_suggestion_status_chk" CHECK ("status" IN ('pending', 'confirmed', 'dismissed')),
      CONSTRAINT "person_face_suggestion_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person" ("id") ON DELETE CASCADE,
      CONSTRAINT "person_face_suggestion_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_personId_assetFaceId_uq"
    ON "person_face_suggestion" ("personId", "assetFaceId")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_personId_status_distance_idx"
    ON "person_face_suggestion" ("personId", "status", "distance")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_assetFaceId_idx"
    ON "person_face_suggestion" ("assetFaceId")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_updateId_idx"
    ON "person_face_suggestion" ("updateId")
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "person_face_suggestion_updatedAt"
    BEFORE UPDATE ON "person_face_suggestion"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_person_face_suggestion_updatedAt', '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" = 'trigger_person_face_suggestion_updatedAt'
  `.execute(db);

  await sql`
    DROP TRIGGER IF EXISTS "person_face_suggestion_updatedAt"
    ON "person_face_suggestion"
  `.execute(db);

  await sql`DROP TABLE IF EXISTS "person_face_suggestion"`.execute(db);
}
