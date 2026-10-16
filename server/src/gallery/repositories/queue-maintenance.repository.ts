import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JobsOptions, Queue, WorkerOptions } from 'bullmq';
import { setTimeout } from 'node:timers/promises';
import type { Redis } from 'ioredis';
import type { JobCounts, JobItem, JobOf, JobTypeCounts } from 'src/types.js';
import { ImmichWorker, JobName, QueueName } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

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

export interface WaitForQueueCompletionOptions {
  /** S9 (F19): give up waiting after this many milliseconds instead of polling forever. */
  timeoutMs?: number;
}

export interface QueueTelemetryMetrics {
  counts: QueueTelemetryJobCount[];
  oldestJobAges: QueueTelemetryOldestJobAge[];
}

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

// Fork-only BullMQ queue repair and inspection, kept out of the upstream JobRepository.
@Injectable()
export class QueueMaintenanceRepository {
  constructor(
    private moduleRef: ModuleRef,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(QueueMaintenanceRepository.name);
  }

  /**
   * Reconcile every queue's "active" list against its job hashes, dropping orphaned entries. Such
   * orphans (e.g. removeOnComplete racing stalled-recovery) permanently wedge a concurrency-1 queue
   * with no user-reachable recovery. Intended to run at bootstrap, before workers start.
   */
  async reconcileOrphanedActiveJobs(): Promise<void> {
    for (const queueName of Object.values(QueueName)) {
      // No worker runs yet, so a surviving lock is a crashed process's (up to 5 min on FacialRecognition).
      await this.removeDanglingActiveJobs(queueName, { ignoreLock: true });
    }
  }

  async removeDanglingActiveJobs(name: QueueName, { ignoreLock = false } = {}): Promise<void> {
    const queue = this.getQueue(name);
    const client = await queue.client;
    const activeKey = queue.toKey('active');
    const activeJobIds = [...new Set(await client.lrange(activeKey, 0, -1))];
    if (activeJobIds.length === 0) {
      return;
    }

    // bullmq >=5.80 narrowed `IRedisClient` to just the commands bullmq itself issues; EXISTS, LREM
    // and SREM are not among them. The concrete client is ioredis, so cast to reach them.
    const redis = client as unknown as Pick<Redis, 'exists' | 'lrem' | 'srem'>;

    const removedIds: string[] = [];
    let removedCount = 0;
    for (const jobId of activeJobIds) {
      const jobKey = queue.toKey(jobId);
      const lockKey = `${jobKey}:lock`;
      const [jobExists, lockExists] = await Promise.all([redis.exists(jobKey), redis.exists(lockKey)]);
      if (jobExists > 0 || (!ignoreLock && lockExists > 0)) {
        continue;
      }

      const removed = await redis.lrem(activeKey, 0, jobId);
      if (!(removed > 0)) {
        continue;
      }

      removedCount += removed;
      removedIds.push(jobId);
      await redis.srem(queue.toKey('stalled'), jobId);
    }

    // eslint-disable-next-line unicorn/prefer-early-return
    if (removedCount > 0) {
      const sampleIds = removedIds.slice(0, 5).join(', ');
      const suffix = removedIds.length > 5 ? `${sampleIds}, ...` : sampleIds;
      this.logger.warn(
        `Removed ${removedCount} dangling active job id${removedCount === 1 ? '' : 's'} from ${name}: ${suffix}`,
      );
    }
  }

  /**
   * Slice 14 (fork isolation): `getJobCounts` is a pure delegate upstream — every read-only caller
   * (the admin queue poll in queue.service.ts, media.service.ts, person.service.ts's recognition-queue
   * checks, storage-migration.service.ts, and this repository's own getTelemetryMetrics) expects a read
   * that never mutates Redis. `removeDanglingActiveJobs` used to run unconditionally inside
   * `getJobCounts`, so those upstream call paths silently wrote to Redis on every poll.
   *
   * This variant carries that repair. `waitForQueueCompletion` is the one caller that genuinely needs
   * it: it blocks in a loop deciding whether a queue (including the fork's PeopleBackfill, where the
   * dangling-active-entry bug this repair fixes was originally found — see the "fix(server): clean
   * dangling active queue entries" commit) has actually drained, and a dangling active entry with no
   * backing job hash would otherwise read as perpetually "still active." A blocking wait loop paying for
   * an extra bounded Redis scan per poll is a reasonable trade against a passive per-request read paying
   * the same cost for no benefit.
   */
  async getJobCountsWithRepair(name: QueueName): Promise<JobCounts> {
    await this.removeDanglingActiveJobs(name);
    return this.getJobCounts(name);
  }

  private getJobCounts(name: QueueName): Promise<JobCounts> {
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
   * S9 (F19): the trailing-options form keeps every existing call site's variadic syntax
   * (`waitForQueueCompletion(a, b, c)`) byte-identical — only a caller that explicitly appends a
   * trailing options object opts into the bounded wait. Without `timeoutMs` this is the original
   * unbounded `while (pending.length > 0)` poll; with it, a forced recognition run that gives up
   * waiting still proceeds instead of parking indefinitely while F17/F18's suggestion sweep keeps
   * the PeopleBackfill queue busy.
   */
  async waitForQueueCompletion(
    ...args: [...queues: QueueName[]] | [...queues: QueueName[], options: WaitForQueueCompletionOptions]
  ): Promise<void> {
    const maybeOptions = args.at(-1);
    const hasOptions = typeof maybeOptions === 'object' && maybeOptions !== null;
    const { timeoutMs } = hasOptions ? (maybeOptions as WaitForQueueCompletionOptions) : {};
    const queues = (hasOptions ? args.slice(0, -1) : args) as QueueName[];

    const getPending = async () => {
      const results = await Promise.all(
        queues.map(async (name) => {
          // Slice 14: the repairing variant. This loop decides whether a queue has actually drained, and
          // a dangling active entry with no backing job hash (the bug getJobCountsWithRepair fixes) would
          // otherwise read as perpetually "still active" — see the comment on getJobCountsWithRepair.
          const [counts, paused] = await Promise.all([
            this.getJobCountsWithRepair(name),
            this.getQueue(name).isPaused(),
          ]);
          const pending = counts.active + counts.waiting + counts.delayed + counts.paused;
          return { counts, name, paused, pending };
        }),
      );

      return results.filter(({ pending }) => pending > 0);
    };

    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    let pending = await getPending();

    while (pending.length > 0) {
      if (deadline !== undefined && Date.now() >= deadline) {
        const names = pending.map(({ name }) => name).join(', ');
        this.logger.warn(
          `Gave up waiting for ${names} queue(s) to finish after ${timeoutMs}ms; proceeding without waiting`,
        );
        return;
      }

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

  /**
   * Removes failed jobs whose jobId starts with one of the given prefixes. Stable-jobId jobs that
   * failed while `removeOnFail` was unset permanently occupy their dedup jobIds — BullMQ silently
   * ignores any later add() with the same id, blocking every re-queue of that work. Collects all
   * matches before removing anything: removal shifts the failed set's ranks, so a
   * remove-while-paging walk would skip entries.
   */
  async removeFailedJobsByJobIdPrefix(name: QueueName, prefixes: string[]): Promise<number> {
    const queue = this.getQueue(name);
    const pageSize = 1000;
    const matches = [];
    for (let start = 0; ; start += pageSize) {
      const jobs = await queue.getJobs(['failed'], start, start + pageSize - 1);
      matches.push(...jobs.filter((job) => job?.id && prefixes.some((prefix) => job.id!.startsWith(prefix))));
      if (jobs.length < pageSize) {
        break;
      }
    }

    for (const job of matches) {
      await job.remove();
    }
    return matches.length;
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
      const queueCounts = (await this.getQueue(queue).getJobCounts(
        'active',
        'completed',
        'failed',
        'delayed',
        'waiting',
        'paused',
      )) as unknown as JobCounts;
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

  /** Gallery job options, consulted before upstream's switch; null leaves the job to upstream. */
  getJobOptions(item: JobItem): JobsOptions | null {
    switch (item.name) {
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
      case JobName.FaceSuggestionMaintenance: {
        return { jobId: 'face-suggestion-maintenance', removeOnComplete: true, removeOnFail: true };
      }
      case JobName.PersonSuggestionScanQueueAll: {
        return { jobId: 'person-suggestion-scan/all', removeOnComplete: true, removeOnFail: true };
      }
      case JobName.SpacePersonSuggestionScanQueueAll: {
        return { jobId: 'space-person-suggestion-scan/all', removeOnComplete: true, removeOnFail: true };
      }
      case JobName.PersonSuggestionScan: {
        // S9.8: a per-id jobId so a re-entrant QueueAll sweep (F18 — FaceIdentityBackfill re-queues
        // both QueueAll jobs on every drain) coalesces onto the in-flight job for the same person
        // instead of stacking a duplicate on the concurrency-1 PeopleBackfill queue.
        //
        // H8: removeOnFail, unlike before — without it a failed run permanently occupies this stable
        // dedup jobId (see removeFailedJobsByJobIdPrefix's doc comment above) and every later add() for
        // that person is silently dropped, so their suggestion queue never refills.
        return { jobId: `person-suggestion-scan/${item.data.id}`, removeOnComplete: true, removeOnFail: true };
      }
      case JobName.SpacePersonSuggestionScan: {
        // H8: see PersonSuggestionScan above — same stuck-dedup-jobId hazard, same fix.
        return { jobId: `space-person-suggestion-scan/${item.data.id}`, removeOnComplete: true, removeOnFail: true };
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
      case JobName.SharedSpaceIdentityReconciliationSweep: {
        // Single stable jobId — a nightly trigger while a previous sweep is still active dedups
        // harmlessly, and removeOnFail keeps a hard failure from blocking the next run.
        return { jobId: 'shared-space-identity-reconciliation-sweep', removeOnComplete: true, removeOnFail: true };
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
      case JobName.FaceRepairScan: {
        // Fixed jobId so BullMQ dedupes concurrent scan enqueues into one (single-flight, complementing the DB
        // partial unique index). removeOnComplete/Fail frees the id once the scan finishes so the next can run.
        return { jobId: JobName.FaceRepairScan, removeOnComplete: true, removeOnFail: true };
      }
      default: {
        return null;
      }
    }
  }

  /**
   * Fork pre-add step for jobs added one by one (jobId/deduplication). Returns the options to add the
   * job with, or undefined when the job must not be added.
   */
  async prepareStableJobAdd(
    queueName: QueueName,
    item: JobItem,
    options: JobsOptions,
  ): Promise<JobsOptions | undefined> {
    const queue = this.getQueue(queueName);
    if (item.name === JobName.FacialRecognitionQueueAll) {
      const action = await this.prepareFacialRecognitionQueueAll(queue, item.data, options);
      if (!action.add) {
        return;
      }

      return action.options;
    }
    if (this.isSharedSpaceFacePipelineJob(item.name) && options.jobId) {
      await this.removePausedStableJob(queue, options.jobId);
    }

    return options;
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
}
