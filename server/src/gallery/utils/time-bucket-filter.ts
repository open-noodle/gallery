import { Expression, ExpressionBuilder, SelectQueryBuilder, SqlBool, sql } from 'kysely';
import { AssetStatus, TimeBucketSize } from 'src/enum.js';
import { type TimeBucketOptions, getBoundingCircle, withBoundingBox } from 'src/repositories/asset.repository.js';
import { DB } from 'src/schema/index.js';
import { withAssetFilter } from 'src/utils/asset-filter.js';
import {
  anyUuid,
  asUuid,
  escapeLikePattern,
  hasPeople,
  inSharedAlbum,
  tokenizeForSearch,
  withAnyTagId,
  withDefaultVisibility,
} from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { hasFaceIdentities, hasSpacePeople } from 'src/utils/people-filter.js';
import {
  type TimelineRescue,
  albumMembership,
  hiddenFromOwnTimeline,
  ownedOrSharedWithViewer,
  spaceAssetPathBranches,
  spaceVisibilityGate,
  timelineHiddenScopeIsEmpty,
} from 'src/utils/shared-space-album-scope.js';

// Postgres writes years past 9999 unsigned (`12345-01-01`), while `toISOString()` uses the ISO 8601
// expanded-year form (`+012346-01-01`) — six digits plus a sign, so a fixed 10-character slice cuts
// the day off. Take the whole date part and drop the sign to land back on Postgres's own spelling.
const formatUtcDate = (date: Date) => date.toISOString().split('T', 1)[0].replace(/^\+0*/, '');

// Advance a YYYY-MM-DD bucket-start date by one bucket interval (the exclusive
// upper bound of the requested range).
export const addBucketInterval = (bucketStart: string, bucketSize: TimeBucketSize): string => {
  const [year, month, day] = bucketStart.split('-').map(Number);
  switch (bucketSize) {
    case TimeBucketSize.Year: {
      // Anchor to Jan 1 of the next year regardless of input day/month.
      return formatUtcDate(new Date(Date.UTC(year + 1, 0, 1)));
    }
    case TimeBucketSize.Month: {
      // Anchor to the first of the next month regardless of input day.
      // month is 1-based, so Date.UTC(year, month, 1) is the 1st of month+1.
      return formatUtcDate(new Date(Date.UTC(year, month, 1)));
    }
    default: {
      return formatUtcDate(new Date(Date.UTC(year, month - 1, day + 1)));
    }
  }
};

/**
 * #1041 §6.4: the caller's-own-timeline arm, with the "hidden from my own timeline" subtraction
 * attached ONLY to the caller's own id — never to the whole `userIds` set, which also carries
 * partner ids (`timeline.service.ts` pushes `getMyPartnerIds` into it). AND-ing the subtraction
 * across `userIds` would remove a PARTNER's photos based on the CALLER's flags — the "partner trap"
 * E10 pins.
 *
 * When there is nothing to subtract (no `callerId`, no `hiddenScope`, or an empty scope — the common
 * case, a viewer who has hidden nothing), this emits EXACTLY the pre-#1041 predicate,
 * `ownerId = ANY(userIds)`, so that caller pays nothing and the SQL is unchanged.
 */
function ownerArmWithHiddenSubtraction(
  eb: ExpressionBuilder<DB, 'asset'>,
  options: TimeBucketOptions,
  rescue: TimelineRescue,
): Expression<SqlBool> {
  const userIds = options.userIds!;
  const subtraction =
    options.callerId && options.hiddenScope && !timelineHiddenScopeIsEmpty(options.hiddenScope)
      ? hiddenFromOwnTimeline(eb, options.hiddenScope, rescue)
      : undefined;

  if (!subtraction || !options.callerId) {
    return eb('asset.ownerId', '=', anyUuid(userIds));
  }

  // Never a partner: `userIds` minus the caller is exactly the partner (or other-viewed-user) set,
  // unaffected by the caller's own hidden scope.
  const otherIds = userIds.filter((id) => id !== options.callerId);
  return eb.or([
    eb.and([eb('asset.ownerId', '=', asUuid(options.callerId)), subtraction]),
    ...(otherIds.length > 0 ? [eb('asset.ownerId', '=', anyUuid(otherIds))] : []),
  ]);
}

export function withTimeBucketAssetFilters<O>(
  qb: SelectQueryBuilder<DB, 'asset', O>,
  options: TimeBucketOptions,
  // Upstream (immich-30739) widens the owner check for person-scoped timelines so a viewer also sees
  // the person's faces on assets shared with them through an album. The fork normalises upstream's
  // single `personId` to `personIds` in timeline.service (see "Normalize deprecated single-value
  // fields"), so the scoping signal to test here is the ARRAY — testing `options.personId` made this
  // branch permanently unreachable, because nothing ever sets it.
  // `getTimeBucketCovers` has no auth in hand and is fork-only, so it passes nothing and keeps the
  // plain owner check.
  viewerId?: string,
): SelectQueryBuilder<DB, 'asset', O> {
  return (
    qb
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(!!options.isTrashed, (qb) => qb.where('asset.status', '!=', AssetStatus.Deleted))
      .where('asset.deletedAt', options.isTrashed ? 'is not' : 'is', null)
      .$if(!!options.bbox || !!options.description, (qb) => {
        let q = qb.innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId');

        if (options.bbox) {
          const circle = getBoundingCircle(options.bbox);
          q = q.where(
            sql`earth_box(ll_to_earth_public(${circle.centerLatitude}, ${circle.centerLongitude}), ${circle.radius})`,
            '@>',
            sql`ll_to_earth_public(asset_exif.latitude, asset_exif.longitude)`,
          ) as any;
          q = withBoundingBox(q, options.bbox) as any;
        }

        if (options.description) {
          q = q.where(
            sql`f_unaccent(asset_exif.description)`,
            'ilike',
            sql`'%' || f_unaccent(${escapeLikePattern(options.description)}) || '%' escape '\\'`,
          ) as any;
        }

        return q;
      })
      .$if(options.visibility === undefined, withDefaultVisibility)
      .$if(!!options.visibility, (qb) => qb.where('asset.visibility', '=', options.visibility!))
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$if(!!options.albumId, (qb) =>
        qb
          // Fork RBAC (Slice 1 / security-3 defense-in-depth): an explicit visibility=HIDDEN/LOCKED
          // bypasses the top-level withDefaultVisibility (which only fires when visibility is
          // undefined). Flat-gate the album arm so Hidden/Locked album assets never surface via the
          // timeline bucket, even if the service-level guard is bypassed. Idempotent for the default
          // album grid view (withDefaultVisibility is the same Archive+Timeline predicate).
          //
          // Applied BEFORE the innerJoin below (WHERE is conjunctive, so the SQL is identical either
          // order) so `eb` here stays `ExpressionBuilder<DB, 'asset'>` — spaceVisibilityGate expects
          // `ExpressionBuilder<DB, keyof DB>`, which the post-join builder (extended with the
          // `album_members` subquery alias) no longer satisfies.
          .where((eb) => spaceVisibilityGate(eb))
          // Fork RBAC (Slice 1 / H1 defense-in-depth): the top-level `options.isTrashed` ternary
          // (line 253) flips `deletedAt IS NOT NULL` for the whole query, and the service-layer
          // guard (timeline.service.ts timeBucketChecks) already rejects isTrashed=true on an
          // album/space browse — but flat-gate here too so the album arm never surfaces a trashed
          // asset even if that guard is bypassed.
          .where('asset.deletedAt', 'is', null)
          // #764: contributions come in only when the service resolved albumSpaceIds (the viewer's
          // live member-spaces linking this album); album_user shares and departed members resolve none.
          .innerJoin(
            (eb) =>
              albumMembership(
                eb,
                [options.albumId!],
                options.albumSpaceIds?.length ? { spaceIds: options.albumSpaceIds } : undefined,
              ).as('album_members'),
            (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
          ),
      )
      .$if(!!options.isNotInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(!!options.isInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
      .$if(!!options.spaceId, (qb) =>
        qb.where((eb) =>
          // Fork RBAC (Fix A): the space-membership predicate is intersected with an
          // INDEPENDENT visibility gate — `own OR (Archive|Timeline)` — so an explicit
          // `visibility=HIDDEN`/`LOCKED` cannot surface OTHER members' Hidden/Locked in-space
          // assets. Mirrors searchAssetBuilder. `userIds` may be undefined (pure spaceId browse):
          // then the `own` term is absent and the gate is purely other-members-Archive/Timeline.
          eb.and([
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { spaceId: options.spaceId! },
                albumTimelineGate: 'space-tab',
              }),
            ),
            eb.or([
              ...(options.userIds ? [eb('asset.ownerId', '=', anyUuid(options.userIds))] : []),
              spaceVisibilityGate(eb),
            ]),
          ]),
        ),
      )
      .$if(!!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
      .$if(!!options.spacePersonIds?.length, (qb) =>
        hasSpacePeople(qb, options.spacePersonIds!).where((eb) =>
          // The space-person face narrowing must ALSO carry the independent visibility gate:
          // a space person's face on ANOTHER member's Hidden/Locked asset must not surface it
          // via an explicit `visibility=HIDDEN`. Caller's own rows follow the resolved visibility.
          eb.or([
            ...(options.userIds ? [eb('asset.ownerId', '=', anyUuid(options.userIds))] : []),
            spaceVisibilityGate(eb),
          ]),
        ),
      )
      .$if(!!options.identityIds?.length, (qb) => hasFaceIdentities(qb, options.identityIds!))
      .$if(!!options.withStacked, (qb) =>
        qb
          .leftJoin('stack', (join) =>
            join.onRef('stack.id', '=', 'asset.stackId').onRef('stack.primaryAssetId', '=', 'asset.id'),
          )
          // #763 §5.4 (E31): favorites are per (user, asset). Under an isFavorite:true filter every
          // row is already one of the caller's favorites, and a favorited stack CHILD must surface
          // standalone instead of staying collapsed behind a primary the caller may not have
          // favorited — so the primary-only collapse is skipped for favorite-filtered timelines.
          .$if(options.isFavorite !== true, (qb) =>
            qb.where((eb) => eb.or([eb('asset.stackId', 'is', null), eb(eb.table('stack'), 'is not', null)])),
          ),
      )
      // #1041: the caller's own id carries the own-timeline subtraction, never a partner's (see
      // ownerArmWithHiddenSubtraction). With timeline spaces, §3's rescue is the shared arm the
      // viewer-scope predicate ORs in; without them (E12: the subtraction still applies with
      // `withSharedSpaces: false`) there is no sibling arm, so the rescue is built inline from
      // `visibleSpaceIds`. immich-30739's person-scoped shared-album widening (keyed on `personIds`,
      // see `viewerId` above) is an independent admission path, so it ORs with the owner arm. The
      // shared arm's album gate is the viewer's own per-user hide ('personal'), not the space flag.
      .$if(!!options.userIds, (qb) =>
        qb.where((eb) => {
          const viewer = options.callerId ?? options.userIds![0];
          const ownerArm = ownerArmWithHiddenSubtraction(
            eb,
            options,
            options.timelineSpaceIds
              ? { kind: 'sibling-arm' }
              : { kind: 'inline', visibleSpaceIds: options.visibleSpaceIds ?? [], viewerId: viewer },
          );
          return ownedOrSharedWithViewer(
            eb,
            options.personIds?.length && viewerId ? eb.or([ownerArm, inSharedAlbum(eb, viewerId)]) : ownerArm,
            options.timelineSpaceIds && {
              scope: { spaceIds: options.timelineSpaceIds },
              albumTimelineGate: 'personal',
              viewerId: viewer,
            },
          );
        }),
      )
      .$if(options.isFavorite !== undefined, (qb) =>
        qb.where((eb) =>
          options.isFavorite
            ? favoriteExistsFor(eb, options.authUserId!)
            : eb.not(favoriteExistsFor(eb, options.authUserId!)),
        ),
      )
      .$if(!!options.assetType, (qb) => qb.where('asset.type', '=', options.assetType!))
      .$if(options.isDuplicate !== undefined, (qb) =>
        qb.where('asset.duplicateId', options.isDuplicate ? 'is not' : 'is', null),
      )
      .$if(!!options.tagIds?.length, (qb) => withAnyTagId(qb, options.tagIds!))
      .$if(!!options.originalFileName, (qb) =>
        qb.where(
          sql`f_unaccent(asset."originalFileName")`,
          'ilike',
          sql`'%' || f_unaccent(${escapeLikePattern(options.originalFileName!)}) || '%' escape '\\'`,
        ),
      )
      .$if(!!options.ocr, (qb) =>
        qb
          .innerJoin('ocr_search', 'asset.id', 'ocr_search.assetId')
          .where(() => sql`f_unaccent(ocr_search.text) %>> f_unaccent(${tokenizeForSearch(options.ocr!).join(' ')})`),
      )
      .$call((qb) => withAssetFilter(qb, options))
  );
}
