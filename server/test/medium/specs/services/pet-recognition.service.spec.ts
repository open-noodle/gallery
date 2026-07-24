import { Kysely } from 'kysely';
import { JobStatus, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { PetRecognitionService } from 'src/services/pet-recognition.service';
import { clearConfigCache } from 'src/utils/config';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Two clusters on disjoint embedding axes are maximally dissimilar (cosine distance ~1.0), standing
// in for two genuinely different pets. newEmbedding() (random, all-positive) can't stand in for
// "genuinely different pet" — its vectors are ~0.75 similar to each other. See
// face-repair.service.spec.ts for the same helper and rationale.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

// A small perturbation of axisEmbedding('first'): flips a handful of the 256 "on" dimensions off.
// Cosine distance from the pure axis is small (a near-identical pet, e.g. a second photo of the
// same dog), unlike axisEmbedding('second') which is maximally far.
const nearAxisEmbedding = (axis: 'first' | 'second', flips: number) => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  for (let i = 0; i < flips; i++) {
    values[i] = values[i] === 1 ? 0 : 1;
  }
  return '[' + values.join(',') + ']';
};

const setup = (db?: Kysely<DB>) => {
  clearConfigCache();
  const { sut, ctx } = newMediumService(PetRecognitionService, {
    database: db || defaultDatabase,
    real: [
      ConfigRepository,
      FaceIdentityRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queue.mockResolvedValue();
  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queueAll.mockResolvedValue();
  return { sut, ctx };
};

const enablePetRecognition = async (
  ctx: ReturnType<typeof setup>['ctx'],
  overrides: { maxDistance?: number; minFaces?: number } = {},
) => {
  await ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
    machineLearning: {
      enabled: true,
      petRecognition: {
        enabled: true,
        modelName: 'pet-recognition-base',
        maxDistance: overrides.maxDistance ?? 0.55,
        minFaces: overrides.minFaces ?? 1,
      },
    },
  } as any);
};

describe('PetRecognitionService.handlePetRecognition (medium)', () => {
  it('clusters two near-identical embeddings for the same owner into one pet person (5.14)', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);
    const { user } = await ctx.newUser();

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceA.id, embedding: axisEmbedding('first') })
      .execute();

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceB.id, embedding: nearAxisEmbedding('first', 2) })
      .execute();

    expect(await sut.handlePetRecognition({ id: faceA.id, deferred: false, label: 'dog' })).toBe(JobStatus.Success);
    expect(await sut.handlePetRecognition({ id: faceB.id, deferred: false, label: 'dog' })).toBe(JobStatus.Success);

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', [faceA.id, faceB.id])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0].personId).not.toBeNull();
    expect(rows[0].personId).toBe(rows[1].personId);

    const person = await ctx.database
      .selectFrom('person')
      .selectAll()
      .where('id', '=', rows[0].personId!)
      .executeTakeFirstOrThrow();
    expect(person.type).toBe('pet');
    expect(person.species).toBe('dog');
    expect(person.ownerId).toBe(user.id);

    // face_identity linkage activates shared-space pet propagation (see shared-space.service.ts
    // getPetFacesForAsset, which requires person.identityId to be set).
    expect(person.identityId).not.toBeNull();
    const identity = await ctx.database
      .selectFrom('face_identity')
      .selectAll()
      .where('id', '=', person.identityId!)
      .executeTakeFirstOrThrow();
    expect(identity.type).toBe('pet');
  });

  it('produces two separate pet people for two distant embeddings (5.15)', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);
    const { user } = await ctx.newUser();

    const { asset: assetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceA.id, embedding: axisEmbedding('first') })
      .execute();

    const { asset: assetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceB.id, embedding: axisEmbedding('second') })
      .execute();

    expect(await sut.handlePetRecognition({ id: faceA.id, deferred: false, label: 'dog' })).toBe(JobStatus.Success);
    expect(await sut.handlePetRecognition({ id: faceB.id, deferred: false, label: 'cat' })).toBe(JobStatus.Success);

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', [faceA.id, faceB.id])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0].personId).not.toBeNull();
    expect(rows[1].personId).not.toBeNull();
    expect(rows[0].personId).not.toBe(rows[1].personId);

    const people = await ctx.database
      .selectFrom('person')
      .select(['id', 'species'])
      .where(
        'id',
        'in',
        rows.map((row) => row.personId!),
      )
      .execute();
    expect(new Set(people.map((p) => p.species))).toEqual(new Set(['dog', 'cat']));
  });

  it('never clusters embeddings from two different owners together, even when identical (5.16)', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);
    const { user: ownerA } = await ctx.newUser();
    const { user: ownerB } = await ctx.newUser();

    const { asset: assetA } = await ctx.newAsset({ ownerId: ownerA.id });
    const { assetFace: faceA } = await ctx.newAssetFace({ assetId: assetA.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceA.id, embedding: axisEmbedding('first') })
      .execute();

    const { asset: assetB } = await ctx.newAsset({ ownerId: ownerB.id });
    const { assetFace: faceB } = await ctx.newAssetFace({ assetId: assetB.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: faceB.id, embedding: axisEmbedding('first') })
      .execute();

    expect(await sut.handlePetRecognition({ id: faceA.id, deferred: false, label: 'dog' })).toBe(JobStatus.Success);
    expect(await sut.handlePetRecognition({ id: faceB.id, deferred: false, label: 'dog' })).toBe(JobStatus.Success);

    const rows = await ctx.database
      .selectFrom('asset_face')
      .select(['id', 'personId'])
      .where('id', 'in', [faceA.id, faceB.id])
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0].personId).not.toBeNull();
    expect(rows[1].personId).not.toBeNull();
    expect(rows[0].personId).not.toBe(rows[1].personId);

    const people = await ctx.database
      .selectFrom('person')
      .select(['id', 'ownerId'])
      .where(
        'id',
        'in',
        rows.map((row) => row.personId!),
      )
      .execute();
    expect(new Set(people.map((p) => p.ownerId))).toEqual(new Set([ownerA.id, ownerB.id]));
  });
});
