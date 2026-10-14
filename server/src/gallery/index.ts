import { ClassificationController } from 'src/controllers/classification.controller.js';
import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller.js';
import { FaceSuggestionController } from 'src/controllers/face-suggestion.controller.js';
import { GalleryMapController } from 'src/controllers/gallery-map.controller.js';
import { LibraryManifestController } from 'src/controllers/library-manifest.controller.js';
import { SharedSpaceController } from 'src/controllers/shared-space.controller.js';
import { StorageMigrationController } from 'src/controllers/storage-migration.controller.js';
import { UserGroupController } from 'src/controllers/user-group.controller.js';
import { AssetVisibilityTransitionService } from 'src/gallery/asset-visibility-transition.service.js';
import { FaceIdentityMaintenanceService } from 'src/gallery/face-identity-maintenance.service.js';
import { FaceSearchRepository } from 'src/gallery/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/filter-suggestion.repository.js';
import { GalleryPeopleController } from 'src/gallery/gallery-people.controller.js';
import { GalleryPeopleService } from 'src/gallery/gallery-people.service.js';
import { MemoryRuleAssetRepository } from 'src/gallery/memory-rule-asset.repository.js';
import { PetFaceRepository } from 'src/gallery/pet-face.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/queue-maintenance.repository.js';
import { SmartFacetRepository } from 'src/gallery/smart-facet.repository.js';
import { SpaceAlbumRepository } from 'src/gallery/space-album.repository.js';
import { StorageUsageService } from 'src/gallery/storage-usage.service.js';
import { AppMetricsRepository } from 'src/repositories/app-metrics.repository.js';
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
  GalleryMapController,
  GalleryPeopleController,
  LibraryManifestController,
  SharedSpaceController,
  StorageMigrationController,
  UserGroupController,
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
];

export const galleryServices = [
  AppMetricsService,
  AssetVisibilityTransitionService,
  ClassificationService,
  FaceIdentityMaintenanceService,
  FaceRepairService,
  FaceSuggestionService,
  GalleryPeopleService,
  LibraryManifestService,
  PetDetectionService,
  PetRecognitionService,
  SharedSpaceService,
  StorageMigrationService,
  StorageUsageService,
  UserGroupService,
];
