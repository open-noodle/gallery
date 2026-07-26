// Slice 2 (pet recognition phase 2): pet_search stores one 512-d embedding per pet asset_face,
// mirroring face_search but isolated to its own table so pet and human embeddings never mix in a
// kNN search (see spec §4.4). The `describe('pet_search', ...)` block below only proves the
// schema/migration land correctly, so those tests talk to ctx.database directly, mirroring
// face-backfill-contributions.medium.spec.ts. Slice 4 (below) adds the repository methods
// (PersonRepository.refreshPetFaces, SearchRepository.searchPets) that write/read pet_search.
import { Kysely, sql } from 'kysely';
import { VECTOR_INDEX_TABLES } from 'src/constants';
import { VectorIndex } from 'src/enum';
import { probes } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding, newUuid } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [PersonRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  return { ctx };
};

// Two clusters on disjoint embedding axes are maximally dissimilar (cosine distance ~1.0). Mirrors
// axisEmbedding/blendedEmbedding in face-identity.repository.spec.ts:244-267 — reused here (rather
// than random newEmbedding() vectors) so distance-threshold tests (4.5) have known, reproducible
// distances instead of relying on the all-positive random components of newEmbedding() staying apart.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

// A 0/1 vector with `firstHalfOnes` ones in [0,256) and `secondHalfOnes` ones in [256,512). Against an
// all-ones-first-half centroid (axisEmbedding('first')), cosine distance = 1 - firstHalfOnes/256 when the
// total ones = 256. So blendedEmbedding(140,116) sits at distance ~0.453 and (116,140) at ~0.547 —
// straddling a 0.5 maxDistance guard.
const blendedEmbedding = (firstHalfOnes: number, secondHalfOnes: number) => {
  const values = Array.from({ length: 512 }, (_, index) => {
    if (index < firstHalfOnes) {
      return 1;
    }
    if (index >= 256 && index < 256 + secondHalfOnes) {
      return 1;
    }
    return 0;
  });
  return '[' + values.join(',') + ']';
};

const newPetFace = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { ownerId: string; embedding: string; personId?: string | null },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: input.personId ?? null });
  await ctx.database.insertInto('pet_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
  return { asset, assetFace };
};

const newHumanFace = async (ctx: ReturnType<typeof setup>['ctx'], input: { ownerId: string; embedding: string }) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
  return { asset, assetFace };
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
    await ctx.database.insertInto('pet_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    await ctx.database.deleteFrom('asset_face').where('id', '=', assetFace.id).execute();

    const remaining = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', assetFace.id)
      .execute();
    expect(remaining).toHaveLength(0);
  });

  it('R4.6 has a nullable species text column (migration 1785200000000)', async () => {
    const { ctx } = setup();
    const { rows } = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>`SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'pet_search' AND column_name = 'species'`.execute(ctx.database);

    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('has a pet_index vector index on the table', async () => {
    const { ctx } = setup();
    const { rows } = await sql<{
      indexname: string;
    }>`SELECT indexname FROM pg_indexes WHERE tablename = 'pet_search'`.execute(ctx.database);

    expect(rows.map((row) => row.indexname)).toContain('pet_index');
  });
});

describe('PersonRepository.refreshPetFaces', () => {
  // 4.4
  it('inserts an asset_face and a pet_search row under the caller-supplied face id', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const embedding = newEmbedding();
    const faceId = newUuid();

    await personRepository.refreshPetFaces(
      [
        {
          id: faceId,
          assetId: asset.id,
          imageWidth: 200,
          imageHeight: 200,
          boundingBoxX1: 10,
          boundingBoxY1: 10,
          boundingBoxX2: 60,
          boundingBoxY2: 60,
        },
      ],
      [{ faceId, embedding, species: 'dog' }],
    );

    const faceRow = await ctx.database
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(faceRow.assetId).toBe(asset.id);
    expect(faceRow.boundingBoxX1).toBe(10);

    const petSearchRow = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(petSearchRow.faceId).toBe(faceId);
    // R4.5: species round-trips through the new column.
    expect(petSearchRow.species).toBe('dog');
    const stored = JSON.parse(petSearchRow.embedding) as number[];
    const inserted = JSON.parse(embedding) as number[];
    expect(stored).toHaveLength(inserted.length);
  });

  it('R4.7 lands each embedding on its own face by id, not by insert order', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const firstEmbedding = axisEmbedding('first');
    const secondEmbedding = axisEmbedding('second');
    const firstFaceId = newUuid();
    const secondFaceId = newUuid();

    await personRepository.refreshPetFaces(
      [
        { id: firstFaceId, assetId: asset.id, boundingBoxX1: 1, boundingBoxY1: 1, boundingBoxX2: 2, boundingBoxY2: 2 },
        { id: secondFaceId, assetId: asset.id, boundingBoxX1: 3, boundingBoxY1: 3, boundingBoxX2: 4, boundingBoxY2: 4 },
      ],
      // Deliberately supplied in the reverse order of facesToAdd: pairing is by faceId, so the
      // result must be unaffected. Under the old positional pairing this test cross-wires.
      [
        { faceId: secondFaceId, embedding: secondEmbedding, species: 'cat' },
        { faceId: firstFaceId, embedding: firstEmbedding, species: 'dog' },
      ],
    );

    const rows = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', 'in', [firstFaceId, secondFaceId])
      .execute();
    const byFaceId = new Map(rows.map((row) => [row.faceId, row]));
    expect(JSON.parse(byFaceId.get(firstFaceId)!.embedding)).toEqual(JSON.parse(firstEmbedding));
    expect(byFaceId.get(firstFaceId)!.species).toBe('dog');
    expect(JSON.parse(byFaceId.get(secondFaceId)!.embedding)).toEqual(JSON.parse(secondEmbedding));
    expect(byFaceId.get(secondFaceId)!.species).toBe('cat');
  });

  it('R4.5 accepts a null species, so pre-migration rows stay writable and readable', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const faceId = newUuid();

    await personRepository.refreshPetFaces(
      [{ id: faceId, assetId: asset.id, boundingBoxX1: 1, boundingBoxY1: 1, boundingBoxX2: 2, boundingBoxY2: 2 }],
      [{ faceId, embedding: axisEmbedding('first'), species: null }],
    );

    const row = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(row.species).toBeNull();
  });

  it('R4.8 throws when the embedding count does not match the face count', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const faceId = newUuid();

    await expect(
      personRepository.refreshPetFaces(
        [
          { id: faceId, assetId: asset.id, boundingBoxX1: 1, boundingBoxY1: 1, boundingBoxX2: 2, boundingBoxY2: 2 },
          { id: newUuid(), assetId: asset.id, boundingBoxX1: 3, boundingBoxY1: 3, boundingBoxX2: 4, boundingBoxY2: 4 },
        ],
        [{ faceId, embedding: axisEmbedding('first'), species: 'dog' }],
      ),
    ).rejects.toThrow('one embedding per face');

    // The guard runs before the transaction, so nothing was written.
    expect(await ctx.database.selectFrom('asset_face').select(['id']).where('id', '=', faceId).execute()).toHaveLength(
      0,
    );
  });

  it('R4.8 throws when an embedding names a face that is not being inserted', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const faceId = newUuid();
    const strayFaceId = newUuid();

    await expect(
      personRepository.refreshPetFaces(
        [{ id: faceId, assetId: asset.id, boundingBoxX1: 1, boundingBoxY1: 1, boundingBoxX2: 2, boundingBoxY2: 2 }],
        [{ faceId: strayFaceId, embedding: axisEmbedding('first'), species: 'dog' }],
      ),
    ).rejects.toThrow(`unknown face ${strayFaceId}`);

    expect(await ctx.database.selectFrom('asset_face').select(['id']).where('id', '=', faceId).execute()).toHaveLength(
      0,
    );
  });

  it('is a no-op for empty input rather than issuing malformed SQL', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);

    await expect(personRepository.refreshPetFaces([], [])).resolves.toBeUndefined();
  });
});

describe('SearchRepository.searchPets', () => {
  // 4.5
  it('orders results by cosine distance and honours maxDistance', async () => {
    const { ctx } = setup();
    const searchRepository = ctx.get(SearchRepository);
    const { user } = await ctx.newUser();
    const query = axisEmbedding('first');
    const { assetFace: nearFace } = await newPetFace(ctx, {
      ownerId: user.id,
      embedding: blendedEmbedding(140, 116), // distance ~0.453
    });
    const { assetFace: farFace } = await newPetFace(ctx, {
      ownerId: user.id,
      embedding: blendedEmbedding(116, 140), // distance ~0.547
    });

    const loose = await searchRepository.searchPets({
      userIds: [user.id],
      embedding: query,
      numResults: 10,
      maxDistance: 0.6,
    });
    expect(loose.map((result) => result.id)).toEqual([nearFace.id, farFace.id]);

    const tight = await searchRepository.searchPets({
      userIds: [user.id],
      embedding: query,
      numResults: 10,
      maxDistance: 0.5,
    });
    expect(tight.map((result) => result.id)).toEqual([nearFace.id]);
  });

  // 4.6
  it('only returns pet faces owned by the given user', async () => {
    const { ctx } = setup();
    const searchRepository = ctx.get(SearchRepository);
    const { user: owner } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const query = axisEmbedding('first');
    const { assetFace: ownFace } = await newPetFace(ctx, { ownerId: owner.id, embedding: query });
    await newPetFace(ctx, { ownerId: otherUser.id, embedding: query });

    const results = await searchRepository.searchPets({
      userIds: [owner.id],
      embedding: query,
      numResults: 10,
      maxDistance: 0.1,
    });

    expect(results.map((result) => result.id)).toEqual([ownFace.id]);
  });

  // 4.7
  it('excludes unassigned faces when hasPerson is true', async () => {
    const { ctx } = setup();
    const searchRepository = ctx.get(SearchRepository);
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const query = axisEmbedding('first');
    const { assetFace: assignedFace } = await newPetFace(ctx, {
      ownerId: user.id,
      embedding: query,
      personId: person.id,
    });
    await newPetFace(ctx, { ownerId: user.id, embedding: query, personId: null });

    const results = await searchRepository.searchPets({
      userIds: [user.id],
      embedding: query,
      numResults: 10,
      maxDistance: 0.1,
      hasPerson: true,
    });

    expect(results.map((result) => result.id)).toEqual([assignedFace.id]);
  });

  // 4.8: proves the separate-table design decision (§4.4) — a human face_search row with a
  // matching embedding must never leak into a pet search.
  it('never returns rows from face_search, even with a matching embedding', async () => {
    const { ctx } = setup();
    const searchRepository = ctx.get(SearchRepository);
    const { user } = await ctx.newUser();
    const query = axisEmbedding('first');
    const { assetFace: petFace } = await newPetFace(ctx, { ownerId: user.id, embedding: query });
    const { assetFace: humanFace } = await newHumanFace(ctx, { ownerId: user.id, embedding: query });

    const results = await searchRepository.searchPets({
      userIds: [user.id],
      embedding: query,
      numResults: 10,
      maxDistance: 0.1,
    });

    expect(results.map((result) => result.id)).toEqual([petFace.id]);
    expect(results.map((result) => result.id)).not.toContain(humanFace.id);
  });

  it('rejects a numResults below 1, mirroring searchFaces', () => {
    const { ctx } = setup();
    const searchRepository = ctx.get(SearchRepository);

    expect(() =>
      searchRepository.searchPets({
        userIds: [newUuid()],
        embedding: axisEmbedding('first'),
        numResults: 0,
        maxDistance: 0.5,
      }),
    ).toThrow();
  });
});
