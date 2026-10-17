import { BadRequestException } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { TimeBucketDto } from 'src/dtos/time-bucket.dto.js';
import type { GalleryBaseService } from 'src/gallery/services/gallery-base.service.js';
import type { AccessRepository } from 'src/repositories/access.repository.js';
import type { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { AssetVisibility, Permission, TimeBucketSize } from 'src/enum.js';
import { requireAccess } from 'src/utils/access.js';
import { getAlbumSpaceIds } from 'src/utils/album-space-ids.js';
import { rejectSharedLinkFavoriteFilter } from 'src/utils/favorite.js';
import { normalizeTimeBucketForBucketSize } from 'src/utils/timeline-bucket.js';

// Fork hooks in TimelineService: one call in timeBucketChecks (after upstream's access checks, before its withPartners
// check), one in buildTimeBucketOptions' return.

type GalleryTimeBucketDto = Partial<TimeBucketDto> & Pick<TimeBucketOptions, 'assetType'> & { timeBucket?: string };

/**
 * The fork's checks, run after upstream's access checks. Mutates `dto` like upstream's checks do: folds the deprecated single-value
 * filters into their arrays (after upstream's `tagId` check has read `tagId`) and normalizes `timeBucket` to the
 * bucket size, so buildTimeBucketOptions and the bucket query see the folded request.
 */
export const galleryTimeBucketChecks = async (access: AccessRepository, auth: AuthDto, dto: GalleryTimeBucketDto) => {
  // Fork RBAC (Fix A) defense-in-depth: a pure space browse (spaceId / spacePersonId, no
  // per-user timeline) must never request Hidden/Locked — those are owner-private states that
  // make no sense across a shared scope. The repository query gates other members' Hidden/Locked
  // regardless, but rejecting here short-circuits the leak vector before it reaches the bucket query. The
  // per-user timeline paths (userId / withSharedSpaces) are intentionally untouched so a caller
  // can still view their OWN hidden assets.
  const spaceBrowse = !!dto.spaceId || !!dto.spacePersonId || !!dto.albumId;
  const requestsPrivateVisibility =
    dto.visibility === AssetVisibility.Hidden || dto.visibility === AssetVisibility.Locked;
  if (spaceBrowse && requestsPrivateVisibility) {
    throw new BadRequestException('Hidden and locked assets are not available when browsing a shared space or album');
  }

  // Fork RBAC (Slice 1 / H1): trash is an owner-private state; an album/space browse must
  // never enumerate trashed assets. Closes the timeline vector before it reaches the repo
  // (belt-and-suspenders data-layer gate also lives in the album arm of
  // withTimeBucketAssetFilters in gallery/utils/time-bucket-filter.ts, applied by getTimeBucket).
  if (spaceBrowse && dto.isTrashed === true) {
    throw new BadRequestException('Trashed assets are not available when browsing a shared space or album');
  }

  // Each scope that is REQUESTED is checked — never `else if`. Both predicates go into the query
  // when both are present (an AND), so gating on only the first one let a caller with access to
  // album A learn which of A's assets belong to a space S they are not a member of: a membership
  // oracle (no asset leaks — every returned asset is in an album they may read — but the space
  // boundary was still answering questions for them). The filtered map endpoint refuses the
  // combination outright (shared-space.service.ts getFilteredMapMarkers); the timeline answers it,
  // so it must enforce the boundary it is querying. Upstream checks the album; under a space the
  // CALLER states the owner scope, so upstream's `userId` default is skipped for it too.
  if (dto.spaceId) {
    await requireAccess(access, { auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
  }

  rejectSharedLinkFavoriteFilter(auth, dto.isFavorite);

  if (dto.withSharedSpaces) {
    const requestedArchived = dto.visibility === AssetVisibility.Archive || dto.visibility === undefined;
    const requestedTrash = dto.isTrashed === true;

    if (requestedArchived || requestedTrash) {
      throw new BadRequestException('withSharedSpaces is only supported for non-archived, non-trashed assets');
    }
  }

  // Normalize deprecated single-value fields to arrays
  if (dto.personId && !dto.personIds?.length) {
    dto.personIds = [dto.personId];
  }
  if (dto.spacePersonId && !dto.spacePersonIds?.length) {
    dto.spacePersonIds = [dto.spacePersonId];
  }
  if (dto.tagId && !dto.tagIds?.length) {
    dto.tagIds = [dto.tagId];
  }
  // Map type to assetType
  if (dto.type) {
    dto.assetType = dto.type;
  }
  // Removing personId also makes upstream's partner lookup always ask for timeline-enabled partners.
  delete dto.personId;
  delete dto.spacePersonId;
  delete dto.tagId;
  delete dto.type;

  if (dto.timeBucket !== undefined) {
    dto.timeBucket = normalizeTimeBucketForBucketSize(dto.timeBucket, dto.bucketSize ?? TimeBucketSize.Month);
  }
};

/** The fork's time-bucket options, spread after upstream's `{ ...options, userIds }`. */
export const galleryTimeBucketOptions = async (
  service: Pick<GalleryBaseService, 'resolveViewerScope'>,
  sharedSpaceRepository: SharedSpaceRepository,
  auth: AuthDto,
  dto: Partial<TimeBucketDto>,
) => {
  // #752 P0-2: album browse — resolve the viewer's live member-spaces linking this album so the
  // repository unions member-gated contributions. Shared with the album archive (#1048) so the
  // grid and "download all" can never disagree about what the album contains.
  const albumSpaceIds = dto.albumId
    ? await getAlbumSpaceIds({ auth, albumId: dto.albumId, repository: sharedSpaceRepository })
    : undefined;

  return {
    ...(await service.resolveViewerScope(auth, 'timeline', { ...dto })),
    bucketSize: dto.bucketSize ?? TimeBucketSize.Month,
    albumSpaceIds,
    // #1041: the REQUESTING user's own id, distinct from `userIds` (which also carries partner ids).
    // See TimeBucketOptions.callerId — the hidden-scope subtraction attaches ONLY here.
    callerId: dto.userId ? auth.user.id : undefined,
    // #763: the caller, threaded separately from `userIds` (the timeline *target*, which is not
    // necessarily the caller on space/album browse paths) so the isFavorite overlay predicate in
    // withTimeBucketAssetFilters resolves against the right user. Distinct from `callerId` above:
    // that one is set only on the own-timeline path and drives #1041's hidden-scope subtraction,
    // while this is always the authenticated user because the overlay is always per-caller.
    authUserId: auth.user.id,
  };
};
