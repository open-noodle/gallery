import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';
import { albumMembership, spaceLinkedAlbumIds, spaceVisibilityGate } from 'src/utils/shared-space-album-scope.js';

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
    return (
      builder(this.db)
        // rbac-8 (no functional change): flat visibility gate, NO owner exception, so an album-archive
        // export omits Hidden/Locked rows for everyone, matching the album grid (withDefaultVisibility) and
        // map-markers. An `own OR` here would let the owner download Hidden while the grid hides it.
        // Applied before the join so `eb` keeps the type spaceVisibilityGate expects.
        .where((eb) => spaceVisibilityGate(eb))
        // #1048: mirrors `AccessRepository.spaceAsset.checkSpaceAccess`, whose album arm requires
        // `isOffline = false`. The manifest this builds is re-checked asset-by-asset under `AssetDownload`
        // before the zip is streamed, and `requireAccess` is all-or-nothing, so a single offline row here
        // does not merely go missing from the archive, it 400s the entire download for anyone whose only
        // route to it is the space.
        .where('asset.isOffline', '=', false)
        .innerJoin(
          (eb) =>
            albumMembership(eb, [albumId], albumSpaceIds?.length ? { spaceIds: albumSpaceIds } : undefined).as(
              'album_members',
            ),
          (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
        )
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
    // Per-arm `isOffline` handling below deliberately mirrors `checkSpaceAccess` arm for arm: the
    // directly-added arm has NO offline gate there, the library and album arms do.
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

    // Linked albums' rows and contributions to this space, joined: an EXISTS scans the whole asset table.
    const album = builder(this.db)
      .where((eb) => spaceVisibilityGate(eb))
      .where('asset.isOffline', '=', false)
      .innerJoin(
        (eb) => albumMembership(eb, spaceLinkedAlbumIds(eb, spaceId), { spaceId }).as('album_members'),
        (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
      );

    return direct.union(library).union(album).stream();
  }
}
