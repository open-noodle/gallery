import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { AssetFileType, JobName, JobStatus, QueueName } from 'src/enum';
import { StorageMigrationDirection } from 'src/repositories/storage-migration.repository';
import { BaseService } from 'src/services/base.service';
import { StorageService } from 'src/services/storage.service';
import { JobOf } from 'src/types';

interface StorageMigrationFileTypes {
  originals: boolean;
  thumbnails: boolean;
  previews: boolean;
  fullsize: boolean;
  encodedVideos: boolean;
  sidecars: boolean;
  personThumbnails: boolean;
  profileImages: boolean;
}

@Injectable()
export class StorageMigrationService extends BaseService {
  private validateBackendConfig(direction: StorageMigrationDirection): void {
    const backend = this.configRepository.getEnv().storage.backend;
    if (direction === 'toS3' && backend !== 's3') {
      throw new BadRequestException('Storage backend must be set to "s3" (IMMICH_STORAGE_BACKEND=s3) to migrate to S3');
    }
    if (direction === 'toDisk' && backend !== 'disk') {
      throw new BadRequestException(
        'Storage backend must be set to "disk" (IMMICH_STORAGE_BACKEND=disk) to migrate to disk',
      );
    }
  }

  private async validateS3Connection(): Promise<void> {
    const s3Backend = StorageService.getS3Backend();
    if (!s3Backend) {
      throw new BadRequestException('S3 storage backend is not configured');
    }

    try {
      await s3Backend.exists('__immich_connection_test__');
    } catch (error: any) {
      throw new BadRequestException(`S3 connection test failed: ${error.message}`);
    }
  }

  async getEstimate(direction: StorageMigrationDirection) {
    const [fileCounts, estimatedSizeBytes] = await Promise.all([
      this.storageMigrationRepository.getFileCounts(direction),
      this.storageMigrationRepository.getOriginalsSizeEstimate(direction),
    ]);

    const total =
      fileCounts.originals +
      fileCounts.thumbnails +
      fileCounts.previews +
      fileCounts.fullsize +
      fileCounts.sidecars +
      fileCounts.encodedVideos +
      fileCounts.personThumbnails +
      fileCounts.profileImages;

    return {
      direction,
      fileCounts: { ...fileCounts, total },
      estimatedSizeBytes,
    };
  }

  async start(options: {
    direction: StorageMigrationDirection;
    deleteSource: boolean;
    fileTypes: StorageMigrationFileTypes;
    concurrency: number;
  }) {
    this.validateBackendConfig(options.direction);
    await this.validateS3Connection();

    const fileCounts = await this.storageMigrationRepository.getFileCounts(options.direction);
    const total =
      fileCounts.originals +
      fileCounts.thumbnails +
      fileCounts.previews +
      fileCounts.fullsize +
      fileCounts.sidecars +
      fileCounts.encodedVideos +
      fileCounts.personThumbnails +
      fileCounts.profileImages;
    if (total === 0) {
      throw new BadRequestException('No files to migrate');
    }

    const isActive = await this.jobRepository.isActive(QueueName.StorageBackendMigration);
    if (isActive) {
      throw new BadRequestException('A storage migration is already in progress');
    }

    const batchId = randomUUID();

    await this.jobRepository.queue({
      name: JobName.StorageBackendMigrationQueueAll,
      data: { ...options, batchId },
    });

    return { batchId };
  }

  async getStatus() {
    const [isActive, counts] = await Promise.all([
      this.jobRepository.isActive(QueueName.StorageBackendMigration),
      this.jobRepository.getJobCounts(QueueName.StorageBackendMigration),
    ]);

    return { isActive, ...counts };
  }

  @OnJob({ name: JobName.StorageBackendMigrationQueueAll, queue: QueueName.StorageBackendMigration })
  async handleQueueAll(job: JobOf<JobName.StorageBackendMigrationQueueAll>): Promise<JobStatus> {
    const { direction, deleteSource, fileTypes, concurrency, batchId } = job;

    this.validateBackendConfig(direction);
    this.jobRepository.setConcurrency(QueueName.StorageBackendMigration, concurrency);

    let totalQueued = 0;
    const batch: Array<{
      name: JobName.StorageBackendMigrationSingle;
      data: JobOf<JobName.StorageBackendMigrationSingle>;
    }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) {
        return;
      }
      await this.jobRepository.queueAll([...batch]);
      totalQueued += batch.length;
      this.logger.log(`Queued ${totalQueued} files for migration`);
      batch.length = 0;
    };

    const enqueue = async (data: JobOf<JobName.StorageBackendMigrationSingle>) => {
      batch.push({ name: JobName.StorageBackendMigrationSingle, data });
      if (batch.length >= 1000) {
        await flushBatch();
      }
    };

    // Stream originals
    if (fileTypes.originals) {
      for await (const row of this.storageMigrationRepository.streamOriginals(direction)) {
        await enqueue({
          entityType: 'asset',
          entityId: row.id,
          fileType: 'original',
          sourcePath: row.originalPath,
          batchId,
          direction,
          deleteSource,
        });
      }
    }

    // Stream asset files (thumbnails, previews, fullsize, sidecars)
    const assetFileTypes: AssetFileType[] = [];
    if (fileTypes.thumbnails) {
      assetFileTypes.push(AssetFileType.Thumbnail);
    }
    if (fileTypes.previews) {
      assetFileTypes.push(AssetFileType.Preview);
    }
    if (fileTypes.fullsize) {
      assetFileTypes.push(AssetFileType.FullSize);
    }
    if (fileTypes.sidecars) {
      assetFileTypes.push(AssetFileType.Sidecar);
    }

    if (assetFileTypes.length > 0) {
      for await (const row of this.storageMigrationRepository.streamAssetFiles(direction, assetFileTypes)) {
        await enqueue({
          entityType: 'assetFile',
          entityId: row.id,
          fileType: row.type,
          sourcePath: row.path,
          batchId,
          direction,
          deleteSource,
        });
      }
    }

    // Stream encoded videos
    if (fileTypes.encodedVideos) {
      for await (const row of this.storageMigrationRepository.streamEncodedVideos(direction)) {
        await enqueue({
          entityType: 'asset',
          entityId: row.assetId,
          fileType: 'encodedVideo',
          sourcePath: row.path,
          batchId,
          direction,
          deleteSource,
        });
      }
    }

    // Stream person thumbnails
    if (fileTypes.personThumbnails) {
      for await (const row of this.storageMigrationRepository.streamPersonThumbnails(direction)) {
        await enqueue({
          entityType: 'person',
          entityId: row.id,
          fileType: null,
          sourcePath: row.thumbnailPath,
          batchId,
          direction,
          deleteSource,
        });
      }
    }

    // Stream profile images
    if (fileTypes.profileImages) {
      for await (const row of this.storageMigrationRepository.streamProfileImages(direction)) {
        await enqueue({
          entityType: 'user',
          entityId: row.id,
          fileType: null,
          sourcePath: row.profileImagePath,
          batchId,
          direction,
          deleteSource,
        });
      }
    }

    // Flush remaining
    await flushBatch();

    this.logger.log(`Finished queueing ${totalQueued} files for storage migration (batchId=${batchId})`);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.StorageBackendMigrationSingle, queue: QueueName.StorageBackendMigration })
  async handleMigration(job: JobOf<JobName.StorageBackendMigrationSingle>): Promise<JobStatus> {
    const { entityType, entityId, fileType, sourcePath, batchId, direction, deleteSource } = job;

    try {
      const sourceBackend = this.resolveSourceBackend(direction);
      const targetBackend = this.resolveTargetBackend(direction);
      const targetPath = this.computeTargetPath(sourcePath, direction);

      // Check source exists
      const sourceExists = await sourceBackend.exists(sourcePath);
      if (!sourceExists) {
        this.logger.warn(`Source file not found, skipping: ${sourcePath}`);
        return JobStatus.Skipped;
      }

      // Idempotency: check if target already exists
      const targetExists = await targetBackend.exists(targetPath);
      if (!targetExists) {
        // Copy: get stream from source, put to target
        const { stream } = await sourceBackend.get(sourcePath);
        await targetBackend.put(targetPath, stream);
      }

      // Update DB path with optimistic concurrency
      const updated = await this.updatePath(entityType, entityId, fileType, sourcePath, targetPath);
      if (!updated) {
        this.logger.warn(
          `Path was concurrently modified, skipping DB update: ${entityType}/${entityId} (${sourcePath} -> ${targetPath})`,
        );
        return JobStatus.Skipped;
      }

      // Write to migration log
      await this.storageMigrationRepository.createLogEntry({
        entityType,
        entityId,
        fileType,
        oldPath: sourcePath,
        newPath: targetPath,
        direction,
        batchId,
      });

      // Optionally delete source
      if (deleteSource) {
        try {
          await sourceBackend.delete(sourcePath);
        } catch (error: any) {
          this.logger.warn(`Failed to delete source file after migration: ${sourcePath}: ${error.message}`);
        }
      }

      return JobStatus.Success;
    } catch (error: any) {
      this.logger.error(`Failed to migrate file ${sourcePath}: ${error.message}`, error.stack);
      return JobStatus.Failed;
    }
  }

  async rollback(batchId: string) {
    const entries = await this.storageMigrationRepository.getLogEntriesByBatch(batchId);

    let rolledBack = 0;
    let failed = 0;
    const total = entries.length;

    for (const entry of entries) {
      try {
        const updated = await this.updatePath(
          entry.entityType,
          entry.entityId,
          entry.fileType,
          entry.newPath,
          entry.oldPath,
        );
        if (updated) {
          rolledBack++;
        } else {
          this.logger.warn(
            `Rollback: path was concurrently modified for ${entry.entityType}/${entry.entityId}, skipping`,
          );
          failed++;
        }
      } catch (error: any) {
        this.logger.error(`Rollback failed for ${entry.entityType}/${entry.entityId}: ${error.message}`, error.stack);
        failed++;
      }
    }

    if (failed === 0) {
      await this.storageMigrationRepository.deleteLogEntriesByBatch(batchId);
    }

    return { rolledBack, failed, total };
  }

  // --- S3 enable-encryption-in-place migration ---
  //
  // Distinct from disk<->S3 migration above: the object's key never changes here, only its
  // encryption state, so there is no DB path update and no rollback-by-path-swap. Progress is
  // tracked via the same storage_migration_log table (direction='s3EnableEncryption'), which
  // doubles as the idempotency check since reencryptInPlace itself is not safely re-runnable
  // against an object it already encrypted (see isS3EncryptionLogged).

  private static readonly S3_ENABLE_ENCRYPTION_DIRECTION = 's3EnableEncryption';

  private getEnabledS3EncryptionFileTypes(fileTypes: StorageMigrationFileTypes): AssetFileType[] {
    const types: AssetFileType[] = [];
    if (fileTypes.thumbnails) {
      types.push(AssetFileType.Thumbnail);
    }
    if (fileTypes.previews) {
      types.push(AssetFileType.Preview);
    }
    if (fileTypes.fullsize) {
      types.push(AssetFileType.FullSize);
    }
    if (fileTypes.sidecars) {
      types.push(AssetFileType.Sidecar);
    }
    return types;
  }

  private validateS3EncryptionConfig(): void {
    if (this.configRepository.getEnv().storage.s3.sse.mode !== 'sse-c') {
      throw new BadRequestException('IMMICH_S3_SSE_MODE must be set to sse-c to enable S3 encryption');
    }
  }

  async getS3EncryptionEstimate() {
    const fileCounts = await this.storageMigrationRepository.getS3FileCounts();
    const total =
      fileCounts.originals +
      fileCounts.thumbnails +
      fileCounts.previews +
      fileCounts.fullsize +
      fileCounts.sidecars +
      fileCounts.encodedVideos +
      fileCounts.personThumbnails +
      fileCounts.profileImages;

    return { fileCounts: { ...fileCounts, total } };
  }

  async startS3Encryption(options: { fileTypes: StorageMigrationFileTypes; concurrency: number }) {
    this.validateS3EncryptionConfig();
    await this.validateS3Connection();

    const fileCounts = await this.storageMigrationRepository.getS3FileCounts();
    const total =
      fileCounts.originals +
      fileCounts.thumbnails +
      fileCounts.previews +
      fileCounts.fullsize +
      fileCounts.sidecars +
      fileCounts.encodedVideos +
      fileCounts.personThumbnails +
      fileCounts.profileImages;
    if (total === 0) {
      throw new BadRequestException('No S3 files to encrypt');
    }

    const isActive = await this.jobRepository.isActive(QueueName.StorageBackendMigration);
    if (isActive) {
      throw new BadRequestException('A storage migration is already in progress');
    }

    const batchId = randomUUID();

    await this.jobRepository.queue({
      name: JobName.S3EnableEncryptionQueueAll,
      data: { ...options, batchId },
    });

    return { batchId };
  }

  async getS3EncryptionStatus() {
    const [isActive, counts] = await Promise.all([
      this.jobRepository.isActive(QueueName.StorageBackendMigration),
      this.jobRepository.getJobCounts(QueueName.StorageBackendMigration),
    ]);

    return { isActive, ...counts };
  }

  @OnJob({ name: JobName.S3EnableEncryptionQueueAll, queue: QueueName.StorageBackendMigration })
  async handleS3EnableEncryptionQueueAll(job: JobOf<JobName.S3EnableEncryptionQueueAll>): Promise<JobStatus> {
    const { fileTypes, concurrency, batchId } = job;

    this.validateS3EncryptionConfig();
    this.jobRepository.setConcurrency(QueueName.StorageBackendMigration, concurrency);

    let totalQueued = 0;
    const batch: Array<{
      name: JobName.S3EnableEncryptionSingle;
      data: JobOf<JobName.S3EnableEncryptionSingle>;
    }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) {
        return;
      }
      await this.jobRepository.queueAll([...batch]);
      totalQueued += batch.length;
      this.logger.log(`Queued ${totalQueued} S3 files for encryption`);
      batch.length = 0;
    };

    const enqueue = async (data: JobOf<JobName.S3EnableEncryptionSingle>) => {
      batch.push({ name: JobName.S3EnableEncryptionSingle, data });
      if (batch.length >= 1000) {
        await flushBatch();
      }
    };

    if (fileTypes.originals) {
      for await (const row of this.storageMigrationRepository.streamS3Originals()) {
        await enqueue({ entityType: 'asset', entityId: row.id, fileType: 'original', key: row.originalPath, batchId });
      }
    }

    const assetFileTypes = this.getEnabledS3EncryptionFileTypes(fileTypes);
    if (assetFileTypes.length > 0) {
      for await (const row of this.storageMigrationRepository.streamS3AssetFiles(assetFileTypes)) {
        await enqueue({ entityType: 'assetFile', entityId: row.id, fileType: row.type, key: row.path, batchId });
      }
    }

    if (fileTypes.encodedVideos) {
      for await (const row of this.storageMigrationRepository.streamS3EncodedVideos()) {
        await enqueue({ entityType: 'asset', entityId: row.assetId, fileType: 'encodedVideo', key: row.path, batchId });
      }
    }

    if (fileTypes.personThumbnails) {
      for await (const row of this.storageMigrationRepository.streamS3PersonThumbnails()) {
        await enqueue({ entityType: 'person', entityId: row.id, fileType: null, key: row.thumbnailPath, batchId });
      }
    }

    if (fileTypes.profileImages) {
      for await (const row of this.storageMigrationRepository.streamS3ProfileImages()) {
        await enqueue({ entityType: 'user', entityId: row.id, fileType: null, key: row.profileImagePath, batchId });
      }
    }

    await flushBatch();

    this.logger.log(`Finished queueing ${totalQueued} S3 files for encryption (batchId=${batchId})`);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.S3EnableEncryptionSingle, queue: QueueName.StorageBackendMigration })
  async handleS3EnableEncryptionSingle(job: JobOf<JobName.S3EnableEncryptionSingle>): Promise<JobStatus> {
    const { entityType, entityId, fileType, key, batchId } = job;
    const direction = StorageMigrationService.S3_ENABLE_ENCRYPTION_DIRECTION;

    try {
      const s3Backend = StorageService.getS3Backend();
      if (!s3Backend) {
        throw new BadRequestException('S3 storage backend is not configured');
      }

      // Idempotency: reencryptInPlace is not safely re-runnable against an object it already
      // encrypted (S3 would need CopySource decrypt headers this call deliberately omits), so
      // completion is tracked via the migration log rather than by probing object state.
      const alreadyDone = await this.storageMigrationRepository.isS3EncryptionLogged(direction, key);
      if (alreadyDone) {
        return JobStatus.Skipped;
      }

      const exists = await s3Backend.exists(key);
      if (!exists) {
        this.logger.warn(`Source file not found, skipping: ${key}`);
        return JobStatus.Skipped;
      }

      await s3Backend.reencryptInPlace(key);

      await this.storageMigrationRepository.createLogEntry({
        entityType,
        entityId,
        fileType,
        oldPath: key,
        newPath: key,
        direction,
        batchId,
      });

      return JobStatus.Success;
    } catch (error: any) {
      this.logger.error(`Failed to encrypt file ${key}: ${error.message}`, error.stack);
      return JobStatus.Failed;
    }
  }

  private resolveSourceBackend(direction: StorageMigrationDirection) {
    if (direction === 'toS3') {
      return StorageService.getDiskBackend();
    }
    const s3Backend = StorageService.getS3Backend();
    if (!s3Backend) {
      throw new BadRequestException('S3 storage backend is not configured');
    }
    return s3Backend;
  }

  private resolveTargetBackend(direction: StorageMigrationDirection) {
    if (direction === 'toS3') {
      const s3Backend = StorageService.getS3Backend();
      if (!s3Backend) {
        throw new BadRequestException('S3 storage backend is not configured');
      }
      return s3Backend;
    }
    return StorageService.getDiskBackend();
  }

  private computeTargetPath(sourcePath: string, direction: StorageMigrationDirection): string {
    if (direction === 'toS3') {
      // Strip media location prefix to get relative key
      // e.g. /usr/src/app/upload/library/user/file.jpg -> library/user/file.jpg
      const mediaLocation = StorageCore.getMediaLocation();
      const prefix = mediaLocation.endsWith('/') ? mediaLocation : `${mediaLocation}/`;
      if (sourcePath.startsWith(prefix)) {
        return sourcePath.slice(prefix.length);
      }
      // If path doesn't start with media location, strip leading slash as fallback
      return sourcePath.startsWith('/') ? sourcePath.slice(1) : sourcePath;
    }

    // toDisk: prepend media location
    // e.g. library/user/file.jpg -> /usr/src/app/upload/library/user/file.jpg
    const mediaLocation = StorageCore.getMediaLocation();
    const prefix = mediaLocation.endsWith('/') ? mediaLocation : `${mediaLocation}/`;
    return `${prefix}${sourcePath}`;
  }

  private async updatePath(
    entityType: string,
    entityId: string,
    fileType: string | null,
    oldPath: string,
    newPath: string,
  ): Promise<boolean> {
    switch (entityType) {
      case 'asset': {
        if (fileType === 'encodedVideo') {
          return this.storageMigrationRepository.updateAssetEncodedVideoPath(entityId, oldPath, newPath);
        }
        return this.storageMigrationRepository.updateAssetOriginalPath(entityId, oldPath, newPath);
      }
      case 'assetFile': {
        return this.storageMigrationRepository.updateAssetFilePath(entityId, oldPath, newPath);
      }
      case 'person': {
        return this.storageMigrationRepository.updatePersonThumbnailPath(entityId, oldPath, newPath);
      }
      case 'user': {
        return this.storageMigrationRepository.updateUserProfileImagePath(entityId, oldPath, newPath);
      }
      default: {
        this.logger.warn(`Unknown entity type: ${entityType}`);
        return false;
      }
    }
  }
}
