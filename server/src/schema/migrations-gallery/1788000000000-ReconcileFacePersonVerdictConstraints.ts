import { Kysely, sql } from 'kysely';

// Reconciles a data-loss defect caused by editing a deployed migration in place. Two commits amended
// 1787000000000-AddFacePersonVerdict.ts AFTER it had already run against RC/staging instances:
//   - 7ed4e8c4bc6 flipped `face_person_verdict_identityId_fkey` from `ON DELETE CASCADE` to `ON DELETE SET NULL`;
//   - 4a64b158139 rewrote the four `migration_overrides` payloads for its partial indexes from
//     `WHERE "personId" IS NOT NULL` to the parenthesized `WHERE ("personId" IS NOT NULL)` form that
//     `sql-tools`' `asIndexCreate` actually emits.
//
// Kysely records migrations by name only, with no checksum, so 1787000000000 never re-runs on a database that
// already executed it. Those instances are stuck on the original shape: deleting a `face_identity` row (every
// people merge does this) still CASCADE-deletes the verdicts keyed to it — the exact data loss 7ed4e8c4bc6 exists
// to prevent — and they log four override-drift warnings on every boot.
//
// This migration never amends 1787 itself (that in-place edit is the mistake being fixed here). It is instead a
// standalone repair: a no-op on a fresh install, where 1787 already has the current shape, and self-healing on an
// affected database, however many times it runs.
export async function up(db: Kysely<unknown>): Promise<void> {
  // pg_constraint.confdeltype: a = no action, r = restrict, c = cascade, n = set null, d = set default. Only
  // touch the constraint when it is still in the pre-7ed4e8c4bc6 CASCADE shape, so a fresh install — which
  // already has ON DELETE SET NULL from 1787 — does no DDL at all.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'face_person_verdict_identityId_fkey'
          AND confdeltype = 'c'
      ) THEN
        ALTER TABLE "face_person_verdict"
          DROP CONSTRAINT "face_person_verdict_identityId_fkey";
        ALTER TABLE "face_person_verdict"
          ADD CONSTRAINT "face_person_verdict_identityId_fkey"
          FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE SET NULL;
      END IF;
    END $$;
  `.execute(db);

  // Re-write the four partial-index override rows with the parenthesized payloads 4a64b158139 introduced. These
  // are exact copies of 1787's current (post-4a64b158139) `value` strings — on a fresh install the DO UPDATE is a
  // no-op write; on an affected database it repairs the drift.
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore the pre-7ed4e8c4bc6 / pre-4a64b158139 shape, so this migration is genuinely reversible.
  await sql`
    ALTER TABLE "face_person_verdict"
      DROP CONSTRAINT IF EXISTS "face_person_verdict_identityId_fkey"
  `.execute(db);
  await sql`
    ALTER TABLE "face_person_verdict"
      ADD CONSTRAINT "face_person_verdict_identityId_fkey"
      FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE CASCADE
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_personId_assetFaceId_uq', '{"type":"index","name":"face_person_verdict_personId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_personId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"personId\\", \\"assetFaceId\\") WHERE \\"personId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_spacePersonId_assetFaceId_uq', '{"type":"index","name":"face_person_verdict_spacePersonId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_spacePersonId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"assetFaceId\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_spacePersonId_status_distance_idx', '{"type":"index","name":"face_person_verdict_spacePersonId_status_distance_idx","sql":"CREATE INDEX \\"face_person_verdict_spacePersonId_status_distance_idx\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"status\\", \\"distance\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_face_person_verdict_identityId_assetFaceId_idx', '{"type":"index","name":"face_person_verdict_identityId_assetFaceId_idx","sql":"CREATE INDEX \\"face_person_verdict_identityId_assetFaceId_idx\\" ON \\"face_person_verdict\\" (\\"identityId\\", \\"assetFaceId\\") WHERE \\"identityId\\" IS NOT NULL;"}'::jsonb)
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
}
