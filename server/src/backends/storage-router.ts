import { StorageRouting } from 'src/dtos/system-config.dto';

/**
 * The three routable groups. Eight physical file types collapse into these because no
 * deployment wants previews on S3 while thumbnails sit on disk, and three knobs give
 * eight documented combinations instead of 256.
 */
export enum StorageRoutingKind {
  Originals = 'originals',
  Thumbnails = 'thumbnails',
  EncodedVideo = 'encodedVideo',
}

/** The file-type keys the storage migrator exposes. */
export type StorageMigrationFileType =
  | 'originals'
  | 'thumbnails'
  | 'previews'
  | 'fullsize'
  | 'encodedVideos'
  | 'sidecars'
  | 'personThumbnails'
  | 'profileImages';

/**
 * Single source of truth for which knob owns which migrator file type. The router, the
 * migration validator and the routing-counts query all read this, so they cannot disagree.
 */
export const MIGRATION_FILE_TYPE_TO_KIND: Record<StorageMigrationFileType, StorageRoutingKind> = {
  originals: StorageRoutingKind.Originals,
  sidecars: StorageRoutingKind.Originals,
  thumbnails: StorageRoutingKind.Thumbnails,
  previews: StorageRoutingKind.Thumbnails,
  fullsize: StorageRoutingKind.Thumbnails,
  personThumbnails: StorageRoutingKind.Thumbnails,
  profileImages: StorageRoutingKind.Thumbnails,
  encodedVideos: StorageRoutingKind.EncodedVideo,
};

/**
 * Resolve a knob to a concrete backend. Pure: no config lookup, no backend instances, no
 * S3-availability check — callers handle the missing-backend fallback so this stays a
 * total function over the truth table.
 */
export const resolveRouting = (routing: StorageRouting, envBackend: 'disk' | 's3'): 'disk' | 's3' => {
  switch (routing) {
    case StorageRouting.Disk: {
      return 'disk';
    }
    case StorageRouting.S3: {
      return 's3';
    }
    default: {
      return envBackend;
    }
  }
};
