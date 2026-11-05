import { Injectable } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { StackResponseDto, mapStack } from 'src/dtos/stack.dto.js';
import { Permission } from 'src/enum.js';
import { AlbumAddTargetsDto, AlbumAddTargetsResponseDto } from 'src/gallery/dtos/album.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { findOrFail } from 'src/utils/misc.js';

@Injectable()
export class GalleryAlbumService extends BaseService {
  /**
   * A stack as an album holds it: `GET /stacks/{id}` narrowed to the members in the album (its own rows plus the
   * contributions the caller sees), for the viewer's "only this album's photos" stack strip
   * (specs/2026-11-01-album-stack-collapse-design.md). Needs read access to both, so it never shows more than
   * `GET /stacks/{id}` does.
   */
  async getStack(auth: AuthDto, albumId: string, stackId: string): Promise<StackResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [albumId] });
    await this.requireAccess({ auth, permission: Permission.StackRead, ids: [stackId] });
    const stack = await findOrFail(() => this.stackRepository.getById(stackId, auth.user.id), 'Asset stack');
    const inAlbum = await this.spaceAlbumRepository.getAlbumAssetIdsForViewer(
      albumId,
      stack.assets.map(({ id }) => id),
      auth.user.id,
    );
    return mapStack({ ...stack, assets: stack.assets.filter(({ id }) => inAlbum.has(id)) }, { auth });
  }

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
