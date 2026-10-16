import { Injectable } from '@nestjs/common';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { GalleryDuplicateRepository } from 'src/gallery/repositories/gallery-duplicate.repository.js';
import { GalleryMachineLearningRepository } from 'src/gallery/repositories/gallery-machine-learning.repository.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
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
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { UserGroupRepository } from 'src/repositories/user-group.repository.js';

// Positional against the GalleryRepositories constructor, like upstream's BASE_SERVICE_DEPENDENCIES; the medium
// test factory resolves each entry.
export const GALLERY_REPOSITORY_DEPENDENCIES = [
  AssetFavoriteRepository,
  ClassificationRepository,
  FaceIdentityRepository,
  FaceRepairRepository,
  FaceRepairScanRepository,
  FaceRepairDeclineRepository,
  FacePersonVerdictRepository,
  SharedSpaceRepository,
  StorageMigrationRepository,
  UserGroupRepository,
  FilterSuggestionRepository,
  MemoryRuleAssetRepository,
  QueueMaintenanceRepository,
  SmartFacetRepository,
  SpaceAlbumRepository,
  PetFaceRepository,
  FaceSearchRepository,
  GallerySyncRepository,
  VideoTrimRepository,
  StorageUsageRepository,
  GalleryDuplicateRepository,
  GalleryAssetRepository,
  GalleryPersonRepository,
  MachineLearningRepository,
] as const;

// Every fork repository a service needs, injected into upstream's BaseService as one constructor parameter.
// GalleryBaseService copies each onto the service, so services keep reading `this.sharedSpaceRepository` etc.
@Injectable()
export class GalleryRepositories {
  constructor(
    public assetFavoriteRepository: AssetFavoriteRepository,
    public classificationRepository: ClassificationRepository,
    public faceIdentityRepository: FaceIdentityRepository,
    public faceRepairRepository: FaceRepairRepository,
    public faceRepairScanRepository: FaceRepairScanRepository,
    public faceRepairDeclineRepository: FaceRepairDeclineRepository,
    public facePersonVerdictRepository: FacePersonVerdictRepository,
    public sharedSpaceRepository: SharedSpaceRepository,
    public storageMigrationRepository: StorageMigrationRepository,
    public userGroupRepository: UserGroupRepository,
    public filterSuggestionRepository: FilterSuggestionRepository,
    public memoryRuleAssetRepository: MemoryRuleAssetRepository,
    public queueMaintenanceRepository: QueueMaintenanceRepository,
    public smartFacetRepository: SmartFacetRepository,
    public spaceAlbumRepository: SpaceAlbumRepository,
    public petFaceRepository: PetFaceRepository,
    public faceSearchRepository: FaceSearchRepository,
    public gallerySyncRepository: GallerySyncRepository,
    public videoTrimRepository: VideoTrimRepository,
    public storageUsageRepository: StorageUsageRepository,
    public galleryDuplicateRepository: GalleryDuplicateRepository,
    public galleryAssetRepository: GalleryAssetRepository,
    public galleryPersonRepository: GalleryPersonRepository,
    public galleryMachineLearningRepository: GalleryMachineLearningRepository,
  ) {}
}
