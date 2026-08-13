# Upstream Sync Report — 2026-08-13

## Summary

- **Upstream commits pulled**: 2 (`610bcfa6d09..943c11c0196`)
- **Upstream commits quarantined**: 8 (`52edcc0c74c..a939561e70f`)
- **Fork commits synced**: 3 (`576fc26b6cc..db3b4c2fdb0` — #834, #778, #979)
- **Conflicts resolved**: 1 during the rebase, 3 files + 22 generated-client paths during the fork sync
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — the quarantine is the whole point of this cycle

The per-batch product-direction gate fired on a 3-commit upstream rework of the **mobile person
model**. Pierre chose to quarantine at the boundary. Upstream commits 1–2 and the 3 pending fork
commits landed; commits 3–10 are held pending a brainstorm + spec of the person-model
reconciliation.

Branch is **level with the quarantine boundary** and **0 behind it**, 8 behind `upstream/main` (the
quarantined set), fork-synced to the tip. Still **off `main`** — the newest upstream tag is still
`v3.1.0`.

## Incoming Upstream Changes

| #   | SHA           | Summary                                                                | Area       | Risk to Fork    | Notes                                                           |
| --- | ------------- | ---------------------------------------------------------------------- | ---------- | --------------- | --------------------------------------------------------------- |
| 1   | `ce705dcc068` | fix: riverpod reactivity regression from lint fixes (#30734)           | mobile     | LOW             | 6 files; 1 conflict (see below)                                 |
| 2   | `943c11c0196` | chore: label local only delete as trash (#30726)                       | mobile     | LOW             | 2 files, clean                                                  |
| 3   | `52edcc0c74c` | refactor: unify person model (#30659)                                  | mobile     | **QUARANTINED** | collapses `PersonDto` + `DriftPerson` into one 4-field `Person` |
| 4   | `303a9f15b1a` | refactor: reactive driftGetAllPeopleProvider (#30660)                  | mobile     | **QUARANTINED** | `FutureProvider` → `StreamProvider`; deletes invalidation sites |
| 5   | `1c3a5cf5087` | chore: remove old people provider (#30662)                             | mobile     | **QUARANTINED** | renames the provider; deletes 2 files                           |
| 6   | `2a1691868e7` | chore: use `import.meta.dirname` instead of `__dirname` (#30738)       | build      | HELD            | safe in itself; blocked behind 3–5                              |
| 7   | `ff5da0f84fc` | chore: immich_mobile path in openapi pubspec (#30643)                  | build      | HELD            | 1 line                                                          |
| 8   | `db9e7c20d71` | chore(mobile): single mise checkout command (#30737)                   | mobile CI  | HELD            | Shape E checked — see below                                     |
| 9   | `b82d4805525` | fix(mobile): prevent iOS status bar scroll during transitions (#30717) | mobile     | HELD            |                                                                 |
| 10  | `a939561e70f` | feat: workflow asset tag trigger/filter/action (#29043)                | server/web | HELD            | zero fork divergence; relevant to open PR #981                  |

**Fork divergence ratio: 29 of 55 touched files = 52%**, concentrated almost entirely in the mobile
people surface — which is exactly where the gate fired.

### Quarantine rationale (commits 3–5)

The three commits are one rework of a data model the fork extends heavily (CLAUDE.md's mobile people
contract; PRs #727 / #735 / #737 / #738 / #739 and #473 / #758; open PR #980 lives in these files).

- **`DriftPerson.spaceId` and `.numberOfAssets` have nowhere to land.** Upstream collapses
  `PersonDto` + `DriftPerson` into `Person { id, name, updatedAt, birthDate }`, dropping `ownerId`,
  `isHidden`, `thumbnailPath`, `color`, `isFavorite`, `createdAt`, `faceAssetId`. The fork adds
  `spaceId` and `numberOfAssets` to **both** collapsed classes, and its entire owner-only-vs-editor-gated
  edit routing and per-profile thumbnail routing key on `spaceId` living on that model.
- **The fork's provider is already a different shape.** `driftGetAllPeopleProvider` here is
  `FutureProvider.family<List<DriftPerson>, PeopleSortBy>`; upstream makes it a plain `StreamProvider`
  and renames it `getAllPeopleProvider`. Nine fork test files override it with the family+Future
  signature.
- **The buried trap.** #30660 _removes_ `ref.invalidate(...)` from the edit modals and
  `tab_shell.page.dart` because upstream's provider became reactive. The fork pairs every one of those
  with an invalidate of `driftGetAllPeopleWithSharedSpacesProvider` — a **server-backed
  `FutureProvider`, not reactive**. Taking upstream's deletion at face value silently stops the People
  page refreshing after a rename or birthday edit. It reads like a clean resolution.

Commits 6–10 are individually safe but sit after 3–5, and the rolling flow is strictly linear.

### #29043 is not a collision

The whole workflow surface (`packages/plugin-core/**`, `packages/plugin-sdk/**`,
`workflow-execution.service.ts`, `src/utils/workflow.ts`, `web/src/lib/utils/workflow.ts`,
`SchemaConfiguration.svelte`) has **zero** fork divergence. #29043 is purely additive upstream work.
It is, however, a heads-up for open PR **#981** ("feat(spaces): add shared-space actions to
workflows"): it adds an `assetAddTags` action, an `AssetTagged` trigger, an `assetTagFilter`, a
`bulkTagAssets` host function and `AssetV1.tags`, so #981 will want rebasing onto it.

## Conflict Resolutions

### Conflict: `mobile/lib/presentation/pages/search/drift_search.page.dart` (rebase)

- **Fork side**: #654 deletes the page (960 lines) along with `paginated_search.provider.dart`.
- **Upstream side**: #30734 refactors `_bottomWidget` to take `isLoading` / `hasMore` as parameters
  instead of reading `paginatedSearchProvider` inside the builder.
- **Resolution**: honour the fork's deletion. Upstream's fix targets `paginatedSearchProvider`, which
  #654 also deletes — the fix is inapplicable, not dropped.
- **Risk**: LOW.
- **Verification**: confirmed the file is absent at the pre-rebase tip and that the fork ships no
  `mobile/lib/presentation/pages/search/`.

### Conflict: `.github/workflows/docker.yml` (fork sync, #834)

- **Fork side**: fork rule #218 — no Docker Hub publishing. The rolling branch has deleted upstream's
  `mirror` job and the `secrets: DOCKERHUB_*` blocks entirely (0 occurrences).
- **Upstream/#834 side**: adds `pull-requests: read` to three permission blocks, with the
  `secrets: DOCKERHUB_*` lines as surrounding context.
- **Resolution**: keep the fork's structure, apply only #834's three added lines.
- **Risk**: LOW.
- **Verification**: asserted `diff <(git show <pre-sync>:.github/workflows/docker.yml) <resolved>` is
  **exactly** three `> pull-requests: read` lines, and that `DOCKERHUB|mirror:` still matches 0 times.

### Conflict: `server/src/services/person.service.ts` (fork sync, #834)

Two hunks, both **combine** rather than pick a side:

- **Imports**: HEAD has `batched, findOrFail, isFacialRecognitionEnabled` (upstream's `batched()` /
  `findOrFail()` refactors); #834 adds `isFaceSuggestionEnabled`. Resolved to the union after counting
  body uses — `batched` 2, `findOrFail` 11, `isFaceSuggestionEnabled` 4, `isFacialRecognitionEnabled` 4. All four are used.
- **`getAllFaces` call**: HEAD renamed `facePagination` → `faces` for the `for await (const batch of
batched(faces))` loop; #834 adds `excludeManuallyPlaced: true` to the non-forced branch plus its
  explanatory comment. Taking HEAD drops a real behaviour change (F9); taking #834 breaks the loop.
  Resolved to the fork's variable name **plus** #834's argument and comment.
- **Risk**: LOW. **Verification**: `pnpm check` clean; brace balance unchanged vs the pre-sync
  baseline (0 → 0).

### Conflict: `mobile/openapi/**` — 22 paths across all three fork commits

- **Fork side (rolling)**: the directory is **de-committed** — upstream #30287 (batch 12) removed the
  whole generated Dart client from source. The rolling branch tracks **0** files there.
- **Fork side (main)**: `origin/main` still tracks **551** files there, so all three commits carry
  edits to the generated client.
- **Resolution**: keep the rolling branch's deletion.
- **Risk**: LOW — **verified, not assumed**. `open-api/bin/generate-dart-sdk.sh` regenerates into the
  gitignored `mobile/generated/openapi/` from `open-api/immich-openapi-specs.json`, which **did**
  receive all three commits' changes. Regenerating produced 1078 Dart files including **39
  face-repair models** (#834) and the storage-usage config (#979). Nothing was lost.

## Fork Feature Verification

| Feature                                 | Status | Notes                                                                                                                                                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared Spaces                           | OK     | `nudgeSpaceSyncIfLinked` live at both call sites + `album.provider.dart`                                                                                                                                           |
| Storage Migration / S3                  | OK     | `DiskStorageBackend` branch intact in `auth.service.ts:399` and `user.service.ts:130`                                                                                                                              |
| Search V3 coexistence                   | OK     | 9 `searchAssetBuilderLegacy` call sites; the only bare `searchAssetBuilder(` calls are inside upstream's own dormant `searchMetadataV3` / `searchStatisticsV3`, under all 3 `UPSTREAM SEARCH V3 — DORMANT` banners |
| Mobile similar-photos (divergence #1)   | OK     | routes via `photosFilterProvider.setSimilarTo` + `MainTimelineRoute`; no `DriftSearchRoute`                                                                                                                        |
| Mobile removeFromAlbum (divergence #2)  | OK     | retained in both provider and service                                                                                                                                                                              |
| Mobile view-in-timeline (divergence #3) | OK     | `viewAssetInTimeline` (#929 entry point)                                                                                                                                                                           |
| Branding                                | OK     | no CI leaks; `ci-invariants-check` green                                                                                                                                                                           |
| Pet Detection / ML                      | OK     | `machine-learning/` provably untouched this cycle                                                                                                                                                                  |

## CI and Infrastructure Verification

| Check                                | Status | Notes                                                               |
| ------------------------------------ | ------ | ------------------------------------------------------------------- |
| `make fork-patches-check`            | OK     | `@immich/ui` patch metadata consistent                              |
| `make ci-invariants-check`           | OK     | no-push-o-matic, release image names, docs-deploy disabled          |
| `make mobile-drift-rebase-check`     | OK     | schemaVersion, snapshots, callbacks consistent                      |
| `make fork-ownership-coverage-check` | OK     | 3633 fork files covered (after the fix below)                       |
| `make upstream-postrebase-audit`     | OK     | all checks green except the informational Generated Artifact Review |
| Docker image references              | OK     | fork rule #218 intact — 0 `DOCKERHUB` / `mirror:` in `docker.yml`   |

Two hard ownership-coverage errors were fixed in `8cb471b03e1`:

- `web/vite.config.ts` was uncovered (#834 adds `clearMocks: true`). Declared under
  `release-ci-and-infrastructure`'s `upstream_extension_paths` — it is an upstream-owned build/test
  config the fork extends, not a fork-only file.
- `last_verified_fork_head` was behind; bumped to the synced `origin/main`.
- The `expected_migrations` list was regenerated from disk (49 → 58) to cover #834's nine new fork
  migrations.

**Standing gap, unchanged**: five `branding/scripts/*.sh` are still wired into no workflow
(`test-app-download-branding.sh`, `test-email-branding.sh`, `test-oauth-callback-branding.sh`,
`verify-branding.sh`, `verify-mobile-assets.sh`).

## Database Migration Analysis

The two upstream commits add **no** migrations. The fork sync adds **nine** (#834):
`1780000000000-AddFaceRepairScan`, `1781000000000-AddFaceRepairDecline`,
`1781500000000-AddFaceRepairScanFlaggedFace`, `1783050000000-AddFaceRepairScanInFlightIndex`,
`1784000000000-FixFaceRepairScanInFlightIndexOverride`, `1787000000000-AddFacePersonVerdict`,
`1788000000000-ReconcileFacePersonVerdictConstraints`,
`1789000000000-AddFacePersonVerdictStatusCreatedAtIdIndex`,
`1790000000000-FixFaceRepairScanInFlightIndex`.

- Gallery migration count: **58** (was 49); manifest updated to match.
- Timestamp collisions: **NONE**.
- Postbuild merge: intact — `Synced 58 Gallery migrations into dist/schema/migrations; removed 0
stale files; wrote 1 compatibility aliases.`
- **`revert-to-immich.sql` coverage: complete.** The step-7i detector reports no `MISSING` entries —
  #834 shipped its own reversal entries, and this cycle's upstream commits add no post-`v3.1.0`
  upstream migration.

## Mobile Drift Migration Analysis

No upstream or fork mobile migrations this cycle. `make mobile-drift-rebase-check` green;
`schemaVersion`, snapshots and Gallery callbacks consistent.

## Detectors

| Detector                                         | Result                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL-literal silent-noop (branding `sed` targets) | clean, over both the pulled range and the full pending range                                                                                                                                                                                                                           |
| Coupled fork-asset × upstream-test               | 3 hits, all **false positives** — fork owns both sides (`remote_image_request_test.dart` delta 20, `LoadingSpinner.spec.ts` delta 63)                                                                                                                                                  |
| Shape E (shared mise task semantics)             | **clean.** #30737 is additive (`checkout`, `checkout:ios`) plus a `sources` typo fix (`.flutter-plugin-dependencies` → `.flutter-plugins-dependencies`). It changes no task the fork-only workflows invoke (`install:ci`, `codegen`, `analyze`, `format`, `test`). Quarantined anyway. |
| Lost-upstream-content                            | **clean.** Every added line of #30734 verified present in all three fork-diverged files; 3 of 8 touched files are byte-identical to upstream.                                                                                                                                          |

## Inconsistencies Found

**One — a fork-side toolchain drift, fixed in `70d4533fc3a`.**

#834 was authored on `main`, where `MediumTestContext` is still parameterized by the repository
**instance** type (`<S extends BaseService>`) and `ClassConstructor` does not exist in
`src/types.ts`. The rolling branch already carries upstream #30612's retype, which parameterizes by
the **constructor**. The commit cherry-picked with no conflict in those files and then failed
`pnpm check` with **64 errors** — the mirror image of upstream drift, arriving from the fork side.

Two classes:

- `ctx.getMock<X, Mocked<X>>(X)` → `ctx.getMock(X)` at **23 call sites** across 9 specs. Dropping the
  explicit arguments is behaviour-preserving — inference yields the same `Mocked<InstanceType<T>>`.
  Seven files were then left with an unused vitest `Mocked` import, which the zero-warning ESLint
  rejects and prettier's organize-imports does **not** strip.
- `MediumTestContext.getService`, added by #834, declared
  `<T extends BaseService>(Service: ClassConstructor<T>): T`. Handed an _instance_ type, the retyped
  `ClassConstructor<T>` falls through to `new (...args: any[]) => unknown`, so `getService` returned
  `unknown` and every caller's service degraded to `BaseService` — the source of all the
  `Property 'handlePersonSuggestionScan' does not exist on type 'BaseService'` errors. Re-declared in
  the class's own idiom, parameterized by the constructor and cast to `InstanceType<S>` exactly as
  `sut` is.

Both the 64-error count and the resulting 7 unused imports match the 2026-08-08 occurrence of this
same drift exactly.

## Pattern Propagation

None new. The person-model unification (#30659–#30662) is the quarantined item and is a
reconciliation, not a propagation.

## Local CI Verification

| Check                                            | Status          | Notes                                                                                                                                                |
| ------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS            | 58 migrations, 1 compatibility alias                                                                                                                 |
| `server pnpm check` (tsc)                        | PASS            | 0 errors (64 before the drift fix)                                                                                                                   |
| `server pnpm lint`                               | PASS            | 0 errors, 0 warnings                                                                                                                                 |
| `server` prettier                                | PASS            |                                                                                                                                                      |
| Server unit tests                                | PASS            | **5685 passed**, 12 skipped (171 files)                                                                                                              |
| `mise //:sdk:build`                              | PASS            |                                                                                                                                                      |
| `web check:typescript`                           | PASS            | 0 errors (needed a `svelte-kit sync` for #834's new routes)                                                                                          |
| `web check:svelte`                               | PASS            | **607 files**, 0 errors, 0 warnings                                                                                                                  |
| web eslint (`tscompat` off)                      | PASS            | 0 errors, 13 warnings — the documented `tscompat`-off artefact                                                                                       |
| Web unit tests                                   | PASS            | **5633 passed**, 2 skipped, 8 todo (362 files)                                                                                                       |
| mobile `flutter pub get` + full codegen          | PASS            | openapi-dart, build_runner, drift schema, i18n loader + keys                                                                                         |
| mobile `dart analyze --fatal-infos lib test`     | PASS            | No issues found                                                                                                                                      |
| mobile `dart format` (lib only, CI scope)        | PASS            | 845 files, 0 changed                                                                                                                                 |
| mobile `flutter test`                            | PASS            | **3188 passed**, 1 skipped                                                                                                                           |
| OpenAPI regeneration                             | PASS            | `//:open-api-typescript` produced no diff — spec and SDK consistent                                                                                  |
| ML gate                                          | NOT REQUIRED    | `machine-learning/` delta provably empty this cycle                                                                                                  |
| `make sql`                                       | SKIPPED         | no DB running; no upstream repository method changed, and #834 shipped its own `face.identity.repository.sql` / `face.person.verdict.repository.sql` |
| Medium tests                                     | NOT RUN LOCALLY | no Docker daemon — covered by CI's Medium Tests job                                                                                                  |

`mise.lock` churned once (from `mise run //:sdk:build`) and was restored; final tree is clean of it.
`mobile/pubspec.yaml` did not churn.

## Remote CI Verification

- **Test branch**: `rebase/upstream-b89`
- **Commit validated**: `70d4533fc3a`

_(filled in below once the dispatched runs complete)_

## Post-Rebase Verification

- Fork commits ahead of the quarantine boundary: 1148
- Behind the boundary: **0**
- Behind `upstream/main`: **8** — exactly the quarantined set
- Fork-synced through: `db3b4c2fdb0` (#979)
- On `main`: **NO** — newest upstream tag is still `v3.1.0`

## Follow-up work

1. **Brainstorm + spec the mobile person-model reconciliation** before releasing the quarantine. The
   shape of the decision: where `spaceId` / `numberOfAssets` live on the unified `Person`, whether the
   fork's `PeopleSortBy` family survives upstream's `StreamProvider`, and how the shared-spaces
   provider stays refreshed once upstream's invalidation sites are gone.
2. **PR #980** ("view a space's own people from inside a space") lives in the quarantined files —
   sequence it against the reconciliation.
3. **PR #981** should rebase onto #29043 once that lands (new `assetAddTags` / `AssetTagged` /
   `assetTagFilter` / `AssetV1.tags`).
4. **Standing**: wire the five unreferenced `branding/scripts/*.sh` into CI.
