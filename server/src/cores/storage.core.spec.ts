import { StorageCore } from 'src/cores/storage.core';
import { AssetFileType, ImageFormat, StorageFolder } from 'src/enum';
import { vitest } from 'vitest';

vitest.mock('src/constants', () => ({
  IWorker: 'IWorker',
}));

describe('StorageCore', () => {
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

    describe('getRelativePersonThumbnailPath', () => {
      it('should return relative path for person thumbnail', () => {
        const result = StorageCore.getRelativePersonThumbnailPath({ id: 'person-1', ownerId: 'user-1' });
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
        const result = StorageCore.getPersonThumbnailPath({ id: 'person-1', ownerId: 'user-1' });
        expect(result.startsWith('/data/')).toBe(true);
      });
    });
  });
});
