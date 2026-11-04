import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
 * The local staging folder uses `StorageFolder.Backups`. A separate remote target uses its own configured
 * prefix, while legacy S3-backup configuration continues using the reserved `backups/` prefix in the media
 * bucket.
 */
export const BACKUP_PREFIX = `${StorageFolder.Backups}/`;

/**
 * Where a database backup lives.
 *
 * `staging` is always the disk backend: `pg_dump` writes there, and a backup that fails to reach S3 stays
 * there rather than being lost. It is typed as the concrete `DiskStorageBackend` (not the `StorageBackend`
 * interface) because staging writes need its disk-only `rename`.
 *
 * `remote` is present only when the gate in {@link BackupStoreResolver.resolve} is satisfied. Both backends
 * have their own key function because the independent cloud destination uses a configurable prefix.
 */
export interface BackupStore {
  staging: DiskStorageBackend;
  destination: 'local' | 'cloud' | 'both';
  remote?: { backend: StorageBackend; bucket: string; prefix: string };
  key: (filename: string) => string;
  remoteKey: (filename: string) => string;
  prefix: string;
}

const normalizeBackupPrefix = (prefix: string): string => {
  const normalized = prefix.trim().replaceAll(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error('IMMICH_BACKUP_S3_PREFIX must be a non-empty relative object prefix without ".." segments.');
  }
  return normalized;
};

/**
 * Cross-field rule for the `ConfigValidate` event. It cannot be a `superRefine` on the config schema: those
 * schemas feed `createZodDto` and OpenAPI generation (see src/utils/config.ts), which a refinement would not
 * survive. Without this an admin could select a cloud destination before its deployment-managed target is
 * configured.
 */
export const validateBackupS3Config = (
  newConfig: SystemConfig,
  oldConfig: SystemConfig,
  env: { storage: { backend: 'disk' | 's3' } },
): void => {
  // Only a save that turns the deprecated flag on is rejected. An already-on legacy flag on a disk-backed
  // server is handled where it matters instead: `resolve()` degrades to local-only.
  const turningOn = newConfig.backup.database.s3.enabled && !oldConfig.backup.database.s3.enabled;
  if (turningOn && env.storage.backend !== 's3') {
    throw new Error(
      'Database backups can only be uploaded to S3 while the server is running on the S3 storage backend. Set IMMICH_STORAGE_BACKEND=s3 first, or leave this off.',
    );
  }
};

export const validateBackupDestinationConfig = (
  newConfig: SystemConfig,
  oldConfig: SystemConfig,
  env: {
    storage: { backend: 'disk' | 's3'; s3: { bucket: string } };
    backupS3: {
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      prefix?: string;
    };
  },
): void => {
  const isLegacyCloudDestination = (config: SystemConfig) =>
    config.backup.database.destination === 'cloud' && config.backup.database.s3.enabled;
  const isSeparateCloudDestination = (config: SystemConfig) =>
    config.backup.database.destination !== 'local' && !isLegacyCloudDestination(config);
  if (!isSeparateCloudDestination(newConfig) || isSeparateCloudDestination(oldConfig)) {
    return;
  }

  if (newConfig.backup.database.s3.enabled) {
    if (env.storage.backend !== 's3' || !env.storage.s3.bucket) {
      throw new Error(
        'Legacy S3 database backups require IMMICH_STORAGE_BACKEND=s3 and IMMICH_S3_BUCKET. Configure a separate IMMICH_BACKUP_S3_* target to use cloud backups with any media backend.',
      );
    }
    return;
  }

  const { bucket, prefix, accessKeyId, secretAccessKey } = env.backupS3;
  if (!bucket?.trim() || !prefix?.trim()) {
    throw new Error('Cloud database backups require IMMICH_BACKUP_S3_BUCKET and a unique IMMICH_BACKUP_S3_PREFIX.');
  }
  normalizeBackupPrefix(prefix);
  if (!!accessKeyId !== !!secretAccessKey) {
    throw new Error('Set both IMMICH_BACKUP_S3_ACCESS_KEY_ID and IMMICH_BACKUP_S3_SECRET_ACCESS_KEY, or neither.');
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
      destination: 'local',
      key: (filename: string) => `${BACKUP_PREFIX}${filename}`,
      remoteKey: (filename: string) => `${BACKUP_PREFIX}${filename}`,
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
    const legacyS3 = config.backup.database.destination === 'cloud' && config.backup.database.s3.enabled;
    store.destination = config.backup.database.destination;
    if (store.destination === 'local') {
      return store;
    }

    const env = this.configRepository.getEnv();
    if (!legacyS3) {
      const { region, endpoint, accessKeyId, secretAccessKey, prefix } = env.backupS3;
      const bucket = env.backupS3.bucket?.trim();
      if (!bucket || !prefix?.trim()) {
        throw new Error(
          'Cloud database backups are selected, but IMMICH_BACKUP_S3_BUCKET or IMMICH_BACKUP_S3_PREFIX is missing.',
        );
      }
      if (!!accessKeyId !== !!secretAccessKey) {
        throw new Error('Set both IMMICH_BACKUP_S3_ACCESS_KEY_ID and IMMICH_BACKUP_S3_SECRET_ACCESS_KEY, or neither.');
      }

      const normalizedPrefix = normalizeBackupPrefix(prefix);

      store.remote = {
        backend: this.getRemoteBackend({
          bucket,
          region,
          endpoint,
          accessKeyId,
          secretAccessKey,
          presignedUrlExpiry: 3600,
          serveMode: 'proxy',
        }),
        bucket,
        prefix: `${normalizedPrefix}/`,
      };
      store.remoteKey = (filename: string) => `${normalizedPrefix}/${filename}`;
      return store;
    }

    // Legacy configurations keep using the media bucket and its existing credentials.
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

    store.remote = { backend: this.getRemoteBackend(env.storage.s3), bucket, prefix: BACKUP_PREFIX };
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
    const secretFingerprint = config.secretAccessKey
      ? createHash('sha256').update(config.secretAccessKey).digest('hex')
      : undefined;
    const signature = JSON.stringify([
      config.bucket,
      config.region,
      config.endpoint,
      config.accessKeyId,
      secretFingerprint,
    ]);
    if (this.cached?.signature !== signature) {
      this.cached = { signature, backend: this.createS3Backend(backupConfig) };
      this.logger.log(`Database backups will use S3-compatible object storage (bucket: ${config.bucket})`);
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
