import { ModuleRef } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobName, QueueName } from 'src/enum.js';
import {
  QueueMaintenanceRepository,
  buildWorkerOptions,
} from 'src/gallery/repositories/queue-maintenance.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

const setup = () => {
  const queue = {
    getJob: vi.fn().mockResolvedValue(void 0),
    getJobCounts: vi.fn(),
    getJobs: vi.fn().mockResolvedValue([]),
  };
  const moduleRef = { get: vi.fn().mockReturnValue(queue) } as unknown as ModuleRef;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as LoggingRepository;
  const sut = new QueueMaintenanceRepository(moduleRef, logger);

  return { sut, queue, logger };
};

const stubActiveList = (queue: ReturnType<typeof setup>['queue'], activeIds: string[]) => {
  const client = {
    exists: vi.fn().mockResolvedValue(0),
    lrange: vi.fn().mockResolvedValue(activeIds),
    lrem: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
  };
  (queue as any).client = Promise.resolve(client);
  (queue as any).toKey = vi.fn((type: string) => `immich_bull:facialRecognition:${type}`);
  return client;
};

const failedJob = (id: string) => ({ id, remove: vi.fn().mockResolvedValue(void 0) });

describe(QueueMaintenanceRepository.name, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildWorkerOptions', () => {
    it('gives the FacialRecognition queue a lock and stalled interval well above the 30s default', () => {
      const options = buildWorkerOptions({ prefix: 'immich_bull' } as any, QueueName.FacialRecognition);

      expect(options.concurrency).toBe(1);
      expect(options.prefix).toBe('immich_bull');
      // Long handlers (face-match-all, identity reconciliation, a dedup pass on a huge space) must
      // not be declared stalled and orphaned while still healthy.
      expect(options.lockDuration ?? 0).toBeGreaterThanOrEqual(120_000);
      expect(options.stalledInterval ?? 0).toBeGreaterThanOrEqual(120_000);
    });

    it('leaves other queues on BullMQ lock defaults', () => {
      const options = buildWorkerOptions({ prefix: 'immich_bull' } as any, QueueName.ThumbnailGeneration);

      expect(options.concurrency).toBe(1);
      expect(options.prefix).toBe('immich_bull');
      expect(options.lockDuration).toBeUndefined();
      expect(options.stalledInterval).toBeUndefined();
    });
  });

  describe('hasInFlightDedupChain', () => {
    it('returns true when a pass-scoped follow-up exists for the space', async () => {
      const { sut, queue } = setup();
      queue.getJobs.mockResolvedValue([{ id: 'space-dedup-space-1-pass-5' }] as any);

      await expect(sut.hasInFlightDedupChain('space-1')).resolves.toBe(true);
    });

    it('returns false when only the bare initial job exists (no follow-up yet)', async () => {
      const { sut, queue } = setup();
      queue.getJobs.mockResolvedValue([{ id: 'space-dedup-space-1' }] as any);

      await expect(sut.hasInFlightDedupChain('space-1')).resolves.toBe(false);
    });

    it("does not match a different space's chain", async () => {
      const { sut, queue } = setup();
      queue.getJobs.mockResolvedValue([{ id: 'space-dedup-space-2-pass-3' }] as any);

      await expect(sut.hasInFlightDedupChain('space-1')).resolves.toBe(false);
    });
  });

  // The bootstrap reconcile (QueueService.onBootstrap) runs the same removeDanglingActiveJobs that
  // waitForQueueCompletion and searchJobs use, but ignores the lock: no worker runs yet, so a lock left
  // by a crashed process (up to 5 min on FacialRecognition) must not keep the dangling id.
  describe('reconcileOrphanedActiveJobs', () => {
    it('removes active ids whose job hash and lock are both gone, from the active list and the stalled set', async () => {
      const { sut, queue, logger } = setup();
      const client = stubActiveList(queue, ['orphan-1', 'real-1']);
      // A real active job still has its hash; an orphan's hash was removed (e.g. removeOnComplete
      // racing stalled-recovery) leaving a dangling id that wedges the concurrency-1 queue.
      client.exists.mockImplementation((key: string) =>
        Promise.resolve(key === 'immich_bull:facialRecognition:real-1' ? 1 : 0),
      );

      await sut.reconcileOrphanedActiveJobs();

      expect(client.lrem).toHaveBeenCalledWith('immich_bull:facialRecognition:active', 0, 'orphan-1');
      expect(client.lrem).not.toHaveBeenCalledWith('immich_bull:facialRecognition:active', 0, 'real-1');
      expect(client.srem).toHaveBeenCalledWith('immich_bull:facialRecognition:stalled', 'orphan-1');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Removed 1 dangling active job id from '));
    });

    it('removes an active id whose hash is gone even when its lock is still held', async () => {
      const { sut, queue } = setup();
      const client = stubActiveList(queue, ['locked-1']);
      client.exists.mockImplementation((key: string) =>
        Promise.resolve(key === 'immich_bull:facialRecognition:locked-1:lock' ? 1 : 0),
      );

      await sut.reconcileOrphanedActiveJobs();

      expect(client.lrem).toHaveBeenCalledWith('immich_bull:facialRecognition:active', 0, 'locked-1');
      expect(client.srem).toHaveBeenCalledWith('immich_bull:facialRecognition:stalled', 'locked-1');
    });

    it('keeps that id on the runtime repair, where a running worker may hold the lock', async () => {
      const { sut, queue } = setup();
      const client = stubActiveList(queue, ['locked-1']);
      client.exists.mockImplementation((key: string) =>
        Promise.resolve(key === 'immich_bull:facialRecognition:locked-1:lock' ? 1 : 0),
      );
      queue.getJobCounts.mockResolvedValue({ active: 1 });

      await sut.getJobCountsWithRepair(QueueName.FacialRecognition);

      expect(client.lrem).not.toHaveBeenCalled();
      expect(client.srem).not.toHaveBeenCalled();
    });

    it('checks every queue and does nothing when the active lists are empty', async () => {
      const { sut, queue, logger } = setup();
      const client = stubActiveList(queue, []);

      await sut.reconcileOrphanedActiveJobs();

      expect(client.lrange).toHaveBeenCalledTimes(Object.values(QueueName).length);
      expect(client.lrem).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('removeFailedJobsByJobIdPrefix', () => {
    it('removes only the failed jobs whose id matches a prefix and reports the count', async () => {
      const { sut, queue } = setup();
      const blocked = failedJob('shared-space-face-match/from-backfill/space-1/asset-1');
      const reconcile = failedJob('space-identity-reconcile-space-1-all-members-all-people');
      const unrelated = failedJob('face-identity-backfill/root');
      const anonymous = { remove: vi.fn().mockResolvedValue(void 0) };
      queue.getJobs.mockResolvedValueOnce([blocked, unrelated, reconcile, anonymous] as any);

      const removed = await sut.removeFailedJobsByJobIdPrefix(QueueName.PeopleBackfill, [
        'shared-space-face-match',
        'space-identity-reconcile-',
      ]);

      expect(removed).toBe(2);
      expect(queue.getJobs).toHaveBeenCalledWith(['failed'], 0, 999);
      expect(blocked.remove).toHaveBeenCalled();
      expect(reconcile.remove).toHaveBeenCalled();
      expect(unrelated.remove).not.toHaveBeenCalled();
    });

    it('walks every page of the failed set before removing so shifting ranks cannot skip jobs', async () => {
      const { sut, queue } = setup();
      const firstPageMatch = failedJob('shared-space-face-match/space-1/asset-1');
      const firstPage = [firstPageMatch, ...Array.from({ length: 999 }, (_, i) => failedJob(`unrelated-${i}`))];
      const secondPageMatch = failedJob('shared-space-face-match/space-1/asset-2');
      queue.getJobs.mockResolvedValueOnce(firstPage as any).mockResolvedValueOnce([secondPageMatch] as any);

      const removed = await sut.removeFailedJobsByJobIdPrefix(QueueName.FacialRecognition, ['shared-space-face-match']);

      expect(removed).toBe(2);
      expect(queue.getJobs).toHaveBeenCalledWith(['failed'], 0, 999);
      expect(queue.getJobs).toHaveBeenCalledWith(['failed'], 1000, 1999);
      expect(firstPageMatch.remove).toHaveBeenCalled();
      expect(secondPageMatch.remove).toHaveBeenCalled();
    });
  });

  it('returns queue counts and oldest job ages', async () => {
    const { sut, queue } = setup();
    const now = new Date('2026-04-25T12:00:00Z').getTime();
    queue.getJobCounts.mockResolvedValue({
      active: 1,
      completed: 2,
      failed: 3,
      delayed: 4,
      waiting: 5,
      paused: 6,
    });
    queue.getJobs.mockResolvedValue([{ timestamp: now - 120_000 }]);

    const result = await sut.getTelemetryMetrics(now);

    expect(result.counts).toEqual(
      expect.arrayContaining([
        { queue: QueueName.ThumbnailGeneration, status: 'active', count: 1 },
        { queue: QueueName.ThumbnailGeneration, status: 'completed', count: 2 },
        { queue: QueueName.ThumbnailGeneration, status: 'failed', count: 3 },
        { queue: QueueName.ThumbnailGeneration, status: 'delayed', count: 4 },
        { queue: QueueName.ThumbnailGeneration, status: 'waiting', count: 5 },
        { queue: QueueName.ThumbnailGeneration, status: 'paused', count: 6 },
      ]),
    );
    expect(result.oldestJobAges).toEqual(
      expect.arrayContaining([
        { queue: QueueName.ThumbnailGeneration, status: 'waiting', ageSeconds: 120 },
        { queue: QueueName.ThumbnailGeneration, status: 'delayed', ageSeconds: 120 },
        { queue: QueueName.ThumbnailGeneration, status: 'failed', ageSeconds: 120 },
      ]),
    );
    expect(queue.getJobs).toHaveBeenCalledWith('waiting', 0, 0, true);
    expect(queue.getJobs).toHaveBeenCalledWith('delayed', 0, 0, true);
    expect(queue.getJobs).toHaveBeenCalledWith('failed', 0, 0, true);
  });

  it('returns job type counts sampled from active and pending queue jobs', async () => {
    const { sut, queue } = setup();
    queue.getJobs.mockImplementation((status) => {
      const jobs = {
        active: [{ name: JobName.SharedSpaceFaceMatchPage }, { name: JobName.SharedSpaceFaceMatchPage }],
        waiting: [{ name: JobName.SharedSpaceFaceMatchPage }, { name: JobName.FacialRecognition }],
        delayed: [{ name: JobName.FacialRecognition }],
        paused: [{ name: JobName.FaceIdentityBackfill }],
      } as Record<string, Array<{ name: JobName }>>;

      return Promise.resolve(jobs[status] ?? []);
    });

    const result = await sut.getJobTypes(QueueName.FacialRecognition);

    expect(result).toEqual([
      { name: JobName.SharedSpaceFaceMatchPage, active: 2, waiting: 1, delayed: 0, paused: 0 },
      { name: JobName.FacialRecognition, active: 0, waiting: 1, delayed: 1, paused: 0 },
      { name: JobName.FaceIdentityBackfill, active: 0, waiting: 0, delayed: 0, paused: 1 },
    ]);
    expect(queue.getJobs).toHaveBeenCalledWith('active', 0, 1000, true);
    expect(queue.getJobs).toHaveBeenCalledWith('waiting', 0, 1000, true);
    expect(queue.getJobs).toHaveBeenCalledWith('delayed', 0, 1000, true);
    expect(queue.getJobs).toHaveBeenCalledWith('paused', 0, 1000, true);
  });

  it('does not double-count paused jobs that BullMQ also returns as waiting jobs', async () => {
    const { sut, queue } = setup();
    const pausedJob = { id: 'paused-job-1', name: JobName.FaceIdentityBackfill };
    queue.getJobs.mockImplementation((status) => {
      const jobs = {
        active: [],
        waiting: [pausedJob],
        delayed: [],
        paused: [pausedJob],
      } as Record<string, Array<typeof pausedJob>>;

      return Promise.resolve(jobs[status] ?? []);
    });

    await expect(sut.getJobTypes(QueueName.FacialRecognition)).resolves.toEqual([
      { name: JobName.FaceIdentityBackfill, active: 0, waiting: 0, delayed: 0, paused: 1 },
    ]);
  });
});
