# Upstream Sync Report — 2026-07-27

## Summary

- **Upstream commits pulled**: 6 (`3606144190f` → `8aa95c67470`) — upstream tagged **v3.1.0**
- **Batches**: 52, 53, 54
- **Fork commits synced**: 2 (#860, #863)
- **Conflicts resolved**: 12 distinct files (plus ~50 mechanically-merged locale files)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED

This cycle contained **no server, schema, migration, or mobile Drift changes**. It was
mobile + toolchain + i18n + a version bump. The fork base moves from Immich **v3.0.3** to
**v3.1.0**.

## Incoming Upstream Changes

| SHA           | Summary                                                                      | Area         | Risk to Fork | Notes                                                                                      |
| ------------- | ---------------------------------------------------------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `e3385ce1837` | chore(mobile): harden mobile OpenAPI codegen and dependency install (#30202) | CI/toolchain | **HIGH**     | Rewrites `generate-dart-sdk.sh`, trims `mobile/mise.lock`, edits 4 fork-modified workflows |
| `04a38ba91c2` | refactor: asset update method (#30201)                                       | mobile       | **MEDIUM**   | 32 files; relocates mocks, widens `addAssets` return type                                  |
| `e5310e2d2cd` | chore(web): update translations (#29781)                                     | i18n         | **MEDIUM**   | 61 locale files; ~50 carry fork branding                                                   |
| `8aa95c67470` | chore: version v3.1.0                                                        | release      | LOW          | Triggers version-reference updates                                                         |
| `e6f8256b259` | fix(mobile): prevent timeline scroll to top on unrelated pages (#30281)      | mobile       | LOW-MED      | `timeline.widget.dart` — fork extends timeline grouping                                    |
| `bc6bf388c01` | fix(web): single grid row spacing (#30277)                                   | web          | LOW          | 3 lines of CSS                                                                             |

### High-Risk Changes (detailed analysis)

#### `e3385ce1837` — mobile OpenAPI codegen hardening (#30202)

Upstream replaced the "`wget` the template from GitHub, patch it in place, commit the
patched template" flow with "generate a pristine template into a temp dir via
`openapi-generator-cli author template`, patch it there". It **deleted** the checked-in
`open-api/templates/mobile/api.mustache` and `.../native_class.mustache`, and pinned the
generator CLI in `mise.toml` (`npm:@openapitools/openapi-generator-cli = 2.40.1`).

Two fork-specific hazards:

1. **The fork applies a third, fork-only patch** —
   `native_class_nullable_items_in_arrays.patch` (types nullable-item arrays as
   `List<T?>`, fork issue #743 item 3). Upstream's rewritten script has no slot for it, so
   a clean "take upstream" resolution would silently drop it. It was re-inserted against
   `$TEMPLATE_DIR`, **after** `native_class.mustache.patch` (its hunks are authored against
   the already-patched template).
2. **Codegen now runs on every mobile CI job.** `mobile/mise.toml`'s `install` task gained
   `depends = ["//:open-api-dart"]`, so `mise //mobile:install:ci` regenerates the Dart
   client in `test.yml`, `static_analysis.yml`, `build-mobile.yml` and `check-openapi.yml`.
   The fork's patches are therefore load-bearing at CI time, not just at authoring time.

**Verified locally**: `mise run //:open-api-dart` completes cleanly, all fork patches apply,
and the regenerated `mobile/openapi/` is **byte-identical** to the committed client
(`git status -- mobile/openapi` empty). The generator resolved to **7.24.0** — the same
version the fork's patches were authored against — so the CLI version pin does not shift the
template out from under them.

The checked-in `native_class.mustache` deletion is safe: the fork's civil-date fix (#584,
which originally edited the template directly) is carried by the fork's **extended**
`native_class.mustache.patch` (2710 B vs upstream's 1068 B), not by the generated artifact.

#### `04a38ba91c2` — asset update refactor (#30201)

Internal refactor toward upstream's own "action migration" (their `TODO(shenlong): remove
after action migration` markers). Fork impact was confined to test wiring plus one
signature widening:

- `mobile/test/domain/service.mock.dart` was **deleted**; its mocks moved to
  `mobile/test/service.mocks.dart`. The fork's only addition there
  (`MockBackgroundBackupStatusService`, used by one test) was moved to follow upstream's
  consolidation rather than resurrecting a file upstream deliberately removed.
- `RemoteAlbumNotifier.addAssets` widened from `Future<int>` to
  `Future<({int added, int failed})>` — see the fork-sync section below.
- `handleError(BuildContext, ...)` → `handleError(Object, ...)`: the only fork call site is
  `action.widget.dart`, which upstream updates itself. Verified no other fork usage.
- `Option.flatMap` / `Option.ifPresent` removed: verified **zero** fork usages.

#### `e5310e2d2cd` — Weblate translation sync (#29781)

61 locale files, ~50 of which carry the fork's branded location-disclosure copy. Resolved
as a proper 3-way JSON merge per file — take upstream's translations, then re-apply exactly
the keys the fork had changed relative to the merge base. Verified against a pre-rebase
baseline snapshot:

| Metric                      | Before | After |
| --------------------------- | -----: | ----: |
| "Noodle Gallery" strings    |    201 |   201 |
| Fork-only key instances     |   7011 |  7011 |
| Locale files with any delta |      — |     0 |

One genuine regression surfaced that a loss-only check would have missed — see
"Inconsistencies Found".

## Product-Direction Gate

**Did not fire.** No commit reworks sharing, access, sync, albums, people, or any other fork
product surface. #30201 is upstream refactoring its own action layer; that is
pattern-propagation debt, not a competing product model. Logged under "Pattern Propagation".

## Conflict Resolutions

### Batch 52 (`e3385ce1837`)

#### Conflict: `.github/workflows/build-mobile.yml`

- **Fork side**: inserts `- uses: ./.github/actions/apply-branding` before the dependency install
- **Upstream side**: replaces `flutter pub get` with `mise //mobile:install:ci`
- **Resolution**: union — fork's `apply-branding` step, then upstream's new install step
- **Risk**: LOW — the sibling job at line ~117 auto-merged to the same shape
- **Verification**: both jobs inspected; `apply-branding` still precedes every build step

#### Conflict: `open-api/templates/mobile/serialization/native/native_class.mustache` (×4, modify/delete)

- **Fork side**: fork commits edit the checked-in patched template (#584 and later re-derivations)
- **Upstream side**: file deleted; template is now generated into a temp dir
- **Resolution**: accept the deletion. The semantic content lives in the fork's extended
  `native_class.mustache.patch` and in `native_class_nullable_items_in_arrays.patch`
- **Risk**: MEDIUM → retired by verification
- **Verification**: full `mise run //:open-api-dart`; regenerated client byte-identical

#### Conflict: `open-api/bin/generate-dart-sdk.sh`

- **Fork side**: applies `native_class_nullable_items_in_arrays.patch` after the upstream patch
- **Upstream side**: whole-script rewrite to `author template` + `$TEMPLATE_DIR`
- **Resolution**: take upstream's flow, re-insert the fork patch line against `$TEMPLATE_DIR`
  immediately after `native_class.mustache.patch`
- **Risk**: HIGH → retired by verification (byte-identical regeneration)

#### Auto-merged, but load-bearing: `mobile/mise.lock`

Upstream removed `[[tools.java]]` entirely and every non-`macos-arm64` platform block for
`homebrew-dcm`. Git's 3-way merge produced the **union**: the fork's java (5 platforms) and
dcm (7 platforms) blocks retained, plus upstream's new `openapi-generator-cli` entry. This is
the desired outcome — upstream still declares `java = "21.0.2"` in `mobile/mise.toml` and
still runs `Setup Mise` with `working_directory: ./mobile` on `ubuntu-latest`, and this branch
has a history of dying at `mise install --locked` with `<tool>@<ver> is not in the lockfile`
when those blocks go missing. A superset lockfile cannot produce a missing-entry error.
The fork-only `gallery-mobile-smoke.yml` also uses `working_directory: ./mobile`.

### Batch 53 (`e5310e2d2cd`)

#### Conflict: `mobile/test/services/action.service_test.dart`

- **Fork side**: adds `MockSharedSpaceApiRepository` + import alongside `MockDownloadRepository`
- **Upstream side**: removes the local `MockDownloadRepository` (moved to `repository.mocks.dart`)
- **Resolution**: keep only the fork's shared-space additions; drop the local download mock
- **Risk**: LOW — verified `MockDownloadRepository` is now exported from `repository.mocks.dart`,
  which the test already imports

#### Conflict: `mobile/lib/repositories/asset_api.repository.dart`

- **Fork side**: a uniform `return` → `await` style pass over 6 methods (incidental to #414)
- **Upstream side**: relocates `updateFavorite`/`updateLocation`/`updateDateTime` to the class
  tail under a `TODO(shenlong): remove after action migration` marker
- **Resolution**: take upstream's structure. `return future;` and `await future;` are
  semantically identical in an `async Future<void>`, and re-diverging code upstream plans to
  delete would add conflict surface for no gain. The fork's `await` style survives at the four
  auto-merged sites
- **Risk**: LOW — verified each method is defined exactly once

#### Conflict: `mobile/test/domain/service.mock.dart` (modify/delete)

- **Fork side**: adds `MockBackgroundBackupStatusService`
- **Upstream side**: file deleted; contents consolidated into `mobile/test/service.mocks.dart`
- **Resolution**: follow the consolidation — delete the file, add the fork mock (and its import)
  to `service.mocks.dart`, repoint the one importing test, and fix relative-import ordering for
  `directives_ordering`
- **Risk**: LOW — verified the fork test needs only that one symbol; no other importers remain

#### Conflict: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` (×2)

- **Fork side**: #681 deleted `handleStatusBarTap()`; a later reconcile commit re-added the
  one-line `=> _scrollToTop()` form
- **Upstream side**: #30281 expands it to skip scrolling unless the timeline is the current route
- **Resolution**: keep upstream's route-aware version at both conflict points, so the fix is not
  overwritten by the later fork reconcile commit
- **Risk**: LOW — verified exactly one definition survives and the `auto_route` import is present

#### Conflicts: `i18n/*.json` (~50 files)

- **Fork side**: branded location-disclosure copy for 4 keys (app-store privacy requirement)
- **Upstream side**: Weblate retranslation across the whole file
- **Resolution**: scripted 3-way JSON merge — upstream's file, then re-apply exactly the keys
  changed between merge-base and fork. Output verified to differ from upstream by only the
  intended keys, with no formatting or ordering drift
- **Risk**: MEDIUM → see "Inconsistencies Found" for the case this did not cover

### Batch 54 (`8aa95c67470`)

#### Conflict: `mobile/pubspec.yaml`

- **Fork side**: `version: 1.0.0+1`; **Upstream side**: `version: 3.1.0+3057`
- **Resolution**: keep the fork's. The fork ships as its own app (`de.opennoodle.gallery`) and
  `apply-branding.sh` stamps `${FORK_VERSION}+${build_number}` at build time
- **Risk**: LOW — recurring, expected conflict

#### Conflict: `mobile/ios/Runner/Info.plist`

- **Fork side**: `CFBundleShortVersionString 3.0.0` / `CFBundleVersion 240`, tab-indented
- **Upstream side**: version `3.0.3` → `3.1.0`
- **Resolution**: keep the fork's file verbatim (whole-file conflict caused by the fork's
  reindentation; the only semantic delta is the fork's own version numbers)
- **Risk**: LOW — consistent with the pubspec decision

## Fork Sync (#860, #863)

`make upstream-sync-fork-main` cherry-picked both commits with **zero conflicts** — including
#863, which touches the same mobile actions layer #30201 refactored. But a clean sync is not
CI-safe, and this is the **sixth** occurrence of "green on `main`, red on the rolling branch":
#863 was authored against `origin/main`, whose generated Dart client and `RemoteAlbumNotifier`
predate this branch's upstream batches. `dart analyze --fatal-infos` reported **9 errors**:

| Symptom                                                                | Cause                                                                                                                 | Fix                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `UserAvatarColor.value` / `SyncRequestType.value` undefined (8 errors) | Generated OpenAPI enums are now real Dart `enum`s with a **private** `_value`; the old shape exposed a public `value` | Use the established `toJson()` accessor for the wire value              |
| `_StubRemoteAlbumNotifier.addAssets` invalid override (1 error)        | Upstream #30201 widened `RemoteAlbumNotifier.addAssets` to `Future<({int added, int failed})>`                        | Return `(added: …, failed: 0)`; the stub's return value is not asserted |

Fixed in `e0d9c1526df`.

## Inconsistencies Found

**Weblate newly added the four location-disclosure keys to `i18n/bn.json`** (Bengali gained
+1728 lines this sync) carrying a translation of _upstream's short_ disclosure. This is the
inverse of the usual flake: nothing was lost, so a loss-only comparison reported no
regression — but the fork's app-store policy gate
(`mobile/test/policy/location_disclosure_copy_test.dart`) requires every locale that carries
these keys to say "Noodle Gallery" and never "Immich". It failed 4 tests.

**Resolution**: drop those 4 keys from `bn.json`. With `useFallbackTranslations: true`,
Bengali now falls back to the branded English disclosure — matching the **35 other locales**
that already omit these keys. That shows a complete, accurate disclosure rather than a
Bengali one missing the legally-required privacy statements. A native Bengali translation can
be added later alongside the other 54 localised disclosures.

**Lesson for the next sync**: check both directions — fork keys _lost_, and unbranded upstream
keys _gained_.

## Pattern Propagation

| Refactor                                | Old → New Pattern                                                     | Fork Files Affected             | Decision | Commit / Follow-up                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile test mock consolidation (#30201) | `test/domain/service.mock.dart` → `test/service.mocks.dart`           | 2                               | Bundled  | batch 53 resolution                                                                                                                         |
| Upstream "action migration" (#30201)    | direct repository calls → unified `updateAll` with `Option<T>` params | fork space/album actions (#863) | Deferred | Not yet required; upstream's own migration is incomplete (`TODO(shenlong)` markers). Revisit when upstream removes the transitional methods |

## Database Migration Analysis

**No upstream migrations in this range.** `git diff v3.0.3..upstream/main --
server/src/schema/migrations/` is empty, and the pending range touches no file under
`server/`.

- Gallery migration count: unchanged; manifest coverage OK
- Timestamp collisions: none
- `postbuild` sync + `CompositeMigrationProvider`: intact (audit OK on all three batches)
- **`revert-to-immich.sql`**: no change needed. Because v3.0.3→v3.1.0 adds no upstream
  migrations, bumping `branding/config.json` moves nothing between the "in-tag" and
  "post-tag" sets. Coverage detector re-run against `v3.1.0`: **0 missing**

## Mobile Drift Migration Analysis

**No changes.** `db.repository.dart` and `mobile/drift_schemas/` are untouched by the pending
range. `make mobile-drift-rebase-check` OK on batches 52, 53 and 54.

## Version References Updated

| File                                                    | Change                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `branding/config.json`                                  | `upstream.version` `3.0.3` → `3.1.0` (one-line; key order preserved)             |
| `README.md`                                             | "Currently based on **Immich v3.1.0**"                                           |
| `tools/upstream-preflight/src/branding-targets.spec.ts` | M8 gate re-pinned to `3.1.0`, comment updated to record the zero-migration delta |

Marketing site (`apps/marketing/src/pages/index.astro` in the `platform` repo) is **not** yet
updated — it is a separate repo and a separate deploy.

## Fork Feature Verification

| Feature              | Status | Notes                                        |
| -------------------- | ------ | -------------------------------------------- |
| Shared Spaces        | OK     | #863 space-edit sheet reconciled and passing |
| Storage Migration    | OK     | untouched                                    |
| Pet Detection        | OK     | untouched                                    |
| Image Editing        | OK     | untouched                                    |
| Branding             | OK     | i18n branding invariant verified 201/201     |
| Google Photos Import | OK     | untouched                                    |
| Mobile Drift sync    | OK     | drift check OK                               |
| Dart client patches  | OK     | regeneration byte-identical                  |

## CI and Infrastructure Verification

| Check                                      | Status | Notes                                                     |
| ------------------------------------------ | ------ | --------------------------------------------------------- |
| Workflow files (no upstream collisions)    | OK     | `ci-invariants-check` passed on 52 and 54                 |
| Docker image references                    | OK     | `gallery-release-image-names` passed                      |
| Branding (no Immich leaks in CI)           | OK     | `no-push-o-matic` passed                                  |
| Fork CI modifications intact               | OK     | `apply-branding` step preserved in both mobile build jobs |
| `mise.lock` / `mobile/mise.lock` integrity | OK     | fork platform blocks retained (union merge)               |
| `@immich/ui` patch                         | OK     | `fork-patches-check` passed                               |

## Local CI Verification

| Check                                                   | Status | Notes                            |
| ------------------------------------------------------- | ------ | -------------------------------- |
| `server pnpm build` (+ postbuild migration sync)        | PASS   |                                  |
| `server pnpm check` (tsc)                               | PASS   |                                  |
| `server pnpm lint`                                      | PASS   | `--max-warnings 0`               |
| Server unit tests                                       | PASS   | 5206 passed, 1 file skipped      |
| `web check:typescript`                                  | PASS   |                                  |
| `web check:svelte`                                      | PASS   | 571 files, 0 errors, 0 warnings  |
| web eslint (`tscompat` off)                             | PASS   | 0 errors                         |
| Web unit tests                                          | PASS   | 3952 passed                      |
| e2e eslint + tsc                                        | PASS   |                                  |
| mobile `dart analyze --fatal-infos`                     | PASS   | after the #863 reconcile         |
| mobile `dart format` (CI scope: `lib`, excl. generated) | PASS   | 806 files, 0 changed             |
| mobile `flutter test`                                   | PASS   | 2974 passed                      |
| Dart client regeneration                                | PASS   | byte-identical; generator 7.24.0 |
| `upstream-preflight` tooling tests                      | PASS   | 235 passed                       |
| `revert-to-immich` coverage detector                    | PASS   | 0 missing vs `v3.1.0`            |

`make sql` was not run: no repository method changed, and the audit's Generated Artifact
Review is clean. `make open-api` (TypeScript) was not needed: no controller/DTO changed.

### Note on `dart format` scope

CI's format gate is `mise //mobile:format`, which covers **`lib/` only**, excluding generated
files — not `test/`. Running the formatter over `lib test` reports ~30 changed files under
`mobile/test/`; that is pre-existing, unenforced drift, not a regression from this rebase.

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-2026-07-27`
- **Commit validated**: `1a5b874ae82` (everything below ran against this SHA; only this report
  section was appended afterwards)

| Workflow                                  | Status  | Notes                                                                 |
| ----------------------------------------- | ------- | --------------------------------------------------------------------- |
| `test.yml`                                | GREEN   | full 21-job suite                                                     |
| `docker.yml`                              | GREEN   | validates the Dockerfile + pnpm/lockfile and mise changes             |
| `static_analysis.yml`                     | GREEN   | `dart analyze --fatal-infos`, `dart format`, generated-file freshness |
| `gallery-build-mobile.yml`                | GREEN   | iOS + Android compile                                                 |
| `gallery-mobile-smoke.yml`                | GREEN   | Android codegen/analyze smoke                                         |
| `gallery-ml-smoke.yml`                    | GREEN   |                                                                       |
| `gallery-rebase-smoke.yml`                | GREEN   |                                                                       |
| `storage-migration-tests.yml`             | GREEN   |                                                                       |
| `storage-migration-e2e.yml`               | GREEN   |                                                                       |
| `gallery-revert-to-immich-validation.yml` | **RED** | upstream-blocked, not a code defect — see below                       |

**9 / 10 green, first try, no flakes and no re-runs.**

### The one failure is an upstream release-timing issue, not a code defect

`gallery-revert-to-immich-validation` fails at:

```
pre: pull ghcr.io/immich-app/immich-server:v3.1.0
Error response from daemon: manifest unknown
```

Upstream tagged `v3.1.0` in git (`8aa95c67470`) but has **not cut the release**: there is no
GitHub Release for v3.1.0 (their latest published release is still v3.0.3 from 2026-07-15) and
`ghcr.io/immich-app/immich-server:v3.1.0` returns **404** while `v3.0.3` returns 200. The
workflow derives its pull tag from `branding/config.json` → `upstream.version`, which this
cycle bumped to `3.1.0`.

The **coverage half of the gate passes** — the local detector reports 0 missing entries against
`v3.1.0`, and no upstream migrations exist in the v3.0.3→v3.1.0 delta, so `revert-to-immich.sql`
genuinely needs no change.

**Decision (maintainer)**: keep `upstream.version` at `3.1.0` and re-dispatch this workflow once
Immich publishes the v3.1.0 image. The alternative — reverting the reference to `3.0.3` — would
also be correct, since the zero-migration delta means the revert path is identical either way.

## Staging RC Validation

- **RC tag**: `rolling-v310-rc1` (`gallery-rc-build.yml` run 30304866204, server-only, both arches)
- **ML**: left at `v5.1.1` — `machine-learning/` differs from the pin only by the version string
  (`3.0.3` → `3.1.0` in `pyproject.toml` + `uv.lock`); no source, dependency or Dockerfile change
- **gitops**: `infra-gitops` `1a75f1e` pinned `apps/staging/server.yaml`
- **Served pod image verified directly** (not via `rollout status`, which has a known
  false-positive): `gallery-server-656bd5cf87-29jvc` → `…/gallery-server:rolling-v310-rc1`

### Migration + schema validation on a real populated DB

Pre-flight parity check found no boot-blocking orphans (the only orphan,
`1776735180298-ChangeDurationToInteger`, is the known-benign `compatibilityAliases` case). Two
migrations were expected to apply, and both did:

```
Migration "1784647658615-AddOAuthBearerTokenToSession" succeeded
Migration "1784836013770-MinFacePreferenceMigration" succeeded
Finished running migrations
No schema drift detected      <- Microservices worker
No schema drift detected      <- Api worker
```

### Fork surface smoke (temp api_key, since removed)

| Endpoint                                   | Result                                      |
| ------------------------------------------ | ------------------------------------------- |
| `GET /server/ml-health`                    | 200 `{"smartSearchHealthy":true}`           |
| `GET /shared-spaces`                       | 200                                         |
| `GET /albums`                              | 200                                         |
| `GET /people?withSharedSpaces=true`        | 200 — 362 people                            |
| `GET /gallery/map/markers` (fork-only)     | 200 with markers                            |
| `GET /timeline/buckets`                    | 200                                         |
| `GET /search/suggestions?type=camera-make` | 200                                         |
| `POST /search/smart "beach"`               | 200 — 100 assets (CLIP + vector end-to-end) |
| `GET /` (web)                              | 200, 9786 bytes                             |

Server self-reports `v5.2.2` (git describe nearest tag) — expected for an RC, not a bad build.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1010
- Commits behind upstream: **0**
- Fork commits pending from `origin/main`: **0**
- Rolling state: 54 / 54 batches, `integratedForkHead` = `04ef97010`
- Working tree: clean
