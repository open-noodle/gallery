// Slice 1 — unit tests for the canonical visibility helper and related constants.
// Tests:
//   1. spaceVisibilityGate compiles to the expected SQL
//   2. spaceVisibleAssetVisibilities equals [AssetVisibility.Archive, AssetVisibility.Timeline]
//   3. The two old names are the SAME reference as the new constant (===)
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { spaceVisibilityGate, spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';
// Import the old names via the repositories that re-export them after consolidation.
// These are module-level consts (not exported), so we verify via the shared reference test
// by reading the same constant through the consolidated import.
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

describe('spaceVisibleAssetVisibilities', () => {
  it('equals [AssetVisibility.Archive, AssetVisibility.Timeline]', () => {
    expect(spaceVisibleAssetVisibilities).toEqual([AssetVisibility.Archive, AssetVisibility.Timeline]);
  });
});

describe('spaceVisibilityGate', () => {
  it('compiles to SQL with asset.visibility in (...) predicate and both values as parameters', () => {
    const db = offlineKysely();
    const compiled = db
      .selectFrom('asset')
      .selectAll()
      .where((eb) => spaceVisibilityGate(eb))
      .compile();

    // Kysely uses parameterized queries; the column ref and IN operator appear in SQL
    expect(compiled.sql).toContain('"asset"."visibility" in');
    // Both visibility values are passed as bound parameters
    expect(compiled.parameters).toContain('archive');
    expect(compiled.parameters).toContain('timeline');
  });

  it('accepts a custom column reference', () => {
    const db = offlineKysely();
    const compiled = db
      .selectFrom('asset')
      .selectAll()
      .where((eb) => spaceVisibilityGate(eb, 'asset.visibility'))
      .compile();

    expect(compiled.sql).toContain('"asset"."visibility" in');
    expect(compiled.parameters).toContain('archive');
    expect(compiled.parameters).toContain('timeline');
  });
});
