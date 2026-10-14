import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetEditableDto, AssetEditableResponseDto, AssetFavoriteUpdateDto } from 'src/dtos/asset.dto.js';
import { Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireAccess } from 'src/utils/access.js';

/**
 * #763 canonical write surface for per-user favorites (PUT /assets/favorites), also called by
 * the deprecated `isFavorite` alias on AssetService `update`/`updateAll` (§8.1) — the alias keeps its own,
 * STRICTER Permission.AssetUpdate route guard, so it can only ever be narrower than this function,
 * never wider. See docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §5.1.
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

// Fork asset endpoints served by GalleryAssetController: per-user favorites and the editable-subset query.
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
}
