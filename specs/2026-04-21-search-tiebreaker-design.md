# Smart search: restore vchord index usage

**Date:** 2026-04-21
**Status:** Design approved, ready for implementation plan
**Owner:** Pierre

## Goal

Close the 3-5× performance gap between Gallery smart search (5-16s on a 200k-photo instance) and upstream Immich (2-4s on the same data). Root cause proven: fork-added `asset.id` secondary `ORDER BY` prevents Postgres from using the vchord `clip_index` — 17/17 slow queries in the reporter's `auto_explain` output show `Parallel Seq Scan on smart_search` instead of `Index Scan using clip_index`.

## Change

In `server/src/repositories/search.repository.ts`:

- **Remove line 361** — `.orderBy('asset.id')` on `baseQuery`. This is the inner ORDER BY that both branches (non-CTE at line 379, CTE at line 365) feed into. Dropping it restores vchord's ordered index scan on `smart_search`.
- **Keep line 372** — `.orderBy('candidates.id')` on the CTE outer sort. Operates on a materialized 500-row CTE, costs microseconds, preserves determinism when multiple candidates share the same `fileCreatedAt` (common: photos taken at the same second).
- **Replace the line-359 comment** with a load-bearing warning:

  ```
  // DO NOT add a secondary ORDER BY key on any column here.
  // vchord's ordered index scan can only satisfy a single-key ORDER BY on
  // `smart_search.embedding <=>`. Any additional sort key forces the planner
  // to Parallel Seq Scan + in-memory sort (~15s on 200k rows vs ~200ms
  // via vchord). Cross-page duplicates from identical embeddings are caught
  // by the frontend dedup in web/src/lib/components/search/smart-search-results.svelte.
  ```

- **Extract a private helper** `#buildSearchSmartQueries(trx, options)` on `SearchRepository` that returns `{ baseQuery, candidates, applyProbes }`. `searchSmart` calls it inside the existing transaction. This refactor exists purely so the unit test can `.compile()` the queries without going through a transaction closure. See "Verification / Unit test" below for why this is necessary.
- **Update `web/src/lib/components/search/smart-search-results.svelte:48-49` comment** to reflect that the frontend dedup is now the primary guard (not supplementary to a backend tiebreaker).

## Why this is safe

`asset.id` is the primary key of `asset`; the join `asset.id = smart_search.assetId` guarantees each `asset.id` appears at most once per query result — so intra-page duplicates are schema-impossible regardless of the ORDER BY.

Cross-page duplicates via non-deterministic OFFSET ordering are caught by the frontend dedup at `smart-search-results.svelte:50-51`:

```js
const existingIds = new Set(searchResults.map((a) => a.id));
const deduped = assets.items.filter((a) => !existingIds.has(a.id));
```

Upstream Immich's `searchSmart` (`git show upstream/main:server/src/repositories/search.repository.ts`) has a single-key `ORDER BY embedding <=>` with no tiebreaker. The proposed change brings Gallery in line with upstream.

## Honest risk

For users with byte-identical duplicate image content (rare): infinite scroll may surface fewer unique results than exist. The same `asset.id` can "spend" a slot on both page 1 and page 2 (frontend dedup removes the duplicate on page 2), pushing a different asset off the viewed window. Unlike typical pagination edge cases, **this is not self-healing** — the missed asset only reappears if continued scroll randomly happens to include it on a later page.

This risk must be called out in the PR description so future "missing results after infinite scroll" bug reports are searchable and resolvable without rediscovery. Rarity is consistent with upstream Immich, which ships without a tiebreaker.

## Verification

### Unit test — SQL shape regression (new file)

New file `server/src/repositories/search.repository.spec.ts`. Uses Kysely's `DummyDriver` (offline, no DB connection) to build a `Kysely<DB>` instance, call the extracted `#buildSearchSmartQueries` helper, and `.compile()` the result. No transaction needed — `DummyDriver` doesn't execute statements.

The test relies on the refactor noted in "Change": without extracting the private helper, the queries are trapped inside `this.db.transaction().execute(async (trx) => { ... })` and unreachable from outside. Rather than mock Kysely's transaction machinery (fragile), the refactor is the cleanest path to a testable seam.

**Required assertions (stricter than "doesn't contain `asset.id`"):**

1. **Non-CTE path** (options without `orderDirection`): compiled SQL's top-level `ORDER BY` has **exactly one** expression, and that expression contains `"smart_search"."embedding"`.
2. **CTE path** (`orderDirection: 'desc'`): inner subquery's `ORDER BY` has exactly one expression (embedding); outer `ORDER BY` contains both `"candidates"."fileCreatedAt"` and `"candidates"."id"` (unchanged).
3. **CTE path with `orderDirection: 'asc'`**: same shape as (2).
4. **No-maxDistance permutation** (`hasDistanceThreshold = false`): same ORDER BY shape; no `WHERE (embedding <=>) <= ...` predicate.

The "exactly one expression" assertion generalizes the bug to any secondary sort key — catches not just `asset.id` re-additions but also hypothetical `asset.fileCreatedAt` / `asset.createdAt` / etc.

**Each assertion's failure message must be explicit:**

```
Do not add any secondary ORDER BY key to the inner searchSmart query.
See comment at server/src/repositories/search.repository.ts:359.
Secondary ORDER BY keys force Parallel Seq Scan on smart_search instead
of the vchord clip_index ordered scan (~100× slowdown at 200k rows).
```

Brittleness to Kysely version bumps is acceptable — the failure text points at exact intent.

### Unit test — frontend dedup regression (add to existing spec)

Existing `web/src/lib/components/search/smart-search-results.spec.ts` has 14 `it` blocks but **none verify the cross-page dedup behavior** at `smart-search-results.svelte:50-51`. Since this dedup is now the primary guard (not a belt-and-braces supplement), it needs a regression test.

Add two new `it` blocks:

1. `"de-duplicates cross-page results on append by asset id"` — mocks `searchSmart` to return `{items: [{id: 'A'}, {id: 'B'}, {id: 'C'}]}` for page 1 and `{items: [{id: 'B'}, {id: 'D'}]}` for page 2; loads page 1, then loads page 2 with `append: true`; asserts final `searchResults` is `[A, B, C, D]` (B de-duplicated, D appended).
2. `"does not crash when every page-2 result is a duplicate of page 1"` — page 1 returns `[A, B]`, page 2 returns `[A, B]`; assert no crash, no duplicate IDs in final state.

### Reference SQL regeneration

Run `pnpm sql` in `server/` after the code change. `server/src/queries/search.repository.sql` will update; commit the diff. CI's Schema Check catches drift between committed SQL and regenerated SQL.

### Local reproducer on a smaller personal instance (before shipping to users)

A personal dev instance (~40k photos, for example) is the fastest feedback loop. Before cutting a Gallery release:

1. Build an RC pointing at the fix branch.
2. Enable `GALLERY_SEARCH_TIMING=true` on the instance.
3. Run `auto_explain` via the diagnostic gist.
4. Smoke-test 3-4 smart searches from the UI.
5. Confirm EXPLAIN lines show `Index Scan using clip_index` and `db=` phase drops to <500ms.

This catches anything unit tests miss — real planner behavior, real CPU saturation, real pagination. Only ship the release once the smaller instance looks good.

Smaller instance (~40k) vs the reporter's 200k: the query shape is identical; planner behavior should match. If vchord wins on 40k, it should win on 200k — the difference is just how much slower the seq-scan fallback is at each size.

### Real-data validation on the reporter's 200k instance

After Gallery release:

1. Reporter pulls the release.
2. Re-runs the diagnostic gist (with `GALLERY_SEARCH_TIMING=true` still set).
3. Reports new `db=` values + `auto_explain` output.

**Success criteria:**

- `db=` phase drops from 3-16s to <1s for cache-hit embeddings.
- `auto_explain` output for `searchSmart` shows `Index Scan using clip_index` instead of `Parallel Seq Scan on smart_search`.

## Rollback

Single-commit `git revert <sha>`. Frontend dedup remains in place regardless. Reverting just reintroduces the belt-and-braces behavior at the original perf cost. Refactored helper stays — removing it is cosmetic and not worth the churn.

## Callers verified

`grep -rn 'searchRepository.searchSmart\|.searchSmart('` → only `server/src/controllers/search.controller.ts:91` calls this in production. Fork-specific features (duplicate detection, classification, video dedup) use other repository methods and are unaffected. Service spec tests at `server/src/services/search.service.spec.ts` do not assert ordering of identical-embedding ties.

## Scope exclusions — documented follow-ups

### Filter suggestions batch burst (future PR)

`getFilterSuggestions` at `server/src/repositories/search.repository.ts:631` uses `Promise.all` to fire 6 concurrent seq-scans (countries, cameraMakes, tags, people, ratings, mediaTypes) per invocation. On the reporter's 200k instance this generates 2-3s of additional load per FilterPanel open, compounding with smart search CPU contention.

Proposed follow-up: add a short per-user TTL cache (30-60s) keyed by `(userId, serialized options)`. Invalidate on asset upload/delete websocket events or time-based. Measure impact after the tiebreaker fix lands — if real-world searches drop below upstream parity, this becomes lower priority.

### `maxDistance` config perf impact (docs-only)

Default `machineLearning.clip.maxDistance = 0.5` in fork config. The reporter had it bumped to `0.95`, which expands the filter's selectivity estimate enough to push the planner further toward seq scan even with the tiebreaker fix. Re-validate on the reporter's instance after the fix lands; if still seq-scanning, add a docs note in `docs/docs/features/searching.md` about the tradeoff.

### Missing indexes (benefits upstream too)

`asset.type` has no index → `SELECT DISTINCT type FROM asset` full-scans every FilterPanel open. A composite `(ownerId, visibility, deletedAt, fileCreatedAt)` would help many of the seq-scanning queries in the burst. These also apply to upstream Immich and are candidates for an upstream PR rather than a fork-only change.

### Medium-test EXPLAIN regression (future, if needed)

A medium test could seed ~5k rows in `smart_search`, run `searchSmart`, and parse `EXPLAIN (FORMAT JSON)` to assert `Index Scan using clip_index` appears in the plan tree. Higher fidelity than the unit SQL-shape test — catches semantic (planner) regressions rather than syntactic ones. Deferred for now: the unit test + local-reproducer + real-data validation stack is sufficient for this fix. Revisit if we see repeat regressions in this area.

## Out of scope

- No frontend behavior changes beyond the dedup test additions and comment update.
- No changes to `searchAssetBuilder` (the `withSharedSpaces`, `maxDistance`, `orderDirection` options all remain).
- No index additions, no `vchordrq.probes` tuning, no `maxDistance` default change.
