# Upstream Sync Report — 2026-08-26 (batches 167–170)

## Summary

- **Upstream commits pulled**: 6 (`0f821a7338d..093f5c070ad`)
- **Batches**: 167, 168, 169, 170
- **Conflicts resolved**: 0 — every batch replayed cleanly
- **Fork sync**: **no-op**. `origin/main` is still `bcb635ae28f`, unchanged since the last cycle.
- **Risk level**: MEDIUM (one architectural import, one CI-infrastructure repair)
- **Recommendation**: PROCEED
- **Landed on `main`**: NO — no upstream tag; standing rule applies.

The batch is dominated by one upstream feature: a **migration `ORDER` manifest** plus a CI gate that
verifies it. Two ML security lockfile bumps ride along.

## Incoming Upstream Changes

| SHA           | Summary                                                    | Area        | Risk to Fork | Notes                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------- | ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `13562d80a47` | chore: bump sql-tools (immich-31000)                       | server/deps | MEDIUM       | `@immich/sql-tools` ^0.5.1 → ^0.6.3; adds `server/src/schema/migrations/ORDER` (96 entries); `server/Dockerfile` sharp build gains `--config.verify-deps-before-run=false` |
| `f2645738470` | point the migrations mise task at sql-tools (immich-30996) | server      | LOW          | `[tasks.migrations]` now shells `sql-tools` instead of `node ./dist/bin/migrations.js`                                                                                     |
| `a8c79469e5a` | document and guard ORDER maintenance (immich-30997)        | server/CI   | LOW          | Adds `migrations:sync-order` / `migrations:verify-order` scripts and a `verify-order` step to `[tasks.checklist]`                                                          |
| `291ccdae95a` | verify migration ORDER on every PR (immich-30998)          | CI          | HIGH         | New `migration-order.yml`; depends on upstream-only `PUSH_O_MATIC_APP_*` secrets                                                                                           |
| `ef72f1ec5b9` | pillow 12.2.0 → 12.3.0 [security] (immich-30084)           | ML          | LOW          | `uv.lock` only                                                                                                                                                             |
| `093f5c070ad` | pydantic-settings → 2.15.0 [security] (immich-29252)       | ML          | LOW          | `uv.lock` only. The lock resolves **2.15.0**, higher than the 2.14.2 in the subject                                                                                        |

## Product-Direction Gate

The gate **fired** on the ORDER manifest: it formalises migration ordering, an architecture the fork
extends with its dual `migrations/` + `migrations-gallery/` layout. It was then **cleared** on evidence,
not on the clean rebase:

1. **ORDER is never consulted at runtime.** Unpacking `@immich/sql-tools@0.6.3` shows `readOrder` reached
   only from `syncOrder` and `verifyOrder`; `migrations run` still builds a Kysely `FileMigrationProvider`
   over `migrationFolder`. It is a source manifest plus a lint, nothing more.
2. **The fork already satisfies it.** `server/src/schema/migrations/` is set-identical to ORDER's 96
   entries and ORDER is plain-sorted, so `verify-order` passes unmodified.
3. **ORDER never reaches `dist/`.** `server/nest-cli.json` declares no `assets`, so neither the postbuild
   `sync-gallery-migrations.mjs` copy nor `CompositeMigrationProvider` sees it. Verified after a real
   build: `dist/schema/migrations/ORDER` does not exist.
4. **The fork is structurally immune to the bug ORDER guards.** Upstream runs
   `allowUnorderedMigrations: this.configRepository.isDev()`; the fork runs it `true` unconditionally for
   the Immich→Gallery path. "Server won't start if migrations ran out of order" is an upstream-only
   failure mode.

No quarantine was needed and `upstreamTargetHead` advanced to `093f5c070ad`.

## Conflict Resolutions

None — all four batches replayed with zero conflicts. Because that is exactly the shape in which
zero-conflict semantic breaks hide, the following were checked explicitly rather than inferred:

- `server/package.json` — fork's three `@aws-sdk/*` dependencies sit directly above the
  `@immich/sql-tools` line upstream bumped. Both survived: AWS deps present, sql-tools at `^0.6.3`,
  fork's `postbuild` hook intact.
- `server/mise.toml` — fork's `[tasks.build]` addition (`node bin/sync-gallery-migrations.mjs`) intact
  alongside upstream's rewritten `[tasks.migrations]`.
- `pnpm-lock.yaml` — `version: link:` count unchanged at **11** (matches the pre-batch tip; the skill's
  "expect 9" is stale, the fork has since gained workspace packages), zero `version: file:packages/`
  entries, `@aws-sdk/client-s3` still resolved. `jiti` and `@immich/sql-tools` resolution match
  `upstream/main` exactly.
- Whole-cycle delta is exactly the six commits' content — 9 files, no fork file touched incidentally.

## Fork-Side Work: the ORDER gate (commit `80e4e8c7db5`)

Decision taken at Checkpoint 1: **adapt the workflow and extend the manifest to the fork's own
migrations.**

### 1. `migration-order.yml` de-coupled from upstream infrastructure

Upstream's workflow mints a token via `immich-app/devtools/actions/create-workflow-token` using
`secrets.PUSH_O_MATIC_APP_CLIENT_ID` / `_KEY`. Those secrets **do not exist on this repo** (verified
against the live secret list), so as-imported the job would have failed at its first step on every PR
and every push to `main`. The fork's own `make ci-invariants-check` independently caught this —
rule `no-push-o-matic` forbids both patterns.

Resolution: dropped the token step. Checkout uses default credentials and `use-mise` takes
`${{ github.token }}`, matching every other fork workflow.

### 2. ORDER extended to `migrations-gallery/`

Upstream's manifest covers only `migrations/`, leaving the fork's **61** gallery migrations unguarded.
Added:

- `server/src/schema/migrations-gallery/ORDER` (61 entries, generated with `sql-tools --source-folder`)
- a `[tasks."migrations-gallery"]` mise task
- `migrations:sync-order:gallery` / `migrations:verify-order:gallery` package scripts
- a second workflow step and a `[tasks.checklist]` entry

**The gallery folder is checked for consistency only, deliberately NOT append-only.** Gallery migrations
use hand-picked round timestamps and the server runs `allowUnorderedMigrations: true`, so a feature
branch landing with a lower timestamp than one merged meanwhile is safe here — unlike upstream, which
permits unordered migrations in dev only. Enforcing append-only would red legitimate fork PRs for a
condition the fork tolerates by design. Consistency alone still forces two branches that both add a
gallery migration to conflict in git on ORDER's tail, which is upstream's stated reason for the file.
Tightening this later is a one-flag change.

Both checks were **proven red as well as green**, rather than assumed:

| Check          | Condition                     | Exit |
| -------------- | ----------------------------- | ---- |
| upstream ORDER | good baseline                 | 0    |
| upstream ORDER | doctored append-only baseline | 1    |
| gallery ORDER  | consistent                    | 0    |
| gallery ORDER  | one entry removed             | 1    |
| gallery ORDER  | restored                      | 0    |

## Per-Batch Detectors

| Detector                                                                 | Result                                      |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| Silent-noop (literals upstream deletes vs fork literal-matching tooling) | clean                                       |
| i18n branding-override gap                                               | N/A — batch changed no `i18n/` file         |
| Shape I (upstream adds a path the fork once owned)                       | clean — 0 fork commits on either added path |
| `revert-to-immich.sql` migration coverage (step 7i)                      | complete — batch adds no migration          |
| Mobile Drift                                                             | consistent; batch touches no `mobile/` file |

## Fork Feature Verification

| Feature           | Status | Notes                                                                           |
| ----------------- | ------ | ------------------------------------------------------------------------------- |
| Shared Spaces     | OK     | 61 gallery migrations present; audit "Gallery Migration Count 61 (expected 61)" |
| Storage Migration | OK     | fork-owned file survival green                                                  |
| Pet Detection     | OK     | ML suite green (116 passed)                                                     |
| Image Editing     | OK     | untouched by batch                                                              |
| Branding          | OK     | no upstream literal removed that branding rewrites                              |
| S3 backends       | OK     | `@aws-sdk/*` deps survived the `package.json` merge                             |

## CI and Infrastructure Verification

| Check                                | Status | Notes                                                        |
| ------------------------------------ | ------ | ------------------------------------------------------------ |
| Workflow collisions                  | OK     | `migration-order.yml` is new; adapted, not imported verbatim |
| Docker image references              | OK     | `ci-invariants-check` green                                  |
| No upstream PUSH_O_MATIC dependency  | OK     | failed on import, fixed, now green                           |
| Fork CI modifications intact         | OK     | `fork-patches-check` green (`@immich/ui` patch consistent)   |
| `.github` formatting (separate gate) | OK     | `npx prettier --check .` clean                               |
| Commit autolinks                     | OK     | 1345 messages scanned, fork PR ceiling 1029, none foreign    |

## Database Migration Analysis

- **New upstream migrations**: none. `migrations/` holds the same 96 files before and after.
- **Timestamp collisions**: none (`Migration Timestamp Collision Check` green).
- **Postbuild merge**: intact — build reports
  `Synced 61 Gallery migrations into dist/schema/migrations; removed 0 stale files; wrote 1 compatibility aliases.`
- **`CompositeMigrationProvider`**: unchanged and unaffected; ORDER is not compiled into `dist`.

### Local-only observation (not a branch defect)

An incremental local `dist/` carries a stale `1784664555996-AlbumDescriptionNullable.js` from a
2026-07-31 build, left behind when upstream re-timestamped that migration to `1784986754474`.
`server/nest-cli.json` sets `deleteOutDir: false` and `sync-gallery-migrations.mjs` prunes only stale
_gallery_ copies, so nothing removes it locally. `dist/` is gitignored and Docker builds start from a
clean context, so it never ships — but a developer running migrations off a long-lived local `dist`
would apply that migration under both names. Worth a cleanup step if it recurs.

## Mobile Drift Migration Analysis

Not applicable — the batch touches no `mobile/` file. `make mobile-drift-rebase-check BATCH=170` green.

## Pattern Propagation

One new upstream pattern: the ORDER manifest. **Propagated in the same cycle** (gallery folder now has
its own manifest and CI step) rather than deferred — see the fork-side section above.

## Local CI Verification

| Check                                             | Status | Notes                                                            |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)  | PASS   | 61 gallery migrations + 1 compatibility alias                    |
| `server pnpm check` (tsc)                         | PASS   |                                                                  |
| `server pnpm lint`                                | PASS   |                                                                  |
| `server pnpm format`                              | PASS   | eslint green ≠ prettier green, both run                          |
| `web check:typescript`                            | PASS   |                                                                  |
| `web check:svelte`                                | PASS   | 627 files, 0 errors (not 0 files)                                |
| `web pnpm format`                                 | PASS   |                                                                  |
| `e2e pnpm check`                                  | PASS   | also clears a stale IDE diagnostic on `memory-index.e2e-spec.ts` |
| `.github prettier --check`                        | PASS   | separate package and CI job                                      |
| Server unit tests                                 | PASS   | 6062 passed, 12 skipped                                          |
| Web unit tests                                    | PASS   | 5953 passed, 2 skipped, 8 todo                                   |
| ML `uv sync --locked --extra cpu`                 | PASS   | applies exactly pillow 12.3.0 + pydantic-settings 2.15.0         |
| ML `ruff check` / `ruff format` / `mypy --strict` | PASS   | scoped to `immich_ml/` as CI defines                             |
| ML `pytest`                                       | PASS   | 116 passed, 3 skipped                                            |
| Mobile gates                                      | N/A    | batch touches no `mobile/` file                                  |

`uv sync --locked --all-extras` fails on this machine because `onnxruntime-gpu` publishes no macOS
arm64 wheel. That is an environment limitation, not a lockfile defect; the CPU extra CI uses syncs
cleanly. Separately, `ruff format --check .` at the ML repo root flags `test_main.py`, which is
**pre-existing** (byte-identical to the pre-batch tip, no ruff pin changed) and outside the
`immich_ml/`-scoped gate CI actually runs.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-170`
- **Commit validated**: `80154b8eb93` — **10/10 workflows green, all first pass**, no re-runs, no flakes.
- **Final tip**: `77b4afeca3a` adds only `.github/workflows/migration-order.yml`. `test.yml` was
  re-dispatched on it because that workflow's `.github Files Formatting` job is gated on `.github/**`.

| Workflow                                  | Status | Run                      |
| ----------------------------------------- | ------ | ------------------------ |
| `test.yml`                                | GREEN  | 32998304410 (20/20 jobs) |
| `docker.yml`                              | GREEN  | 32998311670              |
| `static_analysis.yml`                     | GREEN  | 32998319168              |
| `gallery-build-mobile.yml`                | GREEN  | 32998369052              |
| `gallery-rebase-smoke.yml`                | GREEN  | 32998326326              |
| `storage-migration-tests.yml`             | GREEN  | 32998333592              |
| `storage-migration-e2e.yml`               | GREEN  | 32998361793              |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 32998340791              |
| `gallery-ml-smoke.yml`                    | GREEN  | 32998347947              |
| `gallery-mobile-smoke.yml`                | GREEN  | 32998354721              |

- **Failures fixed**: none — nothing went red.
- **Confirmed flakes**: none.

### The sql-tools bump was validated end to end, not assumed

`sql-tools` generates the schema from the fork's decorated tables, so a 0.5→0.6 behaviour change
would surface as schema drift rather than a type error. Two dispatched gates cover it:

- `test.yml` runs migration generation and `mise //:sql` against a real Postgres and fails if either
  produces a diff. Both clean.
- `gallery-revert-to-immich-validation` ran the full 4.5-minute boot cycle and emitted the genuine
  runtime notices — `pre/gallery/post: /api/server/ping OK`, `26 SharedSpace migration row(s)`,
  `post: no new schema drift compared to pre-phase baseline`, `revert-to-immich validation PASSED`.
  Checked against the known trap where a ~30s run dies on a Docker rate limit and echoes the
  workflow's own script with `${phase}` unexpanded — this run is the real form.

### Not exercised this cycle

`migration-order.yml` itself never ran: it triggers on `pull_request` / `push: main`, and
`workflow_dispatch` only works once the file exists on the default branch. Its two commands were
instead proven locally in both directions (see the fork-side section), and the guard was simulated
in all three baseline states. First real execution will be when the branch reaches `main`.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1347
- Commits behind upstream: 0
- Fork diff clean: YES
