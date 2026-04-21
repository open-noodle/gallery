# Smart Search Tiebreaker Removal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the fork-added `asset.id` secondary ORDER BY from `searchSmart` to restore Postgres's use of the vchord `clip_index` ordered scan. Expected perf gain: 3-16s → <1s on 200k-photo instances.

**Architecture:** The change is intentionally small — one `.orderBy('asset.id')` call removed from `server/src/repositories/search.repository.ts`. Supporting work: (1) extract a private query-builder helper so the SQL shape is testable offline via Kysely's `DummyDriver`, (2) add a unit spec that asserts "exactly one ORDER BY expression" on the inner query AND verifies the primary sort key is still the embedding, (3) extract the frontend dedup into a pure utility so it can be tested in isolation (the component's current internals aren't testable — see existing `it.todo` entries at lines 149-165 of the spec), (4) regenerate reference SQL, (5) update the load-bearing code comments.

**Tech Stack:** NestJS + Kysely 0.28.15 (server), SvelteKit + Svelte 5 + Vitest (web), `vchordrq` pgvector extension (DB). Design doc: `docs/plans/2026-04-21-search-tiebreaker-design.md`.

**Design deviation (deliberate):** The design (lines 78-85) specifies adding two new `it` blocks directly to `web/src/lib/components/search/smart-search-results.spec.ts`. The component API doesn't support this — `handleLoadMore` is a local function and `searchResults` is internal `$state`, neither exposed on the component instance. Four `it.todo` entries at lines 149-165 of the existing spec confirm this is a known testability gap. This plan instead **extracts the dedup to a pure utility function** (`web/src/lib/utils/search-dedup.ts`) and unit-tests it directly. Same behavior coverage, cleaner seam, no component rework. Documented here so it surfaces in PR review.

---

## Pre-flight

Before starting, from repo root:

```bash
# 1. Confirm dev stack is running (needed for `make sql` in Task 5).
docker ps --filter name=immich_postgres --format '{{.Names}} {{.Status}}'
# Expect: immich_postgres Up (healthy)

# 2. Confirm clean working tree.
git status
# Expect: "nothing to commit, working tree clean"

# 3. Verify required imports exist (fail fast if fork diverged from assumptions).
grep -q "OrderByDirection.*SqlBool" server/src/repositories/search.repository.ts && \
  grep -q "export enum AssetOrder" server/src/enum.ts && \
  grep -q "isActiveDistanceThreshold" server/src/repositories/search.repository.ts && \
  echo OK || echo "FAIL: one of OrderByDirection/SqlBool/AssetOrder/isActiveDistanceThreshold is missing; plan assumptions need updating"

# 4. Verify Kysely exports DummyDriver (required for Task 3 offline SQL compilation).
node -e "const k = require('./server/node_modules/kysely'); if (!k.DummyDriver || !k.PostgresAdapter || !k.PostgresQueryCompiler || !k.PostgresIntrospector) throw new Error('Kysely missing one of DummyDriver/PostgresAdapter/PostgresQueryCompiler/PostgresIntrospector'); console.log('Kysely OK');"

# 5. Create a feature branch.
git switch -c fix/search-tiebreaker-vchord
```

If any pre-flight step fails, stop and update the plan before proceeding — the plan's assumptions have drifted from code reality.

---

## Task 1: Extract frontend dedup to a testable utility

The frontend dedup at `smart-search-results.svelte:50-51` is the sole cross-page duplicate guard after this change. It currently has zero test coverage AND the component's internal API (`handleLoadMore` is a local function, `searchResults` is internal `$state`) makes it untestable in place — the existing spec documents this via four `it.todo` entries at lines 149-165.

Extract the dedup to a pure utility function so it can be unit-tested directly. Do this FIRST so the safety net is covered before the backend tiebreaker is removed.

**Files:**

- Create: `web/src/lib/utils/search-dedup.ts`
- Create: `web/src/lib/utils/__tests__/search-dedup.spec.ts`
- Modify: `web/src/lib/components/search/smart-search-results.svelte:48-52`

**Step 1: Create the dedup utility**

```ts
// web/src/lib/utils/search-dedup.ts
/**
 * Append new paginated items to an existing array, de-duplicating by `id`.
 *
 * Used by smart-search-results.svelte to guard against the same asset.id
 * appearing on adjacent paginated responses from searchSmart. The server
 * does not currently apply a stable tiebreaker to identical CLIP distances
 * (byte-identical image content), so offset pagination can yield the same
 * asset.id on both pages 1 and 2. Dedup here prevents Svelte's keyed
 * {#each} from crashing with each_key_duplicate.
 *
 * Pure function by design — both for testability and because the dedup
 * is load-bearing (this is the only cross-page duplicate guard now).
 */
export function dedupeAppend<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const existingIds = new Set(existing.map((a) => a.id));
  return existing.concat(incoming.filter((a) => !existingIds.has(a.id)));
}
```

**Step 2: Write the failing / comprehensive utility tests**

```ts
// web/src/lib/utils/__tests__/search-dedup.spec.ts
import { describe, expect, it } from 'vitest';
import { dedupeAppend } from '$lib/utils/search-dedup';

describe('dedupeAppend', () => {
  it('appends new items and de-duplicates by id (primary cross-page scenario)', () => {
    // Page 1 returned [a, b, c]; page 2 returned [b, d].
    // After append + dedup, searchResults should be [a, b, c, d].
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'b' }, { id: 'd' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns existing array unchanged when every incoming item is a duplicate', () => {
    // Byte-identical images scenario: page 2 returns the same assets as page 1.
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    // No duplicates in output.
    expect(new Set(result.map((r) => r.id)).size).toBe(result.length);
  });

  it('handles empty existing (first page)', () => {
    const result = dedupeAppend([], [{ id: 'a' }, { id: 'b' }]);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles empty incoming (end of pagination)', () => {
    const result = dedupeAppend([{ id: 'a' }], []);
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('preserves order — new items append after existing, no reordering', () => {
    const result = dedupeAppend([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'a' }, { id: 'd' }]);
    // 'a' is dropped from incoming; 'c' and 'd' append in the order they arrived.
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

**Step 3: Run utility tests — expect PASS (utility is a clean extraction, no bug to test against)**

```bash
cd web
pnpm test -- --run src/lib/utils/__tests__/search-dedup.spec.ts
```

Expected: 5 passing. If any fail, fix before proceeding.

**Step 4: Update the component to use the utility**

Edit `web/src/lib/components/search/smart-search-results.svelte`.

At the top of `<script>`, add the import next to the existing `$lib/utils/space-search` import:

```ts
import { dedupeAppend } from '$lib/utils/search-dedup';
```

Then replace lines 47-55 (the `if (append) { ... } else { ... }` block). Old:

```ts
if (append) {
  // Defend against pagination overlaps (e.g., backend tie-breaker gaps or
  // race-y page boundaries) so Svelte's keyed {#each} doesn't crash on duplicate IDs.
  const existingIds = new Set(searchResults.map((a) => a.id));
  const deduped = assets.items.filter((a) => !existingIds.has(a.id));
  searchResults = [...searchResults, ...deduped];
} else {
  searchResults = assets.items;
}
```

New:

```ts
if (append) {
  // Primary guard against duplicate IDs across paginated searchSmart
  // responses. The server's ORDER BY is single-key (smart_search.embedding
  // <=>) so that vchord's ordered index scan can be used; identical
  // embeddings (byte-identical image content) can then yield the same
  // asset.id on adjacent pages. See docs/plans/2026-04-21-search-tiebreaker-design.md.
  searchResults = dedupeAppend(searchResults, assets.items);
} else {
  searchResults = assets.items;
}
```

**Step 5: Run the component's existing spec to catch regressions**

```bash
cd web
pnpm test -- --run src/lib/components/search/smart-search-results.spec.ts
```

Expected: all existing `it` blocks still pass (dedup behavior is identical, just moved to a utility). The four `it.todo` entries remain TODOs — they're about component loadMore testability, out of scope for this PR.

**Step 6: Run type check**

```bash
cd web
pnpm check
```

Expected: no errors.

**Step 7: Commit**

```bash
git add web/src/lib/utils/search-dedup.ts \
         web/src/lib/utils/__tests__/search-dedup.spec.ts \
         web/src/lib/components/search/smart-search-results.svelte
git commit -m "refactor(web): extract smart-search dedup to a pure utility

Hoists the inline cross-page dedup from smart-search-results.svelte into
lib/utils/search-dedup.ts so it can be unit-tested directly. The
component's internals (handleLoadMore is a local function, searchResults
is \$state) aren't exposed on the component instance, and four it.todo
entries in the existing spec confirm this is a known testability gap.

This matters because a subsequent commit removes the backend asset.id
tiebreaker, promoting this dedup from a belt-and-braces supplement to
the sole cross-page duplicate guard against Svelte each_key_duplicate
crashes on byte-identical embeddings. The dedup behavior is unchanged;
only its location and test coverage are."
```

---

## Task 2: Extract `buildSearchSmartQueries` helper (pure refactor, no behavior change)

Extract the query-construction logic out of the transaction closure in `searchSmart` so unit tests can invoke it with an offline `Kysely<DB>` (via `DummyDriver`) and call `.compile()`. This refactor preserves the `asset.id` tiebreaker — it's a no-op SQL-wise. The next task does the actual behavior change.

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

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

Also remove the now-unused `const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);` declaration from the top of `searchSmart` (it moved into the helper).

**Step 3: Regenerate reference SQL and verify ZERO diff — this is the strong regression check for the refactor**

```bash
cd server
pnpm build
pnpm sync:sql
git diff src/queries/search.repository.sql
```

Expected: **zero diff**. The refactor changes TypeScript organization only — generated SQL must be byte-identical. If there is a diff, something about the refactor changed query shape. Fix before moving on.

Why this is the strong check: the service spec in Step 4 uses `newTestService()` which auto-mocks the repository, so internal refactors don't flow through. The reference-SQL byte-diff is the actual proof that the extraction preserved query shape.

**Step 4: Sanity: run existing service specs**

```bash
cd server
pnpm test -- --run src/services/search.service.spec.ts
```

Expected: all tests pass. Sanity only — the real regression guard is the zero SQL diff from Step 3.

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
  const orderByRegex = /order by\s+([\s\S]+?)\s+(?:limit\b|offset\b|\)\s+as\b)/gi;
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
    it('non-CTE inner ORDER BY: exactly one expression AND primary key is smart_search.embedding', () => {
      const { base } = buildQueries(sut, { page: 1, size: 100 }, baseOptions);
      const innerSql = base.compile().sql;

      // Count: exactly one key. Catches any secondary-sort regression.
      const keys = countOrderByExpressions(innerSql + ' limit', 'limit');
      expect(keys, FAILURE_MESSAGE).toBe(1);

      // Identity: the one key must be the embedding sort. Catches accidental
      // replacement (e.g., someone re-orders to .orderBy('asset.fileCreatedAt')
      // with count still == 1, but vchord still doesn't fire).
      expect(innerSql, 'primary ORDER BY must be on smart_search.embedding <=>').toMatch(
        /order by\s+smart_search\.embedding\s*<=>/i,
      );
    });
  });
});
```

**Step 2: Run the test — expect it to FAIL (RED)**

```bash
cd server
pnpm test -- --run src/repositories/search.repository.spec.ts
```

Expected: FAIL on the `expect(keys, FAILURE_MESSAGE).toBe(1)` assertion — the current compiled SQL still has `"asset"."id"` as the second ORDER BY expression after the refactor, so `keys === 2`.

If the test PASSES unexpectedly, the regex or SQL format is wrong. Fix the regex before proceeding (common cause: different whitespace in the compiled SQL — check by logging `innerSql`).

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
    // the frontend dedup in web/src/lib/utils/search-dedup.ts.
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
image content) are caught by the frontend dedup in the dedupeAppend
utility (web/src/lib/utils/search-dedup.ts), which was previously the
second half of a belt-and-braces defence and is now the primary guard.
Utility unit tests added in the preceding refactor commit.

Known trade-off: users with byte-identical duplicate image content may
see fewer unique results than exist in infinite scroll (same asset can
'spend' a slot on both pages 1 and 2, pushing a different asset off the
window). Not self-healing, but rare and consistent with upstream Immich.

Design: docs/plans/2026-04-21-search-tiebreaker-design.md"
```

---

## Task 4: Extend unit spec with permutation coverage

The first test locks down the non-CTE path. Add the remaining permutations from the design: CTE `desc`, CTE `asc`, no-maxDistance. Each test verifies BOTH the count (exactly one inner ORDER BY expression) AND the primary-key identity (it is the embedding sort), so a future change that replaces the primary key doesn't silently pass.

**Files:**

- Modify: `server/src/repositories/search.repository.spec.ts`

**Step 1: Add the CTE `orderDirection: 'desc'` test**

Inside the `describe('searchSmart query shape', ...)` block, after the first `it`:

```ts
it('CTE path orderDirection=desc: inner single key is embedding, outer has fileCreatedAt + candidates.id', () => {
  const { base, outer } = buildQueries(
    sut,
    { page: 1, size: 100 },
    { ...baseOptions, orderDirection: AssetOrder.Desc },
  );

  // Inner query (subject to vchord): single-key ORDER BY on embedding.
  const innerSql = base.compile().sql;
  expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
  expect(innerSql, 'inner primary ORDER BY must be on smart_search.embedding <=>').toMatch(
    /order by\s+smart_search\.embedding\s*<=>/i,
  );

  // Outer (CTE wrapper, materialized 500 rows): tiebreaker IS retained here by design.
  const outerSql = outer.compile().sql;
  expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+desc/i);
  expect(outerSql).toContain('"candidates"."id"');
  // Also: outer ORDER BY must have exactly 2 keys (fileCreatedAt + candidates.id);
  // any third key here would be a new, undocumented tiebreaker.
  const outerKeys = countOrderByExpressions(outerSql + ' limit', 'limit');
  expect(outerKeys, 'outer CTE ORDER BY must be exactly (fileCreatedAt, candidates.id)').toBe(2);
});
```

**Step 2: Add the CTE `orderDirection: 'asc'` test**

```ts
it('CTE path orderDirection=asc: inner single key is embedding, outer sorts ascending', () => {
  const { base, outer } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, orderDirection: AssetOrder.Asc });

  const innerSql = base.compile().sql;
  expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
  expect(innerSql, 'inner primary ORDER BY must be on smart_search.embedding <=>').toMatch(
    /order by\s+smart_search\.embedding\s*<=>/i,
  );

  const outerSql = outer.compile().sql;
  expect(outerSql).toMatch(/"candidates"\."fileCreatedAt"\s+asc/i);
  expect(outerSql).toContain('"candidates"."id"');
  expect(countOrderByExpressions(outerSql + ' limit', 'limit'), 'outer must be 2 keys').toBe(2);
});
```

**Step 3: Add the no-maxDistance test**

```ts
it('no-maxDistance path: single key is embedding, no distance WHERE predicate', () => {
  const { base } = buildQueries(sut, { page: 1, size: 100 }, { ...baseOptions, maxDistance: undefined });
  const innerSql = base.compile().sql;

  expect(countOrderByExpressions(innerSql + ' limit', 'limit'), FAILURE_MESSAGE).toBe(1);
  expect(innerSql, 'primary ORDER BY must be on smart_search.embedding <=>').toMatch(
    /order by\s+smart_search\.embedding\s*<=>/i,
  );

  // No WHERE predicate on the distance operator (<=>).
  expect(innerSql).not.toMatch(/\(smart_search\.embedding <=> \$\d+\)\s*<=/i);
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
which column) surfaces via a test failure with a pointed message. Each
test also verifies the primary ORDER BY key IS the embedding sort — not
just that the count is one — which catches accidental replacement of
the primary key."
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

**Step 3: Inspect the diff — expected changes only**

```bash
git diff src/queries/search.repository.sql
```

**Automated sanity (complements visual inspection):**

```bash
# Should show exactly two "- ..." lines removing `"asset"."id"` from ORDER BY
# (one for the non-CTE path, one for the CTE's inner query).
git diff src/queries/search.repository.sql | grep -cE '^-\s*"asset"\."id"'
# Expect: 2

# Added lines should not reintroduce a secondary key — they should be ORDER BY
# continuation lines that no longer end in a comma.
git diff src/queries/search.repository.sql | grep -E '^\+' | grep -v '^\+\+\+' | grep -cE '"asset"\."id"'
# Expect: 0

# "candidates"."id" must still be present (unchanged outer CTE tiebreaker).
grep -c '"candidates"\."id"' src/queries/search.repository.sql
# Expect: 1
```

If any expectation doesn't match, investigate before committing.

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

**Step 2: Web type check + web unit tests (search area and utils)**

```bash
cd web
pnpm check
pnpm test -- --run src/lib/components/search/
pnpm test -- --run src/lib/utils/__tests__/
```

Expected: all green.

**Step 3: If any step failed, stop here.** Do NOT push. Debug the failure in place.

(No commit for this task — it's verification only.)

---

## Task 7: Local reproducer on a smaller personal instance

Validate the fix on real data before shipping to users. A personal dev instance (~40k photos) is the fastest feedback loop. If vchord wins there, it wins on a 200k-photo instance too.

**Step 1: Push the branch and ship an RC**

```bash
git push -u origin fix/search-tiebreaker-vchord
```

Build an RC of `gallery-server` from the fix branch, push to the image registry, and pin via a compose override on the personal instance.

**Step 2: Determine the instance's container names**

Container names may differ from `immich_postgres` / `immich_server`. SSH into the instance and run:

```bash
docker ps --format '{{.Names}}' | grep -iE 'postgres|server'
```

Record the actual container names for use in Steps 3-4.

**Step 3: Enable diagnostics on the instance**

On the instance, via SSH:

1. Set `GALLERY_SEARCH_TIMING=true` in the compose env.
2. Run the enable script from the diagnostic gist (`enable-auto-explain.sh <postgres-container-name>`) against the Postgres container.
3. Restart the server container so the env var takes effect.

**Step 4: Smoke test from the UI**

Open the instance. Run at least 3 distinct smart search queries ("mountains", "books", "trees"). Use both the command palette (size=5) and the /search page (size=100).

**Step 5: Inspect the phase timings + plan**

On the instance (use the container names recorded in Step 2):

```bash
# Scope to smart_search plans specifically, not any Index Scan anywhere.
docker logs <postgres-container-name> --since=5m | \
  grep -B2 -A20 'Query Text:.*smart_search' | \
  grep -E 'duration|Seq Scan|Index Scan using'

# Phase timing from the server.
docker logs <server-container-name> --since=5m | grep searchSmart
```

**Success criteria:**

- At least one `Index Scan using clip_index` appears in Postgres logs scoped to smart-search queries.
- No `Parallel Seq Scan on smart_search` for smart-search-shaped queries in this 5-minute window.
- `db=` phase in `GALLERY_SEARCH_TIMING` logs < 500ms for cache-hit embeddings.

If any criterion fails: do NOT proceed to open a PR. Re-investigate (the helper refactor may have subtly altered the query; or `maxDistance=0.95` may need its own handling). Capture the EXPLAIN output and iterate.

**Step 6: Tear down diagnostics**

Run `disable-auto-explain.sh <postgres-container-name>` from the diagnostic gist. Unset `GALLERY_SEARCH_TIMING=true` (or leave it on — it's cheap).

Also: remove the personal-instance compose override when the PR is merged to main, so release deploys don't silently keep shipping the RC image.

(No commit for this task — it's out-of-tree validation.)

---

## Task 8: Open the PR

**Step 1: Create PR via gh editor for safety**

The PR body contains backticks, `$(...)` substitutions, and other shell-sensitive characters. Use `gh pr create` with the body passed via file or interactive editor rather than shell heredoc to avoid escaping bugs.

```bash
# Write body to a temp file to avoid heredoc escaping pitfalls.
cat > /tmp/pr-body.md <<'PRBODY'
## Summary
Remove the fork-added `.orderBy('asset.id')` secondary sort from `searchSmart`'s inner query. This restores Postgres's use of the vchord `clip_index` ordered scan, closing the 3-5× perf gap with upstream Immich on instances with many photos.

## Root cause
`asset.id` is on a joined table (not `smart_search`), so vchord's ordered index scan can't satisfy the multi-key ORDER BY. The planner falls back to Parallel Seq Scan over the full `smart_search` table + in-memory sort. On a 200k-photo reporter instance: 17/17 slow smart-search queries showed `Parallel Seq Scan on smart_search` instead of `Index Scan using clip_index`, producing db-phase times of 3-16s vs upstream's <1s.

The outer CTE tiebreaker on `candidates.id` is retained — it sorts a materialized 500-row set with zero perf cost, and preserves determinism when multiple photos share the same `fileCreatedAt`.

## Known trade-off
For users with byte-identical duplicate image content (rare), infinite scroll may surface fewer unique results than exist: the same asset.id can appear on both pages 1 and 2, and while the frontend dedup prevents duplicate rendering, it pushes a different asset off the viewed window. **This is not self-healing.** Consistent with upstream Immich, which ships without any tiebreaker. Future bug reports mentioning "missing results after infinite scroll" should land here.

## Test plan
- [x] Unit tests added for searchSmart SQL shape (all four permutations: non-CTE, CTE desc, CTE asc, no-maxDistance); each asserts exactly one inner ORDER BY expression AND that the primary key is `smart_search.embedding <=>`.
- [x] Frontend dedup extracted to `web/src/lib/utils/search-dedup.ts` and unit-tested (5 cases).
- [x] Reference SQL regenerated.
- [ ] Local reproducer on a personal dev instance: auto_explain shows `Index Scan using clip_index` and `db=` phase <500ms.
- [ ] Reporter verifies on their 200k-photo instance after release: 3-16s → <1s.

## Follow-ups (separate PRs, not this one)
- Filter-suggestions batch burst caching (`getFilterSuggestions` fires 6 parallel seq-scans per call).
- `maxDistance` docs note (pending the reporter's post-fix report).
- `asset.type` and composite `(ownerId, visibility, deletedAt, fileCreatedAt)` indexes (upstream candidates).

Design: `docs/plans/2026-04-21-search-tiebreaker-design.md`
PRBODY

gh pr create \
  --title "fix(search): drop asset.id tiebreaker from searchSmart to restore vchord" \
  --body-file /tmp/pr-body.md

rm /tmp/pr-body.md
```

**Step 2: Monitor CI**

Expect checks to go green. If the "Schema Check" workflow fails with a diff on `search.repository.sql`, someone rebased or the regen missed something — update locally and push.

---

## Task 9: Post-merge notes update

After PR merges and the reporter confirms the fix on a 200k instance, update any local notes or tracking to reflect the shipped state: shipment date, PR number, the reporter's new `db=` value. Leave the filter-suggestions follow-up in place — that's the next iteration.

(No source-tree commit; notes are out-of-tree.)

---

## Out of scope for this plan

- Filter suggestions caching — separate design + PR (see follow-ups in `2026-04-21-search-tiebreaker-design.md`).
- Index additions — upstream candidates, not fork-only.
- `maxDistance` default change — deferred pending real-world validation.
- Medium EXPLAIN-based regression test — deferred; unit + local reproducer + real-data validation is sufficient for this fix.
- Resolving the 4 `it.todo` entries in `smart-search-results.spec.ts` about loadMore testability — separate refactor; orthogonal to this perf fix.
