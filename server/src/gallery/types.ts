import type { IBaseJob, IDeferrableJob, IDelayedJob, IEntityJob, INightlyJob } from 'src/types.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { JobName, SystemMetadataKey } from 'src/enum.js';

// Fork job payloads, memory data and system-metadata keys, merged into upstream's src/types.ts with one re-export,
// `GalleryJobItem |` on JobItem and `extends GallerySystemMetadata` on SystemMetadata (GallerySystemMetadata carries
// upstream's Record base). Type-only module.

export interface IAssetDetectFacesJob extends IEntityJob {
  force?: boolean;
}

export interface IFacialRecognitionJob extends IDeferrableJob {
  skipSharedSpaceMatch?: boolean;
}

export interface IPetRecognitionJob extends IDeferrableJob {
  /**
   * The species/breed label from ML pet detection. `asset_face` has no species column, so this is
   * how the label reaches the point (Part B, brand-new-person creation) that needs it — set by
   * `handlePetDetection` when it queues the job, and carried through the one deferred re-queue.
   * Optional because a future caller without a freshly-detected label (e.g. Slice 6 reprocessing
   * an existing unassigned face) may have none to offer.
   */
  label?: string;
}

export interface IFaceIdentityBackfillJob extends IBaseJob {
  stage?: 'person' | 'space-person';
  cursor?: string;
  continuationId?: string;
  /** Number of full re-scan passes this chain has already taken; capped to prevent endless loops. */
  continuationCount?: number;
}

export interface IPersonSuggestionScanJob extends IBaseJob {
  id: string;
}

export interface ISpacePersonSuggestionScanJob extends IBaseJob {
  id: string;
}

export interface ISharedSpaceFaceMatchJob extends IBaseJob {
  spaceId: string;
  assetId: string;
  source?: 'identity-backfill';
}

export interface ISharedSpaceFaceMatchAllJob extends IBaseJob {
  spaceId: string;
}

export interface ISharedSpaceFaceMatchPageJob extends IBaseJob {
  spaceId: string;
  afterAssetId?: string;
  batchSize?: number;
}

export interface ISharedSpaceLibraryFaceSyncJob extends IBaseJob {
  spaceId: string;
  libraryId: string;
}

export interface ISharedSpaceAlbumFaceSyncJob extends IBaseJob {
  spaceId: string;
  albumId: string;
}

export interface ISharedSpaceIdentityReconciliationJob extends IBaseJob {
  spaceId: string;
  userId?: string;
  spacePersonId?: string;
}

export interface ISharedSpacePersonDedupJob extends IBaseJob {
  spaceId: string;
  /** 1-based pass number. Each dedup job runs one pass and re-queues the next with pass + 1. */
  pass?: number;
}

export interface IFaceRepairScanJob extends IBaseJob {
  scanId: string;
}

export interface ISharedSpacePersonMetadataBackfillJob extends IBaseJob {
  cursor?: string;
  identityId?: string;
  limit?: number;
}

export interface ISharedSpaceBulkAddAssetsJob extends IBaseJob {
  spaceId: string;
  userId: string;
}

export interface ISharedSpaceAlbumGrantReconcileJob extends IBaseJob {
  albumIds: string[];
}

export interface IStorageMigrationJob {
  entityType: 'asset' | 'assetFile' | 'person' | 'user';
  entityId: string;
  fileType: string | null;
  sourcePath: string;
  batchId: string;
  direction: 'toS3' | 'toDisk';
  deleteSource: boolean;
}

export interface IStorageMigrationQueueAllJob {
  direction: 'toS3' | 'toDisk';
  deleteSource: boolean;
  fileTypes: {
    originals: boolean;
    thumbnails: boolean;
    previews: boolean;
    fullsize: boolean;
    encodedVideos: boolean;
    sidecars: boolean;
    personThumbnails: boolean;
    profileImages: boolean;
  };
  concurrency: number;
  batchId: string;
}

export interface JobTypeCounts {
  name: JobName;
  active: number;
  waiting: number;
  delayed: number;
  paused: number;
}

export type GalleryJobItem =
  // Facial Recognition
  | { name: JobName.FaceIdentityBackfill; data: IFaceIdentityBackfillJob }
  | { name: JobName.FaceIdentityMaintenanceAfterRecognition; data: IDelayedJob }
  | { name: JobName.FaceSuggestionMaintenance; data: IBaseJob }
  | { name: JobName.PersonSuggestionScanQueueAll; data: IBaseJob }
  | { name: JobName.PersonSuggestionScan; data: IPersonSuggestionScanJob }
  | { name: JobName.SpacePersonSuggestionScanQueueAll; data: IBaseJob }
  | { name: JobName.SpacePersonSuggestionScan; data: ISpacePersonSuggestionScanJob }

  // Pet Detection
  | { name: JobName.PetDetectionQueueAll; data: IBaseJob }
  | { name: JobName.PetDetection; data: IEntityJob }

  // Pet Recognition
  | { name: JobName.PetRecognitionQueueAll; data: INightlyJob }
  | { name: JobName.PetRecognition; data: IPetRecognitionJob }

  // Storage Backend Migration
  | { name: JobName.StorageBackendMigrationQueueAll; data: IStorageMigrationQueueAllJob }
  | { name: JobName.StorageBackendMigrationSingle; data: IStorageMigrationJob }

  // Shared Space Face Recognition
  | { name: JobName.SharedSpaceFaceMatch; data: ISharedSpaceFaceMatchJob }
  | { name: JobName.SharedSpaceFaceMatchAll; data: ISharedSpaceFaceMatchAllJob }
  | { name: JobName.SharedSpaceFaceMatchPage; data: ISharedSpaceFaceMatchPageJob }
  | { name: JobName.SharedSpaceFaceMatchFromBackfill; data: ISharedSpaceFaceMatchJob }
  | { name: JobName.SharedSpaceLibraryFaceSync; data: ISharedSpaceLibraryFaceSyncJob }
  | { name: JobName.SharedSpaceAlbumFaceSync; data: ISharedSpaceAlbumFaceSyncJob }
  | { name: JobName.SharedSpaceIdentityReconciliation; data: ISharedSpaceIdentityReconciliationJob }
  | { name: JobName.SharedSpacePersonDedup; data: ISharedSpacePersonDedupJob }
  | { name: JobName.SharedSpacePersonMetadataBackfill; data: ISharedSpacePersonMetadataBackfillJob }

  // Shared Space Bulk Operations
  | { name: JobName.SharedSpaceBulkAddAssets; data: ISharedSpaceBulkAddAssetsJob }

  // Shared Space Album Grant Reconciliation
  | { name: JobName.SharedSpaceAlbumGrantReconcile; data: ISharedSpaceAlbumGrantReconcileJob }
  | { name: JobName.SharedSpaceAlbumGrantReconcileSweep; data?: IBaseJob }
  | { name: JobName.SharedSpaceIdentityReconciliationSweep; data?: IBaseJob }

  // Classification
  | { name: JobName.AssetClassifyQueueAll; data: IBaseJob }
  | { name: JobName.AssetClassify; data: IEntityJob }

  // Face Repair
  | { name: JobName.FaceRepairScan; data: IFaceRepairScanJob }

  // Rule memories
  | { name: JobName.MemoryRuleGenerate; data?: IBaseJob }

  // Video trim
  | { name: JobName.AssetVideoTrimGenerate; data: IEntityJob };

export type RuleMemoryData = {
  ruleId: string;
  dedupeKey: string;
  title?: string;
  subtitle?: string;
  score?: number;
  context?: Record<string, unknown>;
};

export interface GallerySystemMetadata extends Record<SystemMetadataKey, Record<string, any>> {
  [SystemMetadataKey.ClassificationConfigState]: SystemConfig['classification'];
  [SystemMetadataKey.FaceSuggestionDefaultOnState]: { sweptAt?: string };
  [SystemMetadataKey.PetRecognitionState]: { lastRun?: string; modelName?: string; pendingReprocess?: boolean };
  [SystemMetadataKey.PersonSuggestionScanJobCleanupState]: { cleanedAt?: string };
  [SystemMetadataKey.SharedSpaceFaceJobCleanupState]: { cleanedAt?: string };
}
