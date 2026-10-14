import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Queue } from 'bullmq';
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
      if (job) {
        continue;
      }

      // bullmq >=5.80 narrowed `IRedisClient` to just the commands bullmq itself
      // issues, and LREM is not among them. The concrete client is ioredis, so
      // cast to reach it rather than reimplementing LREM via a Lua script.
      await (client as unknown as Pick<Redis, 'lrem'>).lrem(activeKey, 0, jobId);
      removed.push(jobId);
    }
    return removed;
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
