import { CompiledQuery, Kysely, sql } from 'kysely';
import { AssetAspectClass, AssetVisibility } from 'src/enum.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import {
  FilterSuggestionRepository,
  FilterSuggestionsOptions,
} from 'src/gallery/repositories/filter-suggestion.repository.js';
import { SmartFacetRepository } from 'src/gallery/repositories/smart-facet.repository.js';
import { ASPECT_CLASSES, ASPECT_CLASS_SQL } from 'src/gallery/utils/aspect-class-sql.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { aspectClassCondition } from 'src/utils/asset-filter.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const MAX_INT = 2_147_483_647;

/** The class table of specs/2026-11-06-aspect-ratio-filter-design.md, written from its rules, not from the SQL. */
const expectedClass = (width: number | null, height: number | null) => {
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  const longer = BigInt(Math.max(width, height));
  const shorter = BigInt(Math.min(width, height));
  if (50n * longer <= 51n * shorter) {
    return 'square';
  }
  if (longer >= 2n * shorter) {
    return width > height ? 'panorama-wide' : 'panorama-tall';
  }
  return width > height ? 'landscape' : 'portrait';
};

/** Runs the real expression on plain width and height values, with no asset rows involved. */
const classExpression = sql.raw(ASPECT_CLASS_SQL);

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('aspect class expression', () => {
  it('gives every pair from 1 to 2000 exactly the class of the table', async () => {
    const limit = 2000;
    // One row per width with a two-letter code per height, so four million pairs arrive as 2,000 rows.
    const { rows } = await sql<{ width: number; classes: string }>`
      select "width", string_agg(left(class, 1) || right(class, 1), '' order by "height") as classes
      from (
        select "width", "height", ${classExpression} as class
        from generate_series(1, ${limit}::int) as w("width")
        cross join generate_series(1, ${limit}::int) as h("height")
      ) as pairs
      group by "width"
    `.execute(defaultDatabase);

    expect(rows).toHaveLength(limit);
    for (const { width, classes } of rows) {
      for (let height = 1; height <= limit; height++) {
        const expected = expectedClass(width, height)!;
        const actual = classes.slice((height - 1) * 2, height * 2);
        if (actual !== expected[0] + expected.at(-1)) {
          expect.fail(`${width} x ${height}: expected ${expected}, got the code ${actual}`);
        }
      }
    }
  });

  it('keeps the five class codes used above apart', () => {
    expect(new Set(ASPECT_CLASSES.map((value) => value[0] + value.at(-1))).size).toBe(ASPECT_CLASSES.length);
  });

  it.each([
    [null, 100],
    [100, null],
    [null, null],
    [0, 100],
    [100, 0],
    [0, 0],
    [-1, 100],
    [100, -1],
    [1, 1],
    [50, 51],
    [51, 50],
    [50, 52],
    [52, 50],
    [100, 200],
    [200, 100],
    [199, 100],
    [100, 199],
    [MAX_INT, MAX_INT],
    [MAX_INT, MAX_INT - 1],
    [MAX_INT, 1],
    [1, MAX_INT],
    [MAX_INT, Math.floor(MAX_INT / 2)],
  ])('classifies %s x %s', async (width, height) => {
    const { rows } = await sql<{ class: string | null }>`
      select ${classExpression} as class
      from (select ${width}::int as "width", ${height}::int as "height") as pair
    `.execute(defaultDatabase);

    expect(rows[0].class).toBe(expectedClass(width, height));
  });
});

describe('asset_aspectClass_idx', () => {
  it('is a full index, with no WHERE clause', async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes where indexname = 'asset_aspectClass_idx'
    `.execute(defaultDatabase);

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).not.toContain(' WHERE ');
  });
});

const embedding = `[${Array.from({ length: 512 }, () => '0.01').join(',')}]`;

const setup = async () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [FaceSearchRepository, FilterSuggestionRepository, SmartFacetRepository],
    mock: [LoggingRepository],
  });
  const { user: owner } = await ctx.newUser();
  const { user: stranger } = await ctx.newUser();

  const add = async (width: number | null, height: number | null, make: string, rating: number) => {
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline, width, height });
    await ctx.newExif({ assetId: asset.id, make, model: 'Model', rating });
    await ctx.database.insertInto('smart_search').values({ assetId: asset.id, embedding }).execute();
    return asset.id;
  };

  await add(400, 300, 'Canon', 1);
  await add(300, 400, 'Canon', 2);
  await add(100, 100, 'Nikon', 3);
  await add(null, null, 'Sony', 4);

  const suggestions = ctx.get(FilterSuggestionRepository);
  const facets = ctx.get(SmartFacetRepository);
  return { ctx, owner, stranger, add, suggestions, facets };
};

const smartFacets = (facets: SmartFacetRepository, ownerId: string, filter: object) =>
  facets.getSmartSearchFacets({ embedding, userIds: [ownerId], ...filter });

const explain = (compiled: CompiledQuery) =>
  defaultDatabase.transaction().execute(async (trx) => {
    await sql`SET LOCAL enable_seqscan = off`.execute(trx);
    const { rows } = await trx.executeQuery<{ 'QUERY PLAN': string }>(
      CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [...compiled.parameters]),
    );
    return rows.map((row) => row['QUERY PLAN']).join('\n');
  });

describe('filter suggestions', () => {
  it('reports the classes the set holds, in table order, and no class for an asset without dimensions', async () => {
    const { owner, suggestions } = await setup();

    const { aspectClasses } = await suggestions.getFilterSuggestions([owner.id], {});

    expect(aspectClasses).toEqual(['landscape', 'square', 'portrait']);
  });

  it('ignores its own selection', async () => {
    const { owner, suggestions } = await setup();

    const { aspectClasses } = await suggestions.getFilterSuggestions([owner.id], { aspectClasses: ['portrait'] });

    expect(aspectClasses).toEqual(['landscape', 'square', 'portrait']);
  });

  it('narrows by every other active filter', async () => {
    const { owner, suggestions } = await setup();

    const { aspectClasses } = await suggestions.getFilterSuggestions([owner.id], { make: 'Nikon' });

    expect(aspectClasses).toEqual(['square']);
  });

  it('narrows the other lists by the selected classes', async () => {
    const { owner, suggestions } = await setup();

    const { cameraMakes, ratings } = await suggestions.getFilterSuggestions([owner.id], { aspectClasses: ['square'] });

    expect(cameraMakes).toEqual(['Nikon']);
    expect(ratings).toEqual([3]);
  });

  it('narrows the second-level lists by the selected classes', async () => {
    const { owner, suggestions } = await setup();

    await expect(suggestions.getCameraMakes([owner.id], { aspectClasses: ['square'] })).resolves.toEqual(['Nikon']);
  });

  it('never reveals the classes of assets outside the scope', async () => {
    const { stranger, suggestions } = await setup();

    const { aspectClasses } = await suggestions.getFilterSuggestions([stranger.id], {});

    expect(aspectClasses).toEqual([]);
  });
});

describe('smart facets', () => {
  it('reports the classes of the result set and ignores its own selection', async () => {
    const { owner, facets } = await setup();
    const aspectClasses: AssetAspectClass[] = ['portrait'];

    const result = await smartFacets(facets, owner.id, { aspectClasses });

    expect(result.aspectClasses).toEqual(['landscape', 'square', 'portrait']);
    expect(result.total).toBe(1);
  });

  it('honours the other active filters', async () => {
    const { owner, facets } = await setup();

    const result = await smartFacets(facets, owner.id, { make: 'Nikon' });

    expect(result.aspectClasses).toEqual(['square']);
  });

  it('narrows the other lists by the selected classes', async () => {
    const { owner, facets } = await setup();
    const aspectClasses: AssetAspectClass[] = ['square'];

    const result = await smartFacets(facets, owner.id, { aspectClasses });

    expect(result.cameraMakes).toEqual(['Nikon']);
  });
});

describe('query plans', () => {
  let seeded: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    seeded = await setup();
    // Enough common rows that the class is the selective condition, not the owner.
    for (let i = 0; i < 300; i++) {
      await seeded.add(400, 300, 'Canon', 1);
    }
    await seeded.add(600, 100, 'Canon', 1);
    await seeded.add(100, 600, 'Canon', 1);
    await sql`ANALYZE "asset"`.execute(seeded.ctx.database);
  });

  it.each<AssetAspectClass>(['square', 'panorama-wide', 'panorama-tall'])(
    'a %s selection uses the index',
    async (value) => {
      const query = seeded.ctx.database
        .selectFrom('asset')
        .select('asset.id')
        .where(aspectClassCondition([value]));

      await expect(explain(query.compile())).resolves.toContain('asset_aspectClass_idx');
    },
  );

  it('the probes use the index, with the class condition inside the filtered-id query', async () => {
    const { owner, suggestions } = seeded;

    const probes = suggestions['aspectClassProbes']([owner.id], {} as FilterSuggestionsOptions).compile();

    await expect(explain(probes)).resolves.toContain('asset_aspectClass_idx');
    expect(probes.sql).not.toMatch(/"id" in \(/);
  });
});
