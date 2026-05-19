import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD COLUMN "spacePersonId" uuid
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ALTER COLUMN "personId" DROP NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_spacePersonId_fkey"
    FOREIGN KEY ("spacePersonId") REFERENCES "shared_space_person" ("id") ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_exactly_one_target_chk"
    CHECK (num_nonnulls("personId", "spacePersonId") = 1)
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT "person_face_suggestion_personId_assetFaceId_uq"
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_personId_assetFaceId_uq"
    ON "person_face_suggestion" ("personId", "assetFaceId")
    WHERE "personId" IS NOT NULL
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_person_face_suggestion_personId_assetFaceId_uq', '{"type":"index","name":"person_face_suggestion_personId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"person_face_suggestion_personId_assetFaceId_uq\\" ON \\"person_face_suggestion\\" (\\"personId\\", \\"assetFaceId\\") WHERE \\"personId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_spacePersonId_assetFaceId_uq"
    ON "person_face_suggestion" ("spacePersonId", "assetFaceId")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_person_face_suggestion_spacePersonId_assetFaceId_uq', '{"type":"index","name":"person_face_suggestion_spacePersonId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"person_face_suggestion_spacePersonId_assetFaceId_uq\\" ON \\"person_face_suggestion\\" (\\"spacePersonId\\", \\"assetFaceId\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);

  await sql`
    CREATE INDEX "person_face_suggestion_spacePersonId_status_distance_idx"
    ON "person_face_suggestion" ("spacePersonId", "status", "distance")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_person_face_suggestion_spacePersonId_status_distance_idx', '{"type":"index","name":"person_face_suggestion_spacePersonId_status_distance_idx","sql":"CREATE INDEX \\"person_face_suggestion_spacePersonId_status_distance_idx\\" ON \\"person_face_suggestion\\" (\\"spacePersonId\\", \\"status\\", \\"distance\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('trigger_person_face_suggestion_updatedAt', '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "person_face_suggestion"
    WHERE "personId" IS NULL
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS "person_face_suggestion_spacePersonId_status_distance_idx"
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS "person_face_suggestion_spacePersonId_assetFaceId_uq"
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS "person_face_suggestion_personId_assetFaceId_uq"
  `.execute(db);

  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" IN (
      'index_person_face_suggestion_personId_assetFaceId_uq',
      'index_person_face_suggestion_spacePersonId_assetFaceId_uq',
      'index_person_face_suggestion_spacePersonId_status_distance_idx'
    )
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT IF EXISTS "person_face_suggestion_exactly_one_target_chk"
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT IF EXISTS "person_face_suggestion_spacePersonId_fkey"
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP COLUMN "spacePersonId"
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ALTER COLUMN "personId" SET NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_personId_assetFaceId_uq" UNIQUE ("personId", "assetFaceId")
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('trigger_person_face_suggestion_updatedAt', '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
}
