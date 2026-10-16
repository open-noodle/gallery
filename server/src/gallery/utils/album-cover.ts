import { type ExpressionBuilder, sql } from 'kysely';
import type { DB } from 'src/schema/index.js';
import { albumMembership } from 'src/utils/shared-space-album-scope.js';

/**
 * True while the album's cover is a live space contribution: an `album_space_asset` row reached through a
 * space the album is still linked to, for an asset that is still visible. Upstream's `updateThumbnails` keeps
 * only `album_asset` covers, so without this an editor's contributed cover is reset on the next album read
 * (#1153). Viewer-independent on purpose: the cover is one value per album.
 */
export const albumCoverIsLiveContribution = (eb: ExpressionBuilder<DB, 'album'>) =>
  eb.exists(
    eb
      .selectFrom(
        albumMembership(eb, 'album.id', { spaceIdRef: sql.ref('album_space_asset.spaceId') }).as('album_members'),
      )
      .select(eb.lit(1).as('exists'))
      .whereRef('album_members.assetId', '=', 'album.albumThumbnailAssetId'),
  );
