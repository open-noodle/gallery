import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto';
import { AssetFaceCreateDto } from 'src/dtos/person.dto';
import {
  AssetFileType,
  AssetVisibility,
  JobName,
  JobStatus,
  SharedSpaceRole,
  SourceType,
  SystemMetadataKey,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository';
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
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetJobRepository,
      ConfigRepository,
      FaceIdentityRepository,
      DatabaseRepository,
      PersonRepository,
      AssetRepository,
      AssetEditRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository, StorageRepository, MachineLearningRepository],
  });
};

const setupFaceDetection = (db?: Kysely<DB>) => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      AssetJobRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queue.mockResolvedValue();
  ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository).queueAll.mockResolvedValue();
  ctx
    .getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository)
    .get.mockImplementation((key) => {
      if (key === SystemMetadataKey.SystemConfig) {
        return { machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any;
      }
      return undefined as any;
    });

  return { sut, ctx };
};

const getAssetFaces = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], assetId: string) =>
  ctx.database
    .selectFrom('asset_face')
    .select(['id', 'assetId', 'personId', 'sourceType'])
    .where('assetId', '=', assetId)
    .orderBy('id')
    .execute();

const getIdentityLinks = (ctx: ReturnType<typeof setupFaceDetection>['ctx'], faceIds: string[]) =>
  ctx.database
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', 'in', faceIds)
    .orderBy('assetFaceId')
    .execute();

const createAssetReadyForFaceDetection = async (ctx: ReturnType<typeof setupFaceDetection>['ctx'], ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline, width: 200, height: 200 });
  await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.webp` });
  await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
  return asset;
};

const createPersonFaceIdentity = async (
  ctx: ReturnType<typeof setupFaceDetection>['ctx'],
  input: {
    ownerId: string;
    assetId: string;
    name: string;
    sourceType: SourceType;
    linkSource: 'ml' | 'manual' | 'import';
  },
) => {
  const faceIdentityRepository = ctx.get(FaceIdentityRepository);
  const { result: person } = await ctx.newPerson({ ownerId: input.ownerId, name: input.name });
  const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);
  const { assetFace } = await ctx.newAssetFace({
    assetId: input.assetId,
    personId: person.id,
    sourceType: input.sourceType,
  });
  await faceIdentityRepository.replaceFaceIdentity({
    assetFaceId: assetFace.id,
    identityId: identity.id,
    source: input.linkSource,
  });

  return { person, identity, assetFace };
};

const createSpacePersonFace = async (
  ctx: ReturnType<typeof setupFaceDetection>['ctx'],
  input: { spaceId: string; identityId: string; assetFaceId: string; name: string },
) => {
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: input.spaceId,
      identityId: input.identityId,
      name: input.name,
      type: 'person',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: input.assetFaceId })
    .execute();

  return spacePerson;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PersonService.name, () => {
  describe('handleQueueDetectFaces safety', () => {
    it('preserves manual and EXIF roots while force face detection removes stale machine-learning state', async () => {
      const { sut, ctx } = setupFaceDetection();
      const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      await ctx.newJobStatus({ assetId: asset.id });

      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });

      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const mlSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: ml.identity.id,
        assetFaceId: ml.assetFace.id,
        name: 'Machine Space',
      });
      const manualSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: manual.identity.id,
        assetFaceId: manual.assetFace.id,
        name: 'Manual Space',
      });
      const exifSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: exif.identity.id,
        assetFaceId: exif.assetFace.id,
        name: 'Exif Space',
      });

      await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Success);

      await expect(getAssetFaces(ctx, asset.id)).resolves.toHaveLength(2);
      await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: exif.assetFace.id,
            personId: exif.person.id,
            sourceType: SourceType.Exif,
          }),
          expect.objectContaining({
            id: manual.assetFace.id,
            personId: manual.person.id,
            sourceType: SourceType.Manual,
          }),
        ]),
      );
      await expect(
        getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id]),
      ).resolves.toHaveLength(2);
      await expect(getIdentityLinks(ctx, [ml.assetFace.id, manual.assetFace.id, exif.assetFace.id])).resolves.toEqual(
        expect.arrayContaining([
          { assetFaceId: exif.assetFace.id, identityId: exif.identity.id, source: 'import' },
          { assetFaceId: manual.assetFace.id, identityId: manual.identity.id, source: 'manual' },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('person')
          .select(['id', 'name'])
          .where('id', 'in', [ml.person.id, manual.person.id, exif.person.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exif.person.id, name: 'Exif' },
        { id: manual.person.id, name: 'Manual' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person')
          .select(['id', 'identityId', 'name'])
          .where('id', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exifSpacePerson.id, identityId: exif.identity.id, name: 'Exif Space' },
        { id: manualSpacePerson.id, identityId: manual.identity.id, name: 'Manual Space' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toHaveLength(2);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { personId: manualSpacePerson.id, assetFaceId: manual.assetFace.id },
          { personId: exifSpacePerson.id, assetFaceId: exif.assetFace.id },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', '=', mlSpacePerson.id)
          .execute(),
      ).resolves.toEqual([]);
      expect(jobMock.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: asset.id, force: true } },
      ]);
    });
  });

  describe('handleDetectFaces face detection safety', () => {
    it('removes stale machine-learning faces without deleting people on non-force no-detected-faces runs', async () => {
      const { sut, ctx } = setupFaceDetection();
      const machineLearningMock = ctx.getMock<MachineLearningRepository, Mocked<MachineLearningRepository>>(
        MachineLearningRepository,
      );
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });
      machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      await expect(getAssetFaces(ctx, asset.id)).resolves.toHaveLength(2);
      await expect(getAssetFaces(ctx, asset.id)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: exif.assetFace.id, sourceType: SourceType.Exif }),
          expect.objectContaining({ id: manual.assetFace.id, sourceType: SourceType.Manual }),
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('person')
          .select(['id', 'name'])
          .where('id', 'in', [ml.person.id, manual.person.id, exif.person.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exif.person.id, name: 'Exif' },
        { id: ml.person.id, name: 'Machine' },
        { id: manual.person.id, name: 'Manual' },
      ]);
      await expect(
        ctx.database
          .selectFrom('asset_job_status')
          .select('facesRecognizedAt')
          .where('assetId', '=', asset.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ facesRecognizedAt: expect.any(Date) });
    });

    it('preserves manual and EXIF shared-space projections while removing stale machine-learning face links', async () => {
      const { sut, ctx } = setupFaceDetection();
      const machineLearningMock = ctx.getMock<MachineLearningRepository, Mocked<MachineLearningRepository>>(
        MachineLearningRepository,
      );
      const { user } = await ctx.newUser();
      const asset = await createAssetReadyForFaceDetection(ctx, user.id);
      const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: SharedSpaceRole.Owner });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
      const ml = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Machine',
        sourceType: SourceType.MachineLearning,
        linkSource: 'ml',
      });
      const manual = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Manual',
        sourceType: SourceType.Manual,
        linkSource: 'manual',
      });
      const exif = await createPersonFaceIdentity(ctx, {
        ownerId: user.id,
        assetId: asset.id,
        name: 'Exif',
        sourceType: SourceType.Exif,
        linkSource: 'import',
      });
      const mlSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: ml.identity.id,
        assetFaceId: ml.assetFace.id,
        name: 'Machine Space',
      });
      const manualSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: manual.identity.id,
        assetFaceId: manual.assetFace.id,
        name: 'Manual Space',
      });
      const exifSpacePerson = await createSpacePersonFace(ctx, {
        spaceId: space.id,
        identityId: exif.identity.id,
        assetFaceId: exif.assetFace.id,
        name: 'Exif Space',
      });
      machineLearningMock.detectFaces.mockResolvedValue({ imageWidth: 200, imageHeight: 200, faces: [] });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      await expect(
        ctx.database.selectFrom('asset_face').select('id').where('id', '=', ml.assetFace.id).execute(),
      ).resolves.toEqual([]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person')
          .select(['id', 'identityId', 'name'])
          .where('id', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('name')
          .execute(),
      ).resolves.toEqual([
        { id: exifSpacePerson.id, identityId: exif.identity.id, name: 'Exif Space' },
        { id: mlSpacePerson.id, identityId: ml.identity.id, name: 'Machine Space' },
        { id: manualSpacePerson.id, identityId: manual.identity.id, name: 'Manual Space' },
      ]);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toHaveLength(2);
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', 'in', [mlSpacePerson.id, manualSpacePerson.id, exifSpacePerson.id])
          .orderBy('personId')
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { personId: manualSpacePerson.id, assetFaceId: manual.assetFace.id },
          { personId: exifSpacePerson.id, assetFaceId: exif.assetFace.id },
        ]),
      );
      await expect(
        ctx.database
          .selectFrom('shared_space_person_face')
          .select(['personId', 'assetFaceId'])
          .where('personId', '=', mlSpacePerson.id)
          .execute(),
      ).resolves.toEqual([]);
    });
  });

  describe('mergePerson', () => {
    it('links reassigned faces to the target identity for identity-filtered timelines', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target' });
      const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Source' });
      const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: sourceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id, personId: target.id });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: sourceAsset.id, personId: source.id });
      const existingTargetIdentity = await faceIdentityRepo.ensurePersonIdentity(target.id);
      await faceIdentityRepo.replaceFaceIdentity({
        assetFaceId: targetFace.id,
        identityId: existingTargetIdentity.id,
        source: 'owner-person',
      });

      await sut.mergePerson(factory.auth({ user }), target.id, { ids: [source.id] });

      const targetIdentity = await ctx.database
        .selectFrom('person')
        .select('identityId')
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow();

      expect(targetIdentity.identityId).toBe(existingTargetIdentity.id);

      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select(['assetFaceId', 'identityId', 'source'])
        .where('assetFaceId', 'in', [targetFace.id, sourceFace.id])
        .execute();

      expect(links).toEqual(
        expect.arrayContaining([
          { assetFaceId: targetFace.id, identityId: targetIdentity.identityId!, source: 'owner-person' },
          { assetFaceId: sourceFace.id, identityId: targetIdentity.identityId!, source: 'manual' },
        ]),
      );

      const buckets = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.identityId!],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      });

      expect(buckets.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(2);
    });

    it('repairs previously merged faces when people identity maintenance runs', async () => {
      const { sut, ctx } = setup();
      const assetRepo = ctx.get(AssetRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const jobMock = ctx.getMock(JobRepository);
      const { user } = await ctx.newUser();
      const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target' });
      const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Source' });
      const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: sourceAsset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: targetAsset.id, personId: target.id });
      const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: sourceAsset.id, personId: source.id });
      const targetIdentity = await faceIdentityRepo.ensurePersonIdentity(target.id);
      await faceIdentityRepo.replaceFaceIdentity({
        assetFaceId: targetFace.id,
        identityId: targetIdentity.id,
        source: 'owner-person',
      });
      await ctx.database
        .updateTable('asset_face')
        .set({ personId: target.id })
        .where('id', '=', sourceFace.id)
        .execute();
      await ctx.database.deleteFrom('person').where('id', '=', source.id).execute();

      const bucketsBeforeRepair = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.id],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      });
      expect(bucketsBeforeRepair.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(1);

      jobMock.queue.mockResolvedValue();
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      const sourceLink = await ctx.database
        .selectFrom('face_identity_face')
        .select(['identityId', 'source'])
        .where('assetFaceId', '=', sourceFace.id)
        .executeTakeFirstOrThrow();
      expect(sourceLink).toEqual({ identityId: targetIdentity.id, source: 'backfill' });

      const bucketsAfterRepair = await assetRepo.getTimeBuckets({
        identityIds: [targetIdentity.id],
        userIds: [user.id],
        visibility: AssetVisibility.Timeline,
      });
      expect(bucketsAfterRepair.reduce((total, bucket) => total + Number(bucket.count), 0)).toBe(2);
    });
  });

  describe('delete', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.delete(auth, personId)).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const personRepo = ctx.get(PersonRepository);
      const jobMock = ctx.getMock(JobRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      jobMock.queue.mockResolvedValue();

      await expect(personRepo.getByGroupId(person)).resolves.toEqual(
        expect.objectContaining({ personGroupId: person.personGroupId }),
      );
      await expect(sut.delete(auth, person.personGroupId)).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person)).resolves.toBeUndefined();

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person.thumbnailPath] },
      });
    });
  });

  describe('deleteAll', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.deleteAll(auth, { ids: [personId] })).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const jobMock = ctx.getMock(JobRepository);
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { person: person1 } = await ctx.newPerson({ ownerId: user.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      jobMock.queue.mockResolvedValue();

      await expect(
        sut.deleteAll(auth, { ids: [person1.personGroupId, person2.personGroupId] }),
      ).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person1)).resolves.toBeUndefined();
      await expect(personRepo.getByGroupId(person2)).resolves.toBeUndefined();

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person1.thumbnailPath, person2.thumbnailPath] },
      });
    });
  });

  describe('handleDetectFaces', () => {
    it('should prefer an edited preview file', async () => {
      const { sut, ctx } = setup();
      const config = await ctx.getConfig();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, description: '' });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        isEdited: true,
        path: 'edited_file.jpg',
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        isEdited: false,
        path: 'unedited_file.jpg',
      });
      ctx
        .getMock(MachineLearningRepository)
        .detectFaces.mockResolvedValue({ imageHeight: 42, imageWidth: 69, faces: [] });

      await sut.handleDetectFaces({ id: asset.id });

      expect(ctx.getMock(MachineLearningRepository).detectFaces).toHaveBeenCalledWith(
        'edited_file.jpg',
        config.machineLearning.facialRecognition,
      );
    });
  });

  describe('handleQueueRecognizeFaces', () => {
    it('should delete all people and queue faces for recognition', async () => {
      const { sut, ctx } = setup();
      const jobRepo = ctx.getMock(JobRepository);
      ctx.getMock(StorageRepository).unlink.mockResolvedValue();
      jobRepo.waitForQueueCompletion.mockResolvedValue();
      jobRepo.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, completed: 0, delayed: 0, failed: 0, paused: 0 });
      jobRepo.queueAll.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: assetUser1 } = await ctx.newAsset({ ownerId: user1.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: personUser1 } = await ctx.newPerson({ ownerId: user1.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: assetFaceUser1 } = await ctx.newAssetFace({
        assetId: assetUser1.id,
        personGroupId: personUser1.personGroupId,
      });

      await sut.handleQueueRecognizeFaces({ force: true });

      await expect(ctx.database.selectFrom('person').selectAll().execute()).resolves.toHaveLength(0);
      expect(jobRepo.queueAll).toHaveBeenCalledWith(
        expect.objectContaining([
          { name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } },
          { name: JobName.FacialRecognition, data: { id: assetFaceUser1.id, deferred: false } },
        ]),
      );
    });

    it('should only delete all people of a specified cluster group and queue their faces for recognition', async () => {
      const { sut, ctx } = setup();
      const jobRepo = ctx.getMock(JobRepository);
      ctx.getMock(StorageRepository).unlink.mockResolvedValue();
      jobRepo.waitForQueueCompletion.mockResolvedValue();
      jobRepo.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, completed: 0, delayed: 0, failed: 0, paused: 0 });
      jobRepo.queueAll.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: assetUser1 } = await ctx.newAsset({ ownerId: user1.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { person: personUser1 } = await ctx.newPerson({ ownerId: user1.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      const { assetFace: assetFaceUser1 } = await ctx.newAssetFace({
        assetId: assetUser1.id,
        personGroupId: personUser1.personGroupId,
      });

      await sut.handleQueueRecognizeFaces({ force: true, clusterGroupId: user.clusterGroupId });

      await expect(ctx.database.selectFrom('person').selectAll().execute()).resolves.toHaveLength(1);
      expect(jobRepo.queueAll).toHaveBeenCalledWith(
        expect.objectContaining([{ name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } }]),
      );
      expect(jobRepo.queueAll).not.toHaveBeenCalledWith(
        expect.objectContaining([
          { name: JobName.FacialRecognition, data: { id: assetFace.id, deferred: false } },
          { name: JobName.FacialRecognition, data: { id: assetFaceUser1.id, deferred: false } },
        ]),
      );
    });
  });

  describe('mergePerson', () => {
    it('should merge people of multiple users', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser({ clusterGroupId: user1.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: user1.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user1.id });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person1.personGroupId,
      });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person2.personGroupId,
      });
      const { asset } = await ctx.newAsset({ ownerId: user2.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person2.personGroupId });
      storageMock.unlink.mockResolvedValue();

      const auth = factory.auth({ user: user1 });

      await sut.mergePerson(auth, person1.personGroupId, { ids: [person2.personGroupId] });
      const user1People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user1.id }));
      const user2People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user2.id }));
      expect(user1People).toEqual([expect.objectContaining({ personGroupId: person1.personGroupId })]);
      expect(user2People).toEqual([expect.objectContaining({ personGroupId: person1.personGroupId })]);
      await expect(ctx.get(PersonRepository).getFaces(asset.id, { viewingUserId: asset.ownerId })).resolves.toEqual([
        expect.objectContaining({ personGroupId: person1.personGroupId }),
      ]);
    });

    it('should skip people with a different name', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser({ clusterGroupId: user1.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: user1.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user1.id });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person1.personGroupId,
        name: 'Person 1',
      });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person2.personGroupId,
        name: 'Person 2',
      });
      storageMock.unlink.mockResolvedValue();

      const auth = factory.auth({ user: user1 });

      await sut.mergePerson(auth, person1.personGroupId, { ids: [person2.personGroupId] });
      const user1People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user1.id }));
      const user2People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user2.id }));
      expect(user1People).toEqual([expect.objectContaining({ personGroupId: person1.personGroupId })]);
      expect(user2People).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ personGroupId: person1.personGroupId }),
          expect.objectContaining({ personGroupId: person2.personGroupId }),
        ]),
      );
    });

    it('should skip people with a different birthdate', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser({ clusterGroupId: user1.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: user1.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user1.id });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person1.personGroupId,
        birthDate: DateTime.now().minus({ years: 1 }).toJSDate(),
      });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person2.personGroupId,
        birthDate: DateTime.now().minus({ years: 2 }).toJSDate(),
      });
      storageMock.unlink.mockResolvedValue();

      const auth = factory.auth({ user: user1 });

      await sut.mergePerson(auth, person1.personGroupId, { ids: [person2.personGroupId] });
      const user1People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user1.id }));
      const user2People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user2.id }));
      expect(user1People).toEqual([expect.objectContaining({ personGroupId: person1.personGroupId })]);
      expect(user2People).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ personGroupId: person1.personGroupId }),
          expect.objectContaining({ personGroupId: person2.personGroupId }),
        ]),
      );
    });

    it('should not merge into person another user does not have', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser({ clusterGroupId: user1.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: user1.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user1.id });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person2.personGroupId,
      });
      const { asset } = await ctx.newAsset({ ownerId: user2.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person2.personGroupId });
      storageMock.unlink.mockResolvedValue();

      const auth = factory.auth({ user: user1 });

      await sut.mergePerson(auth, person1.personGroupId, { ids: [person2.personGroupId] });
      const user1People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user1.id }));
      const user2People = await Array.fromAsync(ctx.get(PersonRepository).getAll({ ownerId: user2.id }));
      expect(user1People).toEqual([expect.objectContaining({ personGroupId: person1.personGroupId })]);
      expect(user2People).toEqual([expect.objectContaining({ personGroupId: person2.personGroupId })]);
      await expect(ctx.get(PersonRepository).getFaces(asset.id, { viewingUserId: asset.ownerId })).resolves.toEqual([
        expect.objectContaining({ personGroupId: person2.personGroupId }),
      ]);
    });
  });

  describe('createFace', () => {
    it('should store and retrieve the face as-is when there are no edits', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 200,
        x: 50,
        y: 50,
        width: 150,
        height: 150,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      // retrieve an asset's faces
      const faces = sut.getFacesById(auth, { id: asset.id });

      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 50,
            boundingBoxX2: 200,
            boundingBoxY2: 200,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 50,
              width: 150,
              height: 200,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 200,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      // retrieve an asset's faces
      const faces = sut.getFacesById(auth, { id: asset.id });

      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 0,
            boundingBoxY1: 0,
            boundingBoxX2: 100,
            boundingBoxY2: 100,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });

      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toHaveLength(1);
      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 50,
            boundingBoxX2: 150,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Rotate 90)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 200 });
      await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 100 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 200,
        x: 25,
        y: 50,
        width: 10,
        height: 10,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(25, 1),
            boundingBoxY1: expect.closeTo(50, 1),
            boundingBoxX2: expect.closeTo(35, 1),
            boundingBoxY2: expect.closeTo(60, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 65,
            boundingBoxX2: 60,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Mirror Horizontal)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 100,
        x: 50,
        y: 25,
        width: 100,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 25,
            boundingBoxX2: 150,
            boundingBoxY2: 75,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 25,
            boundingBoxX2: 150,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Rotate)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 150 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 0,
              width: 150,
              height: 200,
            },
          },
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 150,
        x: 50,
        y: 25,
        width: 10,
        height: 20,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(50, 1),
            boundingBoxY1: expect.closeTo(25, 1),
            boundingBoxX2: expect.closeTo(60, 1),
            boundingBoxY2: expect.closeTo(45, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 75,
            boundingBoxY1: 140,
            boundingBoxX2: 95,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 0,
              width: 150,
              height: 100,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 100,
        x: 25,
        y: 25,
        width: 75,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 25,
            boundingBoxX2: 100,
            boundingBoxY2: 75,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 100,
            boundingBoxY1: 25,
            boundingBoxX2: 175,
            boundingBoxY2: 75,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Rotate + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 200, height: 150 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 150 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 200,
        imageHeight: 150,
        x: 50,
        y: 25,
        width: 15,
        height: 20,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: expect.closeTo(50, 1),
            boundingBoxY1: expect.closeTo(25, 1),
            boundingBoxX2: expect.closeTo(65, 1),
            boundingBoxY2: expect.closeTo(45, 1),
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 50,
            boundingBoxX2: 45,
            boundingBoxY2: 65,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates when the asset is edited (Crop + Rotate + Mirror)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 150, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 200 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 50,
              y: 25,
              width: 100,
              height: 150,
            },
          },
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 270,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 150,
        imageHeight: 150,
        x: 25,
        y: 50,
        width: 75,
        height: 50,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 25,
            boundingBoxY1: 49,
            boundingBoxX2: 99,
            boundingBoxY2: 100,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 50,
            boundingBoxY1: 75,
            boundingBoxX2: 100,
            boundingBoxY2: 150,
          }),
        ]),
      );
    });

    it('should properly transform the coordinates with multiple mirrors in sequence', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 100, exifImageWidth: 100 });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Vertical,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 100,
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );
    });

    it('should properly handle exif orientation when creating a face on an edited asset', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const { asset } = await ctx.newAsset({ id: factory.uuid(), ownerId: user.id, width: 100, height: 100 });
      await ctx.newExif({ assetId: asset.id, exifImageHeight: 200, exifImageWidth: 100, orientation: '6' });
      ctx.getMock(JobRepository).queueAll.mockResolvedValue();

      await ctx.newEdits(asset.id, {
        edits: [
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Horizontal,
            },
          },
          {
            action: AssetEditAction.Mirror,
            parameters: {
              axis: MirrorAxis.Vertical,
            },
          },
        ],
      });

      const auth = factory.auth({ user });

      const dto: AssetFaceCreateDto = {
        imageWidth: 100,
        imageHeight: 100,
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        personId: person.personGroupId,
        assetId: asset.id,
      };

      await sut.createFace(auth, dto);

      const faces = sut.getFacesById(auth, { id: asset.id });
      await expect(faces).resolves.toHaveLength(1);
      await expect(faces).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 110,
            boundingBoxY1: 10,
            boundingBoxX2: 190,
            boundingBoxY2: 90,
          }),
        ]),
      );

      // remove edits and verify the stored coordinates map to the original image
      await ctx.newEdits(asset.id, { edits: [] });
      const facesAfterRemovingEdits = sut.getFacesById(auth, { id: asset.id });

      await expect(facesAfterRemovingEdits).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            person: expect.objectContaining({ id: person.personGroupId }),
            boundingBoxX1: 10,
            boundingBoxY1: 10,
            boundingBoxX2: 90,
            boundingBoxY2: 90,
          }),
        ]),
      );
    });
  });
});
