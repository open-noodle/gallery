import { Reflector } from '@nestjs/core';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceModule } from 'src/app.module.js';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { S3StorageConfig } from 'src/backends/s3-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { SystemConfig, defaults } from 'src/dtos/config.dto.js';
import { StorageFolder } from 'src/enum.js';
import {
  BACKUP_PREFIX,
  BackupStoreResolver,
  validateBackupDestinationConfig,
  validateBackupS3Config,
} from 'src/gallery/utils/backup-store.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { DatabaseBackupService } from 'src/services/database-backup.service.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { ServiceMocks, getMocks } from 'test/utils.js';

/** Points the config source at an `IMMICH_CONFIG_FILE` holding `yaml`, on an S3 media backend. */
const configFileOnS3 = (mocks: ServiceMocks, yaml: string) => {
  mocks.config.getEnv.mockReturnValue(
    mockEnvData({ configFile: '/data/config.yaml', storage: { backend: 's3', s3: { bucket: 'media' } as never } }),
  );
  mocks.systemMetadata.readFile.mockResolvedValue(yaml);
};

/** Overrides the one seam that would otherwise build a real S3 client. */
class TestBackupStoreResolver extends BackupStoreResolver {
  readonly built: S3StorageConfig[] = [];

  constructor(...args: ConstructorParameters<typeof BackupStoreResolver>) {
    super(...args);
    this.createS3Backend = (config) => {
      this.built.push(config);
      return { id: `s3:${config.bucket}` } as unknown as StorageBackend;
    };
  }
}

describe('BackupStoreResolver', () => {
  let sut: TestBackupStoreResolver;
  let mocks: ServiceMocks;

  const withS3Config = (s3: { enabled?: boolean }) =>
    mocks.systemMetadata.get.mockResolvedValue({ backup: { database: { s3 } } });
  const withDestination = (destination: 'local' | 'cloud' | 'both', s3?: { enabled?: boolean }) =>
    mocks.systemMetadata.get.mockResolvedValue({ backup: { database: { destination, s3: s3 ?? { enabled: false } } } });

  const onS3 = (bucket = 'media') =>
    mocks.config.getEnv.mockReturnValue(mockEnvData({ storage: { backend: 's3', s3: { bucket } as never } }));
  const onBackupS3 = (overrides: { bucket?: string; prefix?: string; secretAccessKey?: string } = {}) =>
    mocks.config.getEnv.mockReturnValue(
      mockEnvData({
        backupS3: {
          bucket: overrides.bucket ?? 'backup-bucket',
          region: 'eu-central-1',
          endpoint: 'http://minio:9000',
          accessKeyId: 'backup-key',
          secretAccessKey: overrides.secretAccessKey ?? 'backup-secret',
          prefix: overrides.prefix ?? 'gallery/instance-a',
        },
      }),
    );

  beforeEach(() => {
    mocks = getMocks();
    sut = new TestBackupStoreResolver(
      mocks.config,
      mocks.storage as never,
      mocks.systemMetadata as never,
      mocks.logger as never,
    );
  });

  it('always resolves a disk staging backend, keyed under the backups folder', async () => {
    const store = await sut.resolve();

    expect(store.staging).toBeInstanceOf(DiskStorageBackend);
    expect(store.key('immich-db-backup-1.sql.gz')).toBe('backups/immich-db-backup-1.sql.gz');
    expect(store.prefix).toBe('backups/');
  });

  // Nothing else pins the root, and a staging backend built with the wrong media location would resolve
  // `backups/...` against the process cwd — writing dumps somewhere nothing ever reads or prunes.
  it('roots the staging backend at the media location', async () => {
    const store = await sut.resolve();

    await expect(store.staging.getReadableUrl('backups/one.sql.gz')).resolves.toBe(
      join(StorageCore.getMediaLocation(), 'backups', 'one.sql.gz'),
    );
  });

  // The fixed prefix is the whole separation guarantee: `backups` is StorageFolder.Backups, and every media
  // key is namespaced by one of the other five values, so sharing the media bucket cannot collide.
  it('uses the reserved backups folder as its prefix on both backends', () => {
    expect(BACKUP_PREFIX).toBe(`${StorageFolder.Backups}/`);
    expect([
      StorageFolder.Upload,
      StorageFolder.Library,
      StorageFolder.Thumbnails,
      StorageFolder.EncodedVideo,
      StorageFolder.Profile,
    ]).not.toContain(StorageFolder.Backups);
  });

  describe('the gate', () => {
    it('leaves the remote unset by default (upstream behaviour out of the box)', async () => {
      const store = await sut.resolve();

      expect(defaults.backup.database.s3.enabled).toBe(false);
      expect(store.remote).toBeUndefined();
    });

    describe('independent cloud destination', () => {
      it('resolves cloud and both destinations without requiring the media backend to use S3', async () => {
        withDestination('both');
        mocks.config.getEnv.mockReturnValue(
          mockEnvData({
            backupS3: {
              bucket: 'backup-bucket',
              region: 'eu-central-1',
              endpoint: 'http://minio:9000',
              accessKeyId: 'backup-key',
              secretAccessKey: 'backup-secret',
              prefix: 'gallery/instance-a/',
            },
          }),
        );

        const store = await sut.resolve();

        expect(store.destination).toBe('both');
        expect(store.remote?.bucket).toBe('backup-bucket');
        expect(store.remote?.prefix).toBe('gallery/instance-a/');
        expect(store.remoteKey('backup.sql.gz')).toBe('gallery/instance-a/backup.sql.gz');
        expect(store.key('backup.sql.gz')).toBe('backups/backup.sql.gz');
        expect(sut.built).toEqual([
          {
            bucket: 'backup-bucket',
            region: 'eu-central-1',
            endpoint: 'http://minio:9000',
            accessKeyId: 'backup-key',
            secretAccessKey: 'backup-secret',
            presignedUrlExpiry: 3600,
            serveMode: 'proxy',
          },
        ]);
      });

      it('rejects cloud destinations without a bucket or unique prefix', async () => {
        withDestination('cloud');
        onBackupS3({ bucket: 'backup-bucket', prefix: '  ' });

        await expect(sut.resolve()).rejects.toThrow(/IMMICH_BACKUP_S3_BUCKET or IMMICH_BACKUP_S3_PREFIX/);
      });

      it('rejects incomplete static credentials', async () => {
        withDestination('cloud');
        mocks.config.getEnv.mockReturnValue(
          mockEnvData({
            backupS3: {
              bucket: 'backup-bucket',
              region: 'us-east-1',
              accessKeyId: 'backup-key',
              secretAccessKey: undefined,
              prefix: 'gallery/instance-a',
            },
          }),
        );

        await expect(sut.resolve()).rejects.toThrow(/Set both IMMICH_BACKUP_S3_ACCESS_KEY_ID/);
      });

      it('rejects object prefixes containing parent-directory segments', async () => {
        withDestination('cloud');
        onBackupS3({ prefix: 'gallery/../other' });

        await expect(sut.resolve()).rejects.toThrow(/without "\.\." segments/);
      });
    });

    it('leaves the remote unset when the storage backend is not s3, and warns', async () => {
      withS3Config({ enabled: true });
      mocks.config.getEnv.mockReturnValue(mockEnvData({ storage: { backend: 'disk' } }));

      const store = await sut.resolve();

      expect(store.remote).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('storage backend is not S3'));
    });

    it('leaves the remote unset when IMMICH_S3_BUCKET is not set, and warns', async () => {
      withS3Config({ enabled: true });
      onS3('');

      const store = await sut.resolve();

      expect(store.remote).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('IMMICH_S3_BUCKET is not set'));
    });

    it('warns only once while the same misconfiguration persists', async () => {
      withS3Config({ enabled: true });
      mocks.config.getEnv.mockReturnValue(mockEnvData({ storage: { backend: 'disk' } }));

      await sut.resolve();
      await sut.resolve();
      await sut.resolve();

      expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('resolves a remote when the backend is s3, the flag is on and a bucket is configured', async () => {
      withS3Config({ enabled: true });
      onS3();

      const store = await sut.resolve();

      expect(store.remote?.bucket).toBe('media');
      // the same key on both backends, so a promote never rewrites it
      expect(store.key('immich-db-backup-1.sql.gz')).toBe('backups/immich-db-backup-1.sql.gz');
    });
  });

  // IMMICH_CONFIG_FILE is the other way to set this, and the one an admin on the S3 backend is most
  // likely to be using: the whole Backup section is read-only in the UI in that mode. The schema is
  // shared with the database path, so what these pin is that the flag survives YAML (where a boolean may
  // arrive as a string) and that the resolver reads it from there.
  describe('from a config file', () => {
    it('turns S3 backups on', async () => {
      configFileOnS3(mocks, 'backup:\n  database:\n    s3:\n      enabled: true\n');

      const store = await sut.resolve();

      expect(store.remote?.bucket).toBe('media');
    });

    it('turns S3 backups off', async () => {
      configFileOnS3(mocks, 'backup:\n  database:\n    s3:\n      enabled: false\n');

      const store = await sut.resolve();

      expect(store.remote).toBeUndefined();
    });

    it('leaves them off when the file says nothing about them', async () => {
      configFileOnS3(mocks, 'backup:\n  database:\n    keepLastAmount: 7\n');

      const store = await sut.resolve();

      expect(store.remote).toBeUndefined();
    });

    // `galleryConfigBool` exists for this: a quoted YAML boolean must not be read as a truthy string.
    it('coerces a quoted boolean', async () => {
      configFileOnS3(mocks, `backup:\n  database:\n    s3:\n      enabled: 'true'\n`);
      const on = await sut.resolve();
      expect(on.remote).toBeDefined();

      configFileOnS3(mocks, `backup:\n  database:\n    s3:\n      enabled: 'false'\n`);
      const off = await sut.resolve();
      expect(off.remote).toBeUndefined();
    });

    // The ConfigValidate guard only fires from updateSystemConfig, which config-file mode refuses
    // outright, so this combination reaches the resolver. It must degrade rather than break backups —
    // and say so, since there is no admin UI in this mode to diagnose it from.
    it('degrades to local-only, with a warning, when the file enables it off the S3 backend', async () => {
      mocks.config.getEnv.mockReturnValue(
        mockEnvData({ configFile: '/data/config.yaml', storage: { backend: 'disk' } }),
      );
      mocks.systemMetadata.readFile.mockResolvedValue('backup:\n  database:\n    s3:\n      enabled: true\n');

      const store = await sut.resolve();

      expect(store.remote).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('storage backend is not S3'));
    });
  });

  describe('credential reuse', () => {
    // The whole point of the gate: there is no second set of S3 settings to get wrong, and nothing
    // here comes from the saved config, so no S3 secret is ever stored in the database.
    // A presigned redirect would let anyone holding the URL fetch the whole database dump with no Immich
    // session, for IMMICH_S3_PRESIGNED_URL_EXPIRY seconds. Backups stay on the authenticated admin route.
    it('forces proxy serve mode, whatever media uses', async () => {
      withS3Config({ enabled: true });
      mocks.config.getEnv.mockReturnValue(
        mockEnvData({ storage: { backend: 's3', s3: { bucket: 'media', serveMode: 'redirect' } as never } }),
      );

      await sut.resolve();

      expect(sut.built).toHaveLength(1);
      expect(sut.built[0].serveMode).toBe('proxy');
    });

    it('builds the S3 client from the media settings verbatim, bucket included', async () => {
      withS3Config({ enabled: true });
      const s3 = {
        bucket: 'media',
        region: 'eu-central-1',
        endpoint: 'http://minio:9000',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        presignedUrlExpiry: 900,
        serveMode: 'proxy' as const,
      };
      mocks.config.getEnv.mockReturnValue(mockEnvData({ storage: { backend: 's3', s3 } }));

      const store = await sut.resolve();

      expect(sut.built).toEqual([{ ...s3, serveMode: 'proxy' }]);
      expect(store.remote?.bucket).toBe('media');
    });
  });

  describe('client caching', () => {
    beforeEach(() => {
      onS3();
    });

    it('reuses the client across resolves while the settings are unchanged', async () => {
      withS3Config({ enabled: true });

      const first = await sut.resolve();
      const second = await sut.resolve();

      expect(sut.built).toHaveLength(1);
      expect(second.remote?.backend).toBe(first.remote?.backend);
    });

    it('rebuilds the client when the media bucket changes under it', async () => {
      withS3Config({ enabled: true });
      await sut.resolve();

      onS3('other-media');
      const store = await sut.resolve();

      expect(sut.built.map(({ bucket }) => bucket)).toEqual(['media', 'other-media']);
      expect(store.remote?.bucket).toBe('other-media');
    });

    it('rebuilds the independent cloud client when its secret changes', async () => {
      withDestination('cloud');
      onBackupS3();
      await sut.resolve();

      onBackupS3({ secretAccessKey: 'rotated-secret' });
      await sut.resolve();

      expect(sut.built).toHaveLength(2);
      expect(sut.built[1].secretAccessKey).toBe('rotated-secret');
    });

    it('reads the config fresh on every resolve, so an admin edit applies without a restart', async () => {
      withS3Config({ enabled: false });
      const offStore = await sut.resolve();
      expect(offStore.remote).toBeUndefined();

      withS3Config({ enabled: true });
      const onStore = await sut.resolve();
      expect(onStore.remote).toBeDefined();
    });
  });
});

const configWith = (enabled: boolean) =>
  ({ backup: { database: { ...defaults.backup.database, s3: { enabled } } } }) as SystemConfig;

const destinationConfig = (destination: 'local' | 'cloud' | 'both', legacyS3 = false) =>
  ({
    backup: {
      database: { ...defaults.backup.database, destination, s3: { enabled: legacyS3 } },
    },
  }) as SystemConfig;

describe('validateBackupS3Config', () => {
  it('refuses a save that turns S3 backups on while the storage backend is disk', () => {
    expect(() => validateBackupS3Config(configWith(true), configWith(false), { storage: { backend: 'disk' } })).toThrow(
      /S3 storage backend/,
    );
  });

  describe('validateBackupDestinationConfig', () => {
    const env = {
      storage: { backend: 'disk' as const, s3: { bucket: '' } },
      backupS3: {
        bucket: 'backup-bucket',
        prefix: 'gallery/instance-a',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    };

    it('allows selecting local backups without cloud settings', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('local'), destinationConfig('local'), {
          ...env,
          backupS3: { ...env.backupS3, bucket: undefined, prefix: undefined },
        }),
      ).not.toThrow();
    });

    it('requires an independent cloud target when moving from local to cloud', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('cloud'), destinationConfig('local'), {
          ...env,
          backupS3: { ...env.backupS3, bucket: undefined },
        }),
      ).toThrow(/IMMICH_BACKUP_S3_BUCKET and a unique IMMICH_BACKUP_S3_PREFIX/);
    });

    it('rejects unsafe object prefixes before saving the destination', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('cloud'), destinationConfig('local'), {
          ...env,
          backupS3: { ...env.backupS3, prefix: 'gallery/../other' },
        }),
      ).toThrow(/without "\.\." segments/);
    });

    it('validates a new independent target when switching legacy cloud backups to both', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('both'), destinationConfig('cloud', true), {
          ...env,
          backupS3: { ...env.backupS3, prefix: undefined },
        }),
      ).toThrow(/IMMICH_BACKUP_S3_BUCKET and a unique IMMICH_BACKUP_S3_PREFIX/);
    });

    it('allows switching legacy cloud backups to both when the independent target is configured', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('both'), destinationConfig('cloud', true), env),
      ).not.toThrow();
    });

    it('does not revalidate an already selected independent target during unrelated saves', () => {
      expect(() =>
        validateBackupDestinationConfig(destinationConfig('cloud'), destinationConfig('cloud'), {
          ...env,
          backupS3: { ...env.backupS3, bucket: undefined },
        }),
      ).not.toThrow();
    });
  });

  it('allows turning S3 backups on on the s3 storage backend', () => {
    expect(() =>
      validateBackupS3Config(configWith(true), configWith(false), { storage: { backend: 's3' } }),
    ).not.toThrow();
  });

  it('allows a disk-backed server to leave S3 backups off', () => {
    expect(() =>
      validateBackupS3Config(configWith(false), configWith(false), { storage: { backend: 'disk' } }),
    ).not.toThrow();
  });

  // Regression: rejecting any config whose flag is already on would brick EVERY admin config save once
  // IMMICH_STORAGE_BACKEND stopped being s3 — and the UI hides the group off S3, so nothing could turn it
  // off again. Only the transition is validated; an already-on flag degrades to local-only in resolve().
  it('allows an unrelated save while the flag is already on and the backend is no longer s3', () => {
    expect(() =>
      validateBackupS3Config(configWith(true), configWith(true), { storage: { backend: 'disk' } }),
    ).not.toThrow();
  });

  it('allows turning it off again from a disk-backed server', () => {
    expect(() =>
      validateBackupS3Config(configWith(false), configWith(true), { storage: { backend: 'disk' } }),
    ).not.toThrow();
  });
});

/**
 * The maintenance worker lists its providers explicitly rather than spreading `services`, so a new
 * dependency on `DatabaseBackupService` has to be named there as well. Missing it is a boot failure
 * in the restore flow only — no type check and no other spec would catch it.
 */
describe('maintenance worker wiring', () => {
  // `Reflector` rather than `Reflect.getMetadata` directly: same lookup, without reaching for a
  // non-standard builtin property the lint rules reject.
  const reflector = new Reflector();
  const providers = () => reflector.get<unknown[]>('providers', MaintenanceModule) ?? [];

  it('provides every non-optional dependency DatabaseBackupService injects', () => {
    const provided = new Set(providers());
    const paramTypes = reflector.get<unknown[]>('design:paramtypes', DatabaseBackupService) ?? [];
    const optional = new Set(reflector.get<number[]>('optional:paramtypes', DatabaseBackupService));

    const unprovided = paramTypes
      .map((type, index) => ({ type, index }))
      .filter(({ type, index }) => !optional.has(index) && !provided.has(type))
      .map(({ type }) => (type as { name?: string })?.name ?? 'unknown');

    expect(unprovided).toEqual([]);
  });

  it('provides the backup store resolver', () => {
    expect(providers()).toContain(BackupStoreResolver);
  });
});
