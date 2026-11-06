import type { GalleryRepositories } from 'src/gallery/repositories/index.js';
import type { AssetUpdateRepositories } from 'src/gallery/utils/asset-update-hooks.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { AlbumRepository } from 'src/repositories/album.repository.js';
import type { AssetRepository } from 'src/repositories/asset.repository.js';
import type { CryptoRepository } from 'src/repositories/crypto.repository.js';
import type { DatabaseRepository } from 'src/repositories/database.repository.js';
import type { JobRepository } from 'src/repositories/job.repository.js';
import type { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import type { MediaRepository } from 'src/repositories/media.repository.js';
import type { PersonRepository } from 'src/repositories/person.repository.js';
import type { StorageRepository } from 'src/repositories/storage.repository.js';
import type { UserRepository } from 'src/repositories/user.repository.js';
import { UserAdmin } from 'src/database.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { BackendMediaServer } from 'src/gallery/utils/backend-media-server.js';
import { computePhysicalUsage } from 'src/gallery/utils/storage-usage.js';
import { VideoFaceDetector } from 'src/gallery/utils/video-face-detector.js';
import { FaceAssignmentService } from 'src/services/face-assignment.service.js';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service.js';
import { ViewerScopeArgs, ViewerSurface, resolveViewerScope } from 'src/utils/viewer-scope.js';

/**
What every service inherits from the fork, through upstream's BaseService (`BaseService extends GalleryBaseService`):
the fork repositories from the one GalleryRepositories constructor parameter, the shared fork helpers, and the
fork methods services call on themselves. The upstream members it uses are declared abstract here, so an upstream
rename fails `tsc` instead of reading `undefined`.
*/
export abstract class GalleryBaseService {
  protected abstract logger: LoggingRepository;
  protected abstract accessRepository: AccessRepository;
  protected abstract albumRepository: AlbumRepository;
  protected abstract assetRepository: AssetRepository;
  protected abstract cryptoRepository: CryptoRepository;
  protected abstract databaseRepository: DatabaseRepository;
  protected abstract jobRepository: JobRepository;
  protected abstract machineLearningRepository: MachineLearningRepository;
  protected abstract mediaRepository: MediaRepository;
  protected abstract personRepository: PersonRepository;
  protected abstract storageRepository: StorageRepository;
  protected abstract userRepository: UserRepository;
  protected abstract galleryRepositories: GalleryRepositories;
  abstract getConfig(options: { withCache: boolean }): Promise<SystemConfig>;

  // Copied from `galleryRepositories` by initGallery()
  declare protected assetFavoriteRepository: GalleryRepositories['assetFavoriteRepository'];
  declare protected classificationRepository: GalleryRepositories['classificationRepository'];
  declare protected faceIdentityRepository: GalleryRepositories['faceIdentityRepository'];
  declare protected faceRepairRepository: GalleryRepositories['faceRepairRepository'];
  declare protected faceRepairScanRepository: GalleryRepositories['faceRepairScanRepository'];
  declare protected faceRepairDeclineRepository: GalleryRepositories['faceRepairDeclineRepository'];
  declare protected facePersonVerdictRepository: GalleryRepositories['facePersonVerdictRepository'];
  declare protected sharedSpaceRepository: GalleryRepositories['sharedSpaceRepository'];
  declare protected storageMigrationRepository: GalleryRepositories['storageMigrationRepository'];
  declare protected userGroupRepository: GalleryRepositories['userGroupRepository'];
  declare protected filterSuggestionRepository: GalleryRepositories['filterSuggestionRepository'];
  declare protected memoryRuleAssetRepository: GalleryRepositories['memoryRuleAssetRepository'];
  declare protected queueMaintenanceRepository: GalleryRepositories['queueMaintenanceRepository'];
  declare protected smartFacetRepository: GalleryRepositories['smartFacetRepository'];
  declare protected spaceAlbumRepository: GalleryRepositories['spaceAlbumRepository'];
  declare protected petFaceRepository: GalleryRepositories['petFaceRepository'];
  declare protected faceSearchRepository: GalleryRepositories['faceSearchRepository'];
  declare protected gallerySyncRepository: GalleryRepositories['gallerySyncRepository'];
  declare protected videoTrimRepository: GalleryRepositories['videoTrimRepository'];
  declare protected storageUsageRepository: GalleryRepositories['storageUsageRepository'];
  declare protected galleryDuplicateRepository: GalleryRepositories['galleryDuplicateRepository'];
  declare protected galleryAssetRepository: GalleryRepositories['galleryAssetRepository'];
  declare protected galleryPersonRepository: GalleryRepositories['galleryPersonRepository'];
  declare protected galleryMachineLearningRepository: GalleryRepositories['galleryMachineLearningRepository'];
  declare protected imageAdjustRepository: GalleryRepositories['imageAdjustRepository'];
  declare protected cleanupRepository: GalleryRepositories['cleanupRepository'];
  declare protected spatialSceneRepository: GalleryRepositories['spatialSceneRepository'];
  declare protected dataSaverVideoRepository: GalleryRepositories['dataSaverVideoRepository'];
  declare protected videoFaceRepository: GalleryRepositories['videoFaceRepository'];

  declare protected identityMergePropagationService: IdentityMergePropagationService;
  declare protected faceAssignmentService: FaceAssignmentService;
  declare protected backendMedia: BackendMediaServer;
  declare protected videoFaces: VideoFaceDetector;

  // Called once at the end of BaseService's constructor, when the upstream repositories are set.
  protected initGallery() {
    Object.assign(this, this.galleryRepositories);
    this.identityMergePropagationService = new IdentityMergePropagationService({
      databaseRepository: this.databaseRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      jobRepository: this.jobRepository,
      logger: this.logger,
      personRepository: this.personRepository,
      galleryPersonRepository: this.galleryPersonRepository,
      sharedSpaceRepository: this.sharedSpaceRepository,
    });
    this.faceAssignmentService = new FaceAssignmentService({
      databaseRepository: this.databaseRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      facePersonVerdictRepository: this.facePersonVerdictRepository,
      faceRepairDeclineRepository: this.faceRepairDeclineRepository,
      faceRepairRepository: this.faceRepairRepository,
      personRepository: this.personRepository,
    });
    this.backendMedia = new BackendMediaServer({
      assetRepository: this.assetRepository,
      jobRepository: this.jobRepository,
      logger: this.logger,
      mediaRepository: this.mediaRepository,
      storageRepository: this.storageRepository,
      videoFaceRepository: this.videoFaceRepository,
      getConfig: (options) => this.getConfig(options),
    });
    this.videoFaces = new VideoFaceDetector({
      assetRepository: this.assetRepository,
      cryptoRepository: this.cryptoRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      jobRepository: this.jobRepository,
      machineLearningRepository: this.machineLearningRepository,
      mediaRepository: this.mediaRepository,
      videoFaceRepository: this.videoFaceRepository,
      backendMedia: this.backendMedia,
      logger: this.logger,
      getConfig: (options) => this.getConfig(options),
    });
  }

  // For the AssetService.update/updateAll hooks in src/gallery/utils/asset-update-hooks.ts. A bag, not an instance
  // built here: that module imports services that extend BaseService, so a runtime import from here is a cycle.
  protected get assetUpdateRepositories(): AssetUpdateRepositories {
    return {
      accessRepository: this.accessRepository,
      albumRepository: this.albumRepository,
      assetFavoriteRepository: this.assetFavoriteRepository,
      assetRepository: this.assetRepository,
      galleryDuplicateRepository: this.galleryDuplicateRepository,
      logger: this.logger,
      sharedSpaceRepository: this.sharedSpaceRepository,
    };
  }

  /**
   * Fork files the thumbnail folder holds beside upstream's asset files, for IntegrityService's untracked-files scan:
   * Spatial Scene depth maps and the best frames of video faces.
   */
  protected async getGalleryThumbnailFolderPaths(paths: string[]): Promise<{ path: string }[]> {
    const [depthMaps, videoFaceFrames] = await Promise.all([
      this.spatialSceneRepository.getPathsByPaths(paths),
      this.videoFaceRepository.getPathsByPaths(paths),
    ]);
    return [...depthMaps, ...videoFaceFrames];
  }

  /** Fork: what this viewer may see on a surface — see src/utils/viewer-scope.ts. */
  resolveViewerScope<S extends ViewerSurface>(...args: ViewerScopeArgs<S>) {
    const { sharedSpaceRepository, faceIdentityRepository } = this;
    return resolveViewerScope({ sharedSpaceRepository, faceIdentityRepository }, ...args);
  }

  // Gallery-fork: upstream calls userRepository.syncUsage() directly from its two call sites
  // (user.service.ts handleUserSyncUsage and user-admin.service.ts). The fork routes both through
  // here so a single admin toggle can decide what quotaUsageInBytes means: upstream's originals-only
  // sum, or a physical walk that also counts thumbnails and transcodes. Either way the column holds
  // the figure the admin asked for, so display and quota enforcement need no knowledge of the
  // setting. The walk's own logic lives in src/gallery/utils/storage-usage.ts.
  protected async syncUsage(id?: string): Promise<void> {
    // The walk is expensive — hundreds of thousands of stat calls on a large install — so the
    // default path stays exactly as cheap as upstream's single statement.
    const { storageUsage } = await this.getConfig({ withCache: false });
    if (!storageUsage.includeDerivatives) {
      await this.userRepository.syncUsage(id);
      return;
    }

    // Deliberately either/or: running upstream's statement here too would immediately overwrite
    // the physical figure with the originals-only one.
    // lazy import to avoid circular dependency (StorageService extends BaseService)
    const { StorageService } = await import('../../services/storage.service.js');
    const s3 = StorageService.getS3Backend();
    const users = id
      ? [await this.userRepository.get(id, { withDeleted: false })].filter((user): user is UserAdmin => !!user)
      : await this.userRepository.getList({ withDeleted: false });

    for (const user of users) {
      const usage = await computePhysicalUsage({
        user,
        assetRepository: this.galleryAssetRepository,
        storageUsageRepository: this.storageUsageRepository,
        s3,
      });
      await this.storageUsageRepository.setUsage(user.id, usage);
    }
  }
}
