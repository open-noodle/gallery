import { SelectQueryBuilder } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

/**
The Favorites screen's scope (specs/2026-10-23-mobile-search-redesign-design.md, "Scope parameters"): the caller's
favourites among their own photos, timeline + archive, and among what their timeline partners and every space they
belong to share with them, as those appear in the timeline. A browse widened with `withPartners` or
`withSharedSpaces` otherwise needs timeline visibility, because an unset visibility admits archived photos and archive
is the owner's private state. A favourites request may leave it unset: {@link withOwnArchiveOnly} then admits an
archived photo only when the caller owns it.
*/
export const isFavoritesAcrossScope = (dto: { isFavorite?: boolean; visibility?: AssetVisibility }) =>
  dto.isFavorite === true && dto.visibility === undefined;

type WidenedTimeline = {
  visibility?: AssetVisibility;
  withPartners?: boolean;
  withSharedSpaces?: boolean;
  authUserId?: string;
};

/**
The timeline-bucket half of {@link isFavoritesAcrossScope}: on a widened browse with visibility unset (which the
services accept only for favourites), an archived photo comes in only when it is the caller's own. Keyed on the
widening flags, not on `isFavorite`, so a facet that drops its own favourite filter still keeps the gate.
*/
export function withOwnArchiveOnly<O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  options: WidenedTimeline,
): SelectQueryBuilder<DB, 'asset', O> {
  if (options.visibility !== undefined || !(options.withPartners || options.withSharedSpaces)) {
    return qb;
  }
  return qb.where((eb) =>
    eb.or([
      eb('asset.visibility', '!=', AssetVisibility.Archive),
      ...(options.authUserId ? [eb('asset.ownerId', '=', asUuid(options.authUserId))] : []),
    ]),
  );
}
