import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { mapFaces, mapPerson } from 'src/dtos/person.dto';
import { QueueStatisticsDto } from 'src/dtos/queue.dto';
import {
  AssetFileType,
  AssetVisibility,
  CacheControl,
  JobName,
  JobStatus,
  MetadataKey,
  QueueJobStatus,
  QueueName,
  SourceType,
  SystemMetadataKey,
} from 'src/enum';
import { FaceSearchResult } from 'src/repositories/search.repository';
import { PersonService } from 'src/services/person.service';
import { StorageService } from 'src/services/storage.service';
import { ImmichFileResponse, ImmichStreamResponse } from 'src/utils/file';
import { AssetFaceFactory } from 'test/factories/asset-face.factory';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { PersonFactory } from 'test/factories/person.factory';
import { UserFactory } from 'test/factories/user.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import {
  getAsDetectedFace,
  getForAsset,
  getForAssetFace,
  getForDetectedFaces,
  getForFacialRecognitionJob,
} from 'test/mappers';
import { factory, newDate, newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

const recognitionCounts = (overrides: Partial<QueueStatisticsDto> = {}) =>
  factory.queueStatistics({
    active: 1,
    waiting: 0,
    delayed: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    ...overrides,
  });

describe(PersonService.name, () => {
  let sut: PersonService;
  let mocks: ServiceMocks;

  beforeAll(() => {
    (StorageService as any).diskBackend = new DiskStorageBackend('/data');
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PersonService));
    mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
    const faceIdentityMock = mocks.faceIdentity as any;
    faceIdentityMock.getAccessiblePeople ??= vi.fn();
    faceIdentityMock.getAccessiblePeopleStatistics ??= vi.fn();
    faceIdentityMock.getAccessiblePeopleFaceStatistics ??= vi.fn();
    faceIdentityMock.getAccessiblePersonByProfileId ??= vi.fn();
    faceIdentityMock.getAccessiblePersonStatistics ??= vi.fn();
    faceIdentityMock.getAccessibleProfileIdentityId ??= vi.fn();
    faceIdentityMock.hasBackfillWork ??= vi.fn();
    faceIdentityMock.getBackfillWork ??= vi.fn();
    faceIdentityMock.getBackfillWork.mockResolvedValue({
      hasPersonalIdentityWork: false,
      hasSpacePersonIdentityWork: false,
      hasSharedSpaceProjectionWork: false,
    });
    faceIdentityMock.getSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([]);
    faceIdentityMock.getPendingSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([]);
    faceIdentityMock.deletePendingSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.deletePendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue(void 0);
    faceIdentityMock.deleteUnreferencedIdentities ??= vi.fn();
    faceIdentityMock.deleteUnreferencedIdentities.mockResolvedValue(void 0);
    (mocks.person as any).getPeopleOverviewStatistics ??= vi.fn();
    (mocks.person as any).getPeopleFaceStatistics ??= vi.fn();
    (mocks.faceIdentity as any).getAccessiblePersonByProfileId.mockResolvedValue(void 0);
    (mocks.faceIdentity as any).getAccessibleProfileIdentityId.mockResolvedValue(void 0);
    mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);
    mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([]);
  });

  const expectNoFaceDetectionMutation = () => {
    expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalled();
    expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
    expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
  };

  const expectNoRecognitionMutation = () => {
    expect(mocks.search.searchFaces).not.toHaveBeenCalled();
    expect(mocks.person.create).not.toHaveBeenCalled();
    expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.ensurePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.getMergeConflicts).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalled();
  };

  const queuedBatchJobs = () => mocks.job.queueAll.mock.calls.flatMap(([jobs]) => jobs);
  const queuedBatchJobNames = () => queuedBatchJobs().map((job) => job.name);

  const expectNoRecognitionFanout = () => {
    expect(mocks.job.queue).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.FacialRecognitionQueueAll }),
    );
    expect(queuedBatchJobNames()).not.toContain(JobName.FacialRecognitionQueueAll);
    expect(queuedBatchJobNames()).not.toContain(JobName.FacialRecognition);
  };

  const expectNoRecognitionCoordinatorMutation = () => {
    expect(mocks.job.empty).not.toHaveBeenCalled();
    expect(mocks.database.prewarm).not.toHaveBeenCalled();
    expect(mocks.person.unassignFaces).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.unlinkFacesBySourceType).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
    expect((mocks.faceIdentity as any).deleteUnreferencedIdentities).not.toHaveBeenCalled();
    expect(mocks.person.vacuum).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalledWith({
      name: JobName.FaceIdentityMaintenanceAfterRecognition,
      data: expect.anything(),
    });
    expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
    expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
  };

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('onBootstrap', () => {
    it('should queue identity backfill when existing people or faces need identity links', async () => {
      (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(true);
      mocks.job.searchJobs.mockResolvedValue([]);

      await sut.onBootstrap();

      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: {},
      });
      expect(mocks.job.searchJobs).toHaveBeenCalledWith(QueueName.PeopleBackfill, expect.any(Object));
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.AssetDetectFacesQueueAll }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.FacialRecognitionQueueAll }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill }),
      );
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should skip identity backfill when no identity work remains', async () => {
      (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

      await sut.onBootstrap();

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.job.searchJobs).not.toHaveBeenCalled();
    });

    it('should not queue a new identity backfill root while another backfill page is pending', async () => {
      (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(true);
      mocks.job.searchJobs.mockResolvedValue([
        {
          id: 'face-identity-backfill/space-person/space-person-cursor',
          name: JobName.FaceIdentityBackfill,
          timestamp: Date.now(),
          data: { stage: 'space-person', cursor: 'space-person-cursor' },
        },
      ]);

      await sut.onBootstrap();

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should not queue a new identity backfill root while the root backfill is active', async () => {
      (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(true);
      mocks.job.searchJobs.mockResolvedValue([
        {
          id: 'face-identity-backfill/root',
          name: JobName.FaceIdentityBackfill,
          timestamp: Date.now(),
          data: {},
        },
      ]);

      await sut.onBootstrap();

      expect(mocks.job.searchJobs).toHaveBeenCalledWith(QueueName.PeopleBackfill, {
        status: expect.arrayContaining([
          QueueJobStatus.Active,
          QueueJobStatus.Delayed,
          QueueJobStatus.Paused,
          QueueJobStatus.Waiting,
        ]),
      });
      expect(mocks.job.searchJobs.mock.calls[0][1]?.status).toHaveLength(4);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('getAll', () => {
    it('should use the identity resolver when withSharedSpaces is true', async () => {
      const auth = AuthFactory.create();
      const response = {
        total: 1,
        hidden: 0,
        hasNextPage: false,
        people: [
          {
            id: 'person-1',
            name: 'Alice',
            birthDate: '1990-01-01',
            thumbnailPath: '',
            isHidden: false,
            isFavorite: true,
            type: 'person',
            species: null,
            updatedAt: new Date().toISOString(),
            numberOfAssets: 12,
            primaryProfile: { type: 'user-person', id: 'person-1' },
            filterId: 'person:person-1',
          },
        ],
      };
      (mocks.faceIdentity as any).getAccessiblePeople.mockResolvedValue(response);

      await expect(
        sut.getAll(auth, { withHidden: true, withSharedSpaces: true, page: 1, size: 50 } as any),
      ).resolves.toEqual(response);

      expect((mocks.faceIdentity as any).getAccessiblePeople).toHaveBeenCalledWith(auth.user.id, {
        withHidden: true,
        page: 1,
        size: 50,
        minimumFaceCount: 3,
      });
      expect(mocks.person.getAllForUser).not.toHaveBeenCalled();
    });

    it('should preserve identity-aware people ordering returned by repository', async () => {
      const auth = AuthFactory.create();
      const response = {
        total: 4,
        hidden: 0,
        hasNextPage: false,
        people: [
          { id: 'favorite', name: 'Anna', isFavorite: true, numberOfAssets: 1 },
          { id: 'named', name: 'Bob', numberOfAssets: 20 },
          { id: 'unnamed-high', name: '', numberOfAssets: 50 },
          { id: 'unnamed-low', name: '', numberOfAssets: 1 },
        ],
      };

      (mocks.faceIdentity as any).getAccessiblePeople.mockResolvedValue(response);

      await expect(
        sut.getAll(auth, { withSharedSpaces: true, withHidden: false, page: 1, size: 10 } as any),
      ).resolves.toEqual(response);
    });

    it('should keep legacy people behavior when withSharedSpaces is omitted', async () => {
      const auth = AuthFactory.create();
      mocks.person.getAllForUser.mockResolvedValue({ items: [], hasNextPage: false });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 0, hidden: 0 });

      await sut.getAll(auth, { withHidden: true, page: 1, size: 50 });

      expect((mocks.faceIdentity as any).getAccessiblePeople).not.toHaveBeenCalled();
      expect(mocks.person.getAllForUser).toHaveBeenCalled();
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should get all hidden and visible people with thumbnails', async () => {
      const auth = AuthFactory.create();
      const [person, hiddenPerson] = [PersonFactory.create(), PersonFactory.create({ isHidden: true })];

      mocks.person.getAllForUser.mockResolvedValue({
        items: [person, hiddenPerson],
        hasNextPage: false,
      });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 2, hidden: 1 });
      await expect(sut.getAll(auth, { withHidden: true, page: 1, size: 10 })).resolves.toEqual({
        hasNextPage: false,
        total: 2,
        hidden: 1,
        people: [
          expect.objectContaining({ id: person.id, isHidden: false }),
          expect.objectContaining({
            id: hiddenPerson.id,
            isHidden: true,
          }),
        ],
      });
      expect(mocks.person.getAllForUser).toHaveBeenCalledWith({ skip: 0, take: 10 }, auth.user.id, {
        minimumFaceCount: 3,
        withHidden: true,
      });
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should get all visible people and favorites should be first in the array', async () => {
      const auth = AuthFactory.create();
      const [isFavorite, person] = [PersonFactory.create({ isFavorite: true }), PersonFactory.create()];

      mocks.person.getAllForUser.mockResolvedValue({
        items: [isFavorite, person],
        hasNextPage: false,
      });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 2, hidden: 1 });
      await expect(sut.getAll(auth, { withHidden: false, page: 1, size: 10 })).resolves.toEqual({
        hasNextPage: false,
        total: 2,
        hidden: 1,
        people: [
          expect.objectContaining({
            id: isFavorite.id,
            isFavorite: true,
          }),
          expect.objectContaining({ id: person.id, isFavorite: false }),
        ],
      });
      expect(mocks.person.getAllForUser).toHaveBeenCalledWith({ skip: 0, take: 10 }, auth.user.id, {
        minimumFaceCount: 3,
        withHidden: false,
      });
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should preserve non-shared repository order for favorites, named people, and unnamed count ordering', async () => {
      const auth = AuthFactory.create();
      const favorite = PersonFactory.create({ id: 'favorite', name: 'Anna', isFavorite: true });
      const named = PersonFactory.create({ id: 'named', name: 'Bob', isFavorite: false });
      const unnamedHigh = PersonFactory.create({ id: 'unnamed-high', name: '', isFavorite: false });
      const unnamedLow = PersonFactory.create({ id: 'unnamed-low', name: '', isFavorite: false });

      mocks.person.getAllForUser.mockResolvedValue({
        items: [favorite, named, unnamedHigh, unnamedLow],
        hasNextPage: false,
      });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 4, hidden: 0 });

      const result = await sut.getAll(auth, { withHidden: false, page: 1, size: 10 });

      expect(result.people.map((person) => person.id)).toEqual(['favorite', 'named', 'unnamed-high', 'unnamed-low']);
    });
  });

  describe('getPeopleStatistics', () => {
    it('uses identity-grouped global scope when withSharedSpaces is true', async () => {
      const auth = AuthFactory.create();
      (mocks.faceIdentity as any).getAccessiblePeopleStatistics.mockResolvedValue({
        total: 3,
        hidden: 1,
        detectedFaceCount: 11,
      });

      await expect(
        sut.getPeopleStatistics(auth, { withSharedSpaces: true, page: 4, size: 10 } as any),
      ).resolves.toEqual({
        total: 3,
        hidden: 1,
        detectedFaceCount: 11,
      });

      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
    });

    it('uses personal-only scope when withSharedSpaces is omitted', async () => {
      const auth = AuthFactory.create();
      (mocks.person as any).getPeopleOverviewStatistics.mockResolvedValue({
        total: 2,
        hidden: 0,
        detectedFaceCount: 5,
      });

      await expect(sut.getPeopleStatistics(auth, { page: 1, size: 50 } as any)).resolves.toEqual({
        total: 2,
        hidden: 0,
        detectedFaceCount: 5,
      });

      expect((mocks.person as any).getPeopleOverviewStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-person filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleStatistics(auth, { closestPersonId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-asset filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleStatistics(auth, { closestAssetId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });
  });

  describe('getPeopleFaceStatistics', () => {
    it('uses identity-grouped global scope when withSharedSpaces is true', async () => {
      const auth = AuthFactory.create();
      (mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 11,
        assignedVisibleFaceCount: 7,
        namedVisiblePersonCount: 3,
        assignedHiddenFaceCount: 2,
        unassignedFaceCount: 2,
      });

      await expect(
        sut.getPeopleFaceStatistics(auth, { withSharedSpaces: true, page: 4, size: 10 } as any),
      ).resolves.toEqual({
        detectedFaceCount: 11,
        assignedVisibleFaceCount: 7,
        namedVisiblePersonCount: 3,
        assignedHiddenFaceCount: 2,
        unassignedFaceCount: 2,
      });

      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('uses personal-only scope when withSharedSpaces is omitted', async () => {
      const auth = AuthFactory.create();
      (mocks.person as any).getPeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 5,
        assignedVisibleFaceCount: 4,
        namedVisiblePersonCount: 2,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 0,
      });

      await expect(sut.getPeopleFaceStatistics(auth, { page: 1, size: 50 } as any)).resolves.toEqual({
        detectedFaceCount: 5,
        assignedVisibleFaceCount: 4,
        namedVisiblePersonCount: 2,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 0,
      });

      expect((mocks.person as any).getPeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-person filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleFaceStatistics(auth, { closestPersonId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-asset filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleFaceStatistics(auth, { closestAssetId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      mocks.person.getById.mockResolvedValue(person);
      await expect(sut.getById(auth, person.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should throw a bad request when person is not found', async () => {
      const auth = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['unknown']));
      await expect(sut.getById(auth, 'unknown')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(['unknown']));
    });

    it('should get a person by id', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      await expect(sut.getById(auth, person.id)).resolves.toEqual(expect.objectContaining({ id: person.id }));
      expect(mocks.person.getById).toHaveBeenCalledWith(person.id);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should resolve an accessible shared-space profile id as an identity-wide person', async () => {
      const auth = AuthFactory.create();
      const profileId = newUuid();
      const accessiblePerson = {
        id: profileId,
        name: 'Shared Alice',
        birthDate: null,
        thumbnailPath: '',
        isHidden: false,
        type: 'person',
        species: null,
        numberOfAssets: 7,
        filterId: `space-person:${profileId}`,
        primaryProfile: { type: 'space-person', id: profileId, spaceId: newUuid() },
      };

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessiblePersonByProfileId.mockResolvedValue(accessiblePerson);

      await expect(sut.getById(auth, profileId)).resolves.toEqual(accessiblePerson);
      expect((mocks.faceIdentity as any).getAccessiblePersonByProfileId).toHaveBeenCalledWith(auth.user.id, profileId);
      expect(mocks.person.getById).not.toHaveBeenCalled();
    });

    it('should keep resolving a local person after shared-space access is removed', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ ownerId: auth.user.id });

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.getById(auth, person.id)).resolves.toEqual(expect.objectContaining({ id: person.id }));

      expect(mocks.person.getById).toHaveBeenCalledWith(person.id);
      expect((mocks.faceIdentity as any).getAccessiblePersonByProfileId).not.toHaveBeenCalled();
    });

    it('should stop resolving a shared-space profile id after shared-space access is removed', async () => {
      const auth = AuthFactory.create();
      const profileId = newUuid();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessiblePersonByProfileId.mockResolvedValue(void 0);

      await expect(sut.getById(auth, profileId)).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.faceIdentity as any).getAccessiblePersonByProfileId).toHaveBeenCalledWith(auth.user.id, profileId);
      expect(mocks.person.getById).not.toHaveBeenCalled();
    });
  });

  describe('getThumbnail', () => {
    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      await expect(sut.getThumbnail(auth, person.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should throw an error when personId is invalid', async () => {
      const auth = AuthFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['unknown']));
      await expect(sut.getThumbnail(auth, 'unknown')).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(['unknown']));
    });

    it('should throw an error when person has no thumbnail', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ thumbnailPath: '' });

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      await expect(sut.getThumbnail(auth, person.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should serve the thumbnail', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      await expect(sut.getThumbnail(auth, person.id)).resolves.toEqual(
        new ImmichFileResponse({
          path: person.thumbnailPath,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      );
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should serve the thumbnail when the person is visible through a shared space', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.getThumbnail(auth, person.id)).resolves.toEqual(
        new ImmichFileResponse({
          path: person.thumbnailPath,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      );
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
      expect(mocks.access.person.checkSharedSpaceAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });
  });

  describe('representative face', () => {
    it('updates a personal representative face by exact assetFaceId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personId: person.id });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: face.id });

      await expect(sut.updateRepresentativeFace(auth, person.id, { assetFaceId: face.id })).resolves.toEqual(
        expect.objectContaining({ id: person.id }),
      );

      expect(mocks.person.getRepresentativeFaceForUpdate).toHaveBeenCalledWith({
        personId: person.id,
        assetFaceId: face.id,
      });
      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, faceAssetId: face.id });
      expect(mocks.faceIdentity.updateRepresentativeFace).toHaveBeenCalledWith({
        identityId: person.identityId,
        assetFaceId: face.id,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonGenerateThumbnail, data: { id: person.id } });
    });

    it('rejects a face that does not belong to the requested person or identity', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(
        undefined as Awaited<ReturnType<typeof mocks.person.getRepresentativeFaceForUpdate>>,
      );

      await expect(sut.updateRepresentativeFace(auth, person.id, { assetFaceId: 'face-1' })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('rejects a selected face when the actor cannot read the face asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personId: person.id });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.id, { assetFaceId: face.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('lists exact personal face crops for the picker', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([
        {
          ...AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personId: person.id }),
          fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
        {
          ...AssetFaceFactory.create({ id: 'face-2', assetId: 'asset-2', personId: person.id }),
          fileCreatedAt: new Date('2024-01-02T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
      ]);

      await expect(sut.getFacesForPicker(auth, person.id, { page: 1, size: 1 })).resolves.toEqual({
        faces: [expect.objectContaining({ id: 'face-1', assetId: 'asset-1', isRepresentative: true })],
        hasNextPage: true,
      });
    });

    it('serves a personal picker face crop only for faces belonging to the person', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      const cleanup = vi.fn();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/preview.jpg', cleanup });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('decoded-image'),
        info: { width: 250, height: 250, channels: 3, format: 'jpeg', size: 0, premultiplied: false },
      });
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('cropped-face'));
      });

      const result = await sut.getFaceThumbnail(auth, 'person-1', 'face-1');

      expect(mocks.person.getRepresentativeFaceForUpdate).toHaveBeenCalledWith({
        personId: 'person-1',
        assetFaceId: 'face-1',
      });
      expect(mocks.media.generateThumbnail).toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalled();
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }
    });
  });

  describe('update', () => {
    it('should require person.write permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      await expect(sut.update(auth, person.id, { name: 'Person 1' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should throw an error when personId is invalid', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      await expect(sut.update(authStub.admin, 'person-1', { name: 'Person 1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set(['person-1']));
    });

    it("should update a person's name", async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ name: 'Person 1' });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { name: 'Person 1' })).resolves.toEqual(
        expect.objectContaining({ id: person.id, name: 'Person 1' }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, name: 'Person 1' });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should queue scoped space metadata backfill when an identity-backed person name changes', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ name: 'Aurelia', identityId: 'identity-1' });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { name: 'Aurelia' })).resolves.toEqual(
        expect.objectContaining({ id: person.id, name: 'Aurelia' }),
      );

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: 'identity-1' },
      });
    });

    it("should update a person's date of birth", async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ birthDate: new Date('1976-06-30') });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { birthDate: '1976-06-30' })).resolves.toEqual({
        id: person.id,
        name: person.name,
        birthDate: '1976-06-30',
        thumbnailPath: person.thumbnailPath,
        isHidden: false,
        isFavorite: false,
        color: undefined,
        type: 'person',
        species: null,
        updatedAt: expect.any(String),
      });
      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, birthDate: '1976-06-30' });
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should update a person visibility', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ isHidden: true });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { isHidden: true })).resolves.toEqual(
        expect.objectContaining({ isHidden: true }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, isHidden: true });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should update a person favorite status', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ isFavorite: true });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { isFavorite: true })).resolves.toEqual(
        expect.objectContaining({ isFavorite: true }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, isFavorite: true });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it("should update a person's thumbnailPath", async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.update.mockResolvedValue(person);
      mocks.person.getForFeatureFaceUpdate.mockResolvedValue(face);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { featureFaceAssetId: face.assetId })).resolves.toEqual(
        expect.objectContaining({ id: person.id }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, faceAssetId: face.id });
      expect(mocks.person.getForFeatureFaceUpdate).toHaveBeenCalledWith({
        assetId: face.assetId,
        personId: person.id,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { id: person.id },
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should throw an error when the face feature assetId is invalid', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.update(auth, person.id, { featureFaceAssetId: '-1' })).rejects.toThrow(BadRequestException);
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    describe('suggestion on-name trigger', () => {
      const enabled = {
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
      };

      it('enqueues a scan when an unnamed cluster is named (edge 5)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: '', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

        await sut.update(auth, prior.id, { name: 'Alice' });

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.id } });
      });

      it('enqueues a scan on rename of an already-named person (edge 6)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Bob' });

        await sut.update(auth, prior.id, { name: 'Bob' });

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.id } });
      });

      it('does NOT enqueue on a color/favorite/birthDate edit (name unchanged) (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior }); // name unchanged

        await sut.update(auth, prior.id, { isFavorite: true });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.id },
        });
      });

      it('does NOT enqueue when name is cleared (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: '' });

        await sut.update(auth, prior.id, { name: '' });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.id },
        });
      });

      it('does NOT enqueue when a person becomes hidden (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, isHidden: true }); // name unchanged

        await sut.update(auth, prior.id, { isHidden: true });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.id },
        });
      });

      it('does NOT enqueue when the feature is disabled', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
        });
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: '', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.id]));
        mocks.person.getById.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

        await sut.update(auth, prior.id, { name: 'Alice' });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.id },
        });
      });
    });
  });

  describe('updateAll', () => {
    it('should throw an error when personId is invalid', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.updateAll(authStub.admin, { people: [{ id: 'person-1', name: 'Person 1' }] })).resolves.toEqual([
        { error: BulkIdErrorReason.UNKNOWN, id: 'person-1', success: false },
      ]);
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set(['person-1']));
    });
  });

  describe('reassignFaces', () => {
    it('should throw an error if user has no access to the person', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(
        sut.reassignFaces(AuthFactory.create(), 'person-id', {
          data: [{ personId: 'asset-face-1', assetId: '' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalledWith();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith();
    });

    it('should reassign a face', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.refreshFaces.mockResolvedValue();
      mocks.person.reassignFace.mockResolvedValue(5);
      mocks.person.update.mockResolvedValue(person);

      await expect(
        sut.reassignFaces(auth, person.id, {
          data: [{ personId: person.id, assetId: face.assetId }],
        }),
      ).resolves.toBeDefined();

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.PersonGenerateThumbnail,
          data: { id: person.id },
        },
      ]);
    });

    it('should replace identity links for reassigned faces', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);

      await sut.reassignFaces(auth, person.id, {
        data: [{ personId: person.id, assetId: face.assetId }],
      });

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.id);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'manual',
      });
    });
  });

  describe('handlePersonMigration', () => {
    it('should not move person files', async () => {
      await expect(sut.handlePersonMigration(PersonFactory.create())).resolves.toBe(JobStatus.Failed);
    });

    it('should skip persons with relative S3 thumbnail paths', async () => {
      const person = PersonFactory.create({ thumbnailPath: 'thumbs/user/ab/cd/person.jpeg' });
      mocks.person.getById.mockResolvedValue(person);

      await expect(sut.handlePersonMigration({ id: person.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('should skip persons with empty thumbnail paths', async () => {
      const person = PersonFactory.create({ thumbnailPath: '' });
      mocks.person.getById.mockResolvedValue(person);

      await expect(sut.handlePersonMigration({ id: person.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });
  });

  describe('getFacesById', () => {
    it('should get the bounding boxes for an asset', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.create();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });
      await expect(sut.getFacesById(auth, { id: face.assetId })).resolves.toStrictEqual([
        mapFaces(getForAssetFace(face), auth),
      ]);
    });

    it('should reject if the user has not access to the asset', async () => {
      const face = AssetFaceFactory.create();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      await expect(sut.getFacesById(AuthFactory.create(), { id: face.assetId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('createFace', () => {
    it('should create a manual face and initialize the person feature photo creation', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });
      const featureFace = AssetFaceFactory.create({
        assetId: asset.id,
        personId: person.id,
        sourceType: SourceType.Manual,
      });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRandomFace.mockResolvedValue(featureFace);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: featureFace.id });

      await expect(
        sut.createFace(auth, {
          assetId: asset.id,
          personId: person.id,
          imageHeight: 500,
          imageWidth: 400,
          x: 10,
          y: 20,
          width: 100,
          height: 110,
        }),
      ).resolves.toBeUndefined();

      expect(mocks.asset.getById).toHaveBeenCalledWith(asset.id, { edits: true, exifInfo: true });
      expect(mocks.person.createAssetFace).toHaveBeenCalledWith({
        assetId: asset.id,
        personId: person.id,
        imageHeight: 500,
        imageWidth: 400,
        boundingBoxX1: 10,
        boundingBoxX2: 110,
        boundingBoxY1: 20,
        boundingBoxY2: 130,
        sourceType: SourceType.Manual,
      });
      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(person.id);
      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.id, faceAssetId: featureFace.id });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonGenerateThumbnail, data: { id: person.id } },
      ]);
    });

    it('should not update the person feature photo if one already exists', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ faceAssetId: newUuid() });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));
      mocks.person.getById.mockResolvedValue(person);

      await expect(
        sut.createFace(auth, {
          assetId: asset.id,
          personId: person.id,
          imageHeight: 500,
          imageWidth: 400,
          x: 10,
          y: 20,
          width: 100,
          height: 110,
        }),
      ).resolves.toBeUndefined();

      expect(mocks.person.createAssetFace).toHaveBeenCalledOnce();
      expect(mocks.person.getRandomFace).not.toHaveBeenCalled();
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('createNewFeaturePhoto', () => {
    it('should change person feature photo', async () => {
      const person = PersonFactory.create();

      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      await sut.createNewFeaturePhoto([person.id]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.PersonGenerateThumbnail,
          data: { id: person.id },
        },
      ]);
    });
  });

  describe('reassignFacesById', () => {
    it('should create a new person', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);
      await expect(sut.reassignFacesById(AuthFactory.create(), person.id, { id: face.id })).resolves.toEqual({
        birthDate: person.birthDate,
        isHidden: person.isHidden,
        isFavorite: person.isFavorite,
        id: person.id,
        name: person.name,
        thumbnailPath: person.thumbnailPath,
        color: undefined,
        type: 'person',
        species: null,
        updatedAt: expect.any(String),
      });

      expect(mocks.job.queue).not.toHaveBeenCalledWith();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith();
    });

    it('should replace identity links when reassigning a face by id', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.id, { id: face.id });

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.id);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'manual',
      });
    });

    it('should fail if user has not the correct permissions on the asset', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);
      await expect(
        sut.reassignFacesById(AuthFactory.create(), person.id, {
          id: face.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.job.queue).not.toHaveBeenCalledWith();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith();
    });
  });

  describe('createPerson', () => {
    it('should create a new person', async () => {
      const auth = AuthFactory.create();

      mocks.person.create.mockResolvedValue(PersonFactory.create());
      await expect(sut.create(auth, {})).resolves.toBeDefined();

      expect(mocks.person.create).toHaveBeenCalledWith({ ownerId: auth.user.id });
    });
  });

  describe('handlePersonCleanup', () => {
    it('should delete people without faces', async () => {
      const person = PersonFactory.create();

      mocks.person.getAllWithoutFaces.mockResolvedValue([person]);

      await sut.handlePersonCleanup();

      expect(mocks.person.delete).toHaveBeenCalledWith([person.id]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person.thumbnailPath] },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });
  });

  describe('handleQueueDetectFaces', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      await expect(sut.handleQueueDetectFaces({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it.each([
      ['force=false', false],
      ['force omitted', undefined],
    ] as const)('should queue per-asset detection without destructive cleanup when %s', async (_label, force) => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([asset1, asset2]));

      await expect(sut.handleQueueDetectFaces({ force })).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.streamForDetectFacesJob).toHaveBeenCalledWith(force);
      expect(mocks.person.deleteFaces).not.toHaveBeenCalled();
      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
      expect(mocks.person.vacuum).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: asset1.id } },
        { name: JobName.AssetDetectFaces, data: { id: asset2.id } },
      ]);

      if (force === undefined) {
        expect(mocks.job.queue).toHaveBeenCalledTimes(1);
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonCleanup });
      } else {
        expect(mocks.job.queue).not.toHaveBeenCalled();
      }
    });

    it('should force-detect all assets after deleting only machine-learning faces', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const orphan = PersonFactory.create();

      mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([asset1, asset2]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([orphan]);
      mocks.sharedSpace.deleteAllOrphanedPersons.mockResolvedValue(void 0 as any);

      await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.deleteFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.deleteFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
      expect(mocks.person.deleteFaces).not.toHaveBeenCalledWith({ sourceType: SourceType.Manual });
      expect(mocks.person.deleteFaces).not.toHaveBeenCalledWith({ sourceType: SourceType.Exif });
      expect(mocks.person.delete).toHaveBeenCalledWith([orphan.id]);
      expect(mocks.sharedSpace.deleteAllOrphanedPersons).toHaveBeenCalledTimes(1);
      expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: true });
      expect(mocks.assetJob.streamForDetectFacesJob).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: asset1.id, force: true } },
        { name: JobName.AssetDetectFaces, data: { id: asset2.id, force: true } },
      ]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [orphan.thumbnailPath] },
      });
    });

    it('should not enqueue recognition or cleanup shortcuts when the detection stream is empty', async () => {
      mocks.assetJob.streamForDetectFacesJob.mockReturnValue(makeStream([]));

      await expect(sut.handleQueueDetectFaces({ force: false })).resolves.toBe(JobStatus.Success);

      expect(queuedBatchJobs()).toEqual([]);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.person.deleteFaces).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllOrphanedPersons).not.toHaveBeenCalled();
      expectNoRecognitionFanout();
    });
  });

  describe('handleQueueRecognizeFaces', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      await expect(sut.handleQueueRecognizeFaces({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should skip if recognition jobs are already queued', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 1,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      await expect(sut.handleQueueRecognizeFaces({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it.each([
      ['scheduled non-force nightly', { force: false, nightly: true }],
      ['defensive force+nightly payload', { force: true, nightly: true }],
    ] as const)(
      'skips %s before prerequisite waits or destructive reset when no new faces exist',
      async (_label, data) => {
        const lastRun = new Date('2026-05-17T02:00:00.000Z');
        mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });
        mocks.person.getLatestFaceDate.mockResolvedValue(new Date(lastRun.getTime() - 1000).toISOString());
        mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ waiting: 25_000, delayed: 1000, paused: 3 }));

        await expect(sut.handleQueueRecognizeFaces(data)).resolves.toBe(JobStatus.Skipped);

        expect(mocks.systemMetadata.get).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState);
        expect(mocks.person.getLatestFaceDate).toHaveBeenCalledOnce();
        expect(mocks.job.waitForQueueCompletion).not.toHaveBeenCalled();
        expect(mocks.person.getAllFaces).not.toHaveBeenCalled();
        expectNoRecognitionCoordinatorMutation();
      },
    );

    it.each([
      ['waiting jobs', { waiting: 87_000 }],
      ['delayed jobs', { delayed: 42 }],
      ['paused jobs', { paused: 9 }],
      ['another active job besides the coordinator', { active: 2 }],
    ] as const)('skips non-force recognition when FacialRecognition has %s', async (_label, counts) => {
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts(counts));
      mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));

      await expect(sut.handleQueueRecognizeFaces({ force: false })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.ThumbnailGeneration,
        QueueName.FaceDetection,
      );
      expectNoRecognitionCoordinatorMutation();
    });

    it('does not expand a large stuck nightly queue or clear shared-space people', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ lastRun: '2026-05-16T00:00:00.000Z' });
      mocks.person.getLatestFaceDate.mockResolvedValue('2026-05-17T00:00:00.000Z');
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ waiting: 87_000 }));
      mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));

      await expect(sut.handleQueueRecognizeFaces({ force: false, nightly: true })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: JobName.FacialRecognition })]),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: expect.anything(),
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
      expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should queue missing assets', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({});

      expect(mocks.person.getAllFaces).toHaveBeenCalledWith({
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false },
        },
      ]);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
        lastRun: expect.any(String),
      });
      expect(mocks.person.vacuum).not.toHaveBeenCalled();
    });

    it('should queue all machine-learning faces on force reset', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true });

      expect(mocks.person.getAllFaces).toHaveBeenCalledWith({
        sourceType: SourceType.MachineLearning,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false, skipSharedSpaceMatch: true },
        },
      ]);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
        lastRun: expect.any(String),
      });
      expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: false });
    });

    it('force recognition waits for thumbnail, face detection, and people backfill before draining and clearing identities', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.ThumbnailGeneration,
        QueueName.FaceDetection,
        QueueName.PeopleBackfill,
      );
      expect(mocks.job.waitForQueueCompletion.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.job.empty.mock.invocationCallOrder[0],
      );
      expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.person.unassignFaces.mock.invocationCallOrder[0],
      );
      expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.faceIdentity.unlinkFacesBySourceType.mock.invocationCallOrder[0],
      );
      expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sharedSpace.deleteAllPersonFaces.mock.invocationCallOrder[0],
      );
      expect(mocks.job.empty.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sharedSpace.deleteAllPersons.mock.invocationCallOrder[0],
      );
    });

    it('force recognition performs the full ML reset and maintenance handoff contract', async () => {
      const mlFace = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
      const orphan = PersonFactory.create();
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.person.getAllFaces.mockReturnValue(makeStream([mlFace]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([orphan]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['enabled-space']);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.empty).toHaveBeenCalledWith(QueueName.FacialRecognition, true);
      expect(mocks.person.unassignFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
      expect(mocks.faceIdentity.unlinkFacesBySourceType).toHaveBeenCalledWith(SourceType.MachineLearning);
      expect(mocks.person.delete).toHaveBeenCalledWith([orphan.id]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [orphan.thumbnailPath] },
      });
      expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: false });
      expect(mocks.sharedSpace.deleteAllPersonFaces).toHaveBeenCalledOnce();
      expect(mocks.sharedSpace.deleteAllPersons).toHaveBeenCalledOnce();
      expect((mocks.faceIdentity as any).deleteUnreferencedIdentities).toHaveBeenCalledOnce();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: mlFace.id, deferred: false, skipSharedSpaceMatch: true },
        },
      ]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space' } },
      ]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: {},
      });
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
        lastRun: expect.any(String),
      });
    });

    it('force recognition queues only machine-learning faces and suppresses per-face shared-space matching', async () => {
      const mlFace = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.person.getAllFaces.mockReturnValue(makeStream([mlFace]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.getAllFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
      expect(mocks.person.getAllFaces).not.toHaveBeenCalledWith(undefined);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: mlFace.id, deferred: false, skipSharedSpaceMatch: true },
        },
      ]);
    });

    it('force recognition queues SharedSpaceFaceMatchAll only for enabled spaces after personal jobs', async () => {
      const face = AssetFaceFactory.from({ sourceType: SourceType.MachineLearning }).person().build();
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['enabled-space-1', 'enabled-space-2']);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      const queueAllCalls = mocks.job.queueAll.mock.calls;
      const personalJobCall = queueAllCalls.findIndex((call) =>
        call[0].some((job) => job.name === JobName.FacialRecognition),
      );
      const sharedSpaceCall = queueAllCalls.findIndex((call) =>
        call[0].some((job) => job.name === JobName.SharedSpaceFaceMatchAll),
      );

      expect(personalJobCall).toBeGreaterThanOrEqual(0);
      expect(sharedSpaceCall).toBeGreaterThan(personalJobCall);
      expect(queueAllCalls[sharedSpaceCall][0]).toEqual([
        { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space-1' } },
        { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'enabled-space-2' } },
      ]);
    });

    it('force recognition queues personal face jobs with shared-space matching suppressed', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue(factory.queueStatistics());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false, skipSharedSpaceMatch: true },
        },
      ]);
    });

    it('non-force recognition keeps incremental shared-space matching enabled', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue(factory.queueStatistics());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: false });

      expect(mocks.job.empty).not.toHaveBeenCalledWith(QueueName.FacialRecognition, true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false },
        },
      ]);
    });

    it('should unlink existing ML identity links when force resets recognition assignments', async () => {
      const face = AssetFaceFactory.from().person().build();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.person.unassignFaces.mockResolvedValue();
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true });

      expect(mocks.faceIdentity.unlinkFacesBySourceType).toHaveBeenCalledWith(SourceType.MachineLearning);
    });

    it('should delete unreferenced identities after force reset removes people and shared-space people', async () => {
      const face = AssetFaceFactory.from().person().build();
      mocks.job.getJobCounts.mockResolvedValue(factory.queueStatistics());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.person.unassignFaces.mockResolvedValue();
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true });

      expect((mocks.faceIdentity as any).deleteUnreferencedIdentities).toHaveBeenCalledOnce();
      expect(mocks.faceIdentity.unlinkFacesBySourceType.mock.invocationCallOrder[0]).toBeLessThan(
        (mocks.faceIdentity as any).deleteUnreferencedIdentities.mock.invocationCallOrder[0],
      );
      expect(mocks.sharedSpace.deleteAllPersonFaces.mock.invocationCallOrder[0]).toBeLessThan(
        (mocks.faceIdentity as any).deleteUnreferencedIdentities.mock.invocationCallOrder[0],
      );
      expect(mocks.sharedSpace.deleteAllPersons.mock.invocationCallOrder[0]).toBeLessThan(
        (mocks.faceIdentity as any).deleteUnreferencedIdentities.mock.invocationCallOrder[0],
      );
    });

    it('should run nightly if new face has been added since last run', async () => {
      const face = AssetFaceFactory.create();
      mocks.person.getLatestFaceDate.mockResolvedValue(new Date().toISOString());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.person.unassignFaces.mockResolvedValue();

      await sut.handleQueueRecognizeFaces({ force: false, nightly: true });

      expect(mocks.systemMetadata.get).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState);
      expect(mocks.person.getLatestFaceDate).toHaveBeenCalledOnce();
      expect(mocks.person.getAllFaces).toHaveBeenCalledWith({
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false },
        },
      ]);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState, {
        lastRun: expect.any(String),
      });
      expect(mocks.person.vacuum).not.toHaveBeenCalled();
    });

    it('should skip nightly if no new face has been added since last run', async () => {
      const lastRun = new Date();

      mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });
      mocks.person.getLatestFaceDate.mockResolvedValue(new Date(lastRun.getTime() - 1).toISOString());
      mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true, nightly: true });

      expect(mocks.systemMetadata.get).toHaveBeenCalledWith(SystemMetadataKey.FacialRecognitionState);
      expect(mocks.person.getLatestFaceDate).toHaveBeenCalledOnce();
      expect(mocks.person.getAllFaces).not.toHaveBeenCalled();
      expect(mocks.job.empty).not.toHaveBeenCalledWith(QueueName.FacialRecognition, true);
      expect(mocks.person.unassignFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFacesBySourceType).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(mocks.person.vacuum).not.toHaveBeenCalled();
    });

    it('should delete existing people if forced', async () => {
      const face = AssetFaceFactory.from().person().build();
      const person = PersonFactory.create();

      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream([face.person!, person]));
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([person]);
      mocks.person.unassignFaces.mockResolvedValue();
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: true });

      expect(mocks.person.deleteFaces).not.toHaveBeenCalled();
      expect(mocks.person.unassignFaces).toHaveBeenCalledWith({ sourceType: SourceType.MachineLearning });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.FacialRecognition,
          data: { id: face.id, deferred: false, skipSharedSpaceMatch: true },
        },
      ]);
      expect(mocks.person.delete).toHaveBeenCalledWith([person.id]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person.thumbnailPath] },
      });
      expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: false });
    });

    describe('force wipes space state', () => {
      it('should preserve force face recognition full reset by wiping shared_space_person tables and queueing SharedSpaceFaceMatchAll per space', async () => {
        const face = AssetFaceFactory.from().person().build();
        mocks.job.getJobCounts.mockResolvedValue({
          active: 1,
          waiting: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        });
        mocks.person.getAll.mockReturnValue(makeStream([face.person!]));
        mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
        mocks.person.getAllWithoutFaces.mockResolvedValue([]);
        mocks.person.unassignFaces.mockResolvedValue();
        mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
        mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
        mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['space-a', 'space-b']);

        await sut.handleQueueRecognizeFaces({ force: true });

        expect(mocks.sharedSpace.deleteAllPersonFaces).toHaveBeenCalledOnce();
        expect(mocks.sharedSpace.deleteAllPersons).toHaveBeenCalledOnce();
        expect(mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled).toHaveBeenCalledOnce();
        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'space-a' } },
          { name: JobName.SharedSpaceFaceMatchAll, data: { spaceId: 'space-b' } },
        ]);
      });

      it('should not wipe space state when force=false', async () => {
        const face = AssetFaceFactory.create();
        mocks.job.getJobCounts.mockResolvedValue({
          active: 1,
          waiting: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        });
        mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
        mocks.person.getAllWithoutFaces.mockResolvedValue([]);

        await sut.handleQueueRecognizeFaces({ force: false });

        expect(mocks.sharedSpace.deleteAllPersonFaces).not.toHaveBeenCalled();
        expect(mocks.sharedSpace.deleteAllPersons).not.toHaveBeenCalled();
        expect(mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled).not.toHaveBeenCalled();
      });

      it('should queue SharedSpaceFaceMatchAll AFTER FacialRecognition jobs on force reset', async () => {
        const face = AssetFaceFactory.from().person().build();
        mocks.job.getJobCounts.mockResolvedValue({
          active: 1,
          waiting: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        });
        mocks.person.getAll.mockReturnValue(makeStream([face.person!]));
        mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
        mocks.person.getAllWithoutFaces.mockResolvedValue([]);
        mocks.person.unassignFaces.mockResolvedValue();
        mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
        mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
        mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['space-1']);

        await sut.handleQueueRecognizeFaces({ force: true });

        const queueAllCalls = mocks.job.queueAll.mock.calls;
        const recognitionCallIndex = queueAllCalls.findIndex((call) =>
          call[0].some((job: any) => job.name === JobName.FacialRecognition),
        );
        const spaceMatchCallIndex = queueAllCalls.findIndex((call) =>
          call[0].some((job: any) => job.name === JobName.SharedSpaceFaceMatchAll),
        );

        expect(recognitionCallIndex).toBeGreaterThanOrEqual(0);
        expect(spaceMatchCallIndex).toBeGreaterThanOrEqual(0);
        expect(spaceMatchCallIndex).toBeGreaterThan(recognitionCallIndex);
      });

      it('should not drain the FacialRecognition queue (deadlock guard)', async () => {
        const face = AssetFaceFactory.create();
        mocks.job.getJobCounts.mockResolvedValue({
          active: 1,
          waiting: 0,
          paused: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        });
        mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
        mocks.person.getAllWithoutFaces.mockResolvedValue([]);

        await sut.handleQueueRecognizeFaces({ force: false });

        for (const call of mocks.job.waitForQueueCompletion.mock.calls) {
          expect(call).not.toContain(QueueName.FacialRecognition);
        }
      });
    });

    it('force recognition queues the terminal maintenance marker after FacialRecognition and SharedSpaceFaceMatchAll jobs', async () => {
      const face = AssetFaceFactory.from().person().build();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream([face.person!]));
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.person.unassignFaces.mockResolvedValue();
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue(['space-1']);

      await sut.handleQueueRecognizeFaces({ force: true });

      const queueAllCalls = mocks.job.queueAll.mock;
      const recognitionIdx = queueAllCalls.calls.findIndex((call) =>
        call[0].some((job: any) => job.name === JobName.FacialRecognition),
      );
      const spaceMatchIdx = queueAllCalls.calls.findIndex((call) =>
        call[0].some((job: any) => job.name === JobName.SharedSpaceFaceMatchAll),
      );
      const markerIdx = mocks.job.queue.mock.calls.findIndex(
        (call) => call[0].name === JobName.FaceIdentityMaintenanceAfterRecognition,
      );

      expect(recognitionIdx).toBeGreaterThanOrEqual(0);
      expect(spaceMatchIdx).toBeGreaterThanOrEqual(0);
      expect(markerIdx).toBeGreaterThanOrEqual(0);

      const markerOrder = mocks.job.queue.mock.invocationCallOrder[markerIdx];
      expect(markerOrder).toBeGreaterThan(queueAllCalls.invocationCallOrder[recognitionIdx]);
      expect(markerOrder).toBeGreaterThan(queueAllCalls.invocationCallOrder[spaceMatchIdx]);
    });

    it('non-force recognition queues the terminal maintenance marker after FacialRecognition jobs when recognition jobs were queued', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);

      await sut.handleQueueRecognizeFaces({ force: false });

      const queueAllCalls = mocks.job.queueAll.mock;
      const recognitionIdx = queueAllCalls.calls.findIndex((call) =>
        call[0].some((job: any) => job.name === JobName.FacialRecognition),
      );
      const markerIdx = mocks.job.queue.mock.calls.findIndex(
        (call) => call[0].name === JobName.FaceIdentityMaintenanceAfterRecognition,
      );

      expect(recognitionIdx).toBeGreaterThanOrEqual(0);
      expect(markerIdx).toBeGreaterThanOrEqual(0);
      expect(mocks.job.queue.mock.invocationCallOrder[markerIdx]).toBeGreaterThan(
        queueAllCalls.invocationCallOrder[recognitionIdx],
      );
    });

    it('nightly skip does not queue the terminal maintenance marker', async () => {
      const lastRun = new Date();
      mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });
      mocks.person.getLatestFaceDate.mockResolvedValue(new Date(lastRun.getTime() - 1).toISOString());

      await sut.handleQueueRecognizeFaces({ force: false, nightly: true });

      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: expect.anything(),
      });
    });
  });

  describe('handleFaceIdentityMaintenanceAfterRecognition', () => {
    it('queues FaceIdentityBackfill when FacialRecognition queue is drained', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.job.searchJobs.mockResolvedValue([]);

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: expect.anything(),
      });
    });

    it('requeues itself with a delay when FacialRecognition has waiting jobs', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 5,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: expect.any(Number) },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
    });

    it('requeues itself with a delay when FacialRecognition has paused jobs', async () => {
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ active: 1, paused: 2 }));

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: 10_000 },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
      expect(mocks.job.searchJobs).not.toHaveBeenCalled();
    });

    it('requeues itself with a delay when FacialRecognition has delayed jobs', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 3,
      });

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: expect.any(Number) },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
    });

    it('requeues itself with a delay when there is other active FacialRecognition work', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 3,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: expect.any(Number) },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
    });

    it('ignores failed recognition jobs when deciding whether the queue has drained', async () => {
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ active: 1, failed: 12 }));
      mocks.job.searchJobs.mockResolvedValue([]);

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: expect.anything(),
      });
    });

    it('does not queue duplicate FaceIdentityBackfill if PeopleBackfill already has one active, waiting, delayed, or paused', async () => {
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.job.searchJobs.mockResolvedValue([{ id: '1', name: JobName.FaceIdentityBackfill, timestamp: 0, data: {} }]);

      await expect(sut.handleFaceIdentityMaintenanceAfterRecognition({})).resolves.toBe(JobStatus.Skipped);

      expect(mocks.job.searchJobs).toHaveBeenCalledWith(QueueName.PeopleBackfill, {
        status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
    });
  });

  describe('handleDetectFaces', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      await expect(sut.handleDetectFaces({ id: 'foo' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.asset.getByIds).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
      expect(mocks.assetJob.getForDetectFacesJob).not.toHaveBeenCalled();
      expectNoFaceDetectionMutation();
    });

    it.each([
      {
        label: 'missing asset',
        asset: undefined,
        expected: JobStatus.Failed,
      },
      {
        label: 'asset without preview file',
        asset: AssetFactory.from().exif().build(),
        expected: JobStatus.Failed,
      },
      {
        label: 'asset with multiple preview files',
        asset: AssetFactory.from()
          .file({ type: AssetFileType.Preview, path: '/preview-1.jpg' })
          .file({ type: AssetFileType.Preview, path: '/preview-2.jpg' })
          .exif()
          .build(),
        expected: JobStatus.Failed,
      },
      {
        label: 'hidden asset with preview file',
        asset: AssetFactory.from({ visibility: AssetVisibility.Hidden })
          .file({ type: AssetFileType.Preview, path: '/hidden-preview.jpg' })
          .exif()
          .build(),
        expected: JobStatus.Skipped,
      },
    ] as const)('should not mutate faces or status for $label', async ({ asset, expected }) => {
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(asset ? getForDetectedFaces(asset) : undefined);

      await expect(sut.handleDetectFaces({ id: asset?.id ?? 'missing-asset' })).resolves.toBe(expected);

      expectNoFaceDetectionMutation();
    });

    it('should skip when no resize path', async () => {
      const asset = AssetFactory.from().exif().build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      await sut.handleDetectFaces({ id: asset.id });
      expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalled();
    });

    it('should handle no results', async () => {
      const start = Date.now();
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview }).exif().build();

      mocks.machineLearning.detectFaces.mockResolvedValue({ imageHeight: 500, imageWidth: 400, faces: [] });
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      await sut.handleDetectFaces({ id: asset.id });
      expect(mocks.machineLearning.detectFaces).toHaveBeenCalledWith(
        asset.files[0].path,
        expect.objectContaining({ minScore: 0.7, modelName: 'buffalo_l' }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();

      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
      const facesRecognizedAt = mocks.asset.upsertJobStatus.mock.calls[0][0].facesRecognizedAt as Date;
      expect(facesRecognizedAt.getTime()).toBeGreaterThan(start);
    });

    it('should not write facesRecognizedAt or queue recognition when ML face detection throws', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.machineLearning.detectFaces.mockRejectedValue(new Error('ml unavailable'));

      await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('ml unavailable');

      expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should not write facesRecognizedAt when recognition fan-out queueing fails', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();
      mocks.job.queueAll.mockRejectedValue(new Error('redis unavailable'));

      await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('redis unavailable');

      expect(mocks.person.refreshFaces).toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should not queue recognition or write facesRecognizedAt when refreshFaces fails', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview, path: '/preview.jpg' }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockRejectedValue(new Error('refresh failed'));

      await expect(sut.handleDetectFaces({ id: asset.id })).rejects.toThrow('refresh failed');

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).not.toHaveBeenCalled();
    });

    it('should create a face with no person and queue recognition job', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.search.searchFaces.mockResolvedValue([{ ...face, distance: 0.7 }]);
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [expect.objectContaining({ id: face.id, assetId: asset.id })],
        [],
        [{ faceId: face.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: face.id } },
      ]);
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('forced detection queues only the force recognition coordinator when it creates new faces', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id, force: true });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [expect.objectContaining({ id: face.id, assetId: asset.id })],
        [],
        [{ faceId: face.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FacialRecognitionQueueAll,
        data: { force: true },
      });
      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('non-force detection keeps immediate incremental recognition for new faces', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id, force: false });

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: face.id } },
      ]);
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('keeps old pre-deploy asset-detection jobs without force on the incremental path', async () => {
      const asset = AssetFactory.from().file({ type: AssetFileType.Preview }).exif().build();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: face.id } },
      ]);
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('should delete an existing face not among the new detected faces', async () => {
      const asset = AssetFactory.from().face().file({ type: AssetFileType.Preview }).exif().build();
      mocks.machineLearning.detectFaces.mockResolvedValue({ faces: [], imageHeight: 500, imageWidth: 400 });
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith([], [asset.faces[0].id], []);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('should remove only stale machine-learning faces and unlink only those identity links', async () => {
      const assetId = newUuid();
      const mlFace = AssetFaceFactory.create({ assetId, id: 'ml-face', sourceType: SourceType.MachineLearning });
      const exifFace = AssetFaceFactory.create({ assetId, id: 'exif-face', sourceType: SourceType.Exif });
      const manualFace = AssetFaceFactory.create({ assetId, id: 'manual-face', sourceType: SourceType.Manual });
      const asset = AssetFactory.from({ id: assetId })
        .face(mlFace)
        .face(exifFace)
        .face(manualFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.machineLearning.detectFaces.mockResolvedValue({ imageHeight: 500, imageWidth: 400, faces: [] });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith([], [mlFace.id], []);
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledTimes(1);
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([mlFace.id]);
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([exifFace.id]));
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([manualFace.id]));
      expectNoRecognitionFanout();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('forced per-asset detection removes stale ML faces while preserving manual and EXIF evidence', async () => {
      const assetId = newUuid();
      const staleMlFace = AssetFaceFactory.create({
        assetId,
        id: 'stale-ml-face',
        sourceType: SourceType.MachineLearning,
        boundingBoxX1: 700,
        boundingBoxY1: 500,
        boundingBoxX2: 900,
        boundingBoxY2: 700,
      });
      const exifFace = AssetFaceFactory.create({
        assetId,
        id: 'force-exif-face',
        sourceType: SourceType.Exif,
        boundingBoxX1: 10,
        boundingBoxY1: 10,
        boundingBoxX2: 40,
        boundingBoxY2: 40,
      });
      const manualFace = AssetFaceFactory.create({
        assetId,
        id: 'force-manual-face',
        sourceType: SourceType.Manual,
        boundingBoxX1: 300,
        boundingBoxY1: 300,
        boundingBoxX2: 350,
        boundingBoxY2: 350,
      });
      const asset = AssetFactory.from({ id: assetId })
        .face(staleMlFace)
        .face(exifFace)
        .face(manualFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.crypto.randomUUID.mockReturnValue('force-new-ml-face');
      mocks.machineLearning.detectFaces.mockResolvedValue({
        imageHeight: 500,
        imageWidth: 400,
        faces: [
          {
            boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
            embedding: '[1, 2, 3, 4]',
            score: 0.99,
          },
        ],
      });

      await expect(sut.handleDetectFaces({ id: asset.id, force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id: 'force-new-ml-face',
            assetId: asset.id,
            boundingBoxX1: 100,
            boundingBoxY1: 80,
            boundingBoxX2: 250,
            boundingBoxY2: 200,
          }),
        ],
        [staleMlFace.id],
        [{ faceId: 'force-new-ml-face', embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([staleMlFace.id]);
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([exifFace.id]));
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalledWith(expect.arrayContaining([manualFace.id]));
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FacialRecognitionQueueAll,
        data: { force: true },
      });
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('should add an embedding to a matching manual face instead of creating a duplicate', async () => {
      const manualFace = AssetFaceFactory.create({ sourceType: SourceType.Manual });
      const asset = AssetFactory.from({ id: manualFace.assetId })
        .face(manualFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(manualFace));

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [],
        [],
        [{ faceId: manualFace.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
      expectNoRecognitionFanout();
    });

    it('should keep a matching existing ML face without adding a duplicate or unlinking identities', async () => {
      const mlFace = AssetFaceFactory.create({ sourceType: SourceType.MachineLearning });
      const asset = AssetFactory.from({ id: mlFace.assetId })
        .face(mlFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(mlFace));

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).not.toHaveBeenCalled();
      expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
      expectNoRecognitionFanout();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        facesRecognizedAt: expect.any(Date),
      });
    });

    it('should preserve an existing metadata face when scaled detection boxes still overlap', async () => {
      const assetId = newUuid();
      const exifFace = AssetFaceFactory.create({
        assetId,
        id: 'scaled-exif-face',
        sourceType: SourceType.Exif,
        imageWidth: 1000,
        imageHeight: 800,
        boundingBoxX1: 200,
        boundingBoxY1: 160,
        boundingBoxX2: 500,
        boundingBoxY2: 400,
      });
      const asset = AssetFactory.from({ id: assetId })
        .face(exifFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.machineLearning.detectFaces.mockResolvedValue({
        imageWidth: 500,
        imageHeight: 400,
        faces: [
          {
            boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
            embedding: '[1, 2, 3, 4]',
            score: 0.99,
          },
        ],
      });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [],
        [],
        [{ faceId: exifFace.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.crypto.randomUUID).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
      expectNoRecognitionFanout();
    });

    it('should create a new ML face when scaled detection boxes do not overlap existing manual or EXIF faces', async () => {
      const assetId = newUuid();
      const exifFace = AssetFaceFactory.create({
        assetId,
        id: 'far-exif-face',
        sourceType: SourceType.Exif,
        imageWidth: 1000,
        imageHeight: 800,
        boundingBoxX1: 700,
        boundingBoxY1: 500,
        boundingBoxX2: 900,
        boundingBoxY2: 700,
      });
      const asset = AssetFactory.from({ id: assetId })
        .face(exifFace)
        .file({ type: AssetFileType.Preview, path: '/preview.jpg' })
        .exif()
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.crypto.randomUUID.mockReturnValue('new-ml-face');
      mocks.machineLearning.detectFaces.mockResolvedValue({
        imageWidth: 500,
        imageHeight: 400,
        faces: [
          {
            boundingBox: { x1: 100, y1: 80, x2: 250, y2: 200 },
            embedding: '[1, 2, 3, 4]',
            score: 0.99,
          },
        ],
      });

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id: 'new-ml-face',
            assetId: asset.id,
            boundingBoxX1: 100,
            boundingBoxY1: 80,
            boundingBoxX2: 250,
            boundingBoxY2: 200,
          }),
        ],
        [],
        [{ faceId: 'new-ml-face', embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.faceIdentity.unlinkFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: 'new-ml-face' } },
      ]);
    });

    it('should add new face and delete an existing face not among the new detected faces', async () => {
      const assetId = newUuid();
      const face = AssetFaceFactory.create({
        assetId,
        boundingBoxX1: 200,
        boundingBoxX2: 300,
        boundingBoxY1: 200,
        boundingBoxY2: 300,
      });
      const asset = AssetFactory.from({ id: assetId }).face().file({ type: AssetFileType.Preview }).exif().build();
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.crypto.randomUUID.mockReturnValue(face.id);
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [expect.objectContaining({ id: face.id, assetId: asset.id })],
        [asset.faces[0].id],
        [{ faceId: face.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: face.id } },
      ]);
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('should add embedding to matching metadata face', async () => {
      const face = AssetFaceFactory.create({ sourceType: SourceType.Exif });
      const asset = AssetFactory.from().face(face).file({ type: AssetFileType.Preview }).exif().build();
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.person.refreshFaces.mockResolvedValue();

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith([], [], [{ faceId: face.id, embedding: '[1, 2, 3, 4]' }]);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('should not add embedding to non-matching metadata face', async () => {
      const assetId = newUuid();
      const face = AssetFaceFactory.create({ assetId, sourceType: SourceType.Exif });
      const asset = AssetFactory.from({ id: assetId }).file({ type: AssetFileType.Preview }).exif().build();
      mocks.machineLearning.detectFaces.mockResolvedValue(getAsDetectedFace(face));
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(getForDetectedFaces(asset));
      mocks.crypto.randomUUID.mockReturnValue(face.id);

      await sut.handleDetectFaces({ id: asset.id });

      expect(mocks.person.refreshFaces).toHaveBeenCalledWith(
        [expect.objectContaining({ id: face.id, assetId: asset.id })],
        [],
        [{ faceId: face.id, embedding: '[1, 2, 3, 4]' }],
      );
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
        { name: JobName.FacialRecognition, data: { id: face.id } },
      ]);
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });
  });

  describe('handleFaceIdentityBackfill', () => {
    it('should run on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handleFaceIdentityBackfill);

      expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
    });

    it('should backfill personal identities and requeue when another page exists', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1000,
        nextCursor: 'person-cursor',
      });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 0,
        conflictCount: 0,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.faceIdentity.backfillPersonalIdentities).toHaveBeenCalledWith({ cursor: undefined, limit: 1000 });
      expect(mocks.faceIdentity.backfillSpacePersonIdentities).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'person', cursor: 'person-cursor' },
      });
    });

    it('should continue with shared-space person identity backfill after personal rows are done', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 1 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 1000,
        conflictCount: 2,
        nextCursor: 'space-person-cursor',
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.faceIdentity.backfillSpacePersonIdentities).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 1000,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: 'space-person-cursor' },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('queues only the next space-person page when resuming a space-person cursor', async () => {
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 1000,
        conflictCount: 0,
        nextCursor: 'space-person-cursor-2',
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });

      await expect(
        sut.handleFaceIdentityBackfill({ stage: 'space-person', cursor: 'space-person-cursor-1' }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.faceIdentity.backfillPersonalIdentities).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.backfillSpacePersonIdentities).toHaveBeenCalledWith({
        cursor: 'space-person-cursor-1',
        limit: 1000,
      });
      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: 'space-person-cursor-2' },
      });
      expect((mocks.faceIdentity as any).getBackfillWork).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('requeues identity backfill without projection fan-out when identity work remains after final pages', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: expect.any(String) },
      });
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchFromBackfill })]),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('requeues root without fan-out when new identity work appears after a cursor page finishes', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: true,
        hasSharedSpaceProjectionWork: true,
      });

      await expect(
        sut.handleFaceIdentityBackfill({ stage: 'person', cursor: 'person-cursor-after-new-lower-id' }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: expect.any(String) },
      });
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll }),
      );
    });

    it('alternates bounded continuation ids when identity work remains', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: 'a' },
      });

      mocks.job.queue.mockClear();
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person', continuationId: 'a' })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: 'b' },
      });
    });

    it('does not discover projection targets until paginated personal backfill is complete', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1,
        nextCursor: 'person-cursor',
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'person', cursor: 'person-cursor' },
      });
      expect((mocks.faceIdentity as any).getBackfillWork).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('does not discover projection targets until paginated space-person backfill is complete', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 1,
        nextCursor: 'space-person-cursor',
        conflictCount: 0,
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: 'space-person-cursor' },
      });
      expect((mocks.faceIdentity as any).getBackfillWork).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('queues exact deduped projection targets after identity work is clean', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1,
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 0,
        conflictCount: 0,
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([
        { spaceId: 'space-2', assetId: 'asset-2' },
        { spaceId: 'space-1', assetId: 'asset-1' },
      ]);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        },
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: 'space-2', assetId: 'asset-2' },
        },
      ]);
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll })]),
      );
    });

    it('dedupes pending repair and projection targets together before deleting pending rows', async () => {
      const pendingTargets = [
        {
          spaceId: 'space-1',
          assetId: 'asset-1',
          updateId: 'pending-1',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          spaceId: 'space-3',
          assetId: 'asset-3',
          updateId: 'pending-3',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ];
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1,
        affectedSpaceAssets: [
          { spaceId: 'space-1', assetId: 'asset-1' },
          { spaceId: 'space-2', assetId: 'asset-2' },
        ],
      });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({
        processed: 1,
        conflictCount: 0,
        affectedSpaceAssets: [{ spaceId: 'space-2', assetId: 'asset-2' }],
      });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue(pendingTargets);
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([
        { spaceId: 'space-2', assetId: 'asset-2' },
        { spaceId: 'space-4', assetId: 'asset-4' },
      ]);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-1', assetId: 'asset-1' } },
        { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-2', assetId: 'asset-2' } },
        { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-3', assetId: 'asset-3' } },
        { name: JobName.SharedSpaceFaceMatchFromBackfill, data: { spaceId: 'space-4', assetId: 'asset-4' } },
      ]);
      expect((mocks.faceIdentity as any).deletePendingSharedSpaceFaceMatchBackfillTargets).toHaveBeenCalledWith(
        pendingTargets,
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('rediscovers earlier-page targets after paginated identity backfill completes', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValueOnce({
        processed: 1,
        nextCursor: 'person-cursor',
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();

      mocks.job.queue.mockClear();
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValueOnce({ processed: 1 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValueOnce({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([
        { spaceId: 'space-1', assetId: 'asset-1' },
        { spaceId: 'space-1', assetId: 'asset-2' },
      ]);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person', cursor: 'person-cursor' })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        },
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: 'space-1', assetId: 'asset-2' },
        },
      ]);
    });

    it('queues durable pending targets from earlier pages after identity work is clean', async () => {
      const pendingTarget = { spaceId: 'space-1', assetId: 'asset-from-page-1', updatedAt: new Date() };
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValueOnce({
        processed: 1,
        nextCursor: 'person-cursor',
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect((mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();

      mocks.job.queue.mockClear();
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValueOnce({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValueOnce({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      (mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([pendingTarget]);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person', cursor: 'person-cursor' })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: pendingTarget.spaceId, assetId: pendingTarget.assetId },
        },
      ]);
      expect((mocks.faceIdentity as any).deletePendingSharedSpaceFaceMatchBackfillTargets).toHaveBeenCalledWith([
        pendingTarget,
      ]);
    });

    it('keeps durable pending targets when queueing targeted face matches fails', async () => {
      const pendingTarget = { spaceId: 'space-1', assetId: 'asset-1', updatedAt: new Date() };
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });
      (mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([pendingTarget]);
      mocks.job.queueAll.mockRejectedValueOnce(new Error('redis write failed'));

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).rejects.toThrow('redis write failed');

      expect((mocks.faceIdentity as any).deletePendingSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
    });

    it('queues one metadata backfill when identity work completes without targeted face-match work', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('chains PersonSuggestionScanQueueAll when backfill completes and the feature is enabled (edge 19)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
      });
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
    });

    it('chains SpacePersonSuggestionScanQueueAll when backfill completes and the feature is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
      });
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenNthCalledWith(2, { name: JobName.PersonSuggestionScanQueueAll, data: {} });
      expect(mocks.job.queue).toHaveBeenNthCalledWith(3, { name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
    });

    it('does NOT chain PersonSuggestionScanQueueAll when the feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
      });
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
    });

    it('does NOT chain PersonSuggestionScanQueueAll while cursor pages remain (edge 19 — strictly after)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
      });
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 1000, nextCursor: 'c' });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
    });

    it('does not write an empty trailing batch for exactly one full chunk', async () => {
      const targets = Array.from({ length: 1000 }, (_, index) => ({
        spaceId: 'space-1',
        assetId: `asset-${index.toString().padStart(4, '0')}`,
      }));
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue(targets);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll.mock.calls[0][0]).toHaveLength(1000);
    });

    it('logs a projection invariant warning instead of falling back to a full rebuild when projection work has no targets', async () => {
      const warn = vi.spyOn((sut as any).logger, 'warn').mockImplementation(() => {});
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([]);

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('projection backfill work was reported but no targets were found'),
      );
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled).not.toHaveBeenCalled();
    });

    it('regenerates targeted projection work on a later run after a queue write failure', async () => {
      const target = { spaceId: 'space-1', assetId: 'asset-1' };
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 1 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([target]);
      mocks.job.queueAll.mockRejectedValueOnce(new Error('redis write failed'));

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).rejects.toThrow('redis write failed');

      mocks.job.queueAll.mockReset();
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: target,
        },
      ]);
    });

    it('regenerates only remaining current targets after a later queue batch fails', async () => {
      const targets = Array.from({ length: 1001 }, (_, index) => ({
        spaceId: 'space-1',
        assetId: `asset-${index.toString().padStart(4, '0')}`,
      }));
      const remainingTarget = targets.at(-1)!;
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 1 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValueOnce(targets);
      mocks.job.queueAll.mockResolvedValueOnce().mockRejectedValueOnce(new Error('redis write failed'));

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).rejects.toThrow('redis write failed');

      mocks.job.queueAll.mockReset();
      (mocks.faceIdentity as any).getSharedSpaceFaceMatchBackfillTargets.mockResolvedValueOnce([remainingTarget]);
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: remainingTarget,
        },
      ]);
    });

    it('does not queue global metadata backfill from identity-backfill finalization when targeted face matches are queued', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1,
        affectedSpaceAssets: [{ spaceId: 'space-1', assetId: 'asset-1' }],
      } as any);
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: false,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SharedSpaceFaceMatchFromBackfill,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        },
      ]);
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
      expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
    });

    it('does not queue full shared-space rebuilds when identity backfill is retriggered during face recognition work', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: true,
      });

      await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: expect.any(String) },
      });
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll })]),
      );
    });
  });

  describe('handlePersonSuggestionScan', () => {
    const enabled = {
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
    };

    it('runs on the people backfill queue, not facial recognition', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScan);
      expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
    });

    it('skips when the feature is disabled (suggestionMaxDistance <= maxDistance)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
      });

      await expect(sut.handlePersonSuggestionScan({ id: 'person-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.person.getById).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
    });

    it('skips an unnamed / hidden / pet / missing person (edge 5, 7, 16)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);

      mocks.person.getById.mockResolvedValueOnce(void 0);
      await expect(sut.handlePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: '',
        isHidden: false,
        type: 'person',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: true,
        type: 'person',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: 'Rex',
        isHidden: false,
        type: 'pet',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
    });

    it('no-ops when the person has zero assigned-face embeddings (edge 15)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([]);

      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.upsertPending).not.toHaveBeenCalled();
    });

    it('keeps only the open band (maxDistance, suggestionMaxDistance], min distance per face, then upserts', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }, { embedding: 'e2' }] as any);
      mocks.search.searchFaces
        .mockResolvedValueOnce([
          { id: 'f-low', personId: null, distance: 0.45 }, // <= maxDistance → excluded (auto-assign band)
          { id: 'f-band', personId: null, distance: 0.7 }, // in band
          { id: 'f-edge', personId: null, distance: 0.8 }, // == suggestionMaxDistance → kept (closed upper)
        ] as any)
        .mockResolvedValueOnce([
          { id: 'f-band', personId: null, distance: 0.6 }, // same face, smaller distance → min wins
        ] as any);

      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Success);

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      expect(mocks.search.searchFaces).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: ['u'], hasPerson: false, maxDistance: 0.8 }),
      );
      const rows = mocks.personFaceSuggestion.upsertPending.mock.calls[0][0];
      expect(rows).toEqual(
        expect.arrayContaining([
          { personId: 'p', assetFaceId: 'f-band', distance: 0.6 },
          { personId: 'p', assetFaceId: 'f-edge', distance: 0.8 },
        ]),
      );
      expect(rows).toHaveLength(2); // f-low excluded
    });

    it('caps embedding sample and candidate count (edge 14 — bounded work)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
      mocks.search.searchFaces.mockResolvedValue([]);

      await sut.handlePersonSuggestionScan({ id: 'p' });

      expect(mocks.person.getAssignedFaceEmbeddings).toHaveBeenCalledWith('p', 20);
      expect(mocks.search.searchFaces).toHaveBeenCalledWith(expect.objectContaining({ numResults: 100 }));
    });

    it('never resurrects a resolved decision — delegates the guarantee to upsertPending (edge 1, 2)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
      });
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
      mocks.search.searchFaces.mockResolvedValue([{ id: 'f-dismissed', personId: null, distance: 0.7 }] as any);

      await sut.handlePersonSuggestionScan({ id: 'p' });

      // The scan unconditionally calls the conditional upsert; the WHERE status='pending'
      // guard in the repository is the single source of the never-resurrect guarantee.
      // The job must not pre-filter resolved rows — it delegates to upsertPending.
      expect(mocks.personFaceSuggestion.upsertPending).toHaveBeenCalledWith([
        { personId: 'p', assetFaceId: 'f-dismissed', distance: 0.7 },
      ]);
    });
  });

  describe('handlePersonSuggestionScanQueueAll', () => {
    const enabled = {
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScanQueueAll);
      expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
    });

    it('skips and enumerates nothing when the feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
      });

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
      expect((mocks.person as any).getScannablePeopleWithUnassignedFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('queues one PersonSuggestionScan per scannable person', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      (mocks.person as any).getScannablePeopleWithUnassignedFaces.mockReturnValue(
        makeStream([
          { id: 'p1', ownerId: 'u' },
          { id: 'p2', ownerId: 'u' },
        ]),
      );

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonSuggestionScan, data: { id: 'p1' } },
        { name: JobName.PersonSuggestionScan, data: { id: 'p2' } },
      ]);
    });

    it('empty library → success, no scan jobs queued except empty flush', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      (mocks.person as any).getScannablePeopleWithUnassignedFaces.mockReturnValue(makeStream([]));

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
    });
  });

  describe('handleSpacePersonSuggestionScan', () => {
    const enabled = {
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScan);
      expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
    });

    it('skips when feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
      });

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'space-person-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('skips missing, unnamed, whitespace, hidden, pet, or disabled-space people', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValueOnce(void 0);
      await expect(sut.handleSpacePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

      for (const person of [
        { id: 'p', spaceId: 's', name: '', isHidden: false, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: '   ', isHidden: false, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Alice', isHidden: true, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Rex', isHidden: false, type: 'pet', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Alice', isHidden: false, type: 'person', faceRecognitionEnabled: false },
      ]) {
        mocks.sharedSpace.getPersonById.mockResolvedValueOnce(person as any);
        if (person.name.trim() !== '' && !person.isHidden && person.type === 'person') {
          mocks.sharedSpace.getById.mockResolvedValueOnce({
            id: 's',
            faceRecognitionEnabled: person.faceRecognitionEnabled,
          } as any);
        }
        await expect(sut.handleSpacePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
      }

      expect(mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('skips when the space person has zero linked face embeddings', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('keeps only the open band, takes min distance per candidate, and upserts by spacePersonId', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([
        { embedding: 'e1' },
        { embedding: 'e2' },
      ] as any);
      mocks.search.searchFaces
        .mockResolvedValueOnce([
          { id: 'too-close', personId: null, distance: 0.5 },
          { id: 'candidate', personId: null, distance: 0.7 },
        ] as FaceSearchResult[])
        .mockResolvedValueOnce([{ id: 'candidate', personId: null, distance: 0.6 }] as FaceSearchResult[]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

      expect(mocks.search.searchFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 'space-1',
          hasPerson: false,
          maxDistance: 0.8,
          numResults: 100,
        }),
      );
      expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).toHaveBeenCalledWith([
        { spacePersonId: 'sp', assetFaceId: 'candidate', distance: 0.6 },
      ]);
    });

    it('does not upsert matches already assigned to a shared-space person in the same space', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }] as any);
      mocks.search.searchFaces.mockResolvedValue([
        { id: 'assigned-face', personId: null, distance: 0.6 },
        { id: 'candidate', personId: null, distance: 0.7 },
      ] as FaceSearchResult[]);
      mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([{ assetFaceId: 'assigned-face' }]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

      expect(mocks.sharedSpace.getAssignedFaceIdsForSpace).toHaveBeenCalledWith('space-1', [
        'assigned-face',
        'candidate',
      ]);
      expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).toHaveBeenCalledWith([
        { spacePersonId: 'sp', assetFaceId: 'candidate', distance: 0.7 },
      ]);
    });
  });

  describe('handleSpacePersonSuggestionScanQueueAll', () => {
    const enabled = {
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScanQueueAll);
      expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
    });

    it('skips enumeration when feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
      });

      await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.sharedSpace.getScannableSpacePeopleWithUnassignedFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('queues one SpacePersonSuggestionScan per scannable space person', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getScannableSpacePeopleWithUnassignedFaces.mockReturnValue(
        makeStream([
          { id: 'sp1', spaceId: 's1' },
          { id: 'sp2', spaceId: 's1' },
        ]) as any,
      );

      await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp1' } },
        { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp2' } },
      ]);
    });
  });

  describe('handleRecognizeFaces', () => {
    beforeEach(() => {
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace = vi.fn().mockResolvedValue(void 0);
      mocks.faceIdentity.getMergeConflicts.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });
    });

    it('should fail if face does not exist', async () => {
      expect(await sut.handleRecognizeFaces({ id: 'unknown-face' })).toBe(JobStatus.Failed);

      expectNoRecognitionMutation();
    });

    it('should fail if face does not have asset', async () => {
      const face = AssetFaceFactory.create();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, null));

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Failed);

      expectNoRecognitionMutation();
    });

    it('skips non-machine-learning faces without mutating identities or queues', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id, sourceType: SourceType.Exif });
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expectNoRecognitionMutation();
    });

    it('fails when a machine-learning face has no embedding without mutating identities or queues', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue({
        ...face,
        asset,
        faceSearch: null,
      } as any);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Failed);

      expectNoRecognitionMutation();
    });

    it('should skip if face already has an assigned person', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.create).not.toHaveBeenCalled();
    });

    it('should queue space face matching even when face already has a person assigned', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(face.assetId);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId: 'space-1', assetId: face.assetId },
      });
    });

    it('queues shared-space face matching exactly once per space after repairing an assigned face', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([
        { spaceId: 'space-1' },
        { spaceId: 'space-1' },
        { spaceId: 'space-2' },
      ]);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      const sharedSpaceJobs = mocks.job.queue.mock.calls
        .map(([job]) => job)
        .filter((job) => job.name === JobName.SharedSpaceFaceMatch);
      expect(sharedSpaceJobs).toEqual([
        { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: face.assetId } },
        { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-2', assetId: face.assetId } },
      ]);
    });

    it('does not queue shared-space matching for force jobs when face already has a person', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

      expect(await sut.handleRecognizeFaces({ id: face.id, skipSharedSpaceMatch: true })).toBe(JobStatus.Skipped);

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(face.personId);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'owner-person',
      });
      expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
    });

    it('keeps old pre-deploy facial-recognition jobs on the incremental path', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

      await sut.handleRecognizeFaces({ id: face.id });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId: 'space-1', assetId: face.assetId },
      });
    });

    it('should link identity when a face already has an assigned person', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(face.personId);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'owner-person',
      });
    });

    it('should not merge an already assigned person identity into an accessible shared identity', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'source-identity' } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: 'target-identity',
        distance: 0.2,
      });

      await sut.handleRecognizeFaces({ id: face.id });

      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    it('should not queue space face matching when face has personId but no spaces', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.from({ assetId: asset.id }).person().build();
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(face.assetId);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should match existing person', async () => {
      const asset = AssetFactory.create();

      const [noPerson1, noPerson2, primaryFace, face] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.create(),
        AssetFaceFactory.from().person().build(),
        AssetFaceFactory.from().person().build(),
      ];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...primaryFace, distance: 0.2 },
        { ...noPerson2, distance: 0.3 },
        { ...face, distance: 0.4 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(primaryFace.person!);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson1.id]),
        newPersonId: primaryFace.person!.id,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonId: primaryFace.person!.id,
      });
    });

    it('should link identity after recognition assigns an existing person', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(matchedFace.person!.id);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: noPerson.id,
        identityId: 'identity-1',
        source: 'owner-person',
      });
    });

    it('assigns an existing person without creating a person or thumbnail job', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'matched-identity' } as any);

      expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.PersonGenerateThumbnail }),
      );
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson.id],
        newPersonId: matchedFace.person!.id,
      });
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: noPerson.id,
        identityId: 'matched-identity',
        source: 'owner-person',
      });
    });

    it('should merge an existing matched local person identity into an accessible shared identity', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];
      const sourceIdentityId = 'source-identity';
      const targetIdentityId = 'target-identity';

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect((mocks.faceIdentity as any).findClosestAccessibleIdentityForFace).toHaveBeenCalledWith({
        userId: asset.ownerId,
        embedding: '[1, 2, 3, 4]',
        maxDistance: 0.5,
        type: 'person',
        excludeIdentityId: sourceIdentityId,
      });
      expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
      });
      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
        source: 'shared-space-evidence',
      });
    });

    it('skips accessible shared identity merge when same-owner personal conflicts exist', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];
      const sourceIdentityId = 'source-identity';
      const targetIdentityId = 'target-identity';

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });
      mocks.faceIdentity.getMergeConflicts.mockResolvedValue({
        personalProfileConflictCount: 1,
        spaceProfileConflictCount: 0,
      });
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
      });
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('skips accessible shared identity merge when same-space conflicts exist', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];
      const sourceIdentityId = 'source-identity';
      const targetIdentityId = 'target-identity';

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });
      mocks.faceIdentity.getMergeConflicts.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 1,
      });

      expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

      expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
      });
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SharedSpacePersonMetadataBackfill }),
      );
    });

    it('does not run conflict checks when accessible shared evidence already points at the source identity', async () => {
      const asset = AssetFactory.create();
      const [noPerson, matchedFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...matchedFace, distance: 0.2 },
      ] as FaceSearchResult[];
      const sourceIdentityId = 'source-identity';

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: sourceIdentityId,
        distance: 0.1,
      });

      expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

      expect(mocks.faceIdentity.getMergeConflicts).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.SharedSpacePersonMetadataBackfill }),
      );
    });

    it('does not queue shared-space matching for force jobs after assigning a person', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const noPerson = AssetFaceFactory.create({ assetId: asset.id });
      const primaryFace = AssetFaceFactory.from().person().build();
      const sourceIdentityId = 'source-identity';
      const targetIdentityId = 'target-identity';
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue([{ ...primaryFace, distance: 0.2 } as FaceSearchResult]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

      expect(await sut.handleRecognizeFaces({ id: noPerson.id, skipSharedSpaceMatch: true })).toBe(JobStatus.Success);

      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson.id],
        newPersonId: primaryFace.personId,
      });
      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(primaryFace.personId);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: noPerson.id,
        identityId: sourceIdentityId,
        source: 'owner-person',
      });
      expect((mocks.faceIdentity as any).findClosestAccessibleIdentityForFace).toHaveBeenCalledWith({
        userId: asset.ownerId,
        embedding: '[1, 2, 3, 4]',
        maxDistance: 0.5,
        type: 'person',
        excludeIdentityId: sourceIdentityId,
      });
      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
        source: 'shared-space-evidence',
      });
      expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
    });

    it('should match existing person if their birth date is unknown', async () => {
      const asset = AssetFactory.create();
      const [noPerson, face, faceWithBirthDate] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
        AssetFaceFactory.from().person({ birthDate: newDate() }).build(),
      ];

      const faces = [
        { ...noPerson, distance: 0 },
        { ...face, distance: 0.2 },
        { ...faceWithBirthDate, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.create.mockResolvedValue(face.person!);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson.id]),
        newPersonId: face.person!.id,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonId: face.person!.id,
      });
    });

    it('should match existing person if their birth date is before file creation', async () => {
      const asset = AssetFactory.create();
      const [noPerson, face, faceWithBirthDate] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
        AssetFaceFactory.from().person({ birthDate: newDate() }).build(),
      ];

      const faces = [
        { ...noPerson, distance: 0 },
        { ...faceWithBirthDate, distance: 0.2 },
        { ...face, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.create.mockResolvedValue(face.person!);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson.id]),
        newPersonId: faceWithBirthDate.person!.id,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonId: faceWithBirthDate.person!.id,
      });
    });

    it('should create a new person if the face is a core point with no person', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];
      const person = PersonFactory.create({ ownerId: asset.ownerId });
      const sourceIdentityId = 'created-person-identity';

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);

      expect(await sut.handleRecognizeFaces({ id: noPerson1.id })).toBe(JobStatus.Success);

      expect(mocks.person.create).toHaveBeenCalledWith({
        ownerId: asset.ownerId,
        faceAssetId: noPerson1.id,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { id: person.id },
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.id,
      });
      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.id);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: noPerson1.id,
        identityId: sourceIdentityId,
        source: 'owner-person',
      });
    });

    it('should merge a newly created person identity into an accessible shared identity match', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];
      const person = PersonFactory.create({ ownerId: asset.ownerId });
      const sourceIdentityId = newUuid();
      const targetIdentityId = newUuid();

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect((mocks.faceIdentity as any).findClosestAccessibleIdentityForFace).toHaveBeenCalledWith({
        userId: asset.ownerId,
        embedding: '[1, 2, 3, 4]',
        maxDistance: 0.5,
        type: 'person',
        excludeIdentityId: null,
      });
      expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
      });
      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
        source: 'shared-space-evidence',
      });
    });

    it('should create and merge a local person from accessible shared-space evidence even when owner search only finds itself', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      const person = PersonFactory.create({ ownerId: asset.ownerId });
      const sourceIdentityId = newUuid();
      const targetIdentityId = newUuid();

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValue([{ ...face, distance: 0 }] as FaceSearchResult[]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
        identityId: targetIdentityId,
        distance: 0.2,
      });

      await sut.handleRecognizeFaces({ id: face.id });

      expect((mocks.faceIdentity as any).findClosestAccessibleIdentityForFace).toHaveBeenCalledWith({
        userId: asset.ownerId,
        embedding: '[1, 2, 3, 4]',
        maxDistance: 0.5,
        type: 'person',
        excludeIdentityId: null,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { id: person.id },
      });
      expect(mocks.person.create).toHaveBeenCalledWith({
        ownerId: asset.ownerId,
        faceAssetId: face.id,
      });
      expect(mocks.faceIdentity.getMergeConflicts).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
      });
      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId,
        sourceIdentityIds: [sourceIdentityId],
        source: 'shared-space-evidence',
      });
    });

    it('should not create a local person from inaccessible shared-space evidence after access is removed', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValue([{ ...face, distance: 0 }] as FaceSearchResult[]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue(void 0);

      await sut.handleRecognizeFaces({ id: face.id });

      expect((mocks.faceIdentity as any).findClosestAccessibleIdentityForFace).toHaveBeenCalledWith({
        userId: asset.ownerId,
        embedding: '[1, 2, 3, 4]',
        maxDistance: 0.5,
        type: 'person',
        excludeIdentityId: null,
      });
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    it('should not queue face with no matches', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      const faces = [{ ...face, distance: 0 }] as FaceSearchResult[];

      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
      mocks.person.create.mockResolvedValue(PersonFactory.create());

      await sut.handleRecognizeFaces({ id: face.id });

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('skips self-only matches below the min-face threshold without deferring or assigning', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValue([{ ...face, distance: 0 }] as FaceSearchResult[]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
    });

    it('preserves shared-space suppression when deferring a force-created face job', async () => {
      const asset = AssetFactory.create();
      const noPerson = AssetFaceFactory.create({ assetId: asset.id });
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValue([{ ...noPerson, distance: 0 } as FaceSearchResult]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));

      expect(await sut.handleRecognizeFaces({ id: noPerson.id, skipSharedSpaceMatch: true })).toBe(JobStatus.Skipped);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FacialRecognition,
        data: { id: noPerson.id, deferred: true, skipSharedSpaceMatch: true },
      });
    });

    it('should defer non-core faces to end of queue', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.4 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(PersonFactory.create());

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FacialRecognition,
        data: { id: noPerson1.id, deferred: true },
      });
      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('should not assign person to deferred non-core face with no matching person', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.4 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(PersonFactory.create());

      await sut.handleRecognizeFaces({ id: noPerson1.id, deferred: true });

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it.each([AssetVisibility.Archive, AssetVisibility.Hidden, AssetVisibility.Locked])(
      'does not create a core person or queue shared-space matching for deferred %s assets without a person',
      async (visibility) => {
        const asset = AssetFactory.create({ visibility });
        const face = AssetFaceFactory.create({ assetId: asset.id });

        mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
        mocks.search.searchFaces
          .mockResolvedValueOnce([{ ...face, distance: 0 }] as FaceSearchResult[])
          .mockResolvedValueOnce([]);
        mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));
        (mocks.faceIdentity as any).findClosestAccessibleIdentityForFace.mockResolvedValue({
          identityId: 'accessible-space-identity',
          distance: 0.2,
        });
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }]);

        expect(await sut.handleRecognizeFaces({ id: face.id, deferred: true })).toBe(JobStatus.Skipped);

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
        expect(mocks.faceIdentity.ensurePersonIdentity).not.toHaveBeenCalled();
        expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
        expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
        expect(mocks.sharedSpace.getSpaceIdsForAsset).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }),
        );
      },
    );

    it('should queue SharedSpaceFaceMatch for spaces containing the asset', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const [noPerson1, noPerson2, primaryFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.create(),
        AssetFaceFactory.from().person().build(),
      ];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...primaryFace, distance: 0.2 },
        { ...noPerson2, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-2' }]);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(noPerson1.assetId);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId: 'space-1', assetId: noPerson1.assetId },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId: 'space-2', assetId: noPerson1.assetId },
      });
    });

    it('queues one SharedSpaceFaceMatch job per unique space after assigning a face', async () => {
      const asset = AssetFactory.create();
      const [noPerson, primaryFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const faces = [
        { ...noPerson, distance: 0 },
        { ...primaryFace, distance: 0.2 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([
        { spaceId: 'space-1' },
        { spaceId: 'space-2' },
        { spaceId: 'space-1' },
      ]);

      expect(await sut.handleRecognizeFaces({ id: noPerson.id })).toBe(JobStatus.Success);

      const sharedSpaceJobs = mocks.job.queue.mock.calls
        .map(([job]) => job)
        .filter((job) => job.name === JobName.SharedSpaceFaceMatch);
      expect(sharedSpaceJobs).toEqual([
        { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-1', assetId: noPerson.assetId } },
        { name: JobName.SharedSpaceFaceMatch, data: { spaceId: 'space-2', assetId: noPerson.assetId } },
      ]);
    });

    it('should not queue SharedSpaceFaceMatch when asset belongs to no spaces', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const [noPerson1, primaryFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...primaryFace, distance: 0.2 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.sharedSpace.getSpaceIdsForAsset).toHaveBeenCalledWith(noPerson1.assetId);
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.SharedSpaceFaceMatch }));
    });

    it('does not enqueue any PersonSuggestionScan from the recognition path (zero-regression)', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const [noPerson1, primaryFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...primaryFace, distance: 0.2 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      // The recognition path must never enqueue suggestion jobs — suggestions are generated
      // only by the dedicated PersonSuggestionScan job chain, not inline in recognition.
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PersonSuggestionScan }));
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.PersonSuggestionScanQueueAll }),
      );
    });
  });

  describe('mergePerson', () => {
    it('should require person.write and person.merge permission', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();

      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should merge two people without smart merge', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.id]));

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: true },
      ]);

      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        newPersonId: person.id,
        oldPersonId: mergePerson.id,
      });

      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should merge source identities after personal people are merged', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.id]));
      mocks.faceIdentity.ensurePersonIdentity
        .mockResolvedValueOnce({ id: 'target-identity' } as any)
        .mockResolvedValueOnce({ id: 'source-identity' } as any);

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: true },
      ]);

      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId: 'target-identity',
        sourceIdentityIds: ['source-identity'],
        source: 'manual',
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: 'target-identity' },
      });
    });

    it('should merge two people with smart merge', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [
        PersonFactory.create({ name: undefined }),
        PersonFactory.create({ name: 'Merge person' }),
      ];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);
      mocks.person.update.mockResolvedValue({ ...person, name: mergePerson.name });
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.id]));

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: true },
      ]);

      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        newPersonId: person.id,
        oldPersonId: mergePerson.id,
      });

      expect(mocks.person.update).toHaveBeenCalledWith({
        id: person.id,
        name: mergePerson.name,
      });

      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should throw an error when the primary person is not found', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));

      await expect(sut.mergePerson(authStub.admin, 'person-1', { ids: ['person-2'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set(['person-1']));
    });

    it('should handle invalid merge ids', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set(['unknown']));

      await expect(sut.mergePerson(auth, person.id, { ids: ['unknown'] })).resolves.toEqual([
        { id: 'unknown', success: false, error: BulkIdErrorReason.NOT_FOUND },
      ]);

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });

    it('should handle an error reassigning faces', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);
      mocks.person.reassignFaces.mockRejectedValue(new Error('update failed'));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.id]));

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: false, error: BulkIdErrorReason.UNKNOWN },
      ]);

      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });
  });

  describe('scoped people repair', () => {
    it('rejects same-person repair for inaccessible scoped profiles', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveRepairRefs.mockResolvedValue({
        accessible: false,
      } as any);

      await expect(
        sut.mergeScopedPeople(auth, {
          target: { type: 'space-person', id: newUuid(), spaceId: newUuid() },
          sources: [{ type: 'space-person', id: newUuid(), spaceId: newUuid() }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    it('merges same-person repair only after access and repairability checks', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveRepairRefs.mockResolvedValue({
        accessible: true,
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        type: 'person',
        blockingConflict: undefined,
      } as any);
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });

      await sut.mergeScopedPeople(auth, {
        target: { type: 'person', id: newUuid() },
        sources: [{ type: 'space-person', id: newUuid(), spaceId: newUuid() }],
      });

      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        source: 'manual',
        collapseScopedConflicts: true,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('rejects merge when a same-scope conflict lives in a space the actor can only view', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveRepairRefs.mockResolvedValue({
        accessible: true,
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        type: 'person',
        blockingConflict: { scope: 'space', spaceId: 'space-1', spaceName: 'Holidays' },
      } as any);

      await expect(
        sut.mergeScopedPeople(auth, {
          target: { type: 'person', id: newUuid() },
          sources: [{ type: 'space-person', id: newUuid(), spaceId: newUuid() }],
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ForbiddenException,
          message: expect.stringContaining('Holidays'),
        }),
      );

      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    it('allows a repairable same-scope conflict alongside an unrelated view-only attachment', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveRepairRefs.mockResolvedValue({
        accessible: true,
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        type: 'person',
        blockingConflict: undefined,
      } as any);
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });

      await expect(
        sut.mergeScopedPeople(auth, {
          target: { type: 'person', id: newUuid() },
          sources: [{ type: 'person', id: newUuid() }],
        }),
      ).resolves.not.toThrow();

      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        source: 'manual',
        collapseScopedConflicts: true,
      });
    });

    it('collapses same-scope conflicts the actor can repair', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveRepairRefs.mockResolvedValue({
        accessible: true,
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        type: 'person',
        blockingConflict: undefined,
      } as any);
      mocks.faceIdentity.mergeIdentities.mockResolvedValue({
        personalProfileConflictCount: 0,
        spaceProfileConflictCount: 0,
      });

      await expect(
        sut.mergeScopedPeople(auth, {
          target: { type: 'person', id: newUuid() },
          sources: [{ type: 'person', id: newUuid() }],
        }),
      ).resolves.not.toThrow();

      expect(mocks.faceIdentity.mergeIdentities).toHaveBeenCalledWith({
        targetIdentityId: 'identity-1',
        sourceIdentityIds: ['identity-2'],
        source: 'manual',
        collapseScopedConflicts: true,
      });
    });

    it('detaches a scoped profile after access and backing-face checks', async () => {
      const auth = AuthFactory.create();
      const profile = { type: 'person' as const, id: newUuid() };
      mocks.faceIdentity.resolveDetachRef.mockResolvedValue({
        accessible: true,
        identityId: 'identity-1',
        type: 'person',
        allBackingFacesRepairable: true,
      } as any);

      await sut.detachScopedPerson(auth, { profile });

      expect(mocks.faceIdentity.resolveDetachRef).toHaveBeenCalledWith(auth.user.id, profile);
      expect(mocks.faceIdentity.detachScopedProfile).toHaveBeenCalledWith(profile);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('rejects detach when selected profile faces also back inaccessible profiles', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveDetachRef.mockResolvedValue({
        accessible: true,
        identityId: 'identity-1',
        type: 'person',
        allBackingFacesRepairable: false,
      } as any);

      await expect(
        sut.detachScopedPerson(auth, { profile: { type: 'space-person', id: newUuid(), spaceId: newUuid() } }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.faceIdentity.detachScopedProfile).not.toHaveBeenCalled();
    });
  });

  describe('getStatistics', () => {
    it('returns personal person asset and face counts for a legacy owned person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: null });

      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getStatistics.mockResolvedValue({ assets: 3, faces: 4 });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.getStatistics(auth, person.id)).resolves.toEqual({ assets: 3, faces: 4 });
      expect(mocks.person.getStatistics).toHaveBeenCalledWith(person.id);
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).not.toHaveBeenCalled();
    });

    it('returns accessible identity statistics for an owned identity-backed person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });

      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      (mocks.faceIdentity as any).getAccessiblePersonStatistics.mockResolvedValue({ assets: 7, faces: 9 });

      await expect(sut.getStatistics(auth, person.id)).resolves.toEqual({ assets: 7, faces: 9 });
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).toHaveBeenCalledWith(
        auth.user.id,
        'identity-1',
      );
      expect(mocks.person.getStatistics).not.toHaveBeenCalled();
    });

    it('returns accessible identity statistics for an accessible space-person route id', async () => {
      const auth = AuthFactory.create();
      const personId = newUuid();

      mocks.person.getById.mockResolvedValue(void 0);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessibleProfileIdentityId.mockResolvedValue('identity-from-space');
      (mocks.faceIdentity as any).getAccessiblePersonStatistics.mockResolvedValue({ assets: 11, faces: 13 });

      await expect(sut.getStatistics(auth, personId)).resolves.toEqual({ assets: 11, faces: 13 });
      expect((mocks.faceIdentity as any).getAccessibleProfileIdentityId).toHaveBeenCalledWith(auth.user.id, personId);
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).toHaveBeenCalledWith(
        auth.user.id,
        'identity-from-space',
      );
    });

    it('rejects an inaccessible space-person route id before reading statistics', async () => {
      const auth = AuthFactory.create();
      const personId = newUuid();

      mocks.person.getById.mockResolvedValue(void 0);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessibleProfileIdentityId.mockResolvedValue(void 0);

      await expect(sut.getStatistics(auth, personId)).rejects.toThrow('Not found or no person.read access');
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).not.toHaveBeenCalled();
    });

    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getById.mockResolvedValue(person);
      await expect(sut.getStatistics(auth, person.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.id]));
    });
  });

  describe('mergePerson (smart merge birthDate)', () => {
    it('should copy birthDate from merge person when primary has none', async () => {
      const auth = AuthFactory.create();
      const birthDate = new Date('1990-01-15');
      const [person, mergePerson] = [
        PersonFactory.create({ name: 'Primary', birthDate: null }),
        PersonFactory.create({ name: 'Merge', birthDate }),
      ];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.person.getById.mockResolvedValueOnce(mergePerson);
      mocks.person.update.mockResolvedValue({ ...person, birthDate });
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.id]));

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: true },
      ]);

      expect(mocks.person.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: person.id,
          birthDate,
        }),
      );
    });

    it('should throw when merging a person into themselves', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));

      await expect(sut.mergePerson(auth, person.id, { ids: [person.id] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should handle no access to merge person', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getById.mockResolvedValueOnce(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set());

      await expect(sut.mergePerson(auth, person.id, { ids: [mergePerson.id] })).resolves.toEqual([
        { id: mergePerson.id, success: false, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a single person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getForPeopleDelete.mockResolvedValue([person]);

      await sut.delete(auth, person.id);

      expect(mocks.person.getForPeopleDelete).toHaveBeenCalledWith([person.id]);
      expect(mocks.person.delete).toHaveBeenCalledWith([person.id]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person.thumbnailPath] },
      });
    });
  });

  describe('deleteAll', () => {
    it('should delete multiple people', async () => {
      const auth = AuthFactory.create();
      const [person1, person2] = [PersonFactory.create(), PersonFactory.create()];

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person1.id, person2.id]));
      mocks.person.getForPeopleDelete.mockResolvedValue([person1, person2]);

      await sut.deleteAll(auth, { ids: [person1.id, person2.id] });

      expect(mocks.person.delete).toHaveBeenCalledWith([person1.id, person2.id]);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: [person1.thumbnailPath, person2.thumbnailPath] },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });
  });

  describe('handlePersonMigration (additional)', () => {
    it('should return Failed when person is not found', async () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      mocks.person.getById.mockResolvedValue(undefined);

      await expect(sut.handlePersonMigration({ id: newUuid() })).resolves.toBe(JobStatus.Failed);
    });
  });

  describe('reassignFaces', () => {
    it('should trigger new feature photo when person has null faceAssetId', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([face] as any);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(person);

      await sut.reassignFaces(auth, person.id, {
        data: [{ personId: person.id, assetId: face.assetId }],
      });

      expect(mocks.job.queueAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: JobName.PersonGenerateThumbnail, data: { id: person.id } }),
        ]),
      );
    });

    it('should trigger new feature photo for old person when face was their feature photo', async () => {
      const oldPerson = PersonFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ...oldPerson, faceAssetId: undefined })
        .build();
      // Make the face the feature photo of the old person
      face.person!.faceAssetId = face.id;
      const auth = AuthFactory.create();
      const newPerson = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([newPerson.id]));
      mocks.person.getById.mockResolvedValue(newPerson);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([face] as any);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(newPerson);

      await sut.reassignFaces(auth, newPerson.id, {
        data: [{ personId: oldPerson.id, assetId: face.assetId }],
      });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(face.person!.id);
    });
  });

  describe('reassignFaces', () => {
    it('resolves pending suggestions for the face when bulk-reassigned (edge 11, manual branch)', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.person.getById.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);

      await sut.reassignFaces(auth, person.id, {
        data: [{ personId: person.id, assetId: face.assetId }],
      });

      expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(face.id);
    });
  });

  describe('reassignFacesById', () => {
    it('should trigger new feature photo for person with null faceAssetId', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(face as any);
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.id, { id: face.id });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(person.id);
    });

    it('should trigger new feature photo for old person when reassigned face was their feature', async () => {
      const oldPerson = PersonFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ...oldPerson, faceAssetId: undefined })
        .build();
      face.person!.faceAssetId = face.id;
      const newPerson = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([newPerson.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(face as any);
      mocks.person.getById.mockResolvedValue(newPerson);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(newPerson);

      await sut.reassignFacesById(AuthFactory.create(), newPerson.id, { id: face.id });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(face.person!.id);
    });

    it('resolves pending suggestions for the face when it is reassigned by id (edge 11, manual branch)', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.id, { id: face.id });

      expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(face.id);
    });
  });

  describe('createNewFeaturePhoto', () => {
    it('should not queue job when no random face is found', async () => {
      const person = PersonFactory.create();
      // eslint-disable-next-line unicorn/no-useless-undefined
      mocks.person.getRandomFace.mockResolvedValue(undefined);

      await sut.createNewFeaturePhoto([person.id]);

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
    });
  });

  describe('handleRecognizeFaces', () => {
    beforeEach(() => {
      mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);
      expect(await sut.handleRecognizeFaces({ id: 'face-id' })).toBe(JobStatus.Skipped);
    });

    it('should skip if face source type is not MachineLearning', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id, sourceType: SourceType.Exif });
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(face, asset));

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Skipped);
    });

    it('should fail if face has no embedding', async () => {
      const asset = AssetFactory.create();
      const face = AssetFaceFactory.create({ assetId: asset.id });
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue({
        ...face,
        asset,
        faceSearch: null,
      } as any);

      expect(await sut.handleRecognizeFaces({ id: face.id })).toBe(JobStatus.Failed);
    });

    it('should find person via secondary search when no direct match has person', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.3 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces
        .mockResolvedValueOnce(faces)
        .mockResolvedValueOnce([{ ...noPerson2, personId: person.id, distance: 0.2 }]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.id,
      });
    });

    it('should not use a relaxed existing-person search before creating a new core person', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ ownerId: asset.ownerId });
      const [noPerson1, noPerson2, noPerson3] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.create(),
        AssetFaceFactory.create(),
      ];
      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.31 },
        { ...noPerson3, distance: 0.34 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.create.mockResolvedValue(person);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.search.searchFaces).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          hasPerson: true,
          maxDistance: 0.5,
          numResults: 1,
        }),
      );
      expect(mocks.person.create).toHaveBeenCalledWith({ ownerId: asset.ownerId, faceAssetId: noPerson1.id });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.id,
      });
    });

    it('should not attach a deferred small cluster to a relaxed existing-person match', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];
      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.34 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));

      await sut.handleRecognizeFaces({ id: noPerson1.id, deferred: true });

      expect(mocks.search.searchFaces).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          hasPerson: true,
          maxDistance: 0.5,
          numResults: 1,
        }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: JobName.PersonGenerateThumbnail }),
      );
      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('should handle deferred non-core face with matching person', async () => {
      const asset = AssetFactory.create();
      const person = PersonFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];

      const faces = [
        { ...noPerson1, distance: 0 },
        { ...noPerson2, distance: 0.4 },
      ] as FaceSearchResult[];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 3 } } });
      mocks.search.searchFaces
        .mockResolvedValueOnce(faces)
        .mockResolvedValueOnce([{ ...noPerson2, personId: person.id, distance: 0.2 }]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));

      await sut.handleRecognizeFaces({ id: noPerson1.id, deferred: true });

      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.id,
      });
      expect(mocks.person.create).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueRecognizeFaces (nightly)', () => {
    it('should run nightly when no previous state exists', async () => {
      const face = AssetFaceFactory.create();
      mocks.systemMetadata.get.mockResolvedValue(null);
      mocks.person.getLatestFaceDate.mockResolvedValue(new Date().toISOString());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.job.getJobCounts.mockResolvedValue({
        active: 0,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      await sut.handleQueueRecognizeFaces({ force: false, nightly: true });

      expect(mocks.person.getAllFaces).toHaveBeenCalledWith({
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognition, data: { id: face.id, deferred: false } },
      ]);
    });

    it('should not skip nightly when no latest face date (proceeds to queue faces)', async () => {
      const face = AssetFaceFactory.create();
      const lastRun = new Date();
      mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });
      // eslint-disable-next-line unicorn/no-useless-undefined
      mocks.person.getLatestFaceDate.mockResolvedValue(undefined);
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.job.getJobCounts.mockResolvedValue({
        active: 0,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      await expect(sut.handleQueueRecognizeFaces({ force: false, nightly: true })).resolves.toBe(JobStatus.Success);

      // latestFaceDate is undefined, so the skip condition is not met and faces are queued
      expect(mocks.person.getAllFaces).toHaveBeenCalled();
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognition, data: { id: face.id, deferred: false } },
      ]);
    });
  });

  describe('deleteFace', () => {
    it('should force delete a face', async () => {
      const auth = AuthFactory.create();
      const faceId = newUuid();
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([faceId]));

      await sut.deleteFace(auth, faceId, { force: true });

      expect(mocks.person.deleteAssetFace).toHaveBeenCalledWith(faceId);
      expect(mocks.person.softDeleteAssetFaces).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([faceId]);
    });

    it('should soft delete a face', async () => {
      const auth = AuthFactory.create();
      const faceId = newUuid();
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([faceId]));

      await sut.deleteFace(auth, faceId, { force: false });

      expect(mocks.person.softDeleteAssetFaces).toHaveBeenCalledWith(faceId);
      expect(mocks.person.deleteAssetFace).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.unlinkFaces).toHaveBeenCalledWith([faceId]);
    });
  });

  describe('createFace', () => {
    it('should create a face for an asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const asset = AssetFactory.from().exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.asset.getById.mockResolvedValue(asset as any);
      mocks.person.getById.mockResolvedValue(person);

      await sut.createFace(auth, {
        assetId: asset.id,
        personId: person.id,
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        imageWidth: 400,
        imageHeight: 500,
      });

      expect(mocks.person.createAssetFace).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: asset.id,
          personId: person.id,
          sourceType: SourceType.Manual,
        }),
      );
    });

    it('should throw NotFoundException if asset is not found', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const assetId = newUuid();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      // eslint-disable-next-line unicorn/no-useless-undefined
      mocks.asset.getById.mockResolvedValue(undefined);
      mocks.person.getById.mockResolvedValue(person);

      await expect(
        sut.createFace(auth, {
          assetId,
          personId: person.id,
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          imageWidth: 400,
          imageHeight: 500,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAll', () => {
    it('should resolve closestFaceAssetId from closestPersonId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-asset-id' });

      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getAllForUser.mockResolvedValue({ items: [], hasNextPage: false });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 0, hidden: 0 });

      await sut.getAll(auth, { closestPersonId: person.id, page: 1, size: 10 });

      expect(mocks.person.getAllForUser).toHaveBeenCalledWith(
        { skip: 0, take: 10 },
        auth.user.id,
        expect.objectContaining({ closestFaceAssetId: 'face-asset-id' }),
      );
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should throw NotFoundException when closestPersonId is not found', async () => {
      const auth = AuthFactory.create();

      // eslint-disable-next-line unicorn/no-useless-undefined
      mocks.person.getById.mockResolvedValue(undefined);

      await expect(sut.getAll(auth, { closestPersonId: 'invalid', page: 1, size: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when closestPerson has no faceAssetId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.person.getById.mockResolvedValue(person);

      await expect(sut.getAll(auth, { closestPersonId: person.id, page: 1, size: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('handleDetectFaces', () => {
    it('should skip hidden assets', async () => {
      const asset = AssetFactory.from({ visibility: AssetVisibility.Hidden })
        .file({ type: AssetFileType.Preview })
        .build();
      mocks.assetJob.getForDetectFacesJob.mockResolvedValue(asset as any);

      await expect(sut.handleDetectFaces({ id: asset.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.machineLearning.detectFaces).not.toHaveBeenCalled();
    });
  });

  describe('mapFace', () => {
    it('should map a face', () => {
      const user = UserFactory.create();
      const auth = AuthFactory.create({ id: user.id });
      const person = PersonFactory.create({ ownerId: user.id });
      const face = AssetFaceFactory.from().person(person).build();

      expect(mapFaces(getForAssetFace(face), auth)).toEqual({
        boundingBoxX1: 100,
        boundingBoxX2: 200,
        boundingBoxY1: 100,
        boundingBoxY2: 200,
        id: face.id,
        imageHeight: 500,
        imageWidth: 400,
        sourceType: SourceType.MachineLearning,
        person: mapPerson(person),
      });
    });

    it('should not map person if person is null', () => {
      expect(mapFaces(getForAssetFace(AssetFaceFactory.create()), AuthFactory.create()).person).toBeNull();
    });

    it('should not map person if person does not match auth user id', () => {
      expect(
        mapFaces(getForAssetFace(AssetFaceFactory.from().person().build()), AuthFactory.create()).person,
      ).toBeNull();
    });
  });

  describe('getFaceSuggestions', () => {
    const enabled = {
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
    };

    it('denies a non-owner with no state change (edge 18 absence)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner

      await expect(
        sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.personFaceSuggestion.getPendingForPerson).not.toHaveBeenCalled();
    });

    it('returns total + mapped items for the owner', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.getPendingForPerson.mockResolvedValue({
        total: 1,
        items: [
          {
            assetFaceId: 'face-1',
            distance: 0.62,
            assetId: 'asset-1',
            imageWidth: 4000,
            imageHeight: 3000,
            boundingBoxX1: 1,
            boundingBoxX2: 2,
            boundingBoxY1: 3,
            boundingBoxY2: 4,
            fileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      });

      const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

      expect(mocks.personFaceSuggestion.getPendingForPerson).toHaveBeenCalledWith('person-1', {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
        page: 1,
        size: 50,
      });
      expect(res).toEqual({
        total: 1,
        items: [
          {
            assetFaceId: 'face-1',
            assetId: 'asset-1',
            distance: 0.62,
            imageWidth: 4000,
            imageHeight: 3000,
            boundingBoxX1: 1,
            boundingBoxX2: 2,
            boundingBoxY1: 3,
            boundingBoxY2: 4,
            fileCreatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });

    it('passes the feature-off config through so the repository read-gate returns empty (edge 7)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
      });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.getPendingForPerson.mockResolvedValue({ total: 0, items: [] });

      const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

      expect(mocks.personFaceSuggestion.getPendingForPerson).toHaveBeenCalledWith('person-1', {
        maxDistance: 0.5,
        suggestionMaxDistance: 0,
        page: 1,
        size: 50,
      });
      expect(res).toEqual({ total: 0, items: [] });
    });
  });

  describe('confirmFaceSuggestion', () => {
    it('denies a non-owner with NO state change (edge 18 absence)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not owner

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.personFaceSuggestion.markConfirmed).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
    });

    it('flips the row to confirmed then delegates to reassignFacesById (assign + manual identity + feature photo)', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      person.faceAssetId = null; // no feature photo yet — triggers createNewFeaturePhoto
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRandomFace.mockResolvedValue(face); // drives createNewFeaturePhoto
      mocks.personFaceSuggestion.markConfirmed.mockResolvedValue(1); // a pending row existed

      await sut.confirmFaceSuggestion(AuthFactory.create(), person.id, face.id);

      expect(mocks.personFaceSuggestion.markConfirmed).toHaveBeenCalledWith(person.id, face.id);
      expect(mocks.person.reassignFace).toHaveBeenCalledWith(face.id, person.id);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'manual',
      });
      expect(mocks.person.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: person.id, faceAssetId: face.id }),
      );
      expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(face.id);
    });

    it('is idempotent when the row is already confirmed/rejected/ignored but person+face still exist → 200, no reassign', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.personFaceSuggestion.markConfirmed.mockResolvedValue(0); // already confirmed/rejected/ignored

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
    });

    it('a CASCADE-deleted person or face → 400 (owner-only precedence, edges 9, 10)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // person row gone

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.personFaceSuggestion.markConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('rejectFaceSuggestion / ignoreFaceSuggestion / dismissFaceSuggestion', () => {
    it('denies a non-owner for reject and ignore with NO state change (edge 18 absence)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.personFaceSuggestion.markRejected).not.toHaveBeenCalled();
      expect(mocks.personFaceSuggestion.markIgnored).not.toHaveBeenCalled();
    });

    it('reject flips the row to rejected and never assigns or reassigns the face', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.markRejected.mockResolvedValue(1);

      await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();

      expect(mocks.personFaceSuggestion.markRejected).toHaveBeenCalledWith('person-1', 'face-1');
      expect(mocks.personFaceSuggestion.markIgnored).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('ignore flips the row to ignored and never assigns or reassigns the face', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.markIgnored.mockResolvedValue(1);

      await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();

      expect(mocks.personFaceSuggestion.markIgnored).toHaveBeenCalledWith('person-1', 'face-1');
      expect(mocks.personFaceSuggestion.markRejected).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('reject and ignore no-op stale or already-resolved rows and never assigns or reassigns the face', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.markRejected.mockResolvedValue(0);
      mocks.personFaceSuggestion.markIgnored.mockResolvedValue(0);

      await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
      await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();

      expect(mocks.personFaceSuggestion.markRejected).toHaveBeenCalledWith('person-1', 'face-1');
      expect(mocks.personFaceSuggestion.markIgnored).toHaveBeenCalledWith('person-1', 'face-1');
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('dismiss remains a compatibility wrapper around reject', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.personFaceSuggestion.markRejected.mockResolvedValue(1);

      await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();

      expect(mocks.personFaceSuggestion.markRejected).toHaveBeenCalledWith('person-1', 'face-1');
      expect(mocks.personFaceSuggestion.markIgnored).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });
  });
});
