import { Kysely, sql } from 'kysely';
import { getVectorExtension } from 'src/repositories/database.repository';
import { vectorIndexQuery } from 'src/utils/database';

export async function up(db: Kysely<any>): Promise<void> {
  const vectorExtension = await getVectorExtension(db);

  await sql`CREATE TABLE "pet_search" (
    "faceId" uuid NOT NULL,
    "embedding" vector(512) NOT NULL,
    CONSTRAINT "pet_search_pkey" PRIMARY KEY ("faceId"),
    CONSTRAINT "pet_search_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "asset_face" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
  )`.execute(db);

  // vectorIndexQuery() picks vchordrq vs hnsw from the installed extension — do not hardcode
  // `USING hnsw` here, Gallery runs on vchordrq in production.
  await sql.raw(vectorIndexQuery({ vectorExtension, table: 'pet_search', indexName: 'pet_index' })).execute(db);

  // The index above is raw SQL whose shape depends on the installed extension, so the schema
  // differ has no way to reconcile it against the `@Index` decorator on PetSearchTable and reports
  // it as both unexpected and missing (medium test `schema-drift.spec.ts`). Registering the
  // declared form as a migration override is how `face_search`'s identical `face_index` is
  // reconciled (upstream 1751924596408-AddOverrides / 1752004072340-UpdateIndexOverrides); pet
  // recognition is the same table shape, so it needs the same row.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_pet_index', '{"sql":"CREATE INDEX \\"pet_index\\" ON \\"pet_search\\" USING hnsw (embedding vector_cosine_ops) WITH (ef_construction = 300, m = 16);","name":"pet_index","type":"index"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_pet_index'`.execute(db);
  await sql`DROP INDEX IF EXISTS "pet_index"`.execute(db);
  await sql`DROP TABLE "pet_search"`.execute(db);
}
