import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "face_identity_representativeFaceId_idx";`.execute(db);
  await sql`CREATE INDEX "face_identity_representativeFaceId_idx" ON "face_identity" ("representativeFaceId") WHERE ("representativeFaceId" IS NOT NULL);`.execute(
    db,
  );
  await sql`DROP INDEX "person_identityId_idx";`.execute(db);
  await sql`CREATE INDEX "person_identityId_idx" ON "person" ("identityId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`DROP INDEX "person_ownerId_identityId_key";`.execute(db);
  await sql`CREATE UNIQUE INDEX "person_ownerId_identityId_key" ON "person" ("ownerId", "identityId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`DROP INDEX "asset_face_personId_idx";`.execute(db);
  await sql`CREATE INDEX "asset_face_personId_idx" ON "asset_face" ("personId") WHERE ("personId" IS NOT NULL);`.execute(
    db,
  );
  await sql`DROP INDEX "shared_space_person_identityId_spaceId_idx";`.execute(db);
  await sql`CREATE INDEX "shared_space_person_identityId_spaceId_idx" ON "shared_space_person" ("identityId", "spaceId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`DROP INDEX "shared_space_person_spaceId_identityId_key";`.execute(db);
  await sql`CREATE UNIQUE INDEX "shared_space_person_spaceId_identityId_key" ON "shared_space_person" ("spaceId", "identityId") WHERE ("identityId" IS NOT NULL);`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"face_identity_representativeFaceId_idx","sql":"CREATE INDEX \\"face_identity_representativeFaceId_idx\\" ON \\"face_identity\\" (\\"representativeFaceId\\") WHERE (\\"representativeFaceId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_face_identity_representativeFaceId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"person_identityId_idx","sql":"CREATE INDEX \\"person_identityId_idx\\" ON \\"person\\" (\\"identityId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_person_identityId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"person_ownerId_identityId_key","sql":"CREATE UNIQUE INDEX \\"person_ownerId_identityId_key\\" ON \\"person\\" (\\"ownerId\\", \\"identityId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_person_ownerId_identityId_key';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"asset_face_personId_idx","sql":"CREATE INDEX \\"asset_face_personId_idx\\" ON \\"asset_face\\" (\\"personId\\") WHERE (\\"personId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_asset_face_personId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"shared_space_person_identityId_spaceId_idx","sql":"CREATE INDEX \\"shared_space_person_identityId_spaceId_idx\\" ON \\"shared_space_person\\" (\\"identityId\\", \\"spaceId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_shared_space_person_identityId_spaceId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"shared_space_person_spaceId_identityId_key","sql":"CREATE UNIQUE INDEX \\"shared_space_person_spaceId_identityId_key\\" ON \\"shared_space_person\\" (\\"spaceId\\", \\"identityId\\") WHERE (\\"identityId\\" IS NOT NULL);"}'::jsonb WHERE "name" = 'index_shared_space_person_spaceId_identityId_key';`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_face_personId_idx";`.execute(db);
  await sql`CREATE INDEX "asset_face_personId_idx" ON "asset_face" ("personId") WHERE (("personId" IS NOT NULL));`.execute(
    db,
  );
  await sql`DROP INDEX "face_identity_representativeFaceId_idx";`.execute(db);
  await sql`CREATE INDEX "face_identity_representativeFaceId_idx" ON "face_identity" ("representativeFaceId") WHERE (("representativeFaceId" IS NOT NULL));`.execute(
    db,
  );
  await sql`DROP INDEX "person_identityId_idx";`.execute(db);
  await sql`CREATE INDEX "person_identityId_idx" ON "person" ("identityId") WHERE (("identityId" IS NOT NULL));`.execute(
    db,
  );
  await sql`DROP INDEX "person_ownerId_identityId_key";`.execute(db);
  await sql`CREATE UNIQUE INDEX "person_ownerId_identityId_key" ON "person" ("ownerId", "identityId") WHERE (("identityId" IS NOT NULL));`.execute(
    db,
  );
  await sql`DROP INDEX "shared_space_person_spaceId_identityId_key";`.execute(db);
  await sql`CREATE UNIQUE INDEX "shared_space_person_spaceId_identityId_key" ON "shared_space_person" ("spaceId", "identityId") WHERE (("identityId" IS NOT NULL));`.execute(
    db,
  );
  await sql`DROP INDEX "shared_space_person_identityId_spaceId_idx";`.execute(db);
  await sql`CREATE INDEX "shared_space_person_identityId_spaceId_idx" ON "shared_space_person" ("identityId", "spaceId") WHERE (("identityId" IS NOT NULL));`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \\"face_identity_representativeFaceId_idx\\" ON \\"face_identity\\" (\\"representativeFaceId\\") WHERE \\"representativeFaceId\\" IS NOT NULL;","name":"face_identity_representativeFaceId_idx","type":"index"}'::jsonb WHERE "name" = 'index_face_identity_representativeFaceId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \\"person_identityId_idx\\" ON \\"person\\" (\\"identityId\\") WHERE \\"identityId\\" IS NOT NULL;","name":"person_identityId_idx","type":"index"}'::jsonb WHERE "name" = 'index_person_identityId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE UNIQUE INDEX \\"person_ownerId_identityId_key\\" ON \\"person\\" (\\"ownerId\\", \\"identityId\\") WHERE \\"identityId\\" IS NOT NULL;","name":"person_ownerId_identityId_key","type":"index"}'::jsonb WHERE "name" = 'index_person_ownerId_identityId_key';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \\"asset_face_personId_idx\\" ON \\"asset_face\\" (\\"personId\\") WHERE \\"personId\\" IS NOT NULL;","name":"asset_face_personId_idx","type":"index"}'::jsonb WHERE "name" = 'index_asset_face_personId_idx';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE UNIQUE INDEX \\"shared_space_person_spaceId_identityId_key\\" ON \\"shared_space_person\\" (\\"spaceId\\", \\"identityId\\") WHERE \\"identityId\\" IS NOT NULL;","name":"shared_space_person_spaceId_identityId_key","type":"index"}'::jsonb WHERE "name" = 'index_shared_space_person_spaceId_identityId_key';`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \\"shared_space_person_identityId_spaceId_idx\\" ON \\"shared_space_person\\" (\\"identityId\\", \\"spaceId\\") WHERE \\"identityId\\" IS NOT NULL;","name":"shared_space_person_identityId_spaceId_idx","type":"index"}'::jsonb WHERE "name" = 'index_shared_space_person_identityId_spaceId_idx';`.execute(
    db,
  );
}
