import { relative } from 'node:path';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { StorageFolder } from 'src/enum.js';

// A leaf next to StorageCore: the media location is passed in, since importing storage.core.ts here would close a
// cycle (storage.core.ts imports this module).

/**
 * The S3 key of `path`: a key stays as it is, a disk path under the media location loses that prefix (the inverse of
 * `join(mediaLocation, key)`, the mapping the storage migration uses), and any other disk path has no key (null).
 */
export const toS3Key = (path: string, mediaLocation: string): string | null => {
  if (!isDiskPath(path)) {
    return path;
  }

  const key = relative(mediaLocation, path);
  // `..` as a whole segment leaves the media location; a name that only starts with it (`..hidden`) does not
  return key && key !== '..' && !key.startsWith('../') ? key : null;
};

/** Whether `path` is under storage folder `folder`: `<mediaLocation>/<folder>/…` on disk, `<folder>/…` as an S3 key */
export const isInStorageFolder = (path: string, folder: StorageFolder, mediaLocation: string): boolean =>
  toS3Key(path, mediaLocation)?.startsWith(`${folder}/`) ?? false;
