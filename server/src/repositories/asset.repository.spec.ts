import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { withTimeBucketAssetFilters } from 'src/repositories/asset.repository';
import type { DB } from 'src/schema';
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

const compileTimeBucketFilters = (options: Record<string, unknown>) =>
  withTimeBucketAssetFilters(offlineKysely().selectFrom('asset').select('asset.id'), options as any).compile().sql;

const compileTimeBucketFiltersFull = (options: Record<string, unknown>) =>
  withTimeBucketAssetFilters(offlineKysely().selectFrom('asset').select('asset.id'), options as any).compile();

describe('withTimeBucketAssetFilters album filters', () => {
  it('filters timeline assets to album members when isInAlbum is true', () => {
    const sql = compileTimeBucketFilters({ isInAlbum: true });

    expect(sql).toContain('"album_asset"');
    expect(sql).toContain('exists');
    expect(sql).not.toContain('not exists');
    expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
  });

  it('filters timeline assets to non-album members when isNotInAlbum is true', () => {
    const sql = compileTimeBucketFilters({ isNotInAlbum: true });

    expect(sql).toContain('"album_asset"');
    expect(sql).toContain('not exists');
  });

  it('omits the album predicate when isInAlbum is false', () => {
    const sql = compileTimeBucketFilters({ isInAlbum: false });

    expect(sql).not.toContain('"album_asset"');
  });
});

describe('withTimeBucketAssetFilters text filters', () => {
  it('filters by originalFileName with an accent-insensitive ilike and no asset_exif join', () => {
    const sql = compileTimeBucketFilters({ originalFileName: 'vacation' });

    expect(sql).toContain('f_unaccent');
    expect(sql).toContain('"originalFileName"');
    expect(sql.toLowerCase()).toContain('ilike');
    expect(sql).not.toContain('"asset_exif"');
  });

  it('filters by description via an asset_exif join + accent-insensitive ilike', () => {
    const sql = compileTimeBucketFilters({ description: 'birthday' });

    expect(sql).toContain('"asset_exif"');
    expect(sql).toContain('f_unaccent');
    expect(sql.toLowerCase()).toContain('ilike');
  });

  it('reuses a single asset_exif join when description is combined with camera/location filters', () => {
    const sql = compileTimeBucketFilters({ description: 'x', city: 'Paris', make: 'Canon' });

    const joinCount = (sql.match(/inner join "asset_exif"/g) ?? []).length;
    expect(joinCount).toBe(1);
  });

  it('filters by ocr via an ocr_search join + trigram match', () => {
    const sql = compileTimeBucketFilters({ ocr: 'invoice' });

    expect(sql).toContain('"ocr_search"');
    expect(sql).toContain('%>>');
  });

  it('omits text predicates and joins when no text filter is set', () => {
    const sql = compileTimeBucketFilters({});

    expect(sql.toLowerCase()).not.toContain('ilike');
    expect(sql).not.toContain('"ocr_search"');
    expect(sql).not.toContain('"originalFileName"');
  });
});

describe('withTimeBucketAssetFilters text filters escape LIKE wildcards', () => {
  it('escapes %, _ and backslash in originalFileName so they match literally', () => {
    const { sql, parameters } = compileTimeBucketFiltersFull({ originalFileName: String.raw`IMG_50%\x` });

    // ilike pattern must declare a custom escape char so the escapes are honoured
    expect(sql.toLowerCase()).toContain('escape');
    // the bound value is escaped: _ -> \_, % -> \%, \ -> \\
    expect(parameters).toContain(String.raw`IMG\_50\%\\x`);
  });

  it('escapes %, _ and backslash in description so they match literally', () => {
    const { sql, parameters } = compileTimeBucketFiltersFull({ description: '100%_done' });

    expect(sql.toLowerCase()).toContain('escape');
    expect(parameters).toContain(String.raw`100\%\_done`);
  });
});
