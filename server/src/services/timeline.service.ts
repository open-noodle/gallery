import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto, isMetadataHidden } from 'src/dtos/auth.dto.js';
import {
  TimeBucketAssetDto,
  TimeBucketCoverDto,
  TimeBucketCoverResponseDto,
  TimeBucketDto,
  TimeBucketsResponseDto,
} from 'src/dtos/time-bucket.dto.js';
import { AssetVisibility, Permission } from 'src/enum.js';
import { isFavoritesAcrossScope } from 'src/gallery/utils/favorites-scope.js';
import { galleryTimeBucketChecks, galleryTimeBucketOptions } from 'src/gallery/utils/timeline-scope.js';
import { requireTimelineTagAccess } from 'src/gallery/utils/timeline-tag-access.js';
import { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireElevatedPermission } from 'src/utils/access.js';
import { getMyPartnerIds } from 'src/utils/asset.util.js';

@Injectable()
export class TimelineService extends BaseService {
  async getTimeBuckets(auth: AuthDto, dto: Partial<TimeBucketDto>): Promise<TimeBucketsResponseDto[]> {
    await this.timeBucketChecks(auth, dto);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto);
    return await this.assetRepository.getTimeBuckets(timeBucketOptions, auth);
  }

  async getTimeBucketCovers(auth: AuthDto, dto: TimeBucketCoverDto): Promise<TimeBucketCoverResponseDto[]> {
    await this.timeBucketChecks(auth, dto);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, dto);
    return this.galleryAssetRepository.getTimeBucketCovers({ ...timeBucketOptions, timeBuckets: dto.timeBuckets });
  }

  // pre-jsonified response
  async getTimeBucket(
    auth: AuthDto,
    dto: Partial<TimeBucketAssetDto> & Pick<TimeBucketAssetDto, 'timeBucket'>,
  ): Promise<string> {
    await this.timeBucketChecks(auth, dto);
    const timeBucketOptions = await this.buildTimeBucketOptions(auth, { ...dto });

    // TODO: use id cursor for pagination
    const bucket = await this.assetRepository.getTimeBucket(dto.timeBucket, timeBucketOptions, auth);
    return bucket.assets;
  }

  private async buildTimeBucketOptions(auth: AuthDto, dto: Partial<TimeBucketDto>): Promise<TimeBucketOptions> {
    const { userId, ...options } = dto;
    let userIds: string[] | undefined;

    if (userId) {
      userIds = [userId];
      if (dto.withPartners) {
        const partnerIds = await getMyPartnerIds({
          userId: auth.user.id,
          repository: this.partnerRepository,
          timelineEnabled: !options.personId || undefined,
        });
        userIds.push(...partnerIds);
      }
    }

    return { ...options, userIds, ...(await galleryTimeBucketOptions(this, this.sharedSpaceRepository, auth, dto)) };
  }

  private async timeBucketChecks(auth: AuthDto, dto: Partial<TimeBucketDto>) {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    } else if (!dto.spaceId) {
      dto.userId ||= auth.user.id;
    }

    if (dto.userId) {
      await this.requireAccess({ auth, permission: Permission.TimelineRead, ids: [dto.userId] });
    }

    const includesOtherUsers = dto.withPartners || (dto.userId && dto.userId !== auth.user.id);
    if (includesOtherUsers) {
      // Gallery: the Favorites screen keeps visibility unset; withOwnArchiveOnly then admits only the caller's own archive.
      const ownArchiveGated = dto.withPartners && dto.userId === auth.user.id && isFavoritesAcrossScope(dto);
      if (!ownArchiveGated) {
        dto.visibility ??= AssetVisibility.Timeline;
      }
      // #763 slice 4: isFavorite is deliberately not rejected here — favorites are a per-user overlay
      // (asset_favorite) resolved for the CALLER, so they compose with cross-user scopes.
      if ((dto.visibility ?? AssetVisibility.Timeline) !== AssetVisibility.Timeline || dto.isTrashed) {
        throw new BadRequestException(
          'Only non-archived, non-trashed, non-favorited, non-locked assets can be requested for other users',
        );
      }
    }

    if (dto.tagId) {
      await requireTimelineTagAccess(this.accessRepository, auth, dto.tagId);
    }

    // After the tag check: it folds tagId into tagIds.
    await galleryTimeBucketChecks(this.accessRepository, auth, dto);

    if (isMetadataHidden(auth)) {
      dto.withCoordinates = false;
    }
  }
}
