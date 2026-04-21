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

- **Update `web/src/lib/components/search/smart-search-results.svelte:48-49` comment** to reflect that the frontend dedup is now the primary guard (not supplementary to a backend tiebreaker).

## Why this is safe

`asset.id` is the primary key of `asset`; the join `asset.id = smart_search.assetId` guarantees each `asset.id` appears at most once per query result — so intra-page duplicates are schema-impossible regardless of the ORDER BY.

Cross-page duplicates via non-deterministic OFFSET ordering are caught by the frontend dedup at `smart-search-results.svelte:50-51`:
```js
const existingIds = new Set(searchResults.map(a => a.id));
const deduped = assets.items.filter(a => !existingIds.has(a.id));
```

Upstream Immich's `searchSmart` (`git show upstream/main:server/src/repositories/search.repository.ts`) has a single-key `ORDER BY embedding <=>` with no tiebreaker. The proposed change brings Gallery in line with upstream.

## Honest risk

For users with byte-identical duplicate image content (rare): infinite scroll may surface fewer unique results than exist. The same `asset.id` can "spend" a slot on both page 1 and page 2 (frontend dedup removes the duplicate on page 2), pushing a different asset off the viewed window. Unlike typical pagination edge cases, **this is not self-healing** — the missed asset only reappears if continued scroll randomly happens to include it on a later page.

This risk must be called out in the PR description so future "missing results after infinite scroll" bug reports are searchable and resolvable without rediscovery. Rarity is consistent with upstream Immich, which ships without a tiebreaker.

## Verification

### Unit test (new)

New file `server/src/repositories/search.repository.spec.ts`. Uses Kysely's `.compile()` offline (no DB) to get the final SQL string and assert ordering shape.

Required assertions:
1. `searchSmart` non-CTE path: generated SQL's `ORDER BY` contains `smart_search.embedding` and does **not** contain `"asset"."id"` as a secondary sort key.
2. `searchSmart` CTE path (`orderDirection: 'desc'`): inner query's ORDER BY has no `asset.id`; outer query's ORDER BY retains `"candidates"."id"`.

Each assertion's failure message must be explicit:
```
Do not re-add asset.id to the inner ORDER BY of searchSmart.
See comment at server/src/repositories/search.repository.ts:359.
Secondary ORDER BY keys force Parallel Seq Scan instead of vchord index.
```

This guards against silent regressions from merge-conflict resolves or future refactors. Brittleness to Kysely version bumps is acceptable — the failure text points at the exact intent.

### Reference SQL regeneration

Run `pnpm sql` in `server/` after the code change. `server/src/queries/search.repository.sql` will update; commit the diff. CI's Schema Check catches drift between committed SQL and regenerated SQL.

### Real-data validation

1. Ship to `main`.
2. Ship a Gallery release (standard `gallery-release.yml` workflow run).
3. atlasshrugged pulls the release and re-runs the diagnostic gist (https://gist.github.com/Deeds67/75bb0e5b2c1443402454068adb0cd102) with `GALLERY_SEARCH_TIMING=true` still set.

**Success criteria:**
- `db=` phase in `GALLERY_SEARCH_TIMING` log lines drops from 3-16s to <1s for cache-hit embeddings.
- `auto_explain` output for `searchSmart` shows `Index Scan using clip_index` instead of `Parallel Seq Scan on smart_search`.

## Rollback

Single-commit `git revert <sha>`. Frontend dedup remains in place regardless. Reverting just reintroduces the belt-and-braces behavior at the original perf cost.

## Callers verified

`grep -rn 'searchRepository.searchSmart\|.searchSmart('` → only `server/src/controllers/search.controller.ts:91` calls this in production. Fork-specific features (duplicate detection, classification, video dedup) use other repository methods and are unaffected. Service spec tests at `server/src/services/search.service.spec.ts` do not assert ordering of identical-embedding ties.

## Scope exclusions — documented follow-ups

### Filter suggestions batch burst (future PR)

`getFilterSuggestions` at `server/src/repositories/search.repository.ts:631` uses `Promise.all` to fire 6 concurrent seq-scans (countries, cameraMakes, tags, people, ratings, mediaTypes) per invocation. On the reporter's 200k instance this generates 2-3s of additional load per FilterPanel open, compounding with smart search CPU contention.

Proposed follow-up: add a short per-user TTL cache (30-60s) keyed by `(userId, serialized options)`. Invalidate on asset upload/delete websocket events or time-based. Measure impact after the tiebreaker fix lands — if real-world searches drop below upstream parity, this becomes lower priority.

### `maxDistance` config perf impact (docs-only)

Default `machineLearning.clip.maxDistance = 0.5` in fork config. The reporter had it bumped to `0.95`, which expands the filter's selectivity estimate enough to push the planner further toward seq scan even with the tiebreaker fix. Re-validate on atlasshrugged's instance after the fix lands; if still seq-scanning, add a docs note in `docs/docs/features/searching.md` about the tradeoff.

### Missing indexes (benefits upstream too)

`asset.type` has no index → `SELECT DISTINCT type FROM asset` full-scans every FilterPanel open. A composite `(ownerId, visibility, deletedAt, fileCreatedAt)` would help many of the seq-scanning queries in the burst. These also apply to upstream Immich and are candidates for an upstream PR rather than a fork-only change.

## Out of scope

- No frontend behavior changes beyond the comment update.
- No changes to `searchAssetBuilder` (the `withSharedSpaces`, `maxDistance`, `orderDirection` options all remain).
- No index additions, no `vchordrq.probes` tuning, no `maxDistance` default change.
