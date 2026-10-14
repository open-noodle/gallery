import { HttpException, HttpStatus } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateThumbnailOptions, ImageDimensions } from 'src/types.js';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { FACE_THUMBNAIL_SIZE } from 'src/constants.js';
import { AssetFace } from 'src/database.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetEditAction, type CropParameters } from 'src/dtos/editing.dto.js';
import { AssetFileType, CacheControl, ImageFormat } from 'src/enum.js';
import { RangeNotSatisfiableError, ServeStrategy, StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import {
  ContentDisposition,
  ImmichFileResponse,
  ImmichMediaResponse,
  ImmichRedirectResponse,
  ImmichStreamResponse,
  getResponseSignal,
} from 'src/utils/file.js';
import { clamp } from 'src/utils/misc.js';

type FaceThumbnailBounds = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type BackendMediaServerDependencies = {
  assetRepository: AssetRepository;
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
