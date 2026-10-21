import { JobName, JobStatus, QueueName } from 'src/enum.js';
import { BackendFileMigrationService } from 'src/gallery/services/backend-file-migration.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

describe(BackendFileMigrationService.name, () => {
  let sut: BackendFileMigrationService;
  let mocks: ServiceMocks;
  let previousS3Backend: unknown;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BackendFileMigrationService));
    previousS3Backend = (StorageService as any).s3Backend;
  });

  afterEach(() => {
    (StorageService as any).s3Backend = previousS3Backend;
  });

  describe('onQueueStart', () => {
    beforeEach(() => {
      (StorageService as any).s3Backend = {};
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: true } });
    });

    it('queues the derivative migration when the storage template migration is started with S3', async () => {
      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.queue).toHaveBeenCalledExactlyOnceWith({ name: JobName.StorageBackendFileMigrationQueueAll });
    });

    it('does nothing when another queue is started', async () => {
      const otherQueues = Object.values(QueueName).filter((name) => name !== QueueName.StorageTemplateMigration);
      for (const name of otherQueues) {
        await sut.onQueueStart({ name });
      }

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing without an S3 backend, where the Migration job covers every derivative', async () => {
      (StorageService as any).s3Backend = undefined;

      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing with the storage template disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ storageTemplate: { enabled: false } });

      await sut.onQueueStart({ name: QueueName.StorageTemplateMigration });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueFileMigration', () => {
    it('queues a file migration for every streamed asset and person', async () => {
      const assets = [{ id: factory.uuid() }, { id: factory.uuid() }];
      const person = { ownerId: factory.uuid(), personGroupId: factory.uuid() };
      mocks.storageMigration.streamAssetsWithBackendDerivatives.mockReturnValue(makeStream(assets));
      mocks.storageMigration.streamPeopleWithBackendThumbnails.mockReturnValue(makeStream([person]));

      await expect(sut.handleQueueFileMigration()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetFileMigration, data: { id: assets[0].id } },
        { name: JobName.AssetFileMigration, data: { id: assets[1].id } },
      ]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonFileMigration, data: { ownerId: person.ownerId, personGroupId: person.personGroupId } },
      ]);
    });

    it('queues nothing when no derivative is stored under a key', async () => {
      mocks.storageMigration.streamAssetsWithBackendDerivatives.mockReturnValue(makeStream([]));
      mocks.storageMigration.streamPeopleWithBackendThumbnails.mockReturnValue(makeStream([]));

      await expect(sut.handleQueueFileMigration()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });
});
