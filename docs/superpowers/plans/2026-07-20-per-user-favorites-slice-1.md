# Per-user favorites — Slice 1 (read path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every read of "is this asset favorited" resolves against the `asset_favorite` overlay for the requesting user, instead of `asset.isFavorite` masked by ownership. Observable behavior is unchanged.

**Architecture:** One shared Kysely expression helper (`favoriteExistsFor`) is substituted into every read site. Because slice 0's migration backfilled `asset.isFavorite = true` → one overlay row for the owner, and because no read path can currently surface a non-owned favorite, **owner parity is exact** — that parity is this slice's regression suite.

**Tech Stack:** NestJS 11, Kysely, `@immich/sql-tools`, PostgreSQL, Vitest (unit + medium).

**Spec:** `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` §5.2, slice 1. Edge cases E1, E22, E24.

## Global Constraints

- Fresh worktree: `@immich/sdk`, `@immich/plugin-sdk` and `@immich/plugin-core` must be built or medium tests die at collection. Already built in this worktree.
- Scoped test commands (the `pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>` forms both silently DROP the path filter):
  - unit: `cd server && npx vitest --config test/vitest.config.mjs run <path>`
  - medium: `cd server && npx vitest --config test/vitest.config.medium.mjs run <path>`
- Never run `make sql` without a running DB — it deletes all query files.
- No relative imports in `server/`; use the `src/` alias. Prettier 120 cols. eslint `--max-warnings 0`. prettier and eslint are separate CI gates.
- No `Co-Authored-By` / `Generated-with` commit trailers.
- **`asset.isFavorite` must still exist at the end of this slice.** It is dropped in slice 3.
- **Do not touch `sync.repository.ts`** — slice 6. **Do not touch write paths** (`asset.service.ts`, `asset-media.service.ts`, `duplicate.service.ts`) — slices 2 and 7. **Do not remove the `timeline.service.ts` guards** — slice 4.

## Scope corrections vs. the spec (already validated against the code)

These supersede the spec's slice 1 text:

1. **E10 (favorite-then-lose-access leak) moves to slice 4.** It cannot go red here: `isFavorite` + `withSharedSpaces` is a hard 400 (`timeline.service.ts:177-200`) and plain `/favorites` is owner-scoped (`asset.repository.ts:421-423`), so no non-owned favorite can appear in any listing yet. Writing it now yields a green-on-first-run test. **No access filter is added in this slice** — it belongs with the scoping change in slice 4.
2. **`search.repository.ts:324/359/377/397/507` are not read sites.** They are `@GenerateSql` params fixtures. The real seams are `:655` (`buildSmartFacetFilteredAssetIds`) and `:1413` (`buildFilteredAssetIds`).
3. **`asset.repository.ts:1494` (`array_agg`) needs no change** — it aggregates the already-resolved `cte.isFavorite`.

---

### Task 1: The shared overlay expression helper

**Files:**

- Create: `server/src/utils/favorite.ts`
- Test: `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts` (extend the file slice 0 created)

**Interfaces:**

- Consumes: table `asset_favorite` from slice 0.
- Produces: `favoriteExistsFor(eb, userId, assetIdRef?): Expression<SqlBool>` — a correlated EXISTS usable in both SELECT and WHERE position. Every later task in this slice uses it.

- [ ] **Step 1: Write the failing medium test**

Append to `server/test/medium/specs/repositories/asset-favorite.repository.spec.ts`:

```ts
describe('favoriteExistsFor', () => {
  it('is true only for the user who favorited the asset', async () => {
    // userA favorites assetX; userB does not
    // select asset.id, favoriteExistsFor(eb, userA.id) as fav  -> true
    // select asset.id, favoriteExistsFor(eb, userB.id) as fav  -> false
    // (E1)
  });

  it('is false for an asset with no favorite rows at all', async () => {});

  it('usable as a WHERE predicate to filter to a user favorites', async () => {
    // userA favorites assetX but not assetY
    // where(favoriteExistsFor(eb, userA.id)) returns exactly [assetX]
  });
});
```

- [ ] **Step 2: Run to verify red**

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset-favorite.repository.spec.ts
```

Expected: FAIL — `favoriteExistsFor` is not exported / module not found.

- [ ] **Step 3: Implement the helper**

```ts
import { Expression, ExpressionBuilder, SqlBool, sql } from 'kysely';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

/**
 * Per-user favorites (#763). Correlated EXISTS against the `asset_favorite` overlay.
 *
 * Replaces the old ownership-masking form `asset."isFavorite" and asset."ownerId" = :me`,
 * which could only ever be true for the asset's owner. Usable in SELECT position (projects a
 * boolean) and in WHERE position (filters to the user's favorites).
 */
export function favoriteExistsFor(
  eb: ExpressionBuilder<DB, never>,
  userId: string,
  assetIdRef: string = 'asset.id',
): Expression<SqlBool> {
  return eb.exists(
    eb
      .selectFrom('asset_favorite')
      .select(sql.lit(1).as('one'))
      .whereRef('asset_favorite.assetId', '=', sql.ref(assetIdRef))
      .where('asset_favorite.userId', '=', asUuid(userId)),
  );
}
```

The `ExpressionBuilder<DB, never>` type parameter and the `sql.ref` usage may need adjusting to satisfy this checkout's Kysely version — **before writing this, read `server/src/utils/shared-space-album-scope.ts` (particularly `spaceDirectAssetExists` and `spaceVisibilityGate` around `:41-46` and `:323-336`) and copy its exact `ExpressionBuilder` typing and correlated-EXISTS idiom.** That file is the established pattern for exactly this shape.

- [ ] **Step 4: Run to verify green**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/favorite.ts server/test/medium/specs/repositories/asset-favorite.repository.spec.ts
git commit -m "feat(favorites): add favoriteExistsFor overlay expression helper (#763)"
```

---

### Task 2: DTO mapper and asset repository reads

**Files:**

- Modify: `server/src/dtos/asset-response.dto.ts:228`
- Modify: `server/src/repositories/asset.repository.ts` — `:447` (WHERE), `:1061` (`getForCopy`), `:1265` (`getStatistics`), `:1432` (masked select)
- Modify: `server/src/database.ts:451,454` (remove the duplicate `asset.isFavorite`)
- Test: `server/test/medium/specs/repositories/asset.repository.spec.ts`, `server/src/repositories/asset.repository.spec.ts`

**Interfaces:**

- Consumes: `favoriteExistsFor` from Task 1.
- Produces: read parity. Slice 2's write path and slice 4's scoping change both depend on these reads already resolving from the overlay.

- [ ] **Step 1: Write the failing medium tests**

In `server/test/medium/specs/repositories/asset.repository.spec.ts`:

```ts
it('getTimeBucket reports isFavorite from the overlay for the requesting user', async () => {
  // userA owns assetX. Insert asset_favorite (userA, assetX) directly.
  // getTimeBucket(bucket, options, authAsUserA) -> isFavorite[] contains true for assetX
  // Then delete the overlay row and assert it flips to false, WITHOUT touching asset.isFavorite.
  // Red today: the masked expression reads asset."isFavorite", which the direct
  // overlay insert never set.  (E24)
});

it('getStatistics counts only the callers overlay rows', async () => {
  // userA owns assetX and assetY; overlay row only for assetX
  // getStatistics(userA.id, { isFavorite: true }) -> counts 1  (E22)
});
```

- [ ] **Step 2: Run to verify red**

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts
```

Expected: FAIL — assertions see `false`/`0` because reads still consult `asset.isFavorite`, which the direct overlay inserts never set.

- [ ] **Step 3: Substitute each read site**

`server/src/dtos/asset-response.dto.ts:228` — the mapper is pure TS over a row, not a query builder, so it cannot run an EXISTS. The row must arrive with the value already resolved. Change:

```ts
isFavorite: options.auth?.user.id === entity.ownerId && entity.isFavorite,
```

to read the resolved column the repository now projects:

```ts
isFavorite: entity.isFavorite ?? false,
```

and ensure every query feeding `mapAsset` projects `isFavorite` via `favoriteExistsFor`. **Enumerate those callers before editing** (`grep -rn "mapAsset" server/src`) and confirm each one's query projects the overlay value. If any caller cannot (e.g. it selects from a view without auth context), report it rather than silently leaving an ownership comparison in place.

`server/src/repositories/asset.repository.ts:1432` — replace:

```ts
sql`asset."isFavorite" and asset."ownerId" = ${auth.user.id}`.as('isFavorite'),
```

with:

```ts
favoriteExistsFor(eb, auth.user.id).as('isFavorite'),
```

(the surrounding `.select((eb) => [...])` already supplies `eb`).

`server/src/repositories/asset.repository.ts:447` — replace:

```ts
.$if(options.isFavorite !== undefined, (qb) => qb.where('asset.isFavorite', '=', options.isFavorite!))
```

with a form that filters on the overlay for the requesting user. `withTimeBucketAssetFilters` does **not** currently receive the auth user id — it takes `(qb, options)`. Add `userId` to `TimeBucketOptions` (it already carries `userIds`, but that is the _timeline target_, not necessarily the caller; introduce an explicit `authUserId`) and thread it from `getTimeBucket`/`getTimeBuckets`/`getTimeBucketCovers`. Then:

```ts
.$if(options.isFavorite !== undefined, (qb) =>
  qb.where((eb) =>
    options.isFavorite ? favoriteExistsFor(eb, options.authUserId!) : eb.not(favoriteExistsFor(eb, options.authUserId!)),
  ),
)
```

`:1061` `getForCopy` — this selects `isFavorite` for the _copy_ path, which slice 7 owns. Leave the column select in place for now (it still exists) and add a `// TODO(#763 slice 7)` comment. Do not change copy semantics here.

`:1265` `getStatistics` — replace:

```ts
.$if(isFavorite !== undefined, (qb) => qb.where('isFavorite', '=', isFavorite!))
```

with the overlay predicate for `ownerId` (which is the caller for this method — verify at the call site in `asset.service.ts:66-73`).

`server/src/database.ts:451,454` — delete the duplicate `'asset.isFavorite'` entry so the list contains it exactly once.

- [ ] **Step 4: Fix the offline SQL-string assertions**

`server/src/repositories/asset.repository.spec.ts` has three describe blocks (around `:23`, `:47`, `:88`) that compile `withTimeBucketAssetFilters` and assert on the generated SQL **string**. These are not snapshots — `make sql` will not fix them. Run them, read the actual diff, and update the expected strings to match the new EXISTS form.

```bash
cd server && npx vitest --config test/vitest.config.mjs run src/repositories/asset.repository.spec.ts
```

- [ ] **Step 5: Run to verify green**

Both commands from Steps 2 and 4. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/dtos/asset-response.dto.ts server/src/repositories/asset.repository.ts server/src/database.ts server/src/repositories/asset.repository.spec.ts server/test/medium/specs/repositories/asset.repository.spec.ts
git commit -m "feat(favorites): resolve asset reads from the overlay (#763)"
```

---

### Task 3: Search, map and shared query-builder reads

**Files:**

- Modify: `server/src/utils/database.ts:880` (`searchAssetBuilder`)
- Modify: `server/src/repositories/search.repository.ts:655`, `:1413-1415`
- Modify: `server/src/repositories/map.repository.ts:109`
- Test: `server/test/medium/specs/repositories/search.repository.spec.ts`, `.../map.repository.spec.ts`

**Interfaces:**

- Consumes: `favoriteExistsFor` from Task 1.
- Produces: search/map favorite filtering resolved per-user. Slice 4 relies on these already being overlay-based when it widens scoping.

- [ ] **Step 1: Write the failing medium tests**

For search: a user's `isFavorite: true` metadata search returns only assets in _their_ overlay. For map: `getMapMarkers` with `isFavorite: true` returns only the caller's overlay assets. Write both to seed the overlay directly and leave `asset.isFavorite` untouched, so they are red against the current column reads.

- [ ] **Step 2: Run to verify red**

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/search.repository.spec.ts test/medium/specs/repositories/map.repository.spec.ts
```

- [ ] **Step 3: Substitute**

`utils/database.ts:880` — `searchAssetBuilder` receives `options` containing `userIds`. It needs the **caller's** id, which is not necessarily `userIds[0]` on space/album paths. Add an explicit `authUserId` to the options type and thread it from each `SearchRepository.search*` call site. Then replace the bare predicate with the overlay form (true → `favoriteExistsFor`, false → `eb.not(...)`).

`search.repository.ts:655` and `:1413-1415` — same substitution, using the caller id already available in those methods (`buildFilteredAssetIds` takes `userIds`; verify the caller passes the auth user and add an explicit param if not).

`map.repository.ts:109` — `getMapMarkers` already receives `authUserId` as its first parameter, so substitute directly:

```ts
.$if(isFavorite !== undefined, (qb) =>
  qb.where((eb) => (isFavorite ? favoriteExistsFor(eb, authUserId) : eb.not(favoriteExistsFor(eb, authUserId)))),
)
```

- [ ] **Step 4: Run to verify green**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Regenerate SQL snapshots**

A DB must be running. Regenerate and inspect:

```bash
make sql
git diff --stat server/src/queries/
```

Expected: changes confined to `asset.repository.sql`, `search.repository.sql`, `map.repository.sql`. **`sync.repository.sql` must NOT change** — if it does, `sync.repository.ts` was touched, which belongs to slice 6. Revert and report.

- [ ] **Step 6: Commit**

```bash
git add server/src/utils/database.ts server/src/repositories/search.repository.ts server/src/repositories/map.repository.ts server/src/queries server/test/medium
git commit -m "feat(favorites): resolve search and map favorite filters from the overlay (#763)"
```

---

### Task 4: Slice-1 verification gate

- [ ] **Step 1: Full server unit suite**

```bash
cd server && npx vitest --config test/vitest.config.mjs run
```

Expected: 5094+ passed, 0 failed. Baseline from slice 0 was 5094 passed / 9 skipped.

- [ ] **Step 2: Full medium suite**

```bash
cd server && npx vitest --config test/vitest.config.medium.mjs run
```

Expected: all pass. If `workflow-core-plugin.spec.ts` fails with `Plugin method not found`, that is the unbuilt-package false alarm — build `packages/plugin-core` and re-run before investigating.

- [ ] **Step 3: Type check, lint, format**

```bash
cd server && npx tsc --noEmit && pnpm lint && npx prettier --check "src/**/*.ts"
```

- [ ] **Step 4: E2E API suite** (this slice changes read behavior, so e2e is warranted)

```bash
cd e2e && pnpm test
```

Expected: pass. Favorite-related specs in `asset.e2e-spec.ts` and `search.e2e-spec.ts` assert owner-visible favorite behavior, which parity preserves. **If `shared-space-album.e2e-spec.ts:705` fails, that is expected in slice 2, not here** — it asserts editor bulk-favorite via the write path, untouched by this slice.

- [ ] **Step 5: Scope check**

```bash
git diff --stat main...HEAD -- server/src/repositories/sync.repository.ts server/src/services/asset.service.ts web mobile
```

Expected: **empty**. Any output means the slice drifted into 2, 4, 5, 6 or 7.

- [ ] **Step 6: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage.** Slice 1's substitution list → Tasks 2 and 3, site by site. E1 → Task 1 Step 1. E24 → Task 2 Step 1. E22 → Task 2 Step 1. E10 → **explicitly deferred to slice 4** with reasoning (Scope corrections §1); the spec's §6 table must be updated to reassign it from "1, 4" to "4".

**Known unknowns flagged rather than guessed.** Three places thread a caller id that does not currently exist in the signature (`withTimeBucketAssetFilters`, `searchAssetBuilder`, `buildFilteredAssetIds`). Each step says to add an explicit `authUserId` rather than assume `userIds[0]` is the caller — on space and album paths it is not. This is the highest-risk part of the slice and the most likely source of a subtle per-user bug.

**The DTO mapper is the second risk.** `mapAsset` cannot run an EXISTS, so correctness depends on every feeding query projecting the resolved value. Task 2 Step 3 requires enumerating `mapAsset` callers and reporting any that cannot project it, rather than leaving a silent ownership comparison.

**Placeholder scan.** No TBD/TODO except one deliberate `// TODO(#763 slice 7)` on `getForCopy`, which is explicitly slice 7's. Two steps instruct reading an existing file (`shared-space-album-scope.ts`) for the exact typing idiom rather than trusting my snippet — slice 0 proved that snippet imports drift from this checkout.

**Type consistency.** `favoriteExistsFor(eb, userId, assetIdRef?)` is used with the same signature in Tasks 2 and 3. `authUserId` is the name used consistently for the newly-threaded caller id in `TimeBucketOptions`, `searchAssetBuilder` options, and `buildFilteredAssetIds`.
