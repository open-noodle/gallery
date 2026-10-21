import { Mock } from 'vitest';
import type { StorageAsset, SystemMetadata } from 'src/types.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetFileType, SystemMetadataKey } from 'src/enum.js';
import {
  getTemplateLibraryRoot,
  isManualOnlyTemplateMove,
  isTemplateDestinationTaken,
} from 'src/gallery/utils/storage-template-backend.js';
import { StorageService } from 'src/services/storage.service.js';
import { getMocks } from 'test/utils.js';

describe('getTemplateLibraryRoot', () => {
  beforeEach(() => {
    StorageCore.setMediaLocation('/data');
  });

  it('should be the disk library folder for a disk original', () => {
    expect(
      getTemplateLibraryRoot('/data/upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: 'admin' }),
    ).toBe('/data/library/admin/');
  });

  it('should fall back to the user id on disk without a storage label', () => {
    expect(getTemplateLibraryRoot('/data/upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: null })).toBe(
      '/data/library/user-1/',
    );
  });

  it('should be the library key for a key original', () => {
    expect(getTemplateLibraryRoot('upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: 'admin' })).toBe(
      'library/admin/',
    );
  });

  it('should fall back to the user id for a key original without a storage label', () => {
    expect(getTemplateLibraryRoot('upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: null })).toBe(
      'library/user-1/',
    );
  });

  // upstream's guard is `fullPath.startsWith(rootPath)`: without the separator `library/admin2` passes for `admin`
  it.each([
    { label: 'a disk original', originalPath: '/data/upload/user-1/as/se/asset-1.jpg', prefix: '/data/library' },
    { label: 'a key original', originalPath: 'upload/user-1/as/se/asset-1.jpg', prefix: 'library' },
  ])('should not be a prefix of a sibling folder for $label', ({ originalPath, prefix }) => {
    const root = getTemplateLibraryRoot(originalPath, { id: 'user-1', storageLabel: 'admin' });

    expect(`${prefix}/admin/2024/IMG_1`.startsWith(root)).toBe(true);
    expect(`${prefix}/admin2/2024/IMG_1`.startsWith(root)).toBe(false);
  });
});

describe('isTemplateDestinationTaken', () => {
  let mocks: ReturnType<typeof getMocks>;
  let s3: { exists: Mock };
  let previousS3Backend: unknown;

  beforeEach(() => {
    mocks = getMocks();
    StorageCore.setMediaLocation('/data');
    s3 = { exists: vi.fn().mockResolvedValue(false) };
    mocks.storage.checkFileExists.mockResolvedValue(false);
    previousS3Backend = (StorageService as any).s3Backend;
  });

  afterEach(() => {
    (StorageService as any).s3Backend = previousS3Backend;
    vi.restoreAllMocks();
  });

  describe('without S3', () => {
    beforeEach(() => {
      (StorageService as any).s3Backend = undefined;
    });

    it.each([true, false])('should be upstream disk check alone (%s)', async (exists) => {
      mocks.storage.checkFileExists.mockResolvedValue(exists);

      await expect(
        isTemplateDestinationTaken('/data/library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(exists);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
    });

    it('should check a key destination at its place under the media location', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect(
        isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(true);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
    });
  });

  describe('with S3', () => {
    beforeEach(() => {
      (StorageService as any).s3Backend = s3;
    });

    it('should check the disk equivalent of a key destination first, then S3', async () => {
      s3.exists.mockResolvedValue(true);

      await expect(
        isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(true);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
      expect(s3.exists).toHaveBeenCalledWith('library/admin/IMG_1.jpg');
      expect(mocks.storage.checkFileExists.mock.invocationCallOrder[0]).toBeLessThan(
        s3.exists.mock.invocationCallOrder[0],
      );
    });

    it('should be taken by a disk file without asking S3', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect(
        isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(true);

      expect(s3.exists).not.toHaveBeenCalled();
    });

    it('should be free when neither backend holds a key destination', async () => {
      await expect(
        isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(false);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(s3.exists).toHaveBeenCalledTimes(1);
    });

    it('should check the S3 key of a disk destination under the media location', async () => {
      s3.exists.mockResolvedValue(true);

      await expect(
        isTemplateDestinationTaken('/data/library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(true);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
      expect(s3.exists).toHaveBeenCalledWith('library/admin/IMG_1.jpg');
    });

    it('should treat the key of a disk destination as free when S3 cannot be asked', async () => {
      s3.exists.mockRejectedValue(new Error('SlowDown'));

      await expect(
        isTemplateDestinationTaken('/data/library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).resolves.toBe(false);

      expect(s3.exists).toHaveBeenCalledWith('library/admin/IMG_1.jpg');
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Unable to check whether S3 holds library/admin/IMG_1.jpg, treating /data/library/admin/IMG_1.jpg as free: SlowDown',
      );
    });

    it('should fail for a key destination when S3 cannot be asked', async () => {
      const error = new Error('SlowDown');
      s3.exists.mockRejectedValue(error);

      await expect(
        isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any, mocks.logger as any),
      ).rejects.toBe(error);
    });

    it.each(['/mnt/photos/library/admin/IMG_1.jpg', '/data2/library/admin/IMG_1.jpg'])(
      'should not consult S3 for a disk destination outside the media location (%s)',
      async (destination) => {
        await expect(isTemplateDestinationTaken(destination, mocks.storage as any, mocks.logger as any)).resolves.toBe(
          false,
        );

        expect(mocks.storage.checkFileExists).toHaveBeenCalledWith(destination);
        expect(s3.exists).not.toHaveBeenCalled();
      },
    );
  });
});

const sidecar = (path: string) => ({ type: AssetFileType.Sidecar, path });

// the two fields isManualOnlyTemplateMove reads; files is left undefined to cover an asset read without its files
const storageAsset = (originalPath: string, files?: Array<{ type: AssetFileType; path: string }>) =>
  ({ originalPath, files }) as unknown as StorageAsset;

describe('isManualOnlyTemplateMove', () => {
  const decidedAt = '2026-10-20T08:00:00.000Z';
  const diskOriginal = '/data/upload/user-1/as/se/asset-1.jpg';
  const keyOriginal = 'upload/user-1/as/se/asset-1.jpg';

  let mocks: ReturnType<typeof getMocks>;

  const mockState = (state: SystemMetadata[SystemMetadataKey.StorageTemplateS3State] | null) =>
    mocks.systemMetadata.get.mockImplementation((key: SystemMetadataKey) =>
      Promise.resolve((key === SystemMetadataKey.StorageTemplateS3State ? state : null) as any),
    );

  beforeEach(() => {
    mocks = getMocks();
    mockState({ pending: true, decidedAt });
  });

  it.each([
    { label: 'a disk original without files', files: [] },
    { label: 'a disk original with files undefined', files: undefined },
    { label: 'a disk original with a disk sidecar', files: [sidecar(`${diskOriginal}.xmp`)] },
  ])('should be false for $label without reading the state', async ({ files }) => {
    await expect(
      isManualOnlyTemplateMove(storageAsset(diskOriginal, files), mocks.systemMetadata as any),
    ).resolves.toBe(false);

    expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a key original without files', originalPath: keyOriginal, files: [] },
    { label: 'a key original with files undefined', originalPath: keyOriginal, files: undefined },
    { label: 'a key original with a disk sidecar', originalPath: keyOriginal, files: [sidecar(`${diskOriginal}.xmp`)] },
    { label: 'the key sidecar of a disk original', originalPath: diskOriginal, files: [sidecar(`${keyOriginal}.xmp`)] },
  ])('should be true for $label while the state is pending', async ({ originalPath, files }) => {
    await expect(
      isManualOnlyTemplateMove(storageAsset(originalPath, files), mocks.systemMetadata as any),
    ).resolves.toBe(true);

    expect(mocks.systemMetadata.get).toHaveBeenCalledExactlyOnceWith(SystemMetadataKey.StorageTemplateS3State);
  });

  it.each([
    { label: 'cleared by a manual run', state: { pending: false, decidedAt, clearedAt: '2026-10-21T09:00:00.000Z' } },
    { label: 'decided not pending', state: { pending: false, decidedAt } },
    { label: 'absent', state: null },
  ])('should be false for a key original or key sidecar when the state is $label', async ({ state }) => {
    mockState(state);

    await expect(isManualOnlyTemplateMove(storageAsset(keyOriginal, []), mocks.systemMetadata as any)).resolves.toBe(
      false,
    );
    await expect(
      isManualOnlyTemplateMove(
        storageAsset(diskOriginal, [sidecar(`${keyOriginal}.xmp`)]),
        mocks.systemMetadata as any,
      ),
    ).resolves.toBe(false);

    expect(mocks.systemMetadata.get).toHaveBeenCalledTimes(2);
    expect(mocks.systemMetadata.get).toHaveBeenCalledWith(SystemMetadataKey.StorageTemplateS3State);
  });
});
