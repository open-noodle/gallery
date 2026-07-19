import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { anyUuid } from 'src/utils/database';
import { spaceVisibilityGate } from 'src/utils/shared-space-album-scope';

const builder = (db: Kysely<DB>) =>
  db
    .selectFrom('asset')
    .innerJoin('asset_exif', 'assetId', 'id')
    .select(['asset.id', 'asset.livePhotoVideoId', 'asset_exif.fileSizeInByte as size'])
    .where('asset.deletedAt', 'is', null);

@Injectable()
export class DownloadRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  downloadAssetIds(ids: string[]) {
    return builder(this.db).where('asset.id', '=', anyUuid(ids)).stream();
  }

  downloadMotionAssetIds(ids: string[]) {
    return builder(this.db).select(['asset.originalPath']).where('asset.id', '=', anyUuid(ids)).stream();
  }

  downloadAlbumId(albumId: string) {
    return (
      builder(this.db)
        .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
        .where('album_asset.albumId', '=', albumId)
        // rbac-8 (no functional change): flat visibility gate — NO owner exception — so an album-archive
        // export omits Hidden/Locked rows for everyone, matching the album grid (withDefaultVisibility) and
        // map-markers. An `own OR` here would let the owner download Hidden while the grid hides it.
        .where((eb) => spaceVisibilityGate(eb))
        .stream()
    );
  }

  downloadUserId(userId: string) {
    return builder(this.db)
      .where('asset.ownerId', '=', userId)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  downloadSpaceId(spaceId: string) {
    const direct = builder(this.db)
      .innerJoin('shared_space_asset', 'asset.id', 'shared_space_asset.assetId')
      .where('shared_space_asset.spaceId', '=', spaceId)
      .where((eb) => spaceVisibilityGate(eb));

    const library = builder(this.db)
      .innerJoin('shared_space_library', (join) => join.onRef('shared_space_library.libraryId', '=', 'asset.libraryId'))
      .where('shared_space_library.spaceId', '=', spaceId)
      .where('asset.isOffline', '=', false)
      .where((eb) => spaceVisibilityGate(eb));

    const album = builder(this.db)
      .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album_asset.albumId')
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
      )
      .where('shared_space_album.spaceId', '=', spaceId)
      .where((eb) => spaceVisibilityGate(eb));

    return direct.union(library).union(album).stream();
  }
}
