import { Kysely, sql } from 'kysely';
import { getVectorExtension } from 'src/repositories/database.repository';
import { vectorIndexQuery } from 'src/utils/database';

export async function up(db: Kysely<any>): Promise<void> {
  const vectorExtension = await getVectorExtension(db);

  await sql`CREATE TABLE "pet_search" (
    "faceId" uuid NOT NULL,
    "embedding" vector(512) NOT NULL,
    CONSTRAINT "pet_search_pkey" PRIMARY KEY ("faceId"),
    CONSTRAINT "pet_search_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "asset_face" ("id") ON UPDATE CASCADE ON DELETE CASCADE
  )`.execute(db);

  // vectorIndexQuery() picks vchordrq vs hnsw from the installed extension — do not hardcode
  // `USING hnsw` here, Gallery runs on vchordrq in production.
  await sql.raw(vectorIndexQuery({ vectorExtension, table: 'pet_search', indexName: 'pet_index' })).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "pet_index"`.execute(db);
  await sql`DROP TABLE "pet_search"`.execute(db);
}
