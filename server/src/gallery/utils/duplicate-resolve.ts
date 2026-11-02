import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { GalleryRepositories } from 'src/gallery/repositories/index.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { JobRepository } from 'src/repositories/job.repository.js';
import type { LoggingRepository } from 'src/repositories/logging.repository.js';
import { BulkIdErrorReason, BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import { JobName, Permission } from 'src/enum.js';
import { checkAccess } from 'src/utils/access.js';

// Fork hooks in DuplicateService.resolveGroup: one call before upstream's writes, one after them.

type DuplicateResolveDependencies = {
  access: AccessRepository;
  job: JobRepository;
  logger: LoggingRepository;
  gallery: Pick<
    GalleryRepositories,
    'assetFavoriteRepository' | 'galleryAssetRepository' | 'galleryDuplicateRepository' | 'sharedSpaceRepository'
  >;
};

type DuplicateResolveGroup = {
  auth: AuthDto;
  duplicateId: string;
  groupAssetIds: Set<string>;
  idsToKeep: string[];
  idsToTrash: string[];
};

/**
 * Runs after upstream's validation and trash-permission check, before any write. Returns the failure result to return
 * when the caller does not own every keeper.
 */
export const beforeDuplicateGroupResolve = async (
  deps: DuplicateResolveDependencies,
  { auth, duplicateId, groupAssetIds, idsToKeep, idsToTrash }: DuplicateResolveGroup,
): Promise<BulkIdResponseDto | undefined> => {
  // A group can hold another owner's asset (joined through PUT /assets before it checked the group). Every write
  // lands on the keepers, and the merged data comes from them and the trashed copies checked above, so all must be
  // the caller's own. AssetDelete is the owner-only arm.
  const ownedKeepIds = await checkAccess(deps.access, { auth, permission: Permission.AssetDelete, ids: idsToKeep });
  if (ownedKeepIds.size !== new Set(idsToKeep).size) {
    return {
      id: duplicateId,
      success: false,
      error: BulkIdErrorReason.NO_PERMISSION,
      errorMessage: 'No permission to update assets',
    };
  }

  // Sync shared space membership: add the keeper(s) to any space the group's
  // assets were in, provided the auth user has Editor+ role there. Placed
  // before any other mutation so partial-failure blast radius is minimal —
  // if addAssets throws, nothing else has been written yet.
  //
  // Caveat: if addAssets succeeds but queueAll throws, the keeper is in the
  // space but no SharedSpaceFaceMatch jobs were queued. The outer try/catch
  // reports the group as failed, so the user retries — addAssets is
  // idempotent and queueAll runs again. Self-healing on retry.
  //
  // Runs for every keeper (idsToKeep.length > 0), independent of the
  // metadata-merge gate — space membership must follow the keeper
  // regardless of how many assets survive the group.
  if (idsToKeep.length > 0) {
    const { sharedSpaceRepository } = deps.gallery;
    const editableSpaceIds = await sharedSpaceRepository.getEditableByAssetIds(auth.user.id, groupAssetIds);

    if (editableSpaceIds.size > 0) {
      const spaceIds = [...editableSpaceIds];
      await sharedSpaceRepository.addAssets(
        spaceIds.flatMap((spaceId) => idsToKeep.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id }))),
      );

      // Queue face match jobs unconditionally — handleSharedSpaceFaceMatch
      // short-circuits when space.faceRecognitionEnabled is false, so a
      // wasted queue entry is cheaper than a pre-filter query.
      await deps.job.queueAll(
        spaceIds.flatMap((spaceId) =>
          idsToKeep.map((assetId) => ({
            name: JobName.SharedSpaceFaceMatch,
            data: { spaceId, assetId },
          })),
        ),
      );
    }
  }

  // Under upstream's metadata-merge gate (exactly one keeper absorbing trashed duplicates): carries other users'
  // favorites (space members, partners) of the trashed copies to the keeper; the owner's comes through upstream's
  // assetUpdate.isFavorite.
  if (idsToKeep.length === 1 && idsToTrash.length > 0) {
    await deps.gallery.assetFavoriteRepository.mergeOnto(idsToKeep[0], idsToTrash);
  }
};

/** Runs after upstream's writes: checksum tombstones so the mobile app won't re-upload trashed duplicates. */
export const afterDuplicateGroupResolve = async (
  deps: DuplicateResolveDependencies,
  { auth, duplicateId, idsToKeep, idsToTrash }: DuplicateResolveGroup,
): Promise<void> => {
  if (idsToTrash.length === 0 || idsToKeep.length === 0) {
    return;
  }

  try {
    const trashedChecksums = await deps.gallery.galleryAssetRepository.getChecksumsByIds(idsToTrash);
    const keepAssetId = idsToKeep[0];
    await deps.gallery.galleryDuplicateRepository.createChecksumTombstones(
      trashedChecksums.map(({ checksum }) => ({
        assetId: keepAssetId,
        ownerId: auth.user.id,
        checksum,
      })),
    );
  } catch (error: Error | any) {
    deps.logger.error(
      `Failed to create checksum tombstones for duplicate group ${duplicateId}: ${error}`,
      error?.stack,
    );
  }
};
