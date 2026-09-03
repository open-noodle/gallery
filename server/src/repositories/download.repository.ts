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

  /**
   * #1048: `albumSpaceIds` are the live member-spaces the SERVICE resolved for this caller
   * (`getAlbumSpaceIds`) — the viewer's spaces linking the album, or the single tethered space of a
   * share link. When set, the archive unions the cross-owner `album_space_asset` contributions
   * (#764) the album grid already shows; a personal album, an `album_user` share and a spaceless
   * link all resolve none and read `album_asset` alone, exactly as before. Same contract as
   * `AssetRepository`'s album arm, so browse and download can't disagree.
   */
  downloadAlbumId(albumId: string, albumSpaceIds?: string[]) {
    const ownerRows = builder(this.db)
      .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
      .where('album_asset.albumId', '=', albumId)
      // rbac-8 (no functional change): flat visibility gate — NO owner exception — so an album-archive
      // export omits Hidden/Locked rows for everyone, matching the album grid (withDefaultVisibility) and
      // map-markers. An `own OR` here would let the owner download Hidden while the grid hides it.
      .where((eb) => spaceVisibilityGate(eb))
      // #1048: both album arms mirror `AccessRepository.asset.checkSpaceAccess`, whose album and
      // contributed arms BOTH require `isOffline = false`. The manifest this builds is re-checked
      // asset-by-asset under `AssetDownload` before the zip is streamed, and `requireAccess` is
      // all-or-nothing — so a single offline row here does not merely go missing from the archive,
      // it 400s the entire download for anyone whose only route to it is the space.
      .where('asset.isOffline', '=', false);

    if (!albumSpaceIds?.length) {
      return ownerRows.stream();
    }

    const contributed = builder(this.db)
      .innerJoin('album_space_asset', 'asset.id', 'album_space_asset.assetId')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.spaceId', '=', anyUuid(albumSpaceIds))
      .where((eb) => spaceVisibilityGate(eb))
      .where('asset.isOffline', '=', false);

    // UNION (not ALL) dedupes the P1-6 coexistence window, where the same asset carries both an
    // `album_asset` and an `album_space_asset` row — the archive must list it once.
    return ownerRows.union(contributed).stream();
  }

  downloadUserId(userId: string) {
    return builder(this.db)
      .where('asset.ownerId', '=', userId)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  downloadSpaceId(spaceId: string) {
    // Per-arm `isOffline` handling below deliberately mirrors `checkSpaceAccess` arm for arm: the
    // directly-added arm has NO offline gate there, the library / album / contributed arms all do.
    // Keep them aligned — an arm the manifest includes but the gate rejects 400s the whole download.
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
      .where((eb) => spaceVisibilityGate(eb))
      .where('asset.isOffline', '=', false);

    // #1048: the linked album's cross-owner contributions (#764) — the fourth path a space shows.
    // Correlated on BOTH albumId and spaceId so a contribution is only ever reachable through the
    // one space it was made to, and requires a live `shared_space_album` link, so a retained
    // contribution row of an unlinked album stays inert.
    const contributed = builder(this.db)
      .innerJoin('album_space_asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album', (join) =>
        join
          .onRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
          .onRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId'),
      )
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
      )
      .where('shared_space_album.spaceId', '=', spaceId)
      .where((eb) => spaceVisibilityGate(eb))
      .where('asset.isOffline', '=', false);

    return direct.union(library).union(album).union(contributed).stream();
  }
}
