import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { StorageRoutingKind, resolveRouting } from 'src/backends/storage-router.js';
import { ErrorMessages } from 'src/constants.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { OnEvent, OnJob } from 'src/decorators.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import {
  BootstrapEventPriority,
  DatabaseLock,
  JobName,
  JobStatus,
  QueueName,
  StorageFolder,
  SystemMetadataKey,
} from 'src/enum.js';
import { StorageRouting } from 'src/gallery/dtos/config.dto.js';
import { storageBackends } from 'src/gallery/utils/storage-backends.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { BaseService } from 'src/services/base.service.js';
import type { JobOf, SystemFlags } from 'src/types.js';
import { ImmichStartupError } from 'src/utils/misc.js';
import { detectMediaLocation } from 'src/utils/storage.js';

const docsMessage = `Please see https://docs.immich.app/administration/system-integrity#folder-checks for more information.`;

@Injectable()
export class StorageService extends BaseService {
  // the backends live in a leaf module (src/gallery/utils/storage-backends.ts) that StorageCore and utils can import
  static getDiskBackend = (): DiskStorageBackend => storageBackends.diskBackend;
  static getS3Backend = (): S3StorageBackend | undefined => storageBackends.s3Backend;
  static backendFor = (key: string, absoluteDisk?: StorageBackend) => storageBackends.backendFor(key, absoluteDisk);

  /**
  The backend a new file of `kind` is written to (per-file-type routing). Without a kind it is the backend
  IMMICH_STORAGE_BACKEND selects, as before routing existed.
  */
  static getWriteBackend(kind?: StorageRoutingKind, config?: SystemConfig): StorageBackend {
    if (!kind || !config) {
      return storageBackends.getWriteBackend();
    }
    const resolved = resolveRouting(config.storage.routing[kind], storageBackends.writeBackendType);
    if (resolved === 's3') {
      const s3Backend = storageBackends.s3Backend;
      if (s3Backend) {
        return s3Backend;
      }
      // Credentials can be removed from the environment after routing was configured. Failing
      // every write would brick a running instance; disk is always safe because stored keys are
      // self-describing, so the file remains readable wherever it lands.
      StorageService.warnMissingS3Backend(kind);
    }
    return storageBackends.diskBackend;
  }

  private static warnedKinds = new Set<StorageRoutingKind>();

  // getWriteBackend is static and has no `this.logger`. LoggingRepository.create(context) is the
  // established seam for logging from a static/free-standing context elsewhere in the codebase
  // (see plugin.repository.ts, base.service.ts, and the migrations) — it routes through the same
  // structured JSON logging as instance loggers, unlike a raw console.warn.
  private static staticLogger = LoggingRepository.create(StorageService.name);

  private static warnMissingS3Backend(kind: StorageRoutingKind) {
    if (StorageService.warnedKinds.has(kind)) {
      return;
    }
    StorageService.warnedKinds.add(kind);
    StorageService.staticLogger.warn(
      `Storage routing for "${kind}" is set to s3 but no S3 backend is configured; writing to disk.`,
    );
  }

  private getS3PinnedKindsWithoutBucket(config: SystemConfig): StorageRoutingKind[] {
    const { bucket } = this.configRepository.getEnv().storage.s3;
    if (bucket) {
      return [];
    }
    return Object.values(StorageRoutingKind).filter((kind) => config.storage.routing[kind] === StorageRouting.S3);
  }

  @OnEvent({ name: 'ConfigValidate' })
  onConfigValidate({ newConfig }: ArgOf<'ConfigValidate'>) {
    const offending = this.getS3PinnedKindsWithoutBucket(newConfig);
    if (offending.length > 0) {
      throw new Error(
        `Storage routing cannot be set to S3 for ${offending.join(', ')} because IMMICH_S3_BUCKET is not configured.`,
      );
    }
  }

  // Config-file installs never emit ConfigValidate (SystemConfigService.updateSystemConfig rejects
  // outright when IMMICH_CONFIG_FILE is set), so this is their only signal. It logs rather than
  // throws: a config edit must not prevent a running instance from starting.
  @OnEvent({ name: 'ConfigInit' })
  onStorageConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    const offending = this.getS3PinnedKindsWithoutBucket(newConfig);
    if (offending.length > 0) {
      this.logger.error(
        `Storage routing is set to S3 for ${offending.join(', ')} but IMMICH_S3_BUCKET is not configured; those files will be written to disk instead.`,
      );
    }
  }

  private detectMediaLocation(): string {
    const envData = this.configRepository.getEnv();
    return detectMediaLocation(envData.storage.mediaLocation, (path) => this.storageRepository.existsSync(path));
  }

  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.StorageService })
  async onBootstrap() {
    StorageCore.setMediaLocation(this.detectMediaLocation());

    // Initialize storage backends
    const envData = this.configRepository.getEnv();
    storageBackends.diskBackend = new DiskStorageBackend(StorageCore.getMediaLocation(), this.storageRepository);
    storageBackends.writeBackendType = envData.storage.backend;

    if (envData.storage.s3.bucket) {
      storageBackends.s3Backend = new S3StorageBackend(envData.storage.s3);
      this.logger.log(`S3 storage backend configured (bucket: ${envData.storage.s3.bucket})`);
    }

    if (envData.storage.backend === 's3' && !storageBackends.s3Backend) {
      throw new ImmichStartupError('IMMICH_STORAGE_BACKEND is set to s3 but IMMICH_S3_BUCKET is not configured');
    }

    this.logger.log(`Storage write backend: ${envData.storage.backend}`);

    await this.databaseRepository.withLock(DatabaseLock.SystemFileMounts, async () => {
      const flags =
        (await this.systemMetadataRepository.get(SystemMetadataKey.SystemFlags)) ||
        ({ mountChecks: {} } as SystemFlags);

      if (!flags.mountChecks) {
        flags.mountChecks = {};
      }

      let isUpdated = false;

      this.logger.log(`Verifying system mount folder checks, current state: ${JSON.stringify(flags)}`);

      try {
        // check each folder exists and is writable
        for (const folder of Object.values(StorageFolder)) {
          if (!flags.mountChecks[folder]) {
            this.logger.log(`Writing initial mount file for the ${folder} folder`);
            await this.createMountFile(folder);
          }

          await this.verifyReadAccess(folder);
          await this.verifyWriteAccess(folder);

          if (flags.mountChecks[folder]) {
            continue;
          }

          flags.mountChecks[folder] = true;
          isUpdated = true;
        }

        if (isUpdated) {
          await this.systemMetadataRepository.set(SystemMetadataKey.SystemFlags, flags);
          this.logger.log('Successfully enabled system mount folders checks');
        }

        this.logger.log('Successfully verified system mount folder checks');
      } catch (error) {
        const envData = this.configRepository.getEnv();
        if (envData.storage.ignoreMountCheckErrors) {
          this.logger.error(error as Error);
          this.logger.warn('Ignoring mount folder errors');
        } else {
          throw error;
        }
      }
    });

    await this.databaseRepository.withLock(DatabaseLock.MediaLocation, async () => {
      const current = StorageCore.getMediaLocation();
      const samples = await this.assetRepository.getFileSamples();
      const savedValue = await this.systemMetadataRepository.get(SystemMetadataKey.MediaLocation);
      // Load-bearing: getFileSamples now only returns disk-resident (absolute-path) rows, so on
      // an install that is entirely on S3 — or mid-migration with no disk-resident asset_file
      // rows left — samples is empty and the location check below is skipped entirely. Without
      // this guard, an unordered sample could be a relative S3 key on one restart and an
      // absolute disk path on the next, making InconsistentMediaLocation fire nondeterministically.
      if (samples.length > 0) {
        const path = samples[0].path;

        let previous = savedValue?.location || '';

        if (!previous && this.configRepository.getEnv().storage.mediaLocation) {
          previous = current;
        }

        if (!previous) {
          previous = path.startsWith('upload/') ? 'upload' : '/usr/src/app/upload';
        }

        if (previous !== current) {
          this.logger.log(`Media location changed (from=${previous}, to=${current})`);

          if (!path.startsWith(previous)) {
            throw new Error(ErrorMessages.InconsistentMediaLocation);
          }

          this.logger.warn(
            `Detected a change to media location, performing an automatic migration of file paths from ${previous} to ${current}, this may take awhile`,
          );
          await this.databaseRepository.migrateFilePaths(previous, current);
        }
      }

      // Only set MediaLocation in systemMetadataRepository if needed
      if (savedValue?.location !== current) {
        await this.systemMetadataRepository.set(SystemMetadataKey.MediaLocation, { location: current });
      }
    });
  }

  @OnJob({ name: JobName.FileDelete, queue: QueueName.BackgroundTask })
  async handleDeleteFiles(job: JobOf<JobName.FileDelete>): Promise<JobStatus> {
    const { files } = job;

    // TODO: one job per file
    for (const file of files) {
      if (!file) {
        continue;
      }

      try {
        const backend = await this.backendMedia.backendFor(file);
        await backend.delete(file);
      } catch (error: any) {
        this.logger.warn('Unable to remove file', error);
      }
    }

    return JobStatus.Success;
  }

  private async verifyReadAccess(folder: StorageFolder) {
    const { internalPath, externalPath } = this.getMountFilePaths(folder);
    try {
      await this.storageRepository.readFile(internalPath);
    } catch (error) {
      this.logger.error(`Failed to read (${internalPath}): ${error}`);
      throw new ImmichStartupError(`Failed to read: "${externalPath} (${internalPath}) - ${docsMessage}"`);
    }
  }

  private async createMountFile(folder: StorageFolder) {
    const { folderPath, internalPath, externalPath } = this.getMountFilePaths(folder);
    try {
      this.storageRepository.mkdirSync(folderPath);
      await this.storageRepository.createFile(internalPath, Buffer.from(Date.now().toString()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        this.logger.warn('Found existing mount file, skipping creation');
        return;
      }
      this.logger.error(`Failed to create ${internalPath}: ${error}`);
      throw new ImmichStartupError(`Failed to create "${externalPath} - ${docsMessage}"`);
    }
  }

  private async verifyWriteAccess(folder: StorageFolder) {
    const { internalPath, externalPath } = this.getMountFilePaths(folder);
    try {
      await this.storageRepository.overwriteFile(internalPath, Buffer.from(Date.now().toString()));
    } catch (error) {
      this.logger.error(`Failed to write ${internalPath}: ${error}`);
      throw new ImmichStartupError(`Failed to write "${externalPath} - ${docsMessage}"`);
    }
  }

  private getMountFilePaths(folder: StorageFolder) {
    const folderPath = StorageCore.getBaseFolder(folder);
    const internalPath = join(folderPath, '.immich');
    const externalPath = `<UPLOAD_LOCATION>/${folder}/.immich`;

    return { folderPath, internalPath, externalPath };
  }
}
