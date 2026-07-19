import { Injectable } from '@nestjs/common';
import { Activity } from 'src/database';
import {
  ActivityCreateDto,
  ActivityDto,
  ActivityResponseDto,
  ActivitySearchDto,
  ActivityStatisticsResponseDto,
  mapActivity,
  MaybeDuplicate,
  ReactionLevel,
  ReactionType,
} from 'src/dtos/activity.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { hasDirectAlbumReadAccess } from 'src/utils/access';

@Injectable()
export class ActivityService extends BaseService {
  async getAll(auth: AuthDto, dto: ActivitySearchDto): Promise<ActivityResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });

    // C1: a caller who reaches the album ONLY through shared-space membership (not the album owner or a
    // shared album_user) must not see album-level activity (comments/likes with no asset) — the historical
    // thread, commenter identities and like list. Asset-level activity on visible assets (already gated in
    // activityRepository.search) is unaffected. A shared-link caller has explicit album access → treated as
    // direct (also avoids an owner-lookup on the shared-link path).
    const hasDirectAccess =
      !!auth.sharedLink || (await hasDirectAlbumReadAccess(this.accessRepository, auth.user.id, dto.albumId));

    const activities = await this.activityRepository.search({
      userId: dto.userId,
      albumId: dto.albumId,
      assetId: dto.level === ReactionLevel.ALBUM ? null : dto.assetId,
      isLiked: dto.type && dto.type === ReactionType.LIKE,
    });

    const visible = hasDirectAccess ? activities : activities.filter((activity) => activity.assetId !== null);

    return visible.map((activity) => {
      const dto = mapActivity(activity);
      // M5: a space-only reader (no owner/album-user/shared-link access) must not learn commenter/liker
      // emails on the asset-level activity C1 leaves visible — the same PII security-8 stripped from
      // albumUsers, one endpoint over. Redact after mapActivity so mapUser's avatarColor email-fallback
      // is already computed.
      if (!hasDirectAccess) {
        dto.user.email = '';
      }
      return dto;
    });
  }

  // I2: getStatistics gates on the same AlbumRead as getAll (C1) but previously returned the
  // aggregate {comments, likes} counts including album-level (assetId null) rows to space-only
  // readers — a smaller side channel than C1's content/identity leak, but still info a space-only
  // reader shouldn't have (album-level activity isn't visible to them anywhere else). Scope it the
  // same way: hasDirectAccess readers keep the full count; space-only readers get asset-level-only.
  async getStatistics(auth: AuthDto, dto: ActivityDto): Promise<ActivityStatisticsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });

    const hasDirectAccess =
      !!auth.sharedLink || (await hasDirectAlbumReadAccess(this.accessRepository, auth.user.id, dto.albumId));

    return await this.activityRepository.getStatistics({
      albumId: dto.albumId,
      assetId: dto.assetId,
      excludeAlbumLevel: !hasDirectAccess,
    });
  }

  async create(auth: AuthDto, dto: ActivityCreateDto): Promise<MaybeDuplicate<ActivityResponseDto>> {
    await this.requireAccess({ auth, permission: Permission.ActivityCreate, ids: [dto.albumId] });

    const common = {
      userId: auth.user.id,
      assetId: dto.assetId,
      albumId: dto.albumId,
    };

    let activity: Activity | undefined;
    let isDuplicate = false;

    if (dto.type === ReactionType.LIKE) {
      delete dto.comment;
      [activity] = await this.activityRepository.search({
        ...common,
        // `null` will search for an album like
        assetId: dto.assetId ?? null,
        isLiked: true,
      });
      isDuplicate = !!activity;
    }

    if (!activity) {
      activity = await this.activityRepository.create({
        ...common,
        isLiked: dto.type === ReactionType.LIKE,
        comment: dto.comment,
      });
    }

    return { duplicate: isDuplicate, value: mapActivity(activity) };
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.ActivityDelete, ids: [id] });
    await this.activityRepository.delete(id);
  }
}
