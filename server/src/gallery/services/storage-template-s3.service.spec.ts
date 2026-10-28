import type { JobItem, SystemMetadata } from 'src/types.js';
import { DatabaseLock, JobName, JobStatus, QueueName, SystemMetadataKey } from 'src/enum.js';
import { StorageTemplateS3Service } from 'src/gallery/services/storage-template-s3.service.js';
import { storageBackends } from 'src/gallery/utils/storage-backends.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

type S3State = SystemMetadata[SystemMetadataKey.StorageTemplateS3State];

describe(StorageTemplateS3Service.name, () => {
  let sut: StorageTemplateS3Service;
  let mocks: ServiceMocks;
  let previousS3Backend: unknown;

  const decidedAt = '2026-10-20T08:00:00.000Z';
  const now = new Date('2026-10-21T09:00:00.000Z');

  // system_metadata as a store: the saved config, and the state row this service decides and clears
  let systemConfig: object;
  let s3State: S3State | null;

  const mockSystemMetadata = () => {
    mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) => {
      if (key === SystemMetadataKey.SystemConfig) {
        return Promise.resolve(systemConfig as any);
      }
      return Promise.resolve((key === SystemMetadataKey.StorageTemplateS3State ? s3State : null) as any);
    });
    mocks.systemMetadata.set.mockImplementation((key, value) => {
      if (key === SystemMetadataKey.StorageTemplateS3State) {
        s3State = value as S3State;
      }
      return Promise.resolve();
    });
  };

  const stateReads = () =>
    mocks.systemMetadata.get.mock.calls.filter(([key]) => key === SystemMetadataKey.StorageTemplateS3State).length;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(StorageTemplateS3Service));
    previousS3Backend = (storageBackends as any).s3Backend;
  });

  afterEach(() => {
    (storageBackends as any).s3Backend = previousS3Backend;
    vi.useRealTimers();
  });

  describe('onBootstrap', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      systemConfig = { storageTemplate: { enabled: true } };
      s3State = null;
      mockSystemMetadata();
      mocks.storageMigration.hasS3Originals.mockResolvedValue(true);
    });

    it('should decide pending on an upgrade with originals in S3 and the template enabled, and warn', async () => {
      await sut.onBootstrap();

      expect(mocks.storageMigration.hasS3Originals).toHaveBeenCalledOnce();
      expect(mocks.systemMetadata.set).toHaveBeenCalledExactlyOnceWith(SystemMetadataKey.StorageTemplateS3State, {
        pending: true,
        decidedAt: now.toISOString(),
      });
      expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('until an admin runs Storage Template Migration'),
      );
    });

    it('should decide under the template lock, keeping a decision another worker made while it waited', async () => {
      mocks.database.withLock.mockImplementation((_lock, fn) => {
        // the other worker decided first, and since accepted an S3 upload this worker must not count
        s3State = { pending: false, decidedAt: '2026-01-01T00:00:00.000Z' };
        return fn();
      });

      await sut.onBootstrap();

      expect(mocks.database.withLock).toHaveBeenCalledExactlyOnceWith(
        DatabaseLock.StorageTemplateMigration,
        expect.any(Function),
      );
      expect(mocks.storageMigration.hasS3Originals).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should not take the lock once the state is decided', async () => {
      s3State = { pending: true, decidedAt: '2026-01-01T00:00:00.000Z' };

      await sut.onBootstrap();

      expect(mocks.database.withLock).not.toHaveBeenCalled();
    });

    it('should decide not pending when no original is in S3', async () => {
      mocks.storageMigration.hasS3Originals.mockResolvedValue(false);

      await sut.onBootstrap();

      expect(mocks.storageMigration.hasS3Originals).toHaveBeenCalledOnce();
      expect(mocks.systemMetadata.set).toHaveBeenCalledExactlyOnceWith(SystemMetadataKey.StorageTemplateS3State, {
        pending: false,
        decidedAt: now.toISOString(),
      });
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    // enabling the template later is the admin's own choice, so originals already in S3 do not make it wait
    it.each([
      { label: 'disabled', config: { storageTemplate: { enabled: false } } },
      { label: 'left at its default', config: {} },
    ])('should decide not pending with the template $label, without looking for S3 originals', async ({ config }) => {
      systemConfig = config;

      await sut.onBootstrap();

      expect(mocks.storageMigration.hasS3Originals).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledExactlyOnceWith(SystemMetadataKey.StorageTemplateS3State, {
        pending: false,
        decidedAt: now.toISOString(),
      });
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'pending', state: { pending: true, decidedAt } },
      { label: 'decided not pending', state: { pending: false, decidedAt } },
      { label: 'cleared', state: { pending: false, decidedAt, clearedAt: '2026-10-20T12:00:00.000Z' } },
    ])('should keep an existing $label state without deciding again', async ({ state }) => {
      s3State = state;
      // a later start sees the template disabled and no S3 originals: neither is consulted
      systemConfig = { storageTemplate: { enabled: false } };
      mocks.storageMigration.hasS3Originals.mockResolvedValue(false);

      await sut.onBootstrap();

      expect(stateReads()).toBe(1);
      expect(mocks.systemMetadata.get).not.toHaveBeenCalledWith(SystemMetadataKey.SystemConfig);
      expect(mocks.storageMigration.hasS3Originals).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(s3State).toBe(state);
    });

    it('should warn on every start while pending', async () => {
      await sut.onBootstrap();
      await sut.onBootstrap();
      await sut.onBootstrap();

      expect(mocks.storageMigration.hasS3Originals).toHaveBeenCalledOnce();
      expect(mocks.systemMetadata.set).toHaveBeenCalledOnce();
      expect(mocks.logger.warn).toHaveBeenCalledTimes(3);
    });

    it.each([
      { label: 'decided not pending', state: { pending: false, decidedAt } },
      { label: 'cleared', state: { pending: false, decidedAt, clearedAt: '2026-10-20T12:00:00.000Z' } },
    ])('should not warn on a start once the state is $label', async ({ state }) => {
      s3State = state;

      await sut.onBootstrap();
      await sut.onBootstrap();

      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('onJobSuccess', () => {
    const bulkJob: JobItem = { name: JobName.StorageTemplateMigration };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      systemConfig = { storageTemplate: { enabled: true } };
      s3State = { pending: true, decidedAt };
      mockSystemMetadata();
    });

    it('should clear a pending state when a manual Storage Template Migration succeeds', async () => {
      await sut.onJobSuccess({ job: bulkJob, response: JobStatus.Success });

      expect(mocks.systemMetadata.set).toHaveBeenCalledExactlyOnceWith(SystemMetadataKey.StorageTemplateS3State, {
        pending: false,
        decidedAt,
        clearedAt: now.toISOString(),
      });
      expect(mocks.logger.log).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('Storage template migration finished'),
      );
    });

    it('should clear the state once: a later manual run leaves it as it is', async () => {
      await sut.onJobSuccess({ job: bulkJob, response: JobStatus.Success });
      vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));
      await sut.onJobSuccess({ job: bulkJob, response: JobStatus.Success });

      expect(mocks.systemMetadata.set).toHaveBeenCalledOnce();
      expect(s3State).toEqual({ pending: false, decidedAt, clearedAt: now.toISOString() });
    });

    it('should ignore the per-asset job and every other job', async () => {
      const otherNames = Object.values(JobName).filter((name) => name !== JobName.StorageTemplateMigration);
      expect(otherNames).toContain(JobName.StorageTemplateMigrationSingle);

      for (const name of otherNames) {
        await sut.onJobSuccess({
          job: { name, data: { id: factory.uuid() } } as unknown as JobItem,
          response: JobStatus.Success,
        });
      }

      expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(s3State).toEqual({ pending: true, decidedAt });
    });

    // handleMigration returns Skipped with the template disabled; a Failed or missing response is not a finished run
    it.each([JobStatus.Skipped, JobStatus.Failed, undefined])(
      'should ignore a Storage Template Migration that ends with %s',
      async (response) => {
        await sut.onJobSuccess({ job: bulkJob, response });

        expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
        expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
        expect(mocks.logger.log).not.toHaveBeenCalled();
      },
    );

    it.each([
      { label: 'already cleared', state: { pending: false, decidedAt, clearedAt: '2026-10-20T12:00:00.000Z' } },
      { label: 'decided not pending', state: { pending: false, decidedAt } },
      { label: 'missing', state: null },
    ])('should leave a state that is $label as it is', async ({ state }) => {
      s3State = state;

      await sut.onJobSuccess({ job: bulkJob, response: JobStatus.Success });

      expect(stateReads()).toBe(1);
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      expect(mocks.logger.log).not.toHaveBeenCalled();
      expect(s3State).toBe(state);
    });
  });

  describe('onQueueStart', () => {
    beforeEach(() => {
      (storageBackends as any).s3Backend = {};
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: true } });
      mocks.job.isActive.mockResolvedValue(false);
    });

    it("queues upstream's Migration job when the storage template migration is started with S3", async () => {
      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.isActive).toHaveBeenCalledWith(QueueName.Migration);
      expect(mocks.job.queue).toHaveBeenCalledExactlyOnceWith({ name: JobName.FileMigrationQueueAll });
    });

    it('does nothing while the Migration queue is running, as upstream refuses a second Migration start', async () => {
      // file migration jobs have no dedup: queueing them again would move the same files twice
      mocks.job.isActive.mockResolvedValue(true);

      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.isActive).toHaveBeenCalledWith(QueueName.Migration);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.logger.log).toHaveBeenCalledWith(expect.stringContaining('Migration queue is already running'));
    });

    it('does nothing when another queue is started', async () => {
      const otherQueues = Object.values(QueueName).filter((name) => name !== QueueName.StorageTemplateMigration);
      for (const name of otherQueues) {
        await sut.onQueueStart({ name });
      }

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing without an S3 backend, where the Migration job covers every derivative', async () => {
      (storageBackends as any).s3Backend = undefined;

      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing with the storage template disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: false } });

      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });
});
