import { join } from 'node:path';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';
import { toBackendKey } from 'src/gallery/utils/backend-file-move.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';

/**
 * The library folder a storage template renders into, in the namespace that holds the original: a disk file gets
 * upstream's `<mediaLocation>/library/<label>`, a storage-backend key (S3) gets the key `library/<label>`, the key a
 * storage migration gives that disk folder.
 *
 * It ends in `/`, so upstream's `fullPath.startsWith(rootPath)` guard also refuses a sibling folder: a template that
 * renders `../admin2/…` (from EXIF make or model) must not escape `library/admin` into `library/admin2`, which
 * belongs to another user and is removed with them.
 */
export const getTemplateLibraryRoot = (originalPath: string, user: { id: string; storageLabel: string | null }) => {
  const root = isDiskPath(originalPath)
    ? StorageCore.getLibraryFolder(user)
    : join(StorageFolder.Library, user.storageLabel || user.id);
  return `${root}/`;
};

/**
 * Whether a storage template destination is taken. Without S3 this is upstream's disk check. With S3 configured a
 * destination is taken when either backend holds it (`<mediaLocation>/<key>` on disk, `<key>` in S3): a storage
 * migration maps the one onto the other, and its "target already exists" shortcut would point a second asset at
 * the first one's file.
 */
export const isTemplateDestinationTaken = async (
  destination: string,
  storageRepository: StorageRepository,
  logger: LoggingRepository,
): Promise<boolean> => {
  const mediaLocation = StorageCore.getMediaLocation();
  const diskPath = isDiskPath(destination) ? destination : join(mediaLocation, destination);
  if (await storageRepository.checkFileExists(diskPath)) {
    return true;
  }

  // lazy import to avoid a circular dependency (StorageService extends BaseService)
  const { StorageService } = await import('../../services/storage.service.js');
  const s3 = StorageService.getS3Backend();
  const key = toBackendKey(destination, mediaLocation);
  if (!s3 || key === null) {
    return false;
  }

  if (!isDiskPath(destination)) {
    return s3.exists(key);
  }

  // upstream never asked S3 about a disk destination, so an S3 outage must not stop disk templating: the key counts
  // as free, and a later storage migration's size check refuses a target that is not this file
  try {
    return await s3.exists(key);
  } catch (error: any) {
    logger.warn(`Unable to check whether S3 holds ${key}, treating ${destination} as free: ${error.message}`);
    return false;
  }
};
