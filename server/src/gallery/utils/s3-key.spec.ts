import { StorageFolder } from 'src/enum.js';
import { isInStorageFolder, toS3Key } from 'src/gallery/utils/s3-key.js';

describe('toS3Key', () => {
  it('should keep a key as it is', () => {
    expect(toS3Key('upload/user-1/as/se/asset-1.jpg', '/data')).toBe('upload/user-1/as/se/asset-1.jpg');
  });

  it('should strip the media location from a disk path under it', () => {
    expect(toS3Key('/data/thumbs/user-1/as/se/asset-1_preview.jpeg', '/data')).toBe(
      'thumbs/user-1/as/se/asset-1_preview.jpeg',
    );
  });

  it('should accept a media location with a trailing slash', () => {
    expect(toS3Key('/data/thumbs/user-1/a.jpeg', '/data/')).toBe('thumbs/user-1/a.jpeg');
  });

  it('should have no key for the media location itself', () => {
    expect(toS3Key('/data', '/data')).toBeNull();
    expect(toS3Key('/data/', '/data')).toBeNull();
  });

  it('should have no key for a sibling that shares the prefix', () => {
    expect(toS3Key('/data2/x', '/data')).toBeNull();
  });

  it('should have no key for a path outside the media location', () => {
    expect(toS3Key('/mnt/photos/IMG_1.jpg', '/data')).toBeNull();
  });

  it('should keep a folder whose name starts with ..', () => {
    expect(toS3Key('/data/..hidden/x.jpg', '/data')).toBe('..hidden/x.jpg');
    expect(toS3Key('/data/library/..hidden', '/data')).toBe('library/..hidden');
  });

  it('should collapse a doubled separator', () => {
    expect(toS3Key('/data//library/x.jpg', '/data')).toBe('library/x.jpg');
  });

  it('should resolve .. segments', () => {
    expect(toS3Key('/data/library/../thumbs/x.jpg', '/data')).toBe('thumbs/x.jpg');
    expect(toS3Key('/data/library/..', '/data')).toBeNull();
    expect(toS3Key('/data/../etc/passwd', '/data')).toBeNull();
    expect(toS3Key('/data/library/../..', '/data')).toBeNull();
  });
});

describe('isInStorageFolder', () => {
  it.each([
    { label: 'a disk path under the folder', path: '/data/encoded-video/user-1/ab/cd/x-MP.mp4', expected: true },
    { label: 'a disk path in another folder', path: '/data/thumbs/user-1/ab/cd/x.jpeg', expected: false },
    { label: 'an absolute path outside the media location', path: '/mnt/photos/encoded-video/x.mp4', expected: false },
    { label: 'a key under the folder', path: 'encoded-video/user-1/ab/cd/x-MP.mp4', expected: true },
    { label: 'a key with the folder name deeper down', path: 'library/u/encoded-video/x', expected: false },
    { label: 'a key in a sibling folder', path: 'encoded-videos/x', expected: false },
    { label: 'a disk path in a sibling folder', path: '/data/encoded-videos/x', expected: false },
    { label: 'the folder itself', path: '/data/encoded-video', expected: false },
  ])('should be $expected for $label', ({ path, expected }) => {
    expect(isInStorageFolder(path, StorageFolder.EncodedVideo, '/data')).toBe(expected);
  });
});
