import { Reflector } from '@nestjs/core';
import type { SystemConfig } from 'src/dtos/config.dto.js';
import { QueueStatisticsDto } from 'src/dtos/queue.dto.js';
import { JobName, JobStatus, MetadataKey, QueueJobStatus, QueueName, SystemMetadataKey } from 'src/enum.js';
import {
  FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS,
  FaceIdentityMaintenanceService,
} from 'src/gallery/face-identity-maintenance.service.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

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

describe(FaceIdentityMaintenanceService.name, () => {
  let sut: FaceIdentityMaintenanceService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceIdentityMaintenanceService));
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
