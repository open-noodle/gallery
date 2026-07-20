import { Injectable } from '@nestjs/common';
import {
  Expression,
  expressionBuilder,
  ExpressionBuilder,
  Insertable,
  Kysely,
  NotNull,
  Selectable,
  SelectQueryBuilder,
  ShallowDehydrateObject,
  sql,
  SqlBool,
  Transaction,
  Updateable,
  UpdateResult,
} from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { isEmpty, isUndefined, omitBy } from 'lodash';
import { InjectKysely } from 'nestjs-kysely';
import { lockableProperties, LockableProperty, Stack } from 'src/database';
import { Chunked, ChunkedArray, DummyValue, GenerateSql } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetFileType,
  AssetOrder,
  AssetOrderBy,
  AssetStatus,
  AssetType,
  AssetVisibility,
  CalendarHeatmapType,
  TimeBucketSize,
} from 'src/enum';
import { DB } from 'src/schema';
import { AssetAudioTable, AssetKeyframeTable, AssetVideoTable } from 'src/schema/tables/asset-av.table';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { AssetFileTable } from 'src/schema/tables/asset-file.table';
import { AssetJobStatusTable } from 'src/schema/tables/asset-job-status.table';
import { AssetMetadataTable } from 'src/schema/tables/asset-metadata.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import {
  anyUuid,
  asUuid,
  escapeLikePattern,
  hasFaceIdentities,
  hasPeople,
  hasSpacePeople,
  isStaleAssetForeignKeyConstraint,
  removeUndefinedKeys,
  tokenizeForSearch,
  truncatedDate,
  unnest,
  withAnyTagId,
  withDefaultVisibility,
  withEdits,
  withExif,
  withFaces,
  withFacesAndPeople,
  withFiles,
  withLibrary,
  withOwner,
  withSmartSearch,
  withTags,
} from 'src/utils/database';
import { favoriteExistsFor, favoriteExistsForOwner } from 'src/utils/favorite';
import { globToSqlPattern } from 'src/utils/misc';
import {
  hiddenFromOwnTimeline,
  spaceAssetPathBranches,
  spaceVisibilityGate,
  TimelineHiddenScope,
  timelineHiddenScopeIsEmpty,
  TimelineRescue,
} from 'src/utils/shared-space-album-scope';

export type AssetStats = Record<AssetType, number>;

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface AssetStatsOptions {
  isFavorite?: boolean;
  isTrashed?: boolean;
  visibility?: AssetVisibility;
}

interface LivePhotoSearchOptions {
  ownerId: string;
  libraryId?: string | null;
  livePhotoCID: string;
  otherAssetId: string;
  type: AssetType;
}

interface AssetBuilderOptions {
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  isTrashed?: boolean;
  isDuplicate?: boolean;
  albumId?: string;
  /**
   * #752 P0-2: live member-spaces of the viewer that currently link `albumId` — resolved by
   * timeline.service (getMemberSpaceIdsLinkingAlbum), NEVER for shared-link auth. When set, the
   * albumId arm unions member-gated album_space_asset contributions. Distinct from
   * timelineSpaceIds (home-timeline preference set, separate consumers — PR #778).
   */
  albumSpaceIds?: string[];
  spaceId?: string;
  tagId?: string;
  personId?: string;
  spacePersonId?: string;
  personIds?: string[];
  spacePersonIds?: string[];
  identityIds?: string[];
  forceEmptyResult?: boolean;
  tagIds?: string[];
  userIds?: string[];
  /**
   * Contributor filter: a plain AND on asset.ownerId. Deliberately separate from `userIds`,
   * which expresses timeline COMPOSITION and is OR-ed with `timelineSpaceIds` below. Routing a
   * contributor filter through `userIds` would WIDEN results inside a Space instead of narrowing.
   */
  ownerId?: string;
  timelineSpaceIds?: string[];
  withStacked?: boolean;
  withPartners?: boolean;
  withSharedSpaces?: boolean;
  exifInfo?: boolean;
  status?: AssetStatus;
  assetType?: AssetType;
  visibility?: AssetVisibility;
  withCoordinates?: boolean;
  bbox?: BoundingBox;
  city?: string;
  country?: string;
  make?: string;
  model?: string;
  lensModel?: string;
  state?: string;
  originalFileName?: string;
  description?: string;
  ocr?: string;
  rating?: number;
  takenAfter?: string;
  takenBefore?: string;
}

export interface TimeBucketOptions extends AssetBuilderOptions {
  order?: AssetOrder;
  orderBy?: AssetOrderBy;
  bucketSize?: TimeBucketSize;
  /** Consumed by getTimeBucketCovers only; ignored by getTimeBuckets. */
  timeBuckets?: string[];
  /**
   * #1041: the REQUESTING user's own id, distinct from `userIds` (which also carries partner ids
   * — timeline.service.ts pushes `getMyPartnerIds` into it). Used to attach the `hiddenScope`
   * subtraction ONLY to the caller's own-id arm — never to `userIds`, which would remove a
   * partner's photos based on the caller's flags. See §6.4 of the hide-from-timeline design doc.
   */
  callerId?: string;
  /**
   * #1041 §6.2: the caller's resolved "hidden from my own timeline" scope
   * (`SharedSpaceRepository.getTimelineHiddenScope`). Resolved ONCE per request by the service,
   * not per bucket. Applied only to the `callerId` arm (see `callerId` above); `undefined` — or a
   * scope with all four lists empty — means "nothing hidden", so the arm is emitted exactly as it
   * was before #1041, at no cost to callers who have hidden nothing.
   */
  hiddenScope?: TimelineHiddenScope;
  /**
   * #1041 §3: the spaces the caller still shows (`getSpaceIdsForTimeline`), used ONLY to build the
   * "another visible path re-admits this photo" rescue inside the subtraction. Distinct from
   * `timelineSpaceIds`, which additionally MERGES other members' assets into the result — this one
   * never widens the result set, so it is resolved even when `withSharedSpaces` is off.
   */
  visibleSpaceIds?: string[];
  /**
   * #763: the caller making the request — NOT `userIds` (the timeline *target*, which differs
   * from the caller on space/album browse paths). Required whenever `isFavorite` is set, so
   * `withTimeBucketAssetFilters` can resolve the `asset_favorite` overlay for the right user.
   */
  authUserId?: string;
}

export interface TimeBucketItem {
  timeBucket: string;
  count: number;
}

export interface TimeBucketCoverItem {
  timeBucket: string;
  representativeAssetId: string;
  representativeThumbhash: string | null;
  representativeRatio: number;
}

export interface YearMonthDay {
  day: number;
  month: number;
  year: number;
}

export interface MemoryAsset {
  id: string;
  localDateTime: Date;
}

export interface MemoryPersonDayCount {
  personId: string;
  day: Date;
  count: number;
}

export interface MemoryLocationCluster {
  country: string | null;
  city: string | null;
  assetCount: number;
  dayCount: number;
  firstDate: Date;
  lastDate: Date;
}

export interface MemoryPeriodAsset {
  id: string;
  localDateTime: Date;
  year: number;
  country: string | null;
  city: string | null;
  isFavorite: boolean;
  type: AssetType;
  duration: number | null;
}

export interface MemoryPeriodFace {
  assetId: string;
  localDateTime: Date;
  year: number;
  personId: string;
  personName: string;
}

export interface MemoryPeriodOptions {
  /** calendar months (1–12) to include */
  months: number[];
  /** optional day-of-month filter (for on-this-day style rules) */
  day?: number;
  /** when true, only favorited assets are returned */
  favoritesOnly?: boolean;
  /** when set, only assets of this type are returned */
  type?: AssetType;
  /** exclude assets taken after this instant (defensive guard against future-dated assets) */
  takenBefore: Date;
}

interface AssetExploreFieldOptions {
  maxFields: number;
  minAssetsPerField: number;
  /**
   * #867: spaces the viewer kept on their home timeline. When set, the city scan widens from
   * "assets I own" to "assets I own OR reach through one of these spaces", so the Explore places
   * strip matches what the location filter and the filtered timeline already show.
   */
  timelineSpaceIds?: string[];
}

interface AssetGetByChecksumOptions {
  ownerId: string;
  checksum: Buffer;
  libraryId?: string;
}

interface GetByIdsRelations {
  exifInfo?: boolean;
  faces?: { person?: boolean; withDeleted?: boolean };
  files?: boolean;
  library?: boolean;
  owner?: boolean;
  smartSearch?: boolean;
  stack?: { assets?: boolean };
  tags?: boolean;
  edits?: boolean;
}

type UpsertExifOptions = {
  exif: Insertable<AssetExifTable>;
  audio?: Insertable<AssetAudioTable>;
  video?: Insertable<AssetVideoTable>;
  keyframes?: Insertable<AssetKeyframeTable>;
  lockedPropertiesBehavior: 'override' | 'append' | 'skip';
};

const distinctLocked = <T extends LockableProperty[] | null>(eb: ExpressionBuilder<DB, 'asset_exif'>, columns: T) =>
  sql<T>`nullif(array(select distinct unnest(${eb.ref('asset_exif.lockedProperties')} || ${columns})), '{}')`;

const getBoundingCircle = (bbox: BoundingBox) => {
  const { west, south, east, north } = bbox;
  const eastUnwrapped = west <= east ? east : east + 360;
  const centerLongitude = (((west + eastUnwrapped) / 2 + 540) % 360) - 180;
  const centerLatitude = (south + north) / 2;
  const radius = sql<number>`greatest(
    earth_distance(ll_to_earth_public(${centerLatitude}, ${centerLongitude}), ll_to_earth_public(${south}, ${west})),
    earth_distance(ll_to_earth_public(${centerLatitude}, ${centerLongitude}), ll_to_earth_public(${south}, ${east})),
    earth_distance(ll_to_earth_public(${centerLatitude}, ${centerLongitude}), ll_to_earth_public(${north}, ${west})),
    earth_distance(ll_to_earth_public(${centerLatitude}, ${centerLongitude}), ll_to_earth_public(${north}, ${east}))
  )`;

  return { centerLatitude, centerLongitude, radius };
};

const withBoundingBox = <T>(qb: SelectQueryBuilder<DB, 'asset' | 'asset_exif', T>, bbox: BoundingBox) => {
  const { west, south, east, north } = bbox;
  const withLatitude = qb.where('asset_exif.latitude', '>=', south).where('asset_exif.latitude', '<=', north);

  if (west <= east) {
    return withLatitude.where('asset_exif.longitude', '>=', west).where('asset_exif.longitude', '<=', east);
  }

  return withLatitude.where((eb) =>
    eb.or([eb('asset_exif.longitude', '>=', west), eb('asset_exif.longitude', '<=', east)]),
  );
};

const formatUtcDate = (date: Date) => date.toISOString().slice(0, 10);

// Advance a YYYY-MM-DD bucket-start date by one bucket interval (the exclusive
// upper bound of the requested range).
const addBucketInterval = (bucketStart: string, bucketSize: TimeBucketSize): string => {
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
): SelectQueryBuilder<DB, 'asset', O> {
  return (
    qb
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(!!options.isTrashed, (qb) => qb.where('asset.status', '!=', AssetStatus.Deleted))
      .where('asset.deletedAt', options.isTrashed ? 'is not' : 'is', null)
      .$if(
        !!options.bbox ||
          !!options.city ||
          !!options.country ||
          !!options.state ||
          !!options.make ||
          !!options.model ||
          !!options.lensModel ||
          !!options.description ||
          options.rating !== undefined,
        (qb) => {
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

          if (options.city) {
            q = q.where('asset_exif.city', '=', options.city) as any;
          }
          if (options.country) {
            q = q.where('asset_exif.country', '=', options.country) as any;
          }
          if (options.make) {
            q = q.where('asset_exif.make', '=', options.make) as any;
          }
          if (options.model) {
            q = q.where('asset_exif.model', '=', options.model) as any;
          }
          if (options.lensModel) {
            q = q.where('asset_exif.lensModel', '=', options.lensModel) as any;
          }
          if (options.state) {
            q = q.where('asset_exif.state', '=', options.state) as any;
          }
          if (options.rating !== undefined) {
            q = q.where('asset_exif.rating', '>=', options.rating) as any;
          }
          if (options.description) {
            q = q.where(
              sql`f_unaccent(asset_exif.description)`,
              'ilike',
              sql`'%' || f_unaccent(${escapeLikePattern(options.description)}) || '%' escape '\\'`,
            ) as any;
          }

          return q;
        },
      )
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
          .innerJoin(
            (eb) => {
              // #764/#752 P0-2: album content = the owner's album_asset rows ∪ member-gated
              // cross-owner contributions. The contributed arm is included ONLY when the service
              // resolved albumSpaceIds (live member-spaces linking this album) — album_user shares,
              // shared links and departed members resolve to none, so a blind-union leak is
              // impossible. UNION (not ALL) dedupes a P1-6 coexistence-window pair.
              const ownerRows = eb
                .selectFrom('album_asset')
                .select('album_asset.assetId as assetId')
                .where('album_asset.albumId', '=', asUuid(options.albumId!));
              return (
                options.albumSpaceIds?.length
                  ? ownerRows.union(
                      eb
                        .selectFrom('album_space_asset')
                        .select('album_space_asset.assetId as assetId')
                        .where('album_space_asset.albumId', '=', asUuid(options.albumId!))
                        .where('album_space_asset.spaceId', '=', anyUuid(options.albumSpaceIds!)),
                    )
                  : ownerRows
              ).as('album_members');
            },
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
      // #1041 §4: the `!timelineSpaceIds` branch — userIds set, shared spaces off. E12 requires the
      // subtraction still applies here even with `withSharedSpaces: false`; easy to miss because this
      // branch never touches a space table. There is no sibling visible-path arm here, so §3's
      // rescue has to be built INTO the predicate (E12b/E12c) — that is what `visibleSpaceIds` is
      // for, and it is resolved independently of `withSharedSpaces`.
      .$if(!!options.userIds && !options.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          ownerArmWithHiddenSubtraction(eb, options, {
            kind: 'inline',
            visibleSpaceIds: options.visibleSpaceIds ?? [],
            viewerId: options.callerId ?? options.userIds![0],
          }),
        ),
      )
      .$if(!!options.userIds && !!options.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.or([
            // Caller's own (and partner) rows follow the resolved top-level visibility; the
            // caller's own id additionally carries the #1041 subtraction (never the partner's — see
            // ownerArmWithHiddenSubtraction). §3's rescue is the sibling arm immediately below —
            // it ORs the same `spaceAssetPathBranches` over the same visible spaces — so the
            // subtraction here must NOT emit its own copy.
            ownerArmWithHiddenSubtraction(eb, options, { kind: 'sibling-arm' }),
            // Fork RBAC (Fix A): other members' rows are constrained to Archive+Timeline via the
            // INDEPENDENT gate, so an explicit `visibility=HIDDEN`/`LOCKED` can't surface their
            // Hidden/Locked in-space assets. Mirrors searchAssetBuilder's timelineSpaceIds arm.
            //
            // #1041 §3: this is the personal-timeline "V" (visible-path) term, so its album arm
            // gates on the VIEWER's own per-user hide ('personal'), not the shared showInTimeline
            // flag — for both another member's assets reaching the viewer via this space, and the
            // viewer's own assets (which agree with the ownerArm subtraction above, since both read
            // the same shared_space_album_hidden rows).
            eb.and([
              spaceVisibilityGate(eb),
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceIds: options.timelineSpaceIds! },
                  albumTimelineGate: 'personal',
                  viewerId: options.callerId ?? options.userIds![0],
                }),
              ),
            ]),
          ]),
        ),
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
      .$if(!!options.takenAfter, (qb) => qb.where('asset.localDateTime', '>=', new Date(options.takenAfter!)))
      .$if(!!options.takenBefore, (qb) => qb.where('asset.localDateTime', '<=', new Date(options.takenBefore!)))
  );
}

@Injectable()
export class AssetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      {
        exif: { dateTimeOriginal: DummyValue.DATE, lockedProperties: ['dateTimeOriginal'] },
        lockedPropertiesBehavior: 'append',
      },
    ],
  })
  async upsertExif({ exif, audio, video, keyframes, lockedPropertiesBehavior }: UpsertExifOptions): Promise<void> {
    let query = this.db;
    if (audio) {
      (query as any) = this.db.with('audio', (qb) =>
        qb
          .insertInto('asset_audio')
          .values(audio)
          .onConflict((oc) =>
            oc.column('assetId').doUpdateSet(({ ref }) => ({
              bitrate: ref('asset_audio.bitrate'),
              index: ref('asset_audio.index'),
              profile: ref('asset_audio.profile'),
              codecName: ref('asset_audio.codecName'),
            })),
          ),
      );
    }

    if (video) {
      (query as any) = query.with('video', (qb) =>
        qb
          .insertInto('asset_video')
          .values(video)
          .onConflict((oc) =>
            oc.column('assetId').doUpdateSet(({ ref }) => ({
              bitrate: ref('asset_video.bitrate'),
              timeBase: ref('asset_video.timeBase'),
              index: ref('asset_video.index'),
              profile: ref('asset_video.profile'),
              level: ref('asset_video.level'),
              colorPrimaries: ref('asset_video.colorPrimaries'),
              colorTransfer: ref('asset_video.colorTransfer'),
              colorMatrix: ref('asset_video.colorMatrix'),
              dvProfile: ref('asset_video.dvProfile'),
              dvLevel: ref('asset_video.dvLevel'),
              dvBlSignalCompatibilityId: ref('asset_video.dvBlSignalCompatibilityId'),
              codecName: ref('asset_video.codecName'),
              formatName: ref('asset_video.formatName'),
              formatLongName: ref('asset_video.formatLongName'),
              pixelFormat: ref('asset_video.pixelFormat'),
            })),
          ),
      );
    }

    if (keyframes) {
      (query as any) = query.with('keyframe', (qb) =>
        qb
          .insertInto('asset_keyframe')
          .values(keyframes)
          .onConflict((oc) =>
            oc.column('assetId').doUpdateSet(({ ref }) => ({
              pts: ref('asset_keyframe.pts'),
              accDuration: ref('asset_keyframe.accDuration'),
              ownDuration: ref('asset_keyframe.ownDuration'),
              totalDuration: ref('asset_keyframe.totalDuration'),
              packetCount: ref('asset_keyframe.packetCount'),
              outputFrames: ref('asset_keyframe.outputFrames'),
            })),
          ),
      );
    }

    await query
      .insertInto('asset_exif')
      .values(exif)
      .onConflict((oc) =>
        oc.column('assetId').doUpdateSet((eb) => {
          const updateLocked = <T extends keyof AssetExifTable>(col: T) => eb.ref(`excluded.${col}`);
          const skipLocked = <T extends keyof AssetExifTable>(col: T) =>
            eb
              .case()
              .when(sql`${col}`, '=', eb.fn.any('asset_exif.lockedProperties'))
              .then(eb.ref(`asset_exif.${col}`))
              .else(eb.ref(`excluded.${col}`))
              .end();
          const ref = lockedPropertiesBehavior === 'skip' ? skipLocked : updateLocked;
          return {
            ...removeUndefinedKeys(
              {
                description: ref('description'),
                exifImageWidth: ref('exifImageWidth'),
                exifImageHeight: ref('exifImageHeight'),
                fileSizeInByte: ref('fileSizeInByte'),
                orientation: ref('orientation'),
                dateTimeOriginal: ref('dateTimeOriginal'),
                modifyDate: ref('modifyDate'),
                timeZone: ref('timeZone'),
                latitude: ref('latitude'),
                longitude: ref('longitude'),
                projectionType: ref('projectionType'),
                city: ref('city'),
                livePhotoCID: ref('livePhotoCID'),
                autoStackId: ref('autoStackId'),
                state: ref('state'),
                country: ref('country'),
                make: ref('make'),
                model: ref('model'),
                lensModel: ref('lensModel'),
                fNumber: ref('fNumber'),
                focalLength: ref('focalLength'),
                iso: ref('iso'),
                exposureTime: ref('exposureTime'),
                profileDescription: ref('profileDescription'),
                colorspace: ref('colorspace'),
                bitsPerSample: ref('bitsPerSample'),
                rating: ref('rating'),
                fps: ref('fps'),
                tags: ref('tags'),
                lockedProperties:
                  lockedPropertiesBehavior === 'append'
                    ? distinctLocked(eb, exif.lockedProperties ?? null)
                    : ref('lockedProperties'),
              },
              exif,
            ),
          };
        }),
      )
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID], { model: DummyValue.STRING }] })
  @Chunked()
  async updateAllExif(ids: string[], options: Updateable<AssetExifTable>): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const lockedColumns = lockableProperties.filter((property) => property in options);
    await this.db
      .updateTable('asset_exif')
      .set((eb) => ({
        ...options,
        lockedProperties: distinctLocked(eb, lockedColumns),
      }))
      .where('assetId', 'in', ids)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.NUMBER, DummyValue.STRING] })
  @Chunked()
  updateDateTimeOriginal(ids: string[], delta?: number, timeZone?: string) {
    return this.db
      .updateTable('asset_exif')
      .set((eb) => ({
        dateTimeOriginal: sql`"dateTimeOriginal" + ${(delta ?? 0) + ' minute'}::interval`,
        timeZone,
        lockedProperties: distinctLocked(eb, ['dateTimeOriginal', 'timeZone']),
      }))
      .where('assetId', 'in', ids)
      .returning(['assetId', 'dateTimeOriginal', 'timeZone'])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, ['description']] })
  unlockProperties(assetId: string, properties: LockableProperty[]) {
    return this.db
      .updateTable('asset_exif')
      .where('assetId', '=', assetId)
      .set((eb) => ({
        lockedProperties: sql`nullif(array(select distinct property from unnest(${eb.ref('asset_exif.lockedProperties')}) property where not property = any(${properties})), '{}')`,
      }))
      .execute();
  }

  async upsertJobStatus(...jobStatus: Insertable<AssetJobStatusTable>[]): Promise<void> {
    if (jobStatus.length === 0) {
      return;
    }

    type JobStatusColumns = Exclude<keyof AssetJobStatusTable, 'assetId'>;
    const values = jobStatus.map((row) => ({ ...row, assetId: asUuid(row.assetId) }));
    try {
      await this.db
        .insertInto('asset_job_status')
        .values(values)
        .onConflict((oc) =>
          oc.column('assetId').doUpdateSet((eb) =>
            removeUndefinedKeys(
              {
                duplicatesDetectedAt: eb.ref('excluded.duplicatesDetectedAt'),
                facesRecognizedAt: eb.ref('excluded.facesRecognizedAt'),
                metadataExtractedAt: eb.ref('excluded.metadataExtractedAt'),
                ocrAt: eb.ref('excluded.ocrAt'),
                petsDetectedAt: eb.ref('excluded.petsDetectedAt'),
                classifiedAt: eb.ref('excluded.classifiedAt'),
              } satisfies Record<JobStatusColumns, unknown>,
              values[0],
            ),
          ),
        )
        .execute();
    } catch (error) {
      if (isStaleAssetForeignKeyConstraint(error)) {
        const existingRows = await this.filterRowsForExistingAssets(jobStatus);
        if (existingRows.length > 0 && existingRows.length < jobStatus.length) {
          await this.upsertJobStatus(...existingRows);
        }

        return;
      }

      throw error;
    }
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMetadata(assetId: string) {
    return this.db
      .selectFrom('asset_metadata')
      .select(['key', 'value', 'updatedAt'])
      .where('assetId', '=', assetId)
      .execute();
  }

  upsertMetadata(id: string, items: Array<{ key: string; value: Record<string, unknown> }>) {
    if (items.length === 0) {
      return [];
    }

    return this.db
      .insertInto('asset_metadata')
      .values(items.map((item) => ({ assetId: id, ...item })))
      .onConflict((oc) =>
        oc
          .columns(['assetId', 'key'])
          .doUpdateSet((eb) => ({ key: eb.ref('excluded.key'), value: eb.ref('excluded.value') })),
      )
      .returning(['key', 'value', 'updatedAt'])
      .execute();
  }

  upsertBulkMetadata(items: Insertable<AssetMetadataTable>[]) {
    return this.db
      .insertInto('asset_metadata')
      .values(items)
      .onConflict((oc) =>
        oc
          .columns(['assetId', 'key'])
          .doUpdateSet((eb) => ({ key: eb.ref('excluded.key'), value: eb.ref('excluded.value') })),
      )
      .returning(['assetId', 'key', 'value', 'updatedAt'])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getMetadataByKey(assetId: string, key: string) {
    return this.db
      .selectFrom('asset_metadata')
      .select(['key', 'value', 'updatedAt'])
      .where('assetId', '=', assetId)
      .where('key', '=', key)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async deleteMetadataByKey(id: string, key: string) {
    await this.db.deleteFrom('asset_metadata').where('assetId', '=', id).where('key', '=', key).execute();
  }

  @GenerateSql({ params: [[{ assetId: DummyValue.UUID, key: DummyValue.STRING }]] })
  async deleteBulkMetadata(items: Array<{ assetId: string; key: string }>) {
    if (items.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (tx) => {
      for (const { assetId, key } of items) {
        await tx.deleteFrom('asset_metadata').where('assetId', '=', assetId).where('key', '=', key).execute();
      }
    });
  }

  create(asset: Insertable<AssetTable>) {
    return this.db.insertInto('asset').values(asset).returningAll().executeTakeFirstOrThrow();
  }

  @ChunkedArray({ chunkSize: 4000 })
  async createAll(assets: Insertable<AssetTable>[]) {
    const ids = await this.db.insertInto('asset').values(assets).returning('id').execute();
    return ids.map(({ id }) => id);
  }

  // #1041: deliberately NOT subtracted here. Filtering candidates at GENERATION time is sticky —
  // the asset is left out of the `memory_asset` rows for good, so a later un-hide cannot bring it
  // back and the photo is lost from that memory permanently. The read paths
  // (`MemoryRepository.search` / `searchAccessible` / `getByIdBuilder`) apply the subtraction at
  // DISPLAY time instead, which is reversible and is the only place that has the viewer's scope.
  @GenerateSql({ params: [DummyValue.UUID, { year: 2000, day: 1, month: 1 }] })
  getByDayOfYear(ownerIds: string[], { year, day, month }: YearMonthDay) {
    return this.db
      .with('res', (qb) =>
        qb
          .with('today', (qb) =>
            qb
              .selectFrom((eb) =>
                eb
                  .fn('generate_series', [
                    sql`(select date_part('year', min(("localDateTime" at time zone 'UTC')::date))::int from asset)`,
                    sql`${year - 1}`,
                  ])
                  .as('year'),
              )
              .select((eb) => eb.fn('make_date', [sql`year::int`, sql`${month}::int`, sql`${day}::int`]).as('date')),
          )
          .selectFrom('today')
          .innerJoinLateral(
            (qb) =>
              qb
                .selectFrom('asset')
                .select(['asset.id', 'asset.localDateTime'])
                .innerJoin('asset_job_status', 'asset.id', 'asset_job_status.assetId')
                .where(sql`(asset."localDateTime" at time zone 'UTC')::date`, '=', sql`today.date`)
                .where('asset.ownerId', '=', anyUuid(ownerIds))
                .where('asset.visibility', '=', AssetVisibility.Timeline)
                .where((eb) =>
                  eb.exists((qb) =>
                    qb
                      .selectFrom('asset_file')
                      .whereRef('assetId', '=', 'asset.id')
                      .where('asset_file.type', '=', AssetFileType.Preview),
                  ),
                )
                .where('asset.deletedAt', 'is', null)
                .orderBy(sql`(asset."localDateTime" at time zone 'UTC')::date`, 'desc')
                .limit(20)
                .as('a'),
            (join) => join.onTrue(),
          )
          .selectAll('a'),
      )
      .selectFrom('res')
      .select(sql<number>`date_part('year', ("localDateTime" at time zone 'UTC')::date)::int`.as('year'))
      .select((eb) => eb.fn.jsonAgg(eb.table('res')).as('assets'))
      .groupBy(sql`("localDateTime" at time zone 'UTC')::date`)
      .orderBy(sql`("localDateTime" at time zone 'UTC')::date`, 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE] })
  getMemoryAssetsForPerson(ownerId: string, personId: string, takenBefore: Date): Promise<MemoryAsset[]> {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset_face.personId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .distinctOn(['asset.id'])
      .orderBy('asset.id')
      .orderBy('asset.localDateTime', 'desc')
      .limit(60)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { takenAfter: DummyValue.DATE, takenBefore: DummyValue.DATE }] })
  getMemoryLocationClusters(
    ownerId: string,
    { takenAfter, takenBefore }: { takenAfter: Date; takenBefore: Date },
  ): Promise<MemoryLocationCluster[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset_exif.country as country',
        'asset_exif.city as city',
        sql<number>`count(*)::int`.as('assetCount'),
        sql<number>`count(distinct (asset."localDateTime" at time zone 'UTC')::date)::int`.as('dayCount'),
        sql<Date>`min(asset."localDateTime")`.as('firstDate'),
        sql<Date>`max(asset."localDateTime")`.as('lastDate'),
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_exif.country', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy(['asset_exif.country', 'asset_exif.city'])
      .orderBy('assetCount', 'desc')
      .execute();
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      {
        country: DummyValue.STRING,
        city: DummyValue.STRING,
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
      },
    ],
  })
  getMemoryAssetsForLocation(
    ownerId: string,
    {
      country,
      city,
      takenAfter,
      takenBefore,
    }: { country: string; city: string | null; takenAfter: Date; takenBefore: Date },
  ): Promise<MemoryAsset[]> {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', takenAfter)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_exif.country', '=', country)
      .$if(city !== null, (qb) => qb.where('asset_exif.city', '=', city))
      .$if(city === null, (qb) => qb.where('asset_exif.city', 'is', null))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { months: [7], takenBefore: DummyValue.DATE }] })
  getMemoryAssetsForPeriod(
    ownerId: string,
    { months, day, favoritesOnly, type, takenBefore }: MemoryPeriodOptions,
  ): Promise<MemoryPeriodAsset[]> {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.localDateTime',
        'asset.isFavorite',
        'asset.type',
        'asset.duration',
        'asset_exif.country as country',
        'asset_exif.city as city',
      ])
      .select(sql<number>`extract(year from (asset."localDateTime" at time zone 'UTC'))::int`.as('year'))
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where(sql<number>`extract(month from (asset."localDateTime" at time zone 'UTC'))::int`, 'in', months)
      .$if(day !== undefined, (qb) =>
        qb.where(sql<number>`extract(day from (asset."localDateTime" at time zone 'UTC'))::int`, '=', day!),
      )
      .$if(favoritesOnly === true, (qb) => qb.where('asset.isFavorite', '=', true))
      .$if(type !== undefined, (qb) => qb.where('asset.type', '=', type!))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { months: [6], takenBefore: DummyValue.DATE }] })
  getMemoryFacesForPeriod(
    ownerId: string,
    { months, takenBefore }: { months: number[]; takenBefore: Date },
  ): Promise<MemoryPeriodFace[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .innerJoin('person', 'person.id', 'asset_face.personId')
      .select(['asset.id as assetId', 'asset.localDateTime', 'person.id as personId', 'person.name as personName'])
      .select(sql<number>`extract(year from (asset."localDateTime" at time zone 'UTC'))::int`.as('year'))
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where(sql<number>`extract(month from (asset."localDateTime" at time zone 'UTC'))::int`, 'in', months)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('person.ownerId', '=', ownerId)
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  /**
   * One row per (person, calendar day) among `personIds`, with the distinct asset count that day.
   * Predicates mirror `getMemoryFacesForPeriod` — Timeline visibility, not deleted, previewable —
   * so a person's density is never skewed by archived or preview-less assets.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID], { takenBefore: DummyValue.DATE }] })
  getMemoryPersonDailyCounts(
    ownerId: string,
    personIds: string[],
    { takenBefore }: { takenBefore: Date },
  ): Promise<MemoryPersonDayCount[]> {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset_face.personId')
      .select(sql<Date>`date_trunc('day', asset."localDateTime" at time zone 'UTC')`.as('day'))
      .select((eb) =>
        eb.fn
          .count(eb.fn('distinct', ['asset.id']))
          .$castTo<number>()
          .as('count'),
      )
      .$narrowType<{ personId: NotNull }>()
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '<=', takenBefore)
      .where('asset_face.personId', 'in', personIds)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy(['asset_face.personId', 'day'])
      .orderBy('asset_face.personId')
      .orderBy('day', 'asc')
      .execute();
  }

  /**
   * Assets of one person inside an inclusive `[from, to]` day window (`to` is a calendar day, so
   * the upper bound is exclusive of the following day). Bounded by a ≤14-day window — no `LIMIT`.
   * Do not copy `getMemoryAssetsForPerson`'s `ORDER BY asset.id … LIMIT 60` — that returns the 60
   * lowest UUIDs, an arbitrary sample, not the most recent assets.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE }] })
  getMemoryAssetsForPersonWindow(
    ownerId: string,
    personId: string,
    { from, to }: { from: Date; to: Date },
  ): Promise<MemoryAsset[]> {
    // `to` is the chapter's last day at UTC midnight, so the upper bound must be exclusive of the
    // following day — otherwise assets later on the final day (after `to`'s midnight) are dropped.
    const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.localDateTime'])
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .where('asset.ownerId', '=', ownerId)
      .where('asset_face.personId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where('asset.localDateTime', '>=', from)
      .where('asset.localDateTime', '<', toExclusive)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .distinctOn(['asset.id'])
      .orderBy('asset.id')
      .orderBy('asset.localDateTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, 1000, DummyValue.UUID] })
  getOwnedManifestAssets(ownerId: string, limit: number, cursor?: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.type',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
      ])
      .select('asset_exif.fileSizeInByte as size')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .where('asset.libraryId', 'is', null)
      .where('asset.isExternal', '=', false)
      .$if(!!cursor, (qb) => qb.where('asset.id', '>', asUuid(cursor!)))
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }

  // #763: no isFavoriteForUser projection here — the only caller (asset.service.ts updateAll, via
  // priorAssets) reads `visibility` only, to snapshot the pre-write value for the #757 transition
  // helper. The rows never reach mapAsset, so there is nothing to project.
  @GenerateSql({ params: [[DummyValue.UUID]] })
  @ChunkedArray()
  getByIds(ids: string[]) {
    return this.db.selectFrom('asset').selectAll('asset').where('asset.id', '=', anyUuid(ids)).execute();
  }

  @GenerateSql(
    { params: [[DummyValue.UUID]] },
    { name: 'with authUserId', params: [[DummyValue.UUID], DummyValue.UUID] },
  )
  @ChunkedArray()
  getByIdsWithAllRelationsButStacks(ids: string[], authUserId?: string) {
    return (
      this.db
        .selectFrom('asset')
        .selectAll('asset')
        .select(withFacesAndPeople)
        .select(withTags)
        .$call(withExif)
        // #763: `isFavorite` is resolved from the OWNER's overlay row (favoriteExistsForOwner), NOT
        // the raw asset."isFavorite" column selectAll('asset') would otherwise surface — see the
        // matching comment on getById above for the full rationale (same owner-semantics decision;
        // job.service.ts's AssetEditReadyV2/AssetUploadReadyV2 payloads are this method's only
        // direct `.isFavorite` reader, and always send to the asset's OWNER).
        .select((eb) => favoriteExistsForOwner(eb).as('isFavorite'))
        // #763: authUserId is optional and deliberately omitted by job.service.ts (background job)
        // and notification.service.ts (synthetic partial auth) — see the comments at their mapAsset
        // call sites. Only search.service.ts's getExploreData passes it (real caller identity).
        .$if(!!authUserId, (qb) => qb.select((eb) => favoriteExistsFor(eb, authUserId!).as('isFavoriteForUser')))
        .where('asset.id', '=', anyUuid(ids))
        .execute()
    );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteAll(ownerId: string): Promise<void> {
    await this.db.deleteFrom('asset').where('ownerId', '=', ownerId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByLibraryIdWithFaces(libraryId: string, limit = 1000, offset = 0) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset.id')
      .where('asset.libraryId', '=', libraryId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .groupBy('asset.id')
      .orderBy('asset.id')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, 1000, 0] })
  getByAlbumIdWithFaces(albumId: string, spaceId: string, limit = 1000, offset = 0) {
    return this.db
      .selectFrom('asset')
      .innerJoin(
        (eb) => {
          // #752 P1-7 / D1-b: link-time face sync must also page retained contributions on
          // re-link — album_asset alone would skip faces cleaned up while the album was unlinked.
          // The contributed arm is correlated to the syncing space: contributions are reachable
          // only through their tether space (mirrors contributionVisibleToMember's albumId+spaceId
          // gate), so an S2 link-sync never pages an S1-tethered contribution into S2's people.
          return eb
            .selectFrom('album_asset')
            .select('album_asset.assetId as assetId')
            .where('album_asset.albumId', '=', asUuid(albumId))
            .union(
              eb
                .selectFrom('album_space_asset')
                .select('album_space_asset.assetId as assetId')
                .where('album_space_asset.albumId', '=', asUuid(albumId))
                .where('album_space_asset.spaceId', '=', asUuid(spaceId)),
            )
            .as('album_members');
        },
        (join) => join.onRef('album_members.assetId', '=', 'asset.id'),
      )
      .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
      .select('asset.id')
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .groupBy('asset.id')
      .orderBy('asset.id')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getByLibraryIdAndOriginalPath(libraryId: string, originalPath: string) {
    return this.db
      .selectFrom('asset')
      .selectAll('asset')
      .where('libraryId', '=', asUuid(libraryId))
      .where('originalPath', '=', originalPath)
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLivePhotoCount(motionId: string): Promise<number> {
    const [{ count }] = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('livePhotoVideoId', '=', asUuid(motionId))
      .execute();
    return count;
  }

  @GenerateSql()
  getFileSamples() {
    return this.db.selectFrom('asset_file').select(['assetId', 'path']).limit(sql.lit(3)).execute();
  }

  // #763 slice 7: `authUserId` is the ACTING user (not necessarily the asset's owner) — the
  // caller decides whose favorite carries over to the copy. See asset.service.ts `copy`.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getForCopy(id: string, authUserId: string) {
    return this.db
      .selectFrom('asset')
      .select(['id', 'stackId', 'originalPath'])
      .select((eb) => favoriteExistsFor(eb, authUserId).as('isFavorite'))
      .select(withFiles)
      .where('id', '=', asUuid(id))
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql(
    { params: [DummyValue.UUID] },
    { name: 'with authUserId', params: [DummyValue.UUID, {}, DummyValue.UUID] },
  )
  getById(
    id: string,
    { exifInfo, faces, files, library, owner, smartSearch, stack, tags, edits }: GetByIdsRelations = {},
    // #763: the CALLER's id — used only to project `isFavoriteForUser` (favoriteExistsFor).
    // Optional and omitted by every non-mapAsset-facing caller (asset.util.ts motion lookups,
    // background jobs, person.service.ts createFace, classification.service.ts), which never
    // reach mapAsset and so have no per-user value to resolve.
    authUserId?: string,
  ) {
    return (
      this.db
        .selectFrom('asset')
        .selectAll('asset')
        // #763: `isFavorite` is resolved from the OWNER's overlay row (favoriteExistsForOwner), NOT
        // the raw asset."isFavorite" column selectAll('asset') would otherwise surface — that column
        // is a frozen legacy value the overlay write path no longer updates (dropped outright in
        // slice 3). Projected unconditionally (not gated on authUserId, unlike isFavoriteForUser
        // below) because every consumer that reads `.isFavorite` directly off this method's result
        // (job.service.ts's AssetEditReadyV2/AssetUploadReadyV2 payloads) sends its event to the
        // asset's OWNER, so owner semantics is always correct here — see favoriteExistsForOwner's doc
        // comment. mapAsset-facing callers (asset.service.ts `get`/`update`) never read this field;
        // they use isFavoriteForUser instead.
        .select((eb) => favoriteExistsForOwner(eb).as('isFavorite'))
        .where('asset.id', '=', asUuid(id))
        .$if(!!exifInfo, withExif)
        .$if(!!faces, (qb) =>
          qb.select(faces?.person ? withFacesAndPeople : withFaces).$narrowType<{ faces: NotNull }>(),
        )
        .$if(!!library, (qb) => qb.select(withLibrary))
        .$if(!!owner, (qb) => qb.select(withOwner))
        .$if(!!smartSearch, withSmartSearch)
        .$if(!!stack, (qb) =>
          qb
            .leftJoin('stack', 'stack.id', 'asset.stackId')
            .$if(!stack!.assets, (qb) =>
              qb.select((eb) => eb.fn.toJson(eb.table('stack')).$castTo<Stack | null>().as('stack')),
            )
            .$if(!!stack!.assets, (qb) =>
              qb
                .leftJoinLateral(
                  (eb) =>
                    eb
                      .selectFrom('asset as stacked')
                      .selectAll('stack')
                      .select((eb) =>
                        eb
                          .fn<ShallowDehydrateObject<Selectable<AssetTable>>>('array_agg', [eb.table('stacked')])
                          .as('assets'),
                      )
                      .whereRef('stacked.stackId', '=', 'stack.id')
                      .whereRef('stacked.id', '!=', 'stack.primaryAssetId')
                      .where('stacked.deletedAt', 'is', null)
                      .where('stacked.visibility', '=', AssetVisibility.Timeline)
                      .groupBy('stack.id')
                      .as('stacked_assets'),
                  (join) => join.on('stack.id', 'is not', null),
                )
                .select((eb) => eb.fn.toJson(eb.table('stacked_assets')).as('stack')),
            ),
        )
        .$if(!!files, (qb) => qb.select(withFiles))
        .$if(!!tags, (qb) => qb.select(withTags))
        .$if(!!edits, (qb) => qb.select(withEdits))
        .$if(!!authUserId, (qb) => qb.select((eb) => favoriteExistsFor(eb, authUserId!).as('isFavoriteForUser')))
        .limit(1)
        .executeTakeFirst()
    );
  }

  @GenerateSql({ params: [[DummyValue.UUID], {}] })
  @Chunked()
  async updateAll(ids: string[], options: Updateable<AssetTable>): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.updateTable('asset').set(options).where('id', '=', anyUuid(ids)).execute();
  }

  async updateByLibraryId(libraryId: string, options: Updateable<AssetTable>): Promise<void> {
    await this.db.updateTable('asset').set(options).where('libraryId', '=', asUuid(libraryId)).execute();
  }

  // #763: authUserId is the CALLER's id, used only to project `isFavoriteForUser` onto the
  // returned row. Optional and omitted by the many write-only callers (thumbnail/duration/stack
  // bookkeeping etc.) whose result is never fed to mapAsset — only asset.service.ts's `update`
  // (the PUT /assets/:id response) passes it.
  async update(asset: Updateable<AssetTable> & { id: string }, authUserId?: string) {
    const value = omitBy(asset, isUndefined);
    delete value.id;
    if (!isEmpty(value)) {
      return this.db
        .with('asset', (qb) => qb.updateTable('asset').set(asset).where('id', '=', asUuid(asset.id)).returningAll())
        .selectFrom('asset')
        .selectAll('asset')
        .$call(withExif)
        .$call((qb) => qb.select(withFacesAndPeople))
        .$call((qb) => qb.select(withEdits))
        .$if(!!authUserId, (qb) =>
          qb.select((eb) =>
            // The `.with('asset', ...)` CTE above shadows the real `asset` table with the same
            // name, so `eb` here is scoped to `DB & { asset: <cte-shape> }` rather than the plain
            // `ExpressionBuilder<DB, keyof DB>` favoriteExistsFor expects. Safe cast: at runtime
            // `favoriteExistsFor` only emits `sql.ref('asset.id')`, which resolves to the CTE's
            // `id` column identically to the base table (same mechanism as getTimeBucket above).
            favoriteExistsFor(eb as unknown as ExpressionBuilder<DB, keyof DB>, authUserId!).as('isFavoriteForUser'),
          ),
        )
        .executeTakeFirst();
    }

    return this.getById(asset.id, { exifInfo: true, faces: { person: true }, edits: true }, authUserId);
  }

  async remove(asset: { id: string }): Promise<void> {
    await this.db.deleteFrom('asset').where('id', '=', asUuid(asset.id)).execute();
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, libraryId: DummyValue.UUID, checksum: DummyValue.BUFFER }] })
  getByChecksum({ ownerId, libraryId, checksum }: AssetGetByChecksumOptions) {
    return this.db
      .selectFrom('asset')
      .selectAll('asset')
      .where('ownerId', '=', asUuid(ownerId))
      .where('checksum', '=', checksum)
      .$call((qb) => (libraryId ? qb.where('libraryId', '=', asUuid(libraryId)) : qb.where('libraryId', 'is', null)))
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.BUFFER]] })
  getByChecksums(userId: string, checksums: Buffer[]) {
    if (checksums.length === 0) {
      return Promise.resolve([]);
    }

    return this._getByChecksumsWithTombstones(userId, checksums);
  }

  private async _getByChecksumsWithTombstones(userId: string, checksums: Buffer[]) {
    const [assetResults, tombstoneResults] = await Promise.all([
      this.db
        .selectFrom('asset')
        .select(['id', 'checksum', 'deletedAt'])
        .where('ownerId', '=', asUuid(userId))
        .where('checksum', 'in', checksums)
        .execute(),
      this.db
        .selectFrom('asset_duplicate_checksum')
        .select(['assetId as id', 'checksum'])
        .where('ownerId', '=', asUuid(userId))
        .where('checksum', 'in', checksums)
        .execute(),
    ]);

    // Asset-table results take priority over tombstone results
    const seen = new Set(assetResults.map((r) => r.checksum.toString('hex')));
    return [
      ...assetResults,
      ...tombstoneResults.filter((r) => !seen.has(r.checksum.toString('hex'))).map((r) => ({ ...r, deletedAt: null })),
    ];
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.BUFFER] })
  async getUploadAssetIdByChecksum(ownerId: string, checksum: Buffer): Promise<string | undefined> {
    const asset = await this.db
      .selectFrom('asset')
      .select('id')
      .where('ownerId', '=', asUuid(ownerId))
      .where('checksum', '=', checksum)
      .where('libraryId', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (asset) {
      return asset.id;
    }

    // Fallback to tombstone table
    const tombstone = await this.db
      .selectFrom('asset_duplicate_checksum')
      .select('assetId')
      .where('ownerId', '=', asUuid(ownerId))
      .where('checksum', '=', checksum)
      .limit(1)
      .executeTakeFirst();

    return tombstone?.assetId;
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getChecksumsByIds(ids: string[]): Promise<{ id: string; checksum: Buffer }[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('asset')
      .select(['id', 'checksum'])
      .where(
        'id',
        'in',
        ids.map((id) => asUuid(id)),
      )
      .execute();
  }

  findLivePhotoMatch(options: LivePhotoSearchOptions) {
    const { ownerId, otherAssetId, livePhotoCID, type } = options;
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.ownerId'])
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .where('id', '!=', asUuid(otherAssetId))
      .where('ownerId', '=', asUuid(ownerId))
      .where('type', '=', type)
      .where('asset_exif.livePhotoCID', '=', livePhotoCID)
      .limit(1)
      .executeTakeFirst();
  }

  getStatistics(ownerId: string, { visibility, isFavorite, isTrashed }: AssetStatsOptions): Promise<AssetStats> {
    return this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().filterWhere('type', '=', AssetType.Audio).as(AssetType.Audio))
      .select((eb) => eb.fn.countAll<number>().filterWhere('type', '=', AssetType.Image).as(AssetType.Image))
      .select((eb) => eb.fn.countAll<number>().filterWhere('type', '=', AssetType.Video).as(AssetType.Video))
      .select((eb) => eb.fn.countAll<number>().filterWhere('type', '=', AssetType.Other).as(AssetType.Other))
      .where('ownerId', '=', asUuid(ownerId))
      .$if(visibility === undefined, withDefaultVisibility)
      .$if(!!visibility, (qb) => qb.where('asset.visibility', '=', visibility!))
      .$if(isFavorite !== undefined, (qb) =>
        // #763: `ownerId` doubles as the favoriting user here — the query is already scoped to
        // `WHERE asset.ownerId = ownerId` below, so this only ever asks "of ownerId's own assets,
        // how many has ownerId favorited", regardless of which caller (self or an admin viewing
        // another user's stats, see user-admin.service.ts) triggered the request.
        qb.where((eb) => (isFavorite ? favoriteExistsFor(eb, ownerId) : eb.not(favoriteExistsFor(eb, ownerId)))),
      )
      .$if(!!isTrashed, (qb) => qb.where('asset.status', '!=', AssetStatus.Deleted))
      .where('deletedAt', isTrashed ? 'is not' : 'is', null)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({
    params: [DummyValue.UUID, { from: DummyValue.DATE, to: DummyValue.DATE, type: CalendarHeatmapType.Upload }],
  })
  getCalendarHeatmap(ownerId: string, dto: { from: Date; to: Date; type: CalendarHeatmapType }) {
    const dateColumns: Record<CalendarHeatmapType, { order: AssetOrderBy; column: 'createdAt' | 'localDateTime' }> = {
      [CalendarHeatmapType.Upload]: { order: AssetOrderBy.CreatedAt, column: 'createdAt' },
      [CalendarHeatmapType.Taken]: { order: AssetOrderBy.TakenAt, column: 'localDateTime' },
    } as const;

    const { order, column } = dateColumns[dto.type];

    const date = truncatedDate<Date>(order, TimeBucketSize.Day);

    return this.db
      .selectFrom('asset')
      .select(date.as('date'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('ownerId', '=', asUuid(ownerId))
      .where(column, '>=', dto.from)
      .where(column, '<', dto.to)
      .where('deletedAt', 'is', null)
      .groupBy(date)
      .orderBy('date', 'asc')
      .execute();
  }

  @GenerateSql(
    { params: [{}] },
    { params: [{ bucketSize: TimeBucketSize.Year }] },
    { params: [{ bucketSize: TimeBucketSize.Day }] },
  )
  async getTimeBuckets(options: TimeBucketOptions): Promise<TimeBucketItem[]> {
    const bucketSize = options.bucketSize ?? TimeBucketSize.Month;
    const order = options.order === AssetOrder.Asc ? AssetOrder.Asc : AssetOrder.Desc;

    return this.db
      .with('asset', (qb) =>
        withTimeBucketAssetFilters(
          qb
            .selectFrom('asset')
            .select([truncatedDate<Date>(options.orderBy, bucketSize).as('timeBucket'), 'asset.id']),
          options,
        ),
      )
      .with('bucket_counts', (qb) =>
        qb
          .selectFrom('asset')
          .select(['timeBucket'])
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .groupBy('timeBucket'),
      )
      .selectFrom('bucket_counts')
      .select(sql<string>`("bucket_counts"."timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
      .select('bucket_counts.count')
      .orderBy('bucket_counts.timeBucket', order)
      .execute() as any as Promise<TimeBucketItem[]>;
  }

  // #1041 slice 12: a plain COUNT variant of getTimeBuckets, reusing the exact same
  // `withTimeBucketAssetFilters` predicate (no separate counting logic to drift out of sync with the
  // real timeline). Used by the hide-preview endpoints, which run this twice — once with the caller's
  // current `hiddenScope`, once with a hypothetical scope that adds the switch being considered — and
  // diff the two totals. Cheaper than bucketing since there is no GROUP BY.
  // Optional trx handle so the #1041 slice 12 preview endpoints can re-run this INSIDE a
  // rolled-back transaction that has just performed the hypothetical hide — see
  // SharedSpaceRepository.previewInRolledBackTransaction. Every other caller omits it.
  @GenerateSql({ params: [{}] })
  async getTimelineAssetCount(options: TimeBucketOptions, db: Kysely<DB> | Transaction<DB> = this.db): Promise<number> {
    const result = await db
      .selectFrom('asset')
      .$call((qb) => withTimeBucketAssetFilters(qb, options))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async getTimeBucketCovers(options: TimeBucketOptions): Promise<TimeBucketCoverItem[]> {
    const requestedBuckets = options.timeBuckets ?? [];
    if (requestedBuckets.length === 0) {
      return [];
    }

    const bucketSize = options.bucketSize ?? TimeBucketSize.Month;
    const order = options.order === AssetOrder.Asc ? AssetOrder.Asc : AssetOrder.Desc;

    // Narrow the scan to the requested bucket range so this is an index-friendly
    // scan rather than a full-library sort.
    const sorted = requestedBuckets.toSorted();
    const minStart = sorted[0];
    const maxStart = sorted.at(-1)!;
    const maxEnd = addBucketInterval(maxStart, bucketSize);

    // The CTE `timeBucket` is the truncated timestamptz at UTC midnight; the
    // requested YYYY-MM-DD strings correspond to those exact values.
    const requestedBucketDates = requestedBuckets.map((tb) => new Date(`${tb}T00:00:00Z`));

    // Narrow on the same column the buckets are derived from (createdAt for the
    // "date added" timeline, localDateTime otherwise) so createdAt-grouped covers
    // are not dropped by a localDateTime range filter.
    const bucketDateColumn =
      options.orderBy === AssetOrderBy.CreatedAt ? sql.ref('asset.createdAt') : sql.ref('localDateTime');

    return this.db
      .with('asset', (qb) =>
        withTimeBucketAssetFilters(
          qb
            .selectFrom('asset')
            .select((eb) => [
              truncatedDate<Date>(options.orderBy, bucketSize).as('timeBucket'),
              'asset.id',
              'asset.localDateTime', // projected for ORDER BY only
              'asset.fileCreatedAt', // projected for ORDER BY only
              sql<string | null>`encode("thumbhash", 'base64')`.as('representativeThumbhash'),
              eb.fn
                .coalesce(
                  eb
                    .case()
                    .when(
                      sql`asset."height" = 0 or asset."width" = 0 or asset."height" is null or asset."width" is null`,
                    )
                    .then(eb.lit(1))
                    .else(sql`round(asset."width"::numeric / asset."height"::numeric, 3)::float`)
                    .end(),
                  eb.lit(1),
                )
                .as('ratio'),
            ])
            .where(sql`(${bucketDateColumn} AT TIME ZONE 'UTC')::date`, '>=', minStart)
            .where(sql`(${bucketDateColumn} AT TIME ZONE 'UTC')::date`, '<', maxEnd),
          options,
        ),
      )
      .selectFrom('asset')
      .distinctOn('timeBucket')
      .where('timeBucket', 'in', requestedBucketDates)
      .select([
        sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'),
        'id as representativeAssetId',
        'representativeThumbhash',
        'ratio as representativeRatio',
      ])
      .orderBy('timeBucket', order)
      .orderBy(sql`("localDateTime" AT TIME ZONE 'UTC')::date`, order)
      .orderBy('fileCreatedAt', order)
      .execute() as any as Promise<TimeBucketCoverItem[]>;
  }

  @GenerateSql(
    { params: [DummyValue.TIME_BUCKET, { withStacked: true }, { user: { id: DummyValue.UUID } }] },
    { params: ['2000-01-01', { bucketSize: TimeBucketSize.Year }, { user: { id: DummyValue.UUID } }] },
    { params: ['2000-01-02', { bucketSize: TimeBucketSize.Day }, { user: { id: DummyValue.UUID } }] },
  )
  getTimeBucket(timeBucket: string, options: TimeBucketOptions, auth: AuthDto) {
    const order = options.order === AssetOrder.Asc ? AssetOrder.Asc : AssetOrder.Desc;
    const bucketSize = options.bucketSize ?? TimeBucketSize.Month;
    const query = this.db
      // Stage 1 — FILTER: reuse the shared timeline filter chain (the same one
      // getTimeBuckets/getTimeBucketCovers use) so the asset list can never drift
      // out of sync with the scrubber counts. Selects ids only; asset_exif is
      // joined by the helper only when an exif filter is active.
      .with('filtered', (qb) =>
        withTimeBucketAssetFilters(
          qb
            .selectFrom('asset')
            .select('asset.id')
            .where(truncatedDate(options.orderBy, bucketSize), '=', timeBucket.replace(/^[+-]/, '')),
          options,
        ),
      )
      // Stage 2 — PROJECT: build the columnar row shape for the matched ids.
      .with('cte', (qb) =>
        qb
          .selectFrom('filtered')
          .innerJoin('asset', 'asset.id', 'filtered.id')
          .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
          .select((eb) => [
            'asset.duration',
            'asset.id',
            'asset.visibility',
            // The `eb` here is scoped to this `.with('cte', ...)` builder (DB & { filtered: ... }),
            // which Kysely's ExpressionBuilder generics don't consider assignable to the plain
            // `ExpressionBuilder<DB, keyof DB>` favoriteExistsFor expects, even though the
            // 'asset_favorite' table it queries is unaffected by the extra CTE in scope. Safe cast.
            favoriteExistsFor(eb as unknown as ExpressionBuilder<DB, keyof DB>, auth.user.id).as('isFavorite'),
            sql`asset.type = 'IMAGE'`.as('isImage'),
            sql`asset."deletedAt" is not null`.as('isTrashed'),
            'asset.livePhotoVideoId',
            sql`extract(epoch from (asset."localDateTime" AT TIME ZONE 'UTC' - asset."fileCreatedAt" at time zone 'UTC'))::real / 3600`.as(
              'localOffsetHours',
            ),
            'asset.ownerId',
            'asset.status',
            sql`asset."fileCreatedAt" at time zone 'utc'`.as('fileCreatedAt'),
            sql`asset."createdAt" at time zone 'utc'`.as('createdAt'),
            eb.fn('encode', ['asset.thumbhash', sql.lit('base64')]).as('thumbhash'),
            'asset_exif.projectionType',
            eb.fn
              .coalesce(
                eb
                  .case()
                  .when(sql`asset."height" = 0 or asset."width" = 0`)
                  .then(eb.lit(1))
                  .else(sql`round(asset."width"::numeric / asset."height"::numeric, 3)`)
                  .end(),
                eb.lit(1),
              )
              .as('ratio'),
          ])
          .$if(!auth.sharedLink || auth.sharedLink.showExif, (qb) =>
            qb.select(['asset_exif.city', 'asset_exif.country']),
          )
          .$if(!!options.withCoordinates, (qb) => qb.select(['asset_exif.latitude', 'asset_exif.longitude']))
          // withStacked collapses a stack to its primary asset (filtered in Stage 1)
          // and projects the [stackId, count] array for the columnar output.
          .$if(!!options.withStacked, (qb) =>
            qb
              .leftJoinLateral(
                (eb) =>
                  eb
                    .selectFrom('asset as stacked')
                    .select(sql`array[stacked."stackId"::text, count('stacked')::text]`.as('stack'))
                    .whereRef('stacked.stackId', '=', 'asset.stackId')
                    .where('stacked.deletedAt', 'is', null)
                    .where('stacked.visibility', '=', AssetVisibility.Timeline)
                    .groupBy('stacked.stackId')
                    .as('stacked_assets'),
                (join) => join.onTrue(),
              )
              .select('stack'),
          )
          .orderBy(
            options.orderBy == AssetOrderBy.CreatedAt
              ? sql`"createdAt"`
              : sql`(asset."localDateTime" AT TIME ZONE 'UTC')::date`,
            order,
          )
          .orderBy('asset.fileCreatedAt', order),
      )
      .with('agg', (qb) =>
        qb
          .selectFrom('cte')
          .select((eb) => [
            eb.fn.coalesce(eb.fn('array_agg', ['duration']), sql.lit('{}')).as('duration'),
            eb.fn.coalesce(eb.fn('array_agg', ['id']), sql.lit('{}')).as('id'),
            eb.fn.coalesce(eb.fn('array_agg', ['visibility']), sql.lit('{}')).as('visibility'),
            eb.fn.coalesce(eb.fn('array_agg', ['isFavorite']), sql.lit('{}')).as('isFavorite'),
            eb.fn.coalesce(eb.fn('array_agg', ['isImage']), sql.lit('{}')).as('isImage'),
            // TODO: isTrashed is redundant as it will always be all true or false depending on the options
            eb.fn.coalesce(eb.fn('array_agg', ['isTrashed']), sql.lit('{}')).as('isTrashed'),
            eb.fn.coalesce(eb.fn('array_agg', ['livePhotoVideoId']), sql.lit('{}')).as('livePhotoVideoId'),
            eb.fn.coalesce(eb.fn('array_agg', ['fileCreatedAt']), sql.lit('{}')).as('fileCreatedAt'),
            eb.fn.coalesce(eb.fn('array_agg', ['localOffsetHours']), sql.lit('{}')).as('localOffsetHours'),
            eb.fn.coalesce(eb.fn('array_agg', ['createdAt']), sql.lit('{}')).as('createdAt'),
            eb.fn.coalesce(eb.fn('array_agg', ['ownerId']), sql.lit('{}')).as('ownerId'),
            eb.fn.coalesce(eb.fn('array_agg', ['projectionType']), sql.lit('{}')).as('projectionType'),
            eb.fn.coalesce(eb.fn('array_agg', ['ratio']), sql.lit('{}')).as('ratio'),
            eb.fn.coalesce(eb.fn('array_agg', ['status']), sql.lit('{}')).as('status'),
            eb.fn.coalesce(eb.fn('array_agg', ['thumbhash']), sql.lit('{}')).as('thumbhash'),
          ])
          .$if(!auth.sharedLink || auth.sharedLink.showExif, (qb) =>
            qb.select((eb) => [
              eb.fn.coalesce(eb.fn('array_agg', ['city']), sql.lit('{}')).as('city'),
              eb.fn.coalesce(eb.fn('array_agg', ['country']), sql.lit('{}')).as('country'),
            ]),
          )
          .$if(!!options.withCoordinates, (qb) =>
            qb.select((eb) => [
              eb.fn.coalesce(eb.fn('array_agg', ['latitude']), sql.lit('{}')).as('latitude'),
              eb.fn.coalesce(eb.fn('array_agg', ['longitude']), sql.lit('{}')).as('longitude'),
            ]),
          )
          .$if(!!options.withStacked, (qb) =>
            qb.select((eb) => eb.fn.coalesce(eb.fn('json_agg', ['stack']), sql.lit('[]')).as('stack')),
          ),
      )
      .selectFrom('agg')
      .select(sql<string>`to_json(agg)::text`.as('assets'));

    return query.executeTakeFirstOrThrow();
  }

  @GenerateSql({
    params: [DummyValue.UUID, { minAssetsPerField: 5, maxFields: 12, timelineSpaceIds: [DummyValue.UUID] }],
  })
  async getAssetIdByCity(
    ownerId: string,
    { minAssetsPerField, maxFields, timelineSpaceIds }: AssetExploreFieldOptions,
  ) {
    const items = await this.db
      .with('cities', (qb) =>
        qb
          .selectFrom('asset_exif')
          .select('city')
          .where('city', 'is not', null)
          .groupBy('city')
          .having((eb) => eb.fn('count', [eb.ref('assetId')]), '>=', minAssetsPerField),
      )
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .innerJoin('cities', 'asset_exif.city', 'cities.city')
      .distinctOn('asset_exif.city')
      .select(['assetId as data', 'asset_exif.city as value'])
      .$narrowType<{ value: NotNull }>()
      // #867: own assets, plus anything reachable through a space the viewer kept on their
      // timeline. The Timeline-only visibility gate below already covers the space arms' own
      // requirement (archived/hidden/locked space assets never reach the strip).
      //
      // The branches are built from a detached `expressionBuilder<DB, 'asset'>()` rather than the
      // callback's own `eb`: the `cities` CTE widens this query's schema to `DB & { cities }`, which
      // no longer satisfies the shared helpers' `ExpressionBuilder<DB, keyof DB>` parameter. The
      // emitted SQL is identical — the branches only ever reference `asset.*`.
      .where((eb) =>
        eb.or([
          eb('asset.ownerId', '=', asUuid(ownerId)),
          ...(timelineSpaceIds?.length
            ? spaceAssetPathBranches(expressionBuilder<DB, 'asset'>(), {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { spaceIds: timelineSpaceIds },
                albumTimelineGate: 'space-tab',
              })
            : []),
        ]),
      )
      .where('visibility', '=', AssetVisibility.Timeline)
      .where('type', '=', AssetType.Image)
      .where('deletedAt', 'is', null)
      .limit(maxFields)
      .execute();

    return { fieldName: 'exifInfo.city', items };
  }

  @GenerateSql({ params: [DummyValue.UUID, 12] })
  async getRecentlyCreatedAssetIds(ownerId: string, maxAssets: number) {
    const items = await this.db
      .selectFrom('asset')
      .select(['id as data', 'createdAt as value'])
      .where('ownerId', '=', asUuid(ownerId))
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('type', '=', AssetType.Image)
      .where('deletedAt', 'is', null)
      .orderBy('value', 'desc')
      .limit(maxAssets)
      .execute();

    return { fieldName: 'createdAt', items };
  }

  async upsertFile(
    file: Pick<
      Insertable<AssetFileTable>,
      'assetId' | 'path' | 'type' | 'isEdited' | 'isProgressive' | 'isTransparent'
    >,
  ): Promise<void> {
    try {
      await this.db
        .insertInto('asset_file')
        .values(file)
        .onConflict((oc) =>
          oc.columns(['assetId', 'type', 'isEdited']).doUpdateSet((eb) => ({
            path: eb.ref('excluded.path'),
          })),
        )
        .execute();
    } catch (error) {
      if (isStaleAssetForeignKeyConstraint(error)) {
        return;
      }

      throw error;
    }
  }

  async upsertFiles(
    files: Pick<
      Insertable<AssetFileTable>,
      'assetId' | 'path' | 'type' | 'isEdited' | 'isProgressive' | 'isTransparent'
    >[],
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }

    try {
      await this.db
        .insertInto('asset_file')
        .values(files)
        .onConflict((oc) =>
          oc.columns(['assetId', 'type', 'isEdited']).doUpdateSet((eb) => ({
            path: eb.ref('excluded.path'),
            isProgressive: eb.ref('excluded.isProgressive'),
            isTransparent: eb.ref('excluded.isTransparent'),
          })),
        )
        .execute();
    } catch (error) {
      if (isStaleAssetForeignKeyConstraint(error)) {
        const existingFiles = await this.filterRowsForExistingAssets(files);
        if (existingFiles.length > 0 && existingFiles.length < files.length) {
          await this.upsertFiles(existingFiles);
        }

        return;
      }

      throw error;
    }
  }

  async deleteFile({
    assetId,
    type,
    edited,
  }: {
    assetId: string;
    type: AssetFileType;
    edited?: boolean;
  }): Promise<void> {
    await this.db
      .deleteFrom('asset_file')
      .where('assetId', '=', asUuid(assetId))
      .where('type', '=', type)
      .$if(edited !== undefined, (qb) => qb.where('isEdited', '=', edited!))
      .execute();
  }

  async deleteFiles(files: Pick<Selectable<AssetFileTable>, 'id'>[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('asset_file')
      .where('id', '=', anyUuid(files.map((file) => file.id)))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.STRING], [DummyValue.STRING]] })
  async detectOfflineExternalAssets(
    libraryId: string,
    importPaths: string[],
    exclusionPatterns: string[],
  ): Promise<UpdateResult> {
    const paths = importPaths.map((importPath) => `${importPath}%`);
    const exclusions = exclusionPatterns.map((pattern) => globToSqlPattern(pattern));

    return this.db
      .updateTable('asset')
      .set({
        isOffline: true,
        deletedAt: new Date(),
      })
      .where('isOffline', '=', false)
      .where('isExternal', '=', true)
      .where('libraryId', '=', asUuid(libraryId))
      .where((eb) =>
        eb.or([
          eb.not(eb.or(paths.map((path) => eb('originalPath', 'like', path)))),
          eb.or(exclusions.map((path) => eb('originalPath', 'like', path))),
        ]),
      )
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.STRING]] })
  async filterNewExternalAssetPaths(libraryId: string, paths: string[]): Promise<string[]> {
    const result = await this.db
      .selectFrom(unnest(paths).as('path'))
      .select('path')
      .where((eb) =>
        eb.not(
          eb.exists(
            this.db
              .selectFrom('asset')
              .select('originalPath')
              .whereRef('asset.originalPath', '=', eb.ref('path'))
              .where('libraryId', '=', asUuid(libraryId))
              .where('isExternal', '=', true),
          ),
        ),
      )
      .execute();

    return result.map((row) => row.path as string);
  }

  async getLibraryAssetCount(libraryId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('libraryId', '=', asUuid(libraryId))
      .executeTakeFirstOrThrow();

    return count;
  }

  private buildGetForOriginal(ids: string[], isEdited: boolean) {
    return this.db
      .selectFrom('asset')
      .select('asset.id')
      .select('originalFileName')
      .where('asset.id', 'in', ids)
      .$if(isEdited, (qb) =>
        qb.select((eb) =>
          eb
            .selectFrom('asset_file')
            .select('asset_file.path')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.isEdited', '=', true)
            .where('asset_file.type', 'in', [AssetFileType.FullSize, AssetFileType.EncodedVideo])
            .orderBy('asset_file.type', 'asc')
            .limit(1)
            .as('editedPath'),
        ),
      )
      .select('originalPath');
  }

  @GenerateSql({ params: [DummyValue.UUID, true] })
  getForOriginal(id: string, isEdited: boolean) {
    return this.buildGetForOriginal([id], isEdited).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [[DummyValue.UUID], true] })
  getForOriginals(ids: string[], isEdited: boolean) {
    return this.buildGetForOriginal(ids, isEdited).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, AssetFileType.Preview, true] })
  async getForThumbnail(id: string, type: AssetFileType, isEdited: boolean) {
    const types = type === AssetFileType.Thumbnail ? [AssetFileType.Thumbnail, AssetFileType.Preview] : [type];

    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', id)
      .leftJoin('asset_file', (join) =>
        join.onRef('asset.id', '=', 'asset_file.assetId').on('asset_file.type', 'in', types),
      )
      .select(['asset.originalPath', 'asset.originalFileName', 'asset_file.path as path'])
      .orderBy(sql`case when asset_file.type = ${type} then 0 else 1 end`)
      .orderBy('asset_file.isEdited', isEdited ? 'desc' : 'asc')
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForVideo(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.originalPath'])
      .select((eb) =>
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.type', '=', AssetFileType.EncodedVideo)
          .orderBy('asset_file.isEdited', 'desc')
          .limit(1)
          .as('encodedVideoPath'),
      )
      .where('asset.id', '=', id)
      .where('asset.type', '=', AssetType.Video)
      .executeTakeFirst();
  }

  // No @GenerateSql: undecorated repository methods are not documented; several already are.
  async getEditedEncodedVideo(assetId: string) {
    return this.db
      .selectFrom('asset_file')
      .select(['asset_file.id', 'asset_file.path'])
      .where('asset_file.assetId', '=', assetId)
      .where('asset_file.type', '=', AssetFileType.EncodedVideo)
      .where('asset_file.isEdited', '=', true)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForOcr(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', id)
      .select(withEdits)
      .innerJoin('asset_exif', (join) => join.onRef('asset_exif.assetId', '=', 'asset.id'))
      .select(['asset_exif.exifImageWidth', 'asset_exif.exifImageHeight', 'asset_exif.orientation'])
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForEdit(id: string) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.type',
        'asset.livePhotoVideoId',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.duration',
      ])
      .where('asset.id', '=', id)
      .innerJoin('asset_exif', (join) => join.onRef('asset_exif.assetId', '=', 'asset.id'))
      .select([
        'asset_exif.exifImageWidth',
        'asset_exif.exifImageHeight',
        'asset_exif.orientation',
        'asset_exif.projectionType',
      ])
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForMetadataExtractionTags(id: string) {
    return this.db
      .selectFrom('asset_exif')
      .select('asset_exif.tags')
      .where('asset_exif.assetId', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForFaces(id: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', (join) => join.onRef('asset_exif.assetId', '=', 'asset.id'))
      .select(['asset_exif.exifImageHeight', 'asset_exif.exifImageWidth', 'asset_exif.orientation'])
      .select(withEdits)
      .where('asset.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getForUpdateTags(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('tag')
            .select('tag.value')
            .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
            .whereRef('asset.id', '=', 'tag_asset.assetId'),
        ).as('tags'),
      )
      .where('asset.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  private async filterRowsForExistingAssets<T extends { assetId: string }>(rows: T[]): Promise<T[]> {
    const assetIds = [...new Set(rows.map(({ assetId }) => assetId))];
    const existingAssets = await this.db.selectFrom('asset').select('id').where('id', 'in', assetIds).execute();
    const existingAssetIds = new Set(existingAssets.map(({ id }) => id));

    return rows.filter(({ assetId }) => existingAssetIds.has(assetId));
  }

  // Gallery-fork: derivative files are stored by ownerId with no library dimension, so the
  // physical-usage walk needs the owner's external asset ids to exclude their thumbnails and
  // transcodes — upstream excludes external assets from quota entirely.
  @GenerateSql({ params: [DummyValue.UUID] })
  async getExternalAssetIds(ownerId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.libraryId', 'is not', null)
      .execute();

    return new Set(rows.map((row) => row.id));
  }
}
