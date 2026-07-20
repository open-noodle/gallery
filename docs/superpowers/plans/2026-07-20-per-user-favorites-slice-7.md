# Per-user favorites — Slice 7 (secondary writes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three remaining `asset.isFavorite` **write/read** sites — upload, copy, duplicate-merge — onto the `asset_favorite` overlay, so nothing depends on the column and slice 3 can drop it safely.

**Architecture:** Each site writes overlay rows for the correct user instead of setting a column. Upload → the uploader (always the owner). Copy → the acting user only. Duplicate-merge → a per-user union of all source assets' rows onto the keeper, performed **before** the sources are deleted and CASCADE removes them.

**Tech Stack:** NestJS 11, Kysely, Vitest (unit + medium), e2e (vitest).

**Spec:** `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` slice 7. Edge cases E14, E19, E20, E21.

## Why this runs BEFORE slice 3

The spec originally ordered this slice after the column drop. That was wrong. Three sites still
touch the raw column and would break the moment slice 3 drops it:

- `server/src/services/asset-media.service.ts:352` — `isFavorite: dto.isFavorite` in the asset create
- `server/src/services/asset.service.ts:557` — `assetRepository.update({ id: targetId, isFavorite: sourceAsset.isFavorite })`
- `server/src/services/duplicate.service.ts:308` — `response.assetUpdate.isFavorite = assets.some((asset) => asset.isFavorite)`

The asymmetry is **already live and visible**: slice 1b made statistics read the overlay while
upload still writes the column, so `GET /assets/statistics?isFavorite` returns zero for a
freshly-uploaded favorited asset. That is currently **3 failing assertions in
`e2e/src/specs/server/api/asset.e2e-spec.ts`** — they are this slice's RED, not a pre-existing flake.

## Global Constraints

- **NEVER `git stash` / `git stash pop`.** The stash stack is SHARED across worktrees and concurrent
  sessions; a bare pop can restore someone else's work. Write the test before the implementation to
  get RED — that is what TDD ordering is for. Use a temporary WIP commit if you must set work aside.
- **NEVER `make sql` / `node dist/bin/sync-sql.js`.** It truncates all 38 files in
  `server/src/queries/` _before_ connecting and hangs if the DB is unreachable. It has destroyed
  that directory twice already. Report stale/missing snapshots.
- Scoped test commands (`pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>` both
  silently DROP the path filter):
  - unit: `cd server && npx vitest --config test/vitest.config.mjs run <path>`
  - medium: `cd server && npx vitest --config test/vitest.config.medium.mjs run <path> --maxWorkers=2`
  - e2e: `cd e2e && npx vitest --config vitest.config.ts run <path>`
- Run medium with `--maxWorkers=2` — default parallelism exhausts the PG pool.
- No relative imports in `server/`; `src/` alias. Prettier 120 cols. eslint `--max-warnings 0`.
- No `Co-Authored-By` / `Generated-with` trailers.
- `asset.isFavorite` the column must still EXIST at the end of this slice — this slice stops
  _using_ it. Slice 3 drops it.
- Do not touch web, mobile, `sync.repository.ts`, or the `timeline.service.ts` guards.

## Known baselines

- unit **5105 passed / 9 skipped**; medium **137 files / 1983 passed** at `--maxWorkers=2`.
- **Three known pre-existing flakes**, all one root cause — assertions depending on the ordering of
  two `immich_uuid_v7()` values generated in the same millisecond: `sync-partner.spec.ts`,
  `sync-album-user.spec.ts`, `library-user-migration.spec.ts`. Re-run in isolation to confirm;
  do not fix here. **Any other failure is yours.**
- Denials in this codebase surface as **400** (`BadRequestException` from `requireAccess`), not 403.

---

### Task 1: Upload and copy

**Files:**

- Modify: `server/src/services/asset-media.service.ts:352`
- Modify: `server/src/services/asset.service.ts:557`
- Test: `e2e/src/specs/server/api/asset.e2e-spec.ts` (existing, currently 3 red),
  `e2e/src/specs/server/api/asset-copy.e2e-spec.ts:164-203`

**Interfaces:**

- Consumes: `AssetFavoriteRepository.addAll(userId, assetIds)` (slice 2).
- Produces: upload and copy no longer reference the column. Slice 3 depends on this.

- [ ] **Step 1: Confirm the existing RED**

```bash
cd e2e && npx vitest --config vitest.config.ts run src/specs/server/api/asset.e2e-spec.ts
```

Expected: 3 failures around `GET /assets/statistics?isFavorite`. **Record the exact names.** These
are the pre-existing red this slice fixes — do not skip this step, it is the proof the fix worked.

- [ ] **Step 2: Add the copy test**

In `asset-copy.e2e-spec.ts`, alongside the existing copy-favorite cases at `:164-203`:

```
- Given user A favorited source asset S, When A copies S with { favorite: true },
  Then A has an overlay row for the TARGET asset                            (E20)
- Given user B ALSO favorited S, When A copies S, Then B does NOT get a row
  for the target — copy carries the ACTING user's favorite only             (E20)
- Given { favorite: false }, When A copies S, Then no overlay row is created
```

Run it; expect red.

- [ ] **Step 3: Convert upload**

`asset-media.service.ts:352` — remove `isFavorite: dto.isFavorite` from the create payload. After
the asset row is created, if `dto.isFavorite` is true, call
`this.assetFavoriteRepository.addAll(auth.user.id, [asset.id])`.

The uploader is always the owner, so this is behaviourally identical to today for the uploader
(E19). Locate the create call and the surrounding transaction, if any — if the create runs inside a
transaction, the favorite insert must join it or run after commit; do not leave a partial state on
failure. **Report which you chose and why.**

- [ ] **Step 4: Convert copy**

`asset.service.ts:557` — replace the column update with an overlay insert for the **acting user**:

```ts
if (favorite) {
  await this.assetFavoriteRepository.addAll(auth.user.id, [targetId]);
}
```

Note this is a semantic sharpening, not a translation: the old code copied the _source asset's
global_ flag; the new code copies the _acting user's_ favorite. Those differ only when the actor is
not the owner — which the old model could not express. Verify `auth` is in scope at that call site;
if not, thread it.

- [ ] **Step 5: Run to verify green**

```bash
cd e2e && npx vitest --config vitest.config.ts run src/specs/server/api/asset.e2e-spec.ts src/specs/server/api/asset-copy.e2e-spec.ts
```

Expected: the 3 statistics failures from Step 1 now pass, and the new copy cases pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(favorites): upload and copy write overlay rows (#763)"
```

---

### Task 2: Duplicate-merge

**Files:**

- Modify: `server/src/services/duplicate.service.ts:308` (and the `isFavorite` field on the options type at `:17`)
- Test: `e2e/src/api/specs/duplicate.e2e-spec.ts`, `server/src/services/duplicate.service.spec.ts`

**Interfaces:**

- Consumes: `AssetFavoriteRepository`.
- Produces: merge preserves every user's favorites. Nothing later depends on this.

- [ ] **Step 1: Write the failing test**

```
- Given duplicate sources S1 and S2 (same owner — duplicates are owner-scoped),
  and user A favorited S1 while user B favorited S2,
  When the duplicates are merged onto keeper K,
  Then A has an overlay row for K AND B has an overlay row for K            (E21)
- Given the same user favorited BOTH S1 and S2,
  Then exactly ONE row for K (dedup, no PK violation)                       (E8/E21)
- Given no source was favorited, Then no rows are created
- Given a source was favorited by a user who has since lost access,
  Then the row still transfers (visibility is a read-time concern, §5.2)
```

The cross-user case is the important one: duplicate _detection_ is owner-scoped
(`duplicate.repository.ts:76` filters `asset.ownerId`), so all sources share an owner — but **other
users can have favorited those assets via space access**. The old boolean OR could not express
this; the overlay can.

- [ ] **Step 2: Run to verify red**

```bash
cd e2e && npx vitest --config vitest.config.ts run src/api/specs/duplicate.e2e-spec.ts
```

Verify that path exists first (`ls e2e/src/api/specs/ e2e/src/specs/server/api/`) — the duplicate
spec lives under a different directory from the others.

- [ ] **Step 3: Implement the union**

Replace the boolean OR at `:308` with a per-user union: collect the distinct `(userId)` set across
all source assets' `asset_favorite` rows, and insert one row per user for the keeper, with
`onConflict do nothing`. This must happen **before** the sources are deleted, because their rows
CASCADE away with them. Add a repository method if one is needed — e.g.
`mergeOnto(keeperId: string, sourceIds: string[]): Promise<void>` doing an
`INSERT … SELECT DISTINCT "userId" … FROM asset_favorite WHERE "assetId" = ANY(...)`. Prefer one
SQL statement over a read-then-write round trip.

- [ ] **Step 4: Run to verify green**

Same commands. Also run `server/src/services/duplicate.service.spec.ts`.

- [ ] **Step 5: Confirm trash still never touches favorites (E14)**

```bash
grep -rn "avorite" server/src/services/trash.service.ts server/src/repositories/trash.repository.ts
```

Expected: **zero matches**. Add an e2e assertion that a favorited asset trashed and then restored
retains the favorite. Trash is a soft delete, so no CASCADE fires; this test locks that in.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(favorites): merge duplicates with a per-user favorite union (#763)"
```

---

### Task 3: Slice-7 verification gate — the pre-slice-3 readiness check

- [ ] **Step 1:** `cd server && npx vitest --config test/vitest.config.mjs run` → ≥5105 passed
- [ ] **Step 2:** `cd server && npx vitest --config test/vitest.config.medium.mjs run --maxWorkers=2` → 137 files; only the three known flakes
- [ ] **Step 3:** `cd server && npx tsc --noEmit && pnpm lint && npx prettier --check "src/**/*.ts"`
- [ ] **Step 4:** `cd e2e && pnpm test` — the FULL API suite must be green. Slice 3 is irreversible; this is the last gate before it.
- [ ] **Step 5: The readiness check — this is the point of the slice**

```bash
grep -rn '"isFavorite"\|\.isFavorite' server/src --include=*.ts \
  | grep -v 'person\|isFavoriteForUser\|asset_favorite\|migrations\|dto\|spec'
```

Every remaining hit must be either a DTO field, a person favorite, or the schema definition
itself. **Any service or repository still reading/writing `asset.isFavorite` means slice 3 will
break the build.** List every remaining hit in the report with a one-line justification.

- [ ] **Step 6:** `git push`

---

## Self-Review

**Spec coverage.** E19 → Task 1 Step 3. E20 → Task 1 Step 2 (including the cross-user negative).
E21 → Task 2 Step 1 (including the dedup and lost-access cases). E14 → Task 2 Step 5.

**The real deliverable is Task 3 Step 5.** This slice exists to make slice 3 safe, so its gate is a
grep proving nothing depends on the column — not merely that the tests pass. Tests passing while a
straggler write site remains is exactly the state that breaks the irreversible slice.

**Semantic sharpening, flagged deliberately.** Copy previously carried the _source asset's global_
flag; it now carries the _acting user's_ favorite. These differ only when the actor is not the
owner, a case the old model could not represent. Called out in Task 1 Step 4 so it reads as
intentional in review rather than as a translation error.

**Placeholder scan.** No TBD/TODO. Two steps require verifying a path or scope before editing
(`duplicate.e2e-spec.ts` location, `auth` in scope at the copy site) rather than assuming.

**Type consistency.** `addAll(userId, assetIds)` matches slice 2's repository. Any new
`mergeOnto(keeperId, sourceIds)` is named once and used once.
