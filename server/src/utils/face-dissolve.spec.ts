import {
  DummyDriver,
  Expression,
  ExpressionBuilder,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqlBool,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import {
  DissolveScope,
  dissolveDeletableFacePredicate,
  dissolveFacePredicate,
  handDrawnFacePredicate,
} from 'src/utils/face-dissolve.js';

// Offline Kysely — compiles SQL without executing it. The medium specs prove the behaviour against a real
// database; this pins the shape of the rule so a refactor cannot quietly drop the hand-drawn exclusion.
const offlineKysely = () =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const compileWhere = (where: (eb: ExpressionBuilder<DB, 'asset_face'>) => Expression<SqlBool>) =>
  offlineKysely()
    .selectFrom('asset_face')
    .select('asset_face.id')
    .where((eb) => where(eb))
    .compile();

describe('handDrawnFacePredicate', () => {
  it('keys on createdBy alone, never on sourceType', () => {
    const { sql } = compileWhere((eb) => handDrawnFacePredicate(eb));
    expect(sql).toContain('"asset_face"."createdBy" is not null');
    // Owner-drawn boxes are `manual` with no createdBy; gating on sourceType would misclassify them (§6.6).
    expect(sql).not.toContain('sourceType');
  });
});

describe('dissolveDeletableFacePredicate', () => {
  it.each(Object.values(DissolveScope))('is the %s scope minus hand-drawn faces', (scope) => {
    const { sql, parameters } = compileWhere((eb) => dissolveDeletableFacePredicate(eb, 'person-1', scope));
    const { sql: inScopeSql } = compileWhere((eb) => dissolveFacePredicate(eb, 'person-1', scope));

    // The full in-scope predicate is embedded verbatim, so the delete can never touch a face the preview
    // did not count …
    const inScopeWhere = inScopeSql.slice(inScopeSql.indexOf(' where ') + ' where '.length);
    expect(sql).toContain(inScopeWhere);
    // … and the hand-drawn exclusion is ANDed on top of it.
    expect(sql).toContain('and not "asset_face"."createdBy" is not null');
    expect(parameters).toContain('person-1');
  });
});
