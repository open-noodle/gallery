# Upstream Sync Report — 2026-08-08 (batches 64–67 + fork sync)

## Summary

- **Upstream commits pulled**: 4 (`a9a99cffbfc..1c5770601dc`, batches 64–67)
- **Fork commits synced**: 7 (`1d4a447ecde..64f520e2da0` — #940 #941 #942 #943 #957 #958 #884)
- **Conflicts resolved**: 1 (`server/test/medium.factory.ts`)
- **Risk level**: LOW
- **CI**: 10/10 GREEN first pass on `c70fe642025` (`test.yml` 21/21 jobs, 0 skipped)
- **Recommendation**: PROCEED

A **BOTH** cycle. It also closed out the previous cycle's loose end: batches 63–64 were rebased on
2026-08-06 but never got remote CI because of a GitHub Actions major outage. Actions is operational
again, so that state was re-validated first (see "Outage backfill" below) before this cycle's work
was layered on top.

Branch is **level with `upstream/main`** (`git rev-list --count HEAD..upstream/main` = 0) and remains
**off `main`** — the newest upstream tag is still `v3.1.0`, which is our base, so the standing
landing rule is not satisfied.

## Outage backfill — the 2026-08-06 runs did complete, and not all of them failed

The previous cycle recorded "all 10 dispatched workflows died in `Set up job`". That is **not** what
the completed runs show, and the correction matters because it changes how such a run set is read:

| Workflow                                                                                                         | 2026-08-06 result on `3447d8dc892` | Actual mechanism                                        |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Storage Migration E2E / Gallery Mobile Smoke / Gallery ML Smoke / Storage Migration Tests / Static Code Analysis | **success**                        | ran normally — the outage was partial                   |
| Docker                                                                                                           | failure                            | `Set up job` → `Failed to resolve action download info` |
| Test                                                                                                             | failure                            | `pre-job` **cancelled**, cascading 12 skips             |
| Gallery Build Mobile                                                                                             | failure                            | Android **succeeded**; only iOS cancelled               |
| Gallery Rebase Smoke                                                                                             | failure                            | died pulling images at `Start e2e stack`                |
| Gallery Revert-to-Immich Validation                                                                              | cancelled                          | queue timeout, empty `jobs` array                       |

So five of ten actually passed during the outage. Re-dispatching `test.yml` + `static_analysis.yml`
on the same tree (as `6b15cff86b0`, the b64 report commit amended with a docs-only edit) returned
**both green**, confirming no code defect was hiding behind the infrastructure noise.

**Lesson**: a partial-outage run set must be classified per run, not written off wholesale — and
"failure" on a build workflow can still mean half its matrix succeeded.

## Incoming Upstream Changes

| SHA           | Summary                                             | Area              | Risk to Fork | Notes                                             |
| ------------- | --------------------------------------------------- | ----------------- | ------------ | ------------------------------------------------- |
| `5ad1e4e0f7e` | fix: medium tests dependencies (#30612)             | server test infra | **MEDIUM**   | Retypes the medium harness; 4 fork-diverged files |
| `be5cc30f527` | chore(deps): prom/prometheus digest (#30535)        | docker            | LOW          | zero fork divergence                              |
| `51c2f214978` | chore(deps): grafana digest (#30534)                | docker            | LOW          | zero fork divergence                              |
| `1c5770601dc` | chore: asset debug action on bottom sheets (#30611) | mobile            | LOW          | zero fork divergence across all 7 touched files   |

### Per-file fork divergence (computed before rebasing)

This is what made the batch predictable rather than scary. Of the 12 files upstream touched, **8 had
zero fork divergence**, so three of the four commits could not conflict:

| File                                                             | Fork divergence |
| ---------------------------------------------------------------- | --------------- |
| `docker/docker-compose.prod.yml`                                 | 0               |
| 7 × `mobile/lib/presentation/widgets/bottom_sheet/*.widget.dart` | 0               |
| `server/src/services/base.service.ts`                            | 526 lines       |
| `server/src/types.ts`                                            | 268 lines       |
| `server/test/medium.factory.ts`                                  | 228 lines       |
| `server/test/medium/specs/workflow/workflow-core-plugin.spec.ts` | 33 lines        |

### Gates applied at Checkpoint 1

- **Per-batch product-direction gate: did NOT fire.** No commit changes where a feature is going —
  test-harness typing, two dependency digest bumps, and a developer debug affordance.
- **Zero-conflict literal-deletion detector: clean.** No URL/string literal upstream removed is still
  literal-matched by `branding/scripts/**`, `tools/**` or `.github/actions/**`.
- **Signature widening**: `BaseService.create` and `MediumTestContext` were retyped, but
  `ClassConstructor` is referenced in exactly one fork file (`base.service.ts`), so the blast radius
  was bounded and server-side only. No mobile hand-written fakes involved.
- **Migrations**: none — no server migration and no mobile Drift schema/`db.repository.dart` change.

### #30612 in detail (the one substantive commit)

Upstream tightened the medium-test harness so it is parameterised by the repository **constructor**
rather than the instance type:

- `BASE_SERVICE_DEPENDENCIES` gains `as const`
- `MediumTestOptions.mock/real` narrow to `(typeof BASE_SERVICE_DEPENDENCIES)[number]`
- `ClassConstructor<T>` is redefined as a conditional type; `ClassConstructorsToInstances` is added
- `BaseService.create` returns `InstanceType<T>`
- `ctx.videoStreamRepository` is added to the positional list

Note the last point: **the fork already had `ctx.videoStreamRepository`**, having previously been
bitten by the three-site rule. Upstream was fixing a bug the fork had independently fixed. The
three sites were re-verified after the rebase and are consistent:

```
BASE_SERVICE_DEPENDENCIES entries: 59
constructor params:                59
create() positional ctx.* entries: 58  (+1 LoggingRepository.create() = 59)
```

## Conflict Resolutions

### Conflict: `server/test/medium.factory.ts` (at fork commit #364, "shared-space photos on personal map")

- **Fork side**: inserts a `case MapRepository:` branch into `newRealRepository` so the fork's
  map medium specs can build a real `MapRepository`.
- **Upstream side**: rewrote the adjacent `case LoggingRepository:` branch and changed every branch's
  return to `... as InstanceType<T>` under the new precise typing.
- **Resolution**: reconstructed rather than marker-parsed. The fork commit's entire delta on this
  file is one additive block, so the resolution is upstream's new `LoggingRepository` branch plus the
  fork's `MapRepository` branch, restyled to the new `as InstanceType<T>` form.
- **Risk**: LOW.
- **Verification**: markers gone, brace/paren balance 0/0, file tail intact, imports present, and
  `git diff upstream/main HEAD -- server/test/medium.factory.ts | grep '^-[^-]'` is **empty** — the
  fork is purely additive in this file, so no upstream content was dropped.

## Pattern Propagation

Upstream refactors that left fork-only code behind, both **bundled** into this cycle:

| Refactor                                   | Old → New pattern                                             | Fork files affected                                            | Decision | Commit                          |
| ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------- | -------- | ------------------------------- |
| #30612 medium-harness generics             | `getMock<X, Mocked<X>>(X)` → `getMock(X)` (constructor-typed) | 10 fork-only medium specs, 63 call sites + `medium.factory.ts` | Bundled  | `d25d7e951fc`                   |
| #30611 `AssetDebugAction` on bottom sheets | debug action present on every multiselect sheet               | 2 fork-only Space sheets                                       | Bundled  | `3863d1f4eec` (+ `c70fe642025`) |

### #30612 propagation

`pnpm check` surfaced **64 errors** (63 × TS2344, 1 × TS2345), every one in fork-only test code —
upstream converted its own specs and could not convert ours. The 63 were a single uniform shape and
were converted mechanically; dropping the explicit type arguments is behaviour-preserving because
inference yields the same `Mocked<InstanceType<T>>`. Seven files were then left with an unused
`vitest` `Mocked` import, which the server's zero-warning ESLint policy rejects (prettier's
organize-imports did **not** strip them), so those were removed explicitly.

The single TS2345 is more interesting and is a genuine **zero-conflict semantic break**: the fork's
`MapRepository` registration passes the shared `Kysely<DB>`, but `MapRepository` declares
`Kysely<MapDB>` (`MapDB extends DB`, and Kysely is invariant in its schema parameter). The old
`ClassConstructor<any>` never type-checked constructor arguments; the tightened `new key(...)` does.
`MapDB` is not exported, so the fix references the constructor's own parameter type
(`ConstructorParameters<typeof MapRepository>[3]`) rather than widening anything.

### #30611 propagation

Upstream added `AssetDebugAction` to 8 of its 10 bottom sheets, leaving the fork's two
(`space_bottom_sheet.widget.dart`, `space_album_bottom_sheet.widget.dart`) as the only ones without
it. Maintainer decision: bundle.

The action **self-gates** — `create()` returns `null` unless the advanced-troubleshooting setting is
on _and_ exactly one asset is selected — so adding it does not widen the Space-album sheet's
deliberately reduced user-facing action set. That sheet's doc comment was updated to say so.

This did break three existing fork tests, and the failure is worth recording: adding the action made
the sheet read `settingsProvider`, whose real notifier builds a `SettingsService` over `StoreService`
— which needs a Drift-backed `init()` that this deliberately lightweight widget harness does not do.
All three threw `StoreService not initialized`. Rather than migrating the test to the much heavier
`PresentationContext`, the harness now overrides the notifier to serve `Setting` defaults;
`advancedTroubleshooting` defaults to `false`, which is precisely the state these reduced-action-set
assertions describe. The action's own gating remains covered by
`test/unit/presentation/actions/asset_debug_action_test.dart`.

## Fork Sync

`make upstream-sync-fork-main` cherry-picked all 7 commits with **zero conflicts**;
`git range-diff` reports all 7 as `=` (byte-equivalent to `origin/main`).

It then stopped at `fork-ownership-coverage-check`, as documented, with **two** hard errors:

1. `Template/Stack/noodle-gallery.yml` — the Portainer app-template stackfile from #942 landed at a
   **new fork-only top-level path** that no ownership glob covered. Confirmed fork-only (`upstream/main`
   has no `Template/` directory at all) and declared under `release-ci-and-infrastructure`
   `owned_paths` as `Template/**`.
2. `last_verified_fork_head` was still `88e715507c6` (#892), orphaned by later replays. Bumped to
   `origin/main` (`64f520e2da0`).

After both fixes: `Ownership manifest covers 3320 fork files`, and
`make upstream-sync-fork-main ROLLING_CONTINUE=1` finalised the sync (`Synced 7 fork commits`).

**Note for future cycles**: the first of these is a genuinely new class — previous occurrences of this
stop were only ever the stale cursor. A fork PR that introduces a new top-level directory will fail
ownership coverage even though nothing is wrong with the PR.

## Fork Feature Verification

| Feature                  | Status | Notes                                                                  |
| ------------------------ | ------ | ---------------------------------------------------------------------- |
| Shared Spaces            | OK     | #884 (Explore/Places space scoping) synced clean; Space sheets updated |
| Storage Migration        | OK     | untouched; suites dispatched                                           |
| Pet Detection            | OK     | untouched                                                              |
| Image Editing            | OK     | untouched                                                              |
| Branding                 | OK     | #957/#958 synced; literal detector clean; `Template/**` declared       |
| Google Photos Import     | OK     | untouched                                                              |
| Shared-space map markers | OK     | `MapRepository` medium registration preserved and now type-checked     |

## CI and Infrastructure Verification

| Check                               | Status | Notes                                             |
| ----------------------------------- | ------ | ------------------------------------------------- |
| Fork-Owned File Survival            | OK     | post-rebase audit                                 |
| Fork Extension Symbol Survival      | OK     | post-rebase audit                                 |
| Gallery Migration Count             | OK     | 49 (expected 49)                                  |
| Gallery Migration Filename Survival | OK     | post-rebase audit                                 |
| Migration Timestamp Collision Check | OK     | no collision                                      |
| Generated Artifact Review           | OK     | no upstream generated artifact needs review       |
| `ci-invariants-check`               | OK     | no-push-o-matic, gallery image names, docs-deploy |
| `fork-patches-check`                | OK     | `@immich/ui` patch metadata consistent            |
| `mobile-drift-rebase-check`         | OK     | schemaVersion, snapshots, Gallery callbacks       |
| `fork-ownership-coverage-check`     | OK     | after the two fixes above — 3320 files            |
| OpenAPI spec freshness              | OK     | `sync-open-api` regenerated → `open-api/` clean   |

## Database Migration Analysis

No upstream migrations in this batch and no fork migrations added. Gallery migration count unchanged
at **49**. `scripts/revert-to-immich.sql` therefore needs no new entries this cycle; the
`gallery-revert-to-immich-validation` workflow was dispatched to confirm rather than assumed.

## Mobile Drift Migration Analysis

No change. `mobile-drift-rebase-check` green: `schemaVersion`, snapshots and Gallery callbacks
consistent. No renumbering was required.

## Inconsistencies Found

None introduced by this cycle.

One item previously carried forward as an open gap was **retired as incorrect** while writing this
report: `branding/scripts/verify-mobile-assets.sh` was recorded as "reached by no workflow and no
aggregator". It **is** reached — `verify-branding.sh:461` invokes it, and
`gallery-branding-check.sh` runs `verify-branding.sh` in `test.yml`'s Test Branding job. So **all
eight `branding/scripts/*.sh` are wired**. The earlier note stopped one level too shallow in a
two-level call chain, which is the same mistake as the naive workflow grep it was warning about:

- The naive `grep -rq "$n" .github/workflows/` sweep yields five false positives because #928 moved
  invocation behind `gallery-branding-check.sh` — but grepping the aggregator alone is still not
  enough, because `verify-mobile-assets.sh` hangs off `verify-branding.sh`. Follow the whole chain.

### Severity of the new branding-i18n gate (clarified)

`verify-branding.sh` prints its findings as `WARN:` lines, which reads as advisory. It is not: each
one also sets `EXIT_CODE=1` and the script ends `exit $EXIT_CODE`, run under `set -euo pipefail` by
the aggregator. An un-overridden i18n key — including the #743 class ("key contains the upstream
name but has no override in `overrides-en.json`") introduced with the 56 new locale override files —
therefore **fails CI loudly** rather than slipping through. Corollary worth recording: do not run
`verify-branding.sh` directly against the source tree, since it verifies _applied_ branding and will
report dozens of bogus leaks on an unbranded checkout; use `gallery-branding-check.sh`, which copies
to a temp worktree, applies branding, then verifies.

## Local CI Verification

| Check                                        | Status | Notes                                                                 |
| -------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `server pnpm build` (+ migration sync)       | PASS   | Synced 49 migrations, 1 compatibility alias                           |
| `server pnpm check` (tsc)                    | PASS   | after the #30612 propagation (64 → 0 errors)                          |
| `server pnpm lint`                           | PASS   | zero warnings                                                         |
| `server pnpm format`                         | PASS   | prettier clean                                                        |
| `web check:typescript`                       | PASS   |                                                                       |
| `web check:svelte`                           | PASS   | 585 files, 0 errors (a real scan, not a 0-file no-op)                 |
| web eslint (`tscompat` off)                  | PASS   | 0 errors; 13 bogus unused-disable warnings, no `--max-warnings` in CI |
| Server unit tests                            | PASS   | 5270 passed, 14 skipped                                               |
| Web unit tests                               | PASS   | 4340 passed, 2 skipped, 8 todo                                        |
| Mobile `dart analyze --fatal-infos lib test` | PASS   | No issues found                                                       |
| Mobile `dart format` (CI scope, lib only)    | PASS   | 827 files, 0 changed                                                  |
| Mobile `flutter test`                        | PASS   | **3164 passed, 1 skipped** — identical to baseline                    |
| `mise.lock` / `pubspec` churn                | NONE   | checked after every local mise/flutter invocation                     |

Mobile gates were run on the pinned Flutter **3.44.8** (verified from `mobile/mise.toml` and
`mobile/pubspec.yaml`, binaries invoked directly), with the full codegen chain regenerated first —
Dart OpenAPI SDK, translations, keys, pigeon, `build_runner`, and `drift_dev schema generate` into
`test/drift/main/generated/`.

## Remote CI Verification

- **Test branch**: `rebase/upstream-b67`
- **Commits validated**: code at `c70fe642025`; the four wave-3 runs landed on `b7a3bf2f30a`, whose
  delta from `c70fe642025` is **this report file only** (276 lines, docs) — so all ten validated
  identical code. No SHA skew.
- **Baseline**: `rebase/upstream-b64` @ `6b15cff86b0` — Test **green**, Static Code Analysis **green**

**10 / 10 GREEN, first pass. Zero failed or cancelled jobs across all ten runs.**

| Workflow                                  | Status | Run         | Notes                                                                               |
| ----------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | 31248356837 | **21/21 jobs, 0 skipped**                                                           |
| `docker.yml`                              | GREEN  | 31248357963 | server/web/cli/ml images build                                                      |
| `static_analysis.yml`                     | GREEN  | 31248359033 | dart analyze + format + generated-file freshness                                    |
| `gallery-build-mobile.yml`                | GREEN  | 31248360129 | `environment=development` — Android **and** iOS both built                          |
| `gallery-rebase-smoke.yml`                | GREEN  | 31248382897 |                                                                                     |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 31248383704 | read past the coverage grep to `Post-phase drift (0 item(s))` → `validation PASSED` |
| `storage-migration-tests.yml`             | GREEN  | 31248610519 |                                                                                     |
| `storage-migration-e2e.yml`               | GREEN  | 31248613436 |                                                                                     |
| `gallery-ml-smoke.yml`                    | GREEN  | 31248611494 |                                                                                     |
| `gallery-mobile-smoke.yml`                | GREEN  | 31248612341 |                                                                                     |

Dispatched staggered 4 / 2 / 4 — **no GHCR rate limit fired**.

`test.yml` was inspected job-by-job rather than trusted on the workflow conclusion. The jobs that
specifically gate this cycle's risks were all green:

- **SQL Schema Checks** — the gate for `server/src/queries/*.sql` cherry-picked from `main` going
  stale against the rolling branch's newer repositories (#884 touched both).
- **Test Branding** — the `gallery-branding-check.sh` aggregator, now also covering the new
  `branding/i18n/overrides-*.json` surface from #957/#958.
- **Medium Tests (Server)** — the real exercise of the #30612 harness retype propagation.
- **Unit Test Mobile** — the `AssetDebugAction` propagation and its harness fix.
- **Lint Web** — the toolchain-drift gate that reddened #826 and #810; clean this cycle despite the
  sync carrying four web spec files.
- **OpenAPI Clients** — confirms the committed spec is not stale.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1118
- Commits behind upstream: **0**
- Fork diff looks clean: YES
- Version references (`branding/config.json` `upstream.version`, `README.md`): **unchanged** —
  upstream's newest tag is still `v3.1.0`, which is our base. Nothing to bump.
- Landing on `main`: **not applicable**. The standing rule requires an upstream **tag** plus
  thorough validation of that tagged state; upstream has not tagged past `v3.1.0`.
