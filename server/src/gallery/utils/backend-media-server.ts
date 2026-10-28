import { HttpException, HttpStatus } from '@nestjs/common';
import { CLS_REQ, ClsServiceManager } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Request } from 'express';
import type { GenerateThumbnailOptions, ImageDimensions, UploadFile } from 'src/types.js';
import { DiskStorageBackend, isDiskPath } from 'src/backends/disk-storage.backend.js';
import { FACE_THUMBNAIL_SIZE } from 'src/constants.js';
import { ThumbnailPathEntity } from 'src/cores/storage.core.js';
import { AssetFace } from 'src/database.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetEditAction, type CropParameters } from 'src/dtos/editing.dto.js';
import { AssetFileType, CacheControl, ImageFormat, ImmichHeader, JobName, StorageFolder } from 'src/enum.js';
import {
  getRelativeImagePath,
  getRelativeNestedPath,
  getRelativeProfileImagePath,
} from 'src/gallery/utils/storage-keys.js';
import { RangeNotSatisfiableError, ServeStrategy, StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import {
  ContentDisposition,
  ImmichFileResponse,
  ImmichMediaResponse,
  ImmichRedirectResponse,
  ImmichStreamResponse,
  getFilenameExtension,
  getResponseSignal,
} from 'src/utils/file.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { clamp } from 'src/utils/misc.js';

// HTTP clients resend custom headers (and some resend Authorization) when they follow a redirect to another host, so a
// request carrying its credential in one of these is proxied instead of redirected to the storage host. Cookies are
// host-scoped and query credentials are not part of the presigned URL, so browsers and the apps keep the redirect.
const CREDENTIAL_HEADERS = [
  'authorization',
  ImmichHeader.ApiKey,
  ImmichHeader.UserToken,
  ImmichHeader.SessionToken,
  ImmichHeader.SharedLinkKey,
  ImmichHeader.SharedLinkSlug,
];

const sendsHeaderCredential = () => {
  const headers = ClsServiceManager.getClsService().get<Request | undefined>(CLS_REQ)?.headers;
  return !!headers && CREDENTIAL_HEADERS.some((header) => headers[header]);
};

type FaceThumbnailBounds = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type BackendMediaServerDependencies = {
  assetRepository: AssetRepository;
  jobRepository: JobRepository;
  logger: LoggingRepository;
  mediaRepository: MediaRepository;
  storageRepository: StorageRepository;
  getConfig: (options: { withCache: boolean }) => Promise<SystemConfig>;
};

// Plain class (not @Injectable, not a repository), built once in BaseService's constructor and shared as
// `this.backendMedia`: serves files from whichever storage backend owns them (disk or S3), stages S3 objects
// locally for tools that need a path, and renders face crops.
export class BackendMediaServer {
  constructor(private deps: BackendMediaServerDependencies) {}

  /**
   * @param options.acceptsRanges set by callers whose route forwards the client's `Range`
   *        header, so the response may advertise `Accept-Ranges: bytes`.
   * @param options.range the client's raw `Range` header, when the route forwards one.
   *        The backend decides whether to honor it: disk serves ranges through express,
   *        and S3 in redirect mode leaves them to S3 — so it only changes the S3 proxy
   *        stream path, which previously ignored ranges entirely.
   */
  async serveFromBackend(
    filePath: string,
    contentType: string,
    cacheControl: CacheControl,
    fileName?: string,
    disposition: ContentDisposition = 'inline',
    options: { range?: string; acceptsRanges?: boolean } = {},
  ): Promise<ImmichMediaResponse> {
    const backend = await this.backendFor(filePath);
    let strategy: ServeStrategy;
    try {
      strategy = await backend.getServeStrategy(filePath, {
        contentType,
        cacheControl,
        fileName,
        disposition,
        range: options.range,
        signal: getResponseSignal(),
        ...(sendsHeaderCredential() && { proxy: true }),
      });
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        throw new HttpException('Requested range not satisfiable', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      }
      throw error;
    }
    const responseDisposition = disposition === 'inline' ? undefined : disposition;

    switch (strategy.type) {
      case 'file': {
        return new ImmichFileResponse({
          path: strategy.path,
          contentType,
          cacheControl,
          fileName,
          disposition: responseDisposition,
        });
      }
      case 'redirect': {
        return new ImmichRedirectResponse({
          url: strategy.url,
          cacheControl: CacheControl.PrivateWithoutCache,
        });
      }
      case 'stream': {
        return new ImmichStreamResponse({
          stream: strategy.stream,
          contentType,
          length: strategy.length,
          contentRange: strategy.contentRange,
          acceptsRanges: options.acceptsRanges,
          cacheControl,
          fileName,
          disposition: responseDisposition,
        });
      }
    }
  }

  /**
   * For assets on S3 backends, download to a local temp file for processing by
   * tools that require a filesystem path (ffmpeg, exiftool, sharp). Caller is
   * responsible for catching `downloadToTemp` errors or letting them propagate.
   *
   * @param filePath absolute disk path OR S3 relative key (anything that might
   *                 come from a DB column such as `asset.originalPath`).
   * @returns { localPath, cleanup } — cleanup is a no-op for disk paths and
   *          removes the temp file for S3-sourced paths. Declare the result with
   *          `await using` (disposal runs cleanup), or call cleanup in a `finally` block.
   */
  async ensureLocalFile(
    filePath: string,
  ): Promise<{ localPath: string; cleanup: () => Promise<void> } & AsyncDisposable> {
    const backend = await this.backendFor(filePath);
    const { tempPath, cleanup } = await backend.downloadToTemp(filePath);
    return { localPath: tempPath, cleanup, [Symbol.asyncDispose]: cleanup };
  }

  /**
   * Returns something ffmpeg/ffprobe can read directly: an absolute path as-is,
   * or a presigned URL for a storage-backend key. Unlike ensureLocalFile this
   * does NOT download the object, so it is safe to call inside a request handler.
   */
  async getProbeInput(filePath: string): Promise<string> {
    const backend = await this.backendFor(filePath);
    return backend.getReadableUrl(filePath);
  }

  /**
   * The storage backend that owns `key`, as StorageService.backendFor decides. An absolute path is read through
   * the owning service's StorageRepository, so disk I/O goes where upstream code (and its specs) expect it.
   */
  async backendFor(key: string): Promise<StorageBackend> {
    // lazy import to avoid circular dependency (StorageService extends BaseService)
    const { StorageService } = await import('../../services/storage.service.js');
    // no media location: this backend only ever receives absolute paths
    return StorageService.backendFor(key, new DiskStorageBackend('', this.deps.storageRepository));
  }

  /** Whether `path` exists on its backend; with `readable`, a disk file must also be readable. */
  async exists(path: string, options?: { readable?: boolean }): Promise<boolean> {
    const backend = await this.backendFor(path);
    return backend.exists(path, options);
  }

  /**
   * Writes `data` to `path` unless something is already there, on the disk (creating its folder) or the S3 backend.
   * Returns whether it wrote.
   */
  async writeFileIfMissing(path: string, data: Buffer, contentType: string): Promise<boolean> {
    const { storageRepository } = this.deps;
    if (isDiskPath(path)) {
      if (await storageRepository.checkFileExists(path)) {
        return false;
      }
      storageRepository.mkdirSync(dirname(path));
      await storageRepository.createFile(path, data);
      return true;
    }

    const backend = await this.backendFor(path);
    if (await backend.exists(path)) {
      return false;
    }
    await backend.put(path, data, { contentType });
    return true;
  }

  /**
   * Runs `write` on the sidecar at `sidecarPath`: in place on disk; for an S3 key against a local temp file that is
   * then uploaded. An existing S3 sidecar is downloaded first so its contents are kept; otherwise `write` creates a
   * fresh XMP at the temp path.
   */
  async writeSidecar(sidecarPath: string, write: (localPath: string) => Promise<unknown>): Promise<void> {
    if (isDiskPath(sidecarPath)) {
      await write(sidecarPath);
      return;
    }

    const { storageRepository } = this.deps;
    const backend = await this.backendFor(sidecarPath);
    const sidecarExists = await backend.exists(sidecarPath);
    let localSidecar: { localPath: string; cleanup: () => Promise<void> };
    if (sidecarExists) {
      localSidecar = await this.ensureLocalFile(sidecarPath);
    } else {
      const tempPath = join(tmpdir(), `immich-sidecar-${randomUUID()}.xmp`);
      localSidecar = {
        localPath: tempPath,
        cleanup: async () => {
          try {
            await storageRepository.unlink(tempPath);
          } catch {
            // ignore — file may never have been created if the write failed
          }
        },
      };
    }
    try {
      await write(localSidecar.localPath);
      const stream = storageRepository.createPlainReadStream(localSidecar.localPath);
      await backend.put(sidecarPath, stream, { contentType: 'application/xml' });
    } finally {
      await localSidecar.cleanup();
    }
  }

  /** The configured write backend when it is not the disk: a locally written file then has to be uploaded to it. */
  private async getRemoteWriteBackend(): Promise<StorageBackend | undefined> {
    // lazy import to avoid circular dependency (StorageService extends BaseService)
    const { StorageService } = await import('../../services/storage.service.js');
    const writeBackend = StorageService.getWriteBackend();
    return !writeBackend || writeBackend instanceof DiskStorageBackend ? undefined : writeBackend;
  }

  /**
   * After generating a file locally, uploads it to S3 if the write backend is S3.
   * Returns the key to store in the DB.
   */
  async persistFile(localPath: string, relativeKey: string, contentType?: string): Promise<string> {
    const writeBackend = await this.getRemoteWriteBackend();
    if (!writeBackend) {
      // Disk mode: the file was already written to the final path
      return localPath;
    }
    // S3 mode: upload the locally-generated file
    const stream = this.deps.storageRepository.createPlainReadStream(localPath);
    await writeBackend.put(relativeKey, stream, { contentType });
    // Clean up local temp file
    await this.deps.storageRepository.unlink(localPath).catch(() => {
      /* ignore */
    });
    return relativeKey;
  }

  /**
   * Persists every generated image file and rewrites its path to the stored location.
   * Every ffmpeg/sharp output path must go through this — forgetting it is how the
   * trim thumbnails ended up unpersisted on S3 (gh#671).
   */
  async persistImageFiles(
    asset: ThumbnailPathEntity,
    files: { path: string; type: AssetFileType; isEdited: boolean }[],
  ): Promise<void> {
    for (const file of files) {
      const relativeKey = getRelativeImagePath(asset, {
        fileType: file.type,
        format: file.path.split('.').pop() as ImageFormat,
        isEdited: file.isEdited,
      });
      file.path = await this.persistFile(file.path, relativeKey, mimeTypes.lookup(file.path));
    }
  }

  /** Uploads a locally generated profile image to an S3 write backend; returns the path to store on the user. */
  async persistProfileImage(userId: string, profileImagePath: string): Promise<string> {
    const writeBackend = await this.getRemoteWriteBackend();
    if (!writeBackend) {
      return profileImagePath;
    }

    const relativeKey = getRelativeProfileImagePath(userId, basename(profileImagePath));
    const stream = createReadStream(profileImagePath);
    await writeBackend.put(relativeKey, stream, { contentType: mimeTypes.lookup(profileImagePath) });
    // After S3 upload, drop the local generated file and store the relative key.
    await this.deps.jobRepository.queue({ name: JobName.FileDelete, data: { files: [profileImagePath] } });
    return relativeKey;
  }

  /**
   * Moves a just-created upload (and its sidecar) to an S3 write backend: uploads each file, points the asset and its
   * sidecar row at the key and queues the local file's deletion. A failure here deletes what it uploaded and rethrows,
   * so the caller removes the asset row and the local files. On success `file` and `sidecarFile` name the keys, so a
   * later failure in the caller queues the uploaded objects (not the already-queued local files) for deletion.
   */
  async moveUploadToBackend(asset: { id: string; ownerId: string }, file: UploadFile, sidecarFile?: UploadFile) {
    const writeBackend = await this.getRemoteWriteBackend();
    if (!writeBackend) {
      return;
    }

    const { assetRepository, jobRepository } = this.deps;
    const backendFiles: string[] = [];
    try {
      const relativeKey = getRelativeNestedPath(
        StorageFolder.Upload,
        asset.ownerId,
        `${asset.id}${getFilenameExtension(file.originalPath)}`,
      );
      const stream = createReadStream(file.originalPath);
      await writeBackend.put(relativeKey, stream, {
        contentType: mimeTypes.lookup(file.originalPath),
      });
      backendFiles.push(relativeKey);
      await assetRepository.update({ id: asset.id, originalPath: relativeKey });
      // Clean up the temp local file
      await jobRepository.queue({ name: JobName.FileDelete, data: { files: [file.originalPath] } });

      if (sidecarFile) {
        const sidecarKey = getRelativeNestedPath(StorageFolder.Upload, asset.ownerId, `${asset.id}.xmp`);
        await writeBackend.put(sidecarKey, createReadStream(sidecarFile.originalPath));
        backendFiles.push(sidecarKey);
        await assetRepository.upsertFile({
          assetId: asset.id,
          path: sidecarKey,
          type: AssetFileType.Sidecar,
        });
        await jobRepository.queue({
          name: JobName.FileDelete,
          data: { files: [sidecarFile.originalPath] },
        });
      }
    } catch (error: Error | any) {
      for (const key of backendFiles) {
        try {
          await writeBackend.delete(key);
        } catch (deleteError: Error | any) {
          this.deps.logger.error(
            `Failed to delete incomplete upload file ${key} for asset ${asset.id}: ${deleteError}`,
            deleteError?.stack,
          );
        }
      }
      throw error;
    }

    file.originalPath = backendFiles[0];
    if (sidecarFile) {
      sidecarFile.originalPath = backendFiles[1];
    }
  }

  async getFaceThumbnailSource(assetId: string): Promise<string | null> {
    const preview = await this.deps.assetRepository.getForThumbnail(assetId, AssetFileType.Preview, false);
    if (preview.path) {
      return preview.path;
    }

    const thumbnail = await this.deps.assetRepository.getForThumbnail(assetId, AssetFileType.Thumbnail, false);
    return thumbnail.path ?? null;
  }

  async generateFaceThumbnailResponse(face: AssetFace, sourcePath: string): Promise<ImmichMediaResponse> {
    const { image } = await this.deps.getConfig({ withCache: true });
    const source = await this.ensureLocalFile(sourcePath);
    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-face-thumbnail-'));
    const outputPath = join(tempDir, 'thumbnail.jpeg');

    try {
      const decoded = await this.deps.mediaRepository.decodeImage(source.localPath, {
        colorspace: image.colorspace,
        processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
      });

      const thumbnailOptions: GenerateThumbnailOptions = {
        colorspace: image.colorspace,
        format: ImageFormat.Jpeg,
        quality: image.thumbnail.quality,
        progressive: false,
        processInvalidImages: false,
        size: FACE_THUMBNAIL_SIZE,
        edits: [
          {
            action: AssetEditAction.Crop,
            parameters: this.getFaceThumbnailCrop(
              {
                old: { width: face.imageWidth, height: face.imageHeight },
                new: { width: decoded.info.width, height: decoded.info.height },
              },
              {
                x1: face.boundingBoxX1,
                y1: face.boundingBoxY1,
                x2: face.boundingBoxX2,
                y2: face.boundingBoxY2,
              },
            ),
          },
        ],
      };

      await this.deps.mediaRepository.generateThumbnail(decoded, thumbnailOptions, outputPath);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    } finally {
      await source.cleanup();
    }

    const cleanup = () => {
      void rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };
    const stream = createReadStream(outputPath);
    stream.once('close', cleanup);
    stream.once('error', cleanup);

    return new ImmichStreamResponse({
      stream,
      contentType: 'image/jpeg',
      // A face crop is immutable for a given faceId (the bounding box and source preview don't change), so let
      // the browser cache it (B5). Without this the review grid re-fetched — and the server re-decoded, cropped
      // and re-encoded — every visible tile on every visit.
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  private getFaceThumbnailCrop(
    dims: { old: ImageDimensions; new: ImageDimensions },
    { x1, y1, x2, y2 }: FaceThumbnailBounds,
  ): CropParameters {
    if (
      !this.hasPositiveDimensions(dims.old) ||
      !this.hasPositiveDimensions(dims.new) ||
      [x1, y1, x2, y2].some((value) => !Number.isFinite(value)) ||
      x2 <= x1 ||
      y2 <= y1
    ) {
      return this.getCenteredFaceThumbnailCrop(dims.new);
    }

    const clampedX1 = clamp(x1, 0, dims.old.width);
    const clampedY1 = clamp(y1, 0, dims.old.height);
    const clampedX2 = clamp(x2, 0, dims.old.width);
    const clampedY2 = clamp(y2, 0, dims.old.height);

    const widthScale = dims.new.width / dims.old.width;
    const heightScale = dims.new.height / dims.old.height;

    const halfWidth = (widthScale * (clampedX2 - clampedX1)) / 2;
    const halfHeight = (heightScale * (clampedY2 - clampedY1)) / 2;

    const middleX = Math.round(widthScale * clampedX1 + halfWidth);
    const middleY = Math.round(heightScale * clampedY1 + halfHeight);
    const targetHalfSize = Math.floor(Math.max(halfWidth, halfHeight) * 1.1);
    const newHalfSize = Math.min(
      middleX - Math.max(0, middleX - targetHalfSize),
      middleY - Math.max(0, middleY - targetHalfSize),
      Math.min(dims.new.width - 1, middleX + targetHalfSize) - middleX,
      Math.min(dims.new.height - 1, middleY + targetHalfSize) - middleY,
    );

    const crop = {
      x: middleX - newHalfSize,
      y: middleY - newHalfSize,
      width: newHalfSize * 2,
      height: newHalfSize * 2,
    };

    return this.hasValidCrop(crop) ? crop : this.getCenteredFaceThumbnailCrop(dims.new);
  }

  private hasPositiveDimensions(dimensions: ImageDimensions) {
    return (
      Number.isFinite(dimensions.width) &&
      dimensions.width > 0 &&
      Number.isFinite(dimensions.height) &&
      dimensions.height > 0
    );
  }

  private hasValidCrop(crop: CropParameters) {
    return (
      Number.isFinite(crop.x) &&
      crop.x >= 0 &&
      Number.isFinite(crop.y) &&
      crop.y >= 0 &&
      Number.isFinite(crop.width) &&
      crop.width > 0 &&
      Number.isFinite(crop.height) &&
      crop.height > 0
    );
  }

  private getCenteredFaceThumbnailCrop(dimensions: ImageDimensions): CropParameters {
    const width = this.toPositiveInteger(dimensions.width, FACE_THUMBNAIL_SIZE);
    const height = this.toPositiveInteger(dimensions.height, FACE_THUMBNAIL_SIZE);
    const size = Math.min(width, height);

    return {
      x: Math.floor((width - size) / 2),
      y: Math.floor((height - size) / 2),
      width: size,
      height: size,
    };
  }

  private toPositiveInteger(value: number, fallback: number) {
    const rounded = Math.floor(value);
    return Number.isFinite(rounded) && rounded > 0 ? rounded : fallback;
  }
}
