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
      const sql = readGeneratedSql();
      const end = sql.indexOf('as "faceAreaRatio"');
      expect(
        end,
        'the faceAreaRatio expression is gone from the generated SQL - if the face gate moved, move this guard with it',
      ).toBeGreaterThan(-1);
      // The whole `sum(...) / nullif(...)` ratio, whitespace-collapsed so sql-formatter's line
      // wrapping cannot change what this matches.
      const expression = sql.slice(sql.lastIndexOf('sum(', end), end).replaceAll(/\s+/g, ' ');

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
  });
});
