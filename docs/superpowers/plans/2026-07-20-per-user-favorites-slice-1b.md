# Per-user favorites — Slice 1b (`mapAsset` projection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AssetResponseDto.isFavorite` resolve from the `asset_favorite` overlay instead of the ownership comparison at `asset-response.dto.ts:228`, without ever exposing the raw `asset.isFavorite` column to a caller that should not see it.

**Architecture:** `mapAsset` is a **pure row→DTO function with no database access**, so it cannot run an EXISTS. The resolved value must arrive on the row. Queries that have an authenticated caller project `favoriteExistsFor(eb, authUserId).as('isFavoriteForUser')`; `mapAsset` reads **only** that field. Queries with no caller never project it, and `?? false` yields today's behavior.

**Tech Stack:** NestJS 11, Kysely, Vitest (unit + medium), e2e (vitest).

**Spec:** `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` §1.1, §3. Edge case E1.

## Why this is its own slice

Slice 1 deliberately left `asset-response.dto.ts:228` unchanged. The enumeration of `mapAsset`
callers found that **all ten feed raw, unresolved rows**, and one is actively dangerous:

`shared-link.dto.ts:92` (`mapSharedLink`) calls `mapAsset(asset, { stripMetadata })` with **no auth
object at all**. Today `options.auth?.user.id === entity.ownerId` is `false` when `auth` is
undefined, so anonymous shared-link visitors always see `isFavorite: false`. Naively changing the
mapper to `entity.isFavorite ?? false` would instead hand the **owner's** favorite flag to any
anonymous visitor of a metadata-enabled share link — the exact inversion of this project's goal.

## The key design decision: a distinct field name

**`mapAsset` must never read `entity.isFavorite`.** It reads a differently-named field,
`isFavoriteForUser`, which only the overlay projection sets.

This matters because `asset.isFavorite` still exists until slice 3. If the mapper read
`entity.isFavorite ?? false`, then between this slice and slice 3 every un-migrated query would
silently feed the mapper the **raw global column** — a leak window with no failing test, because
for owners the two values are identical (slice 0 backfilled them). The bug would only appear for
non-owners, which is precisely the case with the least test coverage.

With a distinct name the failure mode inverts: a query that forgets to project yields `undefined`
→ `false`. **Fail-safe, and it matches today's behavior for every auth-less caller.**

## Global Constraints

- Fresh-worktree prerequisites (already satisfied here): `@immich/sdk`, `@immich/plugin-sdk`,
  `@immich/plugin-core` built; `git submodule update --init e2e/test-assets`.
- Scoped test commands — the `pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>`
  forms both silently DROP the path filter:
  - unit: `cd server && npx vitest --config test/vitest.config.mjs run <path>`
  - medium: `cd server && npx vitest --config test/vitest.config.medium.mjs run <path> --maxWorkers=2`
- **Run medium suites with `--maxWorkers=2`.** At default parallelism this machine exhausts the
  Postgres connection pool and produces spurious `too many clients already` failures.
- **DO NOT RUN `make sql` OR `node dist/bin/sync-sql.js`.** It truncates all 38 files in
  `server/src/queries/` _before_ connecting, and hangs forever if the DB is unreachable — it has
  already destroyed the query directory twice in this project. Snapshot regeneration is handled
  separately by the orchestrator. If you believe a snapshot is stale, **report it**.
- No relative imports in `server/`; use the `src/` alias. Prettier 120 cols. eslint `--max-warnings 0`.
- No `Co-Authored-By` / `Generated-with` commit trailers.
- `asset.isFavorite` the column must still exist at the end of this slice (dropped in slice 3).
- Do **not** touch `sync.repository.ts` (slice 6), write paths (slices 2, 7), the
  `timeline.service.ts` guards (slice 4), web, or mobile.

## Known baselines

- unit: **5094 passed / 9 skipped**
- medium: **137 files / 1959 passed** at `--maxWorkers=2`
- `sync-partner.spec.ts` flakes intermittently under parallel load — a **pre-existing,
  order-dependent assertion** (`:76-77` creates two partners in the same clock tick; `:85-95`
  asserts a fixed order; the stream orders by same-tick UUIDv7 `updateId`). Not ours, not in
  scope. If it fails, re-run it in isolation to confirm, and report — do not "fix" it here.

---

### Task 1: Change the mapper contract

**Files:**

- Modify: `server/src/dtos/asset-response.dto.ts` (`:228`, plus the `MapAsset` row type)
- Test: `server/src/dtos/asset-response.dto.spec.ts` (create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: `mapAsset` reads `entity.isFavoriteForUser ?? false`. The `MapAsset` type gains an
  optional `isFavoriteForUser?: boolean`. Task 2 relies on this field name exactly.

- [ ] **Step 1: Write the failing unit test**

```ts
describe('mapAsset — per-user favorite (#763)', () => {
  it('reports true when the row carries isFavoriteForUser', () => {
    // mapAsset({ ...asset, isFavoriteForUser: true }, { auth }) -> isFavorite === true
  });

  it('reports false when the row carries isFavoriteForUser false', () => {});

  it('reports false when the row does not carry the field at all', () => {
    // a query that forgot to project -> fail-safe false, never a leak
  });

  it('NEVER reads the raw asset.isFavorite column', () => {
    // mapAsset({ ...asset, isFavorite: true, isFavoriteForUser: false }, { auth: ownerAuth })
    //   -> isFavorite === false
    // This is the anti-leak assertion: owner, raw column true, overlay false -> false.
  });

  it('reports false for a shared-link call with no auth, even when the raw column is true', () => {
    // mapAsset({ ...asset, isFavorite: true }, { stripMetadata: false })  // no auth
    //   -> isFavorite === false     (the mapSharedLink regression this slice exists to prevent)
  });
});
```

- [ ] **Step 2: Run to verify red**

```bash
cd server && npx vitest --config test/vitest.config.mjs run src/dtos/asset-response.dto.spec.ts
```

Expected: FAIL. The 4th and 5th cases fail against the current ownership-comparison implementation
(it returns `true` for an owner whose raw column is true).

- [ ] **Step 3: Change the mapper**

Replace `asset-response.dto.ts:228`:

```ts
isFavorite: options.auth?.user.id === entity.ownerId && entity.isFavorite,
```

with:

```ts
// #763: resolved per-user by the query via favoriteExistsFor(...).as('isFavoriteForUser').
// Deliberately NOT `entity.isFavorite` — that is the global column (dropped in slice 3), and
// reading it here would leak the owner's flag to non-owners and to auth-less callers such as
// mapSharedLink. A query that does not project the field yields undefined -> false (fail-safe).
isFavorite: entity.isFavoriteForUser ?? false,
```

Add `isFavoriteForUser?: boolean` to the `MapAsset` type. Locate that type first
(`grep -rn "MapAsset" server/src/dtos/asset-response.dto.ts server/src/database.ts`) and extend it
where it is actually declared.

- [ ] **Step 4: Run to verify green**

Same command. Expected: PASS, all five.

- [ ] **Step 5: Establish the blast radius**

The mapper now returns `false` everywhere until Task 2 adds projections. Run the full unit suite
and record which tests break — that list **is** the set of surfaces needing projection, and is the
input to Task 2.

```bash
cd server && npx vitest --config test/vitest.config.mjs run 2>&1 | tail -40
```

Do **not** fix them here. Record and report the failing test names.

- [ ] **Step 6: Commit**

```bash
git add server/src/dtos/asset-response.dto.ts server/src/dtos/asset-response.dto.spec.ts
git commit -m "feat(favorites): map isFavorite from the per-user projection (#763)"
```

---

### Task 2: Project the resolved value in auth-bearing queries

**Files:** determined by Task 1 Step 5. Expected set, from the slice-1 enumeration:

- `server/src/repositories/asset.repository.ts` — `getById`, `getByIds`,
  `getByIdsWithAllRelationsButStacks`, `update` return paths
- `server/src/repositories/memory.repository.ts`
- `server/src/repositories/view-repository.ts`
- `server/src/repositories/search.repository.ts` — the `mapAsset`-feeding search paths
- Callers that must pass an `authUserId` down: `asset.service.ts` (`get`, `update`),
  `search.service.ts`, `view.service.ts`, `memory` mapping, `stack.dto.ts`

**Interfaces:**

- Consumes: `isFavoriteForUser` from Task 1; `favoriteExistsFor(eb, userId, assetIdRef?)` from
  slice 1 Task 1 — signature:
  `(eb: ExpressionBuilder<DB, keyof DB>, userId: string, assetIdRef?: string) => AliasableExpression<SqlBool>`.
- Produces: per-user favorites correct on every authenticated asset-returning endpoint.

- [ ] **Step 1: Write the failing medium/e2e tests**

For each surface, a test where **user A owns an asset, user B favorites it** (seed
`asset_favorite` directly) and assert each sees their own value. At minimum:

```ts
// GET /assets/:id  — owner sees own overlay value; a space member sees THEIR value (E1)
// search results   — same
// memory assets    — same
// view (folder)    — same
// shared link with no auth -> isFavorite false even when the owner has favorited it
```

- [ ] **Step 2: Run to verify red**

Run the specific specs. Expected: FAIL — everything reports `false` after Task 1.

- [ ] **Step 3: Add the projection, query by query**

For each query feeding `mapAsset`, add:

```ts
.select((eb) => favoriteExistsFor(eb, authUserId).as('isFavoriteForUser'))
```

threading an explicit `authUserId` parameter where the repository method lacks one.

**Do NOT reuse `userIds[0]` or `ownerId` as the caller.** Slice 1 proved this is wrong: in
`shared-space.service.ts` the options set `userIds: dto.spaceId ? undefined : [auth.user.id]`, so
`userIds` is **undefined entirely** on the space-browse path. Add a distinct parameter.

**Deliberately do NOT project for:** `mapSharedLink` (`shared-link.dto.ts:92`) — no auth exists,
`false` is correct; `job.service.ts:211` and `notification.service.ts:179` — background/synthetic
auth, `false` is correct and matches today; `duplicate.service.ts:75` — slice 7.
Add a one-line comment at each of these four sites stating that the omission is intentional, so a
later reader does not "fix" it.

- [ ] **Step 4: Run to verify green**

The specs from Step 1, plus the full unit suite back to the 5094 baseline.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(favorites): project per-user favorite into asset responses (#763)"
```

---

### Task 3: Slice-1b verification gate

- [ ] **Step 1:** `cd server && npx vitest --config test/vitest.config.mjs run` → 5094 passed / 9 skipped
- [ ] **Step 2:** `cd server && npx vitest --config test/vitest.config.medium.mjs run --maxWorkers=2` → 137 files. Any `sync-partner` failure: re-run in isolation, confirm pre-existing, report.
- [ ] **Step 3:** `cd server && npx tsc --noEmit && pnpm lint && npx prettier --check "src/**/*.ts"`
- [ ] **Step 4:** `cd e2e && pnpm test` — **this is the slice that most needs e2e**, because the mapper feeds every asset-returning endpoint. Expect `shared-space-album.e2e-spec.ts:705` to still pass (it exercises the write path, untouched until slice 2).
- [ ] **Step 5: Scope check**

```bash
git diff --stat main...HEAD -- server/src/repositories/sync.repository.ts web mobile
```

Expected: **empty** except the `AssetFavoriteSync` audit-cleanup class already landed in `ea5aa2f380`.

- [ ] **Step 6:** `git push`

---

## Self-Review

**Spec coverage.** §1.1's claim that the API already means "favorited by you" is true only because
of an ownership comparison in a pure function; this slice makes it true via the overlay. E1
(two users, one asset, independent values) is asserted in Task 2 Step 1 across every surface.

**The anti-leak assertion is the point of Task 1.** The 4th test — owner, raw column `true`,
overlay `false`, expect `false` — is what proves the mapper stopped reading the global column. It
would pass trivially if written the obvious way (raw and overlay agree for owners after slice 0's
backfill), so it must set them to **disagree**.

**Placeholder scan.** Task 2's file list is explicitly "determined by Task 1 Step 5" rather than
guessed — Task 1 ends by running the full suite to produce that list empirically. This is the one
place the plan defers detail, and it does so with a mechanism rather than a TODO.

**Type consistency.** `isFavoriteForUser` is the single field name across the mapper, the
`MapAsset` type, and every projection. `authUserId` is the parameter name for the threaded caller
id, matching slice 1.

**Deliberate non-goals recorded in-code.** Four call sites intentionally never project
(`mapSharedLink`, `job.service.ts`, `notification.service.ts`, `duplicate.service.ts`). Each gets a
comment, because a future reader seeing `isFavorite: false` on a shared link will otherwise read it
as a bug and "fix" it straight back into a leak.
