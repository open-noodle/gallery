import { Kysely } from 'kysely';
import { SystemConfig } from 'src/config';
import { JobName, JobStatus, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
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
      DatabaseRepository,
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
  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).empty.mockResolvedValue();
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

describe('PersonRepository.deleteAllPets (medium)', () => {
  it('deletes an unassigned pet face identified only by its pet_search row (R1.1)', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();

    // Recognition wrote this face + embedding, but it was never clustered into a person, so the
    // person-scoped delete can't see it — the pet_search row is its only identity.
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: unassignedFace } = await ctx.newAssetFace({ assetId: asset.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: unassignedFace.id, embedding: axisEmbedding('first') })
      .execute();

    await personRepository.deleteAllPets();

    const faceRows = await ctx.database
      .selectFrom('asset_face')
      .select(['id'])
      .where('id', '=', unassignedFace.id)
      .execute();
    expect(faceRows).toHaveLength(0);

    const petSearchRows = await ctx.database
      .selectFrom('pet_search')
      .selectAll()
      .where('faceId', '=', unassignedFace.id)
      .execute();
    expect(petSearchRows).toHaveLength(0);
  });

  it('pin: deletes an assigned pet face, its person and its pet_search row (R1.2)', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();

    const { person: petPerson } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'dog' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: petFace } = await ctx.newAssetFace({ assetId: asset.id, personId: petPerson.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: petFace.id, embedding: axisEmbedding('first') })
      .execute();

    await personRepository.deleteAllPets();

    expect(
      await ctx.database.selectFrom('person').select(['id']).where('id', '=', petPerson.id).execute(),
    ).toHaveLength(0);
    expect(
      await ctx.database.selectFrom('asset_face').select(['id']).where('id', '=', petFace.id).execute(),
    ).toHaveLength(0);
    expect(
      await ctx.database.selectFrom('pet_search').selectAll().where('faceId', '=', petFace.id).execute(),
    ).toHaveLength(0);
  });

  it('pin: leaves a human person, face and face_search row untouched (R1.3)', async () => {
    const { ctx } = setup();
    const personRepository = ctx.get(PersonRepository);
    const { user } = await ctx.newUser();

    const { person: humanPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Human' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: humanFace } = await ctx.newAssetFace({ assetId: asset.id, personId: humanPerson.id });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: humanFace.id, embedding: axisEmbedding('second') })
      .execute();

    await personRepository.deleteAllPets();

    const personRow = await ctx.database
      .selectFrom('person')
      .selectAll()
      .where('id', '=', humanPerson.id)
      .executeTakeFirstOrThrow();
    expect(personRow.type).toBe('person');

    const faceRow = await ctx.database
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', humanFace.id)
      .executeTakeFirstOrThrow();
    expect(faceRow.personId).toBe(humanPerson.id);

    const faceSearchRows = await ctx.database
      .selectFrom('face_search')
      .selectAll()
      .where('faceId', '=', humanFace.id)
      .execute();
    expect(faceSearchRows).toHaveLength(1);
  });
});

describe('PetRecognitionService.handleQueuePetRecognition (medium)', () => {
  it('force reset leaves only human faces behind, assigned and unassigned pet faces alike (R1.4)', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);
    const { user } = await ctx.newUser();

    // An assigned pet face (reachable through its person) …
    const { person: petPerson } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'dog' });
    const { asset: assignedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: assignedPetFace } = await ctx.newAssetFace({
      assetId: assignedAsset.id,
      personId: petPerson.id,
    });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: assignedPetFace.id, embedding: axisEmbedding('first') })
      .execute();

    // … and an unassigned one, reachable only through pet_search.
    const { asset: unassignedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: unassignedPetFace } = await ctx.newAssetFace({ assetId: unassignedAsset.id });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: unassignedPetFace.id, embedding: nearAxisEmbedding('first', 2) })
      .execute();

    // Human faces: one assigned, one unassigned — both must survive.
    const { person: humanPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Human' });
    const { asset: humanAssetA } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: assignedHumanFace } = await ctx.newAssetFace({
      assetId: humanAssetA.id,
      personId: humanPerson.id,
    });
    const { asset: humanAssetB } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: unassignedHumanFace } = await ctx.newAssetFace({ assetId: humanAssetB.id });

    expect(await sut.handleQueuePetRecognition({ force: true })).toBe(JobStatus.Success);

    // Scoped to the faces this test seeded — the medium DB is shared across the whole file.
    const seededIds = [assignedPetFace.id, unassignedPetFace.id, assignedHumanFace.id, unassignedHumanFace.id];
    const remainingFaces = await ctx.database
      .selectFrom('asset_face')
      .select(['id'])
      .where('id', 'in', seededIds)
      .execute();
    expect(new Set(remainingFaces.map((face) => face.id))).toEqual(
      new Set([assignedHumanFace.id, unassignedHumanFace.id]),
    );

    // pet_search is truncated wholesale by the force purge, so this one is legitimately global.
    expect(await ctx.database.selectFrom('pet_search').selectAll().execute()).toHaveLength(0);
  });

  it(
    'force purge empties pet_search, deletes pet people/asset_face rows and their shared-space copies, ' +
      'and leaves a human person, asset_face, face_search row and shared-space copy untouched (6.7)',
    async () => {
      const { sut, ctx } = setup();
      await enablePetRecognition(ctx);
      const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
      const { user } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: user.id });

      // A pet: person + asset_face + pet_search embedding + shared-space copy, all to be purged.
      const { person: petPerson } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'dog' });
      const { asset: petAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: petFace } = await ctx.newAssetFace({ assetId: petAsset.id, personId: petPerson.id });
      await ctx.database
        .insertInto('pet_search')
        .values({ faceId: petFace.id, embedding: axisEmbedding('first') })
        .execute();
      const spacePet = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, type: 'pet', name: 'Space Pet' })
        .returningAll()
        .executeTakeFirstOrThrow();

      // A human: person + asset_face + face_search embedding + shared-space copy, which the purge
      // must not touch.
      const { person: humanPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Human' });
      const { asset: humanAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: humanFace } = await ctx.newAssetFace({ assetId: humanAsset.id, personId: humanPerson.id });
      await ctx.database
        .insertInto('face_search')
        .values({ faceId: humanFace.id, embedding: axisEmbedding('second') })
        .execute();
      const spaceHuman = await ctx.database
        .insertInto('shared_space_person')
        .values({ spaceId: space.id, type: 'person', name: 'Space Human' })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(await sut.handleQueuePetRecognition({ force: true })).toBe(JobStatus.Success);

      // pet_search is emptied entirely (truncate), including the pet embedding above.
      const petSearchRows = await ctx.database.selectFrom('pet_search').selectAll().execute();
      expect(petSearchRows).toHaveLength(0);

      // The pet person, its face, and its shared-space copy are gone.
      const petPersonRows = await ctx.database
        .selectFrom('person')
        .select(['id'])
        .where('id', '=', petPerson.id)
        .execute();
      expect(petPersonRows).toHaveLength(0);
      const petFaceRows = await ctx.database
        .selectFrom('asset_face')
        .select(['id'])
        .where('id', '=', petFace.id)
        .execute();
      expect(petFaceRows).toHaveLength(0);
      const spacePetRows = await ctx.database
        .selectFrom('shared_space_person')
        .select(['id'])
        .where('id', '=', spacePet.id)
        .execute();
      expect(spacePetRows).toHaveLength(0);

      // The human person, face, face_search embedding and shared-space copy all survive untouched.
      const humanPersonRow = await ctx.database
        .selectFrom('person')
        .selectAll()
        .where('id', '=', humanPerson.id)
        .executeTakeFirstOrThrow();
      expect(humanPersonRow.type).toBe('person');

      const humanFaceRow = await ctx.database
        .selectFrom('asset_face')
        .selectAll()
        .where('id', '=', humanFace.id)
        .executeTakeFirstOrThrow();
      expect(humanFaceRow.personId).toBe(humanPerson.id);

      // Scoped by faceId: the medium DB is shared across every test in this file, so a whole-table
      // count here would break the moment another test seeds a human face (R9.6 hygiene fix).
      const faceSearchRows = await ctx.database
        .selectFrom('face_search')
        .selectAll()
        .where('faceId', '=', humanFace.id)
        .execute();
      expect(faceSearchRows).toHaveLength(1);
      expect(faceSearchRows[0].faceId).toBe(humanFace.id);

      const spaceHumanRow = await ctx.database
        .selectFrom('shared_space_person')
        .selectAll()
        .where('id', '=', spaceHuman.id)
        .executeTakeFirstOrThrow();
      expect(spaceHumanRow.type).toBe('person');

      // The purge requeues detection so assets are re-detected/re-embedded with the current model.
      expect(jobMock.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    },
  );

  it('deleteAllPetSearch on an empty pet_search table is a no-op, not an error', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);

    await expect(sut.handleQueuePetRecognition({ force: true })).resolves.toBe(JobStatus.Success);

    const petSearchRows = await ctx.database.selectFrom('pet_search').selectAll().execute();
    expect(petSearchRows).toHaveLength(0);
  });
});

describe('PetRecognitionService model switch (medium)', () => {
  it(
    'R5.13 a live model switch scopes the purge to embeddings and recognition-created individuals — ' +
      'a species bucket and its faces survive',
    async () => {
      const { sut, ctx } = setup();
      await enablePetRecognition(ctx);
      const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
      const { user } = await ctx.newUser();

      // Two near-identical embeddings cluster into one individual under the base model.
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

      const clusteredRows = await ctx.database
        .selectFrom('asset_face')
        .select(['id', 'personId'])
        .where('id', 'in', [faceA.id, faceB.id])
        .execute();
      const individualPersonId = clusteredRows[0].personId;
      expect(individualPersonId).not.toBeNull();

      // A bird species bucket: pure detector output — no embedding, no pet_search row — built
      // under the same (base) model, and expected to survive the switch untouched.
      const { person: birdBucket } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'bird' });
      const { asset: birdAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: birdFace } = await ctx.newAssetFace({ assetId: birdAsset.id, personId: birdBucket.id });

      // Stamp state so the switch below has a reference model to diff the new one against.
      await ctx
        .get(SystemMetadataRepository)
        .set(SystemMetadataKey.PetRecognitionState, { modelName: 'pet-recognition-base' });

      await sut.onConfigUpdate({
        oldConfig: {
          machineLearning: {
            enabled: true,
            petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
          },
        } as SystemConfig,
        newConfig: {
          machineLearning: {
            enabled: true,
            petDetection: { enabled: true, modelName: 'yolo11n', minScore: 0.6 },
            petRecognition: { enabled: true, modelName: 'pet-recognition-large', maxDistance: 0.55, minFaces: 1 },
          },
        } as SystemConfig,
      });

      // pet_search is emptied entirely.
      expect(await ctx.database.selectFrom('pet_search').selectAll().execute()).toHaveLength(0);

      // The clustered individual and its faces are gone.
      const individualPersonRows = await ctx.database
        .selectFrom('person')
        .select(['id'])
        .where('id', '=', individualPersonId!)
        .execute();
      expect(individualPersonRows).toHaveLength(0);
      const individualFaceRows = await ctx.database
        .selectFrom('asset_face')
        .select(['id'])
        .where('id', 'in', [faceA.id, faceB.id])
        .execute();
      expect(individualFaceRows).toHaveLength(0);

      // The bird bucket and its face survive, untouched.
      const birdPersonRow = await ctx.database
        .selectFrom('person')
        .selectAll()
        .where('id', '=', birdBucket.id)
        .executeTakeFirstOrThrow();
      expect(birdPersonRow.species).toBe('bird');
      const birdFaceRow = await ctx.database
        .selectFrom('asset_face')
        .selectAll()
        .where('id', '=', birdFace.id)
        .executeTakeFirstOrThrow();
      expect(birdFaceRow.personId).toBe(birdBucket.id);

      // State records the new model.
      const state = await ctx.get(SystemMetadataRepository).get(SystemMetadataKey.PetRecognitionState);
      expect(state?.modelName).toBe('pet-recognition-large');

      // Detection was requeued force so assets are re-detected/re-embedded under the new model.
      expect(jobMock.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
    },
  );
});

describe('PetRecognitionService.handleQueuePetRecognition state (medium)', () => {
  it('R5.14 pin: after a normal queue-all run, state.modelName equals the config model', async () => {
    const { sut, ctx } = setup();
    await enablePetRecognition(ctx);

    expect(await sut.handleQueuePetRecognition({ force: false })).toBe(JobStatus.Success);

    const state = await ctx.get(SystemMetadataRepository).get(SystemMetadataKey.PetRecognitionState);
    expect(state?.modelName).toBe('pet-recognition-base');
  });
});
