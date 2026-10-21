import {
  CompiledQuery,
  DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { DB } from 'src/schema/index.js';
import { StorageCore } from 'src/cores/storage.core.js';
import {
  computePhysicalUsage,
  getDeletableUserS3Prefixes,
  getDerivativeAssetId,
  getUserS3Prefixes,
} from 'src/gallery/utils/storage-usage.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';

/** a Kysely that records each query and answers it with `rows`, to check the SQL a repository method sends */
const recordingKysely = (rows: unknown[]) => {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery: <R>(query: CompiledQuery) => {
      queries.push(query);
      return Promise.resolve({ rows: rows as R[] });
    },
    streamQuery: () => {
      throw new Error('not used');
    },
  };
  class RecordingDriver extends DummyDriver {
    override acquireConnection() {
      return Promise.resolve(connection);
    }
  }

  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RecordingDriver(),
      createIntrospector: (db: Kysely<DB>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, queries };
};

describe('getDerivativeAssetId', () => {
  const id = '0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f70';

  it('should extract the asset id from a preview filename', () => {
    expect(getDerivativeAssetId(`${id}_preview.webp`)).toBe(id);
  });

  it('should extract the asset id from an edited thumbnail filename', () => {
    expect(getDerivativeAssetId(`${id}_thumbnail_edited.webp`)).toBe(id);
  });

  it('should extract the asset id from a transcode filename', () => {
    expect(getDerivativeAssetId(`${id}.mp4`)).toBe(id);
  });

  it('should lowercase the extracted id from an uppercase filename', () => {
    // getExternalAssetIds compares against Postgres-lowercased uuids, so the extraction
    // must normalise casing rather than preserve the filename's own casing.
    expect(getDerivativeAssetId(`${id.toUpperCase()}.mp4`)).toBe(id);
  });

  it('should return null for a filename that is not asset derived', () => {
    expect(getDerivativeAssetId('not-a-uuid.webp')).toBeNull();
    expect(getDerivativeAssetId('segment-00001.ts')).toBeNull();
  });

  it('should return null for a filename shorter than a uuid', () => {
    expect(getDerivativeAssetId('short.webp')).toBeNull();
    expect(getDerivativeAssetId('')).toBeNull();
  });

  it('should return null when the uuid is not followed by a known separator', () => {
    expect(getDerivativeAssetId(`${id}extra.webp`)).toBeNull();
  });

  it('should return null for an Android motion sidecar', () => {
    // StorageCore.getAndroidMotionPath creates ${uuid}-MP.mp4 where uuid is fresh, not the asset id
    expect(getDerivativeAssetId(`${id}-MP.mp4`)).toBeNull();
  });
});

describe('getUserS3Prefixes', () => {
  it('should key the library prefix on the storage label, like the disk library folder', () => {
    expect(getUserS3Prefixes({ id: 'user-id', storageLabel: 'admin' })).toEqual({
      library: 'library/admin/',
      upload: 'upload/user-id/',
      profile: 'profile/user-id/',
      thumbnails: 'thumbs/user-id/',
      encodedVideo: 'encoded-video/user-id/',
    });
  });

  it('should fall back to the user id for the library prefix without a storage label', () => {
    expect(getUserS3Prefixes({ id: 'user-id', storageLabel: null }).library).toBe('library/user-id/');
  });

  it('should end every prefix in a slash so one user never matches another whose id starts with it', () => {
    for (const prefix of Object.values(getUserS3Prefixes({ id: 'user-id', storageLabel: 'admin' }))) {
      expect(prefix.endsWith('/')).toBe(true);
    }
  });
});

describe('getDeletableUserS3Prefixes', () => {
  let storageMigrationRepository: { hasOtherOwnerFilesUnderPrefix: ReturnType<typeof vi.fn> };
  let logger: { warn: ReturnType<typeof vi.fn> };

  const getPrefixes = (
    user: { id: string; storageLabel: string | null },
    repository: unknown = storageMigrationRepository,
  ) =>
    getDeletableUserS3Prefixes(user, repository as StorageMigrationRepository, logger as unknown as LoggingRepository);

  beforeEach(() => {
    storageMigrationRepository = { hasOtherOwnerFilesUnderPrefix: vi.fn().mockResolvedValue(false) };
    logger = { warn: vi.fn() };
  });

  it('should return every prefix, the library one first, when no other owner has files under it', async () => {
    await expect(getPrefixes({ id: 'user-id', storageLabel: 'admin' })).resolves.toEqual([
      'library/admin/',
      'upload/user-id/',
      'profile/user-id/',
      'thumbs/user-id/',
      'encoded-video/user-id/',
    ]);

    expect(storageMigrationRepository.hasOtherOwnerFilesUnderPrefix).toHaveBeenCalledExactlyOnceWith(
      'library/admin/',
      'user-id',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should leave out the library prefix, with a warning naming it, while another owner has files under it', async () => {
    // a storage label changed without the template migration and handed to this user
    storageMigrationRepository.hasOtherOwnerFilesUnderPrefix.mockResolvedValue(true);

    await expect(getPrefixes({ id: 'user-id', storageLabel: 'admin' })).resolves.toEqual([
      'upload/user-id/',
      'profile/user-id/',
      'thumbs/user-id/',
      'encoded-video/user-id/',
    ]);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('library/admin/'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("another user's assets"));
  });

  it('should match the library prefix literally, escaping LIKE wildcards in the storage label', async () => {
    // unescaped, _ and % would match other labels' prefixes too (a_b% matches library/axbyz/)
    const { db, queries } = recordingKysely([{ found: true }]);
    const user = { id: 'user-id', storageLabel: String.raw`a_b%c\d` };

    await expect(getPrefixes(user, new StorageMigrationRepository(db))).resolves.not.toContain(
      String.raw`library/a_b%c\d/`,
    );

    expect(queries).toHaveLength(1);
    const [{ sql, parameters }] = queries;
    const pattern = String.raw`library/a\_b\%c\\d/%`;
    expect(sql).toContain(String.raw`"asset"."ownerId" != $1 and "asset"."originalPath" like $2 escape '\'`);
    expect(sql).toContain(String.raw`"asset"."ownerId" != $3 and "asset_file"."path" like $4 escape '\'`);
    expect(parameters).toEqual(['user-id', pattern, 'user-id', pattern]);
  });

  it('should keep the library prefix when the query finds no other owner', async () => {
    const { db } = recordingKysely([{ found: false }]);

    await expect(
      getPrefixes({ id: 'user-id', storageLabel: null }, new StorageMigrationRepository(db)),
    ).resolves.toContain('library/user-id/');
  });
});

describe('computePhysicalUsage', () => {
  const externalId = '0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f70';
  const uploadedId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  let assetRepository: { getExternalAssetIds: ReturnType<typeof vi.fn> };
  let storageRepository: { getFolderSize: ReturnType<typeof vi.fn> };
  let s3: { getPrefixUsage: ReturnType<typeof vi.fn> };

  const compute = (user: { id: string; storageLabel: string | null }, withS3 = true) =>
    computePhysicalUsage({
      user,
      assetRepository: assetRepository as unknown as AssetRepository,
      storageRepository: storageRepository as unknown as StorageRepository,
      s3: withS3 ? (s3 as unknown as StorageBackend) : undefined,
    });

  beforeAll(() => {
    StorageCore.setMediaLocation('/data');
  });

  beforeEach(() => {
    assetRepository = { getExternalAssetIds: vi.fn().mockResolvedValue(new Set([externalId])) };
    storageRepository = { getFolderSize: vi.fn().mockResolvedValue(1) };
    s3 = { getPrefixUsage: vi.fn().mockResolvedValue(10) };
  });

  it('should count the S3 library prefix under the storage label, unfiltered like the disk library folder', async () => {
    await expect(compute({ id: 'user-id', storageLabel: 'admin' })).resolves.toBe(55);

    expect(storageRepository.getFolderSize.mock.calls).toEqual([
      ['/data/library/admin'],
      ['/data/upload/user-id'],
      ['/data/profile/user-id'],
      ['/data/thumbs/user-id', expect.any(Function)],
      ['/data/encoded-video/user-id', expect.any(Function)],
    ]);
    expect(s3.getPrefixUsage.mock.calls).toEqual([
      ['library/admin/'],
      ['upload/user-id/'],
      ['profile/user-id/'],
      ['thumbs/user-id/', expect.any(Function)],
      ['encoded-video/user-id/', expect.any(Function)],
    ]);
  });

  it('should count the S3 library prefix under the user id without a storage label', async () => {
    await compute({ id: 'user-id', storageLabel: null });

    expect(s3.getPrefixUsage).toHaveBeenCalledWith('library/user-id/');
  });

  it('should leave external-library assets out of the S3 derivative prefixes', async () => {
    await compute({ id: 'user-id', storageLabel: null });

    const [, shouldCount] = s3.getPrefixUsage.mock.calls.find(([prefix]) => prefix === 'thumbs/user-id/')!;
    expect(shouldCount(`${externalId}_preview.webp`)).toBe(false);
    expect(shouldCount(`${uploadedId}_preview.webp`)).toBe(true);
  });

  it('should only walk disk without an S3 backend', async () => {
    await expect(compute({ id: 'user-id', storageLabel: null }, false)).resolves.toBe(5);

    expect(s3.getPrefixUsage).not.toHaveBeenCalled();
  });
});
