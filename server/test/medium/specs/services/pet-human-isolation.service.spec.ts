import { Kysely } from 'kysely';
import { AssetFileType, AssetVisibility, JobName, SharedSpaceRole, SourceType, SystemMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { PersonService } from 'src/services/person.service';
import { clearConfigCache } from 'src/utils/config';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/**
 * A 512-d unit-ish vector on one half of the embedding space. The exact values are irrelevant here —
 * these tests never cluster, they only prove rows survive (or don't) a human-pipeline reset.
 */
const embedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => (index < 256 === (axis === 'first') ? 1 : 0));
  return '[' + values.join(',') + ']';
};

const setup = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetJobRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobMock.waitForQueueCompletion.mockResolvedValue();
  jobMock.empty.mockResolvedValue();
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  jobMock.getJobCounts.mockResolvedValue({
    active: 1,
    waiting: 0,
    delayed: 0,
    paused: 0,
    completed: 0,
    failed: 0,
  });

  const systemMetadataMock = ctx.getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(
    SystemMetadataRepository,
  );
  systemMetadataMock.get.mockImplementation((key) =>
    key === SystemMetadataKey.SystemConfig
      ? ({ machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any)
      : (undefined as any),
  );
  systemMetadataMock.set.mockResolvedValue();

  return { sut, ctx, jobMock };
};

/**
 * A named pet: person(type=pet) + a machine-learning asset_face + its pet_search embedding + a
 * pet-typed face_identity link. This is exactly the state a human force reset used to destroy (F1).
 */
const seedNamedPet = async (ctx: ReturnType<typeof setup>['ctx'], ownerId: string, name = 'Rex') => {
  const { person } = await ctx.newPerson({ ownerId, type: 'pet', species: 'dog', name });
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace: face } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: person.id,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database
    .insertInto('pet_search')
    .values({ faceId: face.id, embedding: embedding('first') })
    .execute();

  const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(person.id);
  await ctx.database.updateTable('face_identity').set({ type: 'pet' }).where('id', '=', identity.id).execute();
  await ctx.get(FaceIdentityRepository).linkFace({
    assetFaceId: face.id,
    identityId: identity.id,
    source: 'owner-person',
  });

  return { person, asset, face, identity };
};

/** A named human: person + a machine-learning asset_face. The reset is supposed to reset this. */
const seedNamedHuman = async (ctx: ReturnType<typeof setup>['ctx'], ownerId: string, name = 'Alice') => {
  const { person } = await ctx.newPerson({ ownerId, name });
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace: face } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: person.id,
    sourceType: SourceType.MachineLearning,
  });
  return { person, asset, face };
};

const faceRow = (ctx: ReturnType<typeof setup>['ctx'], id: string) =>
  ctx.database.selectFrom('asset_face').select(['id', 'personId']).where('id', '=', id).executeTakeFirst();

const personRow = (ctx: ReturnType<typeof setup>['ctx'], id: string) =>
  ctx.database.selectFrom('person').select(['id', 'name', 'type']).where('id', '=', id).executeTakeFirst();

const recognitionJobIds = (jobMock: ReturnType<typeof setup>['jobMock']) =>
  jobMock.queueAll.mock.calls
    .flatMap(([jobs]) => jobs as { name: JobName; data: { id: string } }[])
    .filter((job) => job.name === JobName.FacialRecognition)
    .map((job) => job.data.id);

describe('human face reset isolation from pet data (medium)', () => {
  it('R2.1 force recognize keeps a named pet person, its faces, embeddings and identity links', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const pet = await seedNamedPet(ctx, user.id);
    const human = await seedNamedHuman(ctx, user.id);

    await sut.handleQueueRecognizeFaces({ force: true });

    // The pet survives whole: person, name, face assignment, embedding, identity link.
    expect(await personRow(ctx, pet.person.id)).toMatchObject({ id: pet.person.id, name: 'Rex', type: 'pet' });
    expect(await faceRow(ctx, pet.face.id)).toMatchObject({ id: pet.face.id, personId: pet.person.id });
    expect(
      await ctx.database.selectFrom('pet_search').selectAll().where('faceId', '=', pet.face.id).execute(),
    ).toHaveLength(1);
    expect(
      await ctx.database.selectFrom('face_identity_face').selectAll().where('assetFaceId', '=', pet.face.id).execute(),
    ).toHaveLength(1);

    // The human is reset as before: face unassigned, identity link removed.
    expect(await faceRow(ctx, human.face.id)).toMatchObject({ id: human.face.id, personId: null });
  });

  it('R2.2 force detect keeps pet faces and their pet_search rows, deletes human ML faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const pet = await seedNamedPet(ctx, user.id);
    const human = await seedNamedHuman(ctx, user.id);

    await sut.handleQueueDetectFaces({ force: true });

    expect(await faceRow(ctx, pet.face.id)).toMatchObject({ id: pet.face.id, personId: pet.person.id });
    expect(
      await ctx.database.selectFrom('pet_search').selectAll().where('faceId', '=', pet.face.id).execute(),
    ).toHaveLength(1);
    expect(await personRow(ctx, pet.person.id)).toMatchObject({ id: pet.person.id, type: 'pet' });

    expect(await faceRow(ctx, human.face.id)).toBeUndefined();
  });

  it('R3.4 per-asset re-detection with zero detections keeps the pet face and drops the stale human face', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    // One asset carrying both an assigned pet face and a stale human ML face.
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.webp` });
    await ctx.newExif({ assetId: asset.id, exifImageWidth: 400, exifImageHeight: 500 });

    const { person: petPerson } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'dog', name: 'Rex' });
    const { assetFace: petFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: petPerson.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: petFace.id, embedding: embedding('first') })
      .execute();

    const { assetFace: staleHumanFace } = await ctx.newAssetFace({
      assetId: asset.id,
      sourceType: SourceType.MachineLearning,
    });

    ctx
      .getMock<MachineLearningRepository, Mocked<MachineLearningRepository>>(MachineLearningRepository)
      .detectFaces.mockResolvedValue({ imageHeight: 500, imageWidth: 400, faces: [] });

    await sut.handleDetectFaces({ id: asset.id });

    expect(await faceRow(ctx, petFace.id)).toMatchObject({ id: petFace.id, personId: petPerson.id });
    expect(
      await ctx.database.selectFrom('pet_search').selectAll().where('faceId', '=', petFace.id).execute(),
    ).toHaveLength(1);
    expect(await personRow(ctx, petPerson.id)).toMatchObject({ id: petPerson.id, type: 'pet' });

    expect(await faceRow(ctx, staleHumanFace.id)).toBeUndefined();
  });

  it('R2.3 non-force recognize fan-out queues the unassigned human face but not the unassigned pet face', async () => {
    const { sut, ctx, jobMock } = setup();
    const { user } = await ctx.newUser();

    const { asset: petAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: petFace } = await ctx.newAssetFace({
      assetId: petAsset.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('pet_search')
      .values({ faceId: petFace.id, embedding: embedding('first') })
      .execute();

    const { asset: humanAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: humanFace } = await ctx.newAssetFace({
      assetId: humanAsset.id,
      sourceType: SourceType.MachineLearning,
    });

    await sut.handleQueueRecognizeFaces({ force: false });

    const queued = recognitionJobIds(jobMock);
    expect(queued).toContain(humanFace.id);
    expect(queued).not.toContain(petFace.id);
  });

  it('R2.4 force recognize fan-out also excludes assigned pet faces', async () => {
    const { sut, ctx, jobMock } = setup();
    const { user } = await ctx.newUser();
    const pet = await seedNamedPet(ctx, user.id);
    const human = await seedNamedHuman(ctx, user.id);

    await sut.handleQueueRecognizeFaces({ force: true });

    const queued = recognitionJobIds(jobMock);
    expect(queued).toContain(human.face.id);
    expect(queued).not.toContain(pet.face.id);
  });

  it('R2.5 person cleanup after a human force reset removes zero-face humans but not the pet person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const pet = await seedNamedPet(ctx, user.id);
    // A human person with no faces at all — exactly what cleanup exists to collect.
    const { person: emptyHuman } = await ctx.newPerson({ ownerId: user.id, name: 'Ghost' });

    await sut.handleQueueRecognizeFaces({ force: true });
    await sut.handlePersonCleanup();

    expect(await personRow(ctx, emptyHuman.id)).toBeUndefined();
    expect(await personRow(ctx, pet.person.id)).toMatchObject({ id: pet.person.id, type: 'pet' });
  });

  it('R2.6 pin: person cleanup stays generic — a pet person with genuinely zero faces is collected', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: facelessPet } = await ctx.newPerson({
      ownerId: user.id,
      type: 'pet',
      species: 'cat',
      name: 'Ghost Cat',
    });

    await sut.handlePersonCleanup();

    expect(await personRow(ctx, facelessPet.id)).toBeUndefined();
  });

  it('R2.8 pin: with no pet data present, the human force reset behaves exactly as before', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const human = await seedNamedHuman(ctx, user.id);
    const { person: emptyHuman } = await ctx.newPerson({ ownerId: user.id, name: 'Ghost' });

    await sut.handleQueueRecognizeFaces({ force: true });
    await sut.handlePersonCleanup();

    // Face unassigned, identity links gone, zero-face person collected — unchanged semantics.
    expect(await faceRow(ctx, human.face.id)).toMatchObject({ id: human.face.id, personId: null });
    expect(
      await ctx.database
        .selectFrom('face_identity_face')
        .selectAll()
        .where('assetFaceId', '=', human.face.id)
        .execute(),
    ).toHaveLength(0);
    expect(await personRow(ctx, emptyHuman.id)).toBeUndefined();
  });

  it('R2.9 force recognize keeps a space pet copy and its face links, wipes the space human copy', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const pet = await seedNamedPet(ctx, user.id);
    const human = await seedNamedHuman(ctx, user.id);

    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });

    const spacePet = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, type: 'pet', name: 'Space Rex', identityId: pet.identity.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spacePet.id, assetFaceId: pet.face.id })
      .execute();

    const spaceHuman = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, type: 'person', name: 'Space Alice' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: spaceHuman.id, assetFaceId: human.face.id })
      .execute();

    await sut.handleQueueRecognizeFaces({ force: true });

    const spacePetRow = await ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'name'])
      .where('id', '=', spacePet.id)
      .executeTakeFirst();
    expect(spacePetRow).toMatchObject({ id: spacePet.id, name: 'Space Rex' });
    expect(
      await ctx.database
        .selectFrom('shared_space_person_face')
        .selectAll()
        .where('personId', '=', spacePet.id)
        .execute(),
    ).toHaveLength(1);

    // The human copy is wiped for the rebuild, exactly as before.
    expect(
      await ctx.database.selectFrom('shared_space_person').select(['id']).where('id', '=', spaceHuman.id).execute(),
    ).toHaveLength(0);
  });
});
