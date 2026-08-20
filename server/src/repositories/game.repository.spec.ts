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

// ── the solo pool ──────────────────────────────────────────────────────────────────────────────
//
// Each solo query is generated FOUR times, once per source combination, because the read arms are
// conditional: `own library only` is what a default player gets, `all sources` is both toggles on,
// and `partners only` / `spaces only` are the two asymmetric cases. A guard reading only one could
// not tell the difference between "the toggle gates the arm" and "the arm is never there" / "the
// arm is always there"; a guard reading only the two symmetric ones could not tell either of those
// from an arm gated on the WRONG toggle, which is the leak that matters (partners on, spaces off,
// shared-space photos drawn anyway).
//
// BOTH asymmetric cases are generated because they catch opposite cross-wirings. `partners only`
// catches a space arm gated on withPartners. It cannot catch a PARTNER arm gated on withSpaces -
// under (true,false) that arm is legitimately absent, and both symmetric variants look identical
// either way - so that direction needs `spaces only`, where a correct partner arm must be gone and
// a cross-wired one shows up.
const SOLO_QUERIES = ['getSoloLocationCandidates', 'getSoloDateCandidates', 'getSoloEligibleRoundAsset'];

const soloBlock = (method: string, variant: 'own library only' | 'partners only' | 'spaces only' | 'all sources') =>
  queryBlock(readGeneratedSql(), `${method} (${variant})`).replaceAll(/\s+/g, ' ');

/** How many times `needle` occurs in `haystack`. Both are whitespace-collapsed SQL. */
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** The `union` arm of a whitespace-collapsed pool subquery that reads `table`. */
const armFor = (block: string, table: string) => block.split(' union ').find((arm) => arm.includes(`"${table}"`)) ?? '';

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
      'getSoloLocationCandidates',
      'getSoloDateCandidates',
      'getSoloEligibleRoundAsset',
      'getSoloRecentlyUsedAssetIds',
      'getSoloChallengeCount',
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
      'deleteUnplayedChallenges',
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

    it('keeps the solo pool behind the timeline visibility floor and off shared albums', () => {
      for (const method of SOLO_QUERIES) {
        for (const variant of ['own library only', 'all sources'] as const) {
          const block = soloBlock(method, variant);

          expect(
            block,
            `GameRepository.${method} (${variant}) lost the timeline visibility floor. That single\n` +
              `clause is what excludes archived, hidden and LOCKED assets, and none of the read arms\n` +
              `exclude them on their own: the space paths answer "is this reachable", not "is this\n` +
              `showable", and the partner arm answers only "did they share with me".`,
          ).toContain('"asset"."visibility" =');

          expect(
            block,
            `GameRepository.${method} (${variant}) references album_user. Shared albums are\n` +
              `deliberately NOT a read arm for the game pool - see design section 7.`,
          ).not.toContain('album_user');
        }
      }
    });

    it('samples before ranking in the solo pool too', () => {
      for (const variant of ['own library only', 'all sources'] as const) {
        const block = soloBlock('getSoloLocationCandidates', variant);
        const stageOne = block.slice(block.indexOf('with "sample"'), block.indexOf('from "sample"'));

        expect(
          block,
          `getSoloLocationCandidates (${variant}) no longer has a "sample" CTE - the two-term CLIP\n` +
            `expression is back to being evaluated over every eligible row. See the space guard\n` +
            `above for the measurement.`,
        ).toContain('with "sample"');

        expect(
          stageOne,
          `getSoloLocationCandidates (${variant}) stage 1 references smart_search. Stage 1 exists\n` +
            `precisely to avoid touching the vector column.`,
        ).not.toContain('smart_search');

        expect(
          stageOne,
          `getSoloLocationCandidates (${variant}) stage 1 references asset_face. The face gate\n` +
            `belongs in stage 2, scoped to the sample.`,
        ).not.toContain('asset_face');
      }
    });

    it('reaches past the player only when the source toggles ask it to', () => {
      for (const method of SOLO_QUERIES) {
        const ownOnly = soloBlock(method, 'own library only');

        expect(
          ownOnly,
          `GameRepository.${method} lost the player's own arm - with both toggles off there is\n` +
            `nothing else left, so the pool is now either empty or unscoped.`,
        ).toContain('"asset"."ownerId" =');

        for (const widened of ['partner', 'shared_space']) {
          expect(
            ownOnly,
            `GameRepository.${method} references ${widened} with BOTH source toggles off. The\n` +
              `toggles are frozen onto the challenge row precisely so a player who never opted in\n` +
              `is never shown someone else's photo - an arm that is emitted unconditionally makes\n` +
              `the toggle decorative.`,
          ).not.toContain(widened);
        }

        // The asymmetric case: exactly one toggle on. Both symmetric variants above look identical
        // whether each arm reads its OWN flag or the other one, so this is the only variant that
        // can catch a cross-wired gate - and a cross-wired gate hands shared-space photos to a
        // player who opted into partner photos alone.
        const partnersOnly = soloBlock(method, 'partners only');

        expect(
          partnersOnly,
          `GameRepository.${method} lost the partner arm with includePartners ON and\n` +
            `includeSpaces off. Either the arm is gone, or it is gated on the WRONG toggle.`,
        ).toContain('"partner"."inTimeline"');

        expect(
          partnersOnly,
          `GameRepository.${method} reads shared_space with includeSpaces OFF. The space arm is\n` +
            `gated on the wrong toggle: a player who opted into partner photos alone is being\n` +
            `served photos from every space they belong to.`,
        ).not.toContain('shared_space');

        // The other asymmetric direction, and the one nothing above can see: a PARTNER arm gated
        // on withSpaces is absent under `partners only` (correctly, from that variant's point of
        // view) and present under both symmetric variants (also correctly), so it clears all three
        // of the guards above while handing a spaces-only player their partner's photos.
        const spacesOnly = soloBlock(method, 'spaces only');

        expect(
          spacesOnly,
          `GameRepository.${method} lost the shared-space arm with includeSpaces ON and\n` +
            `includePartners off. Either the arm is gone, or it is gated on the WRONG toggle.`,
        ).toContain('shared_space');

        expect(
          spacesOnly,
          `GameRepository.${method} reads partner with includePartners OFF. The partner arm is\n` +
            `gated on the wrong toggle: a player who opted into shared-space photos alone is being\n` +
            `served their partner's library.`,
        ).not.toContain('"partner"."inTimeline"');

        const allSources = soloBlock(method, 'all sources');
        // The four space access paths, plus the partner arm. Losing one is a SAFE error direction
        // (a strict subset) and therefore silent: the player just quietly stops seeing photos from
        // that path, and nothing reports it.
        for (const arm of [
          '"partner"."inTimeline"',
          'shared_space_asset',
          'shared_space_library',
          'album_asset',
          'album_space_asset',
        ]) {
          expect(
            allSources,
            `GameRepository.${method} no longer covers ${arm} with both source toggles on. A\n` +
              `player whose shared photos all arrive through that one path sees an empty pool and\n` +
              `is told they have no usable photos.`,
          ).toContain(arm);
        }
      }
    });

    it("scopes every solo space arm to the player's own membership", () => {
      // The opposite failure direction to the arm-coverage guard above, and the dangerous one: an
      // arm that survived but lost its membership predicate pours EVERY space's photos into one
      // player's pool. Only the subset error is self-reporting, so this half has to be pinned
      // separately.
      for (const method of ['getSoloLocationCandidates', 'getSoloDateCandidates']) {
        const block = soloBlock(method, 'all sources');
        for (const table of ['shared_space_asset', 'shared_space_library', 'album_asset', 'album_space_asset']) {
          expect(
            armFor(block, table),
            `GameRepository.${method}'s ${table} arm is not scoped to the player's membership.\n` +
              `Without that predicate the arm returns every space's assets, to every player.`,
          ).toContain('"shared_space_member"."userId" =');

          expect(
            armFor(block, table),
            `GameRepository.${method}'s ${table} arm lost the per-member showInTimeline gate, so a\n` +
              `space the player has hidden from their own timeline feeds the game anyway. That gate\n` +
              `is the per-space counterpart of partner.inTimeline: includeSpaces is a coarse global\n` +
              `opt-in, this flag is the finer intent, and the finer one wins. This fork has already\n` +
              `removed this same gate once (utils/database.ts) and had to restore it.`,
          ).toContain('"shared_space_member"."showInTimeline" =');
        }
      }

      // The correlated per-asset form has no unions to split on; every arm is an EXISTS, and they
      // all carry the same membership join.
      //
      // Counted, not merely `toContain`: there are FOUR space access paths (shared_space_asset,
      // shared_space_library, album_asset, album_space_asset), each its own EXISTS, and a
      // `toContain` is satisfied by the predicate surviving on ONE of them. Three unscoped arms
      // would serve any space's asset to any player and read as perfectly healthy here. If a fifth
      // access path is ever added, this number moves with it - deliberately, because adding a path
      // without its membership join is precisely the change that must not pass silently.
      const roundAsset = soloBlock('getSoloEligibleRoundAsset', 'all sources');
      expect(
        countOf(roundAsset, '"shared_space_member"."userId" ='),
        'getSoloEligibleRoundAsset carries the membership predicate on only SOME of its four space\n' +
          "arms. Every one of them needs it: an arm without it serves any space's asset to any\n" +
          'player, and the arms that still have it are what makes that invisible to a `toContain`.',
      ).toBe(4);
      expect(
        countOf(roundAsset, '"shared_space_member"."showInTimeline" ='),
        'getSoloEligibleRoundAsset lost the per-member showInTimeline gate on at least one arm, so\n' +
          'it would serve a round image from a space the candidate queries are no longer allowed to\n' +
          'draw from - the two forms have to express the same set.',
      ).toBe(4);
      expect(
        roundAsset,
        "getSoloEligibleRoundAsset lost the partner arm's inTimeline check. The access layer\n" +
          'deliberately ignores that flag; the game does not.',
      ).toContain('"partner"."inTimeline"');
    });

    it('prunes only unplayed challenges - a single guess anywhere in a challenge keeps it out of the delete set', () => {
      const block = queryBlock(readGeneratedSql(), 'deleteUnplayedChallenges').replaceAll(/\s+/g, ' ');

      expect(
        block,
        'GameRepository.deleteUnplayedChallenges lost its "createdAt" < $ clause - the retention\n' +
          'window is the whole point of the nightly prune. Regenerate with `mise sql`.',
      ).toContain('"createdAt" < $');

      // "not in (select challengeId from game_round INNER JOIN game_guess ...)": the INNER join
      // means a challenge's id only lands in that subquery once at least one of its rounds has a
      // game_guess row, so a PARTIALLY played challenge (one guess, four rounds still unanswered)
      // is excluded from the delete target exactly like a fully played one - this is the "zero
      // guesses", not "not finished", rule the design calls for. Losing the join (or weakening it
      // to a LEFT join) would silently let every challenge - including ones with a real score
      // already on the leaderboard and in a player's history - back into the delete set.
      expect(
        block,
        'GameRepository.deleteUnplayedChallenges no longer excludes a challenge with an INNER\n' +
          'join to game_guess. A challenge someone has already scored on could now be pruned,\n' +
          'silently rewriting history and stats they have already seen. Regenerate with `mise sql`.',
      ).toMatch(/not in \( select "game_round"\."challengeId" from "game_round" inner join "game_guess"/);
    });
  });
});
