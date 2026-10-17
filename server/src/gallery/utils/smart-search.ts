import { type Kysely, type OrderByDirection, type SqlBool, sql } from 'kysely';
import type { SearchPaginationOptions, SmartSearchOptions } from 'src/repositories/search.repository.js';
import { projectedDuration } from 'src/gallery/utils/projected-duration.js';
import { DB } from 'src/schema/index.js';
import { searchAssetBuilderWithLocalTaken } from 'src/utils/asset-filter.js';
import { anyUuid, asUuid } from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { without } from 'src/utils/filter-suggestions.js';

/** Skip threshold when disabled (0), undefined, or at max cosine distance (>= 2) since it would filter nothing */
export function isActiveDistanceThreshold(maxDistance: number | undefined): boolean {
  return (maxDistance ?? 0) > 0 && (maxDistance ?? 0) < 2;
}

export function buildSearchSmartQueries(
  kysely: Kysely<DB>,
  pagination: SearchPaginationOptions,
  options: SmartSearchOptions,
) {
  const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);
  const personIds = options.personIds?.filter(Boolean) ?? [];
  const identityIds = options.identityIds?.filter(Boolean) ?? [];

  let baseQuery = searchAssetBuilderWithLocalTaken(kysely, {
    ...without(options, 'personIds', 'personMatchAny', 'identityIds', 'forceEmptyResult'),
    ratingIsMinimum: true,
  })
    .selectAll('asset')
    .select(projectedDuration)
    // #763: project the per-user overlay onto the rows feeding mapAsset via searchSmart's
    // mapResponse. Flows through both the 'cte' (candidates.selectAll()) and 'simple' outer
    // query paths below since both select every column baseQuery projects.
    .$if(!!options.authUserId, (qb) =>
      qb.select((eb) => favoriteExistsFor(eb, options.authUserId!).as('isFavoriteForUser')),
    )
    .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
    .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
    .$if(hasDistanceThreshold, (qb) =>
      qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
    )
    // DO NOT add a secondary ORDER BY key on any column here.
    // vchord's ordered index scan can only satisfy a single-key ORDER BY on
    // `smart_search.embedding <=>`. Any additional sort key forces the planner
    // to Parallel Seq Scan + in-memory sort (~15s on 200k rows vs ~200ms via
    // vchord). Cross-page duplicates from identical embeddings are caught by
    // the frontend dedup in web/src/lib/utils/search-dedup.ts.
    .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);

  if (personIds.length > 0) {
    // Keep the smart_search ordered scan as the driving path. Materializing the
    // full matching asset_face set first pushes the planner back to tens of
    // thousands of smart_search PK lookups on person-filtered queries.
    baseQuery = baseQuery.where((eb) => {
      const hasVisiblePersonFace = (personId: string | string[]) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.personGroupId', '=', Array.isArray(personId) ? anyUuid(personId) : asUuid(personId)),
        );

      return options.personMatchAny
        ? hasVisiblePersonFace(personIds)
        : eb.and(personIds.map((personId) => hasVisiblePersonFace(personId)));
    });
  }

  if (identityIds.length > 0) {
    baseQuery = baseQuery.where((eb) =>
      eb.and(
        identityIds.map((identityId) =>
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
    );
  }

  if (options.orderDirection) {
    const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
    const candidates = baseQuery.limit(500).as('candidates');
    const outerQuery = kysely
      .selectFrom(candidates)
      .selectAll()
      // sql.raw is safe here — orderDirection is validated to 'asc'|'desc' by the AssetOrder enum
      .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
      // Stable tiebreaker (same rationale as the base query)
      .orderBy('candidates.id')
      .limit(pagination.size + 1)
      .offset((pagination.page - 1) * pagination.size);
    return { kind: 'cte' as const, base: baseQuery, outer: outerQuery };
  }

  const outerQuery = baseQuery.limit(pagination.size + 1).offset((pagination.page - 1) * pagination.size);

  return { kind: 'simple' as const, base: baseQuery, outer: outerQuery };
}
