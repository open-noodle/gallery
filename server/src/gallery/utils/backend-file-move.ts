import { isAbsolute, join, relative } from 'node:path';
import type { MoveRequest } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType } from 'src/enum.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MoveRepository } from 'src/repositories/move.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { getConfig } from 'src/utils/config.js';

export type BackendMoveDependencies = {
  mediaLocation: string;
  moveRepository: MoveRepository;
  cryptoRepository: CryptoRepository;
  configRepository: ConfigRepository;
  systemMetadataRepository: SystemMetadataRepository;
  logger: LoggingRepository;
  /** upstream's StorageCore.moveFile, for a disk file whose new path came out as a backend key */
  moveDiskFile: (request: MoveRequest) => Promise<void>;
  /** upstream's StorageCore.savePath, bound to the request's entity and path type */
  savePath: (newPath: string) => Promise<unknown> | undefined;
};

/**
 * `path` as a storage-backend key: a key stays as it is, a disk path under the media location loses that prefix
 * (the mapping the storage migration uses), and any other disk path has no key (null).
 */
export const toBackendKey = (path: string, mediaLocation: string): string | null => {
  if (!isAbsolute(path)) {
    return path;
  }

  const key = relative(mediaLocation, path);
  return key && !key.startsWith('..') && !isAbsolute(key) ? key : null;
};

const backendFor = async (key: string): Promise<StorageBackend> => {
  // lazy import to avoid a circular dependency (StorageService imports StorageCore, which calls this module)
  const { StorageService } = await import('../../services/storage.service.js');
  return StorageService.backendFor(key);
};

/**
 * StorageCore.moveFile for a request that is not disk-to-disk: a file stays in the backend that holds it, and the
 * new path is read in that backend's namespace (`<mediaLocation>/<key>` on disk is `<key>` in S3). A storage-backend
 * key moves inside its backend; a disk file whose new path is a key moves on disk through upstream's moveFile.
 *
 * Follows upstream's moveFile step for step, `move_history` row included, so an interrupted move is finished by the
 * next attempt. S3 has no rename, so the move is a server-side copy, the size check upstream's disk move makes, and a
 * delete. The database is pointed at the new key before the old key is deleted: a crash in between leaves an extra
 * object, never an asset whose key is missing.
 */
export const moveBackendFile = async (request: MoveRequest, deps: BackendMoveDependencies): Promise<void> => {
  const { entityId, pathType, oldPath, assetInfo } = request;
  const { mediaLocation, moveRepository, logger } = deps;
  if (!oldPath) {
    return;
  }

  // A sidecar follows its original to `<original>.xmp`. A move of the original that stops without throwing (copy
  // error, size mismatch, missing asset info, file at neither location, failed verification) keeps its row; moving
  // the sidecar anyway would put it beside a file the original never reached, where a later asset of that name
  // overwrites it. A row left by a crash between savePath and the row delete also keeps the sidecar where it is
  // (safe, not beside its original) until the original moves again.
  if (pathType === AssetFileType.Sidecar && (await moveRepository.getByEntity(entityId, AssetPathType.Original))) {
    logger.warn(`Not moving the sidecar of ${entityId}: the move of its original is unfinished`);
    return;
  }

  if (isAbsolute(oldPath)) {
    return deps.moveDiskFile({ ...request, newPath: join(mediaLocation, request.newPath) });
  }

  const newPath = toBackendKey(request.newPath, mediaLocation);
  if (newPath === null) {
    logger.warn(
      `Unable to complete move. ${request.newPath} is outside the media location, so ${oldPath} cannot move there`,
    );
    return;
  }

  if (oldPath === newPath) {
    return;
  }

  const backend = await backendFor(oldPath);

  let move = await moveRepository.getByEntity(entityId, pathType);
  if (move && (isAbsolute(move.oldPath) || isAbsolute(move.newPath))) {
    // left by a disk move from before this file reached the backend: the database now has it at oldPath
    logger.log(`Replacing a stale disk move (${move.oldPath} => ${move.newPath}) with ${oldPath} => ${newPath}`);
    move = await moveRepository.update(move.id, { id: move.id, oldPath, newPath });
  } else if (move && move.oldPath !== oldPath && (await backend.exists(oldPath))) {
    // the database has moved on from this row (an earlier move saved its new path but stopped before cleaning up, or
    // the file was rewritten in place): move what the database points at. move.oldPath is not deleted: an admin may
    // have removed that orphan by hand and its name may since belong to another asset.
    logger.log(`Replacing an outdated move (${move.oldPath} => ${move.newPath}) with ${oldPath} => ${newPath}`);
    move = await moveRepository.update(move.id, { id: move.id, oldPath, newPath });
  } else if (move) {
    // upstream's recovery, also for a database path that is gone: an interrupted recovery may have moved the row
    // on to a file the database never pointed at
    logger.log(`Attempting to finish incomplete move: ${move.oldPath} => ${move.newPath}`);
    const isOldPathExists = await backend.exists(move.oldPath);
    const isNewPathExists = await backend.exists(move.newPath);
    const newPathCheck = isNewPathExists ? move.newPath : null;
    const actualPath = isOldPathExists ? move.oldPath : newPathCheck;
    if (!actualPath) {
      logger.warn('Unable to complete move. File does not exist at either location.');
      return;
    }

    const isFileAtNewLocation = actualPath === move.newPath;
    logger.log(`Found file at ${isFileAtNewLocation ? 'new' : 'old'} location`);

    if (isFileAtNewLocation && !(await verifyMovedFile(backend, move.newPath, assetInfo, deps))) {
      logger.fatal(
        `Skipping move as file verification failed, old file is missing and new file is different to what was expected`,
      );
      return;
    }

    move = await moveRepository.update(move.id, { id: move.id, oldPath: actualPath, newPath });
  } else {
    // the template probes only the original's destination, and a copy overwrites: a sidecar left behind by its own
    // failed move still holds `<name>.xmp` for an asset that has since moved on, and must not be replaced by another's
    if (pathType === AssetFileType.Sidecar && (await backend.exists(newPath))) {
      logger.warn(`Not moving the sidecar of ${entityId}: ${newPath} is taken`);
      return;
    }

    move = await moveRepository.create({ entityId, pathType, oldPath, newPath });
  }

  if (pathType === AssetPathType.Original && !assetInfo) {
    logger.warn(`Unable to complete move. Missing asset info for ${entityId}`);
    return;
  }

  const isCopied = move.oldPath !== newPath;
  if (isCopied) {
    try {
      logger.debug(`Attempting to copy file: ${move.oldPath} => ${newPath}`);
      await backend.copy(move.oldPath, newPath);
    } catch (error: any) {
      // AWS SDK errors carry their code as `name`
      logger.warn(
        `Unable to complete move. Error copying file with code ${error.code ?? error.name} and message: ${error.message}`,
      );
      return;
    }

    const { size: expectedSize } = assetInfo ? { size: assetInfo.sizeInBytes } : await backend.stat(move.oldPath);
    const { size } = await backend.stat(newPath);
    logger.debug(`File size check: ${size} === ${expectedSize}`);
    if (size !== expectedSize) {
      logger.warn(`Skipping move due to file size mismatch: ${size} !== ${expectedSize}`);
      // an original's destination was picked as free under the template lock, so the copy there is this one. A
      // derivative's or sidecar's may have just been written by another job (a regenerated thumbnail): it stays,
      // and the row makes the next attempt redo the copy.
      if (assetInfo) {
        await backend.delete(newPath);
      }
      return;
    }
  }

  await deps.savePath(newPath);

  if (isCopied) {
    try {
      await backend.delete(move.oldPath);
    } catch (error: any) {
      // an S3 error message does not name the key, and integrity checks skip S3: the log is all an admin gets
      logger.warn(
        `Unable to delete old file ${move.oldPath}, it will now no longer be tracked by Immich: ${error.message}`,
      );
    }
  }

  await moveRepository.delete(move.id);
};

/**
 * Upstream's check of a file an interrupted move left at its new location: the size, then the checksum when
 * storageTemplate.hashVerificationEnabled. The old file is gone by then, so without asset info (a derivative file)
 * there is nothing to compare against and the file is taken as it is.
 */
const verifyMovedFile = async (
  backend: StorageBackend,
  newPath: string,
  assetInfo: MoveRequest['assetInfo'],
  deps: BackendMoveDependencies,
): Promise<boolean> => {
  const { logger } = deps;
  if (!assetInfo) {
    return true;
  }

  const { size } = await backend.stat(newPath);
  logger.debug(`File size check: ${size} === ${assetInfo.sizeInBytes}`);
  if (size !== assetInfo.sizeInBytes) {
    logger.warn(`Unable to complete move. File size mismatch: ${size} !== ${assetInfo.sizeInBytes}`);
    return false;
  }

  const config = await getConfig(
    { configRepo: deps.configRepository, metadataRepo: deps.systemMetadataRepository, logger },
    { withCache: true },
  );
  if (!config.storageTemplate.hashVerificationEnabled) {
    return true;
  }

  await using local = await stage(backend, newPath);
  const checksum = await deps.cryptoRepository.hashFile(local.tempPath);
  if (!checksum.equals(assetInfo.checksum)) {
    logger.warn(
      `Unable to complete move. File checksum mismatch: ${checksum.toString('base64')} !== ${assetInfo.checksum.toString('base64')}`,
    );
    return false;
  }

  logger.debug(`File checksum check: ${checksum.toString('base64')} === ${assetInfo.checksum.toString('base64')}`);
  return true;
};

const stage = async (backend: StorageBackend, key: string) => {
  const { tempPath, cleanup } = await backend.downloadToTemp(key);
  return { tempPath, [Symbol.asyncDispose]: cleanup };
};
