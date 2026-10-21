import { join } from 'node:path';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';
import { toBackendKey } from 'src/gallery/utils/backend-file-move.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';

/**
 * The library folder a storage template renders into, in the namespace that holds the original: a disk file gets
 * upstream's `<mediaLocation>/library/<label>`, a storage-backend key (S3) gets the key `library/<label>`, the key a
 * storage migration gives that disk folder.
 */
export const getTemplateLibraryRoot = (originalPath: string, user: { id: string; storageLabel: string | null }) =>
  isDiskPath(originalPath)
    ? StorageCore.getLibraryFolder(user)
    : join(StorageFolder.Library, user.storageLabel || user.id);

/**
 * Whether a storage template destination is taken. Without S3 this is upstream's disk check. With S3 configured a
 * destination is taken when either backend holds it (`<mediaLocation>/<key>` on disk, `<key>` in S3): a storage
 * migration maps the one onto the other, and its "target already exists" shortcut would point a second asset at
 * the first one's file.
 */
export const isTemplateDestinationTaken = async (
  destination: string,
  storageRepository: StorageRepository,
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
  return !!s3 && key !== null && (await s3.exists(key));
};
