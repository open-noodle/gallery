// server/src/repositories/search.repository.spec.ts
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { AssetOrder, AssetVisibility } from 'src/enum';
import { SearchRepository } from 'src/repositories/search.repository';
import type { DB } from 'src/schema';
import { searchAssetBuilderLegacy } from 'src/utils/database';
import { describe, expect, it } from 'vitest';

// Offline Kysely — compiles SQL without executing it. No DB connection needed.
const offlineKysely = () =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

// Access the private helper via `any` — private methods are implementation
// detail, but testing SQL shape is the whole point of this spec.
const buildQueries = (
  sut: SearchRepository,
  pagination: { page: number; size: number },
  options: Record<string, unknown>,
) => (sut as any).buildSearchSmartQueries(offlineKysely(), pagination, options);

const compileAssetSearch = (options: Record<string, unknown>) =>
  searchAssetBuilderLegacy(offlineKysely(), options as any)
    .selectAll('asset')
    .compile();

const buildAssetSearchSql = (options: Record<string, unknown>) => compileAssetSearch(options).sql;

const compileFilteredAssetIds = (sut: SearchRepository, options: Record<string, unknown>) =>
  (sut as any).buildFilteredAssetIds(['00000000-0000-0000-0000-000000000000'], options).compile().sql;

// A fresh repository whose private buildFilteredAssetIds is spied on rather than mocked, so the
// suggestion queries still compile and run against the DummyDriver (empty rows) — what is asserted
// is the *options* each list narrows by. Fresh per test so no spy state leaks between them.
const spyOnFilteredAssetIds = () => {
  const repository = new SearchRepository(offlineKysely());
  const spy = vi.spyOn(repository as any, 'buildFilteredAssetIds');
  return { repository, options: () => spy.mock.calls.map((call) => call[1] as Record<string, unknown>) };
};

const compileFilteredPeopleQuery = (sut: SearchRepository, options: Record<string, unknown>) =>
  (sut as any)
    .buildFilteredGlobalPeopleQuery(
      (sut as any).buildFilteredAssetIds(['00000000-0000-0000-0000-000000000000'], options),
    )
    .compile().sql;

const compileFilteredSpacePeopleQuery = (sut: SearchRepository, options: Record<string, unknown>) =>
  (sut as any)
    .buildFilteredSpacePeopleQuery(
      (sut as any).buildFilteredAssetIds(['00000000-0000-0000-0000-000000000000'], options),
      '11111111-1111-1111-1111-111111111111',
    )
    .compile().sql;

const buildFacetCandidateSql = (sut: SearchRepository, options: Record<string, unknown>) =>
  (sut as any).buildSmartFacetCandidateQuery(offlineKysely(), options).compile().sql;

const buildFacetFilteredIdsSql = (
  sut: SearchRepository,
  options: Record<string, unknown>,
  exclude?: 'time' | 'people' | 'location' | 'city' | 'camera' | 'cameraModel' | 'tags' | 'rating' | 'media',
) => (sut as any).buildSmartFacetFilteredAssetIds(offlineKysely(), options, exclude).compile().sql;

const FAILURE_MESSAGE =
  'Do not add any secondary ORDER BY key to the inner searchSmart query. ' +
  'See comment at src/repositories/search.repository.ts (above the orderBy call). ' +
  'Secondary ORDER BY keys force Parallel Seq Scan on smart_search instead of ' +
  'the vchord clip_index ordered scan (~100× slowdown at 200k rows).';

const countOrderByExpressions = (compiledSql: string, anchor: string): number => {
  // Find the ORDER BY that immediately precedes the given anchor (or LIMIT/OFFSET).
  // Kysely's PostgresQueryCompiler emits a single-line compact SQL string.
  const orderByRegex = /order by\s+([\s\S]+?)\s+(?:limit\b|offset\b|\)\s+as\b)/gi;
  const matches = compiledSql.matchAll(orderByRegex).toArray();
  const match = matches.find((m) => compiledSql.indexOf(anchor) > compiledSql.indexOf(m[0]));
  if (!match) {
    throw new Error(`no ORDER BY before anchor "${anchor}" in: ${compiledSql}`);
  }
  return match[1].split(',').filter((s) => s.trim().length > 0).length;
};

// Count ORDER BY expressions in the OUTER (last) ORDER BY clause — the one after
// `) as "candidates"`. Used for the CTE path, where the inner subquery also has
// its own ORDER BY.
const countOuterOrderByExpressions = (compiledSql: string): number => {
  const orderByRegex = /order by\s+([\s\S]+?)\s+(?:limit\b|offset\b)/gi;
  const matches = compiledSql.matchAll(orderByRegex).toArray();
  if (matches.length === 0) {
    throw new Error(`no ORDER BY in: ${compiledSql}`);
  }
  const last = matches.at(-1)!;
  return last[1].split(',').filter((s) => s.trim().length > 0).length;
};

const countMatches = (compiledSql: string, pattern: RegExp): number => {
  return compiledSql.matchAll(pattern).toArray().length;
};

describe(SearchRepository.name, () => {
  const sut = new SearchRepository(offlineKysely());

  const baseOptions = {
    embedding: `[${Array.from({ length: 512 }, () => 0.01).join(',')}]`,
    userIds: ['00000000-0000-0000-0000-000000000000'],
    maxDistance: 0.5,
  };

  describe('smart facets query shape', () => {
    it('builds one unordered candidate query from smart_search and does not page-limit facets', () => {
      const sql = buildFacetCandidateSql(sut, {
        ...baseOptions,
        city: 'Berlin',
        personIds: ['00000000-0000-0000-0000-000000000001'],
        tagIds: ['00000000-0000-0000-0000-000000000002'],
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        orderDirection: AssetOrder.Desc,
      });

      expect(sql).toContain('"smart_search"');
      expect(sql).toMatch(/smart_search\.embedding\s*<=>/i);
      expect(sql).not.toMatch(/\border by\b/i);
      expect(sql).not.toMatch(/\blimit\b/i);
      expect(sql).not.toContain('"asset_exif"."city"');
      expect(sql).not.toContain('"tag_asset"');
      expect(sql).not.toContain('"asset_face"');
    });

    it('time bucket filtering excludes only takenAfter and takenBefore', () => {
      const sql = buildFacetFilteredIdsSql(
        sut,
        {
          ...baseOptions,
          takenAfter: new Date('2024-01-01T00:00:00.000Z'),
          takenBefore: new Date('2025-01-01T00:00:00.000Z'),
          country: 'Germany',
          rating: 4,
        },
        'time',
      );

      expect(sql).not.toMatch(/"asset"\."fileCreatedAt"\s*>?=/i);
      expect(sql).not.toMatch(/"asset"\."fileCreatedAt"\s*</i);
      expect(sql).toContain('"asset_exif"."country"');
      expect(sql).toMatch(/"asset_exif"\."rating"\s*>=\s*\$\d+/i);
    });

    it('people filtering excludes global and space people filters', () => {
      const sql = buildFacetFilteredIdsSql(
        sut,
        {
          ...baseOptions,
          personIds: ['00000000-0000-0000-0000-000000000001'],
          spacePersonIds: ['00000000-0000-0000-0000-000000000002'],
          country: 'Germany',
        },
        'people',
      );

      expect(sql).not.toContain('"asset_face"."personId"');
      expect(sql).not.toContain('"shared_space_person_face"."personId"');
      expect(sql).toContain('"asset_exif"."country"');
    });

    it('location, camera, tags, rating, and media each exclude only their own group', () => {
      const locationSql = buildFacetFilteredIdsSql(
        sut,
        { ...baseOptions, country: 'Germany', city: 'Berlin' },
        'location',
      );
      const citySql = buildFacetFilteredIdsSql(sut, { ...baseOptions, country: 'Germany', city: 'Berlin' }, 'city');
      const cameraSql = buildFacetFilteredIdsSql(sut, { ...baseOptions, make: 'Sony', model: 'A7' }, 'camera');
      const modelSql = buildFacetFilteredIdsSql(sut, { ...baseOptions, make: 'Sony', model: 'A7' }, 'cameraModel');
      const tagsSql = buildFacetFilteredIdsSql(
        sut,
        { ...baseOptions, tagIds: ['00000000-0000-0000-0000-000000000001'] },
        'tags',
      );
      const ratingSql = buildFacetFilteredIdsSql(sut, { ...baseOptions, rating: 5 }, 'rating');
      const mediaSql = buildFacetFilteredIdsSql(sut, { ...baseOptions, type: 'IMAGE' }, 'media');

      expect(locationSql).not.toContain('"asset_exif"."country"');
      expect(locationSql).not.toContain('"asset_exif"."city"');
      expect(citySql).toContain('"asset_exif"."country"');
      expect(citySql).not.toContain('"asset_exif"."city"');
      expect(cameraSql).not.toContain('"asset_exif"."make"');
      expect(cameraSql).not.toContain('"asset_exif"."model"');
      expect(modelSql).toContain('"asset_exif"."make"');
      expect(modelSql).not.toContain('"asset_exif"."model"');
      expect(tagsSql).not.toContain('"tag_asset"');
      expect(ratingSql).not.toMatch(/"asset_exif"\."rating"\s*>=/i);
      expect(mediaSql).not.toContain('"asset"."type" =');
    });

    it('rating null filters for unrated assets instead of using minimum rating comparison', () => {
      const sql = buildFacetFilteredIdsSql(sut, { ...baseOptions, rating: null });

      expect(sql).toMatch(/"asset_exif"\."rating"\s+is\s+null/i);
      expect(sql).not.toMatch(/"asset_exif"\."rating"\s*>=/i);
    });

    it('total filtering keeps current smart-search rating, person, and tag semantics', () => {
      const sql = buildFacetFilteredIdsSql(sut, {
        ...baseOptions,
        rating: 4,
        personIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
        tagIds: ['00000000-0000-0000-0000-000000000003'],
      });

      expect(sql).toMatch(/"asset_exif"\."rating"\s*>=\s*\$\d+/i);
      expect(sql).toContain('"asset_face"');
      expect(sql).toContain('"tag_asset"');
    });

    it('space person filters emit one EXISTS per selected space person for smart facet totals', () => {
      const sql = buildFacetFilteredIdsSql(sut, {
        ...baseOptions,
        spacePersonIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
      });
      expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
      expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
    });

    it('candidate query omits the distance threshold when maxDistance is disabled', () => {
      const sql = buildFacetCandidateSql(sut, { ...baseOptions, maxDistance: 0 });

      expect(sql).toContain('"smart_search"."embedding" is not null');
      expect(sql).not.toMatch(/smart_search\.embedding\s*<=>/i);
      expect(sql).not.toMatch(/\(smart_search\.embedding <=> \$\d+\)\s*<=/i);
    });
  });

  describe('searchSmart query shape', () => {
    it('applies rating as an inclusive threshold when combined with other filters', () => {
      const { base } = buildQueries(
        sut,
        { page: 1, size: 100 },
        {
          ...baseOptions,
          personIds: ['00000000-0000-0000-0000-000000000001'],
          rating: 2,
        },
      );
      const innerSql = base.compile().sql;

      expect(innerSql).toMatch(/rating"?\s*>=\s*\$\d+/i);
      expect(innerSql).not.toMatch(/rating"?\s*=\s*\$\d+/i);
    });

    it('keeps unrated smart-search filters as IS NULL', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, rating: null });
      const innerSql = base.compile().sql;

      expect(innerSql).toMatch(/rating"?\s+is\s+null/i);
      expect(innerSql).not.toMatch(/rating"?\s*>=\s*\$\d+/i);
      expect(innerSql).not.toMatch(/rating"?\s*=\s*\$\d+/i);
    });

    it('keeps the inner smart-search ORDER BY single-key when rating uses the CTE path', () => {
      const { base, outer } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, orderDirection: AssetOrder.Desc, rating: 4 },
      );

      const innerSql = base.compile().sql;
      expect(innerSql).toMatch(/rating"?\s*>=\s*\$\d+/i);
      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);

      const outerSql = outer.compile().sql;
      expect(countOuterOrderByExpressions(outerSql), 'outer CTE ORDER BY must stay at 2 keys').toBe(2);
    });

    it('non-CTE inner ORDER BY: exactly one expression AND primary key is smart_search.embedding', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, baseOptions);
      const innerSql = base.compile().sql;

      const keys = countOrderByExpressions(innerSql + ' limit', 'limit');
      expect(keys, FAILURE_MESSAGE).toBe(1);

      expect(innerSql, 'primary ORDER BY must be on smart_search.embedding <=>').toMatch(
        /order by\s+smart_search\.embedding\s*<=>/i,
      );
    });

    it('CTE path orderDirection=desc: inner single key is embedding, outer has fileCreatedAt + candidates.id', () => {
      const { base, outer } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, orderDirection: AssetOrder.Desc },
      );

      // Inner query (subject to vchord): single-key ORDER BY on embedding.
      const innerSql = base.compile().sql;
      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
      expect(innerSql, 'inner primary ORDER BY must be on smart_search.embedding <=>').toMatch(
        /order by\s+smart_search\.embedding\s*<=>/i,
      );

      // Outer (CTE wrapper, materialized 500 rows): tiebreaker IS retained here by design.
      const outerSql = outer.compile().sql;
      expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+desc/i);
      expect(outerSql).toContain('"candidates"."id"');
      // Also: outer ORDER BY must have exactly 2 keys (fileCreatedAt + candidates.id);
      // any third key here would be a new, undocumented tiebreaker.
      const outerKeys = countOuterOrderByExpressions(outerSql);
      expect(outerKeys, 'outer CTE ORDER BY must be exactly (fileCreatedAt, candidates.id)').toBe(2);
    });

    it('CTE path orderDirection=asc: inner single key is embedding, outer sorts ascending', () => {
      const { base, outer } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, orderDirection: AssetOrder.Asc },
      );

      const innerSql = base.compile().sql;
      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
      expect(innerSql, 'inner primary ORDER BY must be on smart_search.embedding <=>').toMatch(
        /order by\s+smart_search\.embedding\s*<=>/i,
      );

      const outerSql = outer.compile().sql;
      expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+asc/i);
      expect(outerSql).toContain('"candidates"."id"');
      expect(countOuterOrderByExpressions(outerSql), 'outer must be 2 keys').toBe(2);
    });

    it('no-maxDistance path: single key is embedding, no distance WHERE predicate', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, maxDistance: undefined });
      const innerSql = base.compile().sql;

      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
      expect(innerSql, 'primary ORDER BY must be on smart_search.embedding <=>').toMatch(
        /order by\s+smart_search\.embedding\s*<=>/i,
      );

      // No WHERE predicate on the distance operator (<=>).
      expect(innerSql).not.toMatch(/\(smart_search\.embedding <=> \$\d+\)\s*<=/i);
    });

    it('personIds path uses correlated EXISTS instead of joining grouped asset_face rows', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, personIds: ['person-1'] });
      const innerSql = base.compile().sql;

      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
      expect(innerSql).toMatch(/exists\s*\(select\b[\s\S]+from\s+"asset_face"/i);
      expect(innerSql).toMatch(/"asset_face"\."assetId"\s*=\s*"asset"\."id"/i);
      expect(innerSql).not.toMatch(/join\s+\(select\s+"assetId"\s+from\s+"asset_face"/i);
      expect(innerSql).not.toMatch(/group by\s+"assetId"/i);
    });

    it('personIds all-match path emits one correlated EXISTS per person', () => {
      const { base } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, personIds: ['person-1', 'person-2'] },
      );
      const innerSql = base.compile().sql;

      expect(countMatches(innerSql, /exists\s*\(select\b[\s\S]+?from\s+"asset_face"/gi)).toBe(2);
      expect(innerSql).not.toMatch(/having\s+count\(distinct\s+"personId"\)/i);
    });

    it('personIds any-match path uses a single correlated EXISTS with any(uuid[])', () => {
      const { base } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, personIds: ['person-1', 'person-2'], personMatchAny: true },
      );
      const innerSql = base.compile().sql;

      expect(countMatches(innerSql, /exists\s*\(select\b[\s\S]+?from\s+"asset_face"/gi)).toBe(1);
      expect(innerSql).toMatch(/"asset_face"\."personGroupId"\s*=\s*any\(\$[\d]+::uuid\[\]\)/i);
    });

    it('identityIds path filters through face_identity_face with correlated EXISTS', () => {
      const { base } = buildQueries(
        sut,
        { page: 1, size: 100 },
        { ...baseOptions, identityIds: ['00000000-0000-0000-0000-000000000001'] },
      );
      const innerSql = base.compile().sql;

      expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
      expect(innerSql).toContain('"face_identity_face"');
      expect(innerSql).toMatch(/"face_identity_face"\."identityId"\s*=\s*\$\d+::uuid/i);
    });
  });

  describe('filter suggestions query shape', () => {
    it('uses minimum-threshold rating filtering for facet asset scoping', () => {
      const sql = compileFilteredAssetIds(sut, { rating: 4 });

      expect(sql).toMatch(/"asset_exif"\."rating"\s*>=\s*\$\d+/i);
      expect(sql).not.toMatch(/"asset_exif"\."rating"\s*=\s*\$\d+/i);
    });

    it('narrows facet assets by an active state', () => {
      const sql = compileFilteredAssetIds(sut, { state: 'Bavaria' });

      expect(sql).toContain('"asset_exif"');
      expect(sql).toMatch(/"asset_exif"\."state"\s*=\s*\$\d+/i);
    });

    it('narrows facet assets by an active lens model', () => {
      const sql = compileFilteredAssetIds(sut, { lensModel: 'RF24-105mm F4 L IS USM' });

      expect(sql).toContain('"asset_exif"');
      expect(sql).toMatch(/"asset_exif"\."lensModel"\s*=\s*\$\d+/i);
    });

    it('ANDs the contributor filter with the owner scope instead of replacing it', () => {
      const sql = compileFilteredAssetIds(sut, { ownerId: '00000000-0000-4000-8000-000000000009' });

      // The scope predicate resolved by applySuggestionScope must survive …
      expect(sql).toMatch(/"asset"\."ownerId"\s*=\s*any\s*\(\$\d+::uuid\[\]\)/i);
      // … and the contributor filter is a second, single-value predicate on top of it. A merged
      // implementation (ownerId folded into userIds) would widen the set — design §4.4.
      expect(sql).toMatch(/"asset"\."ownerId"\s*=\s*\$\d+::uuid/i);
    });

    // Guards the committed server/src/queries/*.sql: every predicate added for state / lensModel /
    // ownerId is $if-guarded, so the @GenerateSql dummy params (which set none of them) still
    // compile to exactly the same SQL and `mise //:sql` stays a no-op.
    it('adds no exif join or contributor predicate when none of the new dimensions is set', () => {
      const sql = compileFilteredAssetIds(sut, {});

      expect(sql).not.toContain('"asset_exif"');
      expect(sql).not.toMatch(/"state"/i);
      expect(sql).not.toMatch(/"lensModel"/i);
      expect(sql).not.toMatch(/"asset"\."ownerId"\s*=\s*\$\d+::uuid/i);
    });

    it('orders global people suggestions by favorite first, then name', () => {
      const sql = compileFilteredPeopleQuery(sut, {});

      expect(sql).toMatch(/order by\s+"person"\."isFavorite"\s+desc,\s*"person"\."name"/i);
    });

    it('orders space people suggestions by space-local display name without private fallbacks', () => {
      const sql = compileFilteredSpacePeopleQuery(sut, {
        spaceId: '11111111-1111-1111-1111-111111111111',
      });

      expect(sql).not.toContain('"person"."name"');
      expect(sql).not.toContain('"person"."isFavorite"');
      expect(sql).toMatch(/nullif\("shared_space_person"\."name", ''\)/i);
    });

    it('filters facet assets by resolved identity ids', () => {
      const sql = compileFilteredAssetIds(sut, { identityIds: ['00000000-0000-0000-0000-000000000001'] });

      expect(sql).toContain('"face_identity_face"');
      expect(sql).toContain('"face_identity_face"."identityId"');
    });

    it('global person suggestion filters require every selected person', () => {
      const sql = compileFilteredAssetIds(sut, {
        personIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
      });
      expect(sql).toContain('"has_people"');
      expect(sql).toMatch(/having count\(distinct "personGroupId"\) = \$\d+/i);
    });

    it('space person suggestion filters require every selected space person', () => {
      const sql = compileFilteredAssetIds(sut, {
        spaceId: '11111111-1111-1111-1111-111111111111',
        personIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
      });
      expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
      expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
    });

    it('forceEmptyResult compiles to an impossible predicate', () => {
      const sql = compileFilteredAssetIds(sut, { forceEmptyResult: true });

      expect(sql).toContain('false');
    });

    it('filters suggestion asset ids to assets without album membership', () => {
      const sql = compileFilteredAssetIds(sut, { isNotInAlbum: true });

      expect(sql).toContain('"album_asset"');
      expect(sql).toContain('not exists');
      expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
    });

    it('does not add album exclusion for false has-no-album filters', () => {
      const sql = compileFilteredAssetIds(sut, { isNotInAlbum: false });

      expect(sql).not.toContain('"album_asset"');
    });

    it('filters suggestion asset ids to assets with album membership', () => {
      const sql = compileFilteredAssetIds(sut, { isInAlbum: true });

      expect(sql).toContain('"album_asset"');
      expect(sql).toContain('exists');
      expect(sql).not.toContain('not exists');
      expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
    });

    it('does not add album inclusion for false has-album filters', () => {
      const sql = compileFilteredAssetIds(sut, { isInAlbum: false });

      expect(sql).not.toContain('"album_asset"');
    });

    it('filters metadata search assets to album members via searchAssetBuilder', () => {
      const sql = buildAssetSearchSql({ isInAlbum: true });

      expect(sql).toContain('"album_asset"');
      expect(sql).toContain('exists');
      expect(sql).not.toContain('not exists');
    });

    it('does not add album inclusion to metadata search when isInAlbum is false', () => {
      const sql = buildAssetSearchSql({ isInAlbum: false });

      expect(sql).not.toContain('"album_asset"');
    });

    // Edge case (unreachable via UI): both album booleans true → the predicates are
    // ANDed, yielding the empty intersection. Documents that no special handling is needed.
    it('ANDs both album predicates when isInAlbum and isNotInAlbum are both true', () => {
      const sql = buildAssetSearchSql({ isInAlbum: true, isNotInAlbum: true });

      expect(sql).toContain('exists');
      expect(sql).toContain('not exists');
    });
  });

  // Which options each suggestion list excludes from its own asset-id subquery.
  describe('suggestion self-exclusion', () => {
    const userId = '00000000-0000-0000-0000-000000000000';
    const allDimensions = {
      country: 'Germany',
      state: 'Bavaria',
      city: 'Munich',
      make: 'Canon',
      model: 'Canon EOS R6',
      lensModel: 'RF24-105mm F4 L IS USM',
      ownerId: '00000000-0000-4000-8000-000000000009',
    };

    it('excludes the whole location group when listing countries, keeping camera and contributor', async () => {
      const { repository, options } = spyOnFilteredAssetIds();

      await repository.getCountries([userId], { ...allDimensions });

      expect(options()).toEqual([
        expect.objectContaining({
          country: undefined,
          state: undefined,
          city: undefined,
          make: 'Canon',
          lensModel: 'RF24-105mm F4 L IS USM',
          ownerId: '00000000-0000-4000-8000-000000000009',
        }),
      ]);
    });

    it('excludes state and city when listing states, keeping the country parent', async () => {
      const { repository, options } = spyOnFilteredAssetIds();

      await repository.getStates([userId], { ...allDimensions });

      expect(options()).toEqual([
        expect.objectContaining({
          state: undefined,
          city: undefined,
          country: 'Germany',
          lensModel: 'RF24-105mm F4 L IS USM',
        }),
      ]);
    });

    it('keeps the state parent applied when listing cities', async () => {
      const { repository, options } = spyOnFilteredAssetIds();

      await repository.getCities([userId], { ...allDimensions });

      expect(options()).toEqual([expect.objectContaining({ city: undefined, state: 'Bavaria', country: 'Germany' })]);
    });

    it('keeps the lens applied when listing camera makes and models', async () => {
      const makes = spyOnFilteredAssetIds();
      const models = spyOnFilteredAssetIds();

      await makes.repository.getCameraMakes([userId], { ...allDimensions });
      await models.repository.getCameraModels([userId], { ...allDimensions });

      expect(makes.options()).toEqual([
        expect.objectContaining({ make: undefined, lensModel: 'RF24-105mm F4 L IS USM' }),
      ]);
      expect(models.options()).toEqual([
        expect.objectContaining({ model: undefined, make: 'Canon', lensModel: 'RF24-105mm F4 L IS USM' }),
      ]);
    });

    it('excludes only the lens itself when listing lens models', async () => {
      const { repository, options } = spyOnFilteredAssetIds();

      await repository.getCameraLensModels([userId], { ...allDimensions });

      expect(options()).toEqual([
        expect.objectContaining({
          lensModel: undefined,
          make: 'Canon',
          model: 'Canon EOS R6',
          state: 'Bavaria',
          ownerId: '00000000-0000-4000-8000-000000000009',
        }),
      ]);
    });

    it('narrows every unified suggestion list by state, lens and contributor except the country list', async () => {
      const { repository, options } = spyOnFilteredAssetIds();

      await repository.getFilterSuggestions([userId], { ...allDimensions });

      // countries, cameraMakes, tags, people, ratings, mediaTypes, hasFavorites, then the two
      // album-membership probes (filed / unfiled) — in construction order.
      const [countries, ...rest] = options();
      expect(rest).toHaveLength(8);

      expect(countries.state).toBeUndefined();
      expect(countries.lensModel).toBe('RF24-105mm F4 L IS USM');
      expect(countries.ownerId).toBe('00000000-0000-4000-8000-000000000009');

      for (const list of rest) {
        expect(list.state).toBe('Bavaria');
        expect(list.lensModel).toBe('RF24-105mm F4 L IS USM');
        expect(list.ownerId).toBe('00000000-0000-4000-8000-000000000009');
      }
    });
  });

  describe('album-scoped suggestions', () => {
    // Album facets cover assets the user may legitimately see in the album: those
    // contributed by an album participant (owner or shared user), owned by the user, or
    // reachable via a timeline-opted-in shared space. The participant cases are what let
    // viewers see facets for the album owner's assets (issue #655); the shared-space
    // union is gated on timeline opt-in so a space asset that landed in an album never
    // leaks to non-members.
    it('buildFilteredAssetIds widens album scope to album participants, no spaces without timeline opt-in', () => {
      const sql = compileFilteredAssetIds(sut, {
        albumId: '11111111-1111-1111-1111-111111111111',
        tagIds: ['22222222-2222-2222-2222-222222222222'],
      });

      expect(sql).toContain('"album_asset"');
      expect(sql).toContain('"album_asset"."albumId"');
      expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
      expect(sql).toContain('"album_user"."userId" = "asset"."ownerId"');
      expect(sql).not.toContain('"shared_space_asset"');
      expect(sql).not.toContain('"shared_space_library"');
    });

    it('buildFilteredAssetIds adds timeline-enabled direct and linked-library spaces to album participants', () => {
      const sql = compileFilteredAssetIds(sut, {
        albumId: '11111111-1111-1111-1111-111111111111',
        timelineSpaceIds: ['33333333-3333-3333-3333-333333333333'],
      });

      expect(sql).toContain('"album_asset"');
      expect(sql).toContain('"album_user"."userId" = "asset"."ownerId"');
      expect(sql).toContain('"shared_space_asset"');
      expect(sql).toContain('"shared_space_asset"."spaceId"');
      expect(sql).toContain('"shared_space_library"');
      expect(sql).toContain('"shared_space_library"."spaceId"');
    });

    // Fix I: album-scoped branches must gate other participants' assets on visibility
    // (Archive + Timeline only) to prevent Hidden asset facets from leaking to album viewers.
    it('buildFilteredAssetIds gates album_user participant arm on Archive+Timeline visibility', () => {
      // Without the fix, the album_user EXISTS arm has no visibility predicate and the
      // album-scoped facets expose Hidden assets contributed by another participant.
      const sql = compileFilteredAssetIds(sut, {
        albumId: '11111111-1111-1111-1111-111111111111',
      });

      // The visibility gate ("asset"."visibility" in ($N, $N)) must appear in the SQL
      // emitted for the album branch — it restricts the album_user participant arm so
      // Hidden/Locked assets owned by OTHER participants are not surfaced.
      expect(sql).toMatch(/"asset"\."visibility" in \(\$\d+(?:, \$\d+)*\)/);
    });

    it('searchAssetBuilder album-scoped branch gates space assets on Archive+Timeline visibility', () => {
      // albumSharedSpaceScope is activated when albumIds is set and userIds is absent.
      // Without the fix, the space asset/library EXISTS arms have no visibility predicate.
      const sql = buildAssetSearchSql({
        albumIds: ['11111111-1111-1111-1111-111111111111'],
        timelineSpaceIds: ['33333333-3333-3333-3333-333333333333'],
      });

      expect(sql).toContain('"shared_space_asset"');
      expect(sql).toContain('"shared_space_library"');
      // Visibility gate must appear alongside the space membership check.
      expect(sql).toMatch(/"asset"\."visibility" in \(\$\d+(?:, \$\d+)*\)/);
    });

    it('searchAssetBuilder plain-album branch (no timelineSpaceIds) gates on Archive+Timeline visibility (security-1)', () => {
      // albumSharedSpaceScope's FIRST OR-branch (plain non-shared-space album assets) had NO
      // visibility gate, so a Hidden asset reachable only via a linked album leaked. With ONLY
      // albumIds set (no timelineSpaceIds, no userIds) that branch is the sole album predicate —
      // it must now carry the flat visibility gate.
      const sql = buildAssetSearchSql({
        albumIds: ['11111111-1111-1111-1111-111111111111'],
      });

      expect(sql).toMatch(/"asset"\."visibility" in \(\$\d+(?:, \$\d+)*\)/);
    });
  });

  describe('searchAssetBuilder album shared-space scope (albumAccessIsBoundary)', () => {
    // Default OFF is load-bearing: SearchService's album-scoped search (search.service.ts:142-153)
    // relies on searchAssetBuilder re-gating album results by shared-space timeline visibility
    // (albumSharedSpaceScope, database.ts:600-607) whenever albumAccessIsBoundary is absent. If a
    // future change ever flips this default, album-scoped search would leak a shared-space asset's
    // content to a caller who lost (or never had) space access — guard against that regression here.
    it('applies albumSharedSpaceScope by default for an album-scoped query (search re-gate stays intact)', () => {
      const sql = buildAssetSearchSql({ albumIds: ['11111111-1111-1111-1111-111111111111'] });

      expect(sql).toContain('"shared_space_asset"');
      expect(sql).toContain('"shared_space_library"');
    });

    // The opt-out (shared-space.service.ts getFilteredMapMarkers, issue #656): album ACCESS is
    // already the boundary for the album map, so it must not re-gate by shared-space visibility.
    it('skips albumSharedSpaceScope when albumAccessIsBoundary is set', () => {
      const sql = buildAssetSearchSql({
        albumIds: ['11111111-1111-1111-1111-111111111111'],
        albumAccessIsBoundary: true,
      });

      expect(sql).not.toContain('"shared_space_asset"');
      expect(sql).not.toContain('"shared_space_library"');
    });
  });

  describe('searchAssetBuilder rating semantics', () => {
    it('keeps non-smart rating filters as exact match', () => {
      const sql = buildAssetSearchSql({ rating: 2 });

      expect(sql).toMatch(/rating"?\s*=\s*\$\d+/i);
      expect(sql).not.toMatch(/rating"?\s*>=\s*\$\d+/i);
    });

    it('keeps unrated non-smart filters as IS NULL', () => {
      const sql = buildAssetSearchSql({ rating: null });

      expect(sql).toMatch(/rating"?\s+is\s+null/i);
      expect(sql).not.toMatch(/rating"?\s*>=\s*\$\d+/i);
      expect(sql).not.toMatch(/rating"?\s*=\s*\$\d+/i);
    });
  });

  describe('searchAssetBuilder people semantics', () => {
    it('uses AND semantics for space person filters by default', () => {
      const sql = buildAssetSearchSql({
        userIds: ['00000000-0000-0000-0000-000000000000'],
        spacePersonIds: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
      });
      expect(countMatches(sql, /exists\s*\(select\b[\s\S]+?from\s+"shared_space_person_face"/gi)).toBe(2);
      expect(sql).not.toMatch(/"shared_space_person_face"\."personId"\s*=\s*any\(/i);
    });

    it('keeps personMatchAny as OR for identity and space person filters', () => {
      const sql = buildAssetSearchSql({
        userIds: ['00000000-0000-0000-0000-000000000000'],
        personMatchAny: true,
        personIds: ['00000000-0000-0000-0000-000000000001'],
        identityIds: ['00000000-0000-0000-0000-000000000002'],
        spacePersonIds: ['00000000-0000-0000-0000-000000000003'],
      });
      expect(sql).toMatch(/\bor\b/i);
      expect(sql).toContain('"face_identity_face"');
      expect(sql).toContain('"shared_space_person_face"');
      expect(sql).not.toContain('"has_face_identities"');
      expect(sql).not.toContain('"has_people"');
    });

    it('does not apply people predicates for empty people arrays', () => {
      const sql = buildAssetSearchSql({
        userIds: ['00000000-0000-0000-0000-000000000000'],
        personIds: [],
        identityIds: [],
        spacePersonIds: [],
      });
      expect(sql).not.toContain('"asset_face"');
      expect(sql).not.toContain('"face_identity_face"');
      expect(sql).not.toContain('"shared_space_person_face"');
    });

    it('keeps mixed people categories cumulative by default', () => {
      const sql = buildAssetSearchSql({
        userIds: ['00000000-0000-0000-0000-000000000000'],
        personIds: ['00000000-0000-0000-0000-000000000001'],
        identityIds: ['00000000-0000-0000-0000-000000000002'],
        spacePersonIds: ['00000000-0000-0000-0000-000000000003'],
      });
      expect(sql).toContain('"has_people"');
      expect(sql).toContain('"has_face_identities"');
      expect(sql).toContain('"shared_space_person_face"');
      expect(sql).not.toMatch(/\bor\b/i);
    });
  });

  describe('searchAssetBuilder visibility modes', () => {
    // D4: the album map matches the album GRID, which uses withDefaultVisibility
    // (Archive | Timeline — database.ts). Neither pre-existing mode expresses that:
    // `undefined` skips the clause entirely (admitting Hidden AND Locked) and
    // 'not-locked' still admits Hidden. Hence the explicit 'timeline-or-archive' mode,
    // used only by the album-boundary map query (shared-space.service.ts).
    it('timeline-or-archive admits exactly Archive and Timeline', () => {
      const sql = buildAssetSearchSql({ visibility: 'timeline-or-archive' });

      expect(sql).toMatch(/"asset"\."visibility" in \('archive', 'timeline'\)/i);
      expect(sql).not.toContain(`'${AssetVisibility.Hidden}'`);
      expect(sql).not.toContain(`'${AssetVisibility.Locked}'`);
    });

    it('keeps a concrete visibility as an exact match', () => {
      const { sql, parameters } = compileAssetSearch({ visibility: AssetVisibility.Timeline });

      expect(sql).toMatch(/"asset"\."visibility" = \$\d+/i);
      expect(parameters).toContain(AssetVisibility.Timeline);
      expect(sql).not.toMatch(/"asset"\."visibility" in \(/i);
    });

    it('keeps not-locked as an inequality (it still admits Hidden — why the new mode exists)', () => {
      const { sql, parameters } = compileAssetSearch({ visibility: 'not-locked' });

      expect(sql).toMatch(/"asset"\."visibility" != \$\d+/i);
      expect(parameters).toContain(AssetVisibility.Locked);
    });

    it('applies no visibility clause when visibility is undefined', () => {
      const sql = buildAssetSearchSql({});

      expect(sql).not.toContain('"asset"."visibility"');
    });
  });

  describe('searchAssetBuilder ILIKE wildcard escaping', () => {
    // The map and metadata search route text filters through ILIKE. Without escaping, a
    // filename filter of `IMG_0001` treats `_` as a single-char wildcard (matching
    // `IMG-0001` too) while the time-bucket/timeline path — which DOES escape
    // (asset.repository.ts) — treats it literally. Same divergence for `%`.
    const ESCAPE_CLAUSE = String.raw`escape '\'`;

    it('escapes wildcards in the originalFileName filter and pairs them with an ESCAPE clause', () => {
      const { sql, parameters } = compileAssetSearch({ originalFileName: 'IMG_0001' });

      expect(sql).toContain(ESCAPE_CLAUSE);
      expect(parameters).toContain(String.raw`IMG\_0001`);
    });

    it('escapes wildcards in the description filter', () => {
      const { sql, parameters } = compileAssetSearch({ description: '100% sun_set' });

      expect(sql).toContain(ESCAPE_CLAUSE);
      expect(parameters).toContain(String.raw`100\% sun\_set`);
    });

    it('escapes wildcards in the originalPath filter', () => {
      const { sql, parameters } = compileAssetSearch({ originalPath: 'upload/IMG_0001' });

      expect(sql).toContain(ESCAPE_CLAUSE);
      expect(parameters).toContain(String.raw`upload/IMG\_0001`);
    });

    it('escapes a literal backslash before the wildcards it introduces', () => {
      const { parameters } = compileAssetSearch({ originalFileName: String.raw`back\slash_1` });

      expect(parameters).toContain(String.raw`back\\slash\_1`);
    });

    it('leaves OCR alone — it uses the trigram operator, not ILIKE', () => {
      const { sql } = compileAssetSearch({ ocr: 'IMG_0001' });

      expect(sql).toContain('%>>');
      expect(sql).not.toContain(ESCAPE_CLAUSE);
    });
  });
});
