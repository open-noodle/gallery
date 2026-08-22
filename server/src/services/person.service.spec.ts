import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { SystemConfig } from 'src/dtos/config.dto';
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
  UserMetadataKey,
} from 'src/enum';
import { FaceSearchResult } from 'src/repositories/search.repository';
import { FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS, PersonService } from 'src/services/person.service';
import { StorageService } from 'src/services/storage.service';
import { ImmichFileResponse, ImmichStreamResponse } from 'src/utils/file';
import { CROSS_OWNER_MERGE_ERROR_CODE } from 'src/utils/merge-policy';
import { AssetFaceFactory } from 'test/factories/asset-face.factory';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { PersonGroupFactory } from 'test/factories/person-group.factory';
import { PersonFactory } from 'test/factories/person.factory';
import { UserFactory } from 'test/factories/user.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import {
  getAsDetectedFace,
  getForAsset,
  getForAssetFace,
  getForDetectedFaces,
  getForFaceSearch,
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

const prefsMetadata = (minimumFaces: number) =>
  [{ key: UserMetadataKey.Preferences, value: { people: { minimumFaces } } }] as any;

// Cross-owner scoped-merge (#733) request fixture.
const crossOwnerMergeDto = (overrides: Record<string, unknown> = {}) => ({
  target: { type: 'person' as const, id: newUuid() },
  sources: [{ type: 'space-person' as const, id: newUuid(), spaceId: newUuid() }],
  ...overrides,
});

/** The cross-owner authorizer each merge entry point hands to the planner (src/utils/merge-policy.ts). */
type MergeAuthorizerFn = (plan: {
  collapsedOwnerIds: string[];
  repointedOwnerIds: string[];
  unrepairableSpaceCollapseIds: string[];
}) => Promise<void>;

const planWith = (overrides: {
  collapsedOwnerIds?: string[];
  repointedOwnerIds?: string[];
  unrepairableSpaceCollapseIds?: string[];
}) => ({
  collapsedOwnerIds: [],
  repointedOwnerIds: [],
  unrepairableSpaceCollapseIds: [],
  ...overrides,
});

const configValidateTestConfig = (enabled: boolean, maxDistance: number, suggestionMaxDistance: number) =>
  ({
    machineLearning: {
      facialRecognition: { maxDistance, suggestions: { enabled, maxDistance: suggestionMaxDistance } },
    },
  }) as SystemConfig;

const onConfigUpdateTestConfig = (
  suggestionsEnabled: boolean,
  machineLearningEnabled: boolean = true,
  facialRecognitionEnabled: boolean = true,
  recognitionMaxDistance: number = 0.5,
  suggestionsMaxDistance: number = 0.7,
) =>
  ({
    machineLearning: {
      enabled: machineLearningEnabled,
      facialRecognition: {
        enabled: facialRecognitionEnabled,
        maxDistance: recognitionMaxDistance,
        suggestions: { enabled: suggestionsEnabled, maxDistance: suggestionsMaxDistance },
      },
    },
  }) as SystemConfig;

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
    faceIdentityMock.getResolvedPersonByIdentityId ??= vi.fn();
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
    // Default: no stored preferences → getPreferences() falls back to minimumFaces = 3.
    mocks.user.getMetadata.mockResolvedValue([]);
    mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([]);
    // Default: no face has been manually linked or negatively verdicted — the suggestion-scan handlers'
    // write-time exclusion (D3) becomes a no-op unless an individual test configures otherwise.
    mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
    mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map());
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

  const useIdentityMergePropagation = () => {
    const identityMergePropagation = {
      mergePersonalPeople: vi.fn(),
      mergeScopedProfiles: vi.fn(),
    };
    (
      sut as unknown as { identityMergePropagationService: typeof identityMergePropagation }
    ).identityMergePropagationService = identityMergePropagation;

    return identityMergePropagation;
  };

  // `mocks.systemMetadata.get` is one mock shared by every key, so a bare `mockResolvedValue` would answer the
  // one-shot suggestion-sweep marker AND the system config with the same object. These two helpers key on the
  // metadata key so a test can pin one without disturbing the other.
  const useSuggestionSweepAlreadyRun = (config?: unknown) =>
    mocks.systemMetadata.get.mockImplementation(
      (key: SystemMetadataKey) =>
        Promise.resolve(
          key === SystemMetadataKey.FaceSuggestionDefaultOnState ? { sweptAt: '2026-08-01T00:00:00.000Z' } : config,
        ) as any,
    );

  const useSuggestionSweepPending = (config?: unknown) =>
    mocks.systemMetadata.get.mockImplementation(
      (key: SystemMetadataKey) =>
        Promise.resolve(key === SystemMetadataKey.FaceSuggestionDefaultOnState ? undefined : config) as any,
    );

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('onBootstrap', () => {
    it('should queue identity backfill when existing people or faces need identity links', async () => {
      useSuggestionSweepAlreadyRun();
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
      useSuggestionSweepAlreadyRun();
      (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

      await sut.onBootstrap();

      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.job.searchJobs).not.toHaveBeenCalled();
    });

    it('should not queue a new identity backfill root while another backfill page is pending', async () => {
      useSuggestionSweepAlreadyRun();
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
      useSuggestionSweepAlreadyRun();
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

    // Face suggestions ship enabled by default. An instance that upgrades into that default never emits a
    // ConfigUpdate, and FaceSuggestionMaintenance has no cron, so without this one-shot sweep the toggle
    // would read "on" over a permanently empty queue.
    describe('one-shot face suggestion sweep', () => {
      it('should queue face suggestion maintenance once when the marker is absent and the feature is on', async () => {
        useSuggestionSweepPending();
        (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

        await sut.onBootstrap();

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
      });

      it('should not queue face suggestion maintenance when the marker is already burnt', async () => {
        useSuggestionSweepAlreadyRun();
        (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

        await sut.onBootstrap();

        expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
        expect(mocks.systemMetadata.set).not.toHaveBeenCalledWith(
          SystemMetadataKey.FaceSuggestionDefaultOnState,
          expect.anything(),
        );
      });

      // The marker records "a sweep has actually run", so only a sweep may write it. Burning it here instead
      // rested on the assumption that a later opt-in always re-triggers via onConfigUpdate's false -> true
      // transition — which cannot happen under IMMICH_CONFIG_FILE, where updateSystemConfig throws outright
      // (system-config.service.ts) and a YAML edit + restart emits only ConfigInit. Such an admin would get a
      // toggle reading "on" over a queue that is never filled.
      it('should leave the marker unburnt when the feature resolves off, so a later boot re-checks', async () => {
        useSuggestionSweepPending(onConfigUpdateTestConfig(false));
        (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

        await sut.onBootstrap();

        expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
        expect(mocks.systemMetadata.set).not.toHaveBeenCalledWith(
          SystemMetadataKey.FaceSuggestionDefaultOnState,
          expect.anything(),
        );
      });

      // Queueing is not sweeping. FaceSuggestionMaintenance runs with attempts:1 and removeOnFail:true
      // (job.repository.ts), so a marker written here would survive a job that failed and vanished — the
      // sweep would be recorded as done having never run, with no retry. Only the handler's success path
      // may write it (see job.service.spec.ts).
      it('should not burn the marker at queue time, leaving that to the sweep itself', async () => {
        useSuggestionSweepPending();
        (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(false);

        await sut.onBootstrap();

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
        expect(mocks.systemMetadata.set).not.toHaveBeenCalledWith(
          SystemMetadataKey.FaceSuggestionDefaultOnState,
          expect.anything(),
        );
      });

      it('should still queue the identity backfill it shares the hook with', async () => {
        useSuggestionSweepPending();
        (mocks.faceIdentity as any).hasBackfillWork.mockResolvedValue(true);
        mocks.job.searchJobs.mockResolvedValue([]);

        await sut.onBootstrap();

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceIdentityBackfill, data: {} });
      });
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
          expect.objectContaining({ id: person.personGroupId, isHidden: false }),
          expect.objectContaining({
            id: hiddenPerson.personGroupId,
            isHidden: true,
          }),
        ],
      });
      expect(mocks.person.getAllForUser).toHaveBeenCalledWith({ skip: 0, take: 10 }, auth.user.id, {
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
            id: isFavorite.personGroupId,
            isFavorite: true,
          }),
          expect.objectContaining({ id: person.personGroupId, isFavorite: false }),
        ],
      });
      expect(mocks.person.getAllForUser).toHaveBeenCalledWith({ skip: 0, take: 10 }, auth.user.id, {
        withHidden: false,
      });
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should preserve non-shared repository order for favorites, named people, and unnamed count ordering', async () => {
      const auth = AuthFactory.create();
      const favorite = PersonFactory.create({ personGroupId: 'favorite', name: 'Anna', isFavorite: true });
      const named = PersonFactory.create({ personGroupId: 'named', name: 'Bob', isFavorite: false });
      const unnamedHigh = PersonFactory.create({ personGroupId: 'unnamed-high', name: '', isFavorite: false });
      const unnamedLow = PersonFactory.create({ personGroupId: 'unnamed-low', name: '', isFavorite: false });

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

  describe('people.minimumFaces preference (M2)', () => {
    it('threads the user preference into the withSharedSpaces People list', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.faceIdentity as any).getAccessiblePeople.mockResolvedValue({
        total: 0,
        hidden: 0,
        hasNextPage: false,
        people: [],
      });

      await sut.getAll(auth, { withHidden: false, withSharedSpaces: true, page: 1, size: 50 } as any);

      expect((mocks.faceIdentity as any).getAccessiblePeople).toHaveBeenCalledWith(auth.user.id, {
        withHidden: false,
        page: 1,
        size: 50,
        minimumFaceCount: 5,
      });
    });

    it('threads the user preference into withSharedSpaces people-stats', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.faceIdentity as any).getAccessiblePeopleStatistics.mockResolvedValue({
        total: 0,
        hidden: 0,
        detectedFaceCount: 0,
      });

      await sut.getPeopleStatistics(auth, { withSharedSpaces: true, page: 1, size: 50 } as any);

      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });

    it('threads the user preference into withSharedSpaces people-face-stats', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });

      await sut.getPeopleFaceStatistics(auth, { withSharedSpaces: true, page: 1, size: 50 } as any);

      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });

    it('threads the user preference into the non-shared people-stats surfaces', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.person as any).getPeopleOverviewStatistics.mockResolvedValue({
        total: 0,
        hidden: 0,
        detectedFaceCount: 0,
      });
      (mocks.person as any).getPeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });

      await sut.getPeopleStatistics(auth, { page: 1, size: 50 } as any);
      await sut.getPeopleFaceStatistics(auth, { page: 1, size: 50 } as any);

      expect((mocks.person as any).getPeopleOverviewStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
      expect((mocks.person as any).getPeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });

    it('makes the non-shared count match the list threshold without double-filtering the list', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      mocks.person.getAllForUser.mockResolvedValue({ items: [], hasNextPage: false });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 0, hidden: 0 });

      await sut.getAll(auth, { withHidden: false, page: 1, size: 50 });

      // Count uses the same resolved threshold the list applies in SQL (person.repository.ts:334).
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 5 });
      // The list must NOT receive a minimumFaceCount param — it already filters via SQL (no double filter).
      const listOptions = mocks.person.getAllForUser.mock.calls[0][2];
      expect(listOptions).not.toHaveProperty('minimumFaceCount');
    });

    it('falls back to the default threshold when the preference is unset', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue([]);
      (mocks.faceIdentity as any).getAccessiblePeople.mockResolvedValue({
        total: 0,
        hidden: 0,
        hasNextPage: false,
        people: [],
      });

      await expect(
        sut.getAll(auth, { withHidden: false, withSharedSpaces: true, page: 1, size: 50 } as any),
      ).resolves.toBeDefined();

      expect((mocks.faceIdentity as any).getAccessiblePeople).toHaveBeenCalledWith(auth.user.id, {
        withHidden: false,
        page: 1,
        size: 50,
        minimumFaceCount: 3,
      });
    });

    it('threads boundary preference values (1 and a large value)', async () => {
      const auth = AuthFactory.create();
      (mocks.faceIdentity as any).getAccessiblePeople.mockResolvedValue({
        total: 0,
        hidden: 0,
        hasNextPage: false,
        people: [],
      });

      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(1));
      await sut.getAll(auth, { withHidden: false, withSharedSpaces: true, page: 1, size: 50 } as any);
      expect((mocks.faceIdentity as any).getAccessiblePeople).toHaveBeenLastCalledWith(auth.user.id, {
        withHidden: false,
        page: 1,
        size: 50,
        minimumFaceCount: 1,
      });

      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(50));
      await sut.getAll(auth, { withHidden: false, withSharedSpaces: true, page: 1, size: 50 } as any);
      expect((mocks.faceIdentity as any).getAccessiblePeople).toHaveBeenLastCalledWith(auth.user.id, {
        withHidden: false,
        page: 1,
        size: 50,
        minimumFaceCount: 50,
      });
    });
  });

  describe('getById', () => {
    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(sut.getById(auth, person.personGroupId)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
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

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      await expect(sut.getById(auth, person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );
      expect(mocks.person.getByGroupId).toHaveBeenCalledWith({
        ownerId: auth.user.id,
        personGroupId: person.personGroupId,
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
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
      expect(mocks.person.getByGroupIdOnly).not.toHaveBeenCalled();
    });

    it('should keep resolving a local person after shared-space access is removed', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ ownerId: auth.user.id });

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.getById(auth, person.personGroupId)).resolves.toEqual(expect.objectContaining({ id: person.personGroupId }));

      expect(mocks.person.getByGroupIdOnly).toHaveBeenCalledWith(person.personGroupId);
      expect((mocks.faceIdentity as any).getAccessiblePersonByProfileId).not.toHaveBeenCalled();
    });

    it('should stop resolving a shared-space profile id after shared-space access is removed', async () => {
      const auth = AuthFactory.create();
      const profileId = newUuid();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessiblePersonByProfileId.mockResolvedValue(void 0);

      await expect(sut.getById(auth, profileId)).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.faceIdentity as any).getAccessiblePersonByProfileId).toHaveBeenCalledWith(auth.user.id, profileId);
      expect(mocks.person.getByGroupIdOnly).not.toHaveBeenCalled();
    });

    it("should resolve the identity-wide birthday and name for the owner's own person", async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({
        ownerId: auth.user.id,
        identityId: newUuid(),
        name: 'Owner Local Name',
        birthDate: null,
      });

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue({
        id: person.personGroupId,
        name: 'Karolin',
        birthDate: '2014-02-14',
      });

      await expect(sut.getById(auth, person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId, name: 'Karolin', birthDate: '2014-02-14' }),
      );
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).toHaveBeenCalledWith(
        auth.user.id,
        person.identityId,
      );
    });

    it('should not resolve via identity when the owned person has no identity', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ ownerId: auth.user.id, identityId: null, birthDate: null });

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.getById(auth, person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId, birthDate: null }),
      );
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).not.toHaveBeenCalled();
    });

    it('should fall back to the raw person when identity resolution finds nothing', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({
        ownerId: auth.user.id,
        identityId: newUuid(),
        name: 'Owner Local Name',
        birthDate: null,
      });

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue(void 0);

      await expect(sut.getById(auth, person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId, name: 'Owner Local Name', birthDate: null }),
      );
    });
  });

  describe('getThumbnail', () => {
    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(sut.getThumbnail(auth, person.personGroupId)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should throw an error when personId is invalid', async () => {
      const auth = AuthFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['unknown']));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set(['unknown']));
      await expect(sut.getThumbnail(auth, 'unknown')).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(['unknown']));
    });

    it('should throw an error when person has no thumbnail', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ thumbnailPath: '' });

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set([person.personGroupId]));
      await expect(sut.getThumbnail(auth, person.personGroupId)).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should serve the thumbnail', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set([person.personGroupId]));
      await expect(sut.getThumbnail(auth, person.personGroupId)).resolves.toEqual(
        new ImmichFileResponse({
          path: person.thumbnailPath,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      );
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should serve the thumbnail when the person is visible through a shared space', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.getThumbnail(auth, person.personGroupId)).resolves.toEqual(
        new ImmichFileResponse({
          path: person.thumbnailPath,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      );
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
      expect(mocks.access.person.checkSharedSpaceAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    // #869 follow-up. The medium spec proves the locked/unlocked decision against a real database; these
    // two pin what the decision does on either side of the serve boundary, which the medium harness (no
    // bootstrapped storage backend) cannot reach.
    it('should not serve the thumbnail of a locked-folder face to a non-elevated owner', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set());

      await expect(sut.getThumbnail(auth, person.personGroupId)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.storage.createReadStream).not.toHaveBeenCalled();
    });

    it('should serve the thumbnail of a locked-folder face to an elevated owner', async () => {
      const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
      const person = PersonFactory.create();

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkUnlockedThumbnailAccess.mockResolvedValue(new Set());

      await expect(sut.getThumbnail(auth, person.personGroupId)).resolves.toEqual(
        new ImmichFileResponse({
          path: person.thumbnailPath,
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithoutCache,
        }),
      );
    });
  });

  describe('representative face', () => {
    it('updates a personal representative face by exact assetFaceId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: face.id });

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.person.getRepresentativeFaceForUpdate).toHaveBeenCalledWith({
        personId: person.personGroupId,
        assetFaceId: face.id,
      });
      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.personGroupId, faceAssetId: face.id });
      expect(mocks.faceIdentity.updateRepresentativeFace).toHaveBeenCalledWith({
        identityId: person.identityId,
        assetFaceId: face.id,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonGenerateThumbnail, data: { id: person.personGroupId } });
    });

    it('rejects a face that does not belong to the requested person or identity', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(
        undefined as Awaited<ReturnType<typeof mocks.person.getRepresentativeFaceForUpdate>>,
      );

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: 'face-1' })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('rejects a selected face when the actor cannot read the face asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('lists exact personal face crops for the picker', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([
        {
          ...AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
        {
          ...AssetFaceFactory.create({ id: 'face-2', assetId: 'asset-2', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-02T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
      ]);

      await expect(sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 1 })).resolves.toEqual({
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
        info: { width: 250, height: 250, channels: 3, format: 'jpeg', size: 0, premultiplied: false, hasAlpha: false },
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

    it('lists picker face crops for a shared-space member who does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([
        {
          ...AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
      ]);

      await expect(sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 })).resolves.toEqual({
        faces: [expect.objectContaining({ id: 'face-1', assetId: 'asset-1', isRepresentative: true })],
        hasNextPage: false,
      });
      expect(mocks.access.person.checkSharedSpaceAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    // M1: a non-owner (space-granted) caller must be scoped to space-reachable, shareable-visibility
    // faces only -- never the owner's Hidden/never-shared faces or faces pulled in via another user's
    // identity. checkOwnerAccess returning an empty set is the non-owner signal.
    it('scopes the repository call to the caller when the caller does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([]);

      await sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 });

      expect(mocks.person.getRepresentativeFaces).toHaveBeenCalledWith({
        personId: person.personGroupId,
        take: 10,
        skip: 0,
        scope: { memberUserId: auth.user.id },
      });
    });

    it('does not scope the repository call for the owner', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([]);

      await sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 });

      expect(mocks.person.getRepresentativeFaces).toHaveBeenCalledWith({
        personId: person.personGroupId,
        take: 10,
        skip: 0,
        scope: undefined,
      });
    });

    // M2: renamed from "...a shared-space member..." — before M2, ANY shared-space member (including
    // a Viewer) passed here since only PersonRead was checked. Now the write gate additionally
    // requires Editor/Owner space role, so this positive control must grant edit access explicitly.
    it('updates the representative face for a shared-space Editor who does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: face.id });

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({ id: person.personGroupId, faceAssetId: face.id });
      expect(mocks.access.person.checkSharedSpaceEditAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('rejects a representative face update when the actor cannot read the chosen face asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      // Editor access (the M2 write gate) is granted; the failure below is the pre-existing,
      // unrelated AssetRead check on the chosen face itself.
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set());
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    // Slice 3 — M2: PersonRead (checked above) admits ANY space role, including Viewer. Mutating the
    // owner's GLOBAL representative face must be denied to a Viewer -- only the owner or a space
    // Editor/Owner may do it. Before this fix, a Viewer with PersonRead reachability could mutate.
    it('denies a representative face update from a shared-space viewer who is not owner or editor (M2)', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      // PersonRead reachability: the viewer has shared-space READ access...
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      // ...but NOT edit access (viewer role).
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set());
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        ForbiddenException,
      );

      expect(mocks.access.person.checkSharedSpaceEditAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should require person.write permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(sut.update(auth, person.personGroupId, { name: 'Person 1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('does not let a shared-space member rename a person they do not own', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { name: 'Renamed' })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.person.update).not.toHaveBeenCalled();
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

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { name: 'Person 1' })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId, name: 'Person 1' }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        name: 'Person 1',
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should queue scoped space metadata backfill when an identity-backed person name changes', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ name: 'Aurelia', identityId: 'identity-1' });

      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { name: 'Aurelia' })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId, name: 'Aurelia' }),
      );

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: 'identity-1' },
      });
    });

    it("should update a person's date of birth", async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ birthDate: new Date('1976-06-30') });

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { birthDate: '1976-06-30' })).resolves.toEqual({
        id: person.personGroupId,
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
      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        birthDate: '1976-06-30',
      });
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should update a person visibility', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ isHidden: true });

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { isHidden: true })).resolves.toEqual(
        expect.objectContaining({ isHidden: true }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        isHidden: true,
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should update a person favorite status', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ isFavorite: true });

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { isFavorite: true })).resolves.toEqual(
        expect.objectContaining({ isFavorite: true }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        isFavorite: true,
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it("should update a person's thumbnailPath", async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue(person);
      mocks.person.getForFeatureFaceUpdate.mockResolvedValue(face);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { featureFaceAssetId: face.assetId })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        faceAssetId: face.id,
      });
      expect(mocks.person.getForFeatureFaceUpdate).toHaveBeenCalledWith({
        assetId: face.assetId,
        personGroupId: person.personGroupId,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
      });
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should throw an error when the face feature assetId is invalid', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.update(auth, person.personGroupId, { featureFaceAssetId: '-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    describe('suggestion on-name trigger', () => {
      const enabled = {
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.8 },
          },
        },
      };

      it('enqueues a scan when an unnamed cluster is named (edge 5)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: '', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

        await sut.update(auth, prior.personGroupId, { name: 'Alice' });

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.personGroupId } });
      });

      it('enqueues a scan on rename of an already-named person (edge 6)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Bob' });

        await sut.update(auth, prior.personGroupId, { name: 'Bob' });

        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScan, data: { id: prior.personGroupId } });
      });

      it('does NOT enqueue on a color/favorite/birthDate edit (name unchanged) (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior }); // name unchanged

        await sut.update(auth, prior.personGroupId, { isFavorite: true });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.personGroupId },
        });
      });

      it('does NOT enqueue when name is cleared (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: '' });

        await sut.update(auth, prior.personGroupId, { name: '' });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.personGroupId },
        });
      });

      it('does NOT enqueue when a person becomes hidden (edge 7)', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled);
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: 'Alice', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, isHidden: true }); // name unchanged

        await sut.update(auth, prior.personGroupId, { isHidden: true });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.personGroupId },
        });
      });

      it('does NOT enqueue when the feature is disabled', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            facialRecognition: {
              enabled: true,
              maxDistance: 0.5,
              minFaces: 3,
              suggestions: { enabled: false, maxDistance: 0.7 },
            },
          },
        });
        const auth = AuthFactory.create();
        const prior = PersonFactory.create({ name: '', isHidden: false });
        mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([prior.personGroupId]));
        mocks.person.getByGroupIdOnly.mockResolvedValue(prior);
        mocks.person.update.mockResolvedValue({ ...prior, name: 'Alice' });

        await sut.update(auth, prior.personGroupId, { name: 'Alice' });

        expect(mocks.job.queue).not.toHaveBeenCalledWith({
          name: JobName.PersonSuggestionScan,
          data: { id: prior.personGroupId },
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

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.refreshFaces.mockResolvedValue();
      mocks.person.reassignFace.mockResolvedValue(5);
      mocks.person.update.mockResolvedValue(person);

      await expect(
        sut.reassignFaces(auth, person.personGroupId, {
          data: [{ personId: person.personGroupId, assetId: face.assetId }],
        }),
      ).resolves.toBeDefined();

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.PersonGenerateThumbnail,
          data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
        },
      ]);
    });

    it('should replace identity links for reassigned faces', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);

      await sut.reassignFaces(auth, person.personGroupId, {
        data: [{ personId: person.personGroupId, assetId: face.assetId }],
      });

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.personGroupId);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'manual',
      });
      // S11 (slice 11d): the owner just stated a fact that contradicts any durable rejected/ignored row for
      // this same target — clear it, scoped to this person's identity only.
      expect(mocks.facePersonVerdict.clearNegativeForTarget).toHaveBeenCalledWith(
        { personId: person.personGroupId, identityId: 'identity-1' },
        [face.id],
      );
    });
  });

  describe('handlePersonMigration', () => {
    it('should not move person files', async () => {
      await expect(sut.handlePersonMigration(PersonFactory.create())).resolves.toBe(JobStatus.Failed);
    });

    it('should skip persons with relative S3 thumbnail paths', async () => {
      const person = PersonFactory.create({ thumbnailPath: 'thumbs/user/ab/cd/person.jpeg' });
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await expect(sut.handlePersonMigration({ ownerId: person.ownerId, personGroupId: person.personGroupId })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.move.create).not.toHaveBeenCalled();
      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('should skip persons with empty thumbnail paths', async () => {
      const person = PersonFactory.create({ thumbnailPath: '' });
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await expect(sut.handlePersonMigration({ ownerId: person.ownerId, personGroupId: person.personGroupId })).resolves.toBe(JobStatus.Skipped);

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

    // #808: a birthday set inside a shared space lives on `shared_space_person`, never on `person`.
    // The asset viewer Info panel reads this endpoint for the owner, so it must apply the same
    // identity-wide resolution as PersonService.getById — otherwise the age silently disappears.
    it("should resolve the identity-wide birthday and name for the owner's own person", async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ownerId: auth.user.id, identityId: newUuid(), name: 'Owner Local Name', birthDate: null })
        .build();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue({
        id: face.person!.personGroupId,
        name: 'Karolin',
        birthDate: '2014-02-14',
      });

      const [result] = await sut.getFacesById(auth, { id: face.assetId });

      expect(result.person).toEqual(
        expect.objectContaining({ id: face.person!.personGroupId, name: 'Karolin', birthDate: '2014-02-14' }),
      );
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).toHaveBeenCalledWith(
        auth.user.id,
        face.person!.identityId,
      );
    });

    it('should not resolve via identity when the owned person has no identity', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ownerId: auth.user.id, identityId: null, name: 'Owner Local Name', birthDate: null })
        .build();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });

      const [result] = await sut.getFacesById(auth, { id: face.assetId });

      expect(result.person).toEqual(expect.objectContaining({ name: 'Owner Local Name', birthDate: null }));
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).not.toHaveBeenCalled();
    });

    it('should fall back to the raw person when identity resolution finds nothing', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ownerId: auth.user.id, identityId: newUuid(), name: 'Owner Local Name', birthDate: null })
        .build();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue(void 0);

      const [result] = await sut.getFacesById(auth, { id: face.assetId });

      expect(result.person).toEqual(expect.objectContaining({ name: 'Owner Local Name', birthDate: null }));
    });

    it('should not resolve identities for faces belonging to another owner', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ownerId: newUuid(), identityId: newUuid(), birthDate: null })
        .build();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });

      const [result] = await sut.getFacesById(auth, { id: face.assetId });

      // #796 surfaces the person to any viewer with asset read access; #808 must still not
      // identity-resolve a face the caller does not own, so the person is returned raw (birthDate
      // untouched) and the resolver is never called.
      expect(result.person).toEqual(expect.objectContaining({ id: face.person!.personGroupId, birthDate: null }));
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).not.toHaveBeenCalled();
    });

    it('should resolve each identity once when several faces share it', async () => {
      const auth = AuthFactory.create();
      const identityId = newUuid();
      const assetId = newUuid();
      const first = AssetFaceFactory.from({ assetId })
        .person({ ownerId: auth.user.id, identityId, birthDate: null })
        .build();
      const second = AssetFaceFactory.from({ assetId })
        .person({ ownerId: auth.user.id, identityId, birthDate: null })
        .build();
      const asset = AssetFactory.from({ id: assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(first), getForAssetFace(second)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue({
        id: first.person!.personGroupId,
        name: 'Karolin',
        birthDate: '2014-02-14',
      });

      const results = await sut.getFacesById(auth, { id: assetId });

      expect(results.map((r) => r.person?.birthDate)).toEqual(['2014-02-14', '2014-02-14']);
      expect((mocks.faceIdentity as any).getResolvedPersonByIdentityId).toHaveBeenCalledTimes(1);
    });

    it("should keep the birthday when identity resolution echoes the base person's own value", async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ownerId: auth.user.id, identityId: newUuid(), name: 'Karolin', birthDate: new Date('2014-02-14') })
        .build();
      const asset = AssetFactory.from({ id: face.assetId }).exif().build();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.person.getFaces.mockResolvedValue([getForAssetFace(face)]);
      mocks.asset.getForFaces.mockResolvedValue({ edits: [], ...asset.exifInfo });
      // The resolver ranks a non-null birthDate first, so it echoes the base person's own value back.
      (mocks.faceIdentity as any).getResolvedPersonByIdentityId.mockResolvedValue({
        id: face.person!.personGroupId,
        name: 'Karolin',
        birthDate: '2014-02-14',
      });

      const [result] = await sut.getFacesById(auth, { id: face.assetId });

      expect(result.person).toEqual(expect.objectContaining({ name: 'Karolin', birthDate: '2014-02-14' }));
    });
  });

  describe('createFace', () => {
    it('should create a manual face and initialize the person feature photo creation', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });
      const featureFace = AssetFaceFactory.create({
        assetId: asset.id,
        personGroupId: person.personGroupId,
        sourceType: SourceType.Manual,
      });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));
      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.getRandomFace.mockResolvedValue(featureFace);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: featureFace.id });

      await expect(
        sut.createFace(auth, {
          assetId: asset.id,
          personId: person.personGroupId,
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
        personGroupId: person.personGroupId,
        imageHeight: 500,
        imageWidth: 400,
        boundingBoxX1: 10,
        boundingBoxX2: 110,
        boundingBoxY1: 20,
        boundingBoxY2: 130,
        sourceType: SourceType.Manual,
      });
      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(person.personGroupId);
      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        faceAssetId: featureFace.id,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.PersonGenerateThumbnail,
          data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
        },
      ]);
    });

    it('should not update the person feature photo if one already exists', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ faceAssetId: newUuid() });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.asset.getById.mockResolvedValue(getForAsset(asset));
      mocks.person.getByGroupId.mockResolvedValue(person);

      await expect(
        sut.createFace(auth, {
          assetId: asset.id,
          personId: person.personGroupId,
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

    it('should reject creating a face on an asset the user does not own', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(
        sut.createFace(auth, {
          assetId: asset.id,
          personId: person.personGroupId,
          imageHeight: 500,
          imageWidth: 400,
          x: 10,
          y: 20,
          width: 100,
          height: 110,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.person.createAssetFace).not.toHaveBeenCalled();
    });
  });

  describe('createNewFeaturePhoto', () => {
    it('should change person feature photo', async () => {
      const person = PersonFactory.create();

      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      await sut.createNewFeaturePhoto([person]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.PersonGenerateThumbnail,
          data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
        },
      ]);
    });
  });

  describe('reassignFacesById', () => {
    it('should create a new person', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(sut.reassignFacesById(AuthFactory.create(), person.personGroupId, { id: face.id })).resolves.toEqual(
        {
          birthDate: person.birthDate,
          isHidden: person.isHidden,
          isFavorite: person.isFavorite,
          id: person.personGroupId,
          name: person.name,
          thumbnailPath: person.thumbnailPath,
          color: undefined,
          type: 'person',
          species: null,
          updatedAt: expect.any(String),
        },
      );

      expect(mocks.job.queue).not.toHaveBeenCalledWith();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith();
    });

    it('should replace identity links when reassigning a face by id', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.personGroupId, { id: face.id });

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.personGroupId);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
        assetFaceId: face.id,
        identityId: 'identity-1',
        source: 'manual',
      });
      // S11 (slice 11d): same clearing as reassignFaces — scoped to this person's identity only.
      expect(mocks.facePersonVerdict.clearNegativeForTarget).toHaveBeenCalledWith(
        { personId: person.personGroupId, identityId: 'identity-1' },
        [face.id],
      );
    });

    it('should fail if user has not the correct permissions on the asset', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(
        sut.reassignFacesById(AuthFactory.create(), person.personGroupId, {
          id: face.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.job.queue).not.toHaveBeenCalledWith();
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith();
    });
  });

  describe('createPerson', () => {
    it('should create a new person in a new group', async () => {
      const auth = AuthFactory.create();
      const group = PersonGroupFactory.create();

      mocks.person.createGroup.mockResolvedValue(group);
      mocks.person.create.mockResolvedValue(PersonFactory.create({ personGroupId: group.id }));
      await expect(sut.create(auth, {})).resolves.toBeDefined();

      expect(mocks.person.createGroup).toHaveBeenCalledWith(auth.user.id);
      expect(mocks.person.create).toHaveBeenCalledWith({ ownerId: auth.user.id, personGroupId: group.id });
    });
  });

  describe('handlePersonCleanup', () => {
    it('should delete people without faces', async () => {
      const person = PersonFactory.create();

      mocks.person.getAllWithoutFaces.mockResolvedValue([person]);
      mocks.person.delete.mockResolvedValue([person]);

      await sut.handlePersonCleanup();

      expect(mocks.person.delete).toHaveBeenCalledWith([person.personGroupId], undefined);
      expect(mocks.person.deleteEmptyGroups).toHaveBeenCalledWith();
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
      expect(mocks.person.delete).toHaveBeenCalledWith([orphan.personGroupId]);
      expect(mocks.sharedSpace.deleteAllOrphanedPersons).toHaveBeenCalledTimes(1);
      expect(mocks.person.vacuum).toHaveBeenCalledWith({ reindexVectors: true });
      expect(mocks.assetJob.streamForDetectFacesJob).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(1);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectFaces, data: { id: asset1.id, force: true } },
        { name: JobName.AssetDetectFaces, data: { id: asset2.id, force: true } },
      ]);

    it('marks force-created asset face-detection jobs so recognition fan-out can be suppressed', async () => {
    });
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
        personGroupId: null,
        sourceType: SourceType.MachineLearning,
        excludeManuallyPlaced: true,
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

    it('force recognition waits for thumbnail, face detection, and (separately, boundedly) people backfill before draining and clearing identities', async () => {
      const face = AssetFaceFactory.create();
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts());
      mocks.person.getAllFaces.mockReturnValue(makeStream([face]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      // S9 (F19): PeopleBackfill is waited on in its OWN call, with a bounded timeout, so a hung
      // sweep there can never delay ThumbnailGeneration/FaceDetection's own (unbounded) wait.
      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.ThumbnailGeneration,
        QueueName.FaceDetection,
      );
      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(QueueName.PeopleBackfill, {
        timeoutMs: expect.any(Number),
      });
      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledTimes(2);

      const lastWaitCallOrder = mocks.job.waitForQueueCompletion.mock.invocationCallOrder.at(-1)!;
      expect(lastWaitCallOrder).toBeLessThan(mocks.job.empty.mock.invocationCallOrder[0]);
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

    it('S9.9: passes a bounded timeout on the forced PeopleBackfill wait, as its own call', async () => {
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream());
      mocks.person.getAllFaces.mockReturnValue(makeStream([]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.PeopleBackfill,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      );
      const [, options] = mocks.job.waitForQueueCompletion.mock.calls.find(
        (call) => call[0] === QueueName.PeopleBackfill,
      )!;
      expect((options as { timeoutMs: number }).timeoutMs).toBeGreaterThan(0);
    });

    it('S9.10 (pin): the non-forced path never waits on PeopleBackfill at all', async () => {
      mocks.job.getJobCounts.mockResolvedValue(recognitionCounts({ waiting: 87_000 }));
      mocks.person.getAllFaces.mockReturnValue(makeStream([AssetFaceFactory.create()]));

      await expect(sut.handleQueueRecognizeFaces({ force: false })).resolves.toBe(JobStatus.Skipped);

      for (const call of mocks.job.waitForQueueCompletion.mock.calls) {
        expect(call).not.toContain(QueueName.PeopleBackfill);
      }
      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledTimes(1);
      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.ThumbnailGeneration,
        QueueName.FaceDetection,
      );

      // positive control, same test body: the forced path DOES wait on PeopleBackfill
      mocks.job.waitForQueueCompletion.mockClear();
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        waiting: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      mocks.person.getAll.mockReturnValue(makeStream());
      mocks.person.getAllFaces.mockReturnValue(makeStream([]));
      mocks.person.getAllWithoutFaces.mockResolvedValue([]);
      mocks.sharedSpace.deleteAllPersonFaces.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.deleteAllPersons.mockResolvedValue(void 0 as any);
      mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);

      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.waitForQueueCompletion).toHaveBeenCalledWith(
        QueueName.PeopleBackfill,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
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
      expect(mocks.person.delete).toHaveBeenCalledWith([orphan.personGroupId]);
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
        personGroupId: null,
        sourceType: SourceType.MachineLearning,
        excludeManuallyPlaced: true,
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
      mocks.person.delete.mockResolvedValue([person]);
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
      expect(mocks.person.delete).toHaveBeenCalledWith([person.personGroupId], undefined);
      expect(mocks.person.deleteEmptyGroups).toHaveBeenCalledWith();
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
      expect(facesRecognizedAt.getTime()).toBeGreaterThanOrEqual(start);
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
      mocks.search.searchFaces.mockResolvedValue([getForFaceSearch(face, 0.7)]);
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
        data: expect.objectContaining({ continuationId: expect.any(String) }),
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
        data: expect.objectContaining({ continuationId: expect.any(String) }),
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
        data: expect.objectContaining({ continuationId: 'a' }),
      });

      mocks.job.queue.mockClear();
      await expect(sut.handleFaceIdentityBackfill({ stage: 'person', continuationId: 'a' })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: expect.objectContaining({ continuationId: 'b' }),
      });
    });

    it('increments the continuation pass count on each re-queue', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(
        sut.handleFaceIdentityBackfill({ stage: 'person', continuationId: 'a', continuationCount: 2 }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: 'b', continuationCount: 3 },
      });
    });

    it('threads the continuation pass count through stage pagination requeues', async () => {
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({
        processed: 1000,
        nextCursor: 'person-cursor',
      });

      await expect(
        sut.handleFaceIdentityBackfill({ stage: 'person', continuationId: 'a', continuationCount: 2 }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'person', cursor: 'person-cursor', continuationCount: 2 },
      });
    });

    it('stops re-queueing when identity work persists at the continuation pass cap', async () => {
      // A repair pass that cannot clear getBackfillWork() would otherwise re-queue itself forever —
      // full table scans rewriting shared_space_person rows every ~30 minutes, indefinitely.
      mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
      mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
      (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
        hasPersonalIdentityWork: true,
        hasSpacePersonIdentityWork: false,
        hasSharedSpaceProjectionWork: false,
      });

      await expect(
        sut.handleFaceIdentityBackfill({
          stage: 'person',
          continuationId: 'a',
          continuationCount: FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS,
        }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FaceIdentityBackfill }));
      expect((mocks.faceIdentity as any).getPendingSharedSpaceFaceMatchBackfillTargets).not.toHaveBeenCalled();
      expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('continuation'));
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
      // Suggestions pinned off so the count below stays about the metadata backfill: the shipped default is
      // on, and the two tests below own the enabled/disabled suggestion-chaining behaviour.
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: false, maxDistance: 0.7 },
          },
        },
      });
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
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.8 },
          },
        },
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
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.8 },
          },
        },
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
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: false, maxDistance: 0.7 },
          },
        },
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
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.8 },
          },
        },
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
        data: expect.objectContaining({ continuationId: expect.any(String) }),
      });
      expect(mocks.job.queueAll).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: JobName.SharedSpaceFaceMatchAll })]),
      );
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

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(face.personGroupId);
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

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(face.personGroupId);
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
        AssetFaceFactory.from().person({ ownerId: asset.ownerId }).build(),
        AssetFaceFactory.from().person({ ownerId: asset.ownerId }).build(),
      ];

      const faces = [
        getForFaceSearch(noPerson1, 0),
        getForFaceSearch(primaryFace, 0.2),
        getForFaceSearch(noPerson2, 0.3),
        getForFaceSearch(face, 0.4),
      ];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.getByGroupId.mockResolvedValue(primaryFace.person!);
      mocks.person.create.mockResolvedValue(primaryFace.person!);

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson1.id]),
        newPersonGroupId: primaryFace.person!.personGroupId,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonGroupId: primaryFace.person!.personGroupId,
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

      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(matchedFace.person!.personGroupId);
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
        newPersonId: matchedFace.person!.personGroupId,
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
        newPersonId: primaryFace.personGroupId,
      });
      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(primaryFace.personGroupId);
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
        AssetFaceFactory.from().person({ ownerId: asset.ownerId }).build(),
        AssetFaceFactory.from().person({ ownerId: asset.ownerId, birthDate: newDate() }).build(),
      ];

      const faces = [
        getForFaceSearch(noPerson, 0),
        getForFaceSearch(face, 0.2),
        getForFaceSearch(faceWithBirthDate, 0.3),
      ];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.getByGroupId.mockResolvedValue(face.person!);
      mocks.person.create.mockResolvedValue(face.person!);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson.id]),
        newPersonGroupId: face.person!.personGroupId,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonGroupId: face.person!.personGroupId,
      });
    });

    it('should match existing person if their birth date is before file creation', async () => {
      const asset = AssetFactory.create();
      const [noPerson, face, faceWithBirthDate] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person({ ownerId: asset.ownerId }).build(),
        AssetFaceFactory.from().person({ ownerId: asset.ownerId, birthDate: newDate() }).build(),
      ];

      const faces = [
        getForFaceSearch(noPerson, 0),
        getForFaceSearch(faceWithBirthDate, 0.2),
        getForFaceSearch(face, 0.3),
      ];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.getByGroupId.mockResolvedValue(faceWithBirthDate.person!);
      mocks.person.create.mockResolvedValue(face.person!);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.person.create).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).toHaveBeenCalledTimes(1);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.arrayContaining([noPerson.id]),
        newPersonGroupId: faceWithBirthDate.person!.personGroupId,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: expect.not.arrayContaining([face.id]),
        newPersonGroupId: faceWithBirthDate.person!.personGroupId,
      });
    });

    it('should create a new person if the face is a core point with no person', async () => {
      const asset = AssetFactory.create();
      const [noPerson1, noPerson2] = [AssetFaceFactory.create({ assetId: asset.id }), AssetFaceFactory.create()];
      const person = PersonFactory.create({ ownerId: asset.ownerId });
      const sourceIdentityId = 'created-person-identity';

      const faces = [getForFaceSearch(noPerson1, 0), getForFaceSearch(noPerson2, 0.3)];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValueOnce(faces).mockResolvedValueOnce([]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));
      mocks.person.createGroup.mockResolvedValue(PersonGroupFactory.create({ id: person.personGroupId }));
      mocks.person.create.mockResolvedValue(person);
      mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: sourceIdentityId } as any);

      expect(await sut.handleRecognizeFaces({ id: noPerson1.id })).toBe(JobStatus.Success);

      expect(mocks.person.createGroup).toHaveBeenCalledWith(asset.ownerId);
      expect(mocks.person.create).toHaveBeenCalledWith({
        ownerId: asset.ownerId,
        faceAssetId: noPerson1.id,
        personGroupId: person.personGroupId,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { id: person.personGroupId },
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonGroupId: person.personGroupId,
      });
    });

    it('should create a person in the matched group when the match belongs to another user', async () => {
      const asset = AssetFactory.create();
      const [noPerson, otherOwnerFace] = [
        AssetFaceFactory.create({ assetId: asset.id }),
        AssetFaceFactory.from().person().build(),
      ];
      const person = PersonFactory.create({
        ownerId: asset.ownerId,
        personGroupId: otherOwnerFace.person!.personGroupId,
      });

      const faces = [getForFaceSearch(noPerson, 0), getForFaceSearch(otherOwnerFace, 0.2)];

      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } });
      mocks.search.searchFaces.mockResolvedValue(faces);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson, asset));
      mocks.person.create.mockResolvedValue(person);

      await sut.handleRecognizeFaces({ id: noPerson.id });

      expect(mocks.person.createGroup).not.toHaveBeenCalled();
      expect(mocks.person.create).toHaveBeenCalledWith({
        ownerId: asset.ownerId,
        faceAssetId: noPerson.id,
        personGroupId: otherOwnerFace.person!.personGroupId,
      });
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson.id],
        newPersonGroupId: otherOwnerFace.person!.personGroupId,
      });
      expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith(person.personGroupId);
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
        data: { id: person.personGroupId },
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
      const faces = [getForFaceSearch(face, 0)];

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

      const faces = [getForFaceSearch(noPerson1, 0), getForFaceSearch(noPerson2, 0.4)];

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

      const faces = [getForFaceSearch(noPerson1, 0), getForFaceSearch(noPerson2, 0.4)];

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
    it('delegates valid personal merges to identity merge propagation after access validation', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: 'person-y', success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, 'person-x', { ids: ['person-y'] })).resolves.toEqual([
        { id: 'person-y', success: true },
      ]);

      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalled();
      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        'person-x',
        ['person-y'],
        expect.any(Function),
      );
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('returns bulk failure and does not delegate when a source person is missing or inaccessible', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ personGroupId: 'person-x' });
      const identityMergePropagation = useIdentityMergePropagation();

      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(void 0);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set(['person-y']));

      await expect(sut.mergePerson(auth, 'person-x', { ids: ['person-y', 'person-z'] })).resolves.toEqual([
        { id: 'person-y', success: false, error: BulkIdErrorReason.NOT_FOUND },
        { id: 'person-z', success: false, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('returns only failed source responses and does not delegate valid sources when any source fails validation', async () => {
      const auth = AuthFactory.create();
      const [person, validSource] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      const identityMergePropagation = useIdentityMergePropagation();

      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(validSource);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([validSource.personGroupId]));

      await expect(sut.mergePerson(auth, 'person-x', { ids: ['person-y', 'person-z'] })).resolves.toEqual([
        { id: 'person-z', success: false, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.delete).not.toHaveBeenCalled();
    });

    it('rejects an empty source list before delegation', async () => {
      const auth = AuthFactory.create();
      const identityMergePropagation = useIdentityMergePropagation();

      await expect(sut.mergePerson(auth, 'person-x', { ids: [] })).rejects.toBeInstanceOf(BadRequestException);

      expect(identityMergePropagation.mergePersonalPeople).not.toHaveBeenCalled();
    });

    it('rejects self-merge before delegation', async () => {
      const auth = AuthFactory.create();
      const identityMergePropagation = useIdentityMergePropagation();

      await expect(sut.mergePerson(auth, 'person-x', { ids: ['person-x'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(identityMergePropagation.mergePersonalPeople).not.toHaveBeenCalled();
    });

    it('should require person.write and person.merge permission', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();

      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should delegate single-source merges without mutating faces directly', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergePerson.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).resolves.toEqual([
        { id: mergePerson.personGroupId, success: true },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        person.personGroupId,
        [mergePerson.personGroupId],
        expect.any(Function),
      );
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('should leave identity collapsing to propagation', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergePerson.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).resolves.toEqual([
        { id: mergePerson.personGroupId, success: true },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        person.personGroupId,
        [mergePerson.personGroupId],
        expect.any(Function),
      );
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: expect.anything(),
      });
    });

    it('should not perform smart merge updates before delegation', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [
        PersonFactory.create({ name: undefined }),
        PersonFactory.create({ name: 'Merge person' }),
      ];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergePerson.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).resolves.toEqual([
        { id: mergePerson.personGroupId, success: true },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        person.personGroupId,
        [mergePerson.personGroupId],
        expect.any(Function),
      );
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
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

      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set(['unknown']));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: ['unknown'] })).resolves.toEqual([
        { id: 'unknown', success: false, error: BulkIdErrorReason.NOT_FOUND },
      ]);

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    it('does not convert propagation failures to per-source unknown failures', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockRejectedValue(new Error('propagation failed'));
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).rejects.toThrow('propagation failed');

      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        person.personGroupId,
        [mergePerson.personGroupId],
        expect.any(Function),
      );
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      expect(mocks.person.delete).not.toHaveBeenCalled();
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });
  });

  describe('mergePerson cross-owner policy', () => {
    // §5.4 parity: merging two of your OWN people still propagates through any identity they share with other
    // users. Before #733 this endpoint would silently merge two of another user's people. It now hands the
    // planner the same authorizer the scoped and in-space merges use.
    it('does not gate a merge that only re-points another owner’s person', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId] });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      await expect(
        authorize({ collapsedOwnerIds: [], repointedOwnerIds: ['owner-b'], unrepairableSpaceCollapseIds: [] }),
      ).resolves.toBeUndefined();
    });

    it('blocks a merge that would combine two of another owner’s people when the toggle is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId] });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      await expect(
        authorize({ collapsedOwnerIds: ['owner-b'], repointedOwnerIds: [], unrepairableSpaceCollapseIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('commits a (b) collapse once the toggle is on and the merge is confirmed', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId], confirmCrossOwner: true });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      await expect(
        authorize({ collapsedOwnerIds: ['owner-b'], repointedOwnerIds: [], unrepairableSpaceCollapseIds: [] }),
      ).resolves.toBeUndefined();
    });

    // Parity with the scoped merge's 409 test: with the toggle on but no confirmation on the DTO, the classic
    // endpoint must surface the confirmation-required conflict, not silently commit (#733).
    it('requires explicit confirmation for a (b) collapse when the toggle is on but the merge is not confirmed', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId] });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      const error = await authorize({
        collapsedOwnerIds: ['owner-b'],
        repointedOwnerIds: [],
        unrepairableSpaceCollapseIds: [],
      }).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
      });
    });

    // #733 review P1: a fan-out that would collapse people in a space the actor cannot edit is now governed by the
    // same admin toggle as an other-owner collapse — blocked when off, permitted (with confirmation) when on.
    it('blocks a fan-out collapse of an un-editable space when the toggle is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId] });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      const error = await authorize({
        collapsedOwnerIds: [],
        repointedOwnerIds: [],
        unrepairableSpaceCollapseIds: ['space-x'],
      }).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
      });
    });

    it('commits a fan-out collapse of an un-editable space once the toggle is on and confirmed', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const [person, mergeTarget] = [
        PersonFactory.create({ personGroupId: 'person-x' }),
        PersonFactory.create({ personGroupId: 'person-y' }),
      ];
      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergeTarget.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergeTarget);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergeTarget.personGroupId]));
      await sut.mergePerson(auth, person.personGroupId, { ids: [mergeTarget.personGroupId], confirmCrossOwner: true });
      const authorize = identityMergePropagation.mergePersonalPeople.mock.calls[0][3] as MergeAuthorizerFn;

      await expect(
        authorize({ collapsedOwnerIds: [], repointedOwnerIds: [], unrepairableSpaceCollapseIds: ['space-x'] }),
      ).resolves.toBeUndefined();
    });
  });

  describe('scoped people repair', () => {
    // The scoped merge now delegates wholesale to the propagation planner: the planner resolves and
    // RBAC-checks the refs, and collapses profiles that would otherwise land in the same scope. The service's
    // only remaining job is the cross-owner policy, which it hands to the planner as an authorizer that runs
    // against the built plan, inside the merge transaction, before anything is written (#733).
    it('delegates the merge to the propagation planner, with an authorizer', async () => {
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const dto = {
        target: { type: 'person' as const, id: newUuid() },
        sources: [{ type: 'space-person' as const, id: newUuid(), spaceId: newUuid() }],
      };

      await sut.mergeScopedPeople(auth, dto);

      expect(identityMergePropagation.mergeScopedProfiles).toHaveBeenCalledWith(auth, dto, expect.any(Function));
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    // #733 review H1: the cross-owner toggle must be resolved BEFORE the merge transaction opens. The authorizer
    // runs inside that transaction while it holds the instance-wide advisory lock, and a config read there needs a
    // second pool connection a saturated pool cannot grant — deadlocking every merge (#595). So the service reads
    // the config eagerly and hands the authorizer an already-resolved value; invoking it does no further config I/O.
    it('resolves the cross-owner toggle before delegating to the planner (not inside the merge transaction)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();

      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);

      expect(mocks.systemMetadata.get).toHaveBeenCalled();
      const readsBeforeAuthorize = mocks.systemMetadata.get.mock.calls.length;
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;
      await authorize(planWith({ collapsedOwnerIds: ['owner-b'] })).catch(() => {});
      expect(mocks.systemMetadata.get).toHaveBeenCalledTimes(readsBeforeAuthorize);
    });

    // (a) A merge that only RE-POINTS another owner's person is not destructive — their row keeps its name and
    // faces, and the recognition job does exactly this unattended. It is never gated, even with the toggle off.
    it('does not gate a merge that only re-points another owner’s person', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      await expect(authorize(planWith({ repointedOwnerIds: ['owner-b'] }))).resolves.toBeUndefined();
    });

    // (b) A merge that would COLLAPSE two of another owner's people deletes one of their rows. That is what the
    // instance toggle and the confirmation exist for.
    it('blocks a destructive cross-owner merge when the toggle is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      const error = await authorize(planWith({ collapsedOwnerIds: ['owner-b'] })).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
      });
    });

    it('requires explicit confirmation for a destructive cross-owner merge when the toggle is on', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      const error = await authorize(planWith({ collapsedOwnerIds: ['owner-b', 'owner-c'] })).catch(
        (error_: unknown) => error_,
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        impactedOwnerCount: 2,
      });
    });

    it('permits a destructive cross-owner merge once the toggle is on and the user confirms', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto({ confirmCrossOwner: true }) as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      await expect(authorize(planWith({ collapsedOwnerIds: ['owner-b'] }))).resolves.toBeUndefined();
      // Affected owners are intentionally not notified (issue #733 revision): once the instance opts in and the
      // user acknowledges, the merge commits silently.
      expect(mocks.notification.create).not.toHaveBeenCalled();
      expect(mocks.websocket.clientSend).not.toHaveBeenCalled();
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
      // L3: ownerId must match auth.user.id — getStatistics now branches on person.ownerId to
      // decide between the owner's unscoped count and a space-reader's memberUserId-scoped count.
      const person = PersonFactory.create({ identityId: null, ownerId: auth.user.id });

      mocks.person.getByGroupId.mockResolvedValue(person);
      mocks.person.getStatistics.mockResolvedValue({ assets: 3 });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      await expect(sut.getStatistics(auth, person.personGroupId)).resolves.toEqual({ assets: 3 });
      expect(mocks.person.getStatistics).toHaveBeenCalledWith(person.personGroupId, auth.user.id);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
      mocks.person.getStatistics.mockResolvedValue({ assets: 3, faces: 4 });

      await expect(sut.getStatistics(auth, person.personGroupId)).resolves.toEqual({ assets: 3, faces: 4 });
      expect(mocks.person.getStatistics).toHaveBeenCalledWith(person.personGroupId);
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).not.toHaveBeenCalled();
    });

    it('returns accessible identity statistics for an owned identity-backed person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });

      (mocks.faceIdentity as any).getAccessiblePersonStatistics.mockResolvedValue({ assets: 7, faces: 9 });

      await expect(sut.getStatistics(auth, person.personGroupId)).resolves.toEqual({ assets: 7, faces: 9 });
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).toHaveBeenCalledWith(
        auth.user.id,
        'identity-1',
      );
      expect(mocks.person.getStatistics).not.toHaveBeenCalled();
    });

    it('returns accessible identity statistics for an accessible space-person route id', async () => {
      const auth = AuthFactory.create();
      const personId = newUuid();

      mocks.person.getByGroupIdOnly.mockResolvedValue(void 0);
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

      mocks.person.getByGroupIdOnly.mockResolvedValue(void 0);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      (mocks.faceIdentity as any).getAccessibleProfileIdentityId.mockResolvedValue(void 0);

      await expect(sut.getStatistics(auth, personId)).rejects.toThrow('Not found or no person.read access');
      expect((mocks.faceIdentity as any).getAccessiblePersonStatistics).not.toHaveBeenCalled();
    });

    it('should require person.read permission', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.person.getByGroupId.mockResolvedValue(person);
      await expect(sut.getStatistics(auth, person.personGroupId)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([person.personGroupId]));
    });

    // L3: a space-only reader (PersonRead granted only via checkSharedSpaceAccess, never the
    // owner) of a legacy (null-identityId) person previously got personRepository.getStatistics(id)
    // unscoped — the OWNER's whole-library Timeline asset/face count for that person, not just the
    // count reachable through the space. Must be scoped to memberUserId instead.
    it('scopes legacy person statistics to space-reachable assets for a non-owner space reader (L3)', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: null }); // ownerId is random, != auth.user.id

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getStatistics.mockResolvedValue({ assets: 2, faces: 2 });

      await expect(sut.getStatistics(auth, person.personGroupId)).resolves.toEqual({ assets: 2, faces: 2 });
      expect(mocks.person.getStatistics).toHaveBeenCalledWith(person.personGroupId, { memberUserId: auth.user.id });
    });
  });

  describe('mergePerson (smart merge birthDate)', () => {
    it('should leave birthDate smart merge to propagation', async () => {
      const auth = AuthFactory.create();
      const birthDate = new Date('1990-01-15');
      const [person, mergePerson] = [
        PersonFactory.create({ name: 'Primary', birthDate: null }),
        PersonFactory.create({ name: 'Merge', birthDate }),
      ];
      const identityMergePropagation = useIdentityMergePropagation();

      identityMergePropagation.mergePersonalPeople.mockResolvedValue([{ id: mergePerson.personGroupId, success: true }]);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(mergePerson);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([mergePerson.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).resolves.toEqual([
        { id: mergePerson.personGroupId, success: true },
      ]);

      expect(identityMergePropagation.mergePersonalPeople).toHaveBeenCalledWith(
        auth,
        person.personGroupId,
        [mergePerson.personGroupId],
        expect.any(Function),
      );
      expect(mocks.person.update).not.toHaveBeenCalled();
    });

    it('should throw when merging a person into themselves', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [person.personGroupId] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should handle no access to merge person', async () => {
      const auth = AuthFactory.create();
      const [person, mergePerson] = [PersonFactory.create(), PersonFactory.create()];

      mocks.person.getByGroupIdOnly.mockResolvedValueOnce(person);
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set([person.personGroupId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValueOnce(new Set());

      await expect(sut.mergePerson(auth, person.personGroupId, { ids: [mergePerson.personGroupId] })).resolves.toEqual([
        { id: mergePerson.personGroupId, success: false, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a single person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getForPeopleDelete.mockResolvedValue([person]);

      await sut.delete(auth, person.personGroupId);

      expect(mocks.person.getForPeopleDelete).toHaveBeenCalledWith([person.personGroupId]);
      expect(mocks.person.delete).toHaveBeenCalledWith([person.personGroupId]);
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

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person1.personGroupId, person2.personGroupId]));
      mocks.person.getForPeopleDelete.mockResolvedValue([person1, person2]);

      await sut.deleteAll(auth, { ids: [person1.personGroupId, person2.personGroupId] });

      expect(mocks.person.delete).toHaveBeenCalledWith([person1.personGroupId, person2.personGroupId]);
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
      mocks.person.getByGroupIdOnly.mockResolvedValue(undefined);

      await expect(sut.handlePersonMigration({ personGroupId: newUuid() })).resolves.toBe(JobStatus.Failed);
    });
  });

  describe('reassignFaces', () => {
    it('should trigger new feature photo when person has null faceAssetId', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([face] as any);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(person);

      await sut.reassignFaces(auth, person.personGroupId, {
        data: [{ personId: person.personGroupId, assetId: face.assetId }],
      });

      expect(mocks.job.queueAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: JobName.PersonGenerateThumbnail, data: { id: person.personGroupId } }),
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

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([newPerson.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(newPerson);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([face] as any);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(newPerson);

      await sut.reassignFaces(auth, newPerson.personGroupId, {
        data: [{ personId: oldPerson.personGroupId, assetId: face.assetId }],
      });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(face.person!.personGroupId);
    });
  });

  describe('reassignFaces', () => {
    it('resolves pending suggestions for the face when bulk-reassigned (edge 11, manual branch)', async () => {
      const face = AssetFaceFactory.create();
      const auth = AuthFactory.create();
      const person = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFacesByIds.mockResolvedValue([getForAssetFace(face)]);
      mocks.person.reassignFace.mockResolvedValue(1);

      await sut.reassignFaces(auth, person.personGroupId, {
        data: [{ personId: person.personGroupId, assetId: face.assetId }],
      });

      expect(mocks.facePersonVerdict.resolveAssignedFace).toHaveBeenCalledWith(face.id);
    });
  });

  describe('reassignFacesById', () => {
    it('should trigger new feature photo for person with null faceAssetId', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(face as any);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.personGroupId, { id: face.id });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(person.personGroupId);
    });

    it('should trigger new feature photo for old person when reassigned face was their feature', async () => {
      const oldPerson = PersonFactory.create();
      const face = AssetFaceFactory.from()
        .person({ ...oldPerson, faceAssetId: undefined })
        .build();
      face.person!.faceAssetId = face.id;
      const newPerson = PersonFactory.create();

      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([newPerson.personGroupId]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(face as any);
      mocks.person.getByGroupIdOnly.mockResolvedValue(newPerson);
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getRandomFace.mockResolvedValue(AssetFaceFactory.create());
      mocks.person.update.mockResolvedValue(newPerson);

      await sut.reassignFacesById(AuthFactory.create(), newPerson.personGroupId, { id: face.id });

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith(face.person!.personGroupId);
    });

    it('resolves pending suggestions for the face when it is reassigned by id (edge 11, manual branch)', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await sut.reassignFacesById(AuthFactory.create(), person.personGroupId, { id: face.id });

      expect(mocks.facePersonVerdict.resolveAssignedFace).toHaveBeenCalledWith(face.id);
    });
  });

  describe('createNewFeaturePhoto', () => {
    it('should not queue job when no random face is found', async () => {
      const person = PersonFactory.create();

      mocks.person.getRandomFace.mockResolvedValue(undefined);

      await sut.createNewFeaturePhoto([person.personGroupId]);

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
        .mockResolvedValueOnce([{ ...noPerson2, personGroupId: person.personGroupId, distance: 0.2 }]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));

      await sut.handleRecognizeFaces({ id: noPerson1.id });

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.personGroupId,
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
        newPersonId: person.personGroupId,
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
        .mockResolvedValueOnce([{ ...noPerson2, personGroupId: person.personGroupId, distance: 0.2 }]);
      mocks.person.getFaceForFacialRecognitionJob.mockResolvedValue(getForFacialRecognitionJob(noPerson1, asset));

      await sut.handleRecognizeFaces({ id: noPerson1.id, deferred: true });

      expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
        faceIds: [noPerson1.id],
        newPersonId: person.personGroupId,
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
        excludeManuallyPlaced: true,
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.FacialRecognition, data: { id: face.id, deferred: false } },
      ]);
    });

    it('should not skip nightly when no latest face date (proceeds to queue faces)', async () => {
      const face = AssetFaceFactory.create();
      const lastRun = new Date();
      mocks.systemMetadata.get.mockResolvedValue({ lastRun: lastRun.toISOString() });

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
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.asset.getById.mockResolvedValue(asset as any);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await sut.createFace(auth, {
        assetId: asset.id,
        personId: person.personGroupId,
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
          personId: person.personGroupId,
          sourceType: SourceType.Manual,
        }),
      );
    });

    it('should throw NotFoundException if asset is not found', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const assetId = newUuid();

      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));

      mocks.asset.getById.mockResolvedValue(undefined);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await expect(
        sut.createFace(auth, {
          assetId,
          personId: person.personGroupId,
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

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getAllForUser.mockResolvedValue({ items: [], hasNextPage: false });
      mocks.person.getNumberOfPeople.mockResolvedValue({ total: 0, hidden: 0 });

      await sut.getAll(auth, { closestPersonId: person.personGroupId, page: 1, size: 10 });

      expect(mocks.person.getAllForUser).toHaveBeenCalledWith(
        { skip: 0, take: 10 },
        auth.user.id,
        expect.objectContaining({ closestFaceAssetId: 'face-asset-id' }),
      );
      expect(mocks.person.getNumberOfPeople).toHaveBeenCalledWith(auth.user.id, { minimumFaceCount: 3 });
    });

    it('should throw NotFoundException when closestPersonId is not found', async () => {
      const auth = AuthFactory.create();

      mocks.person.getByGroupIdOnly.mockResolvedValue(undefined);

      await expect(sut.getAll(auth, { closestPersonId: 'invalid', page: 1, size: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when closestPerson has no faceAssetId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: null });

      mocks.person.getByGroupIdOnly.mockResolvedValue(person);

      await expect(sut.getAll(auth, { closestPersonId: person.personGroupId, page: 1, size: 10 })).rejects.toBeInstanceOf(
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

    // #796 POLICY REVERSAL (was 'should not map person if person does not match auth user id').
    // mapFaces no longer gates on ownership: its only caller, getFacesById, has already authorized
    // Permission.AssetRead and is responsible for dropping hidden people for non-owners.
    it('should map person even when the person does not belong to the auth user', () => {
      expect(
        mapFaces(getForAssetFace(AssetFaceFactory.from().person().build()), AuthFactory.create()).person,
      ).not.toBeNull();
    });

    it('should map a null person when the face has none', () => {
      expect(mapFaces(getForAssetFace(AssetFaceFactory.from().build()), AuthFactory.create()).person).toBeNull();
    });
  });

  describe('onConfigValidate', () => {
    it('rejects an enabled band at or below the recognition distance', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: configValidateTestConfig(true, 0.5, 0.5),
          oldConfig: configValidateTestConfig(false, 0.5, 0.7),
        }),
      ).toThrow(/must be greater than the maximum recognition distance/);
    });

    it('accepts an enabled band above the recognition distance', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: configValidateTestConfig(true, 0.5, 0.7),
          oldConfig: configValidateTestConfig(false, 0.5, 0.7),
        }),
      ).not.toThrow();
    });

    it('ignores the band when suggestions are disabled', () => {
      expect(() =>
        sut.onConfigValidate({
          newConfig: configValidateTestConfig(false, 0.5, 0.3),
          oldConfig: configValidateTestConfig(false, 0.5, 0.7),
        }),
      ).not.toThrow();
    });
  });

  describe('onConfigUpdate', () => {
    it('queues the maintenance scan on the false to true transition', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true),
        oldConfig: onConfigUpdateTestConfig(false),
      });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
    });

    it('does not queue when it was already enabled', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true),
        oldConfig: onConfigUpdateTestConfig(true),
      });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue when the feature is switched off', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(false),
        oldConfig: onConfigUpdateTestConfig(true),
      });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue when suggestions are untouched', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(false),
        oldConfig: onConfigUpdateTestConfig(false),
      });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue when band widens while already enabled', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true, true, true, 0.5, 0.9),
        oldConfig: onConfigUpdateTestConfig(true, true, true, 0.5, 0.7),
      });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    // Suggestions never call the machine learning service, so the ML master switch does not gate
    // them — flipping them on while it is off is a real transition and must queue the scan.
    it('queues when suggestions.enabled flips true while the machine learning master switch is off', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true, false, true, 0.5, 0.7),
        oldConfig: onConfigUpdateTestConfig(false, false, true, 0.5, 0.7),
      });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
    });

    it('does not queue when suggestions.enabled flips true while facial recognition is disabled', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true, true, false, 0.5, 0.7),
        oldConfig: onConfigUpdateTestConfig(false, true, false, 0.5, 0.7),
      });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('queues when band becomes valid from invalid transition', async () => {
      await sut.onConfigUpdate({
        newConfig: onConfigUpdateTestConfig(true, true, true, 0.5, 0.7),
        oldConfig: onConfigUpdateTestConfig(true, true, true, 0.5, 0.4),
      });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FaceSuggestionMaintenance, data: {} });
    });
  });
});
