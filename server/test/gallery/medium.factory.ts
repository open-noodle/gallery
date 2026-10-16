import { Kysely } from 'kysely';
import type { ClassConstructor } from 'src/types.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { GalleryDuplicateRepository } from 'src/gallery/repositories/gallery-duplicate.repository.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
import { GALLERY_REPOSITORY_DEPENDENCIES, GalleryRepositories } from 'src/gallery/repositories/index.js';
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
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { BASE_SERVICE_DEPENDENCIES } from 'src/services/base.service.js';
import { automock } from 'test/utils.js';

// The fork half of test/medium.factory.ts: specs list fork repositories in `mock`/`real` like upstream ones, and
// the GalleryRepositories slot of BaseService's constructor is built from whatever they resolved to.

export type Dep = (typeof BASE_SERVICE_DEPENDENCIES)[number] | (typeof GALLERY_REPOSITORY_DEPENDENCIES)[number];

// `instances[i]` belongs to `deps[i]`; a repository listed in both dependency lists resolves to one instance.
export const withGalleryRepositories = (deps: Dep[], instances: unknown[]) => {
  const byDep = new Map<Dep, unknown>(deps.map((dep) => [dep, instances[deps.indexOf(dep)]]));
  const galleryRepositories = GALLERY_REPOSITORY_DEPENDENCIES.map((dep) => byDep.get(dep));
  byDep.set(
    GalleryRepositories,
    new GalleryRepositories(...(galleryRepositories as ConstructorParameters<typeof GalleryRepositories>)),
  );
  return byDep;
};

export const newGalleryRealRepository = <T extends ClassConstructor<any>>(key: T, db: Kysely<DB>): InstanceType<T> => {
  switch (key) {
    case AssetFavoriteRepository:
    case FaceIdentityRepository:
    case FaceRepairDeclineRepository:
    case FilterSuggestionRepository:
    case MemoryRuleAssetRepository:
    case SmartFacetRepository:
    case SpaceAlbumRepository:
    case PetFaceRepository:
    case FaceSearchRepository:
    case FaceRepairRepository:
    case FaceRepairScanRepository:
    case FacePersonVerdictRepository:
    case SharedSpaceRepository:
    case GallerySyncRepository:
    case StorageUsageRepository:
    case GalleryDuplicateRepository:
    case GalleryAssetRepository:
    case GalleryPersonRepository: {
      return new key(db) as InstanceType<T>;
    }

    case ClassificationRepository:
    case VideoTrimRepository: {
      return new key(db, LoggingRepository.create()) as InstanceType<T>;
    }

    default: {
      throw new Error(`Unable to create repository instance for key: ${key?.name || key}`);
    }
  }
};

export const newGalleryMockRepository = <T>(key: ClassConstructor<T>) => {
  switch (key) {
    case ClassificationRepository:
    case FaceIdentityRepository:
    case FacePersonVerdictRepository:
    case FilterSuggestionRepository:
    case MemoryRuleAssetRepository:
    case SmartFacetRepository:
    case SpaceAlbumRepository:
    case PetFaceRepository:
    case FaceSearchRepository:
    case GallerySyncRepository:
    case VideoTrimRepository:
    case StorageUsageRepository:
    case GalleryDuplicateRepository:
    case GalleryAssetRepository:
    case GalleryPersonRepository: {
      return automock(key);
    }

    case QueueMaintenanceRepository: {
      return automock(QueueMaintenanceRepository, { args: [undefined, { setContext: () => {} }] });
    }

    default: {
      throw new Error(`Invalid repository key: ${key}`);
    }
  }
};
