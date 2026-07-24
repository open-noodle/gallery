// Slice 2 (pet recognition phase 2): pet_search stores one 512-d embedding per pet asset_face,
// mirroring face_search but isolated to its own table so pet and human embeddings never mix in a
// kNN search (see spec §4.4). This file only proves the schema/migration land correctly — a
// dedicated repository arrives in a later slice, so these tests talk to ctx.database directly,
// mirroring face-backfill-contributions.medium.spec.ts.
import { Kysely, sql } from 'kysely';
import { VECTOR_INDEX_TABLES } from 'src/constants';
import { VectorIndex } from 'src/enum';
import { probes } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx };
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('pet_search', () => {
  // spec 2.4: the vector-index plumbing (constants.ts + database.repository.ts) must know about
  // pet_search the same way it knows about face_search/smart_search, or reindexing and probe
  // tuning silently skip the new index.
  it('registers VectorIndex.Pet in VECTOR_INDEX_TABLES and probes', () => {
    expect(VECTOR_INDEX_TABLES[VectorIndex.Pet]).toBe('pet_search');
    expect(typeof probes[VectorIndex.Pet]).toBe('number');
  });

  it('round-trips an embedding inserted against an asset_face', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
    const embedding = newEmbedding();

    await ctx.database.insertInto('pet_search').values({ faceId: assetFace.id, embedding }).execute();

    const row = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.faceId).toBe(assetFace.id);
    // The vector column is single-precision (float4), so round-tripping through Postgres loses
    // precision past ~7-8 significant digits — compare parsed values with tolerance, not the raw
    // string, mirroring how other specs compare embeddings (e.g. person.repository.spec.ts's
    // toBeCloseTo(0) on a computed distance).
    const inserted = JSON.parse(embedding) as number[];
    const stored = JSON.parse(row.embedding) as number[];
    expect(stored).toHaveLength(inserted.length);
    for (const [index, value] of inserted.entries()) {
      expect(stored[index]).toBeCloseTo(value, 5);
    }
  });

  it('cascades the pet_search row away when its asset_face is deleted', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: assetFace.id, embedding: newEmbedding() })
      .execute();

    await ctx.database.deleteFrom('asset_face').where('id', '=', assetFace.id).execute();

    const remaining = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', assetFace.id)
      .execute();
    expect(remaining).toHaveLength(0);
  });

  it('has a pet_index vector index on the table', async () => {
    const { ctx } = setup();
    const { rows } = await sql<{
      indexname: string;
    }>`SELECT indexname FROM pg_indexes WHERE tablename = 'pet_search'`.execute(ctx.database);

    expect(rows.map((row) => row.indexname)).toContain('pet_index');
  });
});
