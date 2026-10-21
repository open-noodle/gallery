import { join } from 'node:path';
import type { StorageAsset } from 'src/types.js';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder, SystemMetadataKey } from 'src/enum.js';
import { toBackendKey } from 'src/gallery/utils/backend-file-move.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';

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
 * Whether the per-asset template job, which runs after every metadata extraction, must leave this asset to a manual
 * run. An install that upgraded with files in S3 and the template enabled had the template do nothing in the bucket;
 * moving its new uploads the moment it upgrades would be a surprise. Until an admin finishes one Storage Template
 * Migration by hand (`StorageTemplateS3State.pending`, decided on the first start of this version), its S3 files keep
 * their upload keys. Disk files, and every file once the flag is cleared or on a fresh install, move as upstream does.
 * An asset counts when its original or its sidecar is a key; its disk files then wait for the same manual run, so an
 * original and its sidecar are never split by the automatic job.
 */
export const isManualOnlyTemplateMove = async (
  { originalPath, files }: StorageAsset,
  systemMetadataRepository: SystemMetadataRepository,
): Promise<boolean> => {
  const hasBackendFile = !isDiskPath(originalPath) || (files ?? []).some(({ path }) => !isDiskPath(path));
  if (!hasBackendFile) {
    return false;
  }

  const state = await systemMetadataRepository.get(SystemMetadataKey.StorageTemplateS3State);
  return !!state?.pending;
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
