import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';
import type { DataSaverVideoConfig } from 'src/gallery/dtos/data-saver-video.dto.js';
import { getRelativeNestedPath } from 'src/gallery/utils/storage-keys.js';
import type { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import type { VideoFormat, VideoStreamInfo } from 'src/types.js';

// Data Saver video (specs/2026-11-01-data-saver-video-design.md).

/** What a copy was made with, stored on its row so a settings change finds the stale ones. */
export const dataSaverSettings = ({ targetVideoCodec, targetResolution, maxBitrate }: DataSaverVideoConfig) =>
  `${targetVideoCodec}:${targetResolution}:${maxBitrate.toLowerCase()}`;

/** `1500k` → 1_500_000, `2m` → 2_000_000, a bare number is bits per second; anything unparsable is 0. */
export const parseBitrate = (bitrate: string) => {
  const value = Number.parseInt(bitrate);
  if (Number.isNaN(value)) {
    return 0;
  }
  const unit = bitrate.trim().slice(-1).toLowerCase();
  if (unit === 'k') {
    return value * 1000;
  }
  if (unit === 'm') {
    return value * 1_000_000;
  }
  return value;
};

// A video within the target size and a quarter over the cap plays fine on mobile data as it is: encoding it again
// would spend the CPU and the disk for a copy no smaller than the file the route falls back to.
const BITRATE_HEADROOM = 1.25;

/**
Whether a video needs a copy. The original's stream is the yardstick even for a trimmed video, since a trim is a
stream copy of the original and keeps its resolution and bitrate. An unknown bitrate counts as too high.
*/
export const isDataSaverCopyNeeded = (
  config: DataSaverVideoConfig,
  videoStream: Pick<VideoStreamInfo, 'width' | 'height' | 'bitrate'>,
  format?: Pick<VideoFormat, 'bitrate'>,
) => {
  const shortSide = Math.min(videoStream.width, videoStream.height);
  if (shortSide > Number.parseInt(config.targetResolution)) {
    return true;
  }
  const bitrate = videoStream.bitrate || format?.bitrate || 0;
  return bitrate === 0 || bitrate > parseBitrate(config.maxBitrate) * BITRATE_HEADROOM;
};

/**
Where a video's copy lives on the given backend: an absolute path on disk, a relative key on S3, the form
MediaService.persistFile stores for encoded videos. Deterministic, so the AssetDelete handler can find the file after
the cascade has already removed its row.
*/
export const dataSaverVideoPath = (asset: { id: string; ownerId: string }, backend: StorageBackend) =>
  backend instanceof DiskStorageBackend
    ? dataSaverVideoDiskPath(asset)
    : getRelativeNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${asset.id}_ds.mp4`);

/** Where ffmpeg writes the copy: its final path on disk, a staging file on S3 that is uploaded and removed. */
export const dataSaverVideoDiskPath = (asset: { id: string; ownerId: string }) =>
  StorageCore.getNestedPath(StorageFolder.EncodedVideo, asset.ownerId, `${asset.id}_ds.mp4`);
