import { NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto.js';
import { AssetFaceCreateDto } from 'src/dtos/person.dto.js';
import { AssetFileType, AssetVisibility, JobName, JobStatus } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { PersonUserRepository } from 'src/repositories/person-user.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonService } from 'src/services/person.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

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
      PersonUserRepository,
      AssetRepository,
      AssetEditRepository,
      SystemMetadataRepository,
      UserRepository,
      ClusterGroupRepository,
    ],
    mock: [JobRepository, LoggingRepository, StorageRepository, MachineLearningRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PersonService.name, () => {
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

  describe('update', () => {
    it('should throw an error when there is no access', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user2.id });

      await expect(sut.update(factory.auth({ user }), person.personGroupId, { name: 'New name' })).rejects.toThrow(
        'Not found or no person.update access',
      );
    });

    it('should update the name and birth date for every user with write access', async () => {
      const { ctx, sut } = setup();
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { user: writer } = await ctx.newUser();
      const { user: reader } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: writer.id, name: 'Old name' });
      const { personGroupId } = person;
      await ctx.newPerson({ ownerId: reader.id, personGroupId, name: 'Old name' });
      await ctx.newPersonUser({
        personGroupId,
        sharedById: writer.id,
        sharedWithId: user.id,
        role: PersonUserRole.Write,
      });
      await ctx.newPersonUser({
        personGroupId,
        sharedById: reader.id,
        sharedWithId: user.id,
        role: PersonUserRole.Read,
      });

      await expect(
        sut.update(factory.auth({ user }), personGroupId, { name: 'New name', birthDate: '2000-01-01' }),
      ).resolves.toEqual(expect.objectContaining({ name: 'New name', birthDate: '2000-01-01' }));

      await expect(personRepo.getForUser({ userId: user.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'New name', birthDate: '2000-01-01' }),
      );
      await expect(personRepo.getForUser({ userId: writer.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'New name', birthDate: '2000-01-01' }),
      );
      await expect(personRepo.getForUser({ userId: reader.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'Old name', birthDate: null }),
      );
    });

    it('should only update the specified user when userId is provided', async () => {
      const { ctx, sut } = setup();
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { user: writer } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: writer.id, name: 'Old name' });
      const { personGroupId } = person;
      await ctx.newPersonUser({
        personGroupId,
        sharedById: writer.id,
        sharedWithId: user.id,
        role: PersonUserRole.Write,
      });

      await expect(
        sut.update(factory.auth({ user }), personGroupId, { name: 'New name', userId: writer.id }),
      ).resolves.toEqual(expect.objectContaining({ name: 'New name' }));

      await expect(personRepo.getForUser({ userId: writer.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'New name' }),
      );
      await expect(personRepo.getForUser({ userId: user.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'Old name' }),
      );
    });

    it('should only update personal properties for the current user', async () => {
      const { ctx, sut } = setup();
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { user: writer } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: writer.id, name: 'Old name' });
      const { personGroupId } = person;
      await ctx.newPersonUser({
        personGroupId,
        sharedById: writer.id,
        sharedWithId: user.id,
        role: PersonUserRole.Write,
      });

      await expect(
        sut.update(factory.auth({ user }), personGroupId, { name: 'New name', isFavorite: true, isHidden: true }),
      ).resolves.toEqual(expect.objectContaining({ name: 'New name', isFavorite: true, isHidden: true }));

      await expect(personRepo.getForUser({ userId: writer.id, personGroupId })).resolves.toEqual(
        expect.objectContaining({ name: 'New name', isFavorite: false, isHidden: false }),
      );
    });

    it('should not allow personal properties to be updated for another user', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: writer } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: writer.id });
      const { personGroupId } = person;
      await ctx.newPersonUser({
        personGroupId,
        sharedById: writer.id,
        sharedWithId: user.id,
        role: PersonUserRole.Write,
      });

      await expect(
        sut.update(factory.auth({ user }), personGroupId, { isFavorite: true, userId: writer.id }),
      ).rejects.toThrow('Only name and birthDate can be updated for other users');
    });
  });

  describe('delete', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.delete(auth, personId, {})).rejects.toThrow('Not found or no person.delete access');
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
      await expect(sut.delete(auth, person.personGroupId, {})).resolves.toBeUndefined();
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

  describe('mergePeople', () => {
    it('should merge people of multiple users', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser({ clusterGroupId: user1.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: user1.id, name: undefined });
      const { person: person2 } = await ctx.newPerson({ ownerId: user1.id });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person1.personGroupId,
      });
      await ctx.newPerson({
        ownerId: user2.id,
        personGroupId: person2.personGroupId,
        name: undefined,
      });
      const { asset } = await ctx.newAsset({ ownerId: user2.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person2.personGroupId });
      storageMock.unlink.mockResolvedValue();

      const auth = factory.auth({ user: user1 });

      await sut.mergePeople(auth, { ids: [person1.personGroupId, person2.personGroupId] });
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

      await sut.mergePeople(auth, { ids: [person1.personGroupId, person2.personGroupId] });
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

    it('should skip people with a different birth date', async () => {
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

      await sut.mergePeople(auth, { ids: [person1.personGroupId, person2.personGroupId] });
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

  describe('upsertPeopleUsers', () => {
    it('should throw error for sharedWith users that are not in the same cluster group', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      const auth = factory.auth({ user: owner });

      await expect(
        sut.upsertPeopleUsers(auth, {
          personIds: [person.personGroupId],
          sharedWithIds: [user1.id],
          role: PersonUserRole.Read,
        }),
      ).rejects.toThrow('All users must be in the same cluster group');

      await expect(sut.getUsersForPeople(auth, {})).resolves.toHaveLength(0);
    });

    it('should add user to person', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      const auth = factory.auth({ user: owner });

      await sut.upsertPeopleUsers(auth, {
        personIds: [person.personGroupId],
        sharedWithIds: [user1.id],
        role: PersonUserRole.Read,
      });

      await expect(sut.getUsersForPeople(auth, {})).resolves.toEqual([
        expect.objectContaining({
          sharedBy: expect.objectContaining({ id: owner.id }),
          sharedWith: expect.objectContaining({ id: user1.id }),
        }),
      ]);
    });

    it('should update the name and birthdate when sharing to an existing copy', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Owner name', birthDate: '1990-01-01' });
      await ctx.newPerson({ ownerId: user1.id, personGroupId: person.personGroupId, name: '', birthDate: null });

      await sut.upsertPeopleUsers(factory.auth({ user: owner }), {
        personIds: [person.personGroupId],
        sharedWithIds: [user1.id],
        role: PersonUserRole.Read,
      });

      await expect(sut.getById(factory.auth({ user: user1 }), person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ name: 'Owner name', birthDate: '1990-01-01' }),
      );
    });

    it('should skip updating when sharing to an existing copy with values', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Owner name', birthDate: '1990-01-01' });
      await ctx.newPerson({
        ownerId: user1.id,
        personGroupId: person.personGroupId,
        name: 'User1 name',
        birthDate: '2000-02-02',
      });

      await sut.upsertPeopleUsers(factory.auth({ user: owner }), {
        personIds: [person.personGroupId],
        sharedWithIds: [user1.id],
        role: PersonUserRole.Read,
      });

      await expect(sut.getById(factory.auth({ user: user1 }), person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ name: 'User1 name', birthDate: '2000-02-02' }),
      );
    });
  });

  describe('removeUsersFromPeople', () => {
    it('should work with an empty list', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: sharedWith } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      const auth = factory.auth({ user: owner });

      await sut.upsertPeopleUsers(auth, {
        personIds: [person.personGroupId],
        sharedWithIds: [sharedWith.id],
        role: PersonUserRole.Read,
      });

      await sut.removeUsersFromPeople(auth, []);

      await expect(sut.getUsersForPeople(auth, {})).resolves.toHaveLength(1);
    });

    it('should throw an error when there is no access', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: owner } = await ctx.newUser({ clusterGroupId: user.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      const auth = factory.auth({ user });

      await expect(
        sut.removeUsersFromPeople(auth, [{ personId: person.personGroupId, sharedWithId: user.id }]),
      ).rejects.toThrow('Not found or no person.update access');
    });

    it('should delete only the requested person and user pairs', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: user1 } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { user: user2 } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person: person1 } = await ctx.newPerson({ ownerId: owner.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: owner.id });
      const auth = factory.auth({ user: owner });

      await sut.upsertPeopleUsers(auth, {
        personIds: [person1.personGroupId, person2.personGroupId],
        sharedWithIds: [user1.id, user2.id],
        role: PersonUserRole.Read,
      });

      await expect(sut.getUsersForPeople(auth, {})).resolves.toHaveLength(4);

      await sut.removeUsersFromPeople(auth, [
        { personId: person1.personGroupId, sharedWithId: user1.id },
        { personId: person2.personGroupId, sharedWithId: user2.id },
      ]);

      const shares = await sut.getUsersForPeople(auth, {});
      expect(shares).toHaveLength(2);
      expect(shares).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ personId: person1.personGroupId, sharedWithId: user2.id }),
          expect.objectContaining({ personId: person2.personGroupId, sharedWithId: user1.id }),
        ]),
      );
    });

    it('should not delete the same pair shared by another user', async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: otherOwner } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { user: sharedWith } = await ctx.newUser({ clusterGroupId: owner.clusterGroupId });
      const { person } = await ctx.newPerson({ ownerId: owner.id });
      await ctx.newPerson({ ownerId: otherOwner.id, personGroupId: person.personGroupId });

      const auth = factory.auth({ user: owner });
      const otherAuth = factory.auth({ user: otherOwner });
      const dto = { personIds: [person.personGroupId], sharedWithIds: [sharedWith.id], role: PersonUserRole.Read };

      await sut.upsertPeopleUsers(auth, dto);
      await sut.upsertPeopleUsers(otherAuth, dto);

      await sut.removeUsersFromPeople(auth, [{ personId: person.personGroupId, sharedWithId: sharedWith.id }]);

      await expect(sut.getUsersForPeople(auth, {})).resolves.toEqual([]);
      await expect(sut.getUsersForPeople(otherAuth, {})).resolves.toEqual([
        expect.objectContaining({ personId: person.personGroupId, sharedWithId: sharedWith.id }),
      ]);
    });
  });
});
