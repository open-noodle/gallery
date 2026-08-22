import { Kysely, sql } from 'kysely';
import { personKeyTarget } from 'src/utils/cluster-groups-order';

// Final-form migration for the shared face-review verdict layer. Replaces three earlier fork migrations
// that were never deployed (AddPersonFaceSuggestion, AddSpacePersonFaceSuggestion,
// AddFaceSuggestionIntentStatuses) — the unified branch ships both face features together, so the table is
// authored once in its final shape rather than created and then altered.
export async function up(db: Kysely<unknown>): Promise<void> {
  // See 1781000000000-AddFaceRepairDecline: on an Immich-to-Gallery switch upstream's ClusterGroups has
  // already dropped `person.id`, so this key must reference `person_group.id` from the start. 1791
  // renames the column in both worlds.
  const personTable = sql.table(await personKeyTarget(db));
  await sql`
    CREATE TABLE "face_person_verdict" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "personId" uuid,
      "spacePersonId" uuid,
      "identityId" uuid,
      "assetFaceId" uuid NOT NULL,
      "distance" double precision,
      "status" character varying NOT NULL DEFAULT 'pending',
      "source" character varying NOT NULL DEFAULT 'suggestion',
      "actorId" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "face_person_verdict_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_person_verdict_status_chk" CHECK ("status" IN ('pending', 'rejected', 'ignored')),
      CONSTRAINT "face_person_verdict_source_chk" CHECK ("source" IN ('suggestion', 'cleanup')),
      CONSTRAINT "face_person_verdict_single_target_chk" CHECK (num_nonnulls("personId", "spacePersonId") <= 1),
      CONSTRAINT "face_person_verdict_personId_fkey" FOREIGN KEY ("personId") REFERENCES ${personTable} ("id") ON DELETE SET NULL,
      CONSTRAINT "face_person_verdict_spacePersonId_fkey" FOREIGN KEY ("spacePersonId") REFERENCES "shared_space_person" ("id") ON DELETE SET NULL,
      CONSTRAINT "face_person_verdict_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE SET NULL,
      CONSTRAINT "face_person_verdict_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE,
      CONSTRAINT "face_person_verdict_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON DELETE SET NULL
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "face_person_verdict_personId_assetFaceId_uq"
    ON "face_person_verdict" ("personId", "assetFaceId")
    WHERE "personId" IS NOT NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX "face_person_verdict_spacePersonId_assetFaceId_uq"
    ON "face_person_verdict" ("spacePersonId", "assetFaceId")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX "face_person_verdict_personId_status_distance_idx"
    ON "face_person_verdict" ("personId", "status", "distance")
  `.execute(db);
  await sql`
    CREATE INDEX "face_person_verdict_spacePersonId_status_distance_idx"
    ON "face_person_verdict" ("spacePersonId", "status", "distance")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX "face_person_verdict_identityId_assetFaceId_idx"
    ON "face_person_verdict" ("identityId", "assetFaceId")
    WHERE "identityId" IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX "face_person_verdict_assetFaceId_idx"
    ON "face_person_verdict" ("assetFaceId")
  `.execute(db);
  await sql`
    CREATE INDEX "face_person_verdict_updateId_idx"
    ON "face_person_verdict" ("updateId")
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "face_person_verdict_updatedAt"
    BEFORE UPDATE ON "face_person_verdict"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  // Partial indexes cannot be expressed by the declarative schema, so each needs an override row or the
  // schema-drift check reports it as unmanaged.
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_personId_assetFaceId_uq', '{"type":"index","name":"face_person_verdict_personId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_personId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"personId\\", \\"assetFaceId\\") WHERE (\\"personId\\" IS NOT NULL);"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_spacePersonId_assetFaceId_uq', '{"type":"index","name":"face_person_verdict_spacePersonId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_spacePersonId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"assetFaceId\\") WHERE (\\"spacePersonId\\" IS NOT NULL);"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_spacePersonId_status_distance_idx', '{"type":"index","name":"face_person_verdict_spacePersonId_status_distance_idx","sql":"CREATE INDEX \\"face_person_verdict_spacePersonId_status_distance_idx\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"status\\", \\"distance\\") WHERE (\\"spacePersonId\\" IS NOT NULL);"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_identityId_assetFaceId_idx', '{"type":"index","name":"face_person_verdict_identityId_assetFaceId_idx","sql":"CREATE INDEX \\"face_person_verdict_identityId_assetFaceId_idx\\" ON \\"face_person_verdict\\" (\\"identityId\\", \\"assetFaceId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_face_person_verdict_updatedAt', '{"type":"trigger","name":"face_person_verdict_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"face_person_verdict_updatedAt\\"\\n  BEFORE UPDATE ON \\"face_person_verdict\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" IN (
      'trigger_face_person_verdict_updatedAt',
      'index_face_person_verdict_personId_assetFaceId_uq',
      'index_face_person_verdict_spacePersonId_assetFaceId_uq',
      'index_face_person_verdict_spacePersonId_status_distance_idx',
      'index_face_person_verdict_identityId_assetFaceId_idx'
    )
  `.execute(db);

  await sql`
    DROP TRIGGER IF EXISTS "face_person_verdict_updatedAt"
    ON "face_person_verdict"
  `.execute(db);

  await sql`DROP TABLE IF EXISTS "face_person_verdict"`.execute(db);
}
