# Game Candidate-Query Performance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make challenge generation cost proportional to the sample size and the space, not to the whole library — taking the measured cold-cache case from 14–19 s to under 200 ms.

**Architecture:** Two independent changes to `GameRepository`'s candidate queries. First, split location-candidate selection into a cheap seeded sample (stage 1, narrow columns) and an expensive rank over just that sample (stage 2, vectors + face gate). Second, drive the space-scoped stage 1 _from_ the space membership tables instead of scanning every asset and testing membership. Neither changes the service, the DTOs, or any client.

**Tech Stack:** NestJS 11, Kysely, PostgreSQL 14 with vectorchord, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-photoguesser-solo-design.md` (§4, §14.0, §14.1)

## Global Constraints

- These changes fold into **PR #1000, which has not merged**. Do not create a new migration; there is no schema change here at all.
- Regenerate SQL with this **exact command**, from the worktree root:

  ```bash
  DB_HOSTNAME=localhost DB_PORT=5435 DB_USERNAME=postgres DB_PASSWORD=postgres DB_DATABASE_NAME=immich mise sql
  ```

  **Never run a bare `mise sql`.** Without the env prefix `DB_HOSTNAME` defaults to the
  docker-internal host `database`, which is unreachable from the host — and a failed connection
  deletes every file in `server/src/queries/`. The prefix above points it at the running e2e
  Postgres and was verified before execution began: `Wrote 62 files / Generated 674 queries / Done`,
  with `git status server/src/queries/` clean afterwards. `make sql` is removed and errors out.

- The Bash working directory **persists between commands** in this harness. Every command in this
  plan assumes the worktree root; `cd` explicitly rather than relying on where the last one left you.

- **The e2e stack does not run your source code.** `e2e/docker-compose.yml:14` gives
  `immich-e2e-server` `image: immich-server:latest` with **no source volume mount**, so the running
  container is a snapshot from whenever that image was last built. Running `cd e2e && pnpm test …`
  after editing `server/src/` therefore tests the _image_, not your change — it will pass or fail
  identically whether your edit is correct, wrong, or absent. That is a false green, and it is worse
  than no test at all.

  Consequently, **Tasks 2–4 do not use e2e as their per-task gate.** Their gate is the generated-SQL
  shape guards plus unit tests, which _are_ source-derived: `mise sql` regenerates
  `server/src/queries/game.repository.sql` from the live decorated methods, and the guards read that
  file from disk. The behavioural e2e net runs **once**, in Task 4's final step, against an image
  built from the post-change source.

  To run e2e against current source without disturbing the shared stack (which other sessions use),
  build a distinctly-tagged image and a sibling container on a spare port, then point the run at it —
  the recipe Task 1 proved works:

  ```bash
  docker compose -f e2e/docker-compose.yml build immich-server   # picks up current source
  # run a sibling container on :2287 attached to the same compose network, then:
  cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2287 pnpm test <path>
  # finally: docker rm -f <sibling> && docker rmi <its tag>
  ```

  Never rebuild or restart `immich-e2e-server` / `immich-e2e-postgres` themselves.

- Server unit tests: `cd server && pnpm test -- --run <path>`. **The `<path>` is required** — `pnpm test -- --run` alone silently runs the entire suite.
- E2E tests: `cd e2e && pnpm test <path>`. **Do not add `--run`** — the e2e `test` script already includes it and adding it again crashes.
- Sample size is **4,000**, measured. Do not change it without re-running the sweep in §4.4 of the spec.
- Face-area threshold stays **0.05**. Scene-gate prompts and `CANDIDATE_POOL_LIMIT = 200` are unchanged.
- Every task ends green: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts src/services/game.service.spec.ts`.

---

### Task 1: Pin the visibility invariant before touching any query

The candidate queries are about to be rewritten. Today **nothing** asserts that archived, hidden, or locked assets are excluded from the pool — grep `game.e2e-spec.ts`, `game.service.spec.ts`, and `game.repository.spec.ts` and you will find no such test. The `visibility = 'timeline'` clause in `eligibleSpaceAsset` is unprotected, and a rewrite could silently drop it.

This is a **characterization test**: it passes against the current tree because the behaviour is already correct. That makes the usual red-then-green cycle impossible, so red is proven by deliberate mutation instead (Step 2). Do not skip that step — an unproven characterization test is the exact thing that lets a refactor delete a security control silently.

**Files:**

- Test: `e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts` (create)
- Reference pattern: `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts:96-106`
- Mutation target (temporary, Step 2 only): `server/src/repositories/game.repository.ts:203`

**Interfaces:**

- Consumes: `utils.createSpace`, `utils.addSpaceMember`, `utils.addSpaceAssets`, `utils.createAsset` from `e2e/src/utils.ts`; `updateAssets` from `@immich/sdk`.
- Produces: nothing consumed by later tasks. This is a safety net.

- [ ] **Step 1: Write the failing test**

Create `e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts`:

```ts
import { AssetVisibility, LoginResponseDto, SharedSpaceRole, updateAssets } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The game pool must never surface an asset the owner has taken out of their timeline.
 *
 * These are characterization tests: they pass against the unmodified tree. Their job is to fail
 * when a future refactor drops the `visibility = 'timeline'` clause from eligibleSpaceAsset - the
 * clause is the ONLY thing excluding archived, hidden and locked assets, and none of the helpers
 * the predicate is built from exclude them on their own (spaceVisibilityGate admits archive,
 * checkPartnerAccess admits hidden, checkAlbumAccess gates on nothing).
 */
describe('/games (visibility negatives)', () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    [owner, editor] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('gamevis-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('gamevis-editor')),
    ]);
  });

  const setVisibility = (assetId: string, visibility: AssetVisibility) =>
    updateAssets({ assetBulkUpdateDto: { ids: [assetId], visibility } }, { headers: asBearerAuth(owner.accessToken) });

  /**
   * A space holding exactly two photos: one left on the timeline, one moved to `hidden`.
   * Requesting a 2-round challenge can therefore only be satisfied by the visible photo, and the
   * generator returns a SHORTER challenge rather than reaching for the excluded one.
   */
  const spaceWithOneExcluded = async (name: string, visibility: AssetVisibility) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });

    const visible = await utils.createAsset(owner.accessToken, { assetData: { filename: `${name}-visible.png` } });
    const excluded = await utils.createAsset(owner.accessToken, { assetData: { filename: `${name}-excluded.png` } });
    await utils.addSpaceAssets(owner.accessToken, space.id, [visible.id, excluded.id]);
    await setVisibility(excluded.id, visibility);

    return { spaceId: space.id, visibleId: visible.id, excludedId: excluded.id };
  };

  const createChallenge = async (spaceId: string, roundCount: number) => {
    const { status, body } = await request(app)
      .post(`/shared-spaces/${spaceId}/games`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .send({ roundCount });
    expect(status).toBe(201);
    return body;
  };

  /** Play every round so the detail response reveals each round's assetId. */
  const revealedAssetIds = async (challengeId: string): Promise<string[]> => {
    const detail = await request(app).get(`/games/${challengeId}`).set('Authorization', `Bearer ${editor.accessToken}`);
    expect(detail.status).toBe(200);

    for (const round of detail.body.rounds) {
      await request(app)
        .post(`/games/${challengeId}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ date: new Date('2020-01-01').toISOString() });
    }

    const played = await request(app).get(`/games/${challengeId}`).set('Authorization', `Bearer ${editor.accessToken}`);
    expect(played.status).toBe(200);
    return played.body.rounds.map((round: { assetId: string }) => round.assetId);
  };

  for (const visibility of [AssetVisibility.Archive, AssetVisibility.Hidden, AssetVisibility.Locked] as const) {
    it(`never draws a round from an asset whose visibility is '${visibility}'`, async () => {
      const { spaceId, visibleId, excludedId } = await spaceWithOneExcluded(`gamevis-${visibility}`, visibility);

      const challenge = await createChallenge(spaceId, 2);

      // The generator could only fill one round, because the other photo is excluded.
      expect(
        challenge.roundCount,
        `A ${visibility} asset was drawn into the pool. eligibleSpaceAsset lost its\n` +
          `visibility = 'timeline' clause - that clause is the only thing excluding archived,\n` +
          `hidden and locked assets from the game.`,
      ).toBe(1);

      const assetIds = await revealedAssetIds(challenge.id);
      expect(assetIds).toEqual([visibleId]);
      expect(assetIds).not.toContain(excludedId);
    });
  }
});
```

- [ ] **Step 2: Prove the test can fail, by mutation**

This test passes on the unmodified tree. Prove it is not vacuous by temporarily deleting the clause it guards.

In `server/src/repositories/game.repository.ts`, comment out line 203 inside `eligibleSpaceAsset`:

```ts
    eb('asset.deletedAt', 'is', null),
    eb('asset.type', '=', AssetType.Image),
    // eb('asset.visibility', '=', AssetVisibility.Timeline),   // <-- TEMPORARY, Step 2 only
```

Run: `cd e2e && pnpm test src/specs/server/api/game-visibility-negatives.e2e-spec.ts`

Expected: **all three cases FAIL** with `expected 2 to be 1` — the excluded asset is now drawn into the pool.

If any case still passes, the test is not exercising what it claims. Fix the test before continuing.

- [ ] **Step 3: Restore the clause**

Un-comment line 203 exactly as it was:

```ts
    eb('asset.visibility', '=', AssetVisibility.Timeline),
```

Confirm with `git diff server/src/repositories/game.repository.ts` — it must be empty.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd e2e && pnpm test src/specs/server/api/game-visibility-negatives.e2e-spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts
git commit -m "test(game): pin the pool's archived, hidden and locked exclusions

Nothing asserted these before. The visibility = 'timeline' clause in
eligibleSpaceAsset is the only thing keeping an archived or locked photo out
of a challenge, and the candidate queries are about to be rewritten.

Proven red by deleting the clause: all three cases fail with the excluded
asset drawn into the pool."
```

---

### Task 2: Make the face-area gate correlated

The face gate is a `LEFT JOIN` to an **uncorrelated** `GROUP BY assetId` subquery, so Postgres aggregates every visible face row in the database — 58,192 rows on the reference instance — regardless of how few candidates the query actually wants. Replacing it with a correlated `NOT EXISTS … HAVING` scopes the aggregate to the rows under consideration.

The two forms are equivalent, verified on 56,730 rows with a symmetric difference of 0 in both directions. **One branch is unverified by that check:** the reference library contains no face group whose `max(imageWidth) * max(imageHeight)` is 0, so the NULL-denominator path never executed. That branch gets a unit test here.

**Files:**

- Modify: `server/src/repositories/game.repository.ts` (the `face_area` left join inside `getLocationCandidates`, currently lines 287–299)
- Modify: `server/src/queries/game.repository.sql` (regenerated, never hand-edited)
- Test: `server/src/repositories/game.repository.spec.ts` (extend `describe('generated query shape')`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `getLocationCandidates(spaceId, limit, seed, scenePrompts?)` keeps its exact signature and return type `Promise<GameCandidate[]>`. Task 3 rewrites its body further.

- [ ] **Step 1: Write the failing test**

Add to the `describe('generated query shape')` block in `server/src/repositories/game.repository.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts`
Expected: FAIL — the generated SQL still contains the uncorrelated `left join ( select "asset_face"."assetId" ... group by ... )` and no `not exists` / `having`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/repositories/game.repository.ts`, delete the `.leftJoin((eb) => eb.selectFrom('asset_face')…).as('face_area')` block and its `.where((eb) => eb.or([eb('face_area.faceAreaRatio', 'is', null), eb('face_area.faceAreaRatio', '<=', MAX_FACE_AREA_RATIO)]))`, replacing both with:

```ts
      // Correlated, not an uncorrelated LEFT JOIN to a grouped subquery: the latter aggregates
      // every visible face row in the database before joining, which is 58k rows on the
      // reference library to gate a few thousand candidates.
      //
      // Equivalent to the old `ratio IS NULL OR ratio <= 0.05` in all three cases, and the
      // equivalence was verified against a real 56,730-row library (symmetric difference 0):
      //   - no faces        -> no group -> NOT EXISTS is true  -> kept
      //   - zero image area -> nullif gives NULL, `NULL > 0.05` is NULL, HAVING drops the group
      //                        -> NOT EXISTS is true           -> kept
      //   - ratio > 0.05    -> group survives HAVING           -> excluded
      // The zero-image-area branch has no rows in any library measured, so it is covered by
      // game-face-gate.spec.ts rather than by production data.
      // NOTE the SHADOWED inner `eb` in the exists() callback. The outer builder is scoped to the
      // outer query, so using outer `eb.ref('f.…')` here would resolve against the wrong context.
      // The callback form is the codebase pattern - see database.ts:893 and
      // asset.repository.ts:386.
      .where((eb) =>
        eb.not(
          eb.exists((eb) =>
            eb
              .selectFrom('asset_face as f')
              .select(sql`1`.as('one'))
              .whereRef('f.assetId', '=', 'asset.id')
              .where('f.deletedAt', 'is', null)
              .where('f.isVisible', '=', true)
              .groupBy('f.assetId')
              .having(
                sql<number>`sum(("f"."boundingBoxX2" - "f"."boundingBoxX1") * ("f"."boundingBoxY2" - "f"."boundingBoxY1"))::double precision / nullif(max("f"."imageWidth")::double precision * max("f"."imageHeight"), 0)`,
                '>',
                MAX_FACE_AREA_RATIO,
              ),
          ),
        ),
      )
```

The `::double precision` cast on the **numerator** is load-bearing and is already guarded by the existing `divides the face-area ratio in floating point` test — `sum(integer)` is `bigint`, `max(int)*max(int)` is `integer`, and `bigint/integer` truncates, which would make every ratio 0 and the gate admit every portrait.

- [ ] **Step 4: Regenerate the SQL and run the tests**

Ensure a database is running (`make dev` or the e2e stack), then:

Run: `mise sql`
Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts`
Expected: PASS, including the pre-existing floating-point-division and four-arms guards.

- [ ] **Step 5: Write the NULL-denominator unit test**

Create `server/src/repositories/game-face-gate.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

/**
 * The face gate's three branches, as pure arithmetic over the same expression the SQL evaluates.
 *
 * This exists because the SQL-level equivalence between the old LEFT JOIN form and the new
 * correlated form was verified empirically against a 56,730-row library that contains ZERO face
 * groups with a zero image area - so the NULL-denominator branch was never executed by that
 * check. It is reasoning-only in production data, and reasoning-only branches are how the
 * integer-division defect survived two review cycles.
 */
const MAX_FACE_AREA_RATIO = 0.05;

/** `sum(area)::double precision / nullif(width * height, 0)`, as JS. */
const faceAreaRatio = (faceArea: number, imageWidth: number, imageHeight: number): number | null => {
  const denominator = imageWidth * imageHeight;
  return denominator === 0 ? null : faceArea / denominator;
};

/** `NOT EXISTS (... HAVING ratio > 0.05)` - a NULL ratio fails HAVING, so the group vanishes. */
const isKept = (ratio: number | null): boolean => !(ratio !== null && ratio > MAX_FACE_AREA_RATIO);

describe('face-area gate', () => {
  it('keeps an asset with no faces at all', () => {
    // No face rows means no group, so NOT EXISTS is trivially true.
    expect(isKept(null)).toBe(true);
  });

  it('keeps an asset whose face group has zero image area', () => {
    // nullif(0, 0) is NULL, `NULL > 0.05` is NULL, HAVING drops the group, NOT EXISTS is true.
    // Unexercised by every library measured - this is the only coverage it has.
    expect(faceAreaRatio(5000, 0, 0)).toBeNull();
    expect(isKept(faceAreaRatio(5000, 0, 0))).toBe(true);
  });

  it('keeps an asset whose faces cover exactly the threshold', () => {
    expect(isKept(faceAreaRatio(500, 100, 100))).toBe(true);
  });

  it('excludes an asset whose faces cover more than the threshold', () => {
    expect(isKept(faceAreaRatio(5001, 100, 100))).toBe(false);
  });

  it('divides in floating point, so a sub-threshold ratio is not truncated to zero', () => {
    // The integer-division defect: bigint/integer truncates, every ratio becomes 0, and the gate
    // admits every portrait while looking healthy.
    expect(faceAreaRatio(6000, 100, 100)).toBeCloseTo(0.6, 10);
    expect(isKept(faceAreaRatio(6000, 100, 100))).toBe(false);
  });
});
```

- [ ] **Step 6: Run the new unit test**

Run: `cd server && pnpm test -- --run src/repositories/game-face-gate.spec.ts`
Expected: PASS, 5 tests.

Do **not** run the e2e suite here. Per the Global Constraints, `immich-e2e-server` runs a prebuilt
image with no source mount, so an e2e run at this point would pass regardless of whether this task's
change is correct — a false green. The behavioural net runs once in Task 4, against a rebuilt image.
This task's real gate is the generated-SQL guard in Step 4, which _is_ source-derived.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/game.repository.ts server/src/repositories/game.repository.spec.ts \
        server/src/repositories/game-face-gate.spec.ts server/src/queries/game.repository.sql
git commit -m "perf(game): correlate the face-area gate to the candidate rows

The gate was a LEFT JOIN to an uncorrelated GROUP BY over asset_face, so
Postgres aggregated every visible face in the database - 58k rows on the
reference library - to gate a few thousand candidates.

Equivalence with the old form verified on 56,730 rows, symmetric difference
0 both ways. The zero-image-area branch has no rows in any library measured,
so it gets a unit test rather than a claim."
```

---

### Task 3: Two-stage candidate selection

`getLocationCandidates` orders by `(embedding <=> notPlace) - (embedding <=> place)`. That two-term expression cannot use `clip_index`, so the `LIMIT 200` is a top-N sort _after_ scoring every eligible row: 30,212 vectors and 133 MB of TOAST reads on the reference library, which is why the query is 482 ms warm and 17–19 s cold.

Split it. Stage 1 takes a seeded sample of 4,000 using narrow columns only. Stage 2 ranks just those.

**Files:**

- Modify: `server/src/repositories/game.repository.ts` (`getLocationCandidates`)
- Modify: `server/src/queries/game.repository.sql` (regenerated)
- Test: `server/src/repositories/game.repository.spec.ts`

**Interfaces:**

- Consumes: the correlated face gate from Task 2.
- Produces: `getLocationCandidates` signature and return type unchanged. A new exported constant `LOCATION_SAMPLE_SIZE = 4000`.

- [ ] **Step 1: Write the failing test**

Add to `describe('generated query shape')` in `server/src/repositories/game.repository.spec.ts`:

```ts
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
    'The stage-1 sample CTE references asset_face. The face gate belongs in stage 2, scoped\n' + 'to the sample.',
  ).not.toContain('asset_face');
});
```

Note: `queryBlock` already asserts the `-- GameRepository.getLocationCandidates` marker exists, so a renamed method fails loudly instead of passing vacuously.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts`
Expected: FAIL with `expected '…' to contain 'with "sample"'` — there is no CTE at all today.

- [ ] **Step 3: Write minimal implementation**

Add near `CANDIDATE_POOL_LIMIT`'s companions at the top of `server/src/repositories/game.repository.ts`:

```ts
/**
 * How many eligible rows stage 1 samples before stage 2 ranks them.
 *
 * MEASURED, not guessed - see design §4.4. Against 27,227 gated candidates on the reference
 * library, this retains 91% of the mean placeyness score of a full ranking, and the worst photo
 * the downstream rank-biased draw can reach sits at global rank 302 (top 1.1%). Dropping to 2,000
 * moves that to rank 692; raising to 8,000 buys rank 150 for 2.3x the time. 4,000 is the knee.
 *
 * The cost of getting this wrong is asymmetric: too small silently degrades round quality in a
 * way no test catches, too large reintroduces the cold-cache cliff. Re-run the sweep before
 * changing it.
 */
export const LOCATION_SAMPLE_SIZE = 4000;
```

Restructure `getLocationCandidates` so the eligibility scope, GPS filter, and seeded order form a CTE, and the vector join plus face gate apply to it:

```ts
const rows = await this.db
  .with('sample', (db) =>
    db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where((eb) => eligibleSpaceAsset(eb, spaceId))
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .select([
        'asset.id as assetId',
        'asset_exif.latitude as lat',
        'asset_exif.longitude as lon',
        'asset.localDateTime as takenAt',
        'asset_exif.country as country',
      ])
      // Narrow columns only. No smart_search, no asset_face - that is the whole point.
      .orderBy(seededOrder(seed))
      .limit(LOCATION_SAMPLE_SIZE),
  )
  .selectFrom('sample')
  .leftJoin('smart_search', 'smart_search.assetId', 'sample.assetId')
  // ... the Task 2 face-gate NOT EXISTS, correlated on `sample.assetId` instead of `asset.id`
  .selectAll('sample')
  .$if(!!scenePrompts, (qb) =>
    qb.orderBy(
      sql<number>`(smart_search.embedding <=> ${asVector(scenePrompts!.notPlace)}) - (smart_search.embedding <=> ${asVector(scenePrompts!.place)})`,
      (ob) => ob.desc().nullsLast(),
    ),
  )
  .orderBy(sql`md5("sample"."assetId"::text || ${seed})`)
  .limit(limit)
  .execute();
```

The face-gate `whereRef` correlation changes from `'asset.id'` to `'sample.assetId'`. The stable seeded tiebreak is preserved — it is what keeps generation deterministic when the CLIP ordering is skipped or ties.

- [ ] **Step 4: Regenerate and run**

Run: `mise sql` (database must be running)
Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts src/services/game.service.spec.ts`
Expected: PASS.

If the `scopes every asset query to all four of a space's asset paths` test fails here, that is expected only if you moved `eligibleSpaceAsset` out of the CTE — it must stay inside stage 1. Put it back rather than weakening the guard.

- [ ] **Step 5: Confirm the seeded tiebreak survived**

Run: `cd server && pnpm test -- --run src/services/game.service.spec.ts`
Expected: PASS. Generation determinism is the property most at risk from restructuring the query —
the seeded `md5` tiebreak must still order the stage-2 result, or the same seed stops producing the
same challenge.

Do **not** run the e2e suite here — see the Global Constraints. It would test the prebuilt image
rather than your change. The behavioural net runs once in Task 4.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/game.repository.ts server/src/repositories/game.repository.spec.ts \
        server/src/queries/game.repository.sql
git commit -m "perf(game): sample before ranking location candidates

The CLIP ordering is a two-term expression, so it cannot use clip_index and
the LIMIT 200 was a top-N sort after scoring every eligible row - 30,212
vectors and 133 MB of TOAST reads on the reference library. Measured at
482 ms warm and 17-19 s cold.

Stage 1 samples 4,000 rows using narrow columns only; stage 2 ranks those.
Sample size is measured, not guessed: it keeps 91% of mean placeyness and
the worst photo the draw reaches is at global rank 302 of 27,227."
```

---

### Task 4: Drive space eligibility from the space tables

`eligibleSpaceAsset` composes four correlated `EXISTS` arms evaluated _per asset over the whole table_, so a space's cost is independent of the space's size — the 1.3k space and the 56.5k space both scan all 62k assets. Stage 1 must instead start from the space's own membership rows.

This changes the shape the existing four-arms guard matches on, so that guard is rewritten here — **rewritten, not relaxed**. It still has to fail when an arm disappears.

**Files:**

- Modify: `server/src/utils/shared-space-album-scope.ts` (add `spaceAssetIdUnion`)
- Modify: `server/src/repositories/game.repository.ts` (`getLocationCandidates`, `getDateCandidates`)
- Modify: `server/src/repositories/game.repository.spec.ts` (rewrite the four-arms guard)
- Modify: `server/src/queries/game.repository.sql` (regenerated)

**Interfaces:**

- Consumes: `LOCATION_SAMPLE_SIZE` and the stage-1 CTE from Task 3.
- Produces: `spaceAssetIdUnion(db, spaceId)` returning a Kysely subquery of `{ assetId: string }` covering all four space asset paths. Plan B's `SpacePool` consumes this.
- `getEligibleRoundAsset` is deliberately **not** changed: it resolves one known asset id, so the correlated form is already index-driven and optimal.

- [ ] **Step 1: Write the failing test**

Replace the body of the existing `it("scopes every asset query to all four of a space's asset paths")` in `server/src/repositories/game.repository.spec.ts`. Keep the test name; change what it matches:

```ts
it("scopes every asset query to all four of a space's asset paths", () => {
  const sql = readGeneratedSql();

  // A shared space's asset set is direct + linked library + linked album + cross-owner
  // contribution. Dropping an arm is a SAFE error direction (a strict subset, never widened
  // visibility) and therefore silent: a space filled entirely through a linked album yields
  // zero candidates and reports itself as having no photos usable for a challenge.
  //
  // getLocationCandidates and getDateCandidates now DRIVE FROM the space tables (a union of
  // the four paths) rather than scanning asset and testing membership, so each arm is matched
  // on its own source table plus the spaceId filter that scopes it - not on a correlation
  // predicate against "asset", which the union form no longer has.
  const drivenArms = {
    'directly added asset': /from "shared_space_asset" where .*"spaceId" =/,
    'linked library': /from "shared_space_library" where .*"spaceId" =/,
    'linked album': /"album_asset"\."albumId" = "shared_space_album"\."albumId"/,
    'cross-owner album contribution': /"album_space_asset"\."albumId" = "shared_space_album"\."albumId"/,
  };

  for (const method of ['getLocationCandidates', 'getDateCandidates']) {
    const block = queryBlock(sql, method).replaceAll(/\s+/g, ' ');
    for (const [arm, pattern] of Object.entries(drivenArms)) {
      expect(
        block,
        `GameRepository.${method} no longer covers the "${arm}" access path. A space populated\n` +
          `only through that path becomes invisible to the game - zero candidates, and a\n` +
          `"this space has no photos usable for a challenge" error on a space full of photos.\n` +
          `Scope stage 1 with spaceAssetIdUnion and regenerate with \`mise sql\`.`,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts`
Expected: FAIL on `getLocationCandidates` / `"directly added asset"` — the generated SQL still uses the correlated `exists (… where "shared_space_asset"."assetId" = "asset"."id")` form, not `from "shared_space_asset" where … "spaceId" =`.

- [ ] **Step 3: Add the union helper**

Append to `server/src/utils/shared-space-album-scope.ts`:

```ts
/**
 * Every asset id reachable from one space, as a UNION over the four access paths.
 *
 * The counterpart to `spaceAssetPathBranches`, which tests membership per candidate row. Both
 * express the same set; they differ in which side drives. Use the branches when you already have
 * a specific asset (one index probe); use this union when you are SELECTING the space's assets,
 * because the correlated form makes cost proportional to the whole asset table rather than to the
 * space - measured at 3.7 GB of buffers and 14 s cold for a 56.5k-asset space, versus 406 MB and
 * 169 ms driving from here.
 *
 * `union` (not `union all`) because the paths overlap: an asset can be both directly added and
 * present through a linked album.
 */
export function spaceAssetIdUnion(db: Kysely<DB>, spaceId: string) {
  return db
    .selectFrom('shared_space_asset')
    .select('shared_space_asset.assetId as assetId')
    .where('shared_space_asset.spaceId', '=', spaceId)
    .union(
      db
        .selectFrom('asset')
        .innerJoin('shared_space_library', (join) =>
          join
            .onRef('shared_space_library.libraryId', '=', 'asset.libraryId')
            .on('shared_space_library.spaceId', '=', spaceId),
        )
        .select('asset.id as assetId'),
    )
    .union(
      db
        .selectFrom('shared_space_album')
        .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
        .innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        )
        .select('album_asset.assetId as assetId')
        .where('shared_space_album.spaceId', '=', spaceId)
        .where('shared_space_album.showInTimeline', '=', true),
    )
    .union(
      db
        .selectFrom('shared_space_album')
        .innerJoin('album_space_asset', (join) =>
          join
            .onRef('album_space_asset.albumId', '=', 'shared_space_album.albumId')
            .onRef('album_space_asset.spaceId', '=', 'shared_space_album.spaceId'),
        )
        .innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        )
        .select('album_space_asset.assetId as assetId')
        .where('shared_space_album.spaceId', '=', spaceId)
        .where('shared_space_album.showInTimeline', '=', true),
    );
}
```

- [ ] **Step 4: Use it in both candidate queries**

In `getLocationCandidates`, replace the stage-1 `.where((eb) => eligibleSpaceAsset(eb, spaceId))` with a join to the union, keeping the three visibility/type/deleted clauses **outside** it:

The union is built from `this.db`, the same way `access.repository.ts:296` builds its four-way union, and passed in as a prebuilt subquery — do **not** try to construct it from the CTE callback's `QueryCreator` or a join's `ExpressionBuilder`, which are different types and will not accept `.union()` of a `Kysely`-rooted builder.

```ts
          .innerJoin(spaceAssetIdUnion(this.db, spaceId).as('space_asset'), (join) =>
            join.onRef('space_asset.assetId', '=', 'asset.id'),
          )
          .where('asset.deletedAt', 'is', null)
          .where('asset.type', '=', AssetType.Image)
          // The visibility floor stays here, ANDed outside the space union. None of the space
          // helpers exclude archived on their own - spaceVisibilityGate explicitly admits it.
          .where('asset.visibility', '=', AssetVisibility.Timeline)
```

Apply the identical change to `getDateCandidates`. Leave `getEligibleRoundAsset` alone.

- [ ] **Step 5: Regenerate and run the source-derived gates**

Run the pinned `mise sql` command from the Global Constraints (with the `DB_*` env prefix — never bare).
Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts src/services/game.service.spec.ts src/repositories/game-face-gate.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the behavioural net against an image built from the changed source**

This is the one e2e run in the plan, and it covers Tasks 2, 3 and 4 together. Until now every gate
has been static analysis of generated SQL; this is the only step that proves the rewritten queries
still behave correctly against a real database.

Build a distinctly-tagged image from current source and run a sibling container on a spare port —
**never** rebuild or restart the shared `immich-e2e-server` / `immich-e2e-postgres`, which other
sessions depend on:

```bash
docker compose -f e2e/docker-compose.yml build immich-server
# start a sibling container from the freshly built image on :2287, on the same compose network,
# with the same environment as the compose service but IMMICH_PORT=2287
cd e2e && PLAYWRIGHT_BASE_URL=http://127.0.0.1:2287 pnpm test \
  src/specs/server/api/game-visibility-negatives.e2e-spec.ts \
  src/specs/server/api/game.e2e-spec.ts
```

Expected: PASS — 3 visibility tests plus the full existing game suite.

The visibility net is the check that matters most: the union restructure is exactly the kind of
change that drops a `visibility = 'timeline'` clause silently. The full game suite is the check that
sampling did not change observable generation semantics.

Tear the sibling container and its image down afterwards, and confirm `immich-e2e-server`'s container
id and created timestamp are unchanged.

If the visibility tests fail here, **stop and fix before committing** — a green SQL guard with a red
behavioural test means the guard is matching text that does not mean what it appears to.

- [ ] **Step 7: Commit**

```bash
git add server/src/utils/shared-space-album-scope.ts server/src/repositories/game.repository.ts \
        server/src/repositories/game.repository.spec.ts server/src/queries/game.repository.sql
git commit -m "perf(game): drive space candidate queries from the space tables

eligibleSpaceAsset tests membership per asset row, so a space's generation
cost tracked the whole asset table rather than the space: the 1.3k space and
the 56.5k space both scanned all 62k assets.

Driving stage 1 from a union of the four access paths takes the 56.5k space
from 3.7 GB of buffers and 490-532 ms warm (13.9 s cold) to 406 MB and
143-154 ms (169 ms cold).

getEligibleRoundAsset keeps the correlated form - it resolves one known
asset id, where the union would be strictly worse. The four-arms guard is
rewritten to match the new shape rather than relaxed."
```

---

### Task 5: Confirm the measurement and record it

The numbers in the spec were taken against the pre-change tree. Confirm the post-change tree actually delivers them, on a real library, and record the result so the next person does not have to rediscover it.

**Files:**

- Modify: `docs/superpowers/specs/2026-08-19-photoguesser-solo-design.md` (§4.3 — add a measured-after column)

**Interfaces:**

- Consumes: all prior tasks.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Capture the post-change query plan**

Against a database with a real library (the reference instance, read-only), run `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` on the regenerated `getLocationCandidates` block from `server/src/queries/game.repository.sql`, substituting a real `spaceId` and two real 1152-dim vectors.

Record: total buffers (`hit` + `read`) from the top-level node, and `Execution Time` over four consecutive runs.

Note the `gallery` role already carries `ALTER ROLE … SET jit = off`; if connecting as `postgres`, issue `SET jit = off` first or the numbers will include 350–430 ms of JIT that production never pays.

- [ ] **Step 2: Compare against the target**

Expected, for a ~56k-asset space on a ~62k-image library:

| Metric  | Before     | Target after |
| ------- | ---------- | ------------ |
| Buffers | ~477,000   | ~52,000      |
| Warm    | 490–532 ms | 143–154 ms   |
| Cold    | 13.9 s     | < 250 ms     |

If buffers are still in the hundreds of thousands, stage 1 is not actually driving from the space tables — check the plan for a `Seq Scan on asset` feeding the sample CTE.

- [ ] **Step 3: Record the result in the spec**

Add a `Measured after` column to the §4.3 table with the real post-change figures, and change the section's opening line to state the date and instance the after-figures came from.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write docs/superpowers/specs/2026-08-19-photoguesser-solo-design.md
git add docs/superpowers/specs/2026-08-19-photoguesser-solo-design.md
git commit -m "docs(game): record the measured result of the candidate-query fixes"
```

---

## Done when

- [ ] `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts src/repositories/game-face-gate.spec.ts src/services/game.service.spec.ts` passes
- [ ] `cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts src/specs/server/api/game-visibility-negatives.e2e-spec.ts` passes
- [ ] `make check-server` and `make lint-server` pass
- [ ] `server/src/queries/game.repository.sql` is regenerated and committed, with no hand edits
- [ ] The measured after-figures are in the spec, and buffers dropped by roughly 9x
