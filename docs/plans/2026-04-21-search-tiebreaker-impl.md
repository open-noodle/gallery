# Smart Search Tiebreaker Removal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the fork-added `asset.id` secondary ORDER BY from `searchSmart` to restore Postgres's use of the vchord `clip_index` ordered scan. Expected perf gain: 3-16s → <1s on 200k-photo instances.

**Architecture:** The change is intentionally small — one `.orderBy('asset.id')` call removed from `server/src/repositories/search.repository.ts`. Supporting work: (1) extract a private query-builder helper so the SQL shape is testable offline via Kysely's `DummyDriver`, (2) add a unit spec that asserts "exactly one ORDER BY expression" on the inner query to prevent any future secondary-key regression (not just the specific `asset.id` case), (3) add frontend dedup regression tests since that dedup is now the load-bearing safety net, (4) regenerate reference SQL and update the load-bearing code comment.

**Tech Stack:** NestJS + Kysely 0.28.15 (server), SvelteKit + Svelte 5 + Vitest (web), `vchordrq` pgvector extension (DB). Design doc: `docs/plans/2026-04-21-search-tiebreaker-design.md`.

---

## Pre-flight

Before starting, from repo root:

```bash
# 1. Confirm dev stack is running (needed for `make sql` in Task 4).
docker ps --filter name=immich_postgres --format '{{.Names}} {{.Status}}'
# Expect: immich_postgres Up (healthy)

# 2. Confirm clean working tree.
git status
# Expect: "nothing to commit, working tree clean"

# 3. Create a feature branch.
git switch -c fix/search-tiebreaker-vchord
```

---

## Task 1: Add frontend dedup regression tests

The frontend dedup at `smart-search-results.svelte:50-51` is the sole cross-page duplicate guard after this change. It currently has zero test coverage. Add tests FIRST so we validate the safety net while the backend tiebreaker still exists — if anything in the dedup logic is subtly wrong, we want to know before removing the backend guard.

**Files:**

- Modify: `web/src/lib/components/search/smart-search-results.spec.ts`

**Step 1: Read the existing spec to match its style**

```bash
head -50 web/src/lib/components/search/smart-search-results.spec.ts
```

Note the mocking pattern — it mocks `searchSmart` from `@immich/sdk` via `vi.mock`. All new tests follow the same pattern.

**Step 2: Add the first dedup test (RED)**

Inside the `describe('SmartSearchResults', ...)` block, after the existing `'handles empty results'` test, add:

```ts
it('de-duplicates cross-page results on append by asset id', async () => {
  const page1 = [
    { id: 'asset-a' } as AssetResponseDto,
    { id: 'asset-b' } as AssetResponseDto,
    { id: 'asset-c' } as AssetResponseDto,
  ];
  const page2 = [
    // asset-b repeats (identical embedding scenario)
    { id: 'asset-b' } as AssetResponseDto,
    { id: 'asset-d' } as AssetResponseDto,
  ];

  mockedSearchSmart
    .mockResolvedValueOnce({ assets: { items: page1, nextPage: '2' } } as never)
    .mockResolvedValueOnce({ assets: { items: page2, nextPage: null } } as never);

  const { component } = render(SmartSearchResults, {
    props: { query: 'trees', filters: defaultFilters() },
  });
  await vi.waitFor(() => expect(mockedSearchSmart).toHaveBeenCalledTimes(1));

  // Load page 2 via component's public loadMore method (adjust to whatever the
  // component actually exposes — inspect smart-search-results.svelte for the
  // trigger; may be an IntersectionObserver effect or a bindable).
  await component.loadMore();
  await vi.waitFor(() => expect(mockedSearchSmart).toHaveBeenCalledTimes(2));

  const finalResults = component.searchResults;
  expect(finalResults.map((r) => r.id)).toEqual(['asset-a', 'asset-b', 'asset-c', 'asset-d']);
});
```

**Step 3: Run test to confirm it fails or passes correctly**

```bash
cd web
pnpm test -- --run src/lib/components/search/smart-search-results.spec.ts
```

If the test framework can't reach `component.loadMore()` / `component.searchResults`, the test needs to be rewritten to drive the component through its public interface (props, user events). Inspect `smart-search-results.svelte` and adjust. **Key invariant to test: after page 1 + page 2 load, no duplicate IDs appear in the rendered list.** The test as written above is illustrative — rewrite to match how the component actually exposes pagination state.

Once adjusted: the test should PASS against current code (backend tiebreaker + frontend dedup together prevent dups). The point is to lock in the frontend behavior.

**Step 4: Add the second dedup test**

```ts
it('does not render duplicate assets when every page-2 result was on page 1', async () => {
  const page1 = [{ id: 'asset-a' } as AssetResponseDto, { id: 'asset-b' } as AssetResponseDto];
  const page2 = [{ id: 'asset-a' } as AssetResponseDto, { id: 'asset-b' } as AssetResponseDto];

  mockedSearchSmart
    .mockResolvedValueOnce({ assets: { items: page1, nextPage: '2' } } as never)
    .mockResolvedValueOnce({ assets: { items: page2, nextPage: null } } as never);

  const { component } = render(SmartSearchResults, {
    props: { query: 'trees', filters: defaultFilters() },
  });
  await vi.waitFor(() => expect(mockedSearchSmart).toHaveBeenCalledTimes(1));
  await component.loadMore();
  await vi.waitFor(() => expect(mockedSearchSmart).toHaveBeenCalledTimes(2));

  const ids = component.searchResults.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
  expect(ids).toEqual(['asset-a', 'asset-b']);
});
```

**Step 5: Update the frontend comment**

Edit `web/src/lib/components/search/smart-search-results.svelte:48-49`:

Old:

```
// Defend against pagination overlaps (e.g., backend tie-breaker gaps or
// race-y page boundaries) so Svelte's keyed {#each} doesn't crash on duplicate IDs.
```

New:

```
// Primary guard against duplicate IDs across paginated responses from searchSmart.
// vchord's ordered scan does not guarantee a stable tiebreaker for assets with
// identical CLIP embeddings (byte-identical image content), so offset pagination
// can return the same asset.id on adjacent pages. Dedup here keeps Svelte's
// keyed {#each} from crashing with each_key_duplicate.
```

**Step 6: Run ALL frontend specs in this file to ensure no regression**

```bash
cd web
pnpm test -- --run src/lib/components/search/smart-search-results.spec.ts
```

Expected: all existing tests pass + both new tests pass.

**Step 7: Commit**

```bash
git add web/src/lib/components/search/smart-search-results.spec.ts \
         web/src/lib/components/search/smart-search-results.svelte
git commit -m "test(web): cover cross-page dedup in smart-search-results spec

The dedup at smart-search-results.svelte:50-51 is the sole guard against
Svelte each_key_duplicate crashes when searchSmart returns the same asset
on adjacent pages. It previously had zero coverage — the next commit
removes the backend tiebreaker that was the other half of the belt-and-
braces defence, making this test the primary regression guard."
```

---

## Task 2: Extract `buildSearchSmartQueries` helper (pure refactor, no behavior change)

Extract the query-construction logic out of the transaction closure in `searchSmart` so unit tests can invoke it with an offline `Kysely<DB>` (via `DummyDriver`) and call `.compile()`. This refactor preserves the `asset.id` tiebreaker — it's a no-op SQL-wise. The next task does the actual behavior change.

**Files:**

- Modify: `server/src/repositories/search.repository.ts` (searchSmart method + new private helper)

**Step 1: Add the helper above `searchSmart`**

Insert immediately before the `@GenerateSql({ ... })` decorator for `searchSmart` (approximately line 337):

```ts
private buildSearchSmartQueries(
  kysely: Kysely<DB>,
  pagination: SearchPaginationOptions,
  options: SmartSearchOptions,
) {
  const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);

  const baseQuery = searchAssetBuilder(kysely, options)
    .selectAll('asset')
    .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
    .$if(hasDistanceThreshold, (qb) =>
      qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
    )
    .orderBy(sql`smart_search.embedding <=> ${options.embedding}`)
    // Stable tiebreaker so offset-based pagination doesn't return overlapping pages
    // when multiple assets have identical CLIP distances.
    .orderBy('asset.id');

  if (options.orderDirection) {
    const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
    const candidates = baseQuery.limit(500).as('candidates');
    const outerQuery = kysely
      .selectFrom(candidates)
      .selectAll()
      // sql.raw is safe here — orderDirection is validated to 'asc'|'desc' by the AssetOrder enum
      .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
      // Stable tiebreaker (same rationale as the base query)
      .orderBy('candidates.id')
      .limit(pagination.size + 1)
      .offset((pagination.page - 1) * pagination.size);
    return { kind: 'cte' as const, base: baseQuery, outer: outerQuery };
  }

  const outerQuery = baseQuery
    .limit(pagination.size + 1)
    .offset((pagination.page - 1) * pagination.size);

  return { kind: 'simple' as const, base: baseQuery, outer: outerQuery };
}
```

Note: this is a **verbatim extraction** — the tiebreaker stays in the helper exactly as it was. We remove it in Task 3.

**Step 2: Replace the body of `searchSmart` to call the helper**

Current body (lines 349-384 approx):

```ts
return this.db.transaction().execute(async (trx) => {
  await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

  const baseQuery = searchAssetBuilder(trx, options)
    .selectAll('asset')
    .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
    .$if(hasDistanceThreshold, (qb) =>
      qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
    )
    .orderBy(sql`smart_search.embedding <=> ${options.embedding}`)
    .orderBy('asset.id');

  if (options.orderDirection) {
    const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
    const candidates = baseQuery.limit(500).as('candidates');
    const items = await trx
      .selectFrom(candidates)
      .selectAll()
      .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
      .orderBy('candidates.id')
      .limit(pagination.size + 1)
      .offset((pagination.page - 1) * pagination.size)
      .execute();
    return paginationHelper(items as MapAsset[], pagination.size);
  }

  const items = await baseQuery
    .limit(pagination.size + 1)
    .offset((pagination.page - 1) * pagination.size)
    .execute();
  return paginationHelper(items, pagination.size);
});
```

Replace with:

```ts
return this.db.transaction().execute(async (trx) => {
  await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

  const { kind, outer } = this.buildSearchSmartQueries(trx, pagination, options);
  const items = await outer.execute();
  return paginationHelper(kind === 'cte' ? (items as MapAsset[]) : items, pagination.size);
});
```

Also remove the now-unused local `const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);` declaration from the top of `searchSmart` (it moved into the helper).

**Step 3: Regenerate reference SQL and verify diff is empty**

```bash
cd server
pnpm build
pnpm sync:sql
git diff src/queries/search.repository.sql
```

Expected: **zero diff**. The refactor changes TypeScript organization only — generated SQL must be byte-identical. If there is a diff, something about the refactor changed query shape. Investigate and fix before moving on.

**Step 4: Run existing service specs to catch any regression**

```bash
cd server
pnpm test -- --run src/services/search.service.spec.ts
```

Expected: all tests pass.

**Step 5: Run type check**

```bash
cd server
pnpm check
```

Expected: no errors.

**Step 6: Commit**

```bash
git add server/src/repositories/search.repository.ts
git commit -m "refactor(search): extract buildSearchSmartQueries helper

Pure refactor, zero SQL diff. Extracts the query-construction logic from
searchSmart's transaction closure into a testable private method. This
enables offline SQL-shape assertions via Kysely's DummyDriver — required
by the next commit, which removes the secondary ORDER BY that was
preventing vchord index usage."
```

---

## Task 3: TDD — remove tiebreaker (RED → GREEN)

Now the real fix. Write the failing test first; watch it fail against the refactored code (which still has the tiebreaker); remove the tiebreaker; watch the test pass.

**Files:**

- Create: `server/src/repositories/search.repository.spec.ts`
- Modify: `server/src/repositories/search.repository.ts` (remove tiebreaker + update comment)

**Step 1: Create the spec file with the first failing assertion**

```ts
// server/src/repositories/search.repository.spec.ts
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { AssetOrder } from 'src/enum';
import { SearchRepository } from 'src/repositories/search.repository';
import type { DB } from 'src/schema';

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

// Access the private helper via `any` — private methods are implementation
// detail, but testing SQL shape is the whole point of this spec.
const buildQueries = (
  sut: SearchRepository,
  pagination: { page: number; size: number },
  options: Record<string, unknown>,
) => (sut as any).buildSearchSmartQueries(offlineKysely(), pagination, options);

const FAILURE_MESSAGE =
  'Do not add any secondary ORDER BY key to the inner searchSmart query. ' +
  'See comment at src/repositories/search.repository.ts (above the orderBy call). ' +
  'Secondary ORDER BY keys force Parallel Seq Scan on smart_search instead of ' +
  'the vchord clip_index ordered scan (~100× slowdown at 200k rows).';

const countOrderByExpressions = (compiledSql: string, anchor: string): number => {
  // Find the ORDER BY that immediately precedes the given anchor (or LIMIT/OFFSET).
  // Kysely's PostgresQueryCompiler emits a single-line compact SQL string.
  const orderByRegex = /order by\s+(.+?)\s+(?:limit\b|offset\b|\)\s+as\b)/gi;
  const matches = Array.from(compiledSql.matchAll(orderByRegex));
  const match = matches.find((m) => compiledSql.indexOf(anchor) > compiledSql.indexOf(m[0]));
  if (!match) throw new Error(`no ORDER BY before anchor "${anchor}" in: ${compiledSql}`);
  return match[1].split(',').filter((s) => s.trim().length > 0).length;
};

describe(SearchRepository.name, () => {
  // SearchRepository needs a Kysely<DB>; DummyDriver is fine because searchSmart
  // itself is never called here — we only exercise the private query builder.
  const sut = new SearchRepository(offlineKysely());

  const baseOptions = {
    embedding: `[${Array.from({ length: 512 }, () => 0.01).join(',')}]`,
    userIds: ['00000000-0000-0000-0000-000000000000'],
    maxDistance: 0.5,
  };

  describe('searchSmart query shape', () => {
    it('non-CTE inner ORDER BY has exactly one expression (vchord index guard)', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, baseOptions);
      const { sql } = base.compile();
      const keys = countOrderByExpressions(sql + ' limit', 'limit');
      expect(keys, FAILURE_MESSAGE).toBe(1);
    });
  });
});
```

**Step 2: Run the test — expect it to FAIL (RED)**

```bash
cd server
pnpm test -- --run src/repositories/search.repository.spec.ts
```

Expected: FAIL with message matching `FAILURE_MESSAGE` — the current compiled SQL still has `"asset"."id"` as the second ORDER BY expression after the refactor.

If the test PASSES unexpectedly, the regex or SQL format is wrong. Fix the regex before proceeding (a common cause: Kysely emits newlines instead of spaces in some versions — adjust the regex to `[\s\S]+?`).

**Step 3: Remove the tiebreaker from the helper**

In `server/src/repositories/search.repository.ts`, inside `buildSearchSmartQueries`, change:

```ts
    .orderBy(sql`smart_search.embedding <=> ${options.embedding}`)
    // Stable tiebreaker so offset-based pagination doesn't return overlapping pages
    // when multiple assets have identical CLIP distances.
    .orderBy('asset.id');
```

To:

```ts
    // DO NOT add a secondary ORDER BY key on any column here.
    // vchord's ordered index scan can only satisfy a single-key ORDER BY on
    // `smart_search.embedding <=>`. Any additional sort key forces the planner
    // to Parallel Seq Scan + in-memory sort (~15s on 200k rows vs ~200ms via
    // vchord). Cross-page duplicates from identical embeddings are caught by
    // the frontend dedup in web/src/lib/components/search/smart-search-results.svelte.
    .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);
```

Keep the outer-CTE `.orderBy('candidates.id')` on the outer wrapping untouched. That sort runs on a materialized 500-row CTE — zero perf cost, preserves fileCreatedAt-tie determinism.

**Step 4: Run the test — expect it to PASS (GREEN)**

```bash
cd server
pnpm test -- --run src/repositories/search.repository.spec.ts
```

Expected: PASS.

**Step 5: Run type check + service specs**

```bash
cd server
pnpm check
pnpm test -- --run src/services/search.service.spec.ts
```

Expected: both pass. The service spec doesn't assert ordering of identical-embedding ties, so no regression.

**Step 6: Commit**

```bash
git add server/src/repositories/search.repository.ts \
         server/src/repositories/search.repository.spec.ts
git commit -m "fix(search): drop asset.id tiebreaker from searchSmart inner ORDER BY

Closes the 3-5× smart search perf gap vs upstream on instances with many
photos. The fork-added '.orderBy(asset.id)' secondary sort was forcing
Postgres to materialize all matching rows and in-memory sort instead of
using vchord's ordered index scan — 17/17 slow-query EXPLAIN plans on a
200k-photo reporter instance showed Parallel Seq Scan on smart_search
instead of Index Scan using clip_index.

Cross-page duplicates from identical CLIP embeddings (byte-identical
image content) are caught by the frontend dedup in smart-search-results
.svelte:50-51, which was previously the second half of a belt-and-braces
defence and is now the primary guard. Frontend regression tests added
in the previous commit.

Known trade-off: users with byte-identical duplicate image content may
see fewer unique results than exist in infinite scroll (same asset can
'spend' a slot on both pages 1 and 2, pushing a different asset off the
window). Not self-healing, but rare and consistent with upstream Immich.

Design: docs/plans/2026-04-21-search-tiebreaker-design.md"
```

---

## Task 4: Extend unit spec with permutation coverage

The first test locks down the non-CTE path. Add the remaining three permutations from the design: CTE `desc`, CTE `asc`, no-maxDistance.

**Files:**

- Modify: `server/src/repositories/search.repository.spec.ts`

**Step 1: Add the CTE `orderDirection: 'desc'` test**

Inside the `describe('searchSmart query shape', ...)` block, after the first `it`:

```ts
it('CTE path with orderDirection=desc: inner has single ORDER BY, outer retains candidates.id', () => {
  const { base, outer } = buildQueries(
    sut,
    { page: 1, size: 100 },
    { ...baseOptions, orderDirection: AssetOrder.Desc },
  );

  const innerKeys = countOrderByExpressions(base.compile().sql + ' limit', 'limit');
  expect(innerKeys, FAILURE_MESSAGE).toBe(1);

  const outerSql = outer.compile().sql;
  expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+desc/i);
  expect(outerSql).toContain('"candidates"."id"');
});
```

**Step 2: Add the CTE `orderDirection: 'asc'` test**

```ts
it('CTE path with orderDirection=asc: inner has single ORDER BY, outer sorts ascending', () => {
  const { base, outer } = buildQueries(
    sut,
    { page: 1, size: 100 },
    { ...baseOptions, orderDirection: AssetOrder.Asc },
  );

  const innerKeys = countOrderByExpressions(base.compile().sql + ' limit', 'limit');
  expect(innerKeys, FAILURE_MESSAGE).toBe(1);

  const outerSql = outer.compile().sql;
  expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+asc/i);
  expect(outerSql).toContain('"candidates"."id"');
});
```

**Step 3: Add the no-maxDistance test**

```ts
it('no-maxDistance path: single ORDER BY, no distance WHERE predicate', () => {
  const { base } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, maxDistance: undefined });
  const { sql } = base.compile();

  const keys = countOrderByExpressions(sql + ' limit', 'limit');
  expect(keys, FAILURE_MESSAGE).toBe(1);

  // No WHERE on the distance operator (<=>).
  expect(sql).not.toMatch(/\(smart_search\.embedding <=> \$\d+\)\s*<=/i);
});
```

**Step 4: Run all four tests**

```bash
cd server
pnpm test -- --run src/repositories/search.repository.spec.ts
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add server/src/repositories/search.repository.spec.ts
git commit -m "test(search): cover CTE asc/desc and no-maxDistance permutations

Locks down the inner ORDER BY across all four searchSmart code paths so
a future change that re-introduces a secondary sort key (regardless of
which column) surfaces via a test failure with a pointed message."
```

---

## Task 5: Regenerate reference SQL

The tiebreaker removal changes the generated SQL. `server/src/queries/search.repository.sql` must be updated and committed.

**Files:**

- Modify: `server/src/queries/search.repository.sql`

**Step 1: Confirm dev DB is running**

```bash
docker ps --filter name=immich_postgres --format '{{.Names}} {{.Status}}'
```

If not healthy, start the stack first: `make dev` and wait for the postgres container to report healthy.

**Step 2: Build the server and regenerate SQL**

```bash
cd server
pnpm build
pnpm sync:sql
```

Per `feedback_make_sql_no_db`: never run `sync:sql` without a running DB. If the DB is down, the script deletes all query files instead of regenerating them.

**Step 3: Inspect the diff**

```bash
git diff src/queries/search.repository.sql
```

Expected changes:

- Non-CTE path: removal of `"asset"."id"` from the ORDER BY list.
- CTE path inner subquery: removal of `"asset"."id"` from the inner ORDER BY.
- CTE path outer: unchanged (`"candidates"."fileCreatedAt" desc nulls last, "candidates"."id"` both retained).

Any other change in this file means something else drifted — investigate before committing.

**Step 4: Commit**

```bash
git add server/src/queries/search.repository.sql
git commit -m "chore(sql): regenerate reference SQL after tiebreaker removal"
```

---

## Task 6: Full check + lint gate

Run the fork's canonical pre-commit gates to catch anything the focused specs missed.

**Step 1: Server type check + server unit tests**

```bash
cd server
pnpm check
pnpm test
```

Expected: all green.

**Step 2: Web type check + web unit tests (smart-search-results area)**

```bash
cd web
pnpm check
pnpm test -- --run src/lib/components/search/
```

Expected: all green.

**Step 3: If any step failed, stop here.** Do NOT push. Debug the failure in place.

(No commit for this task — it's verification only.)

---

## Task 7: Local reproducer on pierre.opennoodle.de

Validate the fix on real data before shipping to users. Pierre's personal instance (~40k photos) is the fastest feedback loop. If vchord wins there, it wins on atlasshrugged's 200k.

**Step 1: Push the branch and ship an RC**

```bash
git push -u origin fix/search-tiebreaker-vchord
```

Then use the `rc-personal` skill (or invoke the `gallery-rc-build` workflow manually): build the fork's `gallery-server` image from `fix/search-tiebreaker-vchord`, push to GHCR, pin via the compose override in the personal gitops repo.

**Step 2: Enable diagnostics on pierre's instance**

On pierre's box, via SSH:

1. Set `GALLERY_SEARCH_TIMING=true` in the personal instance's compose env.
2. Run the enable script from https://gist.github.com/Deeds67/75bb0e5b2c1443402454068adb0cd102 (`enable-auto-explain.sh`) against the pierre Postgres container.
3. Restart the server container so the env var and auto_explain are both active.

**Step 3: Smoke test from the UI**

Open pierre.opennoodle.de. Run at least 3 distinct smart search queries ("mountains", "books", "trees"). Use both the command palette (size=5) and the /search page (size=100).

**Step 4: Inspect the phase timings + plan**

```bash
# On pierre's box:
docker logs immich_postgres --since=5m | grep -E "duration|Index Scan"
docker logs immich_server --since=5m | grep searchSmart
```

**Success criteria:**

- At least one `Index Scan using clip_index` appears in Postgres logs.
- No `Parallel Seq Scan on smart_search` for smart-search-shaped queries.
- `db=` phase in `GALLERY_SEARCH_TIMING` logs < 500ms for cache-hit embeddings.

If any criterion fails: do NOT proceed to open a PR. Re-investigate (the helper refactor may have subtly altered the query; or `maxDistance=0.95` may need its own handling). Capture the EXPLAIN output and iterate.

**Step 5: Tear down diagnostics**

Run `disable-auto-explain.sh` from the gist. Unset `GALLERY_SEARCH_TIMING=true` (or leave it — atlasshrugged keeps it on for measurement and it's cheap).

Also: remove the pierre compose override per `feedback_pierre_rc_override_cleanup` when the PR is merged to main, so release deploys don't silently keep shipping the RC image.

(No commit for this task — it's out-of-tree validation.)

---

## Task 8: Open the PR

**Step 1: Create PR with a body that includes the risk disclosure**

```bash
gh pr create --title "fix(search): drop asset.id tiebreaker from searchSmart to restore vchord" --body "$(cat <<'EOF'
## Summary
Remove the fork-added \`.orderBy('asset.id')\` secondary sort from \`searchSmart\`'s inner query. This restores Postgres's use of the vchord \`clip_index\` ordered scan, closing the 3-5× perf gap with upstream Immich on instances with many photos.

## Root cause
\`asset.id\` is on a joined table (not \`smart_search\`), so vchord's ordered index scan can't satisfy the multi-key ORDER BY. The planner falls back to Parallel Seq Scan over the full \`smart_search\` table + in-memory sort. On a 200k-photo reporter instance: 17/17 slow smart-search queries showed \`Parallel Seq Scan on smart_search\` instead of \`Index Scan using clip_index\`, producing db-phase times of 3-16s vs upstream's <1s.

The outer CTE tiebreaker on \`candidates.id\` is retained — it sorts a materialized 500-row set with zero perf cost, and preserves determinism when multiple photos share the same \`fileCreatedAt\`.

## Known trade-off
For users with byte-identical duplicate image content (rare), infinite scroll may surface fewer unique results than exist: the same asset.id can appear on both pages 1 and 2, and while the frontend dedup prevents duplicate rendering, it pushes a different asset off the viewed window. **This is not self-healing.** Consistent with upstream Immich, which ships without any tiebreaker. Future bug reports mentioning "missing results after infinite scroll" should land here.

## Test plan
- [x] Unit tests added for searchSmart SQL shape (all four permutations: non-CTE, CTE desc, CTE asc, no-maxDistance)
- [x] Frontend dedup regression tests added (two new \`it\` blocks)
- [x] Reference SQL regenerated
- [ ] Local reproducer on pierre.opennoodle.de: auto_explain shows \`Index Scan using clip_index\` and \`db=\` phase <500ms
- [ ] atlasshrugged verifies on 200k-photo instance after release: 3-16s → <1s

## Follow-ups (separate PRs, not this one)
- Filter-suggestions batch burst caching (\`getFilterSuggestions\` fires 6 parallel seq-scans per call)
- \`maxDistance\` docs note (pending atlasshrugged's post-fix report)
- \`asset.type\` and composite \`(ownerId, visibility, deletedAt, fileCreatedAt)\` indexes (upstream candidates)

Design: \`docs/plans/2026-04-21-search-tiebreaker-design.md\`
EOF
)"
```

(Note: when running, escape shell-sensitive characters or just author the body in the gh editor.)

**Step 2: Monitor CI**

Expect checks to go green. If the "Schema Check" workflow fails with a diff on `search.repository.sql`, someone rebased or the regen missed something — update locally and push.

---

## Follow-up memory update (after PR merges and atlasshrugged confirms)

Update `project_search_perf_investigation.md`:

- Status line: `"Status 2026-04-20: ..."` → `"Status 2026-04-2X: Tiebreaker removed in PR #XXX, atlasshrugged's db-phase dropped from 3-16s to NNms."`
- Link the PR.
- Move the `asset.id tiebreaker` item out of "Ranked fix impact" and note it's shipped.

---

## Out of scope for this plan

- Filter suggestions caching — separate design + PR (see follow-ups in `2026-04-21-search-tiebreaker-design.md`).
- Index additions — upstream candidates, not fork-only.
- `maxDistance` default change — deferred pending real-world validation.
- Medium EXPLAIN-based regression test — deferred; unit + local reproducer + real-data validation is sufficient for this fix.
