import { ClassificationController } from 'src/controllers/classification.controller.js';
import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller.js';
import { FaceSuggestionController } from 'src/controllers/face-suggestion.controller.js';
import { GalleryMapController } from 'src/controllers/gallery-map.controller.js';
import { LibraryManifestController } from 'src/controllers/library-manifest.controller.js';
import { SharedSpaceController } from 'src/controllers/shared-space.controller.js';
import { StorageMigrationController } from 'src/controllers/storage-migration.controller.js';
import { UserGroupController } from 'src/controllers/user-group.controller.js';
import { GalleryAlbumController } from 'src/gallery/controllers/gallery-album.controller.js';
import { GalleryAssetController } from 'src/gallery/controllers/gallery-asset.controller.js';
import { GalleryClusterGroupController } from 'src/gallery/controllers/gallery-cluster-group.controller.js';
import { GalleryPeopleController } from 'src/gallery/controllers/gallery-people.controller.js';
import { GallerySearchController } from 'src/gallery/controllers/gallery-search.controller.js';
import { GalleryServerController } from 'src/gallery/controllers/gallery-server.controller.js';
import { GalleryTimelineController } from 'src/gallery/controllers/gallery-timeline.controller.js';
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
import { AssetVisibilityTransitionService } from 'src/gallery/services/asset-visibility-transition.service.js';
import { FaceIdentityMaintenanceService } from 'src/gallery/services/face-identity-maintenance.service.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { RuleMemoryService } from 'src/gallery/services/rule-memory.service.js';
import { StorageUsageService } from 'src/gallery/services/storage-usage.service.js';
import { VideoTrimService } from 'src/gallery/services/video-trim.service.js';
import { AppMetricsRepository } from 'src/repositories/app-metrics.repository.js';
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
import { AppMetricsService } from 'src/services/app-metrics.service.js';
import { ClassificationService } from 'src/services/classification.service.js';
import { FaceRepairService } from 'src/services/face-repair.service.js';
import { FaceSuggestionService } from 'src/services/face-suggestion.service.js';
import { LibraryManifestService } from 'src/services/library-manifest.service.js';
import { PetDetectionService } from 'src/services/pet-detection.service.js';
import { PetRecognitionService } from 'src/services/pet-recognition.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { StorageMigrationService } from 'src/services/storage-migration.service.js';
import { UserGroupService } from 'src/services/user-group.service.js';

// Register every fork controller, repository and service here, never in the upstream arrays this is spread into
// (src/{controllers,repositories,services}/index.ts). Controllers are spread first so a fork route with a literal
// segment wins over an upstream `:id` route on the same prefix. Services are spread first so fork event handlers
// keep running before same-priority upstream ones, e.g. before SystemConfigService's ConfigUpdate clears the cache.
export const galleryControllers = [
  ClassificationController,
  FaceRepairAdminController,
  FaceSuggestionController,
  GalleryAssetController,
  GalleryClusterGroupController,
  GalleryMapController,
  GalleryPeopleController,
  LibraryManifestController,
  SharedSpaceController,
  StorageMigrationController,
  UserGroupController,
  GalleryAlbumController,
  GallerySearchController,
  GalleryServerController,
  GalleryTimelineController,
];

export const galleryRepositories = [
  AppMetricsRepository,
  AssetFavoriteRepository,
  ClassificationRepository,
  FaceIdentityRepository,
  FacePersonVerdictRepository,
  FaceRepairDeclineRepository,
  FaceRepairRepository,
  FaceRepairScanRepository,
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
  GalleryRepositories,
  GalleryMachineLearningRepository,
];

export const galleryServices = [
  AppMetricsService,
  AssetVisibilityTransitionService,
  ClassificationService,
  FaceIdentityMaintenanceService,
  FaceRepairService,
  FaceSuggestionService,
  GalleryAssetService,
  GalleryPeopleService,
  LibraryManifestService,
  PetDetectionService,
  PetRecognitionService,
  SharedSpaceService,
  StorageMigrationService,
  StorageUsageService,
  UserGroupService,
  RuleMemoryService,
  VideoTrimService,
];

// Providers that are not plain classes, so they cannot sit in the lists above (telemetry, sync-sql, the queue and the
// event setup iterate those as classes). app.module registers them after `repositories`; Nest keeps the last
// registration of a token, so the MachineLearningRepository token resolves to the one GalleryMachineLearningRepository
// instance: one setup() from SystemConfigService, one health-check loop.
export const galleryProviders = [{ provide: MachineLearningRepository, useExisting: GalleryMachineLearningRepository }];
