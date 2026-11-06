import { Kysely, sql } from 'kysely';
import { ASPECT_CLASSES, ASPECT_CLASS_SQL } from 'src/gallery/utils/aspect-class-sql.js';
import { DB } from 'src/schema/index.js';
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
