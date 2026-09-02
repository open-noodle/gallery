# Upstream Sync Report — 2026-09-02 (batch 213, re-cut)

## Summary

- **Upstream commits pulled**: 1 (`1c7f9a4f24b..7211efa6cb9`)
- **Fork commits synced**: 0 — `origin/main` has not moved since #1037 (2026-08-29), so
  `integratedForkHead` stays `9c31bc01655` and no `upstream-sync-fork-main` ran
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Product-direction gate**: did NOT fire
- **Position**: 1404 ahead / **0 behind** `upstream/main`
- **Tip**: `b2967df85ce` → `f2a5ebea7bd`
- **Backup**: `backup/rolling-pre-b213ext-20260902` (`b2967df85ce`)
- **Upstream stable tag is still `v3.1.0`**, which `branding/config.json` already carries — no
  version bump, and the branch stays off `main`. (`v3.2.0-rc.0/1/2` exist upstream but are release
  candidates, not a stable tag, so they do not satisfy the landing precondition.)

### Batch numbering — this is a re-cut, not a batch 214

The persisted plan was regenerated after bumping `upstreamTargetHead`. The planner did **not** add a
214th batch; it re-cut the final batch so that batch 213's tip moved from `1c7f9a4f24b` to
`7211efa6cb9`, and the batch now spans 2 commits — of which `1c7f9a4f24b` was already contained in
`HEAD` from the 2026-09-01 cycle. Total batch count is unchanged at 213.

This is the documented "`upstream-batch-plan` prints already-completed batches" trap. Outstanding
work was established by containment, not by reading the plan:

```
NOT yet contained in HEAD:
  batch 213: 7211efa6cb99b91f1c88c120d8f01c382deca8e5  (2 commits)
    CONTAINED  1c7f9a4f24b chore: asset page zoom test overrides (immich-31201)
    PENDING    7211efa6cb9 chore(mobile): log app resume and pause (immich-31207)
```

## Incoming Upstream Changes

| Batch | SHA           | Summary                                 | Area   | Risk | Outcome               |
| ----- | ------------- | --------------------------------------- | ------ | ---- | --------------------- |
| 213   | `7211efa6cb9` | log app resume and pause (immich-31207) | mobile | LOW  | clean, zero conflicts |

The whole change is three `_log.info(...)` lines in
`mobile/lib/providers/app_life_cycle.provider.dart` — one in `handleAppResume`, one in the
`if (!_wasPaused) return;` early-out of `_performResume`, one in `handleAppPause`. No API, schema,
DTO, dependency, CI or generated-artifact surface is touched.

### Product-direction gate

**Did not fire.** Pure logging. No feature surface is introduced, reworked or redirected; nothing
overlaps Shared Spaces, sync contracts, faces/people, timeline, albums, library, storage, memories,
search or RBAC.

### Pre-rebase detectors — all clear

| Detector                                                                     | Result                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| Shape I — upstream **adds** a file at a fork-deleted path                    | clean (batch adds no files)                  |
| Shape I — upstream **renames** onto a fork-touched path                      | clean (batch renames nothing)                |
| Shape D/L — relocation, deleted anchor, unresolvable imports                 | clean (batch deletes nothing, moves nothing) |
| Silent-noop — deleted URL literals still literal-matched by branding tooling | clean (batch removes no URL literal)         |
| i18n branding-override gap                                                   | clean (batch does not touch `i18n/en.json`)  |
| Shape H — dependency behaviour change                                        | n/a (no dependency change)                   |

### The one thing worth checking, and why

The fork **does** carry a delta in the exact file upstream touched, so a conflict was plausible.
The fork's delta is its #513 deferred-sync restructure in `_performResume` (`syncRemoteThenLocal`,
`deferredLocalSync`, the `memoryLaneProvider` invalidate grafted on for immich-28983) plus a
whitespace removal in `_performPause` — sitting at lines 121–163 and 221. Upstream's three lines land
at 37, 67 and 180. Non-overlapping, so the merge was expected to be clean, and was.

Post-rebase the fork content was re-asserted by name rather than assumed from a clean exit:

| Fork symbol in the touched file | Occurrences after rebase |
| ------------------------------- | ------------------------ |
| `syncRemoteThenLocal`           | 1                        |
| `deferredLocalSync`             | 1                        |
| `memoryLaneProvider`            | 1                        |
| `_shouldContinueOperation`      | 5                        |
| `syncLinkedAlbum`               | 1                        |

`upstream/main`'s own copy of that file contains `syncRemoteThenLocal` zero times, confirming all of
the above is fork-only content that survived.

## Conflict Resolutions

None — the rebase replayed all 1404 fork commits with zero conflicts.

## Whole-tree audit

The load-bearing check for a mass replay is the whole-tree diff against the pre-cycle tip, not the
conflict count. Against `b2967df85ce`:

```
 mobile/lib/providers/app_life_cycle.provider.dart | 3 +++
 1 file changed, 3 insertions(+)
```

The diff is **exactly** upstream's three log lines and nothing else — no fork content dropped
anywhere in the tree. (The third hunk lands at line 193 rather than upstream's 180 because the fork's
restructure lengthens `_performResume`, which is the expected signature of a correct merge.)

## Gate checks

| Gate                                       | Result                                                         |
| ------------------------------------------ | -------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=213` | OK — 8/8 checks                                                |
| ↳ Fork-Owned File Survival                 | OK                                                             |
| ↳ Fork Extension Symbol Survival           | OK                                                             |
| ↳ Gallery Migration Count                  | OK — 62 (expected 62)                                          |
| ↳ Gallery Migration Filename Survival      | OK                                                             |
| ↳ Gallery Migration Manifest Coverage      | OK                                                             |
| ↳ Migration Timestamp Collision Check      | OK                                                             |
| ↳ Generated Artifact Review                | OK — no upstream generated-artifact change needs review        |
| ↳ Generated Query Block Survival           | OK — no query block present at the baseline was lost           |
| `make mobile-drift-rebase-check BATCH=213` | OK — schemaVersion, snapshots and Gallery callbacks consistent |
| `make fork-patches-check`                  | OK — `@immich/ui` patch metadata consistent                    |
| `make ci-invariants-check`                 | OK — 5/5, incl. `search-v3-not-dispatched`                     |
| `make commit-autolink-check`               | OK — 1404 messages scanned, fork PR ceiling 1044               |

## Local CI verification

### Gate scoping by tree identity

Compared per top-level directory against `b2967df85ce`, the tip that went 10/10 green on 2026-09-01:

| Area                                                                                                                                       | Result        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `server`, `web`, `machine-learning`, `open-api`, `packages`, `i18n`, `.github`, `docker`, `deployment`, `branding`, `e2e`, `docs`, `tools` | **IDENTICAL** |
| `mobile`                                                                                                                                   | CHANGED       |

Confirmed with a file-level diff: `git diff --name-only b2967df85ce..HEAD` returns exactly **one**
path. Server, web, e2e and `.github` gates were therefore not re-run locally — their trees are
byte-identical to an already-green state. For the same reason no OpenAPI regen, no `make sql` regen
(nothing under `server/src/repositories/` was touched), no `revert-to-immich.sql` update (no new
migrations) and no branding/i18n override work was required this cycle.

### Mobile gates

| Check                        | Status | Notes                            |
| ---------------------------- | ------ | -------------------------------- |
| `dart analyze --fatal-infos` | PASS   | No issues found                  |
| `dart format` (gate form)    | PASS   | Formatted 869 files, 0 changed   |
| `flutter test`               | PASS   | 3494 passed, 1 skipped, 0 failed |

Flutter **3.47.1**, read from `mobile/mise.toml` and invoked directly from
`~/.local/share/mise/installs/aqua-flutter-flutter/3.47.1/flutter/bin` rather than through `mise`,
to avoid both the `//:`-resolves-to-the-main-checkout trap and in-place `mise.lock` rewrites.

### Local-only finding: stale generated Drift test schemas (not a rebase regression)

The first local run failed `dart analyze` with five `uri_does_not_exist` errors for
`test/drift/main/generated/schema_v32.dart` … `schema_v36.dart`, and `flutter test` reported
**2861 passed / 1 failed**, the single failure being `test/drift/main/migration_test.dart` failing to
_load_.

This is a stale local artifact, not something the rebase caused:

- `mobile/test/drift/main/generated/` is gitignored (`mobile/.gitignore:38`), so it is never carried
  by a commit and cannot be dropped by a replay.
- The directory had been generated up to **v31** — upstream's level — while
  `drift_schemas/main/` carries the fork's snapshots through **v36** (`schemaVersion => 36`). It had
  simply not been regenerated since the fork's v32–v36 landed.
- The rebase changed exactly one file repo-wide, and it was not in that directory.

Regenerating with the project's own task body —
`dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/`
— wrote 37 files, brought the highest generated schema to v36, and `dart analyze --fatal-infos` then
reported **No issues found**, and `flutter test` went to **3494 passed / 1 skipped / 0 failed** —
the jump from 2861 is `migration_test.dart` finally loading its full snapshot matrix.

Worth noting for the next cycle: a fresh worktree will hit this whenever the fork adds a Drift
snapshot, and the failure presents as a _test-loading_ error that looks like a broken merge.

## Fork Feature Verification

| Feature                     | Status | Notes                                                       |
| --------------------------- | ------ | ----------------------------------------------------------- |
| Shared Spaces               | OK     | tree byte-identical to the last green tip                   |
| Storage Migration           | OK     | tree byte-identical                                         |
| Pet Detection               | OK     | tree byte-identical                                         |
| Image Editing               | OK     | tree byte-identical                                         |
| Branding                    | OK     | tree byte-identical; no upstream literal removed this batch |
| Google Photos Import        | OK     | tree byte-identical                                         |
| Search V3 coexistence       | OK     | `search-v3-not-dispatched` invariant passes                 |
| Mobile deferred-sync (#513) | OK     | re-asserted by symbol in the one touched file (table above) |

## Database / Mobile Drift Migration Analysis

- **New upstream server migrations**: none. Gallery migration count 62 (expected 62); no timestamp
  collisions.
- **New upstream mobile migrations**: none. `schemaVersion` stays **36**; fork-owned snapshots
  v32–v36 untouched; callback chain contiguous. No renumbering was required.
- **`revert-to-immich.sql`**: unchanged and still complete — no migration was added on either side,
  and `server/` is byte-identical to a state where that gate was green.

## Inconsistencies Found

None attributable to this cycle. The one local failure (stale gitignored Drift test schemas) is
documented above and is an environment artifact, not fork or upstream breakage.

## Pattern Propagation

No broad upstream refactor in this batch. Standing propagation decisions (freezed, Search V3
coexistence, GitHub Actions majors, mobile action model) are unchanged.

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-v3.1.1`
- **Commit validated**: `f2a5ebea7bd`
- **Result**: **10 / 10 workflows green, 56 jobs, 0 real failures**

All ten dispatchable workflows were dispatched against the branch, since a branch push triggers
nothing and the toolchain — not just the source — is what CI exercises. Results are read by
`headSha` (`f2a5ebea7bd`), never by branch alone, so a reused branch cannot serve an older green.

| Workflow                                  | Result | Run           | Jobs          |
| ----------------------------------------- | ------ | ------------- | ------------- |
| `test.yml`                                | GREEN  | `33628402570` | 21/21         |
| `docker.yml`                              | GREEN  | `33628406714` | 23/25, 2 skip |
| `static_analysis.yml`                     | GREEN  | `33628409883` | 2/2, re-run   |
| `gallery-rebase-smoke.yml`                | GREEN  | `33628412790` | 1/1           |
| `storage-migration-tests.yml`             | GREEN  | `33628416004` | 1/1           |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `33628419326` | 1/1           |
| `gallery-ml-smoke.yml`                    | GREEN  | `33628422409` | 1/1           |
| `gallery-mobile-smoke.yml`                | GREEN  | `33628425167` | 1/1           |
| `storage-migration-e2e.yml`               | GREEN  | `33628428364` | 1/1           |
| `gallery-build-mobile.yml`                | GREEN  | `33628431405` | 2/2           |

`docker.yml`'s two non-success jobs are `Re-Tag ML` and `Re-Tag Server`, both **skipped** — they are
conditional on a release/main context and do not run on a branch dispatch.

### Confirmed flake: Maven Central 403 (not a code failure)

`static_analysis.yml` failed on its first attempt, and the failing job name is misleading: **"Run
Dart Code Analysis" failed in its _Install dependencies_ step, not in Dart analysis.**
`mise //mobile:install:ci` → `//:open-api-dart` → `bin/generate-dart-sdk.sh` tried to fetch
openapi-generator `7.25.0` and got `Request failed with status code 403`, citing
`https://central.sonatype.org/faq/403-error-central/`.

Re-running the failed job alone turned it green with no code change, confirming the flake. Locally
`dart analyze --fatal-infos` had already reported _No issues found_ on the same tree.

Worth recording as its own class: because the Dart client is generated at build time (gitignored),
**every mobile-touching workflow depends on that Maven Central download**, so this failure mode can
red several workflows at once while the code is fine. It is distinct from the GitHub-API rate-limit
flakes already on record — different host, different step.

The report commit (`6a41d283167`) sits on top of the validated tree and touches only
`specs/upstream-reports/`, which is neither prettier-gated nor a CI trigger, so the green above
remains the authoritative read of the code state.

## Landing

Not a cutover cycle. Upstream's latest **stable** tag is still `v3.1.0`, already carried by
`branding/config.json`; `v3.2.0-rc.*` are release candidates and do not satisfy the tag precondition.
The branch stays off `main` — the expected steady state for a level, fork-synced, green rolling
branch.
