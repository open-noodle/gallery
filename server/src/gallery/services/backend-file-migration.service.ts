import { Injectable } from '@nestjs/common';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { batched } from 'src/utils/misc.js';

/**
 * Re-paths the derivatives an S3 backend holds when an admin starts the Storage Template Migration job by hand: the
 * thumbnails, previews, full-size images, encoded videos and person thumbnails that upstream's Migration job moves on
 * disk. The moves themselves are upstream's AssetFileMigration / PersonFileMigration, which reach S3 through
 * StorageCore.moveFile; disk derivatives are left to the Migration job, as before.
 */
@Injectable()
export class BackendFileMigrationService extends BaseService {
  // QueueService.start emits QueueStart locally, so it reaches only the API worker that took the admin's request
  @OnEvent({ name: 'QueueStart', workers: [ImmichWorker.Api] })
  async onQueueStart({ name }: ArgOf<'QueueStart'>) {
    if (name !== QueueName.StorageTemplateMigration || !StorageService.getS3Backend()) {
      return;
    }

    const { storageTemplate } = await this.getConfig({ withCache: false });
    if (!storageTemplate.enabled) {
      return;
    }

    await this.jobRepository.queue({ name: JobName.StorageBackendFileMigrationQueueAll });
  }

  @OnJob({ name: JobName.StorageBackendFileMigrationQueueAll, queue: QueueName.Migration })
  async handleQueueFileMigration(): Promise<JobStatus> {
    for await (const assets of batched(this.storageMigrationRepository.streamAssetsWithBackendDerivatives())) {
      await this.jobRepository.queueAll(assets.map(({ id }) => ({ name: JobName.AssetFileMigration, data: { id } })));
    }

    for await (const people of batched(this.storageMigrationRepository.streamPeopleWithBackendThumbnails())) {
      await this.jobRepository.queueAll(
        people.map(({ ownerId, personGroupId }) => ({
          name: JobName.PersonFileMigration,
          data: { ownerId, personGroupId },
        })),
      );
    }

    return JobStatus.Success;
  }
}
