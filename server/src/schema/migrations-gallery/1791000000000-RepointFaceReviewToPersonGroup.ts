import { Kysely, sql } from 'kysely';

/**
 * Runs AFTER upstream's `1787148183729-ClusterGroups`, and completes what
 * `1787100000000-DropPersonFksBeforeClusterGroups` began.
 *
 * Upstream deleted `person.id` and made the primary key `(ownerId, personGroupId)`. Gallery's three
 * face-review columns previously referenced `person.id`; they are repointed at `person_group.id`.
 *
 * No data migration is required. Upstream's migration seeds the new ids from the old ones:
 *
 *   INSERT INTO person_group ("id", ...) SELECT "id", ... FROM person;
 *   UPDATE person SET "personGroupId" = "id";
 *
 * so every value already stored in these columns is still the correct key — only the name of the
 * thing it points at changed. This migration is therefore purely structural.
 *
 * It also installs the unique index that holds option M together: Gallery does not adopt upstream's
 * cluster-groups feature (cross-user recognition is answered by shared spaces + `face_identity`), so
 * a person_group here always holds exactly one person row. That is what lets the fork address a
 * person by `personGroupId` alone. The index makes it a database-enforced fact rather than a
 * convention — see PersonRepository.getByGroupIdOnly.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Guard: option M is only sound while a group holds one person. Fail with an explanation rather
  // than a bare uniqueness violation.
  const duplicates = await sql<{ count: string }>`
    SELECT count(*)::text AS count
    FROM (SELECT "personGroupId" FROM "person" GROUP BY "personGroupId" HAVING count(*) > 1) AS d;
  `.execute(db);
  const count = Number(duplicates.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(
      `Cannot enforce one person per person_group: ${count} group(s) hold multiple person rows. ` +
        `This instance has multi-user cluster groups, which Gallery does not support.`,
    );
  }

  await sql`ALTER TABLE "face_person_verdict" RENAME COLUMN "personId" TO "personGroupId";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" RENAME COLUMN "personId" TO "personGroupId";`.execute(db);
  await sql`ALTER TABLE "face_repair_scan_flagged_face" RENAME COLUMN "personId" TO "personGroupId";`.execute(db);

  // RENAME COLUMN rewrites index/constraint expressions but keeps their names.
  await sql`ALTER INDEX "face_person_verdict_personId_status_distance_idx" RENAME TO "face_person_verdict_personGroupId_status_distance_idx";`.execute(
    db,
  );
  await sql`DROP INDEX "face_person_verdict_personId_assetFaceId_uq";`.execute(db);
  await sql`CREATE UNIQUE INDEX "face_person_verdict_personGroupId_assetFaceId_uq" ON "face_person_verdict" ("personGroupId", "assetFaceId") WHERE ("personGroupId" IS NOT NULL);`.execute(
    db,
  );
  await sql`ALTER INDEX "face_repair_decline_personId_idx" RENAME TO "face_repair_decline_personGroupId_idx";`.execute(
    db,
  );
  await sql`ALTER INDEX "face_repair_scan_flagged_face_scanId_personId_idx" RENAME TO "face_repair_scan_flagged_face_scanId_personGroupId_idx";`.execute(
    db,
  );

  await sql`ALTER TABLE "face_person_verdict" ADD CONSTRAINT "face_person_verdict_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`ALTER TABLE "face_repair_decline" ADD CONSTRAINT "face_repair_decline_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON DELETE CASCADE;`.execute(
    db,
  );
  await sql`ALTER TABLE "face_repair_decline" ADD CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey" FOREIGN KEY ("suspectedOwnerId") REFERENCES "person_group" ("id") ON DELETE CASCADE;`.execute(
    db,
  );

  await sql`CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId");`.execute(db);

  // The fork's partial index on the old asset_face.personId is redundant now: upstream ships
  // ("personGroupId","assetId") and ("assetId","personGroupId") on the same table.
  await sql`DROP INDEX "asset_face_personId_idx";`.execute(db);

  // Partial-index predicates live in migration_overrides (they do not round-trip through
  // pg_get_expr). Renaming the columns above invalidates the recorded payloads.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_face_person_verdict_personGroupId_assetFaceId_uq', '{"type":"index","name":"face_person_verdict_personGroupId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_personGroupId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"personGroupId\\", \\"assetFaceId\\") WHERE (\\"personGroupId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_face_personId_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_face_person_verdict_personId_assetFaceId_uq';`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "person_personGroupId_key";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" DROP CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" DROP CONSTRAINT "face_repair_decline_personGroupId_fkey";`.execute(db);
  await sql`ALTER TABLE "face_person_verdict" DROP CONSTRAINT "face_person_verdict_personGroupId_fkey";`.execute(db);
  await sql`ALTER INDEX "face_repair_scan_flagged_face_scanId_personGroupId_idx" RENAME TO "face_repair_scan_flagged_face_scanId_personId_idx";`.execute(
    db,
  );
  await sql`ALTER INDEX "face_repair_decline_personGroupId_idx" RENAME TO "face_repair_decline_personId_idx";`.execute(
    db,
  );
  await sql`ALTER INDEX "face_person_verdict_personGroupId_assetFaceId_uq" RENAME TO "face_person_verdict_personId_assetFaceId_uq";`.execute(
    db,
  );
  await sql`ALTER INDEX "face_person_verdict_personGroupId_status_distance_idx" RENAME TO "face_person_verdict_personId_status_distance_idx";`.execute(
    db,
  );
  await sql`ALTER TABLE "face_repair_scan_flagged_face" RENAME COLUMN "personGroupId" TO "personId";`.execute(db);
  await sql`ALTER TABLE "face_repair_decline" RENAME COLUMN "personGroupId" TO "personId";`.execute(db);
  await sql`ALTER TABLE "face_person_verdict" RENAME COLUMN "personGroupId" TO "personId";`.execute(db);
}
