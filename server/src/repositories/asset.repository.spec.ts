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
