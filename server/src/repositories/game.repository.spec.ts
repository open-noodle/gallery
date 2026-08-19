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
      // contribution. Dropping an arm is a SAFE error direction (a strict subset, never widened
      // visibility) and therefore silent: a space filled entirely through a linked album yields
      // zero candidates and reports itself as having no photos usable for a challenge.
      //
      // getLocationCandidates and getDateCandidates now DRIVE FROM the space tables (a union of
      // the four paths) rather than scanning asset and testing membership, so each arm is matched
      // on its own source table AND the spaceId filter that scopes it - not on a correlation
      // predicate against "asset", which the union form no longer has.
      //
      // Both halves are load-bearing, and they fail in OPPOSITE directions. Losing the table half
      // loses an access path: a strict subset, silent, "no photos usable for a challenge" on a
      // space full of them. Losing the spaceId half WIDENS: an unscoped `shared_space_album` arm
      // pours every space's linked-album assets into every other space's candidate pool, which is
      // cross-space photo leakage. Only the subset error is self-reporting, so the guard has to
      // carry the scoping half itself.
      //
      // The gap between the two halves is tempered with `(?:(?!union).)*?` rather than `.*?`
      // because whitespace is collapsed and the arms sit end to end: a plain lazy gap on the
      // linked-album arm runs straight through the `union` boundary and matches the CONTRIBUTION
      // arm's spaceId filter, so deleting the linked-album scoping would still pass. `union` is
      // the emitted arm separator, so refusing to cross it confines each match to its own arm.
      const drivenArms = {
        'directly added asset': /from "shared_space_asset" where "shared_space_asset"\."spaceId" =/,
        // The library arm drives from `asset` and joins the link table, so its scoping lives in
        // the ON clause rather than a WHERE: `on <libraryId match> and <spaceId filter>`.
        'linked library':
          /"shared_space_library"\."libraryId" = "asset"\."libraryId" and "shared_space_library"\."spaceId" =/,
        'linked album':
          /"album_asset"\."albumId" = "shared_space_album"\."albumId"(?:(?!union).)*?"shared_space_album"\."spaceId" =/,
        'cross-owner album contribution':
          /"album_space_asset"\."albumId" = "shared_space_album"\."albumId"(?:(?!union).)*?"shared_space_album"\."spaceId" =/,
      };

      for (const method of ['getLocationCandidates', 'getDateCandidates']) {
        const block = queryBlock(sql, method).replaceAll(/\s+/g, ' ');
        for (const [arm, pattern] of Object.entries(drivenArms)) {
          expect(
            block,
            `GameRepository.${method} no longer covers the "${arm}" access path AS SCOPED TO ONE\n` +
              `SPACE. Either the arm is gone - a space populated only through that path becomes\n` +
              `invisible to the game, zero candidates and a "this space has no photos usable for a\n` +
              `challenge" error on a space full of photos - or the arm survived but lost its\n` +
              `spaceId filter, which is worse: it pours every other space's photos into this\n` +
              `space's candidate pool. Scope stage 1 with spaceAssetIdUnion and regenerate with\n` +
              `\`mise sql\`.`,
          ).toMatch(pattern);
        }
      }

      // getEligibleRoundAsset still resolves ONE known asset id, so it keeps the correlated
      // eligibleSpaceAsset form - driving from the space tables there would be strictly worse.
      const roundAsset = queryBlock(sql, 'getEligibleRoundAsset').replaceAll(/\s+/g, ' ');
      for (const predicate of [
        '"shared_space_asset"."assetId" = "asset"."id"',
        '"shared_space_library"."libraryId" = "asset"."libraryId"',
        '"album_asset"."assetId" = "asset"."id"',
        '"album_space_asset"."assetId" = "asset"."id"',
      ]) {
        expect(roundAsset, 'getEligibleRoundAsset must keep the correlated four-arm form').toContain(predicate);
      }
    });

    it('excludes archived, hidden and locked assets at all three independent sites', () => {
      // `visibility = 'timeline'` used to be written in exactly one place: eligibleSpaceAsset.
      // Driving the candidate queries from the space tables split it into THREE independent
      // copies - getLocationCandidates' stage-1 sample, getDateCandidates, and
      // eligibleSpaceAsset (still used by getEligibleRoundAsset alone) - any one of which can be
      // dropped without the other two noticing.
      //
      // The e2e characterization suite (game-visibility-negatives.e2e-spec.ts) cannot catch two
      // of the three: every fixture asset it creates is a generated PNG with no EXIF GPS, so
      // getLocationCandidates' INNER JOIN on asset_exif's lat/lon always empties its pool and
      // every round that suite generates is a date round - it only ever exercises
      // getDateCandidates. queryBlock() is used (not a raw string search) so a renamed method
      // fails this loudly instead of silently matching nothing.
      const sql = readGeneratedSql();
      for (const method of ['getLocationCandidates', 'getDateCandidates', 'getEligibleRoundAsset']) {
        const block = queryBlock(sql, method).replaceAll(/\s+/g, ' ');
        expect(
          block,
          `GameRepository.${method} lost its "asset"."visibility" = $ clause. That clause is the\n` +
            'ONLY thing excluding archived, hidden and locked assets from the game pool - losing it\n' +
            'here silently widens the pool to include photos their owner deliberately took off the\n' +
            'timeline, and (for getLocationCandidates / getEligibleRoundAsset in particular) the\n' +
            'e2e visibility suite cannot catch it - see the comment above this test. Restore the\n' +
            'clause and regenerate with `mise sql`.',
        ).toContain('"asset"."visibility" = $');
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
