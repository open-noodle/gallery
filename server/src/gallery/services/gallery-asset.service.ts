import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetEditableDto, AssetEditableResponseDto, AssetFavoriteUpdateDto } from 'src/dtos/asset.dto.js';
import { AssetType, JobName, Permission } from 'src/enum.js';
import {
  AssetImageAdjustDto,
  AssetImageAdjustResponseDto,
  NEUTRAL_IMAGE_ADJUST,
  isNeutralImageAdjust,
} from 'src/gallery/dtos/image-adjust.dto.js';
import { AssetVideoTrimDto, AssetVideoTrimResponseDto } from 'src/gallery/dtos/video-trim.dto.js';
import { logCrossOwnerEdit } from 'src/gallery/utils/cross-owner-edit.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireAccess } from 'src/utils/access.js';
import { isPanorama } from 'src/utils/asset.util.js';

/**
 * #763 canonical write surface for per-user favorites (PUT /assets/favorites), also called by
 * the deprecated `isFavorite` alias on AssetService `update`/`updateAll` (§8.1) — the alias keeps its own,
 * STRICTER Permission.AssetUpdate route guard, so it can only ever be narrower than this function,
 * never wider. See specs/2026-07-20-per-user-favorites-design.md §5.1.
 */
export const updateAssetFavorites = async (
  accessRepository: AccessRepository,
  assetFavoriteRepository: AssetFavoriteRepository,
  auth: AuthDto,
  dto: AssetFavoriteUpdateDto,
): Promise<void> => {
  // §5.1: a shared-link session's `auth.user` is the LINK OWNER's identity, not an authenticated
  // caller (AuthDto.user is non-optional; sharedLink is the optional field that marks this case —
  // see auth.dto.ts:16,18). Without this explicit guard, an anonymous visitor holding a share link
  // would create asset_favorite rows attributed to the owner: an unauthenticated write in a real
  // user's name. No route on this DTO declares `sharedLink: true`, but this guard is deliberately
  // NOT relied on that route metadata alone — it must hold even if that ever changes.
  if (auth.sharedLink) {
    throw new BadRequestException('Shared link sessions cannot set favorites');
  }

  // The subject is ALWAYS the caller (E4/E7): nothing in AssetFavoriteUpdateDto can name another
  // user, and elevated session permission (auth.session.hasElevatedPermission) never widens this —
  // it only ever grants the CALLER extra read access (e.g. their own Locked assets), never lets
  // them write on someone else's behalf.
  await requireAccess(accessRepository, { auth, permission: Permission.AssetRead, ids: dto.ids });

  await (dto.isFavorite
    ? assetFavoriteRepository.addAll(auth.user.id, dto.ids)
    : assetFavoriteRepository.removeAll(auth.user.id, dto.ids));
};

// Fork asset endpoints served by GalleryAssetController: per-user favorites, the editable-subset query, video trim and
// image colour adjustment.
@Injectable()
export class GalleryAssetService extends BaseService {
  async getEditable(auth: AuthDto, dto: AssetEditableDto): Promise<AssetEditableResponseDto> {
    // Deliberately a bare access check, not a second implementation of the rule: this IS
    // the same call the write will make, so the answer cannot drift from enforcement.
    const editable = await this.checkAccess({ auth, permission: Permission.AssetUpdate, ids: dto.assetIds });
    return { editableAssetIds: [...editable] };
  }

  updateFavorites(auth: AuthDto, dto: AssetFavoriteUpdateDto): Promise<void> {
    return updateAssetFavorites(this.accessRepository, this.assetFavoriteRepository, auth, dto);
  }

  async getTrim(auth: AuthDto, id: string): Promise<AssetVideoTrimResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });

    const asset = await this.videoTrimRepository.getForTrim(id);
    if (!asset || asset.startTime === null || asset.endTime === null) {
      throw new NotFoundException('Asset is not trimmed');
    }

    return { startTime: asset.startTime, endTime: asset.endTime, originalDuration: (asset.duration ?? 0) / 1000 };
  }

  async setTrim(auth: AuthDto, id: string, dto: AssetVideoTrimDto): Promise<AssetVideoTrimResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetEditCreate, ids: [id] });

    const asset = await this.videoTrimRepository.getForTrim(id);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Video) {
      throw new BadRequestException('Trim is only supported for video assets');
    }

    if (asset.livePhotoVideoId) {
      throw new BadRequestException('Trimming live photos is not supported');
    }

    // External-library originals are absolute paths outside the media location; S3 originals are relative keys.
    if (isAbsolute(asset.originalPath) && !StorageCore.isImmichPath(asset.originalPath)) {
      throw new BadRequestException('Video trimming is not available for external library videos');
    }

    const durationSeconds = (asset.duration ?? 0) / 1000;
    if (durationSeconds <= 0) {
      throw new BadRequestException('Video duration is not available');
    }

    if (durationSeconds < 2) {
      throw new BadRequestException('Video is too short to trim (minimum 2 seconds)');
    }

    if (dto.endTime > durationSeconds) {
      throw new BadRequestException('End time exceeds video duration');
    }

    if (dto.startTime === 0 && dto.endTime >= durationSeconds) {
      if (asset.startTime === null) {
        throw new BadRequestException('Trim must actually remove content');
      }
      // Web sends the full range when the handles are dragged back out: that is an undo, not a full-length re-encode.
      await this.removeTrim(auth, id);
      return { startTime: 0, endTime: durationSeconds, originalDuration: durationSeconds };
    }

    // getProbeInput hands ffprobe a path (disk) or a presigned URL (S3), so the request never downloads the video.
    let probeResult: Awaited<ReturnType<typeof this.mediaRepository.probe>>;
    try {
      probeResult = await this.mediaRepository.probe(await this.backendMedia.getProbeInput(asset.originalPath));
    } catch {
      // ffprobe echoes its input in stderr, and for S3 that is a presigned URL (a credential): log the id only.
      this.logger.error(`Failed to probe video for trim (asset ${id})`);
      throw new BadRequestException('Unable to read video for trimming');
    }
    if (probeResult.videoStreams.length === 0) {
      throw new BadRequestException('Cannot trim audio-only files');
    }

    await this.videoTrimRepository.upsert(id, dto.startTime, dto.endTime);
    // The trimmed thumbnails are the asset's edited ones, which clients request while isEdited is set.
    await this.assetRepository.update({ id, isEdited: true });
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });
    await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);

    return { startTime: dto.startTime, endTime: dto.endTime, originalDuration: durationSeconds };
  }

  async removeTrim(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetEditDelete, ids: [id] });

    if (await this.videoTrimRepository.delete(id)) {
      await this.assetRepository.update({ id, isEdited: false });
      await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);
    }
    // The edit job removes the trimmed files and regenerates thumbnails; clients wait for its AssetEditReadyV2.
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });
  }

  async getAdjust(auth: AuthDto, id: string): Promise<AssetImageAdjustResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [id] });
    return (await this.imageAdjustRepository.get(id)) ?? { ...NEUTRAL_IMAGE_ADJUST };
  }

  async setAdjust(auth: AuthDto, id: string, dto: AssetImageAdjustDto): Promise<AssetImageAdjustResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetEditCreate, ids: [id] });

    // Web sends all-neutral values when the sliders are back at zero: that removes the adjustment.
    if (isNeutralImageAdjust(dto)) {
      await this.removeAdjust(auth, id);
      return { ...NEUTRAL_IMAGE_ADJUST };
    }

    // The same images Immich lets you edit (AssetService.editAsset): the adjusted thumbnails are its edited ones.
    const asset = await this.assetRepository.getForEdit(id);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type !== AssetType.Image) {
      throw new BadRequestException('Only images can be adjusted');
    }

    if (asset.livePhotoVideoId) {
      throw new BadRequestException('Adjusting live photos is not supported');
    }

    if (isPanorama(asset)) {
      throw new BadRequestException('Adjusting panorama images is not supported');
    }

    const extension = asset.originalPath?.toLowerCase();
    if (extension?.endsWith('.gif') || extension?.endsWith('.svg')) {
      throw new BadRequestException('Adjusting GIF or SVG images is not supported');
    }

    const { exposure, contrast, saturation, invert } = dto;
    await this.imageAdjustRepository.upsert(id, { exposure, contrast, saturation, invert });
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });
    await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);

    return { exposure, contrast, saturation, invert };
  }

  async removeAdjust(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetEditDelete, ids: [id] });

    if (await this.imageAdjustRepository.delete(id)) {
      await logCrossOwnerEdit(this.accessRepository, this.sharedSpaceRepository, this.logger, auth, [id]);
    }
    // The edit job removes or regenerates the edited files; clients wait for its AssetEditReadyV2.
    await this.jobRepository.queue({ name: JobName.AssetEditThumbnailGeneration, data: { id } });
  }
}
