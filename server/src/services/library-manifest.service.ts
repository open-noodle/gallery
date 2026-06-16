import { Injectable, NotFoundException } from '@nestjs/common';
import { MANIFEST_PAGE_SIZE, MANIFEST_SCHEMA_VERSION } from 'src/constants';
import { AuthDto } from 'src/dtos/auth.dto';
import { LibraryManifestAssetDto, LibraryManifestResponseDto } from 'src/dtos/library-manifest.dto';
import { BaseService } from 'src/services/base.service';
import { hexOrBufferToBase64 } from 'src/utils/bytes';

@Injectable()
export class LibraryManifestService extends BaseService {
  async getManifest(
    auth: AuthDto,
    id: string,
    cursor?: string,
    pageSize: number = MANIFEST_PAGE_SIZE,
  ): Promise<LibraryManifestResponseDto> {
    const user = await this.userRepository.get(id, { withDeleted: true });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rows = await this.assetRepository.getOwnedManifestAssets(id, pageSize + 1, cursor);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

    const assetIds = pageRows.map((row) => row.id);
    const [ownedAlbums, albumMemberships] = await Promise.all([
      this.albumRepository.getOwnedNames(id),
      this.albumRepository.getOwnedAlbumIdsForAssets(id, assetIds),
    ]);
    const albumIdsByAsset = new Map(albumMemberships.map((m) => [m.assetId, m.albumIds]));

    const assets: LibraryManifestAssetDto[] = pageRows.map((row) => ({
      assetId: row.id,
      objectKey: row.originalPath,
      originalFileName: row.originalFileName,
      checksum: hexOrBufferToBase64(row.checksum)!,
      checksumAlgorithm: row.checksumAlgorithm,
      size: row.size ?? null,
      type: row.type,
      fileCreatedAt: row.fileCreatedAt ? new Date(row.fileCreatedAt).toISOString() : null,
      fileModifiedAt: row.fileModifiedAt ? new Date(row.fileModifiedAt).toISOString() : null,
      albumIds: albumIdsByAsset.get(row.id) ?? [],
    }));

    return {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      owner: { id: user.id, email: user.email },
      albums: ownedAlbums.map((album) => ({ id: album.id, name: album.albumName })),
      assets,
      nextCursor: hasMore ? pageRows.at(-1)!.id : null,
    };
  }
}
