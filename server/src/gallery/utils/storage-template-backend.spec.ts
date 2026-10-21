import { Mock } from 'vitest';
import { StorageCore } from 'src/cores/storage.core.js';
import { getTemplateLibraryRoot, isTemplateDestinationTaken } from 'src/gallery/utils/storage-template-backend.js';
import { StorageService } from 'src/services/storage.service.js';
import { getMocks } from 'test/utils.js';

describe('getTemplateLibraryRoot', () => {
  beforeEach(() => {
    StorageCore.setMediaLocation('/data');
  });

  it('should be the disk library folder for a disk original', () => {
    expect(
      getTemplateLibraryRoot('/data/upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: 'admin' }),
    ).toBe('/data/library/admin');
  });

  it('should fall back to the user id on disk without a storage label', () => {
    expect(getTemplateLibraryRoot('/data/upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: null })).toBe(
      '/data/library/user-1',
    );
  });

  it('should be the library key for a key original', () => {
    expect(getTemplateLibraryRoot('upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: 'admin' })).toBe(
      'library/admin',
    );
  });

  it('should fall back to the user id for a key original without a storage label', () => {
    expect(getTemplateLibraryRoot('upload/user-1/as/se/asset-1.jpg', { id: 'user-1', storageLabel: null })).toBe(
      'library/user-1',
    );
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
  });

  describe('without S3', () => {
    beforeEach(() => {
      (StorageService as any).s3Backend = undefined;
    });

    it.each([true, false])('should be upstream disk check alone (%s)', async (exists) => {
      mocks.storage.checkFileExists.mockResolvedValue(exists);

      await expect(isTemplateDestinationTaken('/data/library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(
        exists,
      );

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
    });

    it('should check a key destination at its place under the media location', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect(isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(true);

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

      await expect(isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(true);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
      expect(s3.exists).toHaveBeenCalledWith('library/admin/IMG_1.jpg');
      expect(mocks.storage.checkFileExists.mock.invocationCallOrder[0]).toBeLessThan(
        s3.exists.mock.invocationCallOrder[0],
      );
    });

    it('should be taken by a disk file without asking S3', async () => {
      mocks.storage.checkFileExists.mockResolvedValue(true);

      await expect(isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(true);

      expect(s3.exists).not.toHaveBeenCalled();
    });

    it('should be free when neither backend holds a key destination', async () => {
      await expect(isTemplateDestinationTaken('library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(false);

      expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(1);
      expect(s3.exists).toHaveBeenCalledTimes(1);
    });

    it('should check the S3 key of a disk destination under the media location', async () => {
      s3.exists.mockResolvedValue(true);

      await expect(isTemplateDestinationTaken('/data/library/admin/IMG_1.jpg', mocks.storage as any)).resolves.toBe(
        true,
      );

      expect(mocks.storage.checkFileExists).toHaveBeenCalledWith('/data/library/admin/IMG_1.jpg');
      expect(s3.exists).toHaveBeenCalledWith('library/admin/IMG_1.jpg');
    });

    it.each(['/mnt/photos/library/admin/IMG_1.jpg', '/data2/library/admin/IMG_1.jpg'])(
      'should not consult S3 for a disk destination outside the media location (%s)',
      async (destination) => {
        await expect(isTemplateDestinationTaken(destination, mocks.storage as any)).resolves.toBe(false);

        expect(mocks.storage.checkFileExists).toHaveBeenCalledWith(destination);
        expect(s3.exists).not.toHaveBeenCalled();
      },
    );
  });
});
