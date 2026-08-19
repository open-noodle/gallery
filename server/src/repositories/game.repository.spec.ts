import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameRepository } from 'src/repositories/game.repository';

// Server root - vitest runs with cwd at server/ (matches face-identity-query-shape.spec.ts and
// shared-space-album-scope.guard.spec.ts).
const GENERATED_SQL = join(process.cwd(), 'src/queries/game.repository.sql');
const readGeneratedSql = () => readFileSync(GENERATED_SQL, 'utf8');

/** The generated file is one `-- <Repository>.<method>` block per decorated query. */
const queryBlock = (sql: string, method: string): string => {
  const marker = `-- GameRepository.${method}`;
  const start = sql.indexOf(marker);
  expect(start, `${marker} is missing from ${GENERATED_SQL} - regenerate it with \`mise sql\``).toBeGreaterThan(-1);
  const next = sql.indexOf('\n-- GameRepository.', start + marker.length);
  return sql.slice(start, next === -1 ? undefined : next);
};

describe('GameRepository', () => {
  it('is constructible and exposes the query surface the service depends on', () => {
    // A cheap guard on the registration trap: if the repository is not exported
    // and importable under its expected name, every downstream task fails in a
    // confusing place instead of here.
    expect(typeof GameRepository).toBe('function');
    for (const method of [
      'getLocationCandidates',
      'getDateCandidates',
      'getEligibleRoundAsset',
      'getRecentlyUsedAssetIds',
      'createChallenge',
      'getChallenge',
      'getChallengesForSpace',
      'getRounds',
      'getRound',
      'getGuessesForUser',
      'createGuess',
      'getLeaderboard',
      'getMonthlyStandings',
      'deleteChallenge',
    ]) {
      expect(typeof GameRepository.prototype[method as keyof GameRepository]).toBe('function');
    }
  });

  // Static guards over the generated SQL. No database: they read src/queries/game.repository.sql,
  // which `mise sql` rewrites from the decorated methods, so they fail the moment the emitted
  // query shape changes - which is precisely when these two defects came back before.
  describe('generated query shape', () => {
    it('divides the face-area ratio in floating point, not integer arithmetic', () => {
      // The ratio expression moved from a SELECTed `as "faceAreaRatio"` alias (the old
      // uncorrelated LEFT JOIN form) into a bare HAVING comparison (the correlated NOT EXISTS
      // form) - HAVING has nothing to alias against, so the anchor is "having ... > $" instead.
      const block = queryBlock(readGeneratedSql(), 'getLocationCandidates');
      const start = block.indexOf('having');
      expect(
        start,
        'the face-area HAVING clause is gone from the generated SQL - if the face gate moved, move this guard with it',
      ).toBeGreaterThan(-1);
      const end = block.indexOf(' > $', start);
      expect(
        end,
        'could not find the HAVING comparison operator (`> 0.05`) after the ratio expression',
      ).toBeGreaterThan(-1);
      // The whole `sum(...) / nullif(...)` ratio, whitespace-collapsed so sql-formatter's line
      // wrapping cannot change what this matches.
      const expression = block.slice(start, end).replaceAll(/\s+/g, ' ');

      // Specifically the cast on the NUMERATOR, immediately before the division - that is the one
      // that decides whether Postgres divides in floating point. A cast on the denominator alone
      // does not save it, so `toContain('::double precision')` would pass on the broken query.
      expect(
        expression,
        'The face-area gate lost the ::double precision cast on the SUM, so Postgres is doing\n' +
          'INTEGER division. sum(integer) is bigint and max(int)*max(int) is integer, and\n' +
          'bigint/integer TRUNCATES: every ratio below 1.0 becomes 0, `0 <= 0.05` is true for every\n' +
          'row, and the gate silently admits every portrait it exists to exclude. It fails OPEN and\n' +
          'looks completely healthy - this cost two review cycles already. Restore the cast in\n' +
          'getLocationCandidates, then regenerate with `mise sql`.',
      ).toMatch(/\)::double precision \/ nullif/);
    });

    it('scopes the face-area aggregate to the candidate rows, not the whole asset_face table', () => {
      const block = queryBlock(readGeneratedSql(), 'getLocationCandidates').replaceAll(/\s+/g, ' ');

      // An uncorrelated `group by "asset_face"."assetId"` with no reference to the outer row means
      // Postgres aggregates EVERY visible face in the database before joining - 58k rows on the
      // reference library, to gate a few thousand candidates. The correlated form carries the outer
      // asset id into the subquery.
      expect(
        block,
        'The face-area gate is aggregating asset_face unscoped. It must correlate on the outer\n' +
          'asset id (NOT EXISTS ... where f."assetId" = <outer> ... having ratio > 0.05) so the\n' +
          'aggregate is bounded by the candidate sample. Regenerate with `mise sql`.',
      ).toMatch(/not exists .*"asset_face".*"assetId" =/);

      expect(
        block,
        'The face gate should express exclusion via HAVING on the ratio, so that a row with no\n' +
          'faces (no group) and a row with zero image area (NULL ratio) are both KEPT.',
      ).toContain('having');
    });

    it("scopes every asset query to all four of a space's asset paths", () => {
      const sql = readGeneratedSql();

      // A shared space's asset set is direct + linked library + linked album + cross-owner
      // contribution. Selecting from shared_space_asset alone is a SAFE error direction (a strict
      // subset, never widened visibility) and therefore silent: a space filled entirely through a
      // linked album or a connected library yields zero candidates and reports itself as having
      // no photos usable for a challenge. Routing through spaceAssetPathBranches is what keeps
      // all four arms - forgetting one is a recurring defect here (see
      // shared-space-album-scope.guard.spec.ts).
      //
      // Matched on each arm's CORRELATION predicate, not the bare table name: a table name still
      // appears in the surviving join of an arm whose correlation was dropped.
      const arms = {
        'directly added asset': '"shared_space_asset"."assetId" = "asset"."id"',
        'linked library': '"shared_space_library"."libraryId" = "asset"."libraryId"',
        'linked album': '"album_asset"."assetId" = "asset"."id"',
        'cross-owner album contribution': '"album_space_asset"."assetId" = "asset"."id"',
      };

      for (const method of ['getLocationCandidates', 'getDateCandidates', 'getEligibleRoundAsset']) {
        const block = queryBlock(sql, method).replaceAll(/\s+/g, ' ');
        for (const [arm, predicate] of Object.entries(arms)) {
          expect(
            block,
            `GameRepository.${method} no longer covers the "${arm}" access path. A space populated\n` +
              `only through that path becomes invisible to the game - zero candidates, and a\n` +
              `"this space has no photos usable for a challenge" error on a space full of photos.\n` +
              `Scope the query with spaceAssetPathBranches (via the eligibleSpaceAsset helper) and\n` +
              `regenerate with \`mise sql\`.`,
          ).toContain(predicate);
        }
      }
    });

    it('samples before ranking, so the CLIP score is never computed over the whole library', () => {
      const block = queryBlock(readGeneratedSql(), 'getLocationCandidates').replaceAll(/\s+/g, ' ');

      // Stage 1 is a CTE that selects the candidate ids with NO vector column and NO face
      // aggregate, ordered by the seeded hash and limited to the sample size. Sliced from the CTE
      // opener to the outer query's FROM, which is where stage 2 begins.
      const stageOne = block.slice(block.indexOf('with "sample"'), block.indexOf('from "sample"'));

      expect(
        block,
        'getLocationCandidates no longer has a "sample" CTE. Without it the two-term CLIP\n' +
          'expression is evaluated over EVERY eligible row (30,212 on the reference library,\n' +
          '133 MB of vector reads) because it cannot use clip_index. That is the 17-second\n' +
          'cold-cache path. Restore the two-stage shape and regenerate with `mise sql`.',
      ).toContain('with "sample"');

      expect(
        stageOne,
        'The stage-1 sample CTE references smart_search. Stage 1 exists precisely to avoid\n' +
          'touching the vector column: it must select narrow columns only, so that the expensive\n' +
          'stage-2 work is bounded by the sample size instead of the library size.',
      ).not.toContain('smart_search');

      expect(
        stageOne,
        'The stage-1 sample CTE references asset_face. The face gate belongs in stage 2, scoped\nto the sample.',
      ).not.toContain('asset_face');
    });
  });
});
