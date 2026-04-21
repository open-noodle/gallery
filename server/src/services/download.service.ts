import { BadRequestException, Injectable } from '@nestjs/common';
import { isAbsolute, parse } from 'node:path';
import { Readable } from 'node:stream';
import sanitize from 'sanitize-filename';
import { StorageCore } from 'src/cores/storage.core';
import { AuthDto } from 'src/dtos/auth.dto';
import { DownloadArchiveDto, DownloadArchiveInfo, DownloadInfoDto, DownloadResponseDto } from 'src/dtos/download.dto';
import { Permission } from 'src/enum';
import { StorageBackend } from 'src/interfaces/storage-backend.interface';
import { BaseService } from 'src/services/base.service';
import { StorageService } from 'src/services/storage.service';
import { HumanReadableSize } from 'src/utils/bytes';
import { getPreferences } from 'src/utils/preferences';

class LazyS3Readable extends Readable {
  private source?: Readable;
  private started = false;

  constructor(
    private readonly backend: StorageBackend,
    private readonly key: string,
  ) {
    super();
  }

  override _read(): void {
    if (this.source) {
      // Node.js calls _read() again when consumer drains the buffer after backpressure.
      // Resume the source so data starts flowing again.
      if (this.source.isPaused()) {
        this.source.resume();
      }
      return;
    }
    if (this.started) {
      return; // fetch already in flight — another _read() will not re-trigger it
    }
    this.started = true;

    this.backend
      .get(this.key)
      .then(({ stream }) => {
        this.source = stream;
        stream.on('data', (chunk: Buffer) => {
          if (!this.push(chunk)) {
            stream.pause(); // apply backpressure to S3 source
          }
        });
        stream.on('end', () => this.push(null));
        // emit('error') is synchronous; destroy(err) defers the error event when called
        // from within another stream's event handler (Node.js re-entrancy guard), which
        // would cause consumers to miss the error if they don't await.
        stream.on('error', (err: Error) => {
          this.destroy();
          this.emit('error', err);
        });
      })
      .catch((error: Error) => this.destroy(error)); // prevent unhandled rejection
  }

  override _destroy(err: Error | null, callback: (err?: Error | null) => void): void {
    // Calling destroy() without an error arg emits 'close' on source, not 'error',
    // which avoids triggering archiver's error listener on the piped stream.
    this.source?.destroy();
    callback(err);
  }
}

@Injectable()
export class DownloadService extends BaseService {
  async getDownloadInfo(auth: AuthDto, dto: DownloadInfoDto): Promise<DownloadResponseDto> {
    let assets;

    if (dto.assetIds) {
      const assetIds = dto.assetIds;
      await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: assetIds });
      assets = this.downloadRepository.downloadAssetIds(assetIds);
    } else if (dto.albumId) {
      const albumId = dto.albumId;
      await this.requireAccess({ auth, permission: Permission.AlbumDownload, ids: [albumId] });
      assets = this.downloadRepository.downloadAlbumId(albumId);
    } else if (dto.userId) {
      const userId = dto.userId;
      await this.requireAccess({ auth, permission: Permission.TimelineDownload, ids: [userId] });
      assets = this.downloadRepository.downloadUserId(userId);
    } else if (dto.spaceId) {
      const spaceId = dto.spaceId;
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [spaceId] });
      assets = this.downloadRepository.downloadSpaceId(spaceId);
    } else {
      throw new BadRequestException('assetIds, albumId, userId, or spaceId is required');
    }

    const targetSize = dto.archiveSize || HumanReadableSize.GiB * 4;
    const metadata = await this.userRepository.getMetadata(auth.user.id);
    const preferences = getPreferences(metadata);
    const motionIds = new Set<string>();
    const archives: DownloadArchiveInfo[] = [];
    let archive: DownloadArchiveInfo = { size: 0, assetIds: [] };

    const addToArchive = ({ id, size }: { id: string; size: number | null }) => {
      archive.assetIds.push(id);
      archive.size += Number(size || 0);

      if (archive.size > targetSize) {
        archives.push(archive);
        archive = { size: 0, assetIds: [] };
      }
    };

    for await (const asset of assets) {
      // motion part of live photos
      if (asset.livePhotoVideoId) {
        motionIds.add(asset.livePhotoVideoId);
      }

      addToArchive(asset);
    }

    if (motionIds.size > 0) {
      const motionAssets = this.downloadRepository.downloadMotionAssetIds([...motionIds]);
      for await (const motionAsset of motionAssets) {
        if (StorageCore.isAndroidMotionPath(motionAsset.originalPath) && !preferences.download.includeEmbeddedVideos) {
          continue;
        }

        addToArchive(motionAsset);
      }
    }

    if (archive.assetIds.length > 0) {
      archives.push(archive);
    }

    let totalSize = 0;
    for (const archive of archives) {
      totalSize += archive.size;
    }

    return { totalSize, archives };
  }

  async downloadArchive(auth: AuthDto, dto: DownloadArchiveDto): Promise<{ stream: Readable; abort: () => void }> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: dto.assetIds });

    const zip = this.storageRepository.createZipStream();
    const assets = await this.assetRepository.getForOriginals(dto.assetIds, dto.edited ?? false);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const paths: Record<string, number> = {};
    const lazies: LazyS3Readable[] = [];

    for (const assetId of dto.assetIds) {
      const asset = assetMap.get(assetId);
      if (!asset) {
        continue;
      }

      const { originalPath, editedPath, originalFileName } = asset;

      let filename = sanitize(originalFileName) || 'unnamed';
      const count = paths[filename] || 0;
      paths[filename] = count + 1;
      if (count !== 0) {
        const parsedFilename = parse(filename);
        filename = `${parsedFilename.name}+${count}${parsedFilename.ext}`;
      }

      let filePath = dto.edited && editedPath ? editedPath : originalPath;

      if (isAbsolute(filePath)) {
        // Disk asset — resolve symlinks and add by path
        try {
          filePath = await this.storageRepository.realpath(filePath);
        } catch {
          this.logger.warn('Unable to resolve realpath', { originalPath });
        }
        zip.addFile(filePath, filename);
      } else {
        // S3 asset — open socket lazily when archiver starts consuming this entry.
        // All N sockets would open concurrently if we awaited backend.get() here;
        // archiver is sequential (concurrency 1) so only 1 socket is ever needed at once.
        const backend = StorageService.resolveBackendForKey(filePath);
        const lazy = new LazyS3Readable(backend, filePath);
        lazies.push(lazy);
        zip.addFile(lazy, filename);
      }
    }

    void zip.finalize();

    const abort = (): void => {
      zip.stream.destroy();
      for (const lazy of lazies) {
        lazy.destroy();
      }
    };

    return { stream: zip.stream, abort };
  }
}
