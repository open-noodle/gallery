import { Injectable } from '@nestjs/common';
import type { ArgOf } from 'src/repositories/event.repository.js';
import type { SharedSpaceFaceMatchBackfillTarget } from 'src/repositories/face-identity.repository.js';
import type { JobItem, JobOf } from 'src/types.js';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { ImmichWorker, JobName, JobStatus, QueueJobStatus, QueueName, SystemMetadataKey } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { isFaceSuggestionEnabled } from 'src/utils/misc.js';

const FACE_IDENTITY_BACKFILL_CHUNK_SIZE = 1000;

/**
 * Upper bound on full re-scan passes one backfill chain may take when getBackfillWork() keeps
 * reporting identity work. Repair passes are designed to converge in one or two passes; work that
 * is still outstanding at the cap indicates a convergence bug, and re-queueing would otherwise
 * loop full-table scans forever. The next external trigger (bootstrap, post-recognition
 * maintenance, or a manual run) starts a fresh chain.
 */
export const FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS = 5;

@Injectable()
export class FaceIdentityMaintenanceService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap(): Promise<void> {
    await this.queueInitialFaceSuggestionSweep();

    if (!(await this.faceIdentityRepository.hasBackfillWork())) {
      return;
    }

    const activeBackfills = await this.jobRepository.searchJobs(QueueName.PeopleBackfill, {
      status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
    });
    if (activeBackfills.some((job) => job.name === JobName.FaceIdentityBackfill)) {
      return;
    }

    await this.jobRepository.queue({ name: JobName.FaceIdentityBackfill, data: {} });
  }

  /**
   * Face suggestions ship enabled (`config.ts` defaults). An instance that upgrades *into* that default
   * never emits a `ConfigUpdate`, so `onConfigUpdate`'s false -> true transition — the thing that normally
   * starts the work — cannot fire for it. `FaceSuggestionMaintenance` has no cron either, so without this
   * the settings page would report the feature on while the queue stayed empty until someone renamed a
   * person or ran the job by hand: the same "the feature seems to be missing" report the opt-in toggle was
   * introduced to fix, in a new shape.
   *
   * Runs at most once per instance, guarded by a system-metadata marker (same pattern as
   * SharedSpaceService.onBootstrap). This method only ever QUEUES; the marker is written by the sweep
   * itself, in `FaceSuggestionService.handleFaceSuggestionMaintenance`'s success path. Two failure modes make that
   * split load-bearing, and burning the marker here reintroduces both:
   *
   *   - feature off at this boot. The old code burnt the marker anyway, reasoning that a later opt-in is
   *     served by `onConfigUpdate`'s false -> true transition. That is untrue under IMMICH_CONFIG_FILE:
   *     `updateSystemConfig` throws outright for file-mode instances, and a YAML edit + restart emits only
   *     `ConfigInit`. Such an admin would get a toggle reading "on" over a queue nothing ever fills. The
   *     cost of leaving it unset is one config read per boot.
   *   - the sweep fails. `FaceSuggestionMaintenance` runs with `attempts: 1` and `removeOnFail: true`
   *     (job.repository.ts), so a marker written at queue time would outlive a job that failed and
   *     vanished — recorded as swept, never actually run, never retried.
   *
   * A fresh install still burns it on the first boot, against an empty library, which costs nothing: the
   * sweep finds no named people, and `handleFaceIdentityBackfill`'s completion path keeps the queue current
   * from then on.
   */
  private async queueInitialFaceSuggestionSweep(): Promise<void> {
    const state = await this.systemMetadataRepository.get(SystemMetadataKey.FaceSuggestionDefaultOnState);
    if (state?.sweptAt) {
      return;
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFaceSuggestionEnabled(machineLearning)) {
      return;
    }

    this.logger.log('Face suggestions are enabled and have never been swept; queueing face suggestion maintenance');
    await this.jobRepository.queue({ name: JobName.FaceSuggestionMaintenance, data: {} });
  }

  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    const { maxDistance, suggestions } = newConfig.machineLearning.facialRecognition;
    if (suggestions.enabled && suggestions.maxDistance <= maxDistance) {
      throw new Error(
        `Face suggestion max distance (${suggestions.maxDistance}) must be greater than the maximum recognition distance (${maxDistance}), otherwise no faces can ever be suggested.`,
      );
    }
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    // Transition-only: re-saving settings must not re-queue a library-wide sweep. Widening the band
    // while already enabled is picked up by running the maintenance job manually.
    if (!isFaceSuggestionEnabled(oldConfig.machineLearning) && isFaceSuggestionEnabled(newConfig.machineLearning)) {
      await this.jobRepository.queue({ name: JobName.FaceSuggestionMaintenance, data: {} });
    }
  }

  @OnJob({ name: JobName.FaceIdentityBackfill, queue: QueueName.PeopleBackfill })
  async handleFaceIdentityBackfill({
    stage = 'person',
    cursor,
    continuationId,
    continuationCount,
  }: JobOf<JobName.FaceIdentityBackfill>): Promise<JobStatus> {
    const affectedSpaceAssets: SharedSpaceFaceMatchBackfillTarget[] = [];
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill start stage=${stage} cursor=${cursor ?? 'none'} continuation=${continuationId ?? 'none'}`,
    );

    if (stage === 'person') {
      const result = await this.faceIdentityRepository.backfillPersonalIdentities({
        cursor,
        limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
      });
      affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));
      this.logger.debug(
        `FaceIdentityBackfill peopleBackfill personal page processed=${result.processed} nextCursor=${result.nextCursor ?? 'none'} affectedSpaceAssets=${affectedSpaceAssets.length}`,
      );

      if (result.nextCursor) {
        this.logger.debug(`FaceIdentityBackfill peopleBackfill queue next stage=person cursor=${result.nextCursor}`);
        await this.jobRepository.queue({
          name: JobName.FaceIdentityBackfill,
          data: { stage: 'person', cursor: result.nextCursor, continuationCount },
        });
        return JobStatus.Success;
      }
    }

    const result = await this.faceIdentityRepository.backfillSpacePersonIdentities({
      cursor: stage === 'space-person' ? cursor : undefined,
      limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
    });
    affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill space-person page processed=${result.processed} nextCursor=${result.nextCursor ?? 'none'} conflicts=${result.conflictCount} affectedSpaceAssets=${affectedSpaceAssets.length}`,
    );

    if (result.conflictCount > 0) {
      this.logger.warn(`Face identity backfill left ${result.conflictCount} space people unresolved`);
    }

    if (result.nextCursor) {
      this.logger.debug(
        `FaceIdentityBackfill peopleBackfill queue next stage=space-person cursor=${result.nextCursor}`,
      );
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: result.nextCursor, continuationCount },
      });
      return JobStatus.Success;
    }

    const work = await this.faceIdentityRepository.getBackfillWork();
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill remaining work personal=${work.hasPersonalIdentityWork} spacePerson=${work.hasSpacePersonIdentityWork} projection=${work.hasSharedSpaceProjectionWork}`,
    );

    if (work.hasPersonalIdentityWork || work.hasSpacePersonIdentityWork) {
      const passCount = continuationCount ?? 0;
      if (passCount >= FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS) {
        this.logger.error(
          `Face identity backfill still reports work after ${passCount} continuation passes — stopping to prevent an endless re-queue loop`,
        );
        return JobStatus.Success;
      }
      const nextContinuationId = this.getNextFaceIdentityBackfillContinuationId(continuationId);
      this.logger.debug(`FaceIdentityBackfill peopleBackfill queue continuation=${nextContinuationId}`);
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: {
          continuationId: nextContinuationId,
          continuationCount: passCount + 1,
        },
      });
      return JobStatus.Success;
    }

    const pendingTargets = await this.faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets();
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill finalizing pendingTargets=${pendingTargets.length} affectedSpaceAssets=${affectedSpaceAssets.length}`,
    );

    if (work.hasSharedSpaceProjectionWork) {
      const projectionTargets = await this.faceIdentityRepository.getSharedSpaceFaceMatchBackfillTargets();
      this.logger.debug(`FaceIdentityBackfill peopleBackfill projectionTargets=${projectionTargets.length}`);
      if (projectionTargets.length === 0) {
        this.logger.warn('Face identity projection backfill work was reported but no targets were found');
      }
      affectedSpaceAssets.push(...projectionTargets);
    }

    const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
    this.logger.debug(`FaceIdentityBackfill peopleBackfill queued face-match targets=${queuedTargets.length}`);
    await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
    if (queuedTargets.length === 0) {
      await this.jobRepository.queue({ name: JobName.SharedSpacePersonMetadataBackfill, data: {} });
      this.logger.debug('FaceIdentityBackfill peopleBackfill complete; queuedSpacePersonMetadataBackfill=true');

      const { machineLearning } = await this.getConfig({ withCache: true });
      if (isFaceSuggestionEnabled(machineLearning)) {
        await this.jobRepository.queue({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
        await this.jobRepository.queue({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
      }
    }

    return JobStatus.Success;
  }

  private getNextFaceIdentityBackfillContinuationId(currentContinuationId?: string): string {
    return currentContinuationId === 'a' ? 'b' : 'a';
  }

  private getAffectedSpaceAssets(result: object): SharedSpaceFaceMatchBackfillTarget[] {
    return (result as { affectedSpaceAssets?: SharedSpaceFaceMatchBackfillTarget[] }).affectedSpaceAssets ?? [];
  }

  private async queueSharedSpaceFaceMatchTargets(
    targets: SharedSpaceFaceMatchBackfillTarget[],
  ): Promise<SharedSpaceFaceMatchBackfillTarget[]> {
    const uniqueTargets = new Map(
      targets
        .toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId))
        .map((target) => [`${target.spaceId}:${target.assetId}`, target]),
    )
      .values()
      .toArray();

    if (uniqueTargets.length === 0) {
      return [];
    }

    let jobs: JobItem[] = [];
    for (const { spaceId, assetId } of uniqueTargets) {
      jobs.push({
        name: JobName.SharedSpaceFaceMatchFromBackfill as const,
        data: { spaceId, assetId },
      });

      if (!(jobs.length >= JOBS_ASSET_PAGINATION_SIZE)) {
        continue;
      }

      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }

    if (jobs.length > 0) {
      await this.jobRepository.queueAll(jobs);
    }

    return uniqueTargets;
  }

  @OnJob({ name: JobName.FaceIdentityMaintenanceAfterRecognition, queue: QueueName.FacialRecognition })
  async handleFaceIdentityMaintenanceAfterRecognition(
    _data: JobOf<JobName.FaceIdentityMaintenanceAfterRecognition>,
  ): Promise<JobStatus> {
    const counts = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);

    if (counts.waiting > 0 || counts.delayed > 0 || counts.paused > 0) {
      await this.jobRepository.queue({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: 10_000 },
      });
      return JobStatus.Success;
    }

    // active=1 means only this marker is running — queue has drained
    if (counts.active > 1) {
      await this.jobRepository.queue({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: 10_000 },
      });
      return JobStatus.Success;
    }

    const activeBackfills = await this.jobRepository.searchJobs(QueueName.PeopleBackfill, {
      status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
    });
    if (activeBackfills.some((job) => job.name === JobName.FaceIdentityBackfill)) {
      return JobStatus.Skipped;
    }

    await this.jobRepository.queue({ name: JobName.FaceIdentityBackfill, data: {} });
    return JobStatus.Success;
  }
}
