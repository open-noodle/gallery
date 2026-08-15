import {
  MIGRATION_FILE_TYPE_TO_KIND,
  resolveRouting,
  StorageMigrationFileType,
  StorageRoutingKind,
} from 'src/backends/storage-router';
import { StorageRouting } from 'src/dtos/system-config.dto';
import { describe, expect, it } from 'vitest';

describe('resolveRouting', () => {
  it('follows the env backend when set to auto', () => {
    expect(resolveRouting(StorageRouting.Auto, 'disk')).toBe('disk');
    expect(resolveRouting(StorageRouting.Auto, 's3')).toBe('s3');
  });

  it('pins to disk regardless of the env backend', () => {
    expect(resolveRouting(StorageRouting.Disk, 'disk')).toBe('disk');
    expect(resolveRouting(StorageRouting.Disk, 's3')).toBe('disk');
  });

  it('pins to s3 regardless of the env backend', () => {
    expect(resolveRouting(StorageRouting.S3, 'disk')).toBe('s3');
    expect(resolveRouting(StorageRouting.S3, 's3')).toBe('s3');
  });
});

describe('MIGRATION_FILE_TYPE_TO_KIND', () => {
  const allFileTypes: StorageMigrationFileType[] = [
    'originals',
    'thumbnails',
    'previews',
    'fullsize',
    'encodedVideos',
    'sidecars',
    'personThumbnails',
    'profileImages',
  ];

  it('maps every migration file type to exactly one kind', () => {
    for (const fileType of allFileTypes) {
      expect(MIGRATION_FILE_TYPE_TO_KIND[fileType]).toBeDefined();
    }
    expect(Object.keys(MIGRATION_FILE_TYPE_TO_KIND).sort()).toEqual([...allFileTypes].sort());
  });

  it('groups derivatives under thumbnails and originals with sidecars', () => {
    expect(MIGRATION_FILE_TYPE_TO_KIND.originals).toBe(StorageRoutingKind.Originals);
    expect(MIGRATION_FILE_TYPE_TO_KIND.sidecars).toBe(StorageRoutingKind.Originals);
    expect(MIGRATION_FILE_TYPE_TO_KIND.thumbnails).toBe(StorageRoutingKind.Thumbnails);
    expect(MIGRATION_FILE_TYPE_TO_KIND.previews).toBe(StorageRoutingKind.Thumbnails);
    expect(MIGRATION_FILE_TYPE_TO_KIND.fullsize).toBe(StorageRoutingKind.Thumbnails);
    expect(MIGRATION_FILE_TYPE_TO_KIND.personThumbnails).toBe(StorageRoutingKind.Thumbnails);
    expect(MIGRATION_FILE_TYPE_TO_KIND.profileImages).toBe(StorageRoutingKind.Thumbnails);
    expect(MIGRATION_FILE_TYPE_TO_KIND.encodedVideos).toBe(StorageRoutingKind.EncodedVideo);
  });
});
