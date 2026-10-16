import { Injectable } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import { AlbumAddTargetsDto, AlbumAddTargetsResponseDto } from 'src/gallery/dtos/album.dto.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class GalleryAlbumService extends BaseService {
  /**
   * Read-only twin of AlbumService `addAssets` / `addAssetsToAlbums`: which of `albumIds` would accept
   * how many of `assetIds`, so the add-to-album picker offers only valid targets. An asset counts for
   * an album when the caller has AssetShare on it, or when it is a #764 contribution the album would
   * take (already-contributed ones included — the write path reports those as DUPLICATE).
   */
  async getAddTargets(auth: AuthDto, dto: AlbumAddTargetsDto): Promise<AlbumAddTargetsResponseDto> {
    const assetIds = [...new Set(dto.assetIds)];
    const [allowedAlbumIds, shareableIds] = await Promise.all([
      this.checkAccess({ auth, permission: Permission.AlbumAssetCreate, ids: dto.albumIds }),
      this.checkAccess({ auth, permission: Permission.AssetShare, ids: assetIds }),
    ]);

    const deniedIds = assetIds.filter((assetId) => !shareableIds.has(assetId));
    const acceptedByAlbum = new Map<string, number>(
      [...allowedAlbumIds].map((albumId) => [albumId, shareableIds.size]),
    );

    if (deniedIds.length > 0 && allowedAlbumIds.size > 0) {
      const contributable = await this.sharedSpaceRepository.getContributableAssetCounts(
        auth.user.id,
        [...allowedAlbumIds],
        deniedIds,
      );
      for (const { albumId, count } of contributable) {
        acceptedByAlbum.set(albumId, (acceptedByAlbum.get(albumId) ?? 0) + Number(count));
      }
    }

    return {
      albums: [...acceptedByAlbum]
        .filter(([, acceptedAssetCount]) => acceptedAssetCount > 0)
        .map(([albumId, acceptedAssetCount]) => ({ albumId, acceptedAssetCount })),
      shareableAssetCount: shareableIds.size,
    };
  }
}
