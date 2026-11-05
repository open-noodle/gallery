import { Expression, ExpressionBuilder, SelectQueryBuilder, SqlBool, expressionBuilder, sql } from 'kysely';
import type { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { withTimeBucketAssetFilters } from 'src/gallery/utils/time-bucket-filter.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';
import { albumMembership } from 'src/utils/shared-space-album-scope.js';

/**
 * `withStacked` on an album timeline: one photo per stack, chosen among the album's own members.
 *
 * Upstream's collapse keeps only the stack's primary, which is right for a library timeline (the primary is always
 * there) but hides an album photo whenever its primary is not in the album. Here a photo is hidden only when another
 * member of its stack ranks ahead of it AND passes this same request's filters (album membership, visibility and every
 * filter chip): the primary first, then the earliest by `fileCreatedAt`, then by id. So the album shows the primary when
 * it holds it, otherwise its earliest member of the stack, and a filter never leaves a photo hidden behind a sibling it
 * excluded. Ranking across the whole album, not the bucket, keeps the choice the same in every bucket and count.
 *
 * Only the viewer's own stacks collapse: `getStack` is owner-only (`Permission.StackRead`), so in a shared album another
 * user's stack could not be expanded in the viewer and its members would be unreachable. `getTimeBucket` badges the same
 * set through {@link albumStackBadge}.
 */
export function withAlbumStackCollapse<O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  options: TimeBucketOptions,
  viewerId?: string,
): SelectQueryBuilder<DB, 'asset', O> {
  const callerId = options.authUserId ?? viewerId;
  if (!options.withStacked || !options.albumId || !callerId) {
    return qb;
  }
  const ownerId = asUuid(callerId);
  return qb.where((eb) =>
    eb.or([
      eb('asset.stackId', 'is', null),
      eb.not(
        eb.exists(
          eb
            .selectFrom(
              withTimeBucketAssetFilters(
                eb.selectFrom('asset').select(['asset.id', 'asset.stackId', 'asset.fileCreatedAt']),
                { ...options, withStacked: false },
                viewerId,
              ).as('ahead'),
            )
            .innerJoin('stack', 'stack.id', 'ahead.stackId')
            .whereRef('ahead.stackId', '=', 'asset.stackId')
            .whereRef('ahead.id', '!=', 'asset.id')
            .where('stack.ownerId', '=', ownerId)
            .where((eb) =>
              eb.or([
                eb('ahead.id', '=', eb.ref('stack.primaryAssetId')),
                eb.and([
                  eb('asset.id', '!=', eb.ref('stack.primaryAssetId')),
                  eb(
                    eb.refTuple('ahead.fileCreatedAt', 'ahead.id'),
                    '<',
                    eb.refTuple('asset.fileCreatedAt', 'asset.id'),
                  ),
                ]),
              ]),
            ),
        ),
      ),
    ]),
  );
}

/**
 * The stack badge on an album timeline, a `WHERE` on the `stacked` members `getTimeBucket` counts. It is projected only
 * for the stacks {@link withAlbumStackCollapse} collapses, so another user's stacked photos in a shared album carry no
 * badge (and no expand action) the viewer could not open. With `stackCountInAlbum` it counts only the members this album
 * holds, by the same membership as the album grid; a stack with one member in the album then has no badge.
 */
export const albumStackBadge = (
  options: TimeBucketOptions & { stackCountInAlbum?: boolean },
  viewerId: string,
): Expression<SqlBool> => {
  const eb = expressionBuilder<DB, 'asset'>();
  const isViewers = eb.exists(
    eb.selectFrom('stack').whereRef('stack.id', '=', 'asset.stackId').where('stack.ownerId', '=', asUuid(viewerId)),
  );
  if (!options.stackCountInAlbum || !options.albumId) {
    return isViewers;
  }
  const members = albumMembership(
    eb as unknown as ExpressionBuilder<DB, keyof DB>,
    [options.albumId],
    options.albumSpaceIds?.length ? { spaceIds: options.albumSpaceIds } : undefined,
  ).as('album_members');
  return eb.and([
    isViewers,
    eb(sql.ref<string>('stacked.id'), 'in', eb.selectFrom(members).select('album_members.assetId')),
  ]);
};
