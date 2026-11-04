import { ForbiddenException } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { GalleryDuplicateRepository } from 'src/gallery/repositories/gallery-duplicate.repository.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { AlbumRepository } from 'src/repositories/album.repository.js';
import type { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import type { AssetRepository } from 'src/repositories/asset.repository.js';
import type { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { AssetBulkUpdateDto, UpdateAssetDto } from 'src/dtos/asset.dto.js';
import { AssetVisibility } from 'src/enum.js';
import { applyVisibilityTransitionSideEffects } from 'src/gallery/services/asset-visibility-transition.service.js';
import { updateAssetFavorites } from 'src/gallery/services/gallery-asset.service.js';
import { logCrossOwnerEdit } from 'src/gallery/utils/cross-owner-edit.js';

export type AssetUpdateRepositories = {
  accessRepository: AccessRepository;
  albumRepository: AlbumRepository;
  assetFavoriteRepository: AssetFavoriteRepository;
  assetRepository: AssetRepository;
  galleryDuplicateRepository: GalleryDuplicateRepository;
  logger: LoggingRepository;
  sharedSpaceRepository: SharedSpaceRepository;
};

// Gallery's part of AssetService.update and updateAll: one call before the asset write, one after it. The edit-access
// check and the owner gates stay inline in the upstream methods and run before either hook.

/** AssetService.update, just before the asset write. Returns the prior visibility for afterAssetUpdate. */
export const beforeAssetUpdate = async (
  repositories: AssetUpdateRepositories,
  auth: AuthDto,
  id: string,
  dto: UpdateAssetDto,
) => {
  const { accessRepository, assetFavoriteRepository, assetRepository } = repositories;
  const { isFavorite } = dto;

  // correctness-8: capture the PRIOR visibility before the write so the transition helper can tell a
  // genuine boundary crossing from a no-op re-affirm (e.g. Hidden -> Hidden).
  let priorVisibility: AssetVisibility | undefined;
  if (dto.visibility !== undefined) {
    const priorAsset = await assetRepository.getById(id);
    priorVisibility = priorAsset?.visibility;
  }

  // #763: isFavorite is the deprecated alias for PUT /assets/favorites (§8.1) — route it through
  // the SAME updateFavorites logic so the alias can never be more permissive than the canonical
  // endpoint. Written BEFORE the repository read below so the isFavoriteForUser it projects for
  // the response reflects the caller's own just-written state, not the pre-write value.
  if (isFavorite !== undefined) {
    await updateAssetFavorites(accessRepository, assetFavoriteRepository, auth, { ids: [id], isFavorite });
  }

  return new Map([[id, priorVisibility]]);
};

/** AssetService.updateAll, right after the owner gate. Returns the prior visibilities for afterAssetUpdate. */
export const beforeAssetUpdateAll = async (
  repositories: AssetUpdateRepositories,
  auth: AuthDto,
  dto: AssetBulkUpdateDto,
) => {
  const { accessRepository, assetFavoriteRepository, assetRepository, galleryDuplicateRepository } = repositories;
  const { ids, isFavorite, visibility, duplicateId } = dto;

  // A duplicateId is visible on any asset the caller can read. Joining another owner's group would block that owner's
  // resolve (their list never shows our asset) and let ours reach their keeper.
  if (duplicateId && (await galleryDuplicateRepository.hasOtherOwner(duplicateId, auth.user.id))) {
    throw new ForbiddenException('Duplicate grouping can only join a group of assets you own');
  }

  // #763: isFavorite is the deprecated alias for PUT /assets/favorites (§8.1) — it no longer goes
  // into the plain column write (assetDto). Routed through the SAME updateFavorites logic
  // as the canonical endpoint, so the alias can never be more permissive.
  if (isFavorite !== undefined) {
    await updateAssetFavorites(accessRepository, assetFavoriteRepository, auth, { ids, isFavorite });
  }

  // correctness-8: capture PRIOR visibilities before the write so the transition helper can tell a
  // genuine boundary crossing from a no-op re-affirm (e.g. Hidden -> Hidden, Timeline -> Archive).
  const priorVisibilities = new Map<string, AssetVisibility | undefined>();
  if (visibility !== undefined) {
    const priorAssets = await assetRepository.getByIds(ids);
    for (const priorAsset of priorAssets) {
      priorVisibilities.set(priorAsset.id, priorAsset.visibility);
    }
  }

  return priorVisibilities;
};

/** AssetService.update and updateAll, right after the asset write succeeded. */
export const afterAssetUpdate = async (
  repositories: AssetUpdateRepositories,
  auth: AuthDto,
  ids: string[],
  dto: UpdateAssetDto | AssetBulkUpdateDto,
  priorVisibilities: Map<string, AssetVisibility | undefined>,
) => {
  const { accessRepository, albumRepository, logger, sharedSpaceRepository } = repositories;

  // security-4: the single-asset PUT once wrote `visibility` straight through, skipping every #757 transition
  // side-effect the bulk path runs: member devices kept hidden/locked bytes forever and Locked assets stayed in
  // the owner's albums. Both paths run the same helper, so a single PUT is byte-for-byte equivalent to a one-id
  // bulk update. It also replaces upstream's removeAssetsFromAll on Locked. No-op for non-space assets (the
  // emits match nothing).
  if (dto.visibility !== undefined) {
    await applyVisibilityTransitionSideEffects(
      { albumRepository, sharedSpaceRepository },
      ids,
      dto.visibility,
      priorVisibilities,
    );
  }

  // #734: after the write succeeds — a rejected write must log nothing. Skipped entirely when
  // visibility is set: the rbac-3 owner gate already required the caller to OWN every id to get
  // here, but checkOwnerAccess filters on hasElevatedPermission — a Locked row (this write may
  // have just produced) reads back as not-owned for an API-key session, so logCrossOwnerEdit
  // would misclassify the owner's own lock as a cross-owner edit. A visibility write can never
  // legitimately be cross-owner (the gate is total for it), so skip rather than rely on
  // logCrossOwnerEdit's own owner check to get this right post-write.
  //
  // #763: a favorite-only write is the caller's private state, not an edit of the asset — logging it would
  // tell the space that someone favorited a member's photo.
  const { isFavorite: _isFavorite, ...edits } = dto;
  if (
    dto.visibility === undefined &&
    Object.entries(edits).some(([key, value]) => key !== 'ids' && value !== undefined)
  ) {
    await logCrossOwnerEdit(accessRepository, sharedSpaceRepository, logger, auth, ids);
  }
};
