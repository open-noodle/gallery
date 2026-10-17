import { StorageCore } from 'src/cores/storage.core.js';
import { AssetFileType, ImageFormat, StorageFolder } from 'src/enum.js';
import {
  getEditedEncodedVideoPath,
  getMotionVideoPath,
  getRelativeEditedEncodedVideoPath,
  getRelativeEncodedVideoPath,
  getRelativeImagePath,
  getRelativeNestedPath,
  getRelativePersonThumbnailPath,
} from 'src/gallery/utils/storage-keys.js';

describe('storage keys', () => {
  beforeEach(() => {
    StorageCore.setMediaLocation('/data');
  });

  describe('getRelativeNestedPath', () => {
    it('should return path without mediaLocation prefix', () => {
      const result = getRelativeNestedPath(StorageFolder.Thumbnails, 'user123', 'abcdef.webp');
      expect(result).toBe('thumbs/user123/ab/cd/abcdef.webp');
      expect(result.startsWith('/')).toBe(false);
    });

    it('should return path for encoded-video folder', () => {
      const result = getRelativeNestedPath(StorageFolder.EncodedVideo, 'user456', 'xyz789.mp4');
      expect(result).toBe('encoded-video/user456/xy/z7/xyz789.mp4');
      expect(result.startsWith('/')).toBe(false);
    });
  });

  describe('getRelativeImagePath', () => {
    it('should return relative path for thumbnail', () => {
      const result = getRelativeImagePath(
        { id: 'asset-1', ownerId: 'user-1' },
        { fileType: AssetFileType.Thumbnail, format: ImageFormat.Webp, isEdited: false },
      );
      expect(result.startsWith('/')).toBe(false);
      expect(result).toContain('thumbs/');
      expect(result).toContain('asset-1_thumbnail.webp');
    });

    it('should return relative path for edited preview', () => {
      const result = getRelativeImagePath(
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
      const result = getRelativeEncodedVideoPath({ id: 'asset-1', ownerId: 'user-1' });
      expect(result.startsWith('/')).toBe(false);
      expect(result).toContain('encoded-video/');
      expect(result).toContain('asset-1.mp4');
    });
  });

  describe('getEditedEncodedVideoPath', () => {
    it('nests the _edited video beside the non-edited one', () => {
      StorageCore.setMediaLocation('/media');
      const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

      expect(getEditedEncodedVideoPath(asset as any)).toBe(
        '/media/encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
      );
    });
  });

  describe('getRelativeEditedEncodedVideoPath', () => {
    it('returns the _edited key', () => {
      const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

      expect(getRelativeEditedEncodedVideoPath(asset as any)).toBe(
        'encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
      );
    });

    it('never collides with the non-edited encoded video key', () => {
      const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

      expect(getRelativeEditedEncodedVideoPath(asset as any)).not.toBe(getRelativeEncodedVideoPath(asset as any));
    });
  });

  describe('getRelativePersonThumbnailPath', () => {
    it('should return relative path for person thumbnail', () => {
      const result = getRelativePersonThumbnailPath({ personGroupId: 'person-1', ownerId: 'user-1' });
      expect(result.startsWith('/')).toBe(false);
      expect(result).toContain('thumbs/');
      expect(result).toContain('person-1.jpeg');
    });
  });

  describe('getMotionVideoPath', () => {
    it('should return upstream disk path beside a disk original', () => {
      const asset = { id: 'asset-1', ownerId: 'user-1', originalPath: '/data/upload/user-1/ab/cd/asset.jpg' };
      expect(getMotionVideoPath(asset, 'motion-1')).toBe(StorageCore.getAndroidMotionPath(asset, 'motion-1'));
    });

    it('should return a relative key beside an S3 original', () => {
      const asset = { id: 'asset-1', ownerId: 'user-1', originalPath: 'upload/user-1/ab/cd/asset.jpg' };
      expect(getMotionVideoPath(asset, 'motion-1')).toBe('encoded-video/user-1/mo/ti/motion-1-MP.mp4');
    });
  });
});
