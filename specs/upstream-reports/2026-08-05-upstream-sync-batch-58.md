# Upstream Sync Report — 2026-08-05 (batch 58 + fork sync)

Second cycle of 2026-08-05. The earlier cycle that day is
`2026-08-05-upstream-sync.md` (batches 53–57).

## Summary

- **Upstream commits pulled**: 3 (`1c7c28bb0d5..555fbde840e`, batch 58)
- **Fork commits synced**: 3 (#932, #933, #934)
- **Conflicts resolved**: 6 distinct conflict points across 5 fork commits
  (#513, #627, #639, #663, batch-24 lint sweep, #892), all in the mobile
  backup / app-lifecycle path
- **Risk level**: MEDIUM — two upstream signature widenings landing in the one
  file the fork rewrote
- **Recommendation**: PROCEED
- **Landing on `main`**: NO. Upstream's newest tag is still `v3.1.0`, which is
  already the fork's base. Per the standing rule the branch stays off `main`.

## Incoming Upstream Changes

| SHA           | Summary                                                         | Area   | Risk to Fork | Notes                                                                                                                                              |
| ------------- | --------------------------------------------------------------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b2eb62dfa54` | fix(mobile): keep backup remainder from going negative (#29011) | mobile | LOW          | `drift_backup.provider.dart` had **zero** fork divergence. Adds a `getBackupStatus` re-baseline, a `mounted` guard, and a new test file.           |
| `1a40ef66b4f` | chore: log reason for foreground backup cancellation (#30570)   | mobile | MEDIUM       | **Signature widening**: `stopForegroundBackup()` → `stopForegroundBackup({required String reason})`. `required` breaks every call site.            |
| `555fbde840e` | fix: \_safeRun is finally safe (#30571)                         | mobile | MEDIUM       | **Signature widening**: `_safeRun(Future<void>, …)` → `_safeRun(Future<void> Function(), …)`. Collides with fork #513's deferred-sync restructure. |

### High-risk analysis

**#30571 is a real correctness fix, not a refactor.** `_safeRun` guards its
action behind `_shouldContinueOperation()`, but callers passed an
_already-started_ `Future`, so the work had begun before the guard ever ran. The
thunk conversion is what makes the guard mean anything. The fork must adopt it
at every call site or the guard stays a no-op — this is behaviour, not style.

**#30570's `required` keyword is what makes it dangerous.** An optional
parameter would have been a silent no-op on fork call sites; `required` turns
every unconverted call into a compile error. That is the better failure mode,
and it is what `dart analyze` caught.

## Gate results

### Per-batch product-direction gate — DID NOT FIRE

None of the three commits changes where a feature is going. #30571 fixes a
broken guard; it does not redirect the sync model. No sharing / Shared Spaces /
faces / albums / sync-contract / RBAC surface is touched. Mobile backup is
upstream-owned and — after fork #892 — the fork deliberately runs upstream's
implementation verbatim.

### Zero-conflict semantic break gate — literal detector CLEAN, signature half FIRED TWICE

The URL-literal detector (upstream-removed literals still literal-matched by
`branding/scripts`, `tools`, `.github/actions`) produced no output for
`1c7c28bb0d5..555fbde840e`.

The **signature-widening** half fired twice, and both landed in
`app_life_cycle.provider.dart`, the one file the fork rewrote:

- `_safeRun` — the fork's #513 block keeps 4 call sites upstream's diff never
  reaches. Left alone they keep passing eager `Future`s → compile error.
- `stopForegroundBackup` — 5 fork call sites; upstream's own diff covers all of
  them, but one sits inside the conflicting file.

Checked the mocktail blind spot: grepped `mobile/test/` for hand-written fakes
or subclasses overriding either method. **None** — every mock in this area is
`extends Mock`, which absorbs signature changes via `noSuchMethod`. So no
hidden test-side break, unlike batch 53's `syncRemote()` case.

## Conflict Resolutions

All six are in the mobile backup / lifecycle path. The governing principle was
the one recorded last cycle: **resolve at each commit's own point in history,
not to the end state.** Three of these resolutions are deliberately transient —
a later fork commit reverts them — and resolving them "correctly for the end
state" would have broken the replay.

### Conflict 1: `mobile/lib/providers/app_life_cycle.provider.dart` @ #513

- **Fork side**: #513 replaced upstream's `syncLocal`/`syncRemote` `Future.wait`
  with `syncRemoteThenLocal(...)` + a deferred `unawaited(sync.deferredLocalSync…)`
  block, plus the #28983 memories-invalidate graft.
- **Upstream side**: #30571's thunk conversion of the same block.
- **Resolution**: kept the fork's deferred-sync structure and applied upstream's
  thunk conversion to its 4 surviving `_safeRun` call sites.
- **Deliberately kept #513's bare `_resumeBackup();`** rather than the end
  state's `unawaited(_resumeBackup())` — the batch-24 lint sweep adds
  `unawaited` two commits later (confirmed in conflict 5). Pre-applying it would
  have made that commit's hunk conflict or silently no-op.
- **Risk**: LOW. **Verified**: `dart analyze --fatal-infos` clean; final diff vs
  `upstream/main` contains only the fork's #513 restructure.

### Conflict 2: `_resumeBackup` + 4 backup files @ #627

- **Fork side**: #627 added an iOS/Android split — `startBackup`/`stopBackup`
  wrappers — and routed the pages through them.
- **Upstream side**: #30570's `required String reason`.
- **Resolution**: took #627's wrapper structure and **threaded `reason` through
  the new `stopBackup` wrapper** so upstream's per-call-site strings survive
  ("backup button toggled off", "backup albums updated", "backup settings
  updated", "the app being sent to the background"). Also used `startBackup`,
  not `startForegroundBackup` — correct _at #627_; #892 renames it back.
- **Risk**: LOW (transient — #892 reverts this whole layer).

### Conflict 3: `mobile/test/providers/backup/drift_backup_provider_test.dart` @ #627 — `AA`, both sides created it

- Upstream #29011 and fork #627 **independently created the same path** with an
  empty merge base. Both define `void main()` and both declare
  `MockForegroundUploadService` / `MockBackgroundUploadService`, so they cannot
  be concatenated — the "keep both suites" reflex would not compile.
- **Resolution**: took #627's file verbatim at #627 (see "Process note" below),
  let #892's deletion replay, then restored **upstream's** version in a separate
  labelled commit (`59400e3d07f`).
- **Risk**: MEDIUM, and it is the finding of this cycle — see next section.

### Conflict 4: `_safeRun` declaration @ #663

- #663 inserted `refreshConnectionAfterResume` immediately above `_safeRun` and
  re-declared `_safeRun` with the old eager signature.
- **Resolution**: kept #663's new method, kept upstream's thunk signature.
- **Risk**: LOW (transient — #892 reverts #663).

### Conflict 5: batch-24 lint sweep

- The fork's own lint commit changes `_resumeBackup()` → `unawaited(_resumeBackup())`.
- **Resolution**: took the `unawaited` change on top of upstream's thunk form.
  This is the commit conflict 1 was holding the line for.
- **Risk**: LOW.

### Conflict 6: 5 files @ #892

- #892 reverts #627/#639/#663 and returns mobile backup to upstream's code.
- **Resolution**: took #892's shape everywhere and layered upstream's `reason:`
  on top — removing the `startBackup`/`stopBackup` wrappers, the iOS guard in
  `_performPause`, `refreshConnectionAfterResume`, and the #639 reminder call.
- **Verified**: after this commit,
  `drift_backup.provider.dart`, `foreground_upload.service.dart`,
  `drift_backup_album_selection.page.dart` and `drift_backup_options.page.dart`
  are **byte-identical to `upstream/main`** — exactly what #892 promises.
- **Risk**: LOW, and objectively verifiable.

## Inconsistencies Found

### 1. `upstream/main`'s own mobile test suite does not compile — repaired here

`b2eb62dfa54` (#29011) added
`mobile/test/providers/backup/drift_backup_provider_test.dart`. Minutes later
`1a40ef66b4f` (#30570) made `stopForegroundBackup`'s `reason` **required** and
updated every call site it knew about — but not the test that had just landed.
Upstream's tree therefore fails to compile:

```
mobile/test/providers/backup/drift_backup_provider_test.dart:79
  notifier.stopForegroundBackup();
  ^ The named parameter 'reason' is required
```

Verified directly against `upstream/main`, not inferred from the merge. Two
independently-green PRs redding the branch — structurally identical to the
fork's own #886 × #911 collision.

**This is upstream's bug, not a resolution artifact.** Fixed here by passing a
reason. Expect a trivial conflict when upstream fixes it themselves.

### 2. Upstream's new test would have been silently deleted by fork #892

Fork #892 deletes `drift_backup_provider_test.dart` because at the time it held
the fork's own #627/#639/#658 tests. On this rebase that deletion would have
taken **upstream's brand-new test with it** — a real, silent coverage loss for
backup code the fork now runs verbatim (`drift_backup.provider.dart` is
byte-identical to upstream).

Restored in `59400e3d07f` as a separate, clearly-labelled commit rather than
buried inside #892, so it is easy to find and easy to drop once upstream fixes
its own break. All 4 of upstream's tests pass against the fork's code.

### 3. Pre-existing, NOT introduced by this rebase

Recorded so the next cycle does not re-investigate:

- `mobile/lib/pages/backup/drift_backup.page.dart` diverges from upstream by two
  `unawaited(...)` removals (fork lint sweep). Confirmed identical divergence on
  the pre-rebase branch.
- Three timeline test files under `mobile/test/` are not `dart format`-clean.
  **CI never sees this**: `mise //mobile:format` formats **`lib` only**. Left
  untouched to avoid unrelated churn.
- `branding/scripts/verify-mobile-assets.sh` is still referenced by no workflow
  and not called by `gallery-branding-check.sh`. The other four previously
  unwired scripts are now gated via #928's umbrella — the standing gap flagged
  on 2026-08-04 is otherwise closed, and #934 (in this fork sync) closes the
  absent-only weakness in `verify-branding.sh`.

## Process note — a resolution mistake worth recording

The first attempt at conflict 3 extracted the fork side by **parsing the conflict
markers with a regex** and writing back only the captured group. That silently
discarded the file's trailing `});` / `}` — content that sat _outside_ the
conflict block — leaving #627 with a syntactically broken test file. It surfaced
one commit later as a bogus empty-HEAD-side conflict at #639.

The rebase was aborted and redone. `rerere` replayed the five good resolutions
automatically; the poisoned entry for the test file was explicitly cleared with
`git rerere forget` so it cannot silently truncate on a future replay.

**Rule: reconstruct a conflicted file from `git show <commit>:<path>`, never from
marker parsing.** Marker parsing only ever sees the conflicted hunk and drops
everything around it, and the damage lands outside the region you are looking at.
A cheap guard that would have caught it immediately: after resolving, check the
file's brace/paren balance and its tail.

## Fork Feature Verification

| Feature                         | Status | Notes                                                           |
| ------------------------------- | ------ | --------------------------------------------------------------- |
| Shared Spaces                   | OK     | Untouched by this batch                                         |
| Storage Migration               | OK     | Untouched                                                       |
| Pet Detection                   | OK     | Untouched                                                       |
| Image Editing                   | OK     | Untouched                                                       |
| Branding                        | OK     | `gallery-branding-check.sh` passes, incl. #934's new assertions |
| Google Photos Import            | OK     | Untouched                                                       |
| Mobile deferred sync (#513)     | OK     | Preserved; only the `_safeRun` call form changed                |
| Mobile backup = upstream (#892) | OK     | 4 files verified byte-identical to `upstream/main`              |

Automated audits, all green:

- `make upstream-postrebase-audit BATCH=58` — 7/7 OK (fork-owned files, fork
  extension symbols, gallery migration count 49/49, migration manifest coverage,
  timestamp collisions, generated-artifact review)
- `make fork-patches-check` — `@immich/ui` patch metadata consistent
- `make ci-invariants-check` — 3/3 OK
- `make mobile-drift-rebase-check BATCH=58` — schemaVersion / snapshots /
  callbacks consistent

## Database Migration Analysis

**No migrations in this batch.** All three upstream commits are mobile-only.

- Gallery migration count: **49** (unchanged)
- Timestamp collisions: NONE
- Fork-extended schema tables modified by upstream: NONE
- `postbuild` intact: YES — `Synced 49 Gallery migrations …; wrote 1 compatibility aliases`
- `revert-to-immich.sql` coverage: **COMPLETE** (detector run against the
  `v3.1.0` tagged tree, zero `MISSING`)

## Mobile Drift Migration Analysis

No upstream Drift migrations in this batch. `schemaVersion` unchanged, no new
snapshots, no renumbering, no collisions. `mobile-drift-rebase-check` green.

## Generated artifacts

`make open-api` and `make sql` were **deliberately not run**. No controller, DTO
or repository changed (the batch is mobile-only; the fork sync is web/e2e/branding
only), and the post-rebase audit's Generated Artifact Review reported no upstream
generated-artifact changes requiring review. Running `make sql` without a live DB
would have deleted every file under `server/src/queries/`.

## Local CI Verification

| Check                                     | Status | Notes                                                |
| ----------------------------------------- | ------ | ---------------------------------------------------- |
| `server pnpm build` (+ migration sync)    | PASS   | 49 migrations, 1 compatibility alias                 |
| `server pnpm check` (tsc)                 | PASS   |                                                      |
| `mise //:sdk:build`                       | PASS   |                                                      |
| `web check:typescript`                    | PASS   |                                                      |
| `web check:svelte`                        | PASS   | 575 files, 0 errors, 0 warnings (not a 0-file no-op) |
| `server pnpm lint`                        | PASS   |                                                      |
| web eslint (`tscompat` off)               | PASS   | exit 0                                               |
| Server unit tests                         | PASS   | 5266 passed, 14 skipped (158 files)                  |
| Web unit tests                            | PASS   | 4174 passed, 2 skipped, 8 todo (301 files)           |
| **`dart analyze --fatal-infos lib test`** | PASS   | No issues — the gate for both signature widenings    |
| **`mise //mobile:format` equivalent**     | PASS   | 793 files, 0 changed                                 |
| **`flutter test`**                        | PASS   | 3156 passed, 1 skipped                               |
| `gallery-branding-check.sh`               | PASS   |                                                      |
| revert-to-immich coverage detector        | PASS   | 0 missing                                            |

Mobile gates were run with the **pinned Flutter 3.44.8 binaries invoked
directly** (`~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin`),
per the standing note that `mise //mobile:*` resolves 3.41.9 and ignores a `PATH`
override.

`mise.lock` / `mobile/mise.lock`: **not modified** (checked after every local
`mise` invocation).

## Fork Sync

`make upstream-sync-fork-main` cherry-picked `f88830aee40..origin/main` cleanly —
**3 commits, no conflicts, no hand-application**:

| SHA (new)     | Commit                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `5c9d67464d0` | fix(e2e): make asset upload idempotent across vitest retries (#932)               |
| `ce2e62b5b90` | feat(web): search descriptions in the album/space picker (#933)                   |
| `bd82abf18e7` | fix(branding): assert Noodle URLs are present, not just Immich URLs absent (#934) |

`integratedForkHead` advanced to `7763ef94858` (= `origin/main`).

One state-file repair was needed first: last cycle's hand-applied entry recorded
**short SHAs** in `appendHistory[5]`, which the validator rejects
(`must be a full 40-character SHA`). Expanded all 7 to full SHAs.

Per the standing rule that **a clean fork sync is not CI-safe** (the rolling
branch's toolchain is ahead of `main`'s), the full CI suite is being re-dispatched
rather than trusting these commits' green status on `main`.

## Skill Sync Anchor

Scanned `f88830aee40..origin/main`: the 3 fork commits add **no** new fork-only
files, controllers, services, workflows or migrations. #933 touches
`collection-selection-utils.ts` (already covered by the Collection Picker row);
#934 touches `verify-branding.sh` (Branding row); #932 is e2e infrastructure.
Anchor bumped to `7763ef94858`.

## Post-Rebase Verification

- Commits behind `upstream/main`: **0**
- Fork commits ahead: 1096 + 1 reconciliation + 3 fork-sync
- Fork diff vs `upstream/main`: clean and intentional
