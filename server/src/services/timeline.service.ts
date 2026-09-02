import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TimeBucketAssetDto,
  TimeBucketCoverDto,
  TimeBucketCoverResponseDto,
  TimeBucketDto,
  TimeBucketsResponseDto,
} from 'src/dtos/time-bucket.dto';
import { AssetVisibility, Permission, TimeBucketSize } from 'src/enum';
import { TimeBucketOptions } from 'src/repositories/asset.repository';
import { BaseService } from 'src/services/base.service';
import { requireElevatedPermission } from 'src/utils/access';
import { getAlbumSpaceIds } from 'src/utils/album-space-ids';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { normalizeTimeBucketForBucketSize } from 'src/utils/timeline-bucket';

@Injectable()
export class TimelineService extends BaseService {
  async getTimeBuckets(auth: AuthDto, dto: Partial<TimeBucketDto>): Promise<TimeBucketsResponseDto[]> {
    await this.timeBucketChecks(auth, dto);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto);
    return await this.assetRepository.getTimeBuckets(timeBucketOptions);
  }

  async getTimeBucketCovers(auth: AuthDto, dto: TimeBucketCoverDto): Promise<TimeBucketCoverResponseDto[]> {
    await this.timeBucketChecks(auth, dto as Partial<TimeBucketDto>);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto as Partial<TimeBucketDto>);
    return this.assetRepository.getTimeBucketCovers({ ...timeBucketOptions, timeBuckets: dto.timeBuckets });
  }

  // pre-jsonified response
  async getTimeBucket(
    auth: AuthDto,
    dto: Partial<TimeBucketAssetDto> & Pick<TimeBucketAssetDto, 'timeBucket'>,
  ): Promise<string> {
    await this.timeBucketChecks(auth, dto);
    const bucketSize = dto.bucketSize ?? TimeBucketSize.Month;
    const timeBucket = normalizeTimeBucketForBucketSize(dto.timeBucket, bucketSize);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, { ...dto, bucketSize, timeBucket });

    // TODO: use id cursor for pagination
    const bucket = await this.assetRepository.getTimeBucket(timeBucket, timeBucketOptions, auth);
    return bucket.assets;
  }

  private async buildTimeBucketOptions(
    auth: AuthDto,
    dto: Partial<TimeBucketDto> & { timeBucket?: string },
  ): Promise<TimeBucketOptions & { bucketSize: TimeBucketSize }> {
    const { userId, personId, spacePersonId, tagId, type, ...options } = dto;

    // Normalize deprecated single-value fields to arrays
    if (personId && !options.personIds?.length) {
      options.personIds = [personId];
    }
    if (spacePersonId && !options.spacePersonIds?.length) {
      options.spacePersonIds = [spacePersonId];
    }
    if (tagId && !options.tagIds?.length) {
      options.tagIds = [tagId];
    }
    // Map type to assetType
    if (type) {
      (options as any).assetType = type;
    }

    let userIds: string[] | undefined;
    let timelineSpaceIds: string[] | undefined;

    if (userId) {
      userIds = [userId];
      if (dto.withPartners) {
        const partnerIds = await getMyPartnerIds({
          userId: auth.user.id,
          repository: this.partnerRepository,
          timelineEnabled: true,
        });
        userIds.push(...partnerIds);
      }

      if (dto.withSharedSpaces) {
        const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
        if (spaceRows.length > 0) {
          timelineSpaceIds = spaceRows.map((row) => row.spaceId);
        }
      }
    }

    // #752 P0-2: album browse — resolve the viewer's live member-spaces linking this album so the
    // repository unions member-gated contributions. Shared with the album archive (#1048) so the
    // grid and "download all" can never disagree about what the album contains.
    const albumSpaceIds = dto.albumId
      ? await getAlbumSpaceIds({ auth, albumId: dto.albumId, repository: this.sharedSpaceRepository })
      : undefined;

    const scopedOptions = await this.resolveScopedPersonFilters(auth, { ...options, timelineSpaceIds });

    return { ...scopedOptions, bucketSize: dto.bucketSize ?? TimeBucketSize.Month, userIds, albumSpaceIds };
  }

  private async resolveScopedPersonFilters(auth: AuthDto, options: TimeBucketOptions): Promise<TimeBucketOptions> {
    const tokens = options.personIds?.filter(Boolean) ?? [];
    const hasScopedTokens = tokens.some((token) => token.includes(':'));
    const shouldResolve = tokens.length > 0 && (options.withSharedSpaces || hasScopedTokens);

    if (!shouldResolve) {
      return options;
    }

    const resolution = await this.faceIdentityRepository.resolveScopedPersonTokens({
      userId: auth.user.id,
      tokens,
      scope: {
        withSharedSpaces: options.withSharedSpaces,
        timelineSpaceIds: options.timelineSpaceIds,
        spaceId: options.spaceId,
      },
    });

    return {
      ...options,
      personIds: resolution.legacyPersonIds,
      identityIds: resolution.identityIds,
      spacePersonIds: [...new Set([...(options.spacePersonIds ?? []), ...resolution.legacySpacePersonIds])],
      forceEmptyResult: options.forceEmptyResult || resolution.hasInaccessibleToken,
    };
  }

  private async timeBucketChecks(auth: AuthDto, dto: Partial<TimeBucketDto>) {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    // Fork RBAC (Fix A) defense-in-depth: a pure space browse (spaceId / spacePersonId, no
    // per-user timeline) must never request Hidden/Locked — those are owner-private states that
    // make no sense across a shared scope. The repository query gates other members' Hidden/Locked
    // regardless, but rejecting here short-circuits the leak vector before it reaches the DB. The
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
    // withTimeBucketAssetFilters / getTimeBucket in asset.repository.ts).
    if (spaceBrowse && dto.isTrashed === true) {
      throw new BadRequestException('Trashed assets are not available when browsing a shared space or album');
    }

    // Each scope that is REQUESTED is checked — never `else if`. Both predicates go into the query
    // when both are present (an AND), so gating on only the first one let a caller with access to
    // album A learn which of A's assets belong to a space S they are not a member of: a membership
    // oracle (no asset leaks — every returned asset is in an album they may read — but the space
    // boundary was still answering questions for them). The filtered map endpoint refuses the
    // combination outright (shared-space.service.ts getFilteredMapMarkers); the timeline answers it,
    // so it must enforce the boundary it is querying.
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    // Only the un-scoped timeline defaults to "my assets". Under an album (or a space) the CALLER
    // states the owner scope: the album page sends none, because album ACCESS is its whole scope and
    // a viewer must see the owner's assets (medium E22); /photos sends `userId`, because it is my
    // personal timeline and the album chip must NARROW it, not redefine it (D3 — see
    // web/src/lib/utils/photos-filter-options.ts). Defaulting userId here would break the former.
    if (!dto.albumId && !dto.spaceId) {
      dto.userId ||= auth.user.id;
    }

    if (dto.userId) {
      await this.requireAccess({ auth, permission: Permission.TimelineRead, ids: [dto.userId] });
      if (dto.visibility === AssetVisibility.Archive) {
        await this.requireAccess({ auth, permission: Permission.ArchiveRead, ids: [dto.userId] });
      }
      if (dto.visibility === AssetVisibility.Locked && dto.userId !== auth.user.id) {
        throw new BadRequestException("You may not access another user's locked timeline");
      }
    }

    if (auth.sharedLink && !auth.sharedLink.showExif) {
      dto.withCoordinates = false;
    }
    if (dto.withPartners) {
      const isRequestedLocked = dto.visibility === AssetVisibility.Locked;
      const isRequestedArchived = dto.visibility === AssetVisibility.Archive || dto.visibility === undefined;
      const isRequestedFavorite = dto.isFavorite === true || dto.isFavorite === false;
      const isRequestedTrash = dto.isTrashed === true;

      if (isRequestedLocked || isRequestedArchived || isRequestedFavorite || isRequestedTrash) {
        throw new BadRequestException(
          'withPartners is only supported for non-archived, non-trashed, non-favorited, non-locked assets',
        );
      }
    }

    if (dto.withSharedSpaces) {
      const requestedArchived = dto.visibility === AssetVisibility.Archive || dto.visibility === undefined;
      const requestedFavorite = dto.isFavorite === true || dto.isFavorite === false;
      const requestedTrash = dto.isTrashed === true;

      if (requestedArchived || requestedFavorite || requestedTrash) {
        throw new BadRequestException(
          'withSharedSpaces is only supported for non-archived, non-trashed, non-favorited assets',
        );
      }
    }
  }
}
