import { Mock, vitest } from 'vitest';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType, ImageFormat, PersonPathType, StorageFolder } from 'src/enum.js';
import { StorageService } from 'src/services/storage.service.js';
import { getMocks } from 'test/utils.js';

vitest.mock('src/constants', () => ({
  IWorker: 'IWorker',
}));

describe('StorageCore', () => {
  describe('getMediaLocation', () => {
    it('should throw an error when media location is not set', () => {
      StorageCore.setMediaLocation(undefined as unknown as string);
      // Reset internal state by setting to undefined
      // The method checks for `=== undefined`
      expect(() => StorageCore.getMediaLocation()).toThrow('Media location is not set.');
    });

    it('should return the media location when set', () => {
      StorageCore.setMediaLocation('/media');
      expect(StorageCore.getMediaLocation()).toBe('/media');
    });
  });

  describe('isImmichPath', () => {
    beforeAll(() => {
      StorageCore.setMediaLocation('/photos');
    });

    it('should return true for APP_MEDIA_LOCATION path', () => {
      const immichPath = '/photos';
      expect(StorageCore.isImmichPath(immichPath)).toBe(true);
    });

    it('should return true for paths within the APP_MEDIA_LOCATION', () => {
      const immichPath = '/photos/new/';
      expect(StorageCore.isImmichPath(immichPath)).toBe(true);
    });

    it('should return false for paths outside the APP_MEDIA_LOCATION and same starts', () => {
      const nonImmichPath = '/photos_new';
      expect(StorageCore.isImmichPath(nonImmichPath)).toBe(false);
    });

    it('should return false for paths outside the APP_MEDIA_LOCATION', () => {
      const nonImmichPath = '/some/other/path';
      expect(StorageCore.isImmichPath(nonImmichPath)).toBe(false);
    });

    it('should return false for S3 relative keys', () => {
      expect(StorageCore.isImmichPath('upload/uuid/4e/e6/file.jpg')).toBe(false);
    });
  });

  describe('getFolderLocation', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    it('should return the folder location for a given user', () => {
      const result = StorageCore.getFolderLocation(StorageFolder.Thumbnails, 'user-1');
      expect(result).toBe('/data/thumbs/user-1');
    });

    it('should return the folder location for encoded video', () => {
      const result = StorageCore.getFolderLocation(StorageFolder.EncodedVideo, 'user-2');
      expect(result).toBe('/data/encoded-video/user-2');
    });
  });

  describe('getLibraryFolder', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    it('should use storageLabel when available', () => {
      const result = StorageCore.getLibraryFolder({ storageLabel: 'my-label', id: 'user-id' });
      expect(result).toBe('/data/library/my-label');
    });

    it('should fall back to user id when storageLabel is null', () => {
      const result = StorageCore.getLibraryFolder({ storageLabel: null, id: 'user-id' });
      expect(result).toBe('/data/library/user-id');
    });
  });

  describe('getAndroidMotionPath', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    it('should return a nested path under EncodedVideo with -MP.mp4 suffix', () => {
      const result = StorageCore.getAndroidMotionPath({ id: 'asset-1', ownerId: 'user-1' }, 'motion-uuid');
      expect(result).toContain('encoded-video');
      expect(result).toContain('user-1');
      expect(result).toContain('motion-uuid-MP.mp4');
    });
  });

  describe('isAndroidMotionPath', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    it('should return true for paths under EncodedVideo', () => {
      const result = StorageCore.isAndroidMotionPath('/data/encoded-video/user-1/ab/cd/some-file-MP.mp4');
      expect(result).toBe(true);
    });

    it('should return false for paths not under EncodedVideo', () => {
      const result = StorageCore.isAndroidMotionPath('/data/library/user-1/some-file.mp4');
      expect(result).toBe(false);
    });

    it('should return true for keys under EncodedVideo', () => {
      expect(StorageCore.isAndroidMotionPath('encoded-video/user-1/ab/cd/some-file-MP.mp4')).toBe(true);
    });

    it('should return false for keys not under EncodedVideo', () => {
      expect(StorageCore.isAndroidMotionPath('upload/user-1/ab/cd/some-file.mp4')).toBe(false);
      expect(StorageCore.isAndroidMotionPath('library/user-1/encoded-video/some-file.mp4')).toBe(false);
    });
  });

  describe('getNestedFolder', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    it('should return the correct nested folder path', () => {
      const result = StorageCore.getNestedFolder(StorageFolder.Thumbnails, 'user-1', 'abcdef.webp');
      expect(result).toBe('/data/thumbs/user-1/ab/cd');
    });
  });

  describe('relative keys', () => {
    beforeEach(() => {
      StorageCore.setMediaLocation('/data');
    });

    describe('getRelativeNestedPath', () => {
      it('should return path without mediaLocation prefix', () => {
        const result = StorageCore.getRelativeNestedPath(StorageFolder.Thumbnails, 'user123', 'abcdef.webp');
        expect(result).toBe('thumbs/user123/ab/cd/abcdef.webp');
        expect(result.startsWith('/')).toBe(false);
      });

      it('should return path for encoded-video folder', () => {
        const result = StorageCore.getRelativeNestedPath(StorageFolder.EncodedVideo, 'user456', 'xyz789.mp4');
        expect(result).toBe('encoded-video/user456/xy/z7/xyz789.mp4');
        expect(result.startsWith('/')).toBe(false);
      });
    });

    describe('getRelativeImagePath', () => {
      it('should return relative path for thumbnail', () => {
        const result = StorageCore.getRelativeImagePath(
          { id: 'asset-1', ownerId: 'user-1' },
          { fileType: AssetFileType.Thumbnail, format: ImageFormat.Webp, isEdited: false },
        );
        expect(result.startsWith('/')).toBe(false);
        expect(result).toContain('thumbs/');
        expect(result).toContain('asset-1_thumbnail.webp');
      });

      it('should return relative path for edited preview', () => {
        const result = StorageCore.getRelativeImagePath(
          { id: 'asset-2', ownerId: 'user-2' },
          { fileType: AssetFileType.Preview, format: ImageFormat.Jpeg, isEdited: true },
        );
        expect(result.startsWith('/')).toBe(false);
        expect(result).toContain('thumbs/');
        expect(result).toContain('asset-2_preview_edited.jpeg');
      });
    });

    describe('getRelativeEncodedVideoPath', () => {
      it('should return relative path for encoded video', () => {
        const result = StorageCore.getRelativeEncodedVideoPath({ id: 'asset-1', ownerId: 'user-1' });
        expect(result.startsWith('/')).toBe(false);
        expect(result).toContain('encoded-video/');
        expect(result).toContain('asset-1.mp4');
      });
    });

    describe('getEditedEncodedVideoPath', () => {
      it('nests the _edited video beside the non-edited one', () => {
        StorageCore.setMediaLocation('/media');
        const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

        expect(StorageCore.getEditedEncodedVideoPath(asset as any)).toBe(
          '/media/encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
        );
      });
    });

    describe('getRelativeEditedEncodedVideoPath', () => {
      it('returns the _edited key', () => {
        const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

        expect(StorageCore.getRelativeEditedEncodedVideoPath(asset as any)).toBe(
          'encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
        );
      });

      it('never collides with the non-edited encoded video key', () => {
        const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

        expect(StorageCore.getRelativeEditedEncodedVideoPath(asset as any)).not.toBe(
          StorageCore.getRelativeEncodedVideoPath(asset as any),
        );
      });
    });

    describe('getRelativePersonThumbnailPath', () => {
      it('should return relative path for person thumbnail', () => {
        const result = StorageCore.getRelativePersonThumbnailPath({ personGroupId: 'person-1', ownerId: 'user-1' });
        expect(result.startsWith('/')).toBe(false);
        expect(result).toContain('thumbs/');
        expect(result).toContain('person-1.jpeg');
      });
    });

    describe('existing methods (backward compatibility)', () => {
      it('getNestedPath should still return absolute path', () => {
        const result = StorageCore.getNestedPath(StorageFolder.Thumbnails, 'user123', 'abcdef.webp');
        expect(result).toBe('/data/thumbs/user123/ab/cd/abcdef.webp');
      });

      it('getImagePath should still return absolute path', () => {
        const result = StorageCore.getImagePath(
          { id: 'asset-1', ownerId: 'user-1' },
          { fileType: AssetFileType.Thumbnail, format: ImageFormat.Webp, isEdited: false },
        );
        expect(result.startsWith('/data/')).toBe(true);
      });

      it('getEncodedVideoPath should still return absolute path', () => {
        const result = StorageCore.getEncodedVideoPath({ id: 'asset-1', ownerId: 'user-1' });
        expect(result.startsWith('/data/')).toBe(true);
      });

      it('getPersonThumbnailPath should still return absolute path', () => {
        const result = StorageCore.getPersonThumbnailPath({ personGroupId: 'person-1', ownerId: 'user-1' });
        expect(result.startsWith('/data/')).toBe(true);
      });
    });
  });

  describe('moveFile', () => {
    let core: StorageCore;
    let mocks: ReturnType<typeof getMocks>;
    let s3Backend: { exists: Mock; copy: Mock; stat: Mock; delete: Mock; downloadToTemp: Mock };
    let previousS3Backend: unknown;

    const assetInfo = { sizeInBytes: 1000, checksum: Buffer.from('checksum', 'utf8') };

    const expectNoDiskCalls = () => {
      expect(mocks.storage.mkdirSync).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.storage.copyFile).not.toHaveBeenCalled();
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
      expect(mocks.storage.checkFileExists).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      StorageCore.reset();
      StorageCore.setMediaLocation('/data');
      mocks = getMocks();
      core = StorageCore.create(
        mocks.asset as any,
        mocks.config as any,
        mocks.crypto as any,
        mocks.move as any,
        mocks.person as any,
        mocks.storage as any,
        mocks.systemMetadata as any,
        mocks.logger as any,
      );

      s3Backend = {
        exists: vitest.fn().mockResolvedValue(false),
        copy: vitest.fn().mockResolvedValue(void 0),
        stat: vitest.fn().mockResolvedValue({ size: assetInfo.sizeInBytes }),
        delete: vitest.fn().mockResolvedValue(void 0),
        downloadToTemp: vitest.fn(),
      };
      previousS3Backend = (StorageService as any).s3Backend;
      (StorageService as any).s3Backend = s3Backend;

      mocks.move.getByEntity.mockResolvedValue(void 0);
      mocks.move.create.mockImplementation((entity) => Promise.resolve({ id: 'move-1', ...entity } as any));
      mocks.move.delete.mockResolvedValue({} as any);
    });

    afterEach(() => {
      (StorageService as any).s3Backend = previousS3Backend;
    });

    it('should move a key original inside its backend', async () => {
      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: 'upload/user/ab/cd/file.jpg',
        newPath: 'library/user/2021/file.jpg',
        assetInfo,
      });

      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: 'upload/user/ab/cd/file.jpg',
        newPath: 'library/user/2021/file.jpg',
      });
      expect(s3Backend.copy).toHaveBeenCalledWith('upload/user/ab/cd/file.jpg', 'library/user/2021/file.jpg');
      expect(s3Backend.stat).toHaveBeenCalledWith('library/user/2021/file.jpg');
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: 'asset-1', originalPath: 'library/user/2021/file.jpg' });
      expect(s3Backend.delete).toHaveBeenCalledWith('upload/user/ab/cd/file.jpg');
      expect(mocks.move.delete).toHaveBeenCalledWith('move-1');
      expect(mocks.asset.update.mock.invocationCallOrder[0]).toBeLessThan(s3Backend.delete.mock.invocationCallOrder[0]);
      expectNoDiskCalls();
    });

    it('should move a key derivative to the key of its disk path', async () => {
      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetFileType.Preview,
        oldPath: 'thumbs/user-1/asset-1_preview.jpeg',
        newPath: '/data/thumbs/user-1/as/se/asset-1_preview.jpeg',
      });

      expect(s3Backend.copy).toHaveBeenCalledWith(
        'thumbs/user-1/asset-1_preview.jpeg',
        'thumbs/user-1/as/se/asset-1_preview.jpeg',
      );
      expect(mocks.asset.upsertFile).toHaveBeenCalledWith({
        assetId: 'asset-1',
        type: AssetFileType.Preview,
        path: 'thumbs/user-1/as/se/asset-1_preview.jpeg',
      });
      expect(s3Backend.delete).toHaveBeenCalledWith('thumbs/user-1/asset-1_preview.jpeg');
      expectNoDiskCalls();
    });

    it('should save a moved person thumbnail key for its owner', async () => {
      await core.moveFile({
        entityId: 'person-1',
        ownerId: 'user-1',
        pathType: PersonPathType.Face,
        oldPath: 'thumbs/user-1/person-1.jpeg',
        newPath: '/data/thumbs/user-1/pe/rs/person-1.jpeg',
      });

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: 'user-1',
        personGroupId: 'person-1',
        thumbnailPath: 'thumbs/user-1/pe/rs/person-1.jpeg',
      });
      expectNoDiskCalls();
    });

    it('should not move a key that is already at the key of its disk path', async () => {
      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetFileType.Preview,
        oldPath: 'thumbs/user-1/as/se/asset-1_preview.jpeg',
        newPath: '/data/thumbs/user-1/as/se/asset-1_preview.jpeg',
      });

      expect(mocks.move.getByEntity).not.toHaveBeenCalled();
      expect(s3Backend.copy).not.toHaveBeenCalled();
      expect(mocks.asset.upsertFile).not.toHaveBeenCalled();
      expectNoDiskCalls();
    });

    it('should rename a disk file whose new path is a key to <mediaLocation>/<key>', async () => {
      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetFileType.Sidecar,
        oldPath: '/data/upload/user/ab/cd/file.jpg.xmp',
        newPath: 'library/user/2021/file.jpg.xmp',
      });

      expect(mocks.storage.mkdirSync).toHaveBeenCalledWith('/data/library/user/2021');
      expect(mocks.move.create).toHaveBeenCalledWith({
        entityId: 'asset-1',
        pathType: AssetFileType.Sidecar,
        oldPath: '/data/upload/user/ab/cd/file.jpg.xmp',
        newPath: '/data/library/user/2021/file.jpg.xmp',
      });
      expect(mocks.storage.rename).toHaveBeenCalledWith(
        '/data/upload/user/ab/cd/file.jpg.xmp',
        '/data/library/user/2021/file.jpg.xmp',
      );
      expect(mocks.asset.upsertFile).toHaveBeenCalledWith({
        assetId: 'asset-1',
        type: AssetFileType.Sidecar,
        path: '/data/library/user/2021/file.jpg.xmp',
      });
      expect(s3Backend.copy).not.toHaveBeenCalled();
      expect(s3Backend.delete).not.toHaveBeenCalled();
    });
  });
});
