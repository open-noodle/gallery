# Upstream Sync Report — 2026-09-04 (batch 223)

## Summary

- **Upstream commits pulled**: 1 (`2e7365f16b2..b1a93688d3c`), batch 223
- **Fork commits synced from `origin/main`**: 0 (`integratedForkHead` already at `1f5e270bd14` = `origin/main`)
- **Conflicts resolved**: 3 (across 2 files, at fork commits #513, #663, #892)
- **Risk level**: LOW — single mobile bugfix; one zero-conflict semantic break found and fixed locally
- **CI**: 10/10 green on `10d44177b60` (2 confirmed flakes, both pre-existing and proven non-regressions)
- **Recommendation**: PROCEED
- **Landing on `main`**: NO. Upstream's latest final tag is still `v3.1.0` (`v3.2.0-rc.0/1/2` are pre-releases). The standing rule requires a real tag plus real-data validation, so the branch stays off `main`.

## Incoming Upstream Changes

| SHA           | Summary                                                          | Area   | Risk to Fork | Notes                                                                                                                         |
| ------------- | ---------------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `b1a93688d3c` | fix(mobile): refresh the memory lane after resume (immich-31239) | mobile | MEDIUM       | Adds `_ref.invalidate(memoryLaneProvider)` to a method the fork restructured, plus a test that stubs only upstream's sync API |

### Product-direction gate

Applied. **It did not fire.** Memories are a fork surface (memory types, overlap reservation), but this
commit neither reshapes the memory model nor introduces an access/sync contract — it invalidates one
provider on resume. No feature duplication, no new first-class entity.

### Pre-rebase detectors

| Detector                                        | Result                             |
| ----------------------------------------------- | ---------------------------------- |
| Deleted-literal → fork literal-matching tooling | clean (no URL literals removed)    |
| i18n branding-override gap                      | clean (batch touched no `i18n/`)   |
| Shape I — upstream adds a file at a fork path   | clean (batch adds no files)        |
| Shape I — upstream renames onto a fork path     | clean (batch renames nothing)      |
| Empty tracked files (`--theirs` zero-byte trap) | clean (3 pre-existing intentional) |

## Conflict Resolutions

### Conflict 1: `mobile/lib/providers/app_life_cycle.provider.dart` (at fork #513)

- **Fork side**: #513 replaces upstream's `Future.wait([syncLocal, syncRemote])` with
  `syncRemoteThenLocal(...)` + a deferred local sync, to speed up shared-space startup.
- **Upstream side**: adds `_ref.invalidate(memoryLaneProvider);` immediately before the existing
  `_ref.invalidate(allMemoriesProvider);`.
- **Resolution**: took the fork side. Git had factored **both** invalidate lines into the shared tail
  (the fork already carried a grafted `memoryLaneProvider` invalidate from immich-28983), so upstream's
  fix survives the resolution rather than being dropped by it.
- **Risk**: LOW.
- **Verification**: resolved file is byte-identical to `0bdfb53b564`'s own version of it; `ours` and
  `base` were literally equal inside the marked region, so no Shape-K asymmetric loss was possible.

### Conflict 2: `mobile/test/providers/app_life_cycle_provider_test.dart` (at fork #663)

- **Fork side**: #663 wraps the whole `main()` body in
  `group('resume lifecycle and websocket reconnection', ...)` and adds a second fork-only group.
- **Upstream side**: adds a `memoryLaneBuilds` counter, a `MockBackgroundSyncManager` with four stubs,
  five provider overrides, and a new `resume re-queries the memory lane` test — all at the old
  (ungrouped) indentation.
- **Resolution**: resolved all four hunks to the fork's grouped form, then re-spliced upstream's
  additions inside the group at +2 indentation, and **moved upstream's new test inside the group**
  (auto-merge had left it dangling after both groups, referencing state that is now group-scoped).
- **Risk**: MEDIUM at the time — re-indentation conflicts are the Shape-K class.
- **Verification**: token-level whole-file audit confirmed every non-blank line of `004f8a1b37b`'s
  version survives; the only additions are upstream's.

### Conflict 3: `mobile/test/providers/app_life_cycle_provider_test.dart` (at fork #892)

- **Fork side**: #892 ("match upstream background backup implementation") deliberately **un-wraps** the
  group and deletes the fork-only iOS group, converging the file onto upstream's shape.
- **Upstream side**: same additions as conflict 2.
- **Resolution**: took the fork side (ungrouped), then re-spliced upstream's additions at the ungrouped
  indentation. Confirmed the fork tip's version of this file is byte-identical to upstream's, i.e. the
  fork contributes nothing here any more — so the correct end state is upstream's new file verbatim.
- **Risk**: LOW.
- **Verification**: resolved file differs from `b1a93688d3c`'s version by exactly one line
  (`driftBackupProvider` vs `backupProvider`), which is correct at #892's point in history and is
  renamed by the later fork commit `cc1ded91b1b`. Final tip matches upstream's file exactly.

## Zero-Conflict Semantic Break (found and fixed)

**Upstream's new test stubs only the sync API upstream itself calls.** `mobile/test/providers/app_life_cycle_provider_test.dart`
carries **zero fork delta** at the tip, so upstream's rewritten test merged cleanly and every audit stayed
green — but `_handleBackgroundSync` on this branch calls the fork's `syncRemoteThenLocal(...)` (#513), which
the new `MockBackgroundSyncManager` never stubs.

The failure mode is quiet rather than loud: the unstubbed call throws, `_handleBackgroundSync`'s own
`try/catch` swallows it, and the invalidate never runs — so the test reports
`Expected: <2> / Actual: <1>` instead of an error.

- **Detected by**: `flutter test` (the only gate that sees it — `dart analyze`, `dart format` and all
  four post-rebase audits were green).
- **Fix**: stub `syncRemoteThenLocal` on the mock to return a real `RemoteThenLocalSync`, marked
  `Fork-only:` with the reason so a future resolution does not silently drop it.
- **Proved red first**: the test failed before the stub and passes after, so it genuinely exercises the
  fork's code path rather than passing vacuously.

This is the same family as the mocktail blind spot already recorded in the skill, with a new object: a
**hand-written test's stub set** is an enumerated list, and the fork's members are invisible to whoever
wrote it upstream.

## Fork Feature Verification

| Feature                     | Status | Notes                                                                 |
| --------------------------- | ------ | --------------------------------------------------------------------- |
| Shared Spaces               | OK     | `server/`, `web/`, `e2e/` byte-identical to the last 10/10 green tip  |
| Storage Migration           | OK     | unchanged                                                             |
| Pet Detection               | OK     | unchanged                                                             |
| Image Editing               | OK     | unchanged                                                             |
| Branding                    | OK     | `branding/` byte-identical                                            |
| Google Photos Import        | OK     | unchanged                                                             |
| Mobile deferred sync (#513) | OK     | restructure intact; upstream's memory-lane fix layered on top         |
| Mobile iOS resume (#663)    | OK     | fork-only group correctly dropped at #892, per fork's own convergence |

## Gate Results

Scoped by tree identity against `4af3edb217a` (the last 10/10 CI-green tip). Every top-level area except
`mobile/` is **byte-identical**, so this cycle's whole net delta is one file.

| Check                                        | Status | Notes                                                      |
| -------------------------------------------- | ------ | ---------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=223`   | PASS   | all 8 checks OK, incl. Generated Query Block Survival      |
| `make fork-patches-check`                    | PASS   | `@immich/ui` patch metadata consistent                     |
| `make ci-invariants-check`                   | PASS   | incl. `search-v3-not-dispatched`                           |
| `make mobile-drift-rebase-check BATCH=223`   | PASS   | schemaVersion/snapshots/callbacks consistent               |
| `make commit-autolink-check`                 | PASS   | 1432 messages scanned, fork PR ceiling 1064                |
| `dart run drift_dev make-migrations`         | PASS   | no snapshot-refusal (Shape L clear), no tracked-file drift |
| `dart analyze --fatal-infos lib test`        | PASS   | No issues found                                            |
| `dart format` (`mise //mobile:format` scope) | PASS   | 862 files, 0 changed                                       |
| `flutter test` (full mobile suite)           | PASS   | see Remote CI section for the run of record                |
| server / web / e2e gates                     | N/A    | those trees are byte-identical to a 10/10 green tip        |

### Environment note

`mobile/test/drift/main/generated/` is gitignored codegen and was stale in this worktree (v1–v31, missing
the fork's v32–v36), which failed `dart analyze` and `migration_test.dart` load. Regenerated with
`drift_dev schema generate`; not a rebase regression. Separately, a local `flutter pub get` rewrote
`mobile/pubspec.lock`'s Dart SDK constraint (`>=3.12.0` → `>=3.13.0`, local Dart 3.13.1) — reverted, and
both `mise.lock` files confirmed untouched.

## Pre-existing CI Finding — Medium Tests connection exhaustion (NOT from this batch)

`Medium Tests (Server)` failed twice on this headSha, both times rooted in
`PostgresError: sorry, too many clients already` (`code: 53300`, `routine: InitProcess`).
**It is not a regression from batch 223**, and the proof does not depend on judgement:

- `HEAD:server` is the tree object `ab335cd0c5` — **byte-identical** to `2be00fc43b7:server`, the tree
  that **passed** this same job on 2026-09-03. The same server code both passes and fails, which is
  nondeterminism by definition.
- The failure **set shifts between runs** (run 1: 3 face-repair + `never deletes a memory created
through the API`; run 2: 2 face-repair + `onMemoriesCleanup > should run without error`) — the
  documented signature of DB contention rather than a behavioural break.
- The same job was already red once in the previous cycle (`5a9f56c9471`) and green on the next
  (`2be00fc43b7`).
- No assertion about product behaviour failed; every failure is a connection acquisition error.

**Mechanism** (already documented in-repo at `server/test/medium/specs/services/memory.service.spec.ts:260`):
`getKyselyDB()` opens its own pool of up to 10 connections per call, and a spec that never calls
`.destroy()` holds them for the lifetime of the file. The medium Postgres container is started in
`server/test/medium/globalSetup.ts` with **no `max_connections` override** (image default), and vitest
runs the suite at default parallelism.

A scan of the branch shows the leak is **systemic and shared with upstream**, not fork-specific:

| Medium specs calling `getKyselyDB()` | With an `afterEach` destroy | Leaking |
| ------------------------------------ | --------------------------- | ------- |
| ~165                                 | 5                           | ~160    |

Worst offenders by pool count in a single file: `repositories/face-identity.repository.spec.ts` (29),
`repositories/person.repository.spec.ts` (5), `repositories/asset.repository.spec.ts` (5),
`sync/sync-user.spec.ts` (5), `services/face-repair.service.spec.ts` (4).

Why it bites **rolling** rather than `main`: medium spec counts are **upstream 64 → `main` 161 →
rolling 169**. The fork more than doubles the suite, so the accumulated pools cross the container's
ceiling; `main` sits just under it and passes.

**Deliberately NOT fixed in this cycle.** It is pre-existing, systemic (~160 files), and touching
`server/` would forfeit this branch's byte-identical-to-a-green-tree property and require full
server re-validation. It wants its own PR. Recommended fix, cheapest first:

1. Pass `-c max_connections=200` in `globalSetup.ts`'s container command (one line, no spec churn).
2. Add the `afterEach(() => db.destroy())` pattern to the highest-pool-count specs.
3. Cap vitest medium `poolOptions.threads.maxThreads` so concurrent files are bounded.

## Inconsistencies Found

One, fixed in this cycle: the unstubbed `syncRemoteThenLocal` described above.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-223`
- **Commit validated**: `10d44177b60` (read by `headSha`, not by branch)
- **Result: 10/10 GREEN**

| Workflow                                  | Status | Notes                                         |
| ----------------------------------------- | ------ | --------------------------------------------- |
| `test.yml`                                | GREEN  | green on re-run; see the flake analysis above |
| `docker.yml`                              | GREEN  | first pass                                    |
| `static_analysis.yml`                     | GREEN  | first pass                                    |
| `gallery-build-mobile.yml`                | GREEN  | first pass — iOS + Android compile            |
| `gallery-rebase-smoke.yml`                | GREEN  | first pass                                    |
| `storage-migration-tests.yml`             | GREEN  | first pass                                    |
| `storage-migration-e2e.yml`               | GREEN  | first pass                                    |
| `gallery-revert-to-immich-validation.yml` | GREEN  | first pass                                    |
| `gallery-ml-smoke.yml`                    | GREEN  | first pass                                    |
| `gallery-mobile-smoke.yml`                | GREEN  | first pass                                    |

Dispatched in two waves (light first, Docker-heavy ~25 s apart) per the registry-ratelimit mitigation.
**Zero registry-ratelimit failures** — 9/10 green on the first pass.

- **Failures fixed**: none required (no code defect surfaced remotely).
- **Confirmed flakes**: `Test Web` — 6108 passed, 0 assertion failures; an unhandled
  `ReferenceError: document is not defined` from third-party `bits-ui`'s `body-scroll-lock`
  `setTimeout` firing after happy-dom teardown. Passed on re-run.
  `Medium Tests (Server)` — Postgres connection exhaustion, analysed in full above; green on the
  third attempt with no code change.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1432
- Commits behind upstream: 0
- Conflict markers anywhere in tree: none
- Fork diff looks clean: YES
