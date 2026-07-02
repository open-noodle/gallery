# Slice 17 — LOW#2 + LOW#15: unique migration timestamp

> **DECISION UPDATE (guard-only, no rename).** The original plan below renamed
> `1778800000000-ReconcileFaceIdentityIndexOverrides.ts` → `1778900000000-…`. On review this
> was rejected: the collision is **benign** (distinct filenames apply in deterministic order —
> nothing is clobbered), and renaming a migration on this continuously-deployed fork risks
> **bricking staging / RC / personal-test-clone DBs** — Kysely hard-fails on boot when a
> migration recorded in the DB has no matching file (`#ensureNoMissingMigrations`). So the
> rename was reverted; the `1778800000000` collision is **kept and grandfathered** alongside
> the two other pre-existing benign collisions in the guard. The delivered value is the guard
> (`tools/upstream-preflight/src/migration-timestamps.spec.ts`), which fails CI on any *new*
> collision. The RED/GREEN below reflects the abandoned rename approach; the shipped guard
> asserts "no NEW collision beyond the documented baseline" instead.

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 17"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#2 / LOW#15
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

`ls server/src/schema/migrations-gallery/` confirms exactly one collision: two files
share the timestamp prefix `1778800000000`:

- `1778800000000-ReconcileFaceIdentityIndexOverrides.ts` (single commit `e0642a3fd8
  fix(server): reconcile face identity index overrides` — recent, part of this active
  rebase branch, not yet merged/released, so no staging/RC DB can have recorded a
  migration name under the old timestamp; safe to rename outright, no coordination
  needed).
- `1778800000000-TrimSpacePersonNameIndex.ts`.

No other filename in `server/src/schema/migrations-gallery/` collides with itself or
with anything under `server/src/schema/migrations/` (upstream). The nearest upstream
neighbors bracketing this timestamp are `1778614946174-UpdateWorkflowTables.ts` (below)
and `1779806699547-AddPluginTemplates.ts` (above) — comfortable room either side.

**Migration file shape — no class name exists.** Both colliding files (and every file
in `migrations-gallery/`) are plain Kysely migration modules — `export async function
up(db)` / `down(db)` — not TypeORM-style classes. Confirmed via
`kysely/dist/esm/migration/file-migration-provider.js`: `FileMigrationProvider` keys
each migration by `fileName.substring(0, fileName.lastIndexOf('.'))` (the filename minus
extension) and `Migrator.getMigrations()` sorts those keys with a plain `.sort()`
(alphabetical/lexicographic — which for same-length numeric-prefixed names is also
numeric order). So:

- The spec's "update the class name suffix if convention requires" does not apply here
  — there is no class to rename, only the filename.
- Current apply order between the two colliders is **implementation-defined by string
  sort**, not by insertion or coincidence: `"...-Reconcile..."` (`R`) sorts before
  `"...-Trim..."` (`T`), so today `ReconcileFaceIdentityIndexOverrides` runs *before*
  `TrimSpacePersonNameIndex`.
- The two migrations touch disjoint indexes (Reconcile: `face_identity`, `person`,
  `asset_face`, and two `shared_space_person` indexes unrelated to name-sorting; Trim:
  only `shared_space_person_space_name_idx`), so there is no functional dependency
  either direction — reordering them is safe.

**Plan:** per the spec, give `ReconcileFaceIdentityIndexOverrides` a new timestamp
strictly greater than `1778800000000` (so it unambiguously sorts after
`TrimSpacePersonNameIndex` going forward — a deliberate, safe pin rather than leaving
tiebreak-by-name as the only thing preventing a future collision), using a round number
per `CLAUDE.md`'s migration-naming convention (`1775000000000`-style). Chosen value:
**`1778900000000`** — round, greater than both current colliders, does not collide with
anything in either migration directory.

---

## Step B — RED guard

New file: `tools/upstream-preflight/src/migration-timestamps.spec.ts`.

Follows the existing repo-root-relative-fs convention used by
`tools/upstream-preflight/src/mobile-nav.spec.ts` (`path.resolve(process.cwd(),
'../../<dir>')`, since vitest runs from `tools/upstream-preflight`).

- Reads every `*.ts` file in `server/src/schema/migrations-gallery/` (excluding
  `.spec.ts`) and `server/src/schema/migrations/`, parses the leading numeric timestamp
  from each filename (`/^(\d+)-/`).
- Asserts all `migrations-gallery/` timestamps are unique (`Set` size === array length),
  reporting the offending duplicate value and both filenames on failure.
- Bonus assertion: no `migrations-gallery/` timestamp collides with any
  `migrations/` (upstream) timestamp.

**Expected RED:** `1778800000000` appears twice in `migrations-gallery/`
(`ReconcileFaceIdentityIndexOverrides` + `TrimSpacePersonNameIndex`).

**Command:** `cd tools/upstream-preflight && npx vitest run src/migration-timestamps.spec.ts`

---

## Step C — GREEN

`mv server/src/schema/migrations-gallery/1778800000000-ReconcileFaceIdentityIndexOverrides.ts
server/src/schema/migrations-gallery/1778900000000-ReconcileFaceIdentityIndexOverrides.ts`
(plain filesystem `mv`, per parallel-mode rules — no `git mv`, no git writes; the
orchestrator will stage/detect the rename later). File contents unchanged (no class name
to update per Step A).

Re-run the guard → green (no duplicate timestamps in either directory).

---

## Edge cases covered

- New timestamp collides with nothing in `migrations-gallery/` or `migrations/`.
- Ordering preserved/pinned: `1778900000000 > 1778800000000`, so Reconcile still applies
  after `AddSharedSpaceFaceMatchBackfillTarget` (`1778700000000`) and now deterministically
  after `TrimSpacePersonNameIndex` too (previously only accidentally-before via string
  sort tiebreak).
- No live DB has recorded this migration under its old timestamp yet (single-commit,
  unreleased on this branch) — no reconciliation/alias needed (contrast with Slice 18's
  `ChangeDurationToInteger` compatibility-alias case, which *is* already deployed).

## GREEN commands

```
cd tools/upstream-preflight && npx vitest run src/migration-timestamps.spec.ts
```

(File-scoped only per parallel-mode rules — no whole-project `pnpm check`/`pnpm test`.)

## Commit

`fix(server): unique timestamp for ReconcileFaceIdentityIndexOverrides migration (LOW #2/#15)`

(Left uncommitted per orchestrator instructions — this line records the intended message
for the orchestrator's commit.)
