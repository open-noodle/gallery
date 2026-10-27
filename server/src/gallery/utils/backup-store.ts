import { Injectable } from '@nestjs/common';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { S3StorageBackend, S3StorageConfig } from 'src/backends/s3-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { StorageFolder } from 'src/enum.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { getConfig } from 'src/utils/config.js';

/**
 * Backups live under `backups/` on both backends, which is `StorageFolder.Backups` — the folder upstream
 * already reserves for them under the media location. Media keys are namespaced by the other five
 * `StorageFolder` values (`upload/`, `library/`, `thumbs/`, `encoded-video/`, `profile/`), so sharing the
 * media bucket cannot collide with them, and the bucket ends up mirroring the on-disk layout. Fixing it
 * rather than configuring it is what makes that guarantee hold: there is no setting an admin can get
 * wrong, and the staging and remote keys are the same string.
 */
export const BACKUP_PREFIX = `${StorageFolder.Backups}/`;

/**
 * Where a database backup lives.
 *
 * `staging` is always the disk backend: `pg_dump` writes there, and a backup that fails to reach S3 stays
 * there rather than being lost. It is typed as the concrete `DiskStorageBackend` (not the `StorageBackend`
 * interface) because the local-only promote needs its disk-only `rename`.
 *
 * `remote` is present only when the gate in {@link BackupStoreResolver.resolve} is satisfied. Both backends
 * take the same key, so there is one `key()` rather than one per backend.
 */
export interface BackupStore {
  staging: DiskStorageBackend;
  remote?: { backend: StorageBackend; bucket: string };
  key: (filename: string) => string;
  prefix: string;
}

/**
 * Cross-field rule for the `ConfigValidate` event. It cannot be a `superRefine` on the config schema: those
 * schemas feed `createZodDto` and OpenAPI generation (see src/utils/config.ts), which a refinement would not
 * survive. Without this an admin could reach a state over the API that the UI never offers, because the UI
 * hides the whole group when the storage backend is not S3.
 */
export const validateBackupS3Config = (
  newConfig: SystemConfig,
  oldConfig: SystemConfig,
  env: { storage: { backend: 'disk' | 's3' } },
): void => {
  // Only a save that TURNS IT ON is rejected. Rejecting any config whose flag is already on would brick
  // every unrelated admin save once IMMICH_STORAGE_BACKEND stopped being s3 — and since the UI hides the
  // whole group off the S3 backend, there would be no control left to turn it off with. An already-on flag
  // on a disk-backed server is handled where it matters instead: `resolve()` degrades to local-only.
  const turningOn = newConfig.backup.database.s3.enabled && !oldConfig.backup.database.s3.enabled;
  if (turningOn && env.storage.backend !== 's3') {
    throw new Error(
      'Database backups can only be uploaded to S3 while the server is running on the S3 storage backend. Set IMMICH_STORAGE_BACKEND=s3 first, or leave this off.',
    );
  }
};

/**
 * Resolves where the next database backup goes. `resolve()` reads the config fresh on every call, so an admin
 * edit applies without restarting the server; only the S3 client is cached, and it is rebuilt when the
 * resolved settings change.
 *
 * A provider rather than a static, so the backup service can be given a stub, and so the S3 client is owned by
 * something with a lifecycle rather than by module scope.
 */
@Injectable()
export class BackupStoreResolver {
  private cached?: { signature: string; backend: StorageBackend };
  private warned?: string;
  /** Overridden in tests so no real S3 client is built. */
  protected createS3Backend: (config: S3StorageConfig) => StorageBackend = (config) => new S3StorageBackend(config);

  constructor(
    private readonly configRepository: ConfigRepository,
    private readonly storageRepository: StorageRepository,
    private readonly systemMetadataRepository: SystemMetadataRepository,
    private readonly logger: LoggingRepository,
  ) {
    this.logger.setContext(BackupStoreResolver.name);
  }

  async resolve(): Promise<BackupStore> {
    const store: BackupStore = {
      staging: new DiskStorageBackend(StorageCore.getMediaLocation(), this.storageRepository),
      key: (filename: string) => `${BACKUP_PREFIX}${filename}`,
      prefix: BACKUP_PREFIX,
    };

    const config = await getConfig(
      {
        configRepo: this.configRepository,
        metadataRepo: this.systemMetadataRepository,
        logger: this.logger,
      },
      { withCache: false },
    );
    if (!config.backup.database.s3.enabled) {
      return store;
    }

    // Degrade to local-only rather than failing the backup: an admin who sets IMMICH_STORAGE_BACKEND back to
    // disk should still get backups, and the ConfigValidate guard already stops this state being reached by a
    // save.
    const env = this.configRepository.getEnv();
    if (env.storage.backend !== 's3') {
      this.warnOnce(
        'local-backend',
        'Database backups are configured to upload to S3, but the server storage backend is not S3. Keeping backups on local disk only.',
      );
      return store;
    }

    // The same bucket media is written to: the gate guarantees an S3 media backend, so this is the only bucket
    // the server is credentialed for. BACKUP_PREFIX is what keeps the dumps out of the media key space.
    const { bucket } = env.storage.s3;
    if (!bucket) {
      this.warnOnce(
        'no-bucket',
        'Database backups are configured to upload to S3, but IMMICH_S3_BUCKET is not set. Keeping backups on local disk only.',
      );
      return store;
    }

    store.remote = { backend: this.getRemoteBackend(env.storage.s3), bucket };
    this.warned = undefined;

    return store;
  }

  private getRemoteBackend(config: S3StorageConfig): StorageBackend {
    // Media's serve mode is not inherited. In `redirect` mode `getServeStrategy` answers with a presigned
    // URL valid for IMMICH_S3_PRESIGNED_URL_EXPIRY (3600s by default), and anyone holding that URL can
    // fetch it with no Immich session: acceptable for a thumbnail, not for a full database dump, which
    // carries every user's hashed password and session tokens. Forcing `proxy` keeps the download on the
    // authenticated admin route, where the Permission.BackupDownload check actually applies.
    const backupConfig: S3StorageConfig = { ...config, serveMode: 'proxy' };
    // `accessKeyId` is part of the identity of the client, so a rotated credential rebuilds it; the secret is
    // not included, since a signature is a cache key and nothing more.
    const signature = JSON.stringify([config.bucket, config.region, config.endpoint, config.accessKeyId]);
    if (this.cached?.signature !== signature) {
      this.cached = { signature, backend: this.createS3Backend(backupConfig) };
      this.logger.log(`Database backups will be uploaded to S3 (bucket: ${config.bucket}, prefix: ${BACKUP_PREFIX})`);
    }
    return this.cached.backend;
  }

  /** The backup job runs on a cron, so an unchanged misconfiguration must not fill the log. */
  private warnOnce(reason: string, message: string) {
    if (this.warned === reason) {
      return;
    }
    this.warned = reason;
    this.logger.warn(message);
  }
}
