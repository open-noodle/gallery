import { Mocked } from 'vitest';
import type { RepositoryInterface } from 'src/types.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { GalleryDuplicateRepository } from 'src/gallery/repositories/gallery-duplicate.repository.js';
import { GalleryMachineLearningRepository } from 'src/gallery/repositories/gallery-machine-learning.repository.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
import { GalleryRepositories } from 'src/gallery/repositories/index.js';
import { MemoryRuleAssetRepository } from 'src/gallery/repositories/memory-rule-asset.repository.js';
import { PetFaceRepository } from 'src/gallery/repositories/pet-face.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import { SpaceAlbumRepository } from 'src/gallery/repositories/space-album.repository.js';
import { StorageUsageRepository } from 'src/gallery/repositories/storage-usage.repository.js';
import { VideoTrimRepository } from 'src/gallery/repositories/video-trim.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { ClassificationRepository } from 'src/repositories/classification.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository.js';
import { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository.js';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { UserGroupRepository } from 'src/repositories/user-group.repository.js';
import { automock } from 'test/utils.js';

// The fork half of test/utils.ts: mocks for every repository in GalleryRepositories, and the aggregate
// newTestService passes as BaseService's last constructor argument, built from those same mocks.

type As<T> = T extends RepositoryInterface<infer U> ? U : never;

export type GalleryServiceOverrides = {
  assetFavorite: AssetFavoriteRepository;
  classification: ClassificationRepository;
  faceIdentity: FaceIdentityRepository;
  faceRepair: FaceRepairRepository;
  faceRepairScan: FaceRepairScanRepository;
  faceRepairDecline: FaceRepairDeclineRepository;
  facePersonVerdict: FacePersonVerdictRepository;
  sharedSpace: SharedSpaceRepository;
  storageMigration: StorageMigrationRepository;
  userGroup: UserGroupRepository;
  filterSuggestion: FilterSuggestionRepository;
  memoryRuleAsset: MemoryRuleAssetRepository;
  queueMaintenance: QueueMaintenanceRepository;
  smartFacet: SmartFacetRepository;
  spaceAlbum: SpaceAlbumRepository;
  petFace: PetFaceRepository;
  faceSearch: FaceSearchRepository;
  gallerySync: GallerySyncRepository;
  videoTrim: VideoTrimRepository;
  storageUsage: StorageUsageRepository;
  galleryDuplicate: GalleryDuplicateRepository;
  galleryAsset: GalleryAssetRepository;
  galleryPerson: GalleryPersonRepository;
  // narrows upstream's `machineLearning` entry: the mock is the GalleryMachineLearningRepository instance
  machineLearning: GalleryMachineLearningRepository;
};

export const getGalleryMocks = (loggerMock: { setContext: () => void }) => {
  const mocks = {
    assetFavorite: automock(AssetFavoriteRepository),
    // eslint-disable-next-line no-sparse-arrays
    classification: automock(ClassificationRepository, { args: [, loggerMock], strict: false }),
    faceIdentity: automock(FaceIdentityRepository, { strict: false }),
    faceRepair: automock(FaceRepairRepository, { strict: false }),
    faceRepairScan: automock(FaceRepairScanRepository, { strict: false }),
    faceRepairDecline: automock(FaceRepairDeclineRepository, { strict: false }),
    facePersonVerdict: automock(FacePersonVerdictRepository, { strict: false }),
    sharedSpace: automock(SharedSpaceRepository),
    storageMigration: automock(StorageMigrationRepository),
    userGroup: automock(UserGroupRepository),
    filterSuggestion: automock(FilterSuggestionRepository, { strict: false }),
    memoryRuleAsset: automock(MemoryRuleAssetRepository, { strict: false }),
    // eslint-disable-next-line no-sparse-arrays
    queueMaintenance: automock(QueueMaintenanceRepository, { args: [, loggerMock], strict: false }),
    smartFacet: automock(SmartFacetRepository, { strict: false }),
    spaceAlbum: automock(SpaceAlbumRepository, { strict: false }),
    petFace: automock(PetFaceRepository, { strict: false }),
    faceSearch: automock(FaceSearchRepository, { strict: false }),
    gallerySync: automock(GallerySyncRepository),
    videoTrim: automock(VideoTrimRepository, { args: [undefined, loggerMock], strict: false }),
    storageUsage: automock(StorageUsageRepository, { strict: false }),
    galleryDuplicate: automock(GalleryDuplicateRepository, { strict: false }),
    galleryAsset: automock(GalleryAssetRepository, { strict: false }),
    galleryPerson: automock(GalleryPersonRepository, { strict: false }),
  };

  mocks.galleryAsset.getOwnedManifestAssets.mockResolvedValue([]);
  mocks.galleryAsset.getExternalAssetIds.mockResolvedValue(new Set<string>());

  return mocks;
};

export const newGalleryRepositories = (
  mocks: { [K in keyof GalleryServiceOverrides]: Mocked<RepositoryInterface<GalleryServiceOverrides[K]>> },
  overrides: Partial<GalleryServiceOverrides>,
) =>
  new GalleryRepositories(
    overrides.assetFavorite || (mocks.assetFavorite as As<AssetFavoriteRepository>),
    overrides.classification || (mocks.classification as As<ClassificationRepository>),
    overrides.faceIdentity || (mocks.faceIdentity as As<FaceIdentityRepository>),
    overrides.faceRepair || (mocks.faceRepair as As<FaceRepairRepository>),
    overrides.faceRepairScan || (mocks.faceRepairScan as As<FaceRepairScanRepository>),
    overrides.faceRepairDecline || (mocks.faceRepairDecline as As<FaceRepairDeclineRepository>),
    overrides.facePersonVerdict || (mocks.facePersonVerdict as As<FacePersonVerdictRepository>),
    overrides.sharedSpace || (mocks.sharedSpace as As<SharedSpaceRepository>),
    overrides.storageMigration || (mocks.storageMigration as As<StorageMigrationRepository>),
    overrides.userGroup || (mocks.userGroup as As<UserGroupRepository>),
    overrides.filterSuggestion || (mocks.filterSuggestion as As<FilterSuggestionRepository>),
    overrides.memoryRuleAsset || (mocks.memoryRuleAsset as As<MemoryRuleAssetRepository>),
    overrides.queueMaintenance || (mocks.queueMaintenance as As<QueueMaintenanceRepository>),
    overrides.smartFacet || (mocks.smartFacet as As<SmartFacetRepository>),
    overrides.spaceAlbum || (mocks.spaceAlbum as As<SpaceAlbumRepository>),
    overrides.petFace || (mocks.petFace as As<PetFaceRepository>),
    overrides.faceSearch || (mocks.faceSearch as As<FaceSearchRepository>),
    overrides.gallerySync || (mocks.gallerySync as As<GallerySyncRepository>),
    overrides.videoTrim || (mocks.videoTrim as As<VideoTrimRepository>),
    overrides.storageUsage || (mocks.storageUsage as As<StorageUsageRepository>),
    overrides.galleryDuplicate || (mocks.galleryDuplicate as As<GalleryDuplicateRepository>),
    overrides.galleryAsset || (mocks.galleryAsset as As<GalleryAssetRepository>),
    overrides.galleryPerson || (mocks.galleryPerson as As<GalleryPersonRepository>),
    overrides.machineLearning || (mocks.machineLearning as As<GalleryMachineLearningRepository>),
  );
