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
import { deleteFacePredicate, handDrawnFacePredicate, hideFacePredicate } from 'src/gallery/utils/face-dissolve.js';
import { DB } from 'src/schema/index.js';

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
  it('keys on the asset_face_creator row alone, never on sourceType', () => {
    const { sql } = compileWhere((eb) => handDrawnFacePredicate(eb));
    expect(sql).toContain(
      'exists (select from "asset_face_creator" where "asset_face_creator"."assetFaceId" = "asset_face"."id")',
    );
    // Owner-drawn boxes are `manual` with no createdBy; gating on sourceType would misclassify them (§6.6).
    expect(sql).not.toContain('sourceType');
  });
});

describe('hide and delete predicates', () => {
  it.each([
    ['hide', hideFacePredicate, 'machine-learning'],
    ['delete', deleteFacePredicate, 'exif'],
  ] as const)('%s never matches a hand-drawn face', (_name, predicate, sourceType) => {
    const { sql, parameters } = compileWhere((eb) => predicate(eb));
    expect(parameters).toContain(sourceType);
    expect(sql).toContain('and not (exists (select from "asset_face_creator"');
  });
});
