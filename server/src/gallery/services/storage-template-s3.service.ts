import { Injectable } from '@nestjs/common';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { OnEvent } from 'src/decorators.js';
import {
  BootstrapEventPriority,
  DatabaseLock,
  ImmichWorker,
  JobName,
  JobStatus,
  QueueName,
  SystemMetadataKey,
} from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';

/**
 * The storage template's S3 side: whether an upgraded install's S3 files wait for a manual run, and, when an admin
 * starts the Storage Template Migration job by hand on an S3 install, upstream's Migration job (FileMigrationQueueAll)
 * to re-path the thumbnails, previews, full-size images, encoded videos and person thumbnails. Its AssetFileMigration
 * and PersonFileMigration reach S3 through StorageCore.moveFile; it re-paths files on disk too, as it always does.
 */
@Injectable()
export class StorageTemplateS3Service extends BaseService {
  /**
   * Decides, once, whether this install's S3 files wait for a manual Storage Template Migration (see
   * isManualOnlyTemplateMove): yes when the first start of this version finds originals in S3 and the template
   * enabled, so an upgrade does not start moving bucket objects by itself; no on a fresh install, or when the template
   * was off (enabling it later is the admin's own choice). It runs before the job workers start (JobService), so no
   * per-asset job reads an undecided state, and in every worker, so the API worker cannot accept an upload (which would
   * count as an S3 original) before the decision is made.
   */
  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.JobService - 1 })
  async onBootstrap() {
    const state =
      (await this.systemMetadataRepository.get(SystemMetadataKey.StorageTemplateS3State)) ??
      (await this.databaseRepository.withLock(DatabaseLock.StorageTemplateMigration, () => this.decideS3State()));

    if (state.pending) {
      this.logger.warn(
        'The storage template does not move files in S3 until an admin runs Storage Template Migration from ' +
          'Administration > Job Queues; uploads keep their upload/ keys until then',
      );
    }
  }

  private async decideS3State() {
    // logged first, so a start that waits on the lock or fails on the query below can be told apart
    this.logger.log('Deciding whether files in S3 wait for a manual storage template migration');

    // the other worker may have decided while this one waited for the lock: the first decision stands, or a worker
    // that started after the API accepted an S3 upload would count that upload and decide differently
    const decided = await this.systemMetadataRepository.get(SystemMetadataKey.StorageTemplateS3State);
    if (decided) {
      return decided;
    }

    const { storageTemplate } = await this.getConfig({ withCache: false });
    const pending = storageTemplate.enabled && (await this.storageMigrationRepository.hasS3Originals());
    const state = { pending, decidedAt: new Date().toISOString() };
    await this.systemMetadataRepository.set(SystemMetadataKey.StorageTemplateS3State, state);
    return state;
  }

  // the first manual run that finishes lets the per-asset job move S3 files from then on; JobSuccess is emitted in
  // the worker that ran the job, and the bulk job is queued only by an admin starting the queue
  @OnEvent({ name: 'JobSuccess', workers: [ImmichWorker.Microservices] })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    if (job.name !== JobName.StorageTemplateMigration || response !== JobStatus.Success) {
      return;
    }

    const state = await this.systemMetadataRepository.get(SystemMetadataKey.StorageTemplateS3State);
    if (!state?.pending) {
      return;
    }

    await this.systemMetadataRepository.set(SystemMetadataKey.StorageTemplateS3State, {
      ...state,
      pending: false,
      clearedAt: new Date().toISOString(),
    });
    this.logger.log('Storage template migration finished: new uploads in S3 now move to their template path');
  }

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

    // upstream refuses to start the Migration queue while it runs ("Job is already running"); file migration jobs
    // have no dedup, so queueing now would move the same files twice
    if (await this.jobRepository.isActive(QueueName.Migration)) {
      this.logger.log('Migration queue is already running, not queueing another file migration');
      return;
    }

    await this.jobRepository.queue({ name: JobName.FileMigrationQueueAll });
  }
}
