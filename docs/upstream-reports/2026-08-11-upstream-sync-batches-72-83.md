# Upstream Sync Report — 2026-08-11 (batches 72–83)

## Summary

- **Upstream commits pulled**: 20 (`0ff47f41785..00d10dab639`)
- **Fork commits synced**: 1 (#976)
- **Conflicts resolved**: 31 across 12 rebase steps
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED
- **Landed on `main`?** No — newest upstream tag is still `v3.1.0`, so the standing
  rule (tagged release **and** thorough validation) is unmet.

|                    |                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Branch             | `rebase/upstream-rolling-v3.1.1`                                                                                                         |
| Branch HEAD        | `f823e2bd9cf`                                                                                                                            |
| Upstream base      | `00d10dab639` (`refactor: e2e user tests (#30716)`)                                                                                      |
| Ahead / behind     | 1135 / 1 (see "Drift during the cycle")                                                                                                  |
| Fork cursor        | `f4e6e87e9c0` (#968) → **`576fc26b6cc`** (#976)                                                                                          |
| Gallery migrations | 49 (unchanged)                                                                                                                           |
| Backups            | `backup/rolling-pre-b83-20260811`, `-post-freezed-`, `-post-translations-`, `-pre-queuebatches-`, `-pre-e2emigration-`, `-pre-forksync-` |

**Scope note that shaped the whole cycle**: 266 files touched by the batch, **97 with
fork divergence** (~36%). That is far above the recent 15–30% range and it landed on
almost every standing divergence, which is why this cycle needed 12 rebase steps rather
than the usual 2–3.

## Incoming Upstream Changes

| SHA           | Summary                                                        | Area       | Risk     | Notes                                                                                                               |
| ------------- | -------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `235daff5612` | chore(mobile): more complicated Freezed pass (#30452)          | mobile     | MED      | Converts 26 files incl. `person.model.dart`, `memory.model.dart`, `search_filter.model.dart`, `timeline.state.dart` |
| `565fbe49178` | migrate mobile translations accessor (1) (#30667)              | mobile     | **HIGH** | See "Translations accessor" below                                                                                   |
| `835c35e9408` | migrate mobile translations accessor (2) (#30668)              | mobile     | **HIGH** |                                                                                                                     |
| `d799698c51c` | migrate mobile translations accessor (3) (#30670)              | mobile     | **HIGH** |                                                                                                                     |
| `a8b3b30abac` | migrate mobile translations accessor (4) (#30671)              | mobile     | **HIGH** |                                                                                                                     |
| `675408b003f` | migrate mobile translations accessor (5) (#30672)              | mobile     | **HIGH** | **Deletes `lib/extensions/translate_extensions.dart`**                                                              |
| `4c4170077ce` | fix(deps): update typescript-projects (#30539)                 | deps       | MED      | 2709-line lockfile churn                                                                                            |
| `7fea9f20664` | fix(deps): @immich/ui → ^0.85.0 (#30705)                       | web        | **HIGH** | Drops the fork's pnpm patch — recurring                                                                             |
| `c89104d144c` | mise docker tag → v2026.8.3 (#30699)                           | CI         | LOW      | clean                                                                                                               |
| `23636382c49` | node.js → v24.19.0 (#30703)                                    | CI         | LOW      | clean                                                                                                               |
| `427591fb9e0` | grafana → v12.4.7-ubuntu (#30700)                              | CI         | LOW      | clean                                                                                                               |
| `b4c27ee0b46` | update github-actions (#30702)                                 | CI         | LOW      | clean                                                                                                               |
| `9273a4ca2ad` | rework docker build workflow (#30626)                          | CI         | **HIGH** | +100/−44; see "docker.yml"                                                                                          |
| `cf17dcbfee1` | derive mobile build number from semver (#30569)                | release    | LOW      | No-op for the fork                                                                                                  |
| `9773d72428e` | gh release create instead of softprops (#30577)                | release    | LOW      | No-op (fork deleted `prepare-release.yml` in #207)                                                                  |
| `927b4d0ea28` | refactor: find or fail (#30697)                                | server     | LOW      | Additive `findOrFail()` helper                                                                                      |
| `d1662fb2b6f` | fix: face label clipping (#30712)                              | web        | LOW      | clean                                                                                                               |
| `ee525f159b1` | refactor: queue in batches (#30698)                            | server     | **HIGH** | Rewrites loops in 3 fork-extended services                                                                          |
| `1b8cbaab976` | migrate e2e auth/validation tests to controller specs (#30715) | server/e2e | **HIGH** | −1108 lines; deletes specs                                                                                          |
| `00d10dab639` | refactor: e2e user tests (#30716)                              | e2e        | MED      |                                                                                                                     |

### Product-direction gate: did NOT fire

Nothing in this batch changes where a feature is going in a way that collides with a fork
product decision — no sharing/Shared-Spaces overlap, no access-model, sync-contract, album,
person or timeline product rework. The heavy items are architectural (freezed, translations
accessor, queue batching, test relocation), which is step-7h propagation territory, and CI
plumbing. No quarantine was opened.

## The two decisions taken at Checkpoint 1

1. **Translations accessor — BUNDLE the fork conversion** (rather than defer). This turned
   out to be forced rather than optional; see below.
2. **Specs upstream deletes — keep the fork's tests, drop upstream's redundant ones.**

## Translations accessor (#30667–#30672) — the cycle's centre of gravity

Upstream moved every mobile string from `'key'.tr()` / `'key'.t(context:)` onto a generated
accessor (`context.t.<key>`, or `StaticTranslations.instance.<key>` where there is no
`BuildContext`) — and **deleted `lib/extensions/translate_extensions.dart`**.

**That deletion is what made this mandatory.** The Checkpoint-1 estimate said 68 fork-only
files / 174 sites were an optional consistency cleanup because `easy_localization` stays in
`pubspec.yaml`. That was right about `.tr()` and wrong about `.t(context:)`: 117 fork call
sites across 15 files referenced the deleted extension and stopped compiling outright.

Conversion was **signature-driven** from the generated `translations.g.dart` rather than
textual, so arg-taking keys became named parameters and `int` params dropped the old
`.toString()` wrappers. Three things that only surfaced by doing it:

- **Nested keys are sub-accessors, not flattened leaves.** The generated getter for
  `errors.unable_to_update_space` is named `unable_to_update_space` but lives on
  `_ErrorsTranslations`, reached as `context.t.errors.unable_to_update_space`. Mapping the
  dotted key to its leaf compiles at the call site and resolves to the wrong class — caught
  by `dart analyze`, twice.
- **~28 dynamic/constructed key sites cannot migrate at all** — `preset.label.tr()`,
  `'filter_sheet_deep_search_n_tags.$variant'.tr(...)`, `_monthKeys[i].tr()`,
  `section.titleKey.tr()`. The generated accessor is a static getter per key, so a
  runtime-built key has nothing to bind to. These deliberately stay on `easy_localization`
  — which is what upstream's own generated `_t()` calls internally
  (`key.tr(context: _context)`), so this is upstream's pattern, not fork drift.
- **A pre-existing fork bug fell out of it.** `space_album_unlink_title` is not an i18n key,
  so the two "unlink album from space" dialogs were rendering that raw string as their
  title. Under the old API a missing key silently degrades to the key text, which is why it
  survived review. Repointed to the existing, fully-translated
  `space_album_unlink_from_space` ("Unlink from space"), which pairs with the confirmation
  already used as the dialog body. No new i18n keys were needed.

### The test-harness half — 48 failures that were not conversion errors

`dart analyze` went clean while `flutter test` reported 48 failures. Cause:
`context.t` resolves through `Translations.of(context)` → `EasyLocalization.of(context)!`,
so it **throws** without an `EasyLocalization` ancestor, whereas `'key'.tr()` degraded
gracefully to the key. Production is unaffected (the app always has the ancestor); this was
purely a test-harness gap, and it split three ways:

| Harness                                | Fix                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pumpConsumerWidget`                   | already wrapped — unaffected                                                                                                                                                                                  |
| `pumpConsumerWidgetRaw` (fork helper)  | now wraps in EasyLocalization + one extra `pump()`. Its reason to exist is skipping `pumpAndSettle()`, not skipping localization; the single frame lets the bundle future resolve without settling animations |
| `pumpConsumerWidgetDark` (fork helper) | now wraps + `pumpAndSettle()`, matching its own docstring ("same shape as pumpConsumerWidget")                                                                                                                |
| bare `pumpWidget` in 12 test files     | new public `localizedForTest()` wrapper                                                                                                                                                                       |

**A regex mistake worth recording**: the first attempt wrapped `pumpWidget(` calls with a
regex that inserted an opening paren it could never close. Reverted and redone with real
paren matching plus a paren-balance assertion. The revert also undid this cycle's earlier
conversions in those 11 files, which had to be re-applied — the cost of not checking
balance before writing.

## Conflict Resolutions

31 conflicts over 12 rebase steps. Grouped by kind; the ones with judgement in them:

### `mobile/lib/domain/models/memory.model.dart` — kept the fork's plain class

Upstream freezes `MemoryData({required int year})`. Fork #418 replaced that class wholesale
with a raw-map payload (`year`/`ruleId`/`title`/`subtitle` getters) for the rule-based
memories pipeline, which `required int year` cannot express. Resolution: `DriftMemory` takes
upstream's freezed version verbatim (the fork had no delta on it); `MemoryData` stays
hand-written. Mixing a plain class with freezed siblings in one file is **upstream's own
idiom** here — `search_filter.model.dart` does exactly that — so this is not fork drift.
`DeepCollectionEquality` comes from `freezed_annotation`'s re-export, so no `collection`
import was restored.

- **Risk**: LOW. **Verified**: `rule` enum value, raw-map field and all four getters present;
  `DriftMemory` byte-equivalent to upstream's freezed form.

### `mobile/lib/models/search/search_filter.model.dart`, `person.model.dart` — additive field onto freezed

The documented recipe applied cleanly: the fork's delta is one additive field restated across
boilerplate that freezed deletes. `isUntagged` → `@Default(false) bool isUntagged` on
`SearchDisplayFilters`; `numberOfAssets` and `spaceId` → optional params on `PersonDto` /
`DriftPerson`.

Upstream also **dropped `toMap`/`fromMap`/`toJson`/`fromJson`** from both converted classes.
Verified there are **no production callers** (`SearchFilter` does not serialize `people`), so
following upstream is safe; the only consumer was a fork test, handled below.

- **Risk**: LOW. **Verified**: `isUntagged` live in 12 files, `spaceId` in 322 sites.

### `server/src/services/person.service.ts` — the fork's job payloads onto `batched()`

Upstream's `batched()` refactor rewrote both queue loops. Fork #533's payload fields had to be
carried across: `...(force === true && { force: true })` on `AssetDetectFaces` and
`...(force && { skipSharedSpaceMatch: true })` on `FacialRecognition`, plus #600's ML-scoped
force filter (`force ? { sourceType: MachineLearning } : ...`) and #331/#336's
`SharedSpaceFaceMatchAll` block, which must stay **after** the recognition-job loop.

**The spread had to be written in the `&&` form, not the ternary.** The fork's own
eslint-unicorn autofix commit replays later in the history and rewrites
`...(cond ? {x} : {})` → `...(cond && {x})`; resolving to the ternary would have re-triggered
that rule and failed Lint Server. This is the [autofix-vs-upstream](../../CLAUDE.md) class in
its mild form — the two sides fight over the same expression.

- **Risk**: MEDIUM. **Verified**: `pnpm lint` clean (zero-warning policy), 5176 server tests.

### `server/src/services/media.service.ts` / `metadata.service.ts` — S3 surface intact

The two files carrying the fork's S3 work were the ones I most expected to lose content.
Computing the fork's delta against its own base first showed the conflicting hunk was
**cosmetic** (a local variable rename), while the real fork content — `ensureLocalFile`,
`persistFile`, the `DiskStorageBackend` branch — sits in an adjacent hunk that auto-merged.
Resolved to upstream's `batched()` loop.

- **Risk**: LOW once measured. **Verified**: 6 `ensureLocalFile`, 6 `persistFile`,
  2 `DiskStorageBackend`, 1 `getWriteBackend`, 1 `downloadToTemp` all present.

### Import-block conflicts (~12) — resolved by usage, not by side

Upstream's `batched()`/`findOrFail()` refactors removed `JOBS_ASSET_PAGINATION_SIZE` and
`JobItem` from several services while the fork added `isAbsolute`, `StorageService`,
`getPreferences`, `applyResolvedIdentityMetadata`, `VideoInfo`, `elementWiseMean`,
`StorageCore`. Each was resolved by counting real body uses rather than picking a side, which
is what caught the one genuine break:

> **`server/src/services/person.service.ts` still needs `JOBS_ASSET_PAGINATION_SIZE`.**
> Upstream removed the import because `batched()` replaced every loop that used it — but the
> fork's `SharedSpaceFaceMatchFromBackfill` queueing iterates a **plain array**
> (`uniqueTargets`), not an `AsyncIterable`, so `batched()` does not apply and the manual
> loop stays. Fixed in `dd0390b9655`.

### Fork deletions accepted (13 files)

Fork #654/#758 delete upstream's mobile search page and search-filter widget set; #114
deletes the patrol integration tests; #207 deletes `prepare-release.yml`; a fork rebase commit
deletes the whole `packages/scripts` package. Each was verified three ways before accepting:
the fork commit really deletes it (not renames), upstream created nothing new at that path
this batch, and no surviving fork code references it.

### Standing divergences — all re-confirmed

| #   | Divergence                                                                 | Outcome                                                                                                                    |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `similar_photos.action.dart` keeps the fork's `photosFilterProvider` route | Kept. Upstream's freezed edit (`.new(...)` → `const .new(...)`) was **inert** — it lands inside the block the fork deletes |
| 2   | `nudgeSpaceSyncIfLinked` / `removeFromAlbum` retained                      | Untouched this batch                                                                                                       |
| 3   | `view_in_timeline_action.dart` (#929)                                      | Kept; import conflicts resolved to #929's form                                                                             |
| —   | `people_details.widget.dart` `ownedByCurrentUser` gate (#727)              | Kept, with upstream's accessor                                                                                             |

## `docker.yml` — the fork rule that upstream refactored out from under us

Upstream's rework (+100/−44) is the interesting one. **Correction to the skill's CI table**:
the fork has not renamed `docker.yml` away — it runs upstream's workflow with four patches.
Three survived mechanically; the fourth had to be re-expressed:

| Fork rule                       | Outcome                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `cancel-in-progress: false`     | intact                                                                                                           |
| PUSH_O_MATIC → `github.token`   | intact                                                                                                           |
| ROCm removed from the ML matrix | **simpler now** — upstream introduced a YAML anchor (`&ml-variants`) used in 3 places, so one removal covers all |
| `dockerhub-push: false` (×2)    | **the input no longer exists**                                                                                   |

Upstream replaced the per-job `dockerhub-push` input with a separate **`mirror` job**
("Mirror to Docker Hub", `DOCKERHUB_NAMESPACE: docker.io/altran1502`). Taking upstream's file
and dropping the fork's now-meaningless `dockerhub-push` line would have left the fork with a
job that pushes Gallery images into **Immich's** Docker Hub namespace on every non-prerelease
release — and the fork's `docker.yml` **does** trigger on `release: [published]`. Fork #218's
intent was therefore re-expressed as: delete the `mirror` job, drop it from both
`success-check-*` `needs:` lists, and remove the now-unused `DOCKERHUB_NAMESPACE` env.

Verified by parsing the YAML: 8 jobs, no dangling `needs:`, zero `dockerhub`/`docker.io`
references, ML variants `[cpu, cuda, openvino, armnn, rknn]`.

This is the "fork depends on upstream by reference, and the reference moves" shape — the same
class as the branding-literal detector, but expressed through a workflow input rather than a
string literal, so no detector would have caught it. Reading the reworked file did.

## `@immich/ui` 0.83.0 → 0.85.0 re-patch (recurring, pre-approved)

Both patch targets were byte-identical in 0.85.0, so the same two hunks re-applied: drop
upstream's `shortcuts(document.body, [Ctrl+K, Cmd+K, /])` registration (Gallery's cmdk palette
owns those keys) while keeping the `#handleKeydown` dispatcher that per-page `ActionItem`
shortcuts depend on; and widen the `ImageCarousel` title `<p>`.

Diffing old vs new patch shows they differ **only** in the hunk offset (upstream moved the
code from line 38 to 103) and blob hashes. `pnpm-workspace.yaml` ends up differing from its
pre-bump state by exactly one line — `patch-commit` relocates the `patchedDependencies` block,
which was moved back to the fork's original position to keep the diff minimal.

Verified in the installed package: Gallery comment present, upstream shortcut block absent,
keydown dispatcher retained, carousel class applied. `fork-patches-check` OK.
`pnpm install --frozen-lockfile` → "Lockfile is up to date" (the arc-4 gate).

## Specs upstream deletes — fork coverage preserved

`#30715` deletes every `describe(...)` whose only content is
`it('should be an authenticated route')`, now covered reflectively for all routes by
`index.spec.ts`. Two of those files carry fork content:

- **`server.controller.spec.ts` — recreated with the fork's block only.** Upstream's copy was
  auth-only, but the fork added three real tests for the fork-only `GET /server/ml-health`
  endpoint (the cmdk palette's ML-health indicator), which has no upstream equivalent.
- **`download.controller.spec.ts` — deletion accepted.** The fork's delta was a mechanical
  `abort: vitest.fn()` mock-shape adaptation; the actual abort behaviour has 10 references in
  `download.service.spec.ts`.

For the specs upstream only _shrinks_ (`person`, `search`, `timeline`, `system-config`,
`asset-media`), the same rule was applied inside each conflict: keep the fork's behavioural
blocks, drop the auth-only ones. Each result was cross-checked against upstream's version —
**nothing upstream has is missing from ours**, and every extra is a fork-only endpoint
(`/people/statistics`, `/people/face-statistics`, `/people/same-person`,
`/people/detach-profile`, representative-face routes, `/search/smart/facets`,
`/search/suggestions/filters`).

## Detectors and standing gates

| Check                                        | Result                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| URL-literal silent-no-op detector            | clean                                                                                                       |
| Fork-asset × upstream-test coupling detector | only the two known pairs; last cycle's `remote_image_request_test.dart` fix **not disturbed** by this batch |
| Server migrations in batch                   | none → `revert-to-immich.sql` needs no entry (detector run: 0 MISSING)                                      |
| Mobile Drift schema                          | untouched; `mobile-drift-rebase-check` OK                                                                   |
| `machine-learning/` delta                    | **empty** → ML gate not required this cycle                                                                 |
| `i18n/` delta                                | empty                                                                                                       |
| `mise.lock` churn                            | none (used the pinned Flutter binaries directly, never `mise run`)                                          |
| `mobile/pubspec.yaml` churn                  | the documented `shared_preferences: any` codegen trap fired; reverted, `--enforce-lockfile` still passes    |
| Gallery migration count                      | 49 (unchanged)                                                                                              |

## Fork Feature Verification

| Feature                    | Status | Notes                                                                                   |
| -------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Shared Spaces              | OK     | Space albums/detail/edit sheets converted; `SharedSpaceFaceMatchAll` ordering preserved |
| Storage Migration / S3     | OK     | `ensureLocalFile` + `persistFile` intact through the `batched()` rewrite                |
| Pet Detection              | OK     | ML untouched this batch                                                                 |
| Image Editing / video trim | OK     | `asset.service.ts` duration + `StorageCore` imports reconciled                          |
| Branding                   | OK     | `verify-branding` unaffected; no i18n keys added                                        |
| Global Face Identity       | OK     | #533/#600 payload fields carried onto `batched()`; #976 perf work synced                |
| cmdk / Global Search       | OK     | `@immich/ui` patch re-applied and verified in the installed package                     |
| Memories (rule-based)      | OK     | `MemoryData` raw-map design preserved                                                   |
| Timeline grouping          | OK     | #625/#681/#911 resolutions verified (`withGroupingPill`, no `year` row)                 |
| Mobile Spaces / filters    | OK     | 3188/3188 mobile tests                                                                  |

## CI and Infrastructure Verification

| Check                                | Status | Notes                                     |
| ------------------------------------ | ------ | ----------------------------------------- |
| Workflow collisions                  | OK     |                                           |
| Docker image references              | OK     | `mirror` job removed; no `docker.io` refs |
| Branding leaks in CI                 | OK     |                                           |
| Fork CI modifications intact         | OK     | `ci-invariants-check` 3/3                 |
| Fork ownership coverage              | OK     | 3324 fork files                           |
| `fork-patches-check`                 | OK     |                                           |
| `upstream-postrebase-audit BATCH=83` | OK     | 7/7 checks                                |

## Pattern Propagation

| Refactor                              | Old → New                                                                | Fork scope                                                                                | Decision     | Commit                               |
| ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------ | ------------------------------------ |
| Translations accessor (#30667–#30672) | `.tr()` / `.t(context:)` → `context.t.<key>`                             | 117 mandatory sites (15 files) + ~170 bundled; ~28 dynamic-key sites cannot migrate       | **Bundled**  | `8d5812c865d`                        |
| `batched()` job queueing (#30698)     | manual `JOBS_ASSET_PAGINATION_SIZE` loop → `for await (… of batched(…))` | applied where upstream applied it; one fork array-loop legitimately keeps the manual form | Bundled      | conflict resolutions + `dd0390b9655` |
| `findOrFail()` (#30697)               | inline null-check → helper                                               | upstream converted the shared services; no fork-only service has the pattern              | n/a          | —                                    |
| freezed pass 2 (#30452)               | hand-written models → `@freezed`                                         | fork models stay hand-written (standing decision; upstream's own migration is partial)    | **Deferred** | —                                    |

## Local CI Verification

| Check                                  | Status  | Notes                                                             |
| -------------------------------------- | ------- | ----------------------------------------------------------------- |
| `server pnpm build` (+ migration sync) | PASS    | 49 migrations + 1 compatibility alias                             |
| `server pnpm check` (tsc)              | PASS    |                                                                   |
| `server pnpm lint`                     | PASS    | zero-warning policy                                               |
| server unit tests                      | PASS    | 5176 passed / 12 skipped (incl. #976's new 11 + 28 tests)         |
| `web check:typescript`                 | PASS    |                                                                   |
| `web check:svelte`                     | PASS    | 586 files, 0 errors                                               |
| web eslint                             | PASS    | 0 errors (13 warnings are the documented `tscompat`-off artefact) |
| web unit tests                         | PASS    | 4350 passed                                                       |
| `dart analyze --fatal-infos`           | PASS    | No issues found                                                   |
| `dart format` (CI form, lib only)      | PASS    | 0 changed                                                         |
| `flutter test`                         | PASS    | **3188 / 3188**                                                   |
| `pnpm install --frozen-lockfile`       | PASS    | lockfile up to date                                               |
| OpenAPI spec regen                     | PASS    | no diff — batch changed no endpoint shape                         |
| `make sql`                             | SKIPPED | no upstream repository change; `server/src/queries/` clean        |
| ML gate                                | SKIPPED | `machine-learning/` delta empty                                   |

## Remote CI Verification

- **Test branch**: `rebase/upstream-b83`
- **Commit validated**: `51182c387de` — **all 10 runs on the same headSha, no skew**
- **Result**: **10/10 GREEN, first pass** (staggered 4/2/4 dispatch; zero GHCR rate limits)

| Workflow                                  | Status | Notes                                                                                                                                              |
| ----------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN  | **21/21 jobs, 0 skipped**                                                                                                                          |
| `docker.yml`                              | GREEN  | ML matrix = cpu/cuda/openvino/armnn/rknn — **no rocm, no `mirror` job**. `Re-Tag ML`/`Re-Tag Server` skipped (release-gated, expected on dispatch) |
| `static_analysis.yml`                     | GREEN  | dart analyze + format + generated-file freshness                                                                                                   |
| `gallery-build-mobile.yml`                | GREEN  | iOS + Android                                                                                                                                      |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                                                                                                                    |
| `storage-migration-tests.yml`             | GREEN  |                                                                                                                                                    |
| `storage-migration-e2e.yml`               | GREEN  |                                                                                                                                                    |
| `gallery-revert-to-immich-validation.yml` | GREEN  | read past the coverage grep: pre-phase drift 0, **post-phase drift 0**, "revert-to-immich validation PASSED"                                       |
| `gallery-ml-smoke.yml`                    | GREEN  |                                                                                                                                                    |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                                                                                                                    |

- **Failures fixed**: none — first pass
- **Confirmed flakes**: none

## Drift during the cycle

Both remotes moved while the rebase ran — re-checked immediately before finishing, per the
standing lesson:

- **`origin/main` +1** → **#976** (People-page perf: hydrate recompute, dead space predicate,
  third counts query). **Synced** via `make upstream-sync-fork-main`, clean, cursor advanced to
  `576fc26b6cc`. Server build/tsc/lint/tests re-run afterwards (a clean fork sync is not
  CI-safe by itself); its two new unit specs are collected and green.
- **`upstream/main` +1** → **`a55dc80a568` `chore: enforce strict equality checks (#30718)`**
  (35 web files). **Deliberately left for the next cycle**, matching precedent for mid-cycle
  upstream drift. It is a lint-rule change (`eqeqeq`) that will want its own fork-side sweep,
  and folding it in now would invalidate the gate run this report documents. The branch is
  therefore **1 behind** at time of writing.

## Inconsistencies Found

1. **`space_album_unlink_title` was never an i18n key** — two space-album unlink dialogs
   rendered the raw key as their title. Pre-existing; fixed (see above).
2. **`person.service.ts` lost a still-needed constant import** — fixed in `dd0390b9655`.
3. **`docker.yml`'s `dockerhub-push: false` became meaningless** — re-expressed as removing
   upstream's new `mirror` job (see above).
4. **Vacuous fork test assertion, left as-is and flagged**:
   `test/widgets/settings/asset_list_group_settings_test.dart` asserts
   `find.text('asset_list_layout_settings_group_automatically'.tr())` is `findsNothing`. That
   key does not exist in `i18n/en.json`, so `.tr()` yields the raw key and the assertion is
   vacuously true — it provides no coverage. Not changed here (redesigning fork tests is out
   of scope for a rebase), but it should either be deleted or repointed at a real key.

## Follow-up work

- **Next cycle**: pull `a55dc80a568` (#30718 strict equality) and run the fork-side `eqeqeq`
  sweep it implies.
- **Optional cleanup**: remove or repoint the vacuous assertion in item 4 above.
