import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Queue } from 'bullmq';
import { setTimeout } from 'node:timers/promises';
import type { Redis } from 'ioredis';
import type { JobCounts, JobTypeCounts } from 'src/types.js';
import { JobName, QueueName } from 'src/enum.js';
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
      await this.removeDanglingActiveJobs(queueName);
    }
  }

  async removeDanglingActiveJobs(name: QueueName): Promise<void> {
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
      if (jobExists > 0 || lockExists > 0) {
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

  private getQueue(queue: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(queue), { strict: false });
  }
}
