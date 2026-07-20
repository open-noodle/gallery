# Per-user favorites — Slice 3: Drop `asset.isFavorite` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single source of truth — the `asset_favorite` overlay becomes the only favorite storage; the legacy `asset."isFavorite"` column is dropped. **The point of no return** (spec §9): runs LAST, only after the readiness grep is clean.

**Architecture:** Post-slice-6 readiness state (verified 2026-07-20): the ONLY remaining non-comment readers of the raw column are `columns.asset` (`database.ts:451`) with its single consumer `asset-job.repository.ts:151`, feeding the plugin-facing `workflowAssetV1` projections (`job.service.ts:162,232`, `workflow-execution.service.ts:351`). Those run in background jobs with **no auth user** — the correct per-user semantic for the plugin field is the **asset owner's** favorite, which is exactly what the raw column meant pre-#763 (only the owner could set it). So: a new owner-correlated overlay helper replaces the column in that one query, then the grep gate goes green, then the migration drops the column, the table class loses the field, and snapshots regenerate.

**Tech Stack:** Kysely, fork migration in `migrations-gallery/` (round timestamp), medium tests (testcontainers), `sync-sql` snapshot regen against a throwaway migrated Postgres.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` slice 3 (§9). Gate = the readiness grep returning **nothing** outside comments, person favorites, migration history, and the revert script — enforced as a unit test, not a manual step.
- The plugin-facing `workflowAssetV1.isFavorite` field keeps its shape and its pre-#763 meaning (the owner's favorite). Plugins never see another user's state; no behavior change for existing workflows whose owner favorited via any surface.
- Migration: new file in `server/src/schema/migrations-gallery/` with a round timestamp AFTER `1784000000000-AddAssetFavoriteTables` (e.g. `1784100000000-DropAssetIsFavoriteColumn.ts`): `ALTER TABLE "asset" DROP COLUMN "isFavorite"`, with a `down` that re-adds `boolean NOT NULL DEFAULT false` and backfills owner rows from the overlay (mirror of the revert script's step §4.2). Must apply on a DB where the slice-0 backfill already ran (unordered-migration path).
- `revert-to-immich.sql` needs NO structural change (its ADD COLUMN + backfill + DROP TABLE steps were written for the post-drop state in slice 0) — but `revert-to-immich.spec.ts` gains the new migration name in the step-8 DELETE block, which its test enforces (red first).
- SQL snapshots: regenerate via the throwaway-Postgres flow proven in slice 6 Task 3 — fresh container on :5439 from the `docker/docker-compose.dev.yml` image, **`pnpm migrations:run` FIRST** (the unmigrated-DB failure mode is proven: partial snapshots + deleted files), then `pnpm build` + `DB_URL=... node ./dist/bin/sync-sql.js` from `server/`. Diff must be favorite/column-related only.
- After the table-class field removal, `tsc --noEmit` failures are the loud-error inventory — fix each by conversion to the overlay or deletion of dead code, never by re-adding the field.
- Server style gates as ever (prettier + eslint separate); e2e via `cd e2e && npx vitest --config vitest.config.ts run <path>` (self-provisioning stack).
- Commits: `feat(favorites): … (#763)` / `chore(sql): … (#763)`; no trailers.

## File Map

| File                                                                              | Change                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/utils/favorite.ts`                                                    | Add `favoriteExistsForOwner(eb, assetIdRef?, ownerIdRef?)` — EXISTS correlated on `asset_favorite.userId = asset."ownerId"` (column ref, not a bound uuid) |
| `server/src/database.ts:451`                                                      | Remove `'asset.isFavorite'` from `columns.asset`                                                                                                           |
| `server/src/repositories/asset-job.repository.ts:151`                             | `.select(columns.asset)` + owner-overlay `isFavorite` select                                                                                               |
| `server/src/services/workflow-execution.service.ts:331-335`                       | Update the stale comment (it documents reading the legacy column)                                                                                          |
| `server/src/schema/tables/asset.table.ts` (isFavorite field ~:93-94)              | Remove                                                                                                                                                     |
| `server/src/schema/migrations-gallery/1784100000000-DropAssetIsFavoriteColumn.ts` | New migration (up: drop; down: re-add + owner backfill)                                                                                                    |
| `server/src/schema/revert-to-immich.spec.ts`                                      | Step-8 DELETE block gains the new migration name (test enforces)                                                                                           |
| `scripts/revert-to-immich.sql`                                                    | Step-8 `kysely_migrations` DELETE block gains the new migration name                                                                                       |
| New unit test (e.g. `server/src/utils/favorite-grep-gate.spec.ts`)                | The grep gate                                                                                                                                              |
| `server/src/queries/*`                                                            | Regenerated                                                                                                                                                |
| Medium/unit fallout                                                               | Whatever tsc flags after the field removal (convert or delete, never re-add)                                                                               |

---

### Task 1: Owner-overlay for the plugin projection + the grep gate (red)

**Files:**

- Create: `server/src/utils/favorite-grep-gate.spec.ts`
- Modify: `server/src/utils/favorite.ts`, `server/src/database.ts:451`, `server/src/repositories/asset-job.repository.ts:151`, `server/src/services/workflow-execution.service.ts:331-335` (comment)

**Interfaces:**

- Produces: `favoriteExistsForOwner(eb: ExpressionBuilder<DB, keyof DB>, assetIdRef = 'asset.id', ownerIdRef = 'asset.ownerId'): AliasableExpression<SqlBool>` — same shape as `favoriteExistsFor` but `whereRef`-correlated to the owner column instead of a bound uuid. `workflowAssetV1.isFavorite` unchanged in shape and meaning.

- [ ] **Step 1: Write the grep gate (red).** A unit test that reads `server/src/**/*.ts` (exclude `*.spec.ts`, `schema/migrations*/`, and this test itself) and asserts NO match of `asset.isFavorite` / `asset."isFavorite"` / `'asset.isFavorite'` **outside comment lines** (strip `//` and `*`-prefixed lines before matching; person-favorite identifiers like `person.isFavorite`/`isFavorite:` object keys don't match these patterns — the gate targets the raw asset-column reference only). Red now: `database.ts:451` matches.
- [ ] **Step 2: Write the failing behavior test.** In the medium spec covering the workflow asset projection (find via `grep -rln "workflowAssetV1\|getForWorkflow\|asset-job" server/test/medium` — the workflow-core-plugin medium spec is the known end-to-end consumer): seed owner favorite via `asset_favorite` ONLY (raw column stays false), assert the projection reports `isFavorite: true`; seed a NON-owner favorite on another asset, assert projection `false`. Red: the projection still reads the raw column.
- [ ] **Step 3: Implement.** Add `favoriteExistsForOwner` to `favorite.ts` (mirror the existing helper's doc-comment style, explain the owner-semantics decision for background/plugin contexts). Remove `'asset.isFavorite'` from `columns.asset`; in `asset-job.repository.ts:151` add `.select((eb) => favoriteExistsForOwner(eb).as('isFavorite'))`. Update the `workflow-execution.service.ts:331-335` comment (the mapping code at `:351` keeps working — the query still emits `isFavorite`).
- [ ] **Step 4: Green.** Grep gate green; the medium projection tests green; `pnpm exec vitest run --config test/vitest.config.mjs` full unit; targeted medium: the workflow-core-plugin spec (memory: it is the ONLY suite that catches BaseService/positional regressions — run it explicitly).
- [ ] **Step 5: Style + commit.** `feat(favorites): resolve the plugin-facing favorite from the owner overlay (#763)`

---

### Task 2: The drop

**Files:**

- Create: `server/src/schema/migrations-gallery/1784100000000-DropAssetIsFavoriteColumn.ts`
- Modify: `server/src/schema/tables/asset.table.ts` (remove the field), `scripts/revert-to-immich.sql` (step-8 DELETE block), `server/src/schema/revert-to-immich.spec.ts` (expected-migrations list)
- Modify: whatever `tsc --noEmit` flags after the field removal

- [ ] **Step 1: Red.** Run `pnpm exec vitest run --config test/vitest.config.mjs src/schema/revert-to-immich.spec.ts` after creating the migration file but before touching the script — the step-8 test goes red for the missing DELETE entry. Fix the script; green.
- [ ] **Step 2: Migration.** `up`: `ALTER TABLE "asset" DROP COLUMN "isFavorite"`. `down`: `ADD COLUMN "isFavorite" boolean NOT NULL DEFAULT false` + `UPDATE asset SET "isFavorite" = true FROM asset_favorite f WHERE f."assetId" = asset.id AND f."userId" = asset."ownerId"` (camelCase identifiers double-quoted). Mirror the file style of `1784000000000-AddAssetFavoriteTables.ts`.
- [ ] **Step 3: Field removal + fallout.** Remove the column from `asset.table.ts`; run `pnpm exec tsc --noEmit` and fix every error by overlay conversion or dead-code deletion (each fixed site listed in the report). Factories/test fixtures that seeded the raw column switch to `asset_favorite` inserts.
- [ ] **Step 4: Post-drop suites.** Full unit; medium: the favorite suites (`asset-favorite.repository.spec.ts`, `favorite-cross-scope.spec.ts`, `test/medium/specs/sync` directory, the workflow-core-plugin spec) — all against the post-drop schema (testcontainers apply all migrations including the new drop).
- [ ] **Step 5: Style + commit.** `feat(favorites): drop the legacy asset.isFavorite column — overlay is the single source of truth (#763)`

---

### Task 3: Snapshots + full slice gate + push

- [ ] **Step 1: Snapshot regen** exactly per the slice-6 Task-3 flow (fresh container :5439 → `pnpm migrations:run` → `pnpm build` → `DB_URL=... node ./dist/bin/sync-sql.js` → `git diff --stat server/src/queries` scoped to favorite/column-related changes only → commit `chore(sql): regenerate snapshots post column drop (#763)` → remove container).
- [ ] **Step 2: Gate.** Full server unit; full `test/medium/specs/sync` + the favorite medium suites; `revert-to-immich.spec.ts`; e2e `asset-favorite`, `timeline`, `gallery-map`, `map`, `search`, `shared-space-album`, `asset`, `asset-copy`, `duplicate-favorite` files; grep gate green; web unchanged (no web edits this slice) — run `cd web && pnpm check:typescript` once anyway (SDK shape unchanged).
- [ ] **Step 3: Push.** `git push`
