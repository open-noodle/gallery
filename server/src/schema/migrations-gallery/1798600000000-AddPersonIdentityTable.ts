import { Kysely, sql } from 'kysely';

// Moves person."identityId" (and its two indexes and its FK to face_identity, the only fork FK
// on person) into the fork-owned person_identity sidecar keyed by person_group.id.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "person_identity" (
      "personGroupId" uuid NOT NULL,
      "ownerId" uuid NOT NULL,
      "identityId" uuid NOT NULL,
      CONSTRAINT "person_identity_pkey" PRIMARY KEY ("personGroupId"),
      CONSTRAINT "person_identity_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "person_identity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "person_identity_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`CREATE UNIQUE INDEX "person_identity_ownerId_identityId_key" ON "person_identity" ("ownerId", "identityId");`.execute(
    db,
  );
  await sql`CREATE INDEX "person_identity_identityId_idx" ON "person_identity" ("identityId");`.execute(db);
  await sql`
    INSERT INTO "person_identity" ("personGroupId", "ownerId", "identityId")
    SELECT "personGroupId", "ownerId", "identityId" FROM "person" WHERE "identityId" IS NOT NULL;
  `.execute(db);
  await sql`DROP INDEX "person_ownerId_identityId_key";`.execute(db);
  await sql`DROP INDEX "person_identityId_idx";`.execute(db);
  await sql`ALTER TABLE "person" DROP COLUMN "identityId";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN ('index_person_identityId_idx', 'index_person_ownerId_identityId_key');`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person" ADD COLUMN "identityId" uuid REFERENCES "face_identity" ("id") ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`
    UPDATE "person" SET "identityId" = pi."identityId"
    FROM "person_identity" pi
    WHERE pi."personGroupId" = "person"."personGroupId" AND pi."ownerId" = "person"."ownerId";
  `.execute(db);
  await sql`CREATE INDEX "person_identityId_idx" ON "person" ("identityId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "person_ownerId_identityId_key" ON "person" ("ownerId", "identityId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_person_identityId_idx', '{"type":"index","name":"person_identityId_idx","sql":"CREATE INDEX \\"person_identityId_idx\\" ON \\"person\\" (\\"identityId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_person_ownerId_identityId_key', '{"type":"index","name":"person_ownerId_identityId_key","sql":"CREATE UNIQUE INDEX \\"person_ownerId_identityId_key\\" ON \\"person\\" (\\"ownerId\\", \\"identityId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
  await sql`DROP TABLE "person_identity";`.execute(db);
}
