# Upstream Sync Report — 2026-09-08 (second cycle: 1 fork commit + 1 upstream commit)

## Summary

- **Fork commits pulled**: 1 — `029446ae0da` (#1083), via `upstream-sync-fork-main`
- **Upstream commits pulled**: 1 — `df7494b49e3..956330958f3`
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Result**: 1475 commits ahead of `upstream/main`, **0 behind**

The point of this cycle is that **#1083 targets a failure that only reproduces on this branch.**
`main` sits under the medium-test connection ceiling and passes either way; the rolling branch is
where `PostgresError: sorry, too many clients already` actually fires. Rolling CI is therefore the
first real test of the fix, not a formality.

## Incoming changes

| SHA           | Source                  | Summary                                             | Area                  | Risk | Notes                                                                                                                   |
| ------------- | ----------------------- | --------------------------------------------------- | --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| `029446ae0da` | fork (#1083)            | raise medium-test Postgres to `max_connections=200` | server (test harness) | LOW  | Applied cleanly despite rolling diverging in the same file (rolling pins the image by digest, `main` uses the bare tag) |
| `956330958f3` | upstream (immich-31341) | `fix(mobile): hide negative age`                    | mobile                | LOW  | Re-types `formatAge` — see below                                                                                        |

### Product-direction gate

**Not fired.** immich-31341 touches the faces/people surface, which is a fork feature area, but it is
a null-guard on an age label — no change to where the feature is going, no model or contract change.

### Pre-rebase detectors

| Detector                                                | Result                          |
| ------------------------------------------------------- | ------------------------------- |
| Shape I — added files / renames onto fork-touched paths | none added, none renamed        |
| Deleted-literal / silent-noop                           | 0 deleted URLs                  |
| i18n branding-override gap                              | batch touches no `i18n/` file   |
| New upstream migrations                                 | none                            |
| Shape S — deleted members the fork still calls          | see the detector-gap note below |

## The one thing worth reading: `formatAge` became nullable

immich-31341 changes `formatAge(DateTime, DateTime)` from returning `String` to **`String?`**, and
updates its own `people_details.widget.dart` call site to null-check the result.

There is a **third call site**, in `mobile/lib/widgets/common/person_sliver_app_bar.dart:305`, which
interpolates the result directly:

```dart
"${DateFormat.yMMMd(...).format(widget.person.birthDate!)} (${formatAge(widget.person.birthDate!, DateTime.now())})"
```

Interpolating a `String?` is legal Dart — it calls `toString()` — so this **compiles, and
`dart analyze --fatal-infos` is silent** (confirmed: the analyzer is clean on this tree). For a
person whose birthdate is after the reference date it will now render `(null)` instead of an age.

**This is upstream's own oversight, inherited verbatim, not something the rebase introduced.**
Upstream's copy of the same file carries the identical line (`upstream/main:…:287`). The fork's
divergence in that file (54 insertions) is elsewhere.

**Decision: left matching upstream.** Fixing it fork-side would add a permanent conflict point in a
file the fork already diverges in, for a cosmetic edge case upstream ships too. Flagged here so it
can be raised upstream or fixed deliberately rather than silently diverged.

## Detector gap found and fixed (skill change)

The Shape S detector added last cycle **reported nothing on this batch, and should have reported
`formatAge`.** Its leading-whitespace class was `[[:space:]]+`, so it only matched **indented**
(class-member) declarations and missed every **top-level** function. immich-31280's deletions were
all class members, which is why it looked correct when it was written.

Fixed to `[[:space:]]*` and **re-proved both ways**: it now reports `formatAge` on this batch, and
still reports all four names that mattered on immich-31280 (`getAll`, `lightImpact`, `vibrate`,
`pruneAssets`) — 108 candidate names instead of 107.

This is the second time this detector's regex has been wrong in the direction of a false negative.
Both times the failure mode was the same: it captured _most_ names and so looked like it worked.

## Conflict Resolutions

None — the rebase was clean. Note that zero conflicts is the case the zero-conflict gate exists for,
which is why the `formatAge` call-site check above was run explicitly rather than inferred from a
quiet rebase.

## Fork Feature Verification

| Feature           | Status | Notes                                                                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| All fork surfaces | OK     | 11 of 13 top-level trees byte-identical to the last CI-validated tip (`f4a6aba8d3d`); only `server` and `mobile` changed, by 3 files total |

`upstream-postrebase-audit` 8/8 OK, `mobile-drift-rebase-check` OK, `fork-patches-check` OK,
`ci-invariants-check` 5/5 OK (Search V3 still dormant), `fork-ownership-coverage-check` OK
(3542 fork files), `rolling-final-check` **PASSES** — the `(#1022)` subject fix survived this
cycle's SHA rewrite.

## Database / Mobile Drift Migration Analysis

No migrations in either commit. Gallery migration count **67 (expected 67)**; no timestamp
collisions; `revert-to-immich.sql` needs no update. Mobile Drift `schemaVersion`, snapshots and
Gallery callbacks consistent.

## Local CI Verification

Scoped by tree identity against `f4a6aba8d3d`. **IDENTICAL, not re-gated**: `web`,
`machine-learning`, `open-api`, `packages`, `i18n`, `.github`, `docker`, `deployment`, `branding`,
`e2e`, `docs`. **CHANGED and gated**: `server`, `mobile`.

| Check                               | Status | Notes                                               |
| ----------------------------------- | ------ | --------------------------------------------------- |
| `server pnpm check` (tsc)           | PASS   | covers `test/` where the fork commit landed         |
| `server pnpm lint`                  | PASS   |                                                     |
| `dart analyze --fatal-infos`        | PASS   | after regenerating drift schema codegen — see below |
| `dart format --set-exit-if-changed` | PASS   |                                                     |
| `flutter test` (Flutter 3.47.2)     | PASS   | **3820 passed**, 1 skipped                          |
| `commit-autolink-check`             | PASS   | 1475 messages, fork PR ceiling 1083                 |

**The stale-codegen trap fired again.** The first `dart analyze` failed with 5
`uri_does_not_exist` errors for `test/drift/main/generated/schema_v32..v36.dart`. That directory is
gitignored codegen; regenerating it
(`dart run drift_dev schema generate --data-classes --companions drift_schemas/main/ test/drift/main/generated/`)
cleared all 5. It is a local-environment artefact, **not** a branch defect — and worth catching,
because a stale copy of that directory silently masks a large share of the mobile suite. The suite
reports 3820 tests, matching the previous cycle.

Server unit tests and both web suites were **not** re-run: `web` is byte-identical, and the only
`server` delta is a testcontainers flag that no unit test reads. The medium suite, which is the one
the change targets, is exercised by CI below.

## Remote CI Verification

_(filled in after dispatch — see the follow-up commit)_

## Post-Rebase Verification

- Fork commits ahead of upstream: **1475**
- Commits behind upstream: **0**
- Fork diff clean: YES

## Note on batch numbering

The planner numbered this cycle **batch 228** — the same number the previous cycle used for tip
`df7494b49e3`. Batch numbers are derived from the pending range at plan time, not from persistent
history, so they are not unique across cycles. Identify a batch by its **tip SHA**
(`956330958f3` here) rather than its number.
