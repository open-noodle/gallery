# Upstream Sync Report — 2026-08-29 (batches 197–198)

## Summary

- **Upstream commits pulled**: 3 (`1a8fcf1b9f9..469a870a223`)
- **Fork commits synced from `origin/main`**: 1 (#1037)
- **Conflicts resolved**: 5 fork commits (9 hunks), plus 1 modify/delete
- **Risk level**: LOW
- **Recommendation**: PROCEED (stay off `main` — see Landing below)

Rolling branch `rebase/upstream-rolling-v3.1.1` is **level with upstream**:
**0 behind / 1393 ahead** of `upstream/main` `469a870a223`.

## Incoming Upstream Changes

| SHA           | Summary                                                       | Area   | Risk to Fork | Notes                                                                     |
| ------------- | ------------------------------------------------------------- | ------ | ------------ | ------------------------------------------------------------------------- |
| `6b478924b25` | fix(e2e): wait out the duplicate `#asset-grid` during nav     | e2e    | LOW          | One `toHaveCount(1)` line in a helper the fork also extends; auto-merged. |
| `dc813e28167` | fix(mobile): transient loading states for map timelines       | mobile | **MEDIUM**   | Renames + reshapes the map timeline query. See below.                     |
| `469a870a223` | fix: generate release notes from the previous release on line | CI     | LOW          | Modifies `draft-release.yml`, which the fork deletes. Deletion kept.      |

### Product-direction gate

**Not fired.** None of the three introduces or reworks a feature that overlaps a fork
product surface:

- `dc813e28167` touches mobile timeline — a fork surface — but it is a bugfix plus a local
  refactor of one query path, not a new feature, access model, or sync contract. The
  reconciliation is mechanical.
- `469a870a223` is upstream's own release automation, on a workflow the fork already
  removed by policy (`06b2bd427a5`: it authenticates with the immich-app `PUSH_O_MATIC`
  app and calls `immich-app/devtools`, neither of which exists here). Upstream's change
  does not alter that intent, so the fork rule was re-derived and the deletion kept.

### Pre-rebase detectors (all clean)

| Detector                                              | Result                             |
| ----------------------------------------------------- | ---------------------------------- |
| Silent-noop literals (deleted URLs vs fork tooling)   | no hits                            |
| Shape I — upstream adds a file onto a fork-owned path | no adds in range                   |
| Shape I — upstream renames onto a fork path           | no renames in range                |
| i18n branding-override gap                            | no gaps                            |
| Zero-byte tracked files                               | 3, all pre-existing and deliberate |

`CODEOWNERS`, `docs/static/.nojekyll` and `docs/static/CNAME` are empty on `origin/main`
and on the previous tip too — `CODEOWNERS` is deliberately emptied by the fork because
upstream's version points at immich-app teams.

## The one substantive change — immich-29735

`dc813e28167` does three things the fork depends on:

1. Moves `TimelineMapOptions` out of `infrastructure/repositories/timeline.repository.dart`
   into `domain/models/map.model.dart`, converting it to a freezed class.
2. Renames `TimelineFactory.map` / `TimelineRepository.map` to `geographicMap`.
3. Replaces the single-snapshot options argument with a
   `TimelineMapOptions Function() currentOptions` plus a
   `Stream<TimelineMapOptions> optionsStream`, so a map pan no longer rebuilds the
   timeline service — the new bounds travel down the stream instead.

The fork's version of the same methods carries two additions upstream does not have:
a `currentUserId` positional (shared-space visibility, #337) and `groupBy` /
`temporalScope` named parameters (#625). Both were carried onto upstream's new shape.

## Conflict Resolutions

### `2fdb5a07c3a` — fix(mobile): shared-space visibility for video, place, map, marker queries (#337)

| File                           | Fork side                       | Upstream side                      | Resolution                                               | Risk |
| ------------------------------ | ------------------------------- | ---------------------------------- | -------------------------------------------------------- | ---- |
| `map.repository.dart`          | adds `viewer_visibility` import | drops `timeline.repository` import | keep both intents: drop the old import, keep the new one | LOW  |
| `timeline.service.dart`        | adds `currentUserId`            | `map` → `geographicMap` + stream   | fork's delta applied onto upstream's shape               | LOW  |
| `timeline.repository.dart`     | adds `currentUserId`            | same rename + `switchMap` body     | fork's delta applied onto upstream's shape               | LOW  |
| `map_bottom_sheet.widget.dart` | passes `user.id`                | passes options fn + stream         | both                                                     | LOW  |

**Verification**: `maplibre_gl` is genuinely unused in `timeline.repository.dart` after the
resolution (upstream moved `LatLngBounds` behind `map.model.dart`); confirmed by grep and
by `dart analyze`.

### `d309d1e4933` — feat: add timeline grouping display modes (#625)

The fork widens both methods with `GroupAssetsBy? groupBy` and `TimelineTemporalScope
temporalScope`. Merged onto upstream's `geographicMap`, threading `temporalScope` into
both `_watchMapBucket` (inside the new `switchMap`) and `_getMapBucketAssets`. Risk: LOW —
each parameter has one call path and `dart analyze` covers the arity.

### `00c4c1d8524` — feat(mobile): timeline grouping pill on the map bottom sheet (#684)

The most interesting one. The fork replaces `ProviderScope(overrides: [...])` with its own
`TimelineRouteScope(timelineServiceBuilder: (ref, scope, groupBy) {...})`; upstream
rewrites the _body_ of that same block to build the options stream.

Resolution: keep the fork's `TimelineRouteScope` structure, move upstream's stream wiring
inside the builder, and take upstream's `mapStateProvider.select((s) => s.withPartners)`
narrowing. `TimelineRouteScope` already calls `ref.onDispose(service.dispose)`, so
upstream's explicit dispose is redundant and was dropped.

**Both sides carried a "this flickers on every map move" TODO.** Upstream _deleted_ theirs
because this commit fixes it; the fork had merely reworded theirs. The resolution takes
upstream's deletion — the comment now describes a problem that no longer exists. Risk:
MEDIUM, and it is the one resolution backed by a behavioural test (below).

### `cbda1711779` — fix(mobile): repoint fork imports onto the relocated Drift layout

Import-block conflict only: the fork deletes the old-layout imports, HEAD carried them plus
the `map.model.dart` import added earlier in this cycle. Kept `map.model.dart`, dropped the
rest. Risk: LOW.

### `06b2bd427a5` — ci: drop upstream's new release-line workflows (modify/delete)

`git rm` — the fork's deletion wins. See the product-direction gate above. Risk: LOW.
`git checkout --theirs` would have written a zero-byte workflow file here, which Actions
reads as invalid; the post-batch zero-byte scan confirms none exists.

## Zero-conflict breaks found (the ones no conflict marker showed)

Two, both in fork-only code, both mobile:

1. **Eight `TimelineRepository.map(...)` / `TimelineFactory.map(...)` call sites in four
   fork-only test files** never conflicted, because the fork commits that added them come
   _after_ the commit whose conflict carried the rename. Three surfaced in the first sweep;
   the other five were hidden behind drift-generated `.map(` noise in the same grep and
   only `dart analyze` found them. **`grep` for a renamed method is unreliable when the old
   name is also a collection method** — run the analyzer, do not trust the grep.
2. **`TimelineMapOptions` moved libraries**, so four fork-only files importing it from
   `timeline.repository.dart` silently lost the type. Two needed the new import added, two
   needed the old one removed as newly-unused (`--fatal-infos` treats that as fatal).

Both are the documented "signature/type change breaks fork code in a different file"
shape. Neither had a conflict, and the post-rebase audit was green through both.

### A fork test that asserted behaviour upstream deliberately removed

`map_bottom_sheet_timeline_test.dart` had a test named _"grouping selection survives a map
move"_ whose mechanism was: pan the map, assert the timeline service is **rebuilt** with the
grouping still at month. immich-29735 removes exactly that rebuild.

The test was rewritten to assert the new contract — it captures the options stream handed
to `geographicMap`, pans, and asserts the panned bounds arrive on that stream while
`verifyNever` proves no rebuild happened. The fork's original intent (route-local grouping
survives a pan) is preserved: no rebuild means the route scope is never torn down.

**Proved red** by commenting out `optionsController.add(newOptions)` in the widget —
`Actual: []` against the expected bounds — then restored.

## Fork Feature Verification

| Feature                            | Status | Notes                                                                  |
| ---------------------------------- | ------ | ---------------------------------------------------------------------- |
| Shared Spaces                      | OK     | `currentUserId` visibility arg carried through both map query methods. |
| Timeline grouping / temporal scope | OK     | `groupBy` + `temporalScope` carried; 3488 mobile tests pass.           |
| Storage Migration                  | OK     | `server/` tree byte-identical to the last 10/10-green tip.             |
| Pet Detection                      | OK     | idem                                                                   |
| Image Editing                      | OK     | idem                                                                   |
| Branding                           | OK     | `branding/` tree byte-identical; i18n override detector clean.         |
| Google Photos Import               | OK     | `web/` tree byte-identical.                                            |
| Search V3 (dormant)                | OK     | `search-v3-not-dispatched` invariant green.                            |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                      |
| ----------------------------------------- | ------ | ---------------------------------------------------------- |
| Workflow files (no upstream collisions)   | OK     | `.github/` tree byte-identical to the last green tip.      |
| Docker image references                   | OK     | `gallery-release-image-names` invariant green.             |
| Branding (no upstream-name leaks)         | OK     | i18n override detector clean.                              |
| Fork CI modifications intact              | OK     | `ci-invariants-check` 5/5.                                 |
| New upstream workflows reviewed           | OK     | `draft-release.yml` stays deleted, intent re-derived.      |
| Zero-byte workflow files                  | OK     | none.                                                      |
| `@immich/ui` patch in effect              | OK     | `fork-patches-check` green.                                |
| Commit autolinks                          | OK     | 1393 messages scanned, none cross-repo.                    |
| `revert-to-immich.sql` migration coverage | OK     | no new migrations; all 62 fork + post-tag entries present. |

## Database Migration Analysis

No new upstream migrations in this range. Gallery migration count 62 (expected 62); no
timestamp collisions; postbuild merge and `CompositeMigrationProvider` untouched
(`server/` tree byte-identical).

## Mobile Drift Migration Analysis

No `schemaVersion` change. `mobile-drift-rebase-check` green: schemaVersion, snapshots and
Gallery callbacks consistent. `drift_dev make-migrations` regenerated with **no snapshot
drift**, which is the Shape L detector — a broken import after a relocation shows up there
as a refusal to rewrite the newest snapshot, and it did not.

The Shape L import-resolution sweep over `mobile/lib` + `mobile/test` reported no
unresolvable `package:immich_mobile/...` targets.

## Pattern Propagation

None. No broad upstream refactor in this range.

## Local CI Verification

The delta from the previous **10/10-green** tip (`b96cb896ed3`) is 18 files: 8 `mobile/lib`,
5 `mobile/test`, 1 `e2e/src`, 4 `docs/docs`. `server`, `web`, `machine-learning`,
`open-api`, `packages`, `i18n`, `.github`, `docker`, `deployment` and `branding` are
**byte-identical** (verified by tree SHA), so their gates are redundant this cycle.

| Check                                       | Status | Notes                                    |
| ------------------------------------------- | ------ | ---------------------------------------- |
| `dart analyze --fatal-infos` (lib + test)   | PASS   | "No issues found!"                       |
| `dart format` gate (`mise //mobile:format`) | PASS   | one file reformatted, then clean         |
| `flutter test` (full mobile suite)          | PASS   | 3488 passed, 1 skipped                   |
| `drift_dev make-migrations`                 | PASS   | no snapshot drift                        |
| e2e `tsc --noEmit`                          | PASS   |                                          |
| e2e prettier + eslint (changed file)        | PASS   |                                          |
| `docs/**` prettier                          | PASS   |                                          |
| `upstream-postrebase-audit` 197 / 198       | PASS   | 7/7 checks each                          |
| `ci-invariants-check`                       | PASS   | 5/5                                      |
| `fork-patches-check`                        | PASS   |                                          |
| `mobile-drift-rebase-check`                 | PASS   |                                          |
| `commit-autolink-check`                     | PASS   |                                          |
| `make sql` / `make open-api`                | N/A    | no repository, controller or DTO changed |

## Remote CI Verification

Filled in after the dispatch — see the follow-up commit.

## Landing

**Stays off `main`.** Upstream's latest stable tag is still `v3.1.0`, which
`branding/config.json` already carries; `v3.2.0-rc.0` / `v3.2.0-rc.1` are release
candidates, not the tag the standing rule requires. Nothing to decide.
