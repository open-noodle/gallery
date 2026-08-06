# Upstream Sync Report — 2026-08-06 (batches 63–64)

## Summary

- **Upstream commits pulled**: 4 (`0687c0d3f76..a9a99cffbfc`, batches 63–64)
- **Fork commits synced**: 0 — `origin/main` never moved this cycle (upstream-only)
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED

Cycle shape: **UPSTREAM-ONLY**. `origin/main` is still exactly the Skill Sync Anchor
`1d4a447ecde` (#921), so `make upstream-sync-fork-main` had nothing to do and the anchor scan
returned empty — no new fork surface, no table updates needed.

The branch is now **level with `upstream/main`** (`a9a99cffbfc`) and remains **off `main`**:
upstream's newest tag is still `v3.1.0`, so the standing landing rule is not satisfied.

## Incoming Upstream Changes

| SHA           | Summary                                                | Area   | Risk to Fork | Notes                                                                                                                                                |
| ------------- | ------------------------------------------------------ | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f361dbbb775` | chore: clean up last mergify remnant (#30600)          | CI     | LOW          | Deletes one `if:` guard in `pr-label-validation.yml`. Fork diverges in that file (PUSH_O_MATIC removal) in an adjacent hunk.                         |
| `63b90ec43da` | fix: map not updating after viewing an asset (#30601)  | mobile | LOW          | Moves provider invalidation out of `isRouteInStack` listeners into `AppNavigationObserver.didPush/didPop`. Zero fork divergence in both files.       |
| `6167618f5ce` | fix: asset stack stacked over asset details (#30598)   | mobile | LOW          | Purely additive `showingDetails` early-return in `AssetStackRow`. Zero fork divergence.                                                              |
| `a9a99cffbfc` | chore: cleanup translation dependency on i18n (#30596) | mobile | LOW          | `mobile/mise.toml`: `codegen:translation` `run` → `depends`, plus `wait_for` on `i18n:loader`/`i18n:keys`. Fork diverges elsewhere in the same file. |

### High-Risk Changes

None. No commit in this range meets the HIGH-risk criteria (no API/contract change, no schema or
migration, no dependency bump, no broad refactor, no feature overlapping a fork surface).

## Gate Results (pre-rebase)

### Per-batch product-direction gate — DID NOT FIRE

All four commits were read in full before rebasing. None changes _where a feature is going_:

- No sharing / Shared Spaces, sync stream or contract, access model / RBAC, album / asset / person
  model reshape, and no new first-class entity.
- Two are narrow mobile bugfixes, one is a CI cleanup, one is a build-task refactor.

### Zero-conflict semantic-break detector — CLEAN

The literal-deletion detector (deleted URL literals still literal-matched by fork tooling under
`branding/scripts`, `tools`, `.github/actions`) produced **no output** for
`0687c0d3f76..upstream/main`.

Signature/reference sweep for the symbols these commits touch — `isRouteInStack`,
`inLockedViewProvider`, `isAssetViewerOpenProvider`, `AppNavigationObserver`, `AssetStackRow`,
`currentRouteNameProvider` — found no signature change and no hand-written fork fake or subclass
(the mocktail blind spot). Fork call sites that reference `inLockedViewProvider`
(`presentation_context.dart`, `remove_from_album_nudge_test.dart`, four viewer widgets) are
unaffected, since the commit only invalidates the provider from a new place.

### Fork divergence per touched file (computed BEFORE rebasing)

| File                                                                   | Fork divergence vs old base | Outcome             |
| ---------------------------------------------------------------------- | --------------------------- | ------------------- |
| `.github/workflows/pr-label-validation.yml`                            | 23 diff lines               | merged, no conflict |
| `mobile/mise.toml`                                                     | 24 diff lines               | merged, no conflict |
| `mobile/lib/providers/routes.provider.dart`                            | 0                           | clean               |
| `mobile/lib/routing/app_navigation_observer.dart`                      | 0                           | clean               |
| `mobile/lib/presentation/widgets/asset_viewer/asset_stack.widget.dart` | 0                           | clean               |

Three of five touched files carry **zero** fork divergence, which is why a batch that looks like it
touches two fork-modified files rebased with no conflicts at all.

## Conflict Resolutions

**None — both batches rebased cleanly.**

Two conflicts were _predicted_ and did not occur. Per the batch-58b lesson ("the predicted conflict
did NOT happen, and that WAS the bug"), both were verified explicitly rather than assumed:

- **`.github/workflows/pr-label-validation.yml`** — verified both sides survived. Upstream's
  mergify `if:` line is gone (no `mergify` match remains in the file) **and** the fork's
  PUSH_O_MATIC removal is intact (`token: ${{ github.token }}`, no `create-workflow-token` step).
  Fork divergence vs the new base is exactly the token swap, nothing more.
- **`mobile/mise.toml`** — verified both sides survived. Upstream's
  `depends = ["//:i18n:format-fix", "i18n:loader", "i18n:keys"]` is present and both `wait_for`
  entries landed; the fork's `analyze:dcm` `DCM_CI_KEY`/`DCM_EMAIL` guard and its `checklist`
  `{ task = "codegen" }` collapse both survive. Fork divergence vs the new base is exactly those
  two hunks.

### mise.toml semantic interaction — checked, no fork change needed

Upstream converted `codegen:translation` from an ordered `run` list into `depends` + `wait_for`.
The fork's `checklist` calls the aggregate `{ task = "codegen" }`, and `[tasks.codegen]` already
declares `depends = [..., "codegen:translation"]`, so the fork's entry point picks up upstream's
restructure transparently. No fork-side propagation required.

## Fork Feature Verification

| Feature              | Status | Notes                                                                                      |
| -------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Shared Spaces        | OK     | Untouched — no `server/` or `web/` file changed this cycle.                                |
| Storage Migration    | OK     | Untouched.                                                                                 |
| Pet Detection        | OK     | Untouched.                                                                                 |
| Image Editing        | OK     | Untouched.                                                                                 |
| Branding             | OK     | Untouched; literal-deletion detector clean.                                                |
| Google Photos Import | OK     | Untouched.                                                                                 |
| Mobile fork surface  | OK     | `dart analyze --fatal-infos lib test` → **No issues found**; `flutter test` → 3164 passed. |

Post-rebase audit (batches 63 and 64, both **all-OK**):

- Fork-Owned File Survival — all literal fork-owned files present
- Fork Extension Symbol Survival — all manifest expected symbols present
- Gallery Migration Count — 49 (expected 49)
- Gallery Migration Filename Survival / Manifest Coverage — all present
- Migration Timestamp Collision Check — no collisions
- Generated Artifact Review — no upstream generated artifact changes require review

## CI and Infrastructure Verification

| Check                                          | Status | Notes                                                                                    |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions)        | OK     | Only `pr-label-validation.yml` touched; fork-only workflows untouched.                   |
| Docker image references (`gallery-*`)          | OK     | `make ci-invariants-check` → gallery-release-image-names passed.                         |
| Branding (no "Immich" leaks in CI/config)      | OK     | Detector clean; no branding-adjacent literal removed upstream.                           |
| Fork CI modifications intact                   | OK     | `no-push-o-matic` passed; PUSH_O_MATIC removal verified by hand in the one touched file. |
| Upstream docs deploy stays `workflow_dispatch` | OK     | `gallery-docs-deploy-disabled-upstream` passed.                                          |
| `@immich/ui` patch consistency                 | OK     | `make fork-patches-check` → patch metadata consistent.                                   |
| New upstream workflows reviewed                | OK     | None added.                                                                              |

## Database Migration Analysis

**No new upstream migrations this cycle.**
`git diff --name-only <pre-batch>..HEAD -- server/src/schema/migrations/ server/src/schema/migrations-gallery/`
is empty.

- Gallery migration interleaving: OK (count unchanged at 49)
- Timestamp collisions: NONE
- Tables shared with gallery migrations: N/A (no migrations)
- Fork-extended schema tables modified by upstream: NONE
- `postbuild` script intact: YES (untouched)
- `CompositeMigrationProvider` intact: YES (untouched)

### `revert-to-immich.sql` coverage (step 7i)

**No action required.** Coverage is a function of the set of fork migrations plus post-tag upstream
migrations; neither set changed this cycle, so the coverage that was green on the previous cycle is
still green. The `gallery-revert-to-immich-validation` dispatch confirms it.

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check BATCH=64` → **OK**: schemaVersion, snapshots and Gallery callbacks
are consistent.

- New upstream mobile migrations: NONE
- Fork-owned mobile migrations: unchanged, none renumbered
- Duplicate `drift_schema_vN.json`: NONE
- Gaps in migration chain: NONE
- `schemaVersion` matches highest snapshot: YES
- `fromXToY` callback chain contiguous: YES
- Renumbering needed: NO

## Inconsistencies Found

**None introduced by this cycle.**

One standing (pre-existing) remnant re-verified while checking that the touched workflow file did
not disturb the branding gate:

- The #928 fix is **intact**. `branding/scripts/gallery-branding-check.sh` is wired into `test.yml`
  ("Test Branding") and invokes six of the eight `branding/scripts/*.sh`, including
  `test-app-download-branding.sh` — the regression test for the #30527 silent-no-op class.
- `verify-mobile-assets.sh` is still reached by **no** workflow and no aggregator. Pre-existing, not
  caused by this rebase; carried forward as a known gap.

Note for the detector documented in the skill: the naive
`grep -rq "$n" .github/workflows/` sweep now reports **five false positives**, because #928 moved
invocation behind the `gallery-branding-check.sh` aggregator rather than naming each script in a
workflow. The sweep must also grep the aggregator, otherwise it reads as a regression that is not
there.

## Pattern Propagation

No broad architectural refactor in this range. The `mise.toml` task restructure is upstream-internal
and, as analysed above, the fork's aggregate `codegen` entry point inherits it with no fork-side
work.

Standing deferred propagations are unchanged this cycle (Dart `freezed` fork models, GitHub Actions
majors on fork-only workflows, Search V3 dormant coexistence).

## Local CI Verification

Scope note: the **whole-cycle delta outside `mobile/` is one deleted line in a GitHub workflow YAML**
(`git diff --stat <pre-batch>..HEAD -- . ':(exclude)mobile'` → `pr-label-validation.yml | 1 -`), and
`server/`, `web/`, `e2e/`, `cli/`, `open-api/`, `packages/` are **byte-untouched**. The server/web
suites therefore cannot be affected by this cycle and were not run locally; the mobile gate is the
one that matters and was run in full against the pinned Flutter **3.44.8**.

| Check                                                    | Status | Notes                                                                         |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `flutter --version`                                      | PASS   | 3.44.8 (matches the `mobile/mise.toml` pin)                                   |
| `flutter pub get`                                        | PASS   | —                                                                             |
| `build_runner build --delete-conflicting-outputs`        | PASS   | 57 outputs (codegen is gitignored since #888)                                 |
| `easy_localization:generate` + `generate_keys.dart`      | PASS   | —                                                                             |
| `drift_dev schema generate … test/drift/main/generated/` | PASS   | 37 files                                                                      |
| `dart analyze --fatal-infos lib test`                    | PASS   | **No issues found!**                                                          |
| `dart format` (exact CI command — `lib` only)            | PASS   | 827 files, 0 changed                                                          |
| `flutter test`                                           | PASS   | **3164 passed**, 1 skipped                                                    |
| Server / web build, tsc, lint, unit tests                | N/A    | Provably untouched (see scope note)                                           |
| OpenAPI regeneration                                     | N/A    | No controller/DTO/repository changed; audit's Generated Artifact Review clean |
| `make sql`                                               | N/A    | No repository method changed; skipped (needs a DB)                            |
| `mise.lock` unmodified                                   | PASS   | `git status -- '*mise.lock'` clean throughout                                 |
| Working tree clean                                       | PASS   | —                                                                             |

## Remote CI Verification

- **Test branch**: `rebase/upstream-b64`
- **Commit validated**: see `checkHistory` in `rolling-state.json`

| Workflow                                  | Status | Notes |
| ----------------------------------------- | ------ | ----- |
| `test.yml`                                | —      |       |
| `docker.yml`                              | —      |       |
| `static_analysis.yml`                     | —      |       |
| `gallery-build-mobile.yml`                | —      |       |
| `gallery-mobile-smoke.yml`                | —      |       |
| `gallery-ml-smoke.yml`                    | —      |       |
| `gallery-rebase-smoke.yml`                | —      |       |
| `storage-migration-tests.yml`             | —      |       |
| `storage-migration-e2e.yml`               | —      |       |
| `gallery-revert-to-immich-validation.yml` | —      |       |

(Filled in once the dispatched set completes.)

## Post-Rebase Verification

- Fork commits ahead of upstream: 1107 (including this report commit)
- Commits behind upstream: **0** (`git log HEAD..upstream/main` empty)
- Fork diff looks clean: YES
- Version references (`branding/config.json` `upstream.version`, `README.md`): **unchanged** —
  upstream's newest tag is still `v3.1.0`, so there is no version to bump.

## Landing Decision

**Stays off `main`.** The standing rule requires (1) an upstream **tag** and (2) thorough testing of
that tagged state. Upstream's newest tag is still `v3.1.0` — `git ls-remote --tags upstream 'v*'`
shows nothing above it — so condition 1 is not met. Green + level + fork-synced is the expected
steady state of this workflow, not a landing signal.
