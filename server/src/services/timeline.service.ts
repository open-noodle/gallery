import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { TimeBucketAssetDto, TimeBucketDto, TimeBucketsResponseDto } from 'src/dtos/time-bucket.dto';
import { AssetVisibility, Permission, TimeBucketSize } from 'src/enum';
import { TimeBucketOptions } from 'src/repositories/asset.repository';
import { BaseService } from 'src/services/base.service';
import { requireElevatedPermission } from 'src/utils/access';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { normalizeTimeBucketForBucketSize } from 'src/utils/timeline-bucket';

@Injectable()
export class TimelineService extends BaseService {
  async getTimeBuckets(auth: AuthDto, dto: Partial<TimeBucketDto>): Promise<TimeBucketsResponseDto[]> {
    await this.timeBucketChecks(auth, dto);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto);
    return await this.assetRepository.getTimeBuckets(timeBucketOptions, auth);
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

    const scopedOptions = await this.resolveScopedPersonFilters(auth, { ...options, timelineSpaceIds });

    return { ...scopedOptions, bucketSize: dto.bucketSize ?? TimeBucketSize.Month, userIds };
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

    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    } else if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    } else {
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
