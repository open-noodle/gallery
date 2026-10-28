import { Injectable } from '@nestjs/common';
import { type Kysely, type SelectQueryBuilder, type SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { isDeepStrictEqual } from 'node:util';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, AssetVisibility, VectorIndex } from 'src/enum.js';
import { SearchOptionsDimension, searchOptionsDimensions } from 'src/gallery/dtos/search.dto.js';
import {
  FilterSuggestionPerson,
  FilterSuggestionsResult,
  getFilteredIdentityPeople,
  getFilteredIdentityPeopleWithCounts,
} from 'src/gallery/repositories/filter-suggestion.repository.js';
import { personIdentityId, personIsPet } from 'src/gallery/utils/person-sidecar.js';
import { SEARCH_OPTIONS_PROBE, isSearchOptionsProbeTimeout } from 'src/gallery/utils/search-options-probe.js';
import { withTimeBucketAssetFilters } from 'src/gallery/utils/time-bucket-filter.js';
import { TimeBucketOptions } from 'src/repositories/asset.repository.js';
import { isActiveDistanceThreshold } from 'src/gallery/utils/smart-search.js';
import { probes } from 'src/repositories/database.repository.js';
import { AssetSearchBuilderOptions, SmartSearchOptions } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetFilter, searchAssetBuilderWithLocalTaken, withAssetFilter } from 'src/utils/asset-filter.js';
import { anyUuid, asUuid, hasPeople, hasTags, searchAssetBuilderLegacy, truncatedDate } from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { without } from 'src/utils/filter-suggestions.js';
import { hasSpacePeople } from 'src/utils/people-filter.js';

export type SmartSearchFacetsOptions = Omit<SmartSearchOptions, 'orderDirection'>;

type SmartFacetExclude =
  | 'time'
  | 'people'
  | 'location'
  | 'city'
  | 'camera'
  | 'cameraModel'
  | 'tags'
  | 'rating'
  | 'media'
  | 'favorites'
  | 'albums';

const smartFacetFilterExcludes: Partial<Record<SmartFacetExclude, (keyof AssetFilter)[]>> = {
  time: ['takenAfter', 'takenBefore'],
  location: ['country', 'city'],
  city: ['city'],
  camera: ['make', 'model'],
  cameraModel: ['model'],
  rating: ['rating'],
};

/** Query mode: what `/search/smart` hands `searchAssetBuilderLegacy` (scope included), plus the embedding it ranks by. */
export type SearchOptionsSmartQuery = Omit<AssetSearchBuilderOptions, 'visibility'> & {
  visibility?: AssetVisibility | 'not-locked';
  embedding: string;
  maxDistance?: number;
};

/**
 * What one request computes. `availability` is the chip row: whether each dimension has any option, the #910 flags
 * and whether anything matches, all from LIMIT 1 probes. Every other value is one option list with counts, so a client
 * asks for availability first and fetches the lists it needs in parallel.
 */

/**
 * The resolved options of a search options request, in the shape its results call runs them, so every count is a
 * count of that call's own query:
 * - `browse`: `/timeline/buckets`, i.e. `withTimeBucketAssetFilters` over `TimelineService`'s options. `favorites` is the
 *   same request resolved with `isFavorite: true` (whose scope differs, #763), for the hasFavorites probe.
 * - `query`: `/search/smart`, i.e. `searchAssetBuilderWithLocalTaken` (rating a minimum) over the smart-search candidates.
 */
export type SearchOptionsQuery = {
  callerId: string;
  dimensions: SearchOptionsDimension[];
  /** Whether any filter beyond the scope is active (see the availability probes). */
  filtered?: boolean;
} & (
  | {
      mode: 'browse';
      timeline: TimeBucketOptions;
      favorites: TimeBucketOptions;
      /** `tagIds: null`: assets with no tag. `/timeline/buckets` has no way to ask for it. */
      untagged: boolean;
    }
  | { mode: 'query'; search: SearchOptionsSmartQuery }
);

/** The filter a list ignores, so the user can switch value (single choice) or widen a union (browse tags). */
type Facet = 'time' | 'places' | 'cameras' | 'tags' | 'ratings' | 'mediaTypes' | 'favorites' | 'albums';

/**
 * Browse: the keys each list drops. Tags are ANY there, a union the user widens one tag at a time, so like the
 * single-choice lists they drop their own filter: a tag counts the photos it would match with everything else.
 * The favourites probe runs on its own request (`favorites`) instead.
 */
const browseExcludes: Record<Exclude<Facet, 'favorites'>, (keyof TimeBucketOptions)[]> = {
  time: ['takenAfter', 'takenBefore'],
  places: ['country', 'state', 'city'],
  cameras: ['make', 'model'],
  tags: ['tagIds'],
  ratings: ['rating'],
  mediaTypes: ['assetType'],
  albums: ['isInAlbum', 'isNotInAlbum'],
};

/**
 * Query: the keys each list drops. Tags are ALL there, so they keep their filter and list what co-occurs with the
 * selection; Untagged (`tagIds: null`) goes, since choosing a tag replaces it.
 */
const queryExcludes: Record<Facet, (options: SearchOptionsSmartQuery) => (keyof AssetSearchBuilderOptions)[]> = {
  time: () => ['takenAfter', 'takenBefore'],
  places: () => ['country', 'state', 'city'],
  cameras: () => ['make', 'model'],
  tags: (options) => (options.tagIds === null ? ['tagIds'] : []),
  ratings: () => ['rating'],
  mediaTypes: () => ['type'],
  favorites: () => ['isFavorite'],
  albums: () => ['isInAlbum', 'isNotInAlbum'],
};

export type SearchOptionsPerson = FilterSuggestionPerson & {
  filterId: string;
  count: number;
  isSelected: boolean;
  isPet: boolean;
};

export interface SearchOptionsAvailability {
  hasAssets: boolean;
  hasPeople: boolean;
  hasTags: boolean;
  hasPlaces: boolean;
  hasCameras: boolean;
  hasRatings: boolean;
  hasImages: boolean;
  hasVideos: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

/** Only the requested dimensions are present. */
export interface SearchOptionsResult {
  /** Served from the unfiltered cache after a change, while a refresh runs. */
  stale?: boolean;
  availability?: SearchOptionsAvailability;
  total?: number;
  timeBuckets?: Array<{ timeBucket: string; count: number }>;
  people?: SearchOptionsPerson[];
  hasUnnamedPeople?: boolean;
  tags?: Array<{ id: string; value: string; count: number; isSelected: boolean }>;
  countries?: Array<{ country: string; count: number; cities: Array<{ city: string; count: number }> }>;
  cameraMakes?: Array<{ make: string; count: number; models: Array<{ model: string; count: number }> }>;
  ratings?: Array<{ rating: number; count: number }>;
  mediaTypes?: Array<{ type: AssetType; count: number }>;
}

/** Scope fields a people query reads: which branch (space, identity, personal) and what is selected. */
type PeopleScope = Pick<
  SearchOptionsSmartQuery,
  'spaceId' | 'timelineSpaceIds' | 'personIds' | 'identityIds' | 'spacePersonIds'
> & { callerId: string };

/** A request's asset set, before any select: each list joins its own table straight onto it. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- what selectFrom('asset') yields before a select
type ScopedAssets = SelectQueryBuilder<DB, 'asset', {}>;

type AvailabilityFlag = keyof SearchOptionsAvailability;

/** An availability probe's query, before its LIMIT 1. */

type AvailabilityQuery = SelectQueryBuilder<any, any, any>;

/** One availability flag: the set it reads (built on a given connection) and its query over that set. */
type AvailabilityProbe = {
  scope: (on: Kysely<DB>) => ScopedAssets;
  build: (scoped: ScopedAssets) => AvailabilityQuery;
};

/**
 * A space's set, materialised, for the lists that join another table (tags, places, cameras, ratings) and the
 * availability probes. Given the space scope inline, the planner
 * drives the tag list from every tag_asset row, and a LIMIT 1 probe walks the caller's own assets hoping for an early
 * hit, re-running the space-path checks per row (5–10 s at 500k assets); materialised, the space's assets are found
 * once (0.3 s). Elsewhere the inline join plans well, and materialising would hide the set's size from the planner.
 */
const spaceScope = (db: Kysely<DB>, scoped: ScopedAssets, spaceId?: string): ScopedAssets =>
  spaceId ? materialized(db, scoped) : scoped;

/** `scoped`'s ids as a MATERIALIZED CTE, the asset row joined back: planned for its whole result, read on demand. */
const materialized = (db: Kysely<DB>, scoped: ScopedAssets): ScopedAssets =>
  db
    .with(
      (wb) => wb('scoped_assets').materialized(),
      () => scoped.select('asset.id'),
    )
    .selectFrom('scoped_assets')
    .innerJoin('asset', 'asset.id', 'scoped_assets.id') as unknown as ScopedAssets;

/** Runs `fn` in `db`'s transaction, or in a new one: for session settings and temp tables that must not leak. */
const inTransaction = <T>(db: Kysely<DB>, fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> =>
  db.isTransaction ? fn(db) : db.transaction().execute(fn);

/** How long an availability probe may try its inline plan before it is asked again with its set materialised. */
export const SEARCH_OPTIONS_FAST_PROBE_MS = 60;

/** Whether an availability probe finds a row. */
const exists = (query: AvailabilityQuery) =>
  query
    .limit(1)
    .executeTakeFirst()
    .then((row) => row !== undefined);

/** Runs `probe` in its own transaction under `timeoutMs`; `undefined` when Postgres cancels it for running out. */
const hedgedOnPool = async (
  db: Kysely<DB>,
  timeoutMs: number,
  probe: (on: Kysely<DB>) => Promise<boolean>,
): Promise<boolean | undefined> => {
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL statement_timeout = ${sql.lit(timeoutMs)}`.execute(trx);
      return probe(trx);
    });
  } catch (error) {
    if (isSearchOptionsProbeTimeout(error)) {
      return undefined;
    }
    throw error;
  }
};

/** Visible, live faces. */
const liveFace = (alias: string) =>
  sql<SqlBool>`${sql.ref(`${alias}.deletedAt`)} IS NULL AND ${sql.ref(`${alias}.isVisible`)}`;

/** Whether a face identity has a non-hidden profile the caller can see (named only, with `named`), as the list ranks them. */
const identityProfile = (identityId: unknown, callerId: string, spaceIds: string[], named: boolean) => sql<SqlBool>`(
  EXISTS (
    SELECT 1 FROM person
    WHERE person."ownerId" = ${callerId} AND NOT person."isHidden" AND ${personIdentityId()} = ${identityId}
      ${named ? sql`AND NULLIF(person.name, '') IS NOT NULL` : sql``}
  )
  OR EXISTS (
    SELECT 1 FROM shared_space_person
    LEFT JOIN shared_space_person_alias
      ON shared_space_person_alias."personId" = shared_space_person.id
      AND shared_space_person_alias."userId" = ${callerId}
    WHERE shared_space_person."identityId" = ${identityId}
      AND shared_space_person."spaceId" = ${anyUuid(spaceIds)}
      AND NOT shared_space_person."isHidden"
      ${named ? sql`AND COALESCE(NULLIF(shared_space_person_alias.alias, ''), shared_space_person.name, '') <> ''` : sql``}
      AND EXISTS (
        SELECT 1 FROM shared_space_person_face
        INNER JOIN asset_face AS profile_face ON profile_face.id = shared_space_person_face."assetFaceId"
        WHERE shared_space_person_face."personId" = shared_space_person.id
          AND profile_face."deletedAt" IS NULL AND profile_face."isVisible"
      )
  )
)`;

const byKeyCount = (a: { key: string; count: number }, b: { key: string; count: number }) =>
  b.count - a.count || a.key.localeCompare(b.key);

const byPersonCount = (a: SearchOptionsPerson, b: SearchOptionsPerson) =>
  b.count - a.count || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Folds `(parent, child, count)` rows into parents with their children, both most assets first. A parent counts its
 * rows with no child too (a photo in Portugal with no city); only named children are listed.
 */
const groupCounts = <P extends string, C extends string>(
  rows: Array<{ [key in P | C]: string | null } & { count: number | string | bigint }>,
  parentKey: P,
  childKey: C,
) => {
  const groups = new Map<string, { key: string; count: number; children: Array<{ key: string; count: number }> }>();
  for (const row of rows) {
    const parent = row[parentKey] as string;
    const count = Number(row.count);
    const group = groups.get(parent) ?? { key: parent, count: 0, children: [] };
    group.count += count;
    const child = row[childKey];
    if (child) {
      group.children.push({ key: child, count });
    }
    groups.set(parent, group);
  }
  return groups
    .values()
    .map((group) => ({ ...group, children: group.children.toSorted(byKeyCount) }))
    .toArray()
    .toSorted(byKeyCount);
};

export interface SmartSearchFacetsResult {
  total: number;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  countries: string[];
  cities: string[];
  cameraMakes: string[];
  cameraModels: string[];
  tags: FilterSuggestionsResult['tags'];
  people: FilterSuggestionsResult['people'];
  ratings: number[];
  mediaTypes: AssetType[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

@Injectable()
export class SmartFacetRepository {
  /** The availability probes' inline budget (see `getSearchOptionsAvailability`). */
  fastProbeMs = SEARCH_OPTIONS_FAST_PROBE_MS;

  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      {
        embedding: DummyValue.VECTOR,
        userIds: [DummyValue.UUID],
        timelineSpaceIds: [DummyValue.UUID, DummyValue.UUID],
        maxDistance: 0.75,
        country: DummyValue.STRING,
        make: DummyValue.STRING,
        tagIds: [DummyValue.UUID],
        rating: 4,
        type: AssetType.Image,
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
      },
    ],
  })
  async getSmartSearchFacets(options: SmartSearchFacetsOptions): Promise<SmartSearchFacetsResult> {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      await this.createSmartFacetCandidates(trx, options);

      const total = await this.getSmartFacetTotal(trx, options);
      const timeBuckets = await this.getSmartFacetTimeBuckets(trx, options);
      const countries = await this.getSmartFacetCountries(trx, options);
      const cities = await this.getSmartFacetCities(trx, options);
      const cameraMakes = await this.getSmartFacetCameraMakes(trx, options);
      const cameraModels = await this.getSmartFacetCameraModels(trx, options);
      const tags = await this.getSmartFacetTags(trx, options);
      const peopleResult = await this.getSmartFacetPeople(trx, options);
      const ratings = await this.getSmartFacetRatings(trx, options);
      const mediaTypes = await this.getSmartFacetMediaTypes(trx, options);
      const hasFavorites = await this.getSmartFacetHasFavorites(trx, options);
      const albumMembership = await this.getSmartFacetAlbumMembership(trx, options);

      return {
        total,
        timeBuckets,
        countries,
        cities,
        cameraMakes,
        cameraModels,
        tags,
        people: peopleResult.people,
        ratings,
        mediaTypes,
        hasUnnamedPeople: peopleResult.hasUnnamedPeople,
        hasFavorites,
        ...albumMembership,
      };
    });
  }

  /**
   * `POST /search/options` (specs/2026-10-23-mobile-search-redesign-design.md, Slice 1): the requested dimensions of
   * the filter options. Each list is the results call's own query (see `SearchOptionsQuery`) with that list's table
   * joined straight onto it, so the total IS the result count; a list only drops its own filter keys. Single-choice
   * lists (place, camera, rating, type, date) drop their filter so the user can switch value. People are AND in both
   * modes, so they keep theirs and list who else is in those photos (the selection included, with a count equal to the
   * total). Tags follow the mode: see `browseExcludes` and `queryExcludes`.
   *
   * Joined, not `asset_exif.assetId IN (<set>)` and not a CTE: an IN lets the planner drive from the list's table and
   * re-run the scope checks per row (8 s for one space's tags at 500k assets), and a CTE hides the set's size from it
   * (an estimate of 200 rows for 617k, then 617k nested-loop lookups per list). See
   * specs/research/2026-10-23-search-options-500k-benchmark.md.
   *
   * Query mode first collects the smart-search candidates the facets use (`createSmartFacetCandidates`) and confines
   * every set to them.
   */
  @GenerateSql({
    params: [
      {
        mode: 'browse',
        callerId: DummyValue.UUID,
        dimensions: [...searchOptionsDimensions],
        untagged: false,
        timeline: {
          userIds: [DummyValue.UUID],
          callerId: DummyValue.UUID,
          authUserId: DummyValue.UUID,
          withSharedSpaces: true,
          timelineSpaceIds: [DummyValue.UUID],
          visibility: AssetVisibility.Timeline,
          identityIds: [DummyValue.UUID],
          tagIds: [DummyValue.UUID],
          city: DummyValue.STRING,
          rating: 3,
          ocr: DummyValue.STRING,
        },
        favorites: {
          userIds: [DummyValue.UUID],
          authUserId: DummyValue.UUID,
          isFavorite: true,
          timelineSpaceIds: [DummyValue.UUID],
          visibility: AssetVisibility.Timeline,
        },
      },
    ],
    // Browse mode runs its lists and probes concurrently on the pool, so they finish in no fixed order.
    sortQueries: true,
  })
  async getSearchOptions(options: SearchOptionsQuery): Promise<SearchOptionsResult> {
    if (options.mode === 'browse') {
      // No temp table and no session setting, so the lists run concurrently on the pool, as getFilterSuggestions does.
      return this.computeSearchOptions(this.db, options);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      await this.createSmartFacetCandidates(trx, options.search);
      return this.computeSearchOptions(trx, options);
    });
  }

  /**
   * A cheap marker of every write that can change any search option: the newest `updateId` (or audit id, for deletes)
   * of each table the options read, all indexed, plus Postgres' write counters for the tables with no such indexed
   * column (`tag_asset`, `tag_closure`, `asset_face`, `shared_space_person_face`, `ocr_search`). Those counters are
   * late: a connection sends its counts to the statistics view at most every 500 ms (PG14), and a connection that goes
   * idle sooner keeps them until it next runs a statement. On the server's busy pool that is usually under a second;
   * the watermark query itself flushes the connection it runs on. Global, not per user: it can only invalidate too
   * often, never too rarely, apart from that delay.
   */
  @GenerateSql()
  async getSearchOptionsWatermark(): Promise<string> {
    const { rows } = await sql<{ watermark: string }>`
      SELECT concat_ws('|',
        (SELECT "updateId" FROM asset ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM asset_exif ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM asset_favorite ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM album ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM album_asset ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM album_user ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM album_space_asset ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM partner ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM person ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM tag ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM face_identity ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM face_identity_face ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM shared_space ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM shared_space_member ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM shared_space_asset ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM shared_space_album ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM shared_space_album_hidden ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM shared_space_library ORDER BY "updateId" DESC LIMIT 1),
        (SELECT "updateId" FROM shared_space_person ORDER BY "updateId" DESC LIMIT 1), (SELECT "updateId" FROM library ORDER BY "updateId" DESC LIMIT 1),
        (SELECT id FROM asset_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM asset_face_audit ORDER BY id DESC LIMIT 1),
        (SELECT id FROM asset_favorite_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM album_asset_audit ORDER BY id DESC LIMIT 1),
        (SELECT id FROM album_space_asset_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM partner_audit ORDER BY id DESC LIMIT 1),
        (SELECT id FROM person_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM shared_space_asset_audit ORDER BY id DESC LIMIT 1),
        (SELECT id FROM shared_space_member_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM shared_space_album_audit ORDER BY id DESC LIMIT 1),
        (SELECT id FROM shared_space_album_hidden_audit ORDER BY id DESC LIMIT 1), (SELECT id FROM shared_space_library_audit ORDER BY id DESC LIMIT 1),
        (SELECT string_agg(relname || ':' || (n_tup_ins + n_tup_upd + n_tup_del), ',' ORDER BY relname)
          FROM pg_stat_user_tables
          WHERE relname IN ('tag_asset', 'tag_closure', 'asset_face', 'shared_space_person_face', 'ocr_search'))
      ) AS watermark
    `.execute(this.db);
    return rows[0].watermark;
  }

  private async computeSearchOptions(db: Kysely<DB>, options: SearchOptionsQuery): Promise<SearchOptionsResult> {
    const scoped = (facet?: Facet, overrides: Partial<SearchOptionsSmartQuery> = {}) =>
      this.searchOptionsScope(db, options, facet, overrides);
    const scope = options.mode === 'browse' ? options.timeline : options.search;
    const peopleScope: PeopleScope = { ...scope, callerId: options.callerId };
    const count = sql<number>`count(*)`.as('count');

    const tasks: Array<Promise<SearchOptionsResult>> = [];
    const want = new Set(options.dimensions);

    if (want.has('availability')) {
      tasks.push(
        this.getSearchOptionsAvailability(db, options, peopleScope).then((availability) => ({ availability })),
      );
    }

    if (want.has('total')) {
      tasks.push(
        scoped()
          .select(count)
          .executeTakeFirstOrThrow()
          .then((row) => ({ total: Number(row.count) })),
      );
    }

    if (want.has('time')) {
      const bucket = sql<string>`(${truncatedDate()} AT TIME ZONE 'UTC')::date::text`;
      tasks.push(
        scoped('time')
          .select(bucket.as('timeBucket'))
          .select(count)
          .groupBy(bucket)
          .orderBy(bucket, 'desc')
          .execute()
          .then((rows) => ({
            timeBuckets: rows.map((row) => ({ timeBucket: row.timeBucket, count: Number(row.count) })),
          })),
      );
    }

    if (want.has('places')) {
      tasks.push(
        spaceScope(db, scoped('places'), scope.spaceId)
          .innerJoin('asset_exif as facet_exif', 'facet_exif.assetId', 'asset.id')
          .select(['facet_exif.country', 'facet_exif.city'])
          .select(count)
          .where('facet_exif.country', 'is not', null)
          .where('facet_exif.country', '!=', '')
          .groupBy(['facet_exif.country', 'facet_exif.city'])
          .execute()
          .then((rows) => ({
            countries: groupCounts(rows, 'country', 'city').map(({ key, count, children }) => ({
              country: key,
              count,
              cities: children.map((child) => ({ city: child.key, count: child.count })),
            })),
          })),
      );
    }

    if (want.has('cameras')) {
      tasks.push(
        spaceScope(db, scoped('cameras'), scope.spaceId)
          .innerJoin('asset_exif as facet_exif', 'facet_exif.assetId', 'asset.id')
          .select(['facet_exif.make', 'facet_exif.model'])
          .select(count)
          .where('facet_exif.make', 'is not', null)
          .where('facet_exif.make', '!=', '')
          .groupBy(['facet_exif.make', 'facet_exif.model'])
          .execute()
          .then((rows) => ({
            cameraMakes: groupCounts(rows, 'make', 'model').map(({ key, count, children }) => ({
              make: key,
              count,
              models: children.map((child) => ({ model: child.key, count: child.count })),
            })),
          })),
      );
    }

    if (want.has('ratings')) {
      tasks.push(
        spaceScope(db, scoped('ratings'), scope.spaceId)
          .innerJoin('asset_exif as facet_exif', 'facet_exif.assetId', 'asset.id')
          .select('facet_exif.rating')
          .select(count)
          .where('facet_exif.rating', '>', 0)
          .groupBy('facet_exif.rating')
          .orderBy('facet_exif.rating')
          .execute()
          .then((rows) => ({ ratings: rows.map((row) => ({ rating: row.rating!, count: Number(row.count) })) })),
      );
    }

    if (want.has('mediaTypes')) {
      tasks.push(
        scoped('mediaTypes')
          .select('asset.type')
          .select(count)
          .groupBy('asset.type')
          .orderBy('asset.type')
          .execute()
          .then((rows) => ({ mediaTypes: rows.map((row) => ({ type: row.type, count: Number(row.count) })) })),
      );
    }

    if (want.has('tags')) {
      // A tag counts the assets carrying it or a child of it, which is what filtering by it matches.
      const tagIds = new Set(scope.tagIds);
      tasks.push(
        spaceScope(db, scoped('tags'), scope.spaceId)
          .innerJoin('tag_asset as facet_tag_asset', 'facet_tag_asset.assetId', 'asset.id')
          .innerJoin('tag_closure as facet_closure', 'facet_closure.id_descendant', 'facet_tag_asset.tagId')
          .innerJoin('tag as facet_tag', 'facet_tag.id', 'facet_closure.id_ancestor')
          .select(['facet_tag.id', 'facet_tag.value'])
          .select(sql<number>`count(DISTINCT "asset"."id")`.as('count'))
          .groupBy(['facet_tag.id', 'facet_tag.value'])
          .execute()
          .then((rows) => ({
            tags: rows
              .map((row) => ({
                id: row.id,
                value: row.value,
                count: Number(row.count),
                isSelected: tagIds.has(row.id),
              }))
              .toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
          })),
      );
    }

    if (want.has('people')) {
      tasks.push(this.getSearchOptionsPeople(db, peopleScope, scoped()));
    }

    const parts = await Promise.all(tasks);
    return Object.assign({}, ...parts) as SearchOptionsResult;
  }

  /** A request's asset set with `facet`'s own filter dropped, before any select. */
  private searchOptionsScope(
    db: Kysely<DB>,
    options: SearchOptionsQuery,
    facet?: Facet,
    overrides: Partial<SearchOptionsSmartQuery> = {},
  ): ScopedAssets {
    if (options.mode === 'browse') {
      const excluded = facet && facet !== 'favorites' ? browseExcludes[facet] : [];
      return db
        .selectFrom('asset')
        .$call((qb) => withTimeBucketAssetFilters(qb, without(options.timeline, ...excluded), options.callerId))
        .$if(options.untagged && facet !== 'tags', (qb) =>
          qb.where((eb) =>
            eb.not(eb.exists(eb.selectFrom('tag_asset').whereRef('tag_asset.assetId', '=', 'asset.id'))),
          ),
        );
    }

    const search = { ...options.search, ...overrides };
    const excluded = facet ? queryExcludes[facet](search) : [];
    const { embedding: _embedding, maxDistance: _maxDistance, ...filters } = search;
    return searchAssetBuilderWithLocalTaken(db, { ...without(filters, ...excluded), ratingIsMinimum: true }).where(
      'asset.id',
      'in',
      db.selectFrom(sql<{ id: string }>`smart_search_facet_candidates`.as('candidates')).select('candidates.id'),
    );
  }

  /**
   * The chip row: does each list have any option (its own filter dropped, as the list itself), the #910 flags, and
   * does anything match at all. LIMIT 1 probes, run concurrently.
   */
  private async getSearchOptionsAvailability(
    db: Kysely<DB>,
    options: SearchOptionsQuery,
    people: PeopleScope,
  ): Promise<SearchOptionsAvailability> {
    const one = sql<number>`1`.as(SEARCH_OPTIONS_PROBE);
    const scope =
      (facet?: Facet, overrides?: Partial<SearchOptionsSmartQuery>) =>
      (on: Kysely<DB>): ScopedAssets =>
        this.searchOptionsScope(on, options, facet, overrides);
    const exif = (facet: Facet, column: 'country' | 'make' | 'rating'): AvailabilityProbe => ({
      scope: scope(facet),
      build: (scoped) =>
        scoped
          .innerJoin('asset_exif as facet_exif', 'facet_exif.assetId', 'asset.id')
          .select(one)
          .where(
            column === 'rating'
              ? sql<SqlBool>`"facet_exif"."rating" > 0`
              : sql<SqlBool>`NULLIF(${sql.ref(`facet_exif.${column}`)}, '') IS NOT NULL`,
          ),
    });
    const album = (filed: boolean): AvailabilityProbe => ({
      scope: scope('albums'),
      build: (scoped) =>
        scoped.select(one).where((eb) => {
          const inAlbum = eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'));
          return filed ? inAlbum : eb.not(inAlbum);
        }),
    });
    const mediaType = (type: AssetType): AvailabilityProbe => ({
      scope: scope('mediaTypes'),
      build: (scoped) => scoped.select(one).where('asset.type', '=', type),
    });
    const favorite: AvailabilityProbe =
      options.mode === 'browse'
        ? {
            scope: (on) =>
              on
                .selectFrom('asset')
                .$call((qb) => withTimeBucketAssetFilters(qb, options.favorites, options.callerId)) as ScopedAssets,
            build: (scoped) => scoped.select(one),
          }
        : {
            scope: scope('favorites', {
              timelineSpaceIds: options.search.favoriteSpaceIds ?? options.search.timelineSpaceIds,
            }),
            build: (scoped) => scoped.select(one).where((eb) => favoriteExistsFor(eb, options.callerId)),
          };

    const probes: Record<keyof SearchOptionsAvailability, AvailabilityProbe> = {
      hasAssets: { scope: scope(), build: (scoped) => scoped.select(one) },
      hasPeople: { scope: scope(), build: (scoped) => this.searchOptionsPeopleProbe(people, scoped) },
      hasTags: {
        scope: scope('tags'),
        build: (scoped) =>
          scoped
            .select(one)
            .where((eb) => eb.exists(eb.selectFrom('tag_asset').whereRef('tag_asset.assetId', '=', 'asset.id'))),
      },
      hasPlaces: exif('places', 'country'),
      hasCameras: exif('cameras', 'make'),
      hasRatings: exif('ratings', 'rating'),
      hasImages: mediaType(AssetType.Image),
      hasVideos: mediaType(AssetType.Video),
      hasFavorites: favorite,
      hasAssetsInAlbum: album(true),
      hasAssetsNotInAlbum: album(false),
    };
    const names = Object.keys(probes) as AvailabilityFlag[];
    const answer = (results: boolean[]) =>
      Object.fromEntries(names.map((name, index) => [name, results[index]])) as unknown as SearchOptionsAvailability;
    const inline = (on: Kysely<DB>, name: AvailabilityFlag) => exists(probes[name].build(probes[name].scope(on)));

    // An unfiltered probe outside a space hits at once, inline.
    if (!people.spaceId && !options.filtered) {
      return answer(await Promise.all(names.map((name) => inline(db, name))));
    }

    // Otherwise a LIMIT 1 probe can go either way. The planner takes a fast-start plan that hopes for an early hit:
    // quick when one comes, slow when the set has none or few (all 1.8M faces walked in asset order for a space-person
    // filter, 3 s; 370 ms to find a space's first asset when the same set counts in 115 ms). Materialising the set
    // first bounds a probe at about the cost of counting it. Most probes read the request's own set (only a probe whose
    // own filter is set reads a wider one), so their materialised answer is one statement: that set computed once, each
    // probe an EXISTS over it. A probe whose set differs is materialised on its own.
    const base = scope()(db).compile();
    const shared = names.filter((name) => {
      const compiled = probes[name].scope(db).compile();
      return compiled.sql === base.sql && isDeepStrictEqual(compiled.parameters, base.parameters);
    });
    // The probes read only `asset.id` and `asset.type`, so the CTE carries both under the name `asset`: an empty answer
    // scans the set without looking each id up in `asset` again.
    const materializedShared = (on: Kysely<DB>) =>
      on
        .with(
          (wb) => wb('scoped_assets').materialized(),
          () => scope()(on).select(['asset.id', 'asset.type']),
        )
        .selectNoFrom((eb) =>
          shared.map((name) => {
            const scoped = on.selectFrom(
              sql<{ id: string; type: AssetType }>`scoped_assets`.as('asset'),
            ) as unknown as ScopedAssets;
            return eb.exists(probes[name].build(scoped)).as(name);
          }),
        )
        .executeTakeFirstOrThrow() as Promise<Partial<SearchOptionsAvailability>>;
    const materializedOwn = (on: Kysely<DB>, name: AvailabilityFlag) =>
      exists(probes[name].build(materialized(on, probes[name].scope(on))));

    if (db.isTransaction) {
      // Query mode: the candidates live on this one connection, so the statements take turns. Its sets are bounded by
      // the candidates, so it goes straight to the materialised answer rather than spending a timeout per probe.
      const result: Partial<SearchOptionsAvailability> = shared.length > 0 ? await materializedShared(db) : {};
      const own = names.filter((name) => !shared.includes(name));
      for (const name of own) {
        result[name] = await materializedOwn(db, name);
      }
      return answer(names.map((name) => !!result[name]));
    }

    // Browse mode: each probe first tries its inline plan under a short statement timeout, and only a probe that runs
    // out of it waits for the materialised answer (the shared statement starts once, for the first such probe).
    let sharedResult: Promise<Partial<SearchOptionsAvailability>> | undefined;
    return answer(
      await Promise.all(
        names.map(async (name) => {
          const quick = await hedgedOnPool(db, this.fastProbeMs, (on) => this.probeInline(on, () => inline(on, name)));
          if (quick !== undefined) {
            return quick;
          }
          if (shared.includes(name)) {
            sharedResult ??= materializedShared(db);
            const result = await sharedResult;
            return !!result[name];
          }
          return materializedOwn(db, name);
        }),
      ),
    );
  }

  /**
   * Whether the people list would hold a named person: the list's own rules, as one EXISTS that stops at the first
   * named face. (Whether unnamed people appear needs every face checked when there are none, so it comes with the
   * people list instead.)
   */
  private searchOptionsPeopleProbe(scope: PeopleScope, scoped: ScopedAssets): AvailabilityQuery {
    const named = (column: string) => sql<SqlBool>`NULLIF(${sql.ref(column)}, '') IS NOT NULL`;
    const one = sql<number>`1`.as(SEARCH_OPTIONS_PROBE);

    if (scope.spaceId) {
      return scoped
        .innerJoin('asset_face as facet_face', 'facet_face.assetId', 'asset.id')
        .innerJoin('shared_space_person_face as facet_spf', 'facet_spf.assetFaceId', 'facet_face.id')
        .innerJoin('shared_space_person as facet_person', 'facet_person.id', 'facet_spf.personId')
        .select(one)
        .where('facet_person.spaceId', '=', asUuid(scope.spaceId))
        .where('facet_person.isHidden', '=', false)
        .where(liveFace('facet_face'))
        .where(named('facet_person.name'));
    }

    if (scope.timelineSpaceIds?.length) {
      return scoped
        .innerJoin('asset_face as facet_face', 'facet_face.assetId', 'asset.id')
        .innerJoin('face_identity_face as facet_fif', 'facet_fif.assetFaceId', 'facet_face.id')
        .select(one)
        .where(liveFace('facet_face'))
        .where(identityProfile(sql.ref('facet_fif.identityId'), scope.callerId, scope.timelineSpaceIds, true));
    }

    return scoped
      .innerJoin('asset_face as facet_face', 'facet_face.assetId', 'asset.id')
      .innerJoin('person as facet_person', 'facet_person.personGroupId', 'facet_face.personGroupId')
      .select(one)
      .where('facet_person.isHidden', '=', false)
      .where(liveFace('facet_face'))
      .where(named('facet_person.name'));
  }

  /** A browse availability probe's inline attempt, on its own so a test can make it run out of time. */
  protected probeInline(on: Kysely<DB>, probe: () => Promise<boolean>): Promise<boolean> {
    return probe();
  }

  private async getSearchOptionsPeople(
    db: Kysely<DB>,
    scope: PeopleScope,
    scoped: ScopedAssets,
  ): Promise<{ people: SearchOptionsPerson[]; hasUnnamedPeople: boolean }> {
    const spacePersonIds = new Set(scope.spacePersonIds);
    const personIds = new Set(scope.personIds);
    const count = sql<number>`count(DISTINCT "asset"."id")`.as('count');

    if (scope.spaceId) {
      const rows = await scoped
        .innerJoin('asset_face as facet_face', 'facet_face.assetId', 'asset.id')
        .innerJoin('shared_space_person_face as facet_spf', 'facet_spf.assetFaceId', 'facet_face.id')
        .innerJoin('shared_space_person as facet_person', 'facet_person.id', 'facet_spf.personId')
        .select(['facet_person.id', 'facet_person.name', 'facet_person.type'])
        .select(count)
        .where('facet_person.spaceId', '=', asUuid(scope.spaceId))
        .where('facet_person.isHidden', '=', false)
        .where(liveFace('facet_face'))
        .groupBy(['facet_person.id', 'facet_person.name', 'facet_person.type'])
        .execute();
      return {
        people: rows
          .filter((row) => !!row.name)
          .map((row) => ({
            id: row.id,
            filterId: row.id,
            name: row.name,
            primaryProfile: { type: 'space-person' as const, id: row.id, spaceId: scope.spaceId },
            count: Number(row.count),
            isSelected: spacePersonIds.has(row.id),
            isPet: row.type === 'pet',
          }))
          .toSorted(byPersonCount),
        hasUnnamedPeople: rows.some((row) => !row.name),
      };
    }

    if (scope.timelineSpaceIds?.length) {
      const identityIds = new Set(scope.identityIds);
      // 64MB lets the planner hash the ~1M (identity, asset) pairs of a large library instead of sorting them on disk:
      // 2.0 s -> 1.7 s for 617k assets (specs/research/2026-10-23-search-options-500k-benchmark.md).
      const spaceIds = scope.timelineSpaceIds;
      const result = await inTransaction(db, async (trx) => {
        await sql`SET LOCAL work_mem = '64MB'`.execute(trx);
        return getFilteredIdentityPeopleWithCounts(scoped.select('asset.id'), scope.callerId, spaceIds, trx);
      });
      return {
        people: result.people
          .map(({ identityId, ...person }) => ({
            ...person,
            filterId: person.id,
            isSelected:
              identityIds.has(identityId) ||
              (person.primaryProfile?.type === 'user-person' && personIds.has(person.primaryProfile.id)) ||
              (person.primaryProfile?.type === 'space-person' && spacePersonIds.has(person.primaryProfile.id)),
          }))
          .toSorted(byPersonCount),
        hasUnnamedPeople: result.hasUnnamedPeople,
      };
    }

    const rows = await scoped
      .innerJoin('asset_face as facet_face', 'facet_face.assetId', 'asset.id')
      .innerJoin('person as facet_person', 'facet_person.personGroupId', 'facet_face.personGroupId')
      .select(['facet_person.personGroupId as id', 'facet_person.name'])
      .select(personIsPet('facet_person').as('isPet'))
      .select(count)
      .where('facet_person.isHidden', '=', false)
      .where(liveFace('facet_face'))
      .groupBy(['facet_person.personGroupId', 'facet_person.name'])
      .execute();
    return {
      people: rows
        .filter((row) => !!row.name)
        .map((row) => ({
          id: row.id,
          filterId: row.id,
          name: row.name,
          primaryProfile: { type: 'user-person' as const, id: row.id },
          count: Number(row.count),
          isSelected: personIds.has(row.id),
          isPet: !!row.isPet,
        }))
        .toSorted(byPersonCount),
      hasUnnamedPeople: rows.some((row) => !row.name),
    };
  }

  private buildSmartFacetCandidateQuery(kysely: Kysely<DB>, options: SmartSearchFacetsOptions) {
    const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);

    return searchAssetBuilderLegacy(kysely, {
      ...without(
        options,
        'city',
        'country',
        'make',
        'model',
        'rating',
        'type',
        'isFavorite',
        'isInAlbum',
        'isNotInAlbum',
        'takenAfter',
        'takenBefore',
        'personIds',
        'personMatchAny',
        'identityIds',
        'forceEmptyResult',
        'spacePersonIds',
        'tagIds',
        'tagMatchAny',
      ),
      ratingIsMinimum: true,
    })
      .select('asset.id')
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(hasDistanceThreshold, (qb) =>
        qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
      )
      .where('smart_search.embedding', 'is not', null);
  }

  private async createSmartFacetCandidates(trx: Kysely<DB>, options: SmartSearchFacetsOptions) {
    await sql`drop table if exists smart_search_facet_candidates`.execute(trx);
    await sql`
      create temporary table smart_search_facet_candidates on commit drop as
      ${this.buildSmartFacetCandidateQuery(trx, options)}
    `.execute(trx);
    await sql`create index smart_search_facet_candidates_asset_id_idx on smart_search_facet_candidates ("id")`.execute(
      trx,
    );
  }

  private buildSmartFacetFilteredAssetIds(
    kysely: Kysely<DB>,
    options: SmartSearchFacetsOptions,
    exclude?: SmartFacetExclude,
  ) {
    // #763: same caller resolution as getSmartFacetHasFavorites — `authUserId` and `callerId` are two
    // names for the viewer on this path, and `userIds[0]` is deliberately not consulted (it is not the
    // caller under an album scope). Only read when `isFavorite` is set, and the assertion holds for
    // every production caller: SearchService.resolveSmartSearch is the only one, and it always sets
    // both alongside any client-supplied `isFavorite`.
    const facetCallerId = options.authUserId ?? options.callerId;

    return kysely
      .selectFrom('asset')
      .select('asset.id')
      .where(
        'asset.id',
        'in',
        kysely.selectFrom(sql<{ id: string }>`smart_search_facet_candidates`.as('candidates')).select('candidates.id'),
      )
      .$call((qb) => withAssetFilter(qb, options, exclude && smartFacetFilterExcludes[exclude]))
      .$if(exclude !== 'media' && !!options.type, (qb) => qb.where('asset.type', '=', options.type!))
      .$if(exclude !== 'favorites' && options.isFavorite !== undefined, (qb) =>
        qb.where((eb) =>
          options.isFavorite ? favoriteExistsFor(eb, facetCallerId!) : eb.not(favoriteExistsFor(eb, facetCallerId!)),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isNotInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) => eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
      )
      .$if(exclude !== 'people' && !!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
      .$if(exclude !== 'people' && !!options.identityIds?.length, (qb) =>
        qb.where((eb) =>
          eb.and(
            options.identityIds!.map((identityId) =>
              eb.exists(
                eb
                  .selectFrom('asset_face')
                  .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
                  .whereRef('asset_face.assetId', '=', 'asset.id')
                  .where('asset_face.deletedAt', 'is', null)
                  .where('asset_face.isVisible', 'is', true)
                  .where('face_identity_face.identityId', '=', asUuid(identityId)),
              ),
            ),
          ),
        ),
      )
      .$if(exclude !== 'people' && !!options.spacePersonIds?.length, (qb) =>
        hasSpacePeople(qb, options.spacePersonIds!),
      )
      .$if(exclude !== 'tags' && !!options.tagIds?.length, (qb) => hasTags(qb, options.tagIds!))
      .$if(exclude !== 'tags' && options.tagIds === null, (qb) =>
        qb.where((eb) => eb.not(eb.exists((eb) => eb.selectFrom('tag_asset').whereRef('assetId', '=', 'asset.id')))),
      )
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`));
  }

  private async getSmartFacetTotal(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number> {
    const row = await trx
      .selectFrom(this.buildSmartFacetFilteredAssetIds(trx, options).as('filtered'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async getSmartFacetTimeBuckets(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ timeBucket: string; count: number }>> {
    return trx
      .with('asset', (qb) =>
        qb
          .selectFrom('asset')
          .select(truncatedDate<Date>().as('timeBucket'))
          .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'time')),
      )
      .selectFrom('asset')
      .select(sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy('timeBucket')
      .orderBy('timeBucket', 'desc')
      .execute() as Promise<Array<{ timeBucket: string; count: number }>>;
  }

  private async getSmartFacetCountries(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'location'))
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();
    return rows.map((row) => row.country!);
  }

  private async getSmartFacetCities(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('city')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'city'))
      .where('city', 'is not', null)
      .where('city', '!=', '')
      .orderBy('city')
      .execute();
    return rows.map((row) => row.city!);
  }

  private async getSmartFacetCameraMakes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'camera'))
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();
    return rows.map((row) => row.make!);
  }

  private async getSmartFacetCameraModels(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('model')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'cameraModel'))
      .where('model', 'is not', null)
      .where('model', '!=', '')
      .orderBy('model')
      .execute();
    return rows.map((row) => row.model!);
  }

  private async getSmartFacetTags(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    return trx
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .where('tag_asset.assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'tags'))
      .orderBy('tag.value')
      .execute();
  }

  private async getSmartFacetPeople(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const filteredIds = this.buildSmartFacetFilteredAssetIds(trx, options, 'people');

    if (options.spaceId) {
      const spacePeople = await trx
        .selectFrom('shared_space_person')
        .select(['shared_space_person.id', 'shared_space_person.name'])
        .where('shared_space_person.spaceId', '=', asUuid(options.spaceId))
        .where('shared_space_person.isHidden', '=', false)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('shared_space_person_face')
              .innerJoin('asset_face as af', 'af.id', 'shared_space_person_face.assetFaceId')
              .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
              .where('af.deletedAt', 'is', null)
              .where('af.isVisible', 'is', true)
              .where('af.assetId', 'in', filteredIds),
          ),
        )
        .orderBy(sql`nullif("shared_space_person"."name", '')`)
        .orderBy('shared_space_person.id')
        .execute();

      const people = spacePeople
        .map((person) => ({
          id: person.id,
          name: person.name || '',
          primaryProfile: { type: 'space-person' as const, id: person.id, spaceId: options.spaceId },
        }))
        .filter((person) => person.name !== '')
        .toSorted((a, b) => a.name.localeCompare(b.name));

      const hasUnnamedPeople = spacePeople.some((person) => !person.name);

      return { people, hasUnnamedPeople };
    }

    if (options.timelineSpaceIds?.length) {
      // `callerId`, not `userIds[0]`: an album-scoped search has no owner scoping at all.
      return getFilteredIdentityPeople(
        filteredIds,
        options.callerId ?? options.userIds?.[0] ?? '',
        options.timelineSpaceIds,
        trx,
      );
    }

    const peopleRows = await trx
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .orderBy('person.name')
      .execute();
    const people = peopleRows.map((person) => ({
      ...person,
      primaryProfile: { type: 'user-person' as const, id: person.id },
    }));

    const unnamed = await trx
      .selectFrom('person')
      .select(sql`1`.as('exists'))
      .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return { people, hasUnnamedPeople: !!unnamed };
  }

  private async getSmartFacetRatings(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('rating')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'rating'))
      .where('rating', 'is not', null)
      .where('rating', '>', 0)
      .orderBy('rating')
      .execute();
    return rows.map((row) => row.rating!);
  }

  private async getSmartFacetMediaTypes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<AssetType[]> {
    const rows = await trx
      .selectFrom('asset')
      .select('type')
      .distinct()
      .where('id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'media'))
      .orderBy('type')
      .execute();
    return rows.map((row) => row.type);
  }

  private async getSmartFacetHasFavorites(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<boolean> {
    // #763: "is the Favourites section worth offering" is a per-CALLER question — probe the
    // caller's `asset_favorite` overlay, not `asset.isFavorite`, which projects only the owner's favorite.
    //
    // The caller is `authUserId`/`callerId` — two names for the same value (`auth.user.id`, set by
    // SearchService.resolveSmartSearch), one from this path's search-builder options and one from
    // SearchEmbeddingOptions. Deliberately NOT `userIds[0]`: unlike the browse path, where
    // getUserIdsToSearch guarantees `[auth.user.id, ...partnerIds]`, `userIds` here is left unset
    // entirely under an album scope (see SearchEmbeddingOptions.userIds and the `callerId` note in
    // getSmartFacetPeople). Probing `userIds[0]` there would answer for whichever owner happened to
    // head an owner-scoping array — another user's favourite state, surfaced in my UI.
    //
    // With no caller in scope there is no per-user answer, so the section is simply not offered.
    // That is the fail-safe direction — it can only hide a filter, never reveal someone else's
    // favourites — and it is consistent with what the section would do if shown: the `isFavorite`
    // filter behind it needs a caller too. Mirrors the `.$if(!!authUserId, ...)` fail-safe the
    // overlay projections use in asset.repository.ts.
    const callerId = options.authUserId ?? options.callerId;
    if (!callerId) {
      return false;
    }

    const row = await trx
      .selectFrom('asset')
      .select('asset.id')
      // #763: same widening as getFilteredHasFavorites — the favourites facet spans every space the
      // caller belongs to, while every other facet keeps the timeline-visible scope.
      .where(
        'asset.id',
        'in',
        this.buildSmartFacetFilteredAssetIds(
          trx,
          { ...options, timelineSpaceIds: options.favoriteSpaceIds ?? options.timelineSpaceIds },
          'favorites',
        ),
      )
      .where((eb) => favoriteExistsFor(eb, callerId))
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  private async getSmartFacetAlbumMembership(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      trx
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'albums'))
        .where((eb) => {
          const inAlbum = eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'));
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }
}
