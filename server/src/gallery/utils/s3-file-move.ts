import { isAbsolute, join } from 'node:path';
import type { MoveRequest } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType } from 'src/enum.js';
import { toS3Key } from 'src/gallery/utils/s3-key.js';
import { storageBackends } from 'src/gallery/utils/storage-backends.js';
import { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MoveRepository } from 'src/repositories/move.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { getConfig } from 'src/utils/config.js';

export type S3MoveDependencies = {
  mediaLocation: string;
  moveRepository: MoveRepository;
  cryptoRepository: CryptoRepository;
  configRepository: ConfigRepository;
  systemMetadataRepository: SystemMetadataRepository;
  logger: LoggingRepository;
  /** upstream's StorageCore.moveFile, for a disk file whose new path came out as an S3 key */
  moveDiskFile: (request: MoveRequest) => Promise<void>;
  /** upstream's StorageCore.savePath, bound to the request's entity and path type */
  savePath: (newPath: string) => Promise<unknown> | undefined;
};

/**
 * StorageCore.moveFile for a request that is not disk-to-disk: a file stays in the backend that holds it, and the
 * new path is read in that backend's namespace (`<mediaLocation>/<key>` on disk is `<key>` in S3). An S3 key moves
 * inside S3; a disk file whose new path is a key moves on disk through upstream's moveFile. Keys are written only
 * while S3 is configured, so without S3 the move is refused.
 *
 * Follows upstream's moveFile step for step, `move_history` row included, so an interrupted move is finished by the
 * next attempt. S3 has no rename, so the move is a server-side copy, the size check upstream's disk move makes, and a
 * delete. The database is pointed at the new key before the old key is deleted: a crash in between leaves an extra
 * object, never an asset whose key is missing.
 */
export const moveS3File = async (request: MoveRequest, deps: S3MoveDependencies): Promise<void> => {
  const { entityId, pathType, oldPath, assetInfo } = request;
  const { mediaLocation, moveRepository, logger } = deps;
  if (!oldPath) {
    return;
  }

  const s3 = storageBackends.s3Backend;
  if (!s3) {
    logger.warn(`Unable to move ${entityId}: ${oldPath} => ${request.newPath} needs S3, which is not configured`);
    return;
  }

  // 0. A sidecar follows its original to `<original>.xmp`. A move of the original that stops without throwing (copy
  // error, size mismatch, missing asset info, file at neither location, failed verification) keeps its row; moving
  // the sidecar anyway would put it beside a file the original never reached, where a later asset of that name
  // overwrites it. A row left by a crash between savePath and the row delete also keeps the sidecar where it is
  // (safe, not beside its original) until the original moves again.
  if (pathType === AssetFileType.Sidecar && (await moveRepository.getByEntity(entityId, AssetPathType.Original))) {
    logger.warn(`Not moving the sidecar of ${entityId}: the move of its original is unfinished`);
    return;
  }

  // A disk file whose new path is a key. Only a sidecar gets here: the disk sidecar of an S3 original, left on disk by
  // a storage migration run without sidecars or whose sidecar job failed. The template sends it to `<new key>.xmp`, in
  // its original's namespace; it moves on disk to that key's disk path, `<mediaLocation>/<new key>.xmp`, through
  // upstream's disk move. Upstream's code cannot take the key itself: it would create the folder and rename relative to
  // the working directory, then save a relative path, which every reader takes for an S3 key. It comes after the
  // sidecar wait above, which holds a disk sidecar back too.
  if (isAbsolute(oldPath)) {
    return deps.moveDiskFile({ ...request, newPath: join(mediaLocation, request.newPath) });
  }

  const newPath = toS3Key(request.newPath, mediaLocation);
  if (newPath === null) {
    logger.warn(
      `Unable to complete move. ${request.newPath} is outside the media location, so ${oldPath} cannot move there`,
    );
    return;
  }

  if (oldPath === newPath) {
    return;
  }

  // 1. The move_history row
  const move = await startOrResumeMove(s3, { ...request, oldPath, newPath }, deps);
  if (!move) {
    return;
  }

  if (pathType === AssetPathType.Original && !assetInfo) {
    logger.warn(`Unable to complete move. Missing asset info for ${entityId}`);
    return;
  }

  const isCopied = move.oldPath !== newPath;
  if (isCopied) {
    // 2. Copy
    try {
      logger.debug(`Attempting to copy file: ${move.oldPath} => ${newPath}`);
      await s3.copy(move.oldPath, newPath);
    } catch (error: any) {
      // AWS SDK errors carry their code as `name`
      logger.warn(
        `Unable to complete move. Error copying file with code ${error.code ?? error.name} and message: ${error.message}`,
      );
      return;
    }

    // 3. Check the copy's size against the asset's, or the old object's (still there after a copy)
    const { size: expectedSize } = assetInfo ? { size: assetInfo.sizeInBytes } : await s3.stat(move.oldPath);
    if (!(await hasExpectedSize(s3, newPath, expectedSize, logger))) {
      // an original's destination was picked as free under the template lock, so the copy there is this one. A
      // derivative's or sidecar's may have just been written by another job (a regenerated thumbnail): it stays,
      // and the row makes the next attempt redo the copy.
      if (assetInfo) {
        await s3.delete(newPath);
      }
      return;
    }
  }

  // 4. Save the new path
  await deps.savePath(newPath);

  // 5. Delete the old key
  if (isCopied) {
    try {
      await s3.delete(move.oldPath);
    } catch (error: any) {
      // an S3 error message does not name the key, and integrity checks skip S3: the log is all an admin gets
      logger.warn(
        `Unable to delete old file ${move.oldPath}, it will now no longer be tracked by Immich: ${error.message}`,
      );
    }
  }

  // 6. Delete the row
  await moveRepository.delete(move.id);
};

type MoveRow = Awaited<ReturnType<MoveRepository['create']>>;

/**
 * Step 1: the `move_history` row this move runs under, pointed at the key-form `newPath` and at the file to copy from
 * (the row's `oldPath`), or null when the move cannot go ahead (logged). Upstream's moveFile creates a row or runs its
 * recovery on the one it finds; two kinds of row that recovery would misread are replaced first. Each case names the
 * earlier state that leaves such a row.
 */
const startOrResumeMove = async (
  s3: StorageBackend,
  { entityId, pathType, oldPath, newPath, assetInfo }: MoveRequest & { oldPath: string },
  deps: S3MoveDependencies,
): Promise<MoveRow | null> => {
  const { moveRepository, logger } = deps;
  const move = await moveRepository.getByEntity(entityId, pathType);

  if (!move) {
    // A fresh move. The template probes only the original's destination, and a copy overwrites: a sidecar left behind
    // by its own failed move (its original moved on) still holds `<name>.xmp` for that other asset, and must not be
    // replaced by this one.
    if (pathType === AssetFileType.Sidecar && (await s3.exists(newPath))) {
      logger.warn(`Not moving the sidecar of ${entityId}: ${newPath} is taken`);
      return null;
    }

    return moveRepository.create({ entityId, pathType, oldPath, newPath });
  }

  if (isAbsolute(move.oldPath) || isAbsolute(move.newPath)) {
    // A disk move of this file stopped before deleting its row (a rename error, a mismatch after a cross-device copy,
    // a crash), then a storage migration moved the file at the database's path into S3. The row's disk paths name
    // nothing in S3: upstream's recovery would look them up there, find neither, and give up on every run.
    logger.log(`Replacing a stale disk move (${move.oldPath} => ${move.newPath}) with ${oldPath} => ${newPath}`);
    return moveRepository.update(move.id, { id: move.id, oldPath, newPath });
  }

  if (move.oldPath !== oldPath && (await s3.exists(oldPath))) {
    // The database has moved on from the row: an earlier move saved its new path, then stopped (a crash) before
    // deleting the row, and the template now renders another destination (with the same one, moveFile returns before
    // this). Upstream's recovery would copy the row's leftover over the destination and orphan the database's file,
    // which for a sidecar may have been rewritten since. The leftover is not deleted: an admin may have removed that
    // orphan by hand and its name may since belong to another asset.
    logger.log(`Replacing an outdated move (${move.oldPath} => ${move.newPath}) with ${oldPath} => ${newPath}`);
    return moveRepository.update(move.id, { id: move.id, oldPath, newPath });
  }

  // Upstream's recovery: this file's own move stopped before saving its new path (the copy failed, the size differed,
  // asset info was missing, or a crash). Restart from the old file, else take the file at the row's new path once
  // verified, else give up. This also covers a database path that is gone: an interrupted recovery may have moved
  // the row on to a file the database never pointed at.
  logger.log(`Attempting to finish incomplete move: ${move.oldPath} => ${move.newPath}`);
  const isOldPathExists = await s3.exists(move.oldPath);
  const isNewPathExists = await s3.exists(move.newPath);
  const newPathCheck = isNewPathExists ? move.newPath : null;
  const actualPath = isOldPathExists ? move.oldPath : newPathCheck;
  if (!actualPath) {
    logger.warn('Unable to complete move. File does not exist at either location.');
    return null;
  }

  const isFileAtNewLocation = actualPath === move.newPath;
  logger.log(`Found file at ${isFileAtNewLocation ? 'new' : 'old'} location`);

  if (isFileAtNewLocation && !(await verifyMovedFile(s3, move.newPath, assetInfo, deps))) {
    logger.fatal(
      `Skipping move as file verification failed, old file is missing and new file is different to what was expected`,
    );
    return null;
  }

  return moveRepository.update(move.id, { id: move.id, oldPath: actualPath, newPath });
};

/**
 * The size check of upstream's verifyNewPathContentsMatchesExpected: whether the file at `key` holds `expectedSize`
 * bytes (a `HeadObject` on S3). A mismatch is logged; what it costs is the caller's to decide.
 */
const hasExpectedSize = async (
  s3: StorageBackend,
  key: string,
  expectedSize: number,
  logger: LoggingRepository,
): Promise<boolean> => {
  const { size } = await s3.stat(key);
  logger.debug(`File size check: ${size} === ${expectedSize}`);
  if (size !== expectedSize) {
    logger.warn(`Unable to complete move. File size mismatch: ${size} !== ${expectedSize}`);
    return false;
  }

  return true;
};

/**
 * Upstream's check of a file an interrupted move left at its new location: the size, then the checksum when
 * storageTemplate.hashVerificationEnabled. The old file is gone by then, so without asset info (a derivative file)
 * there is nothing to compare against and the file is taken as it is.
 */
const verifyMovedFile = async (
  s3: StorageBackend,
  newPath: string,
  assetInfo: MoveRequest['assetInfo'],
  deps: S3MoveDependencies,
): Promise<boolean> => {
  const { logger } = deps;
  if (!assetInfo) {
    return true;
  }

  if (!(await hasExpectedSize(s3, newPath, assetInfo.sizeInBytes, logger))) {
    return false;
  }

  const config = await getConfig(
    { configRepo: deps.configRepository, metadataRepo: deps.systemMetadataRepository, logger },
    { withCache: true },
  );
  if (!config.storageTemplate.hashVerificationEnabled) {
    return true;
  }

  await using local = await stage(s3, newPath);
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

const stage = async (s3: StorageBackend, key: string) => {
  const { tempPath, cleanup } = await s3.downloadToTemp(key);
  return { tempPath, [Symbol.asyncDispose]: cleanup };
};
