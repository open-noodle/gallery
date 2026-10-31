import type { SpatialSceneConfig } from 'src/gallery/dtos/config.dto.js';
import type { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { StorageFolder } from 'src/enum.js';

// Spatial Scene (specs/2026-10-29-spatial-scene-design.md).

export const isSpatialSceneEnabled = (machineLearning: { enabled: boolean; spatialScene: { enabled: boolean } }) =>
  machineLearning.enabled && machineLearning.spatialScene.enabled;

// Spread into ServerService.getFeatures. The mobile app asks for an asset's spatialScene flag only when this is set.
export const spatialSceneServerFeatures = (machineLearning: Parameters<typeof isSpatialSceneEnabled>[0]) => ({
  spatialScene: isSpatialSceneEnabled(machineLearning),
});

/**
 * Where a photo's depth map lives on the given backend: an absolute path on disk, a relative key on S3, which is the
 * form MediaService.persistFile stores for thumbnails. Deterministic, so the AssetDelete handler can find the file
 * after the cascade has already removed its row.
 */
export const depthMapPath = (asset: { id: string; ownerId: string }, backend: StorageBackend) => {
  const fileName = `${asset.id}_depth.png`;
  return backend instanceof DiskStorageBackend
    ? StorageCore.getNestedPath(StorageFolder.Thumbnails, asset.ownerId, fileName)
    : StorageCore.getRelativeNestedPath(StorageFolder.Thumbnails, asset.ownerId, fileName);
};

export type DepthMetrics = {
  boundarySharpness: number;
  edgeDensity: number;
  foregroundRatio: number;
};

export type FaceBox = {
  boundingBoxY1: number;
  boundingBoxY2: number;
  imageHeight: number;
  deletedAt: Date | string | null;
  isVisible: boolean;
};

/**
 * Whether a photo with a depth map gets the Spatial button. Decided when the photo is opened, so a threshold change or
 * a face found later applies without reprocessing. Suitable means sharp depth edges around a subject (or many sharp
 * edges), or a person or pet face of a reasonable size: depth edges alone miss groups and people in rooms, where the
 * foreground split lands on the floor, and close portraits, which the foreground band rejects.
 */
export const isSpatialSceneOffered = (metrics: DepthMetrics, config: SpatialSceneConfig, faces: FaceBox[]) => {
  if (config.offer === 'all') {
    return true;
  }

  const sharp =
    metrics.boundarySharpness >= config.minBoundarySharpness || metrics.edgeDensity >= config.minEdgeDensity;
  const inBand =
    metrics.foregroundRatio >= config.minForegroundRatio && metrics.foregroundRatio <= config.maxForegroundRatio;
  if (sharp && inBand) {
    return true;
  }

  return (
    config.minFaceHeight > 0 &&
    faces.some(
      (face) =>
        !face.deletedAt &&
        face.isVisible &&
        face.imageHeight > 0 &&
        (face.boundingBoxY2 - face.boundingBoxY1) / face.imageHeight >= config.minFaceHeight,
    )
  );
};
