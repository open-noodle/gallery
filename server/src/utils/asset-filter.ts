import { Expression, Kysely, SelectQueryBuilder, SqlBool, expressionBuilder, sql } from 'kysely';
import type { AssetAspectClass } from 'src/enum.js';
import { ASPECT_CLASS_QUALIFIED_SQL } from 'src/gallery/utils/aspect-class-sql.js';
import { withLibraryView } from 'src/gallery/utils/library-view.js';
import type { AssetSearchBuilderOptions } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { searchAssetBuilderLegacy } from 'src/utils/database.js';
import { without } from 'src/utils/filter-suggestions.js';
import type { ViewerScope } from 'src/utils/viewer-scope.js';

/**
The filter panel's shared vocabulary, defined once for every fork surface that answers it: the
timeline buckets, filter suggestions, smart-search facets, the filtered map, the space people
lists, and the taken range of search results (searchAssetBuilderWithLocalTaken below). Viewer
scope (owner / space / visibility) is NOT part of it; each caller keeps its own.

- taken: `asset.localDateTime`, the wall-clock time the timeline groups its buckets by, so a month
  a client sends is the same month the grid shows. `takenAfter` is inclusive, `takenBefore`
  exclusive. Clients send wall-clock ranges as UTC: the start of the first day and the start of
  the day after the last one (web filter-panel.ts, mobile search_api.repository.dart).
- place/camera: `null` means "has no value" (IS NULL), `undefined` and `''` mean "no filter".
- rating: a minimum (`>=`); `null` means unrated.
- aspectClasses: any of the classes; an empty list means "no filter". An asset without dimensions has no class.

`searchAssetBuilderLegacy` itself is upstream and untouched (fileCreatedAt, inclusive bound, exact
rating unless `ratingIsMinimum`); see specs/2026-07-23-search-v3-coexistence-design.md.
*/
export interface AssetFilter {
  takenAfter?: Date | string;
  takenBefore?: Date | string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  rating?: number | null;
  aspectClasses?: AssetAspectClass[];
}

export const assetFilterKeys = [
  'takenAfter',
  'takenBefore',
  'country',
  'state',
  'city',
  'make',
  'model',
  'lensModel',
  'rating',
  'aspectClasses',
] as const satisfies (keyof AssetFilter)[];

const exifColumns = ['country', 'state', 'city', 'make', 'model', 'lensModel'] as const;

/**
The class condition, in the exact form asset_aspectClass_idx needs. The values are literals so the index is used
regardless of plan caching; they are validated against the enum before they get here.
*/
export const aspectClassCondition = (classes: readonly AssetAspectClass[]) =>
  sql<SqlBool>`${sql.raw(ASPECT_CLASS_QUALIFIED_SQL)} in (${sql.join(classes.map((value) => sql.lit(value)))})`;

/** One condition per active filter, minus the `exclude`d keys (a facet listing its own values). */
export function assetFilterConditions(
  filter: AssetFilter,
  exclude: readonly (keyof AssetFilter)[] = [],
): Expression<SqlBool>[] {
  const f = without(filter, ...exclude);
  const eb = expressionBuilder<DB, 'asset'>();
  const conditions: Expression<SqlBool>[] = [];
  if (f.takenAfter) {
    conditions.push(eb('asset.localDateTime', '>=', new Date(f.takenAfter)));
  }
  if (f.takenBefore) {
    conditions.push(eb('asset.localDateTime', '<', new Date(f.takenBefore)));
  }

  const exif = exifColumns.filter((column) => f[column] !== undefined && f[column] !== '');
  if (exif.length > 0 || f.rating !== undefined) {
    conditions.push(
      eb.exists(
        eb
          .selectFrom('asset_exif')
          .whereRef('asset_exif.assetId', '=', 'asset.id')
          .where((eb) =>
            eb.and([
              ...exif.map((column) => eb(`asset_exif.${column}`, f[column] === null ? 'is' : '=', f[column]!)),
              ...(f.rating === undefined ? [] : [eb('asset_exif.rating', f.rating === null ? 'is' : '>=', f.rating)]),
            ]),
          ),
      ),
    );
  }

  if (f.aspectClasses?.length) {
    conditions.push(aspectClassCondition(f.aspectClasses));
  }

  return conditions;
}

/** Applies {@link assetFilterConditions} to a query that has `asset` in scope. */
export function withAssetFilter<T extends SelectQueryBuilder<DB, any, any>>(
  qb: T,
  filter: AssetFilter,
  exclude?: readonly (keyof AssetFilter)[],
): T {
  let query: SelectQueryBuilder<DB, any, any> = qb;
  for (const condition of assetFilterConditions(filter, exclude)) {
    query = query.where(condition);
  }
  return query as T;
}

/**
Upstream search (`searchAssetBuilderLegacy`) with its taken range swapped for this module's, so
search results agree with the timeline, suggestions and facets, and narrowed to the timeline's
library view (#1038). Everything else stays upstream.
A stock or third-party client (`upstreamTakenRange`, set by resolveViewerScope) builds its range from
device-local instants for upstream's inclusive `fileCreatedAt` bounds, so it gets upstream's builder unchanged.
*/
export function searchAssetBuilderWithLocalTaken(
  kysely: Kysely<DB>,
  options: AssetSearchBuilderOptions & Pick<ViewerScope, 'upstreamTakenRange'> & Pick<AssetFilter, 'aspectClasses'>,
) {
  const libraryView = { ...options, callerId: options.authUserId };
  const { aspectClasses } = options;
  if (options.upstreamTakenRange) {
    return withLibraryView(withAssetFilter(searchAssetBuilderLegacy(kysely, options), { aspectClasses }), libraryView);
  }
  const query = withAssetFilter(searchAssetBuilderLegacy(kysely, without(options, 'takenAfter', 'takenBefore')), {
    takenAfter: options.takenAfter,
    takenBefore: options.takenBefore,
    aspectClasses,
  });
  return withLibraryView(query, libraryView);
}
