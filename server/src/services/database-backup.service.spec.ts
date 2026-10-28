import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Duplex, PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { SystemConfig, defaults } from 'src/dtos/config.dto.js';
import { ImmichWorker, JobStatus } from 'src/enum.js';
import { BackupStore } from 'src/gallery/utils/backup-store.js';
import { MaintenanceHealthRepository } from 'src/maintenance/maintenance-health.repository.js';
import { DatabaseBackupService } from 'src/services/database-backup.service.js';
import { systemConfigStub } from 'test/fixtures/system-config.stub.js';
import { AutoMocked, ServiceMocks, automock, getMocks, mockDuplex, mockSpawn } from 'test/utils.js';

/**
Every backup file operation now goes through a storage backend, so these are the seams the service is
asserted against.

Deliberately STATEFUL, tracking the keys it holds: a fake whose `get` succeeds for any key and whose
`list` ignores what was written would pass a service that promoted the wrong key or forgot to write at
all, and would make the dump-then-promote flow untestable end to end. `put` drains its source, because
the dump pipeline only completes once something has consumed the gzip output, exactly as a real backend
does. Tests that only care about one call still override the individual mocks.
*/
const fakeBackend = () => {
  const held = new Map<string, number>();

  const backend = {
    held,
    seed: (...keys: string[]) => {
      for (const key of keys) {
        held.set(key, 1);
      }
    },
    put: vitest.fn(async (key: string, source: Readable | Buffer) => {
      const body = Buffer.isBuffer(source) ? source : await buffer(source);
      held.set(key, body.length);
    }),
    get: vitest.fn((key: string) => {
      if (!held.has(key)) {
        return Promise.reject(new Error(`ENOENT: ${key}`));
      }
      return Promise.resolve({ stream: Readable.from(mockData()) });
    }),
    delete: vitest.fn((key: string) => {
      held.delete(key);
      return Promise.resolve();
    }),
    exists: vitest.fn((key: string) => Promise.resolve(held.has(key))),
    list: vitest.fn((prefix: string) =>
      Promise.resolve(
        held
          .entries()
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, size]) => ({ key, size }))
          .toArray(),
      ),
    ),
    rename: vitest.fn((from: string, to: string) => {
      const size = held.get(from);
      if (size === undefined) {
        return Promise.reject(new Error(`ENOENT: ${from}`));
      }
      held.delete(from);
      held.set(to, size);
      return Promise.resolve();
    }),
    getServeStrategy: vitest.fn((key: string) => Promise.resolve({ type: 'file' as const, path: `/data/${key}` })),
  };

  return backend;
};

type FakeBackend = ReturnType<typeof fakeBackend>;

const listingUnder =
  // eslint-disable-next-line unicorn/no-unnecessary-parameters
  (prefix: string) =>
    (...filenames: string[]) =>
      filenames.map((filename) => ({ key: `${prefix}${filename}`, size: 1 }));

const configWithS3 = (enabled: boolean) =>
  ({ backup: { database: { ...defaults.backup.database, s3: { enabled } } } }) as SystemConfig;

/** Shaped like the AWS SDK's service errors: the error code is the `name`. */
class AccessDeniedError extends Error {
  override name = 'AccessDenied';
}

const keepLastConfig = (keepLastAmount: number) => ({
  backup: { database: { ...systemConfigStub.backupEnabled.backup.database, keepLastAmount } },
});

describe(DatabaseBackupService.name, () => {
  let sut: DatabaseBackupService;
  let mocks: ServiceMocks;
  let maintenanceHealthRepositoryMock: AutoMocked<MaintenanceHealthRepository>;
  let staging: FakeBackend;
  let remote: FakeBackend;
  let store: BackupStore;
  let resolver: { resolve: () => Promise<BackupStore> };

  /** Turns the remote on for a test, as a configured S3 bucket would. */
  const enableRemote = () => {
    store.remote = { backend: remote as never, bucket: 'media' };
  };

  beforeEach(() => {
    mocks = getMocks();
    mocks.process.isCommandAvailable.mockResolvedValue(false);
    staging = fakeBackend();
    remote = fakeBackend();
    store = { staging: staging as never, key: (filename) => `backups/${filename}`, prefix: 'backups/' };
    resolver = { resolve: () => Promise.resolve(store) };
    maintenanceHealthRepositoryMock = automock(MaintenanceHealthRepository, {
      args: [mocks.logger],
      strict: false,
    });
    sut = new DatabaseBackupService(
      mocks.logger as never,
      mocks.storage as never,
      mocks.config,
      mocks.systemMetadata as never,
      mocks.process,
      mocks.database as never,
      mocks.user as never,
      mocks.cron as never,
      mocks.job as never,
      maintenanceHealthRepositoryMock as never,
      resolver as never,
    );
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onBootstrapEvent', () => {
    it('should init cron job and handle config changes', async () => {
      mocks.database.tryLock.mockResolvedValue(true);
      mocks.cron.create.mockResolvedValue();

      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).toHaveBeenCalled();
    });

    it('should not initialize backup database cron job when lock is taken', async () => {
      mocks.database.tryLock.mockResolvedValue(false);

      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).not.toHaveBeenCalled();
    });

    it('should not initialise backup database job when running on microservices', async () => {
      mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdateEvent', () => {
    beforeEach(async () => {
      mocks.database.tryLock.mockResolvedValue(true);
      mocks.cron.create.mockResolvedValue();

      await sut.onConfigInit({ newConfig: defaults });
    });

    it('should update cron job if backup is enabled', () => {
      mocks.cron.update.mockResolvedValue();

      sut.onConfigUpdate({
        oldConfig: defaults,
        newConfig: {
          backup: {
            database: {
              enabled: true,
              cronExpression: '0 1 * * *',
            },
          },
        } as SystemConfig,
      });

      expect(mocks.cron.update).toHaveBeenCalledWith({ name: 'backupDatabase', expression: '0 1 * * *', start: true });
      expect(mocks.cron.update).toHaveBeenCalled();
    });

    it('should do nothing if instance does not have the backup database lock', async () => {
      mocks.database.tryLock.mockResolvedValue(false);
      await sut.onConfigInit({ newConfig: defaults });
      sut.onConfigUpdate({ newConfig: systemConfigStub.backupEnabled as SystemConfig, oldConfig: defaults });
      expect(mocks.cron.update).not.toHaveBeenCalled();
    });
  });

  describe('cleanupDatabaseBackups', () => {
    const listing = listingUnder('backups/');
    const remoteListing = listingUnder('backups/');

    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
    });

    it('should do nothing if not reached keepLastAmount', async () => {
      staging.seed(...listing('immich-db-backup-1.sql.gz').map(({ key }) => key));
      await sut.cleanupDatabaseBackups();
      expect(staging.delete).not.toHaveBeenCalled();
    });

    it('should remove failed backup files', async () => {
      staging.list.mockResolvedValue(
        listing(
          'immich-db-backup-123.sql.gz.tmp',
          `immich-db-backup-${DateTime.fromISO('2025-07-25T11:02:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz.tmp`,
          `immich-db-backup-${DateTime.fromISO('2025-07-27T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz`,
          `immich-db-backup-${DateTime.fromISO('2025-07-29T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz.tmp`,
        ),
      );
      await sut.cleanupDatabaseBackups();
      expect(staging.delete).toHaveBeenCalledTimes(3);
      expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-123.sql.gz.tmp');
      expect(staging.delete).toHaveBeenCalledWith(
        'backups/immich-db-backup-20250725T110216-v1.234.5-pg14.5.sql.gz.tmp',
      );
      expect(staging.delete).toHaveBeenCalledWith(
        'backups/immich-db-backup-20250729T110116-v1.234.5-pg14.5.sql.gz.tmp',
      );
    });

    it('should remove old backup files over keepLastAmount', async () => {
      staging.seed(...listing('immich-db-backup-1.sql.gz', 'immich-db-backup-2.sql.gz').map(({ key }) => key));
      await sut.cleanupDatabaseBackups();
      expect(staging.delete).toHaveBeenCalledTimes(1);
      expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
    });

    it('should remove old backup files over keepLastAmount and failed backups', async () => {
      staging.list.mockResolvedValue(
        listing(
          `immich-db-backup-${DateTime.fromISO('2025-07-25T11:02:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz.tmp`,
          `immich-db-backup-${DateTime.fromISO('2025-07-27T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz`,
          'immich-db-backup-1753789649000.sql.gz',
          `immich-db-backup-${DateTime.fromISO('2025-07-29T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz`,
        ),
      );
      await sut.cleanupDatabaseBackups();
      expect(staging.delete).toHaveBeenCalledTimes(3);
      expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1753789649000.sql.gz');
      expect(staging.delete).toHaveBeenCalledWith(
        'backups/immich-db-backup-20250725T110216-v1.234.5-pg14.5.sql.gz.tmp',
      );
      expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-20250727T110116-v1.234.5-pg14.5.sql.gz');
    });

    describe('with S3 enabled', () => {
      beforeEach(() => {
        enableRemote();
      });

      it('should prune the S3 objects over keepLastAmount, not the local folder', async () => {
        staging.held.clear();
        remote.seed(...remoteListing('immich-db-backup-1.sql.gz', 'immich-db-backup-2.sql.gz').map(({ key }) => key));

        await sut.cleanupDatabaseBackups();

        expect(remote.delete).toHaveBeenCalledTimes(1);
        expect(remote.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
      });

      it('should promote a straggler left by a failed upload rather than orphaning it', async () => {
        staging.seed(...listing('immich-db-backup-1.sql.gz').map(({ key }) => key));
        remote.held.clear();

        await sut.cleanupDatabaseBackups();

        expect(remote.put).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz', expect.anything(), {
          contentType: 'application/gzip',
        });
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
      });

      it('should delete a local copy that is already in the bucket without re-uploading it', async () => {
        staging.seed(...listing('immich-db-backup-1.sql.gz').map(({ key }) => key));
        remote.seed(...remoteListing('immich-db-backup-1.sql.gz').map(({ key }) => key));

        await sut.cleanupDatabaseBackups();

        expect(remote.put).not.toHaveBeenCalled();
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
      });

      it('should still sweep local .tmp files, which only ever exist on the staging disk', async () => {
        staging.seed(...listing('immich-db-backup-123.sql.gz.tmp').map(({ key }) => key));
        remote.held.clear();

        await sut.cleanupDatabaseBackups();

        expect(remote.put).not.toHaveBeenCalled();
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-123.sql.gz.tmp');
      });

      it('should leave a restore point alone: it is local by design and never promoted', async () => {
        staging.seed(...listing('restore-point-immich-db-backup-1.sql.gz').map(({ key }) => key));
        remote.held.clear();

        await sut.cleanupDatabaseBackups();

        expect(remote.put).not.toHaveBeenCalled();
        expect(staging.delete).not.toHaveBeenCalled();
      });
    });

    // Backups split across both places: stragglers from failed uploads, backups made before the switch
    // was turned on, and objects left in the bucket after it was turned off.
    describe('with backups on both local disk and S3', () => {
      it('should keep the newest backups whichever side they are on', async () => {
        enableRemote();
        mocks.systemMetadata.get.mockResolvedValue(keepLastConfig(2));
        remote.seed('backups/immich-db-backup-1.sql.gz', 'backups/immich-db-backup-3.sql.gz');
        staging.seed('backups/immich-db-backup-2.sql.gz', 'backups/immich-db-backup-4.sql.gz');
        remote.put.mockRejectedValue(new Error('AccessDenied'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(/media/);

        expect(staging.held.keys().toArray()).toEqual(['backups/immich-db-backup-4.sql.gz']);
        expect(remote.held.keys().toArray()).toEqual(['backups/immich-db-backup-3.sql.gz']);
      });

      it('should upload the local backups made before the switch was turned on', async () => {
        enableRemote();
        mocks.systemMetadata.get.mockResolvedValue(keepLastConfig(14));
        staging.seed(
          'backups/immich-db-backup-1.sql.gz',
          'backups/immich-db-backup-2.sql.gz',
          'backups/uploaded-mine.sql.gz',
          'backups/restore-point-immich-db-backup-0.sql.gz',
        );

        await expect(sut.cleanupDatabaseBackups()).resolves.toBeUndefined();

        expect(remote.held.keys().toArray().toSorted()).toEqual([
          'backups/immich-db-backup-1.sql.gz',
          'backups/immich-db-backup-2.sql.gz',
          'backups/uploaded-mine.sql.gz',
        ]);
        expect(staging.held.keys().toArray()).toEqual(['backups/restore-point-immich-db-backup-0.sql.gz']);
      });

      it('should manage local backups as before, never touching S3, once the switch is turned off', async () => {
        mocks.systemMetadata.get.mockResolvedValue(keepLastConfig(1));
        remote.seed('backups/immich-db-backup-5.sql.gz');
        staging.seed('backups/immich-db-backup-1.sql.gz', 'backups/immich-db-backup-2.sql.gz');

        await expect(sut.cleanupDatabaseBackups()).resolves.toBeUndefined();
        const { backups } = await sut.listBackups();

        expect(staging.held.keys().toArray()).toEqual(['backups/immich-db-backup-2.sql.gz']);
        expect(backups.map(({ filename }) => filename)).toEqual(['immich-db-backup-2.sql.gz']);
        expect(remote.list).not.toHaveBeenCalled();
        expect(remote.delete).not.toHaveBeenCalled();
        expect(remote.held.size).toBe(1);
      });

      it('should list, download and delete a backup wherever it is', async () => {
        enableRemote();
        staging.seed('backups/immich-db-backup-2.sql.gz');
        remote.seed('backups/immich-db-backup-1.sql.gz');

        const { backups } = await sut.listBackups();
        expect(backups.map(({ filename }) => filename)).toEqual([
          'immich-db-backup-2.sql.gz',
          'immich-db-backup-1.sql.gz',
        ]);

        await sut.downloadBackup('immich-db-backup-1.sql.gz');
        await sut.downloadBackup('immich-db-backup-2.sql.gz');
        expect(remote.getServeStrategy).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz', expect.anything());
        expect(staging.getServeStrategy).toHaveBeenCalledWith('backups/immich-db-backup-2.sql.gz', expect.anything());

        await sut.deleteBackup(['immich-db-backup-1.sql.gz', 'immich-db-backup-2.sql.gz']);
        expect(staging.held.size).toBe(0);
        expect(remote.held.size).toBe(0);
      });
    });
  });

  describe('handleBackupDatabase / createDatabaseBackup', () => {
    beforeEach(() => {
      mocks.process.spawn.mockReturnValue(mockSpawn(0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementation(() => mockDuplex()('command', 0, 'data', ''));
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
    });

    it('should sanitize DB_URL (remove uselibpqcompat) before calling pg_dumpall', async () => {
      // create a service instance with a URL connection that includes libpqcompat
      const dbUrl = 'postgresql://postgres:pwd@host:5432/immich?sslmode=require&uselibpqcompat=true';
      const configMock = {
        getEnv: () => ({ database: { config: { connectionType: 'url', url: dbUrl }, skipMigrations: false } }),
        getWorker: () => ImmichWorker.Api,
        isDev: () => false,
      } as unknown as any;

      sut = new DatabaseBackupService(
        mocks.logger as never,
        mocks.storage as never,
        configMock as never,
        mocks.systemMetadata as never,
        mocks.process,
        mocks.database as never,
        mocks.user as never,
        mocks.cron as never,
        mocks.job as never,
        void 0 as never,
        resolver as never,
      );

      mocks.process.spawnDuplexStream.mockImplementation(() => mockDuplex()('command', 0, 'data', ''));
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.database.getPostgresVersion.mockResolvedValue('14.10');

      await sut.handleBackupDatabase();

      expect(mocks.process.spawnDuplexStream).toHaveBeenCalled();
      const call = mocks.process.spawnDuplexStream.mock.calls[0];
      const args = call[1] as string[];
      expect(args).toMatchInlineSnapshot(`
        [
          "postgresql://postgres:pwd@host:5432/immich?sslmode=require",
          "--clean",
          "--if-exists",
        ]
      `);
    });

    it('should abort the backup and remove the temporary file when the signal is aborted', async () => {
      await expect(sut.createDatabaseBackup('', AbortSignal.abort())).rejects.toThrow('The operation was aborted');
      expect(mocks.storage.unlink).toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('should run a database backup successfully', async () => {
      const result = await sut.handleBackupDatabase();
      expect(result).toBe(JobStatus.Success);
      expect(staging.put).toHaveBeenCalledWith(
        expect.stringMatching(/^backups\/immich-db-backup-.*\.sql\.gz\.tmp$/),
        expect.anything(),
        { contentType: 'application/gzip' },
      );
    });

    it('should promote the .tmp file to its real name on success', async () => {
      const result = await sut.handleBackupDatabase();
      expect(result).toBe(JobStatus.Success);
      expect(staging.rename).toHaveBeenCalledWith(
        expect.stringMatching(/\.sql\.gz\.tmp$/),
        expect.stringMatching(/\.sql\.gz$/),
      );
    });

    it('should not upload anything when no remote is configured', async () => {
      await sut.handleBackupDatabase();
      expect(remote.put).not.toHaveBeenCalled();
      expect(staging.delete).not.toHaveBeenCalled();
    });

    it('should compress with gzip when pigz is not installed', async () => {
      await sut.handleBackupDatabase();
      expect(mocks.process.isCommandAvailable).toHaveBeenCalledWith('pigz');
      expect(mocks.process.spawnDuplexStream).toHaveBeenLastCalledWith('gzip', ['--rsyncable']);
    });

    it('should compress with pigz on every available core when it is installed', async () => {
      mocks.process.isCommandAvailable.mockResolvedValue(true);
      mocks.process.availableParallelism.mockReturnValue(8);
      await sut.handleBackupDatabase();
      expect(mocks.process.spawnDuplexStream).toHaveBeenLastCalledWith('pigz', ['--rsyncable', '--processes', '8']);
    });

    it('should fail if pg_dump fails', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('pg_dump non-zero exit code (1)');
    });

    it('should not promote the file if pgdump fails and gzip succeeds', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('pg_dump non-zero exit code (1)');
      expect(staging.rename).not.toHaveBeenCalled();
    });

    it('should fail if gzip fails', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 0, 'data', ''));
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('gzip', 1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('gzip non-zero exit code (1)');
    });

    it('should fail if the staging write fails', async () => {
      staging.put.mockRejectedValue(new Error('error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('error');
    });

    it('should destroy the spawned processes if the staging write fails', async () => {
      const spawned: Duplex[] = [];
      mocks.process.spawnDuplexStream.mockImplementation(() => {
        const duplex = mockDuplex()('command', 0, 'data', '');
        spawned.push(duplex);
        return duplex;
      });
      staging.put.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(sut.handleBackupDatabase()).rejects.toThrow('ENOENT');

      expect(spawned).toHaveLength(2);
      for (const stream of spawned) {
        expect(stream.destroyed).toBe(true);
      }
    });

    it('should fail if the promote fails', async () => {
      staging.rename.mockRejectedValue(new Error('error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('error');
    });

    it('should delete the .tmp file when the dump fails', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('pg_dump non-zero exit code (1)');
      expect(staging.delete).toHaveBeenCalledWith(expect.stringMatching(/\.sql\.gz\.tmp$/));
    });

    it('should ignore the .tmp delete failing and still surface the dump error', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 1, '', 'error'));
      staging.delete.mockRejectedValue(new Error('error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('pg_dump non-zero exit code (1)');
      expect(staging.delete).toHaveBeenCalled();
    });

    describe('with S3 configured', () => {
      beforeEach(() => {
        enableRemote();
        staging.held.clear();
        remote.held.clear();
      });

      // The dump is a valid local backup on its own and the upload is retryable, so promoting is the
      // retention pass's job. Doing it here would let an upload failure escape handleBackupDatabase and
      // skip cleanup entirely, stopping retention for as long as the bucket stayed unwritable.
      it('should not upload from the dump path itself', async () => {
        await sut.createDatabaseBackup();

        expect(staging.rename).toHaveBeenCalled();
        expect(remote.put).not.toHaveBeenCalled();
      });

      // The whole scheduled flow end to end, which only the stateful fakes make testable: dump to a
      // .tmp key, rename, upload under the same key, and leave nothing behind on the staging disk.
      it('should dump, promote and leave the staging disk empty over a whole job', async () => {
        await expect(sut.handleBackupDatabase()).resolves.toBe(JobStatus.Success);

        const uploaded = remote.held.keys().toArray();
        expect(uploaded).toHaveLength(1);
        expect(uploaded[0]).toMatch(/^backups\/immich-db-backup-.*\.sql\.gz$/);
        expect(staging.held.keys().toArray()).toEqual([]);
      });

      it('should leave the dump on the staging disk when the upload fails over a whole job', async () => {
        remote.put.mockRejectedValue(new Error('AccessDenied'));

        await expect(sut.handleBackupDatabase()).rejects.toThrow(/media/);

        expect(staging.held.keys().toArray()).toEqual([
          expect.stringMatching(/^backups\/immich-db-backup-.*\.sql\.gz$/),
        ]);
        expect(remote.held.keys().toArray()).toEqual([]);
      });

      it('should upload and then delete the local copy during cleanup', async () => {
        staging.seed(...listingUnder('backups/')('immich-db-backup-1.sql.gz').map(({ key }) => key));

        await sut.cleanupDatabaseBackups();

        expect(remote.put).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz', expect.anything(), {
          contentType: 'application/gzip',
        });
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
      });

      // Regression (review): this previously ran its loop over zero `put` calls and so asserted nothing.
      it('should never upload a .tmp key', async () => {
        await sut.handleBackupDatabase();

        const keys = remote.put.mock.calls.map(([key]) => key);
        expect(keys).not.toHaveLength(0);
        expect(keys.filter((key) => key.includes('.tmp'))).toEqual([]);
      });

      it('should keep the local file and fail, naming the bucket, when the upload fails', async () => {
        staging.seed(...listingUnder('backups/')('immich-db-backup-1.sql.gz').map(({ key }) => key));
        remote.put.mockRejectedValue(new Error('NoSuchBucket'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(/media/);

        expect(staging.delete).not.toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
      });

      // Regression (review, critical): the promote used to throw out of createDatabaseBackup, which made
      // handleBackupDatabase rethrow and skip cleanup. Retention, the .tmp sweep AND the straggler retry
      // all live in cleanup, so an unwritable bucket stopped all three and the staging disk grew for ever.
      it('should still prune and sweep when the upload fails', async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled); // keepLastAmount: 1
        staging.list.mockResolvedValue(
          listingUnder('backups/')(
            'immich-db-backup-1.sql.gz',
            'immich-db-backup-2.sql.gz',
            'immich-db-backup-3.sql.gz.tmp',
          ),
        );
        remote.put.mockRejectedValue(new Error('AccessDenied'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(/AccessDenied|media/);

        // the older of the two routine backups is pruned even though neither could be uploaded...
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
        // ...and the failed dump is still swept
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-3.sql.gz.tmp');
      });

      // Found live on personal: every nightly prune of an S3-only backup also deleted it from the staging
      // disk, where it was missing, and the storage repository logged "File ... does not exist." each night.
      it('should prune an S3-only backup from S3 alone', async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled); // keepLastAmount: 1
        remote.seed('backups/immich-db-backup-1.sql.gz', 'backups/immich-db-backup-2.sql.gz');

        await sut.cleanupDatabaseBackups();

        expect(remote.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
        expect(remote.delete).not.toHaveBeenCalledWith('backups/immich-db-backup-2.sql.gz');
        expect(staging.delete).not.toHaveBeenCalled();
      });

      // Regression (review, high): retention used to apply only to the canonical set, which was S3 when
      // enabled. While uploads failed, local stragglers were never counted or pruned, so one full dump
      // accumulated per cron tick until the media volume filled.
      it('should bound the local set by keepLastAmount even when nothing can be uploaded', async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled); // keepLastAmount: 1
        staging.list.mockResolvedValue(
          listingUnder('backups/')(
            'immich-db-backup-1.sql.gz',
            'immich-db-backup-2.sql.gz',
            'immich-db-backup-3.sql.gz',
          ),
        );
        remote.put.mockRejectedValue(new Error('AccessDenied'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow();

        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-2.sql.gz');
        expect(staging.delete).not.toHaveBeenCalledWith('backups/immich-db-backup-3.sql.gz');
      });

      // Regression (review, critical): the remote listing used to be awaited bare at the top of cleanup,
      // so a bucket that could not be listed threw before anything was pruned or swept — the same
      // unbounded-growth failure the promote reordering was meant to prevent.
      it('should still prune and sweep when the bucket cannot be listed', async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled); // keepLastAmount: 1
        staging.seed(
          'backups/immich-db-backup-1.sql.gz',
          'backups/immich-db-backup-2.sql.gz',
          'backups/immich-db-backup-3.sql.gz.tmp',
        );
        remote.list.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow();

        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-3.sql.gz.tmp');
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Could not list database backups in S3'),
        );
      });

      it('should keep the underlying S3 error as the cause of the reported failure', async () => {
        staging.seed('backups/immich-db-backup-1.sql.gz');
        const cause = new Error('AccessDenied: bucket policy');
        remote.put.mockRejectedValue(cause);

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(
          expect.objectContaining({ cause: expect.objectContaining({ cause }) }) as never,
        );
      });

      // Regression (review): this delete was the one step in cleanup outside a try/catch, so a disk error
      // on it skipped the prune and the .tmp sweep, the failure the ordering of this method exists to stop.
      it('should still prune and sweep when deleting a local duplicate fails', async () => {
        mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled); // keepLastAmount: 1
        staging.seed('backups/immich-db-backup-2.sql.gz', 'backups/immich-db-backup-3.sql.gz.tmp');
        remote.seed('backups/immich-db-backup-1.sql.gz', 'backups/immich-db-backup-2.sql.gz');
        staging.delete.mockRejectedValueOnce(new Error('EACCES'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(/finished with 1 error/);

        expect(remote.delete).toHaveBeenCalledWith('backups/immich-db-backup-1.sql.gz');
        expect(staging.delete).toHaveBeenCalledWith('backups/immich-db-backup-3.sql.gz.tmp');
        expect(remote.put).not.toHaveBeenCalled();
      });

      // Found on a live bucket: the job runner and the per-file log print only the message, never the
      // cause, so a message without the S3 error gave no way to tell an AccessDenied from a DNS failure.
      it('should name the S3 error in the messages, since logs never print the cause', async () => {
        staging.seed('backups/immich-db-backup-1.sql.gz');
        remote.put.mockRejectedValue(new AccessDeniedError('Access Denied.'));

        await expect(sut.cleanupDatabaseBackups()).rejects.toThrow(/first error: AccessDenied: Access Denied\./);
        expect(mocks.logger.error).toHaveBeenCalledWith(
          expect.stringContaining('(key backups/immich-db-backup-1.sql.gz): AccessDenied: Access Denied.'),
        );
      });

      it('should still succeed when the local delete fails after a good upload', async () => {
        staging.seed(...listingUnder('backups/')('immich-db-backup-1.sql.gz').map(({ key }) => key));
        staging.delete.mockRejectedValue(new Error('EBUSY'));

        await expect(sut.cleanupDatabaseBackups()).resolves.toBeUndefined();
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to delete the local copy'));
      });

      // Regression (review, low): the straggler loop only considered routine names, so an admin upload
      // whose own promote failed stayed host-only for ever.
      it('should retry an uploaded- backup whose promote failed earlier', async () => {
        staging.seed(...listingUnder('backups/')('uploaded-mine.sql.gz').map(({ key }) => key));

        await sut.cleanupDatabaseBackups();

        expect(remote.put).toHaveBeenCalledWith('backups/uploaded-mine.sql.gz', expect.anything(), expect.anything());
      });

      it('should never promote a restore point, which the restore flow needs locally', async () => {
        staging.seed(...listingUnder('backups/')('restore-point-immich-db-backup-1.sql.gz').map(({ key }) => key));

        await sut.cleanupDatabaseBackups();

        expect(remote.put).not.toHaveBeenCalled();
        expect(staging.delete).not.toHaveBeenCalled();
      });
    });

    it.each`
      postgresVersion                       | expectedVersion
      ${'14.10'}                            | ${14}
      ${'14.10.3'}                          | ${14}
      ${'14.10 (Debian 14.10-1.pgdg120+1)'} | ${14}
      ${'15.3.3'}                           | ${15}
      ${'16.4.2'}                           | ${16}
      ${'17.15.1'}                          | ${17}
      ${'18.0.0'}                           | ${18}
    `(
      `should use pg_dump $expectedVersion with postgres version $postgresVersion`,
      async ({ postgresVersion, expectedVersion }) => {
        mocks.database.getPostgresVersion.mockResolvedValue(postgresVersion);
        await sut.handleBackupDatabase();
        expect(mocks.process.spawnDuplexStream).toHaveBeenCalledWith(
          `/usr/lib/postgresql/${expectedVersion}/bin/pg_dump`,
          expect.any(Array),
          expect.any(Object),
        );
      },
    );
    it.each`
      postgresVersion
      ${'13.99.99'}
      ${'19.0.0'}
    `(`should fail if postgres version $postgresVersion is not supported`, async ({ postgresVersion }) => {
      mocks.database.getPostgresVersion.mockResolvedValue(postgresVersion);
      const result = await sut.handleBackupDatabase();
      expect(mocks.process.spawn).not.toHaveBeenCalled();
      expect(result).toBe(JobStatus.Failed);
    });
  });

  describe('buildPostgresLaunchArguments', () => {
    describe('default config', () => {
      it('should generate pg_dump arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('pg_dump')).resolves.toMatchInlineSnapshot(`
        {
          "args": [
            "--username",
            "postgres",
            "--host",
            "database",
            "--port",
            "5432",
            "immich",
            "--clean",
            "--if-exists",
          ],
          "bin": "/usr/lib/postgresql/14/bin/pg_dump",
          "databaseMajorVersion": 14,
          "databasePassword": "postgres",
          "databaseUsername": "postgres",
          "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
        }
      `);
      });

      it('should generate psql arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('psql')).resolves.toMatchInlineSnapshot(`
        {
          "args": [
            "--username",
            "postgres",
            "--host",
            "database",
            "--port",
            "5432",
            "--dbname",
            "immich",
            "--echo-all",
            "--output=/dev/null",
          ],
          "bin": "/usr/lib/postgresql/14/bin/psql",
          "databaseMajorVersion": 14,
          "databasePassword": "postgres",
          "databaseUsername": "postgres",
          "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
        }
      `);
      });

      it('should generate psql (single transaction) arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('psql', { singleTransaction: true })).resolves
          .toMatchInlineSnapshot(`
        {
          "args": [
            "--username",
            "postgres",
            "--host",
            "database",
            "--port",
            "5432",
            "--dbname",
            "immich",
            "--single-transaction",
            "--set",
            "ON_ERROR_STOP=on",
            "--echo-all",
            "--output=/dev/null",
          ],
          "bin": "/usr/lib/postgresql/14/bin/psql",
          "databaseMajorVersion": 14,
          "databasePassword": "postgres",
          "databaseUsername": "postgres",
          "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
        }
      `);
      });
    });

    describe('using custom parts', () => {
      beforeEach(() => {
        const configMock = {
          getEnv: () => ({
            database: {
              config: {
                connectionType: 'parts',
                host: 'myhost',
                port: 1234,
                username: 'mypg',
                password: 'mypwd',
                database: 'myimmich',
              },
              skipMigrations: false,
            },
          }),
          getWorker: () => ImmichWorker.Api,
          isDev: () => false,
        } as unknown as any;

        sut = new DatabaseBackupService(
          mocks.logger as never,
          mocks.storage as never,
          configMock as never,
          mocks.systemMetadata as never,
          mocks.process,
          mocks.database as never,
          mocks.user as never,
          mocks.cron as never,
          mocks.job as never,
          void 0 as never,
          resolver as never,
        );
      });

      it('should generate pg_dump arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('pg_dump')).resolves.toMatchInlineSnapshot(`
          {
            "args": [
              "--username",
              "mypg",
              "--host",
              "myhost",
              "--port",
              "1234",
              "myimmich",
              "--clean",
              "--if-exists",
            ],
            "bin": "/usr/lib/postgresql/14/bin/pg_dump",
            "databaseMajorVersion": 14,
            "databasePassword": "mypwd",
            "databaseUsername": "mypg",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });

      it('should generate psql (single transaction) arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('psql', { singleTransaction: true })).resolves
          .toMatchInlineSnapshot(`
          {
            "args": [
              "--username",
              "mypg",
              "--host",
              "myhost",
              "--port",
              "1234",
              "--dbname",
              "myimmich",
              "--single-transaction",
              "--set",
              "ON_ERROR_STOP=on",
              "--echo-all",
              "--output=/dev/null",
            ],
            "bin": "/usr/lib/postgresql/14/bin/psql",
            "databaseMajorVersion": 14,
            "databasePassword": "mypwd",
            "databaseUsername": "mypg",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });
    });

    describe('using URL', () => {
      beforeEach(() => {
        const dbUrl = 'postgresql://mypg:mypwd@myhost:1234/myimmich?sslmode=require&uselibpqcompat=true';
        const configMock = {
          getEnv: () => ({ database: { config: { connectionType: 'url', url: dbUrl }, skipMigrations: false } }),
          getWorker: () => ImmichWorker.Api,
          isDev: () => false,
        } as unknown as any;

        sut = new DatabaseBackupService(
          mocks.logger as never,
          mocks.storage as never,
          configMock as never,
          mocks.systemMetadata as never,
          mocks.process,
          mocks.database as never,
          mocks.user as never,
          mocks.cron as never,
          mocks.job as never,
          void 0 as never,
          resolver as never,
        );
      });

      it('should generate pg_dump arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('pg_dump')).resolves.toMatchInlineSnapshot(`
          {
            "args": [
              "postgresql://mypg:mypwd@myhost:1234/myimmich?sslmode=require",
              "--clean",
              "--if-exists",
            ],
            "bin": "/usr/lib/postgresql/14/bin/pg_dump",
            "databaseMajorVersion": 14,
            "databasePassword": "mypwd",
            "databaseUsername": "mypg",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });

      it('should generate psql (single transaction) arguments', async () => {
        await expect(sut.buildPostgresLaunchArguments('psql', { singleTransaction: true })).resolves
          .toMatchInlineSnapshot(`
          {
            "args": [
              "--dbname",
              "postgresql://mypg:mypwd@myhost:1234/myimmich?sslmode=require",
              "--single-transaction",
              "--set",
              "ON_ERROR_STOP=on",
              "--echo-all",
              "--output=/dev/null",
            ],
            "bin": "/usr/lib/postgresql/14/bin/psql",
            "databaseMajorVersion": 14,
            "databasePassword": "mypwd",
            "databaseUsername": "mypg",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });
    });

    describe('using bad URL', () => {
      beforeEach(() => {
        const dbUrl = 'post://gresql://mypg:myp@wd@myhos:t:1234/myimmich?sslmode=require&uselibpqcompat=true';
        const configMock = {
          getEnv: () => ({ database: { config: { connectionType: 'url', url: dbUrl }, skipMigrations: false } }),
          getWorker: () => ImmichWorker.Api,
          isDev: () => false,
        } as unknown as any;

        sut = new DatabaseBackupService(
          mocks.logger as never,
          mocks.storage as never,
          configMock as never,
          mocks.systemMetadata as never,
          mocks.process,
          mocks.database as never,
          mocks.user as never,
          mocks.cron as never,
          mocks.job as never,
          void 0 as never,
          resolver as never,
        );
      });

      it('should fallback to reasonable defaults', async () => {
        await expect(sut.buildPostgresLaunchArguments('psql')).resolves.toMatchInlineSnapshot(`
          {
            "args": [
              "--dbname",
              "post://gresql//mypg:myp@wd@myhos:t:1234/myimmich?sslmode=require",
              "--echo-all",
              "--output=/dev/null",
            ],
            "bin": "/usr/lib/postgresql/14/bin/psql",
            "databaseMajorVersion": 14,
            "databasePassword": "",
            "databaseUsername": "postgres",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });
    });

    describe('using an unparsable URL', () => {
      beforeEach(() => {
        // unix domain socket URLs cannot be parsed by `new URL`
        const dbUrl = 'socket://mypg:mypwd@/var/run/postgresql?db=myimmich';
        const configMock = {
          getEnv: () => ({ database: { config: { connectionType: 'url', url: dbUrl }, skipMigrations: false } }),
          getWorker: () => ImmichWorker.Api,
          isDev: () => false,
        } as unknown as any;

        sut = new DatabaseBackupService(
          mocks.logger as never,
          mocks.storage as never,
          configMock as never,
          mocks.systemMetadata as never,
          mocks.process,
          mocks.database as never,
          mocks.user as never,
          mocks.cron as never,
          mocks.job as never,
          void 0 as never,
          resolver as never,
        );
      });

      it('should fallback to reasonable defaults', async () => {
        await expect(sut.buildPostgresLaunchArguments('pg_dump')).resolves.toMatchInlineSnapshot(`
          {
            "args": [
              "socket://mypg:mypwd@/var/run/postgresql?db=myimmich",
              "--clean",
              "--if-exists",
            ],
            "bin": "/usr/lib/postgresql/14/bin/pg_dump",
            "databaseMajorVersion": 14,
            "databasePassword": "",
            "databaseUsername": "postgres",
            "databaseVersion": "14.10 (Debian 14.10-1.pgdg120+1)",
          }
        `);
      });
    });
  });

  describe('uploadBackup', () => {
    it('should reject invalid file names', async () => {
      await expect(sut.uploadBackup({ originalname: 'invalid backup' } as never)).rejects.toThrowError(
        new BadRequestException('Invalid backup name!'),
      );
    });

    it('should write file', async () => {
      await sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never);
      expect(staging.put).toBeCalledWith('backups/uploaded-path.sql.gz.tmp', 'buffer', {
        contentType: 'application/gzip',
      });
      expect(staging.rename).toBeCalledWith('backups/uploaded-path.sql.gz.tmp', 'backups/uploaded-path.sql.gz');
      expect(staging.held.keys().toArray()).toEqual(['backups/uploaded-path.sql.gz']);
    });

    // Regression (review): the upload used to be written straight to its real name, so a retention pass
    // running at the same time (in the microservices worker) could list it half written, upload the
    // truncated file to S3 as a valid backup and delete the local copy.
    it('should not let a concurrent retention pass see an upload that is still being written', async () => {
      enableRemote();
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      let promotedDuringWrite: string[] = ['not checked'];
      staging.put.mockImplementationOnce(async (key: string) => {
        staging.held.set(key, 1);
        await sut.cleanupDatabaseBackups();
        promotedDuringWrite = remote.put.mock.calls.map(([key]) => key);
      });

      await sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never);

      expect(promotedDuringWrite).toEqual([]);
      expect(remote.held.has('backups/uploaded-path.sql.gz')).toBe(true);
      expect(staging.held.size).toBe(0);
    });

    it('should remove the partial file and fail when the write fails', async () => {
      enableRemote();
      staging.put.mockImplementationOnce((key: string) => {
        staging.held.set(key, 1);
        return Promise.reject(new Error('ENOSPC'));
      });

      await expect(sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never)).rejects.toThrow(
        'ENOSPC',
      );

      expect(staging.held.size).toBe(0);
      expect(remote.put).not.toHaveBeenCalled();
    });

    it('should keep the upload on local disk and fail, naming the bucket, when the S3 upload fails', async () => {
      enableRemote();
      remote.put.mockRejectedValue(new Error('AccessDenied'));

      await expect(sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never)).rejects.toThrow(
        /media/,
      );

      expect(staging.held.keys().toArray()).toEqual(['backups/uploaded-path.sql.gz']);
      expect(remote.held.size).toBe(0);
    });

    // The admin upload and the retention pass can promote the same finished file at once. The one that
    // loses finds the local copy gone, but the backup is in the bucket, so it must not report a failure.
    it('should succeed when a concurrent retention pass promoted the upload first', async () => {
      enableRemote();
      staging.get.mockImplementationOnce((key: string) => {
        staging.held.delete(key);
        remote.held.set(key, 1);
        return Promise.reject(new Error(`ENOENT: ${key}`));
      });

      await expect(
        sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never),
      ).resolves.toBeUndefined();
    });

    it('should still fail when the local copy vanished and the bucket does not have it', async () => {
      enableRemote();
      staging.get.mockImplementationOnce((key: string) => {
        staging.held.delete(key);
        return Promise.reject(new Error(`ENOENT: ${key}`));
      });

      await expect(sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never)).rejects.toThrow(
        /media/,
      );
    });

    it('should promote an uploaded backup to S3 like any other', async () => {
      enableRemote();
      await sut.uploadBackup({ originalname: 'path.sql.gz', buffer: 'buffer' } as never);
      expect(remote.put).toBeCalledWith('backups/uploaded-path.sql.gz', expect.anything(), {
        contentType: 'application/gzip',
      });
      expect(staging.delete).toBeCalledWith('backups/uploaded-path.sql.gz');
    });
  });

  describe('downloadBackup', () => {
    it('should reject invalid file names', async () => {
      await expect(sut.downloadBackup('invalid backup')).rejects.toThrowError(
        new BadRequestException('Invalid backup name!'),
      );
    });

    it('should serve a local backup as a file response', async () => {
      staging.seed('backups/hello.sql.gz');
      await expect(sut.downloadBackup('hello.sql.gz')).resolves.toEqual(
        expect.objectContaining({ path: '/data/backups/hello.sql.gz', contentType: 'application/gzip' }),
      );
    });

    it('should serve an uncompressed backup as plain sql', async () => {
      staging.seed('backups/hello.sql');
      await expect(sut.downloadBackup('hello.sql')).resolves.toEqual(
        expect.objectContaining({ contentType: 'application/sql' }),
      );
    });

    it('should serve from S3 once the local copy has been promoted away', async () => {
      enableRemote();
      remote.seed('backups/hello.sql.gz');
      remote.getServeStrategy.mockResolvedValue({ type: 'redirect', url: 'https://s3/presigned' } as never);

      await expect(sut.downloadBackup('hello.sql.gz')).resolves.toEqual(
        expect.objectContaining({ url: 'https://s3/presigned' }),
      );
      expect(remote.getServeStrategy).toHaveBeenCalledWith('backups/hello.sql.gz', expect.anything());
    });

    it('should relay a proxied S3 read as a stream response', async () => {
      enableRemote();
      remote.seed('backups/hello.sql.gz');
      const stream = Readable.from(['payload']);
      remote.getServeStrategy.mockResolvedValue({ type: 'stream', stream, length: 7 } as never);

      await expect(sut.downloadBackup('hello.sql.gz')).resolves.toEqual(expect.objectContaining({ stream, length: 7 }));
    });

    it('should prefer the local copy of a backup that is in both places', async () => {
      enableRemote();
      staging.seed('backups/hello.sql.gz');
      remote.seed('backups/hello.sql.gz');

      await sut.downloadBackup('hello.sql.gz');

      expect(staging.getServeStrategy).toHaveBeenCalled();
      expect(remote.getServeStrategy).not.toHaveBeenCalled();
    });

    it('should 404 a backup that is in neither place', async () => {
      enableRemote();

      await expect(sut.downloadBackup('hello.sql.gz')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listBackups', () => {
    it('should give us all backups', async () => {
      staging.list.mockResolvedValue([
        {
          key: `backups/immich-db-backup-${DateTime.fromISO('2025-07-25T11:02:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz.tmp`,
          size: 1024,
        },
        {
          key: `backups/immich-db-backup-${DateTime.fromISO('2025-07-27T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz`,
          size: 1024,
        },
        { key: 'backups/immich-db-backup-1753789649000.sql.gz', size: 1024 },
        {
          key: `backups/immich-db-backup-${DateTime.fromISO('2025-07-29T11:01:16Z').toFormat("yyyyLLdd'T'HHmmss")}-v1.234.5-pg14.5.sql.gz`,
          size: 1024,
        },
      ]);

      await expect(sut.listBackups()).resolves.toMatchObject({
        backups: [
          { filename: 'immich-db-backup-20250729T110116-v1.234.5-pg14.5.sql.gz', filesize: 1024 },
          { filename: 'immich-db-backup-20250727T110116-v1.234.5-pg14.5.sql.gz', filesize: 1024 },
          { filename: 'immich-db-backup-1753789649000.sql.gz', filesize: 1024 },
        ],
      });
    });

    it('should union both backends, deduplicated by filename', async () => {
      enableRemote();
      // the usual steady state with S3 on: everything promoted lives only in the bucket, and anything
      // still on disk is a straggler from a failed upload
      remote.list.mockResolvedValue([
        { key: 'backups/immich-db-backup-1.sql.gz', size: 10 },
        { key: 'backups/immich-db-backup-2.sql.gz', size: 20 },
      ]);
      staging.list.mockResolvedValue([{ key: 'backups/immich-db-backup-3.sql.gz', size: 30 }]);

      await expect(sut.listBackups()).resolves.toMatchObject({
        backups: [
          { filename: 'immich-db-backup-3.sql.gz', filesize: 30 },
          { filename: 'immich-db-backup-2.sql.gz', filesize: 20 },
          { filename: 'immich-db-backup-1.sql.gz', filesize: 10 },
        ],
      });
    });

    it('should report the local size for a backup still awaiting its upload', async () => {
      enableRemote();
      remote.list.mockResolvedValue([{ key: 'backups/immich-db-backup-1.sql.gz', size: 10 }]);
      staging.list.mockResolvedValue([{ key: 'backups/immich-db-backup-1.sql.gz', size: 99 }]);

      await expect(sut.listBackups()).resolves.toMatchObject({
        backups: [{ filename: 'immich-db-backup-1.sql.gz', filesize: 99 }],
      });
    });

    // Regression (review, high): this list drives the admin UI and the maintenance-mode restore picker.
    // It used to throw outright when the bucket was unreachable, hiding the local backups an admin could
    // still have restored from — the opposite of what the union is for.
    it('should fall back to the local listing when the bucket is unreachable', async () => {
      enableRemote();
      remote.list.mockRejectedValue(new Error('ECONNREFUSED'));
      staging.list.mockResolvedValue([{ key: 'backups/immich-db-backup-1.sql.gz', size: 7 }]);

      await expect(sut.listBackups()).resolves.toMatchObject({
        backups: [{ filename: 'immich-db-backup-1.sql.gz', filesize: 7 }],
      });
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not list database backups in S3'));
    });

    it('should still report a failure when neither backend can be listed', async () => {
      enableRemote();
      remote.list.mockRejectedValue(new Error('ECONNREFUSED'));
      staging.list.mockRejectedValue(new Error('EIO'));

      await expect(sut.listBackups()).rejects.toThrow(/ECONNREFUSED|EIO/);
    });

    it('should ignore objects under the prefix that are not backups', async () => {
      enableRemote();
      remote.list.mockResolvedValue([{ key: 'backups/notes.txt', size: 5 }]);

      await expect(sut.listBackups()).resolves.toEqual({ backups: [] });
    });
  });

  describe('deleteBackup', () => {
    it('should reject invalid file names', async () => {
      await expect(sut.deleteBackup(['filename'])).rejects.toThrowError(
        new BadRequestException('Invalid backup name!'),
      );
    });

    it('should delete the target file', async () => {
      await sut.deleteBackup(['filename.sql']);
      expect(staging.delete).toHaveBeenCalledTimes(1);
      expect(staging.delete).toHaveBeenCalledWith('backups/filename.sql');
    });

    it('should delete from both backends when the backup is on both', async () => {
      enableRemote();
      staging.seed('backups/filename.sql');
      await sut.deleteBackup(['filename.sql']);
      expect(staging.delete).toHaveBeenCalledWith('backups/filename.sql');
      expect(remote.delete).toHaveBeenCalledWith('backups/filename.sql');
    });

    // Deleting a missing disk file logs a "does not exist" warning, and with S3 on most backups are S3-only.
    it('should not touch the staging disk for a backup that is only in S3', async () => {
      enableRemote();
      await sut.deleteBackup(['filename.sql']);
      expect(staging.delete).not.toHaveBeenCalled();
      expect(remote.delete).toHaveBeenCalledWith('backups/filename.sql');
    });
  });

  describe('restoreDatabaseBackup', () => {
    beforeEach(() => {
      mocks.process.spawn.mockReturnValue(mockSpawn(0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementation(() => mockDuplex()('command', 0, 'data', ''));
      mocks.process.fork.mockImplementation(() => mockSpawn(0, 'Immich Server is listening', ''));
      mocks.storage.createGzip.mockReturnValue(new PassThrough());
      mocks.storage.createGunzip.mockReturnValue(new PassThrough());
      // every restore test restores one of these two, so both exist on the staging disk
      staging.seed('backups/development-filename.sql', 'backups/development-v2.4.0-.sql');

      const configMock = {
        getEnv: () => ({
          database: {
            config: {
              connectionType: 'parts',
              host: 'myhost',
              port: 1234,
              username: 'mypg',
              password: 'mypwd',
              database: 'myimmich',
            },
            skipMigrations: false,
          },
        }),
        getWorker: () => ImmichWorker.Api,
        isDev: () => false,
      } as unknown as any;

      sut = new DatabaseBackupService(
        mocks.logger as never,
        mocks.storage as never,
        configMock as never,
        mocks.systemMetadata as never,
        mocks.process,
        mocks.database as never,
        mocks.user as never,
        mocks.cron as never,
        mocks.job as never,
        maintenanceHealthRepositoryMock,
        resolver as never,
      );
    });

    it('should fail to restore invalid backup', async () => {
      await expect(sut.restoreDatabaseBackup('filename')).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Invalid backup file format!]`,
      );
    });

    it('should successfully restore a backup', async () => {
      let writtenToPsql = '';

      mocks.user.hasAdmin.mockResolvedValue(true);

      mocks.process.spawnDuplexStream.mockImplementationOnce(() => mockDuplex()('command', 0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementationOnce(() => mockDuplex()('command', 0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementationOnce(() => {
        return mockDuplex((chunk) => (writtenToPsql += chunk))('command', 0, 'data', '');
      });

      const progress = vitest.fn();
      await sut.restoreDatabaseBackup('development-filename.sql', progress);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
      expect(progress).toHaveBeenCalledWith('migrations', 0.9);

      expect(maintenanceHealthRepositoryMock.checkApiHealth).toHaveBeenCalled();
      expect(mocks.process.spawnDuplexStream).toHaveBeenCalledTimes(3);

      expect(mocks.process.spawnDuplexStream).toHaveBeenLastCalledWith(
        expect.stringMatching('/bin/psql'),
        [
          '--username',
          'mypg',
          '--host',
          'myhost',
          '--port',
          '1234',
          '--dbname',
          'myimmich',
          '--single-transaction',
          '--set',
          'ON_ERROR_STOP=on',
          '--echo-all',
          '--output=/dev/null',
        ],
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: expect.any(String),
            PGPASSWORD: 'mypwd',
          }),
        }),
      );

      expect(writtenToPsql).toMatchInlineSnapshot(`
        "
          -- drop all other database connections
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid();

          -- re-create the default schema
          DROP SCHEMA public CASCADE;
          CREATE SCHEMA public;

          -- restore access to schema
          GRANT ALL ON SCHEMA public TO "mypg";
          GRANT ALL ON SCHEMA public TO public;
        SELECT 1;"
      `);
    });

    it('should generate pg_dumpall specific SQL instructions', async () => {
      let writtenToPsql = '';

      mocks.user.hasAdmin.mockResolvedValue(true);

      mocks.process.spawnDuplexStream.mockImplementationOnce(() => mockDuplex()('command', 0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementationOnce(() => mockDuplex()('command', 0, 'data', ''));
      mocks.process.spawnDuplexStream.mockImplementationOnce(() => {
        return mockDuplex((chunk) => (writtenToPsql += chunk))('command', 0, 'data', '');
      });

      const progress = vitest.fn();
      await sut.restoreDatabaseBackup('development-v2.4.0-.sql', progress);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
      expect(progress).toHaveBeenCalledWith('migrations', 0.9);

      expect(maintenanceHealthRepositoryMock.checkApiHealth).toHaveBeenCalled();
      expect(mocks.process.spawnDuplexStream).toHaveBeenCalledTimes(3);

      expect(mocks.process.spawnDuplexStream).toHaveBeenLastCalledWith(
        expect.stringMatching('/bin/psql'),
        [
          '--username',
          'mypg',
          '--host',
          'myhost',
          '--port',
          '1234',
          '--dbname',
          'myimmich',
          '--echo-all',
          '--output=/dev/null',
        ],
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: expect.any(String),
            PGPASSWORD: 'mypwd',
          }),
        }),
      );

      expect(writtenToPsql).toMatchInlineSnapshot(String.raw`
        "
          -- drop all other database connections
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid();

                \c postgres
              SELECT 1;"
      `);
    });

    it('should fail if backup creation fails', async () => {
      mocks.process.spawnDuplexStream.mockReturnValueOnce(mockDuplex()('pg_dump', 1, '', 'error'));

      const progress = vitest.fn();
      await expect(sut.restoreDatabaseBackup('development-filename.sql', progress)).rejects
        .toThrowErrorMatchingInlineSnapshot(`
          [Error: pg_dump non-zero exit code (1)
          error]
        `);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
    });

    it('should fail if restore itself fails', async () => {
      mocks.process.spawnDuplexStream
        .mockReturnValueOnce(mockDuplex()('pg_dump', 0, 'data', ''))
        .mockReturnValueOnce(mockDuplex()('gzip', 0, 'data', ''))
        .mockReturnValueOnce(mockDuplex()('psql', 1, '', 'error'));

      const progress = vitest.fn();
      await expect(sut.restoreDatabaseBackup('development-filename.sql', progress)).rejects
        .toThrowErrorMatchingInlineSnapshot(`
          [Error: psql non-zero exit code (1)
          error]
        `);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
    });

    it('should rollback if database migrations fail', async () => {
      mocks.database.runMigrations.mockRejectedValue(new Error('Migrations Error'));

      const progress = vitest.fn();
      await expect(
        sut.restoreDatabaseBackup('development-filename.sql', progress),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Migrations Error]`);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
      expect(progress).toHaveBeenCalledWith('migrations', 0.9);

      expect(maintenanceHealthRepositoryMock.checkApiHealth).toHaveBeenCalledTimes(0);
      expect(mocks.process.spawnDuplexStream).toHaveBeenCalledTimes(4);
    });

    it('should rollback if there is no admin user', async () => {
      mocks.user.hasAdmin.mockResolvedValue(false);

      const progress = vitest.fn();
      await expect(
        sut.restoreDatabaseBackup('development-filename.sql', progress),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Server health check failed, no admin exists.]`);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
      expect(progress).toHaveBeenCalledWith('migrations', 0.9);
      expect(progress).toHaveBeenCalledWith('rollback', 0);

      expect(mocks.user.hasAdmin).toHaveBeenCalled();
      expect(mocks.process.spawnDuplexStream).toHaveBeenCalledTimes(4);
    });

    it('should rollback if API healthcheck fails', async () => {
      mocks.user.hasAdmin.mockResolvedValue(true);
      maintenanceHealthRepositoryMock.checkApiHealth.mockRejectedValue(new Error('Health Error'));

      const progress = vitest.fn();
      await expect(
        sut.restoreDatabaseBackup('development-filename.sql', progress),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Health Error]`);

      expect(progress).toHaveBeenCalledWith('backup', 0.05);
      expect(progress).toHaveBeenCalledWith('migrations', 0.9);
      expect(progress).toHaveBeenCalledWith('rollback', 0);

      expect(mocks.user.hasAdmin).toHaveBeenCalled();
      expect(maintenanceHealthRepositoryMock.checkApiHealth).toHaveBeenCalled();
      expect(mocks.process.spawnDuplexStream).toHaveBeenCalledTimes(4);
    });

    // The abstraction is what makes this possible at all: a backup that has been promoted only exists
    // in the bucket, and restoring reads it straight from there with no separate download step.
    it('should restore a backup that only exists in S3', async () => {
      enableRemote();
      staging.held.delete('backups/development-filename.sql');
      remote.seed('backups/development-filename.sql');
      mocks.user.hasAdmin.mockResolvedValue(true);

      await sut.restoreDatabaseBackup('development-filename.sql');

      expect(remote.get).toHaveBeenCalledWith('backups/development-filename.sql');
      expect(maintenanceHealthRepositoryMock.checkApiHealth).toHaveBeenCalled();
    });

    // `pipe` does not forward errors, so without the forwarding in the service a dropped S3 socket would be
    // an unhandled 'error' that kills the worker instead of a failed restore.
    it('should fail the restore, not crash, when the S3 read drops part way through a .gz backup', async () => {
      enableRemote();
      remote.seed('backups/development-filename.sql.gz');
      mocks.user.hasAdmin.mockResolvedValue(true);
      // fails on the first read, before the restore has started consuming the decoded side
      const dropped: Readable = new Readable({
        read: () => {
          dropped.push('SELECT 1;\n');
          dropped.destroy(new Error('socket hang up'));
        },
      });
      remote.get.mockResolvedValueOnce({ stream: dropped });

      await expect(sut.restoreDatabaseBackup('development-filename.sql.gz')).rejects.toThrow('socket hang up');

      expect(mocks.database.runMigrations).not.toHaveBeenCalled();
    });

    it('should reject a backup that is in neither place', async () => {
      enableRemote();
      staging.held.clear();

      await expect(sut.restoreDatabaseBackup('development-filename.sql')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should read the rollback restore point from the staging disk, never from S3', async () => {
      enableRemote();
      mocks.user.hasAdmin.mockResolvedValue(false);

      await expect(sut.restoreDatabaseBackup('development-filename.sql')).rejects.toThrow('no admin exists');

      expect(staging.get).toHaveBeenCalledWith(expect.stringMatching(/^backups\/restore-point-/));
      expect(remote.get).not.toHaveBeenCalled();
    });
  });

  describe('onConfigValidate', () => {
    it('should refuse to enable S3 backups while the storage backend is disk', () => {
      expect(() => sut.onConfigValidate({ newConfig: configWithS3(true), oldConfig: defaults })).toThrow(
        /S3 storage backend/,
      );
    });

    it('should allow the default config', () => {
      expect(() => sut.onConfigValidate({ newConfig: defaults, oldConfig: defaults })).not.toThrow();
    });
  });
});

function* mockData() {
  yield 'SELECT 1;';
}
