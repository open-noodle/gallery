import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { JobsOptions, Queue, Worker, WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { setTimeout } from 'node:timers/promises';
import { JobConfig } from 'src/decorators';
import { QueueJobResponseDto, QueueJobSearchDto } from 'src/dtos/queue.dto';
import { ImmichWorker, JobName, JobStatus, MetadataKey, QueueCleanType, QueueJobStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobCounts, JobItem, JobOf, JobTypeCounts } from 'src/types';
import { getKeyByValue, getMethodNames, ImmichStartupError } from 'src/utils/misc';

type JobMapItem = {
  jobName: JobName;
  queueName: QueueName;
  handler: (job: JobOf<any>) => Promise<JobStatus>;
  label: string;
};

const WORKER_WATCH_INTERVAL_MS = 30_000;

const FORCE_FACIAL_RECOGNITION_QUEUE_ALL_JOB_ID = `${JobName.FacialRecognitionQueueAll}/force`;

/**
 * Per-queue worker lock overrides. BullMQ defaults to a 30s lock + 30s stalled check + maxStalledCount
 * 1, which is fine for short handlers but dangerous for queues whose handlers can legitimately run for
 * minutes. The FacialRecognition queue (concurrency 1) runs space face-match-all, identity
 * reconciliation, and per-pass dedup; on a large space a single healthy handler can exceed 30s, get
 * declared stalled, and be orphaned in the "active" list — starving the whole queue, core face
 * recognition included. A longer lock + stalled interval keeps slow-but-healthy jobs alive.
 */
const WORKER_OPTIONS_BY_QUEUE: Partial<Record<QueueName, Pick<WorkerOptions, 'lockDuration' | 'stalledInterval'>>> = {
  [QueueName.FacialRecognition]: { lockDuration: 300_000, stalledInterval: 300_000 },
};

/** Builds the BullMQ worker options for a queue, layering any per-queue lock overrides on top. */
export const buildWorkerOptions = (baseConfig: WorkerOptions, queueName: QueueName): WorkerOptions => ({
  ...baseConfig,
  concurrency: 1,
  name: ImmichWorker.Microservices,
  ...WORKER_OPTIONS_BY_QUEUE[queueName],
});

export type QueueTelemetryStatus = 'active' | 'completed' | 'failed' | 'delayed' | 'waiting' | 'paused';
export type QueueTelemetryStalenessStatus = 'waiting' | 'delayed' | 'failed';

export interface QueueTelemetryJobCount {
  queue: QueueName;
  status: QueueTelemetryStatus;
  count: number;
}

export interface QueueTelemetryOldestJobAge {
  queue: QueueName;
  status: QueueTelemetryStalenessStatus;
  ageSeconds: number;
}

export interface QueueTelemetryMetrics {
  counts: QueueTelemetryJobCount[];
  oldestJobAges: QueueTelemetryOldestJobAge[];
}

@Injectable()
export class JobRepository {
  private workers: Partial<Record<QueueName, Worker>> = {};
  private handlers: Partial<Record<JobName, JobMapItem>> = {};
  private workerWatcher?: ReturnType<typeof setInterval>;
  private microservicesPresent = true;

  constructor(
    private moduleRef: ModuleRef,
    private configRepository: ConfigRepository,
    private eventRepository: EventRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(JobRepository.name);
  }

  setup(services: (new (...args: any[]) => unknown)[]) {
    const reflector = this.moduleRef.get(Reflector, { strict: false });

    // discovery
    for (const Service of services) {
      const instance = this.moduleRef.get<any>(Service);
      for (const methodName of getMethodNames(instance)) {
        const handler = instance[methodName];
        const config = reflector.get<JobConfig>(MetadataKey.JobConfig, handler);
        if (!config) {
          continue;
        }

        const { name: jobName, queue: queueName } = config;
        const label = `${Service.name}.${handler.name}`;

        // one handler per job
        if (Object.hasOwn(this.handlers, jobName)) {
          const jobKey = getKeyByValue(JobName, jobName);
          const errorMessage = `Failed to add job handler for ${label}`;
          this.logger.error(
            `${errorMessage}. JobName.${jobKey} is already handled by ${this.handlers[jobName]!.label}.`,
          );
          throw new ImmichStartupError(errorMessage);
        }

        this.handlers[jobName] = {
          label,
          jobName,
          queueName,
          handler: handler.bind(instance),
        };

        this.logger.verbose(`Added job handler: ${jobName} => ${label}`);
      }
    }

    // no missing handlers
    for (const [jobKey, jobName] of Object.entries(JobName)) {
      const item = this.handlers[jobName];
      if (!item) {
        const errorMessage = `Failed to find job handler for Job.${jobKey} ("${jobName}")`;
        this.logger.error(
          `${errorMessage}. Make sure to add the @OnJob({ name: JobName.${jobKey}, queue: QueueName.XYZ }) decorator for the new job.`,
        );
        throw new ImmichStartupError(errorMessage);
      }
    }
  }

  startWorkers() {
    const { bull } = this.configRepository.getEnv();
    for (const queueName of Object.values(QueueName)) {
      this.logger.debug(`Starting worker for queue: ${queueName}`);
      this.workers[queueName] = new Worker(
        queueName,
        (job) => this.eventRepository.emit('JobRun', queueName, job as JobItem),
        buildWorkerOptions(bull.config, queueName),
      );
    }
  }

  watchWorkers() {
    this.workerWatcher ??= setInterval(() => void this.checkWorkers(), WORKER_WATCH_INTERVAL_MS);
  }

  teardown() {
    if (!this.workerWatcher) {
      return;
    }

    clearInterval(this.workerWatcher);
    this.workerWatcher = undefined;
  }

  private async checkWorkers() {
    let isPresent: boolean;
    try {
      const suffix = `:w:${ImmichWorker.Microservices}`;
      const workers = await this.getQueue(QueueName.BackgroundTask).getWorkers();
      isPresent = workers.some((worker) => worker.rawname?.endsWith(suffix));
    } catch {
      return;
    }

    if (this.microservicesPresent !== isPresent) {
      if (isPresent) {
        this.logger.log('Microservices worker connected.');
      } else {
        this.logger.warn(
          'No microservices worker is connected. Background jobs will not be processed until one is running.',
        );
      }
    }
    this.microservicesPresent = isPresent;
  }

  async run({ name, data }: JobItem) {
    const item = this.handlers[name as JobName];
    if (!item) {
      this.logger.warn(`Skipping unknown job: "${name}"`);
      return JobStatus.Skipped;
    }

    return item.handler(data);
  }

  setConcurrency(queueName: QueueName, concurrency: number) {
    const worker = this.workers[queueName];
    if (!worker) {
      this.logger.warn(`Unable to set queue concurrency, worker not found: '${queueName}'`);
      return;
    }

    worker.concurrency = concurrency;
  }

  async isActive(name: QueueName): Promise<boolean> {
    const queue = this.getQueue(name);
    const count = await queue.getActiveCount();
    return count > 0;
  }

  async isPaused(name: QueueName): Promise<boolean> {
    return this.getQueue(name).isPaused();
  }

  pause(name: QueueName) {
    return this.getQueue(name).pause();
  }

  resume(name: QueueName) {
    return this.getQueue(name).resume();
  }

  empty(name: QueueName, delayed = false): Promise<void> {
    return this.getQueue(name).drain(delayed);
  }

  clear(name: QueueName, type: QueueCleanType) {
    return this.getQueue(name).clean(0, 1000, type);
  }

  /** Reconcile every queue's "active" list against its job hashes, dropping orphaned entries. */
  async reconcileOrphanedActiveJobs(): Promise<void> {
    for (const queueName of Object.values(QueueName)) {
      const removed = await this.removeOrphanedActiveJobs(queueName);
      if (removed.length > 0) {
        this.logger.warn(`Removed ${removed.length} orphaned active job(s) from ${queueName}: ${removed.join(', ')}`);
      }
    }
  }

  /**
   * Removes job ids stuck in a queue's BullMQ "active" list that no longer have a backing job hash.
   * These orphans (e.g. removeOnComplete racing stalled-recovery) permanently wedge a concurrency-1
   * queue with no user-reachable recovery. We deliberately do NOT use `clean(0, _, 'active')`, which
   * targets jobs by age and would kill legitimately-running jobs; instead we LREM only ids whose
   * `getJob` returns nothing. A genuine in-flight job always has its hash, so it is never touched.
   * Intended to run at bootstrap, before workers start.
   */
  async removeOrphanedActiveJobs(name: QueueName): Promise<string[]> {
    const queue = this.getQueue(name);
    const activeKey = queue.toKey('active');
    const client = await queue.client;
    const activeIds = await client.lrange(activeKey, 0, -1);

    const removed: string[] = [];
    for (const jobId of activeIds) {
      const job = await queue.getJob(jobId);
      if (!job) {
        // bullmq >=5.80 narrowed `IRedisClient` to just the commands bullmq itself
        // issues, and LREM is not among them. The concrete client is ioredis, so
        // cast to reach it rather than reimplementing LREM via a Lua script.
        await (client as unknown as Pick<Redis, 'lrem'>).lrem(activeKey, 0, jobId);
        removed.push(jobId);
      }
    }
    return removed;
  }

  getJobCounts(name: QueueName): Promise<JobCounts> {
    return this.getQueue(name).getJobCounts(
      'active',
      'completed',
      'failed',
      'delayed',
      'waiting',
      'paused',
    ) as unknown as Promise<JobCounts>;
  }

  /**
   * True when a dedup chain is already running for the space — a pass-scoped follow-up
   * (`space-dedup-<spaceId>-pass-<n>`, n >= 2) is queued, active, delayed, or paused on the
   * FacialRecognition queue. The initial dedup trigger uses the bare `space-dedup-<spaceId>` id,
   * which only de-duplicates concurrent triggers while pass 1 is still in flight; once a chain
   * advances to pass-scoped follow-ups the bare id frees, so the next trigger would otherwise start a
   * parallel chain (doubling work + reviving the removeOnComplete/stalled-recovery orphan race on the
   * shared pass-scoped jobIds). {@link SharedSpaceService.handleSharedSpacePersonDedup} uses this to
   * keep one chain per space. Relies on the FacialRecognition queue being concurrency 1: the gating
   * pass-1 job is the only active dedup job and carries the bare id, never the `-pass-` prefix, so it
   * never matches itself.
   */
  async hasInFlightDedupChain(spaceId: string): Promise<boolean> {
    const prefix = `space-dedup-${spaceId}-pass-`;
    const jobs = await this.getQueue(QueueName.FacialRecognition).getJobs(
      ['active', 'waiting', 'delayed', 'paused'],
      0,
      1000,
      true,
    );
    return jobs.some((job) => job?.id?.startsWith(prefix));
  }

  async getJobTypes(name: QueueName): Promise<JobTypeCounts[]> {
    // Process 'paused' before 'waiting': BullMQ may include the same job in both lists
    // when a queue is paused. ID-based dedup then correctly attributes it to 'paused'.
    const statusOrder = ['active', 'delayed', 'paused', 'waiting'] as const;
    type Status = (typeof statusOrder)[number];

    const results = await Promise.all(
      statusOrder.map(async (status) => ({ status, jobs: await this.getQueue(name).getJobs(status, 0, 1000, true) })),
    );

    const counts = new Map<JobName, JobTypeCounts>();
    const seenJobIds = new Set<string>();

    for (const { status, jobs } of results) {
      for (const job of jobs) {
        if (!job) {
          continue;
        }
        if (job.id) {
          if (seenJobIds.has(job.id)) {
            continue;
          }
          seenJobIds.add(job.id);
        }

        const jobName = job.name as JobName;
        const count = counts.get(jobName) ?? { name: jobName, active: 0, waiting: 0, delayed: 0, paused: 0 };
        count[status as Status]++;
        counts.set(jobName, count);
      }
    }

    return counts.values().toArray();
  }

  async getTelemetryMetrics(now = Date.now()): Promise<QueueTelemetryMetrics> {
    const countStatuses: QueueTelemetryStatus[] = ['active', 'completed', 'failed', 'delayed', 'waiting', 'paused'];
    const stalenessStatuses: QueueTelemetryStalenessStatus[] = ['waiting', 'delayed', 'failed'];
    const counts: QueueTelemetryJobCount[] = [];
    const oldestJobAges: QueueTelemetryOldestJobAge[] = [];

    for (const queue of Object.values(QueueName)) {
      const queueCounts = await this.getJobCounts(queue);
      for (const status of countStatuses) {
        counts.push({ queue, status, count: Number(queueCounts[status] ?? 0) });
      }

      for (const status of stalenessStatuses) {
        const [job] = await this.getQueue(queue).getJobs(status, 0, 0, true);
        oldestJobAges.push({
          queue,
          status,
          ageSeconds: job ? Math.max(0, Math.floor((now - job.timestamp) / 1000)) : 0,
        });
      }
    }

    return { counts, oldestJobAges };
  }

  private getQueueName(name: JobName) {
    return (this.handlers[name] as JobMapItem).queueName;
  }

  async queueAll(items: JobItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const promises = [];
    const itemsByQueue = {} as Record<string, (JobItem & { data: any; options: JobsOptions | undefined })[]>;
    for (const item of items) {
      const queueName = this.getQueueName(item.name);
      const job = {
        name: item.name,
        data: item.data || {},
        options: this.getJobOptions(item) || undefined,
      } as JobItem & { data: any; options: JobsOptions | undefined };

      if (job.options?.jobId || job.options?.deduplication) {
        // need to use add() instead of addBulk() for jobId/deduplication to take effect
        const queue = this.getQueue(queueName);
        if (item.name === JobName.FacialRecognitionQueueAll) {
          const action = await this.prepareFacialRecognitionQueueAll(queue, item.data, job.options);
          if (!action.add) {
            continue;
          }

          job.options = action.options;
        } else if (this.isSharedSpaceFacePipelineJob(item.name) && job.options.jobId) {
          await this.removePausedStableJob(queue, job.options.jobId);
        }

        promises.push(queue.add(item.name, item.data, job.options));
      } else {
        itemsByQueue[queueName] ||= [];
        itemsByQueue[queueName].push(job);
      }
    }

    for (const [queueName, jobs] of Object.entries(itemsByQueue)) {
      const queue = this.getQueue(queueName as QueueName);
      promises.push(queue.addBulk(jobs));
    }

    await Promise.all(promises);
  }

  async queue(item: JobItem): Promise<void> {
    return this.queueAll([item]);
  }

  async waitForQueueCompletion(...queues: QueueName[]): Promise<void> {
    const getPending = async () => {
      const results = await Promise.all(
        queues.map(async (name) => {
          const [counts, paused] = await Promise.all([this.getJobCounts(name), this.isPaused(name)]);
          const pending = counts.active + counts.waiting + counts.delayed + counts.paused;
          return { counts, name, paused, pending };
        }),
      );

      return results.filter(({ pending }) => pending > 0);
    };

    let pending = await getPending();

    while (pending.length > 0) {
      const blocked = pending[0];
      const message =
        `Waiting for ${blocked.name} queue to finish ` +
        `(${blocked.counts.active} active, ${blocked.counts.waiting} waiting, ` +
        `${blocked.counts.delayed} delayed, ${blocked.counts.paused} paused)`;

      if (blocked.paused) {
        this.logger.warn(`${message}; queue is paused`);
      } else {
        this.logger.verbose(`${message}...`);
      }

      await setTimeout(1000);
      pending = await getPending();
    }
  }

  async searchJobs(name: QueueName, dto: QueueJobSearchDto): Promise<QueueJobResponseDto[]> {
    const jobs = await this.getQueue(name).getJobs(dto.status ?? Object.values(QueueJobStatus), 0, 1000);
    return jobs.map((job) => {
      const { id, name, timestamp, data } = job;
      return { id, name: name as JobName, timestamp, data };
    });
  }

  private getJobOptions(item: JobItem): JobsOptions | null {
    switch (item.name) {
      case JobName.NotifyAlbumUpdate: {
        return {
          jobId: `${item.data.id}/${item.data.recipientId}`,
          delay: item.data?.delay,
        };
      }
      case JobName.StorageTemplateMigrationSingle: {
        return { jobId: item.data.id };
      }
      case JobName.PersonGenerateThumbnail: {
        return { priority: 1 };
      }
      case JobName.FacialRecognitionQueueAll: {
        return { jobId: JobName.FacialRecognitionQueueAll, removeOnComplete: true };
      }
      case JobName.FaceIdentityBackfill: {
        const data = item.data as { stage?: string; cursor?: string; continuationId?: string };
        if (data.cursor) {
          return { jobId: `face-identity-backfill/${data.stage ?? 'person'}/${data.cursor}`, removeOnFail: true };
        }
        if (data.continuationId) {
          return { jobId: `face-identity-backfill/continuation/${data.continuationId}`, removeOnFail: true };
        }
        return { jobId: 'face-identity-backfill/root', removeOnFail: true, removeOnComplete: true };
      }
      case JobName.FaceIdentityMaintenanceAfterRecognition: {
        const data = item.data as { delay?: number };
        if (data.delay !== undefined) {
          return { delay: data.delay, removeOnFail: true };
        }
        return { jobId: 'face-identity-maintenance-after-recognition', removeOnFail: true };
      }
      case JobName.VersionCheck: {
        return { deduplication: { id: JobName.VersionCheck } };
      }
      case JobName.DatabaseBackup: {
        return { deduplication: { id: JobName.DatabaseBackup } };
      }
      case JobName.SharedSpaceBulkAddAssets: {
        return { jobId: `bulk-add-${item.data.spaceId}-${item.data.userId}` };
      }
      case JobName.SharedSpaceAlbumGrantReconcile: {
        const data = item.data as { albumIds: string[] };
        return {
          jobId: `space-album-grant-reconcile-${[...data.albumIds].sort().join(',')}`,
          removeOnComplete: true,
          // M6: a hard failure must not leave a permanently-failed job occupying this dedup jobId —
          // that would silently block every future reconcile for the same album set.
          removeOnFail: true,
        };
      }
      case JobName.SharedSpaceAlbumGrantReconcileSweep: {
        // L8: single stable jobId — a nightly trigger while a previous run is still active is a
        // harmless dedup, and removeOnFail keeps a hard failure from blocking the next run.
        return { jobId: 'space-album-grant-reconcile-sweep', removeOnComplete: true, removeOnFail: true };
      }
      case JobName.SharedSpaceFaceMatch: {
        const prefix =
          item.data.source === 'identity-backfill'
            ? 'shared-space-face-match/identity-backfill'
            : 'shared-space-face-match';
        return {
          jobId: `${prefix}/${item.data.spaceId}/${item.data.assetId}`,
          removeOnComplete: true,
        };
      }
      case JobName.SharedSpaceFaceMatchFromBackfill: {
        return {
          jobId: `shared-space-face-match/from-backfill/${item.data.spaceId}/${item.data.assetId}`,
          removeOnComplete: true,
        };
      }
      case JobName.SharedSpaceFaceMatchAll: {
        return {
          jobId: `shared-space-face-match-all/${item.data.spaceId}`,
          removeOnComplete: true,
          // M6: same rationale as SharedSpaceAlbumGrantReconcile — a failed run must not
          // permanently occupy the per-space dedup jobId and block later re-projection.
          removeOnFail: true,
        };
      }
      case JobName.SharedSpaceFaceMatchPage: {
        const data = item.data as { spaceId: string; afterAssetId?: string };
        const cursor = data.afterAssetId ? `after/${data.afterAssetId}` : 'start';
        return {
          jobId: `shared-space-face-match-page/${data.spaceId}/${cursor}`,
          removeOnComplete: true,
        };
      }
      case JobName.SharedSpacePersonDedup: {
        // Follow-up passes (pass >= 2) use a pass-scoped jobId so they enqueue even while the
        // current dedup job is still "active" (the base jobId stays occupied until the handler
        // returns). The initial trigger (no pass) keeps the bare jobId so concurrent external
        // triggers still dedupe into one.
        const pass = (item.data as { pass?: number }).pass;
        const jobId =
          pass && pass > 1 ? `space-dedup-${item.data.spaceId}-pass-${pass}` : `space-dedup-${item.data.spaceId}`;
        return { jobId, removeOnComplete: true };
      }
      case JobName.SharedSpaceIdentityReconciliation: {
        const data = item.data as { spaceId: string; userId?: string; spacePersonId?: string };
        return {
          jobId: `space-identity-reconcile-${data.spaceId}-${data.userId ?? 'all-members'}-${data.spacePersonId ?? 'all-people'}`,
          removeOnComplete: true,
        };
      }
      case JobName.SharedSpacePersonMetadataBackfill: {
        const data = item.data as { identityId?: string; cursor?: string };
        const scope = data.identityId ? `identity/${data.identityId}` : 'all';
        if (data.cursor) {
          return { jobId: `shared-space-person-metadata-backfill/${scope}/${data.cursor}`, removeOnFail: true };
        }
        return { jobId: `shared-space-person-metadata-backfill/${scope}`, removeOnFail: true };
      }
      default: {
        return null;
      }
    }
  }

  private async removeFailedStableJob(queue: Queue, jobId: string) {
    const existingJob = await queue.getJob(jobId);
    if (!existingJob) {
      return;
    }

    const state = (await existingJob.getState()) as string;
    if (state === 'failed') {
      await existingJob.remove();
    }
  }

  private async removePausedStableJob(queue: Queue, jobId: string) {
    const existingJob = await queue.getJob(jobId);
    if (!existingJob) {
      return;
    }

    const state = (await existingJob.getState()) as string;
    if (state === 'paused') {
      await existingJob.remove();
    }
  }

  private isSharedSpaceFacePipelineJob(name: JobName): boolean {
    return [
      JobName.SharedSpaceFaceMatch,
      JobName.SharedSpaceFaceMatchAll,
      JobName.SharedSpaceFaceMatchPage,
      JobName.SharedSpaceFaceMatchFromBackfill,
    ].includes(name);
  }

  private async prepareFacialRecognitionQueueAll(
    queue: Queue,
    data: JobOf<JobName.FacialRecognitionQueueAll>,
    options: JobsOptions,
  ): Promise<{ add: true; options: JobsOptions } | { add: false }> {
    const existingJob = await queue.getJob(JobName.FacialRecognitionQueueAll);
    if (!existingJob) {
      if (data.force === true) {
        const forceFollowUpJob = await queue.getJob(FORCE_FACIAL_RECOGNITION_QUEUE_ALL_JOB_ID);
        if (forceFollowUpJob) {
          const forceFollowUpState = (await forceFollowUpJob.getState()) as string;
          if (forceFollowUpState === 'active' && forceFollowUpJob.data?.force === true) {
            return { add: false };
          }
        }

        await queue.drain(true);
      }
      return { add: true, options };
    }

    const state = (await existingJob.getState()) as string;
    if (state === 'failed') {
      await existingJob.remove();
      if (data.force === true) {
        await queue.drain(true);
      }
      return { add: true, options };
    }

    if (data.force !== true) {
      return { add: true, options };
    }

    if (['waiting', 'delayed', 'paused'].includes(state)) {
      await existingJob.remove();
      await queue.drain(true);
      return { add: true, options };
    }

    if (state === 'active') {
      if (existingJob.data?.force === true) {
        return { add: false };
      }

      await queue.drain(true);
      const forceOptions = { ...options, jobId: FORCE_FACIAL_RECOGNITION_QUEUE_ALL_JOB_ID };
      await this.removeFailedStableJob(queue, FORCE_FACIAL_RECOGNITION_QUEUE_ALL_JOB_ID);
      return { add: true, options: forceOptions };
    }

    return { add: true, options };
  }

  private getQueue(queue: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(queue), { strict: false });
  }

  /** @deprecated */
  // todo: remove this when asset notifications no longer need it.
  public async removeJob(name: JobName, jobID: string): Promise<void> {
    const existingJob = await this.getQueue(this.getQueueName(name)).getJob(jobID);
    if (existingJob) {
      await existingJob.remove();
    }
  }
}
