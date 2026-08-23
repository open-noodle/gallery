# Upstream Sync Report — 2026-08-03 (batches 45–49)

## Summary

- **Upstream commits pulled**: 14 (`cafd6c7c0f1..0d7147dceca`), across batches 45–49
- **Conflicts resolved**: 3 (2 in batch 45, 1 in batch 46)
- **Silent upstream-content losses caught after the rebase**: 1 (`getLensModel`)
- **Pattern propagations applied**: 1 (Riverpod `dependencies:` on the fork-only action provider)
- **Risk level**: LOW
- **Recommendation**: PROCEED

The branch is **level with `upstream/main`** (`git log HEAD..upstream/main` = 0) and fork-synced
through **#906** (`origin/main` @ `53f414ab7`, 0 fork commits pending). Fork commit count is
unchanged at **1079**.

`branding/config.json` `upstream.version` stays at **3.1.0** — upstream has still not tagged
v3.1.1, so no version reference was bumped. The branch remains **off `main`** per the standing
rule (landing needs an upstream tag _and_ a thoroughly tested tagged state).

## Cycle type

This was an **upstream-only** cycle. `make upstream-rolling-status` reported
`Fork commits pending: 0` before starting, so no `upstream-sync-fork-main` run was needed.

## Product-direction gate (per batch)

**Did not fire.** All 14 commits were read (`git show --stat` plus full diffs of everything
touching a fork-extended surface) before any `git rebase`. None introduces or reworks a feature
overlapping a fork surface, reshapes an architecture/data model the fork extends, or sets a
product direction needing a converge/diverge decision. Specifically:

- No new or reworked sharing / access / RBAC model (nothing near Shared Spaces).
- No new sync stream or wire-contract change. The one sync-adjacent commit (#30479) only renames
  a websocket handler and subscribes it to a second event.
- No migrations, server or mobile Drift.
- No broad architectural refactor. #30480 is a mechanical Riverpod annotation pass.

## Incoming Upstream Changes

| SHA           | Summary                                                       | Area    | Risk to Fork | Notes                                                                        |
| ------------- | ------------------------------------------------------------- | ------- | ------------ | ---------------------------------------------------------------------------- |
| `f1a90b7f36a` | log hint about downgrades when migration is missing (#30493)  | server  | LOW          | Improves the error the fork's compatibility alias exists to avoid. Additive. |
| `b3718fd18a3` | `@testing-library/jest-dom` to v7 (#30308)                    | deps    | LOW          | Major bump; web suite re-run locally, 4096 pass.                             |
| `fb4a08c17ae` | test `assetFileFilter` (#30430)                               | server  | NONE         | Test-only.                                                                   |
| `4082fbf232f` | fix face thumbnail when swapping merge direction (#30466)     | web     | **MEDIUM**   | **Conflict** — collides with fork #777 merge-policy unification.             |
| `da7d8c2e129` | search album description in add-to-album modal (#30462)       | web     | LOW          | Applies to upstream's picker; fork's picker diverged (see Propagation).      |
| `04453b72060` | reject invalid/deleted user when creating a partner (#30431)  | server  | NONE         | Partner flow, untouched by fork.                                             |
| `08948653529` | typescript 7 extension for vscode (#30516)                    | tooling | NONE         | Editor config only.                                                          |
| `cee08a2320d` | remove asset row when upload fails after creating it (#30349) | server  | **HIGH**     | **Conflict** — upstream reimplements the fork's own #569.                    |
| `774a9fd8684` | correct mislabeled Bengali locale entry (#30519)              | mobile  | NONE         | One-line constant.                                                           |
| `c2db36934f0` | show selected-item count in AlbumPickerModal title (#30485)   | web     | **MEDIUM**   | **Conflict** — touches a file fork #708 deletes.                             |
| `4d9a27691ee` | action provider overrides (#30480)                            | mobile  | **MEDIUM**   | Riverpod `dependencies:`; needed fork-side propagation.                      |
| `e5c3bdad17d` | sync stack changes from the websocket (#30479)                | mobile  | LOW          | Handler rename + one extra socket event.                                     |
| `46c42e0935b` | delete mergify config (#30521)                                | CI      | NONE         | Fork never used `.mergify.yml`.                                              |
| `0d7147dceca` | metadata extraction as LensModel can be a float (#30512)      | server  | **HIGH**     | Silently reverted by a fork commit on replay — see below.                    |

### High-risk changes (detailed)

#### `cee08a2320d` — upstream reimplements the fork's #569

Upstream added a minimal rollback: `let asset: Asset | undefined` at the top of `uploadAsset`,
and `if (asset) await this.assetRepository.remove({ id: asset.id })` in the catch.

The fork already had **#569 "roll back incomplete asset uploads"**, which is strictly more
thorough: it extracts a private `create()` wrapping all post-create work in try/catch, removes
the asset row on failure, **and deletes any already-written S3 objects** (`backendFiles`) — which
upstream has no notion of — plus a `SKIP_UPLOAD_FILE_CLEANUP` symbol for when the row removal
itself fails, and an extracted `handleUploadError()`.

**Resolution**: keep the fork's structure and graft upstream's guard so the result is a strict
superset. `create()` already rolls back everything that fails _inside_ it; upstream's outer guard
additionally covers the window _after_ `create()` returns (`addToSharedLink`, `updateUsage`),
which the fork did not cover. These compose without double-removal: if `create()` throws, the
outer `asset` was never assigned, so `if (asset)` is false.

`handleUploadError` gained an optional `asset?: Asset` parameter, and removes the row **after**
the duplicate-checksum early return — preserving upstream's ordering.

Upstream's new spec assertion only strengthens the quota-rejection path (`asset.create` not
called ⇒ `asset.remove` not called); the fork's structure satisfies it unchanged.

#### `0d7147dceca` — silently reverted on replay (caught by the build gate)

Upstream re-typed `LensModel` as `StringOrNumber` (it can be a float in the wild) and wrapped the
lookup in `String(...)`. The rebase applied that, and then the fork's
`3c6a4dfd88f "chore(lint): apply eslint-unicorn v70 autofixes to fork-only server code"` replayed
on top. That commit had previously **stripped the same `String()` wrapper** as a useless
conversion; its hunk rewrote the block wholesale, so on replay it won and dropped upstream's fix.

Git reported no conflict. It surfaced only at `pnpm build`:
`Property 'trim' does not exist on type 'number'`.

**Resolution**: restored upstream's form (commit `abf4da93fb1`). The coercion is no longer useless
now that the field is `StringOrNumber`, so the unicorn rule does not re-fire. Checked the sibling
`projectionType` line from the same autofix commit — it already matches `upstream/main` exactly,
so no second instance.

This is the "lost upstream content" class the skill warns about, arriving through a _lint autofix_
rather than a conflict resolution — worth remembering: an autofix that removes a defensive
coercion becomes a landmine the moment upstream re-widens the type.

## Conflict Resolutions

### Conflict: `server/src/services/asset-media.service.ts` (batch 45)

- **Fork side**: #569's `create()` / `handleUploadError()` extraction with S3 object cleanup.
- **Upstream side**: #30349's minimal `let asset` + `if (asset) remove()`.
- **Resolution**: fork structure retained; upstream's outer-window guard grafted in via a new
  optional `asset?: Asset` parameter on `handleUploadError`, removal placed after the duplicate
  early-return.
- **Risk**: LOW — strict superset; no double-removal path exists.
- **Verification**: `server pnpm check` + full server unit suite (5265 pass), including upstream's
  new assertions in `asset-media.service.spec.ts`.

### Conflict: `web/src/lib/modals/PersonMergeSuggestionModal.svelte` (batch 45)

- **Fork side**: #777 swaps `getPeopleThumbnailUrl` → `getGlobalPersonThumbnailUrl` (space-aware).
- **Upstream side**: #30466 wraps both `<ImageThumbnail>`s in `{#key person.id}` to force a
  re-render, since `<Image>` captures only the first `src`.
- **Resolution**: took both — upstream's `{#key}` wrapper around the fork's URL helper. Fully
  orthogonal changes.
- **Risk**: LOW.
- **Verification**: `check:svelte` (575 files, 0 errors); no residual `getPeopleThumbnailUrl`
  reference or unused import in the file.

### Conflict: `i18n/en.json` + `web/src/lib/modals/AssetAddToAlbumModal.svelte` (batch 46)

- **Fork side**: #708 (unified album + space picker) **deletes** `AssetAddToAlbumModal.svelte`,
  replacing it with `CollectionPickerModal` / `AssetAddToCollectionModal`, and adds
  `add_to_album_or_space` + `add_to_album_toggle`.
- **Upstream side**: #30485 **modifies** the deleted file to pass `selectedItemsCount`, and adds
  `add_to_album_item_count`.
- **Resolution**: honoured the fork's deletion (`git rm`); merged all three i18n keys in
  alphabetical order.
- **Risk**: LOW — verified 0 remaining references to `AssetAddToAlbumModal`. `AlbumPickerModal`
  survives and is now used only by `SchemaAlbumPicker`, which passes `{}` (upstream's own change);
  `selectedItemsCount` is optional so this compiles and behaves correctly.
- **Verification**: `check:typescript`, `check:svelte`, web unit suite (4096 pass).

## Pattern Propagation

| Refactor                                        | Old → New Pattern                                       | Fork Files Affected                                             | Decision     | Commit / Follow-up |
| ----------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | ------------ | ------------------ |
| Riverpod provider scoping (#30480)              | bare `Provider.family` → `dependencies: [...]` declared | `mobile/lib/presentation/actions/remove_from_space.action.dart` | **Bundled**  | `240c7c51736`      |
| Album-description search in the picker (#30462) | name-only match → name-or-description match             | `web/.../collection-selection/collection-selection-utils.ts`    | **Deferred** | see below          |

### Riverpod `dependencies:` — bundled (correctness, not cosmetics)

Upstream annotated every action provider with `dependencies:` and, in the same commit, changed the
test harness to nest a **second `ProviderScope`** for overrides. Without the declaration a provider
is not recreated in the inner scope, so it reads the **outer, unoverridden** value.

The fork-only `remove_from_space.action.dart` declares `_hasRemoteAssetsProvider` deriving from
`assetsActionProvider` and had no declaration — so a scoped `multiSelectProvider` override would
not have reached it. Added `dependencies: [assetsActionProvider]`, matching
`remove_from_album.action.dart`, which is upstream's own deliberately **not** owner-scoped sibling.

This preserves the standing constraint that removal from a Space is not owner-scoped: the provider
still derives from `assetsActionProvider`, never `ownedAssetsActionProvider`.

The fork's other divergent action, `similar_photos.action.dart`, declares no provider — nothing to
propagate.

### Album-description search — deferred (needs a product call)

Upstream #30462 made the add-to-album picker match on `album.description` as well as name. The
fork replaced that picker on the timeline path with `CollectionPickerModal`, whose
`CollectionModalRowConverter` matches on `c.name` only.

Deferring rather than bundling, because this is a **feature parity gap requiring a product
decision**, not a mechanical refactor: the fork's picker also lists **Spaces**, so the question
"should space descriptions be searchable too?" has to be answered before implementing, and
`PickerCollection` would need to carry a description. Implementing it silently would be widening
scope into product design.

**Follow-up**: open a fork issue/PR to decide whether `CollectionPickerModal` should match
descriptions for albums, spaces, or both.

## Fork Feature Verification

| Feature               | Status | Notes                                                                          |
| --------------------- | ------ | ------------------------------------------------------------------------------ |
| Shared Spaces         | OK     | Untouched; `Fork-Owned File Survival` + `Fork Extension Symbol Survival` pass. |
| Storage Migration     | OK     | S3 write path in `uploadAsset` preserved through the #569 reconciliation.      |
| Pet Detection         | OK     | Untouched.                                                                     |
| Image Editing         | OK     | Untouched.                                                                     |
| Branding              | OK     | `ci-invariants-check` passes (image names, docs-deploy, no PUSH_O_MATIC).      |
| Google Photos Import  | OK     | Untouched.                                                                     |
| Global Face Identity  | OK     | `getGlobalPersonThumbnailUrl` retained in the merge modal.                     |
| Collection Picker     | OK     | Fork deletion of `AssetAddToAlbumModal` honoured; 0 dangling references.       |
| Mobile Spaces actions | OK     | `remove_from_space` retained and correctly scoped; see Propagation.            |

## CI and Infrastructure Verification

| Check                                     | Status | Notes                                                        |
| ----------------------------------------- | ------ | ------------------------------------------------------------ |
| Workflow files (no upstream collisions)   | OK     | Only change is upstream deleting `.mergify.yml` (unused).    |
| Docker image references (`gallery-*`)     | OK     | `ci-invariants-check`: `gallery-release-image-names` passes. |
| Branding (no "Immich" leaks in CI/config) | OK     | No workflow/config changes beyond the mergify deletion.      |
| Fork CI modifications intact              | OK     | `ci-invariants-check` all three invariants pass.             |
| New upstream workflows reviewed           | OK     | None added.                                                  |
| `@immich/ui` patch                        | OK     | `fork-patches-check` passes.                                 |

## Database Migration Analysis

**No new upstream migrations in this range.**

- Gallery migration count: **49** (expected 49) — `Gallery Migration Count` passes on all 5 batches.
- Timestamp collisions: **NONE** — `Migration Timestamp Collision Check` passes.
- Migration filename survival + manifest coverage: pass.
- `postbuild` script intact: **YES** — build logs
  `Synced 49 Gallery migrations into dist/schema/migrations; removed 0 stale files; wrote 1 compatibility aliases.`
- `CompositeMigrationProvider` intact: **YES**.
- The load-bearing `ChangeDurationToInteger` compatibility alias is still emitted (1 alias).

`f1a90b7f36a` touches `DatabaseRepository.runMigrations` but only to add a friendlier error when a
recorded migration has no file on disk — the exact failure the fork's alias exists to prevent. It
does not alter `createMigrator`'s `allowUnorderedMigrations: true`.

### `revert-to-immich.sql` coverage (step 7i)

Detector run against `v3.1.0` (88 migrations in the tagged upstream tree): **0 MISSING**. No new
fork or post-tag upstream migrations arrived this cycle, so no entries were needed.

## Mobile Drift Migration Analysis

**No upstream mobile migrations in this range.**

`mobile-drift-rebase-check BATCH=49` passes: schemaVersion, snapshots, and Gallery callbacks
consistent. No renumbering needed; no fork snapshot touched.

## Inconsistencies Found

1. **`getLensModel` silently reverted** — see High-risk changes. Fixed in `abf4da93fb1`.
2. **Fork-only action provider missing `dependencies:`** — see Pattern Propagation. Fixed in
   `240c7c51736`.

No other inconsistencies: no renamed imports, no changed signatures reaching fork code, no schema
or enum drift, no removed APIs the fork depends on, no route or env-var changes.

## Local CI Verification

| Check                                            | Status | Notes                                                                                               |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | 49 migrations, 1 compatibility alias.                                                               |
| `server pnpm check` (tsc)                        | PASS   |                                                                                                     |
| `server pnpm lint`                               | PASS   |                                                                                                     |
| Server unit tests                                | PASS   | 157 files, **5265 pass**, 14 skipped.                                                               |
| `web check:typescript`                           | PASS   |                                                                                                     |
| `web check:svelte`                               | PASS   | **575 files**, 0 errors (not the 0-file local no-op).                                               |
| web eslint (`tscompat` off)                      | PASS   | exit 0.                                                                                             |
| Web unit tests                                   | PASS   | 300 files, **4096 pass**.                                                                           |
| `dart format` (lib, excl. generated)             | PASS   | 792 files, 0 changed.                                                                               |
| `dart analyze --fatal-infos lib test`            | PASS   | **No issues found** (after regenerating local codegen).                                             |
| `flutter test`                                   | PASS   | **3122 pass**.                                                                                      |
| OpenAPI regeneration                             | N/A    | No controller/DTO/repository change; audit's `Generated Artifact Review` reports nothing to review. |
| `make sql`                                       | N/A    | No `@GenerateSql` repository method changed; not run (destructive without a DB).                    |

Note on the Dart gate: the first `dart analyze` run reported 199 errors that were purely **stale
local codegen** (mobile codegen is gitignored since #888, and several shared-space album entities
had never been generated in this worktree). After `build_runner build` and
`drift_dev schema generate`, the count went 199 → 5 → **0**. The 5 intermediate errors were the
Drift schema snapshots (`schema_v32..v36`), generated by the second task.

## Remote CI Verification

- **Test branch**: `rebase/upstream-b49`
- **Commit validated**: `abf4da93fb1`
- **Result**: **10/10 GREEN, first pass** — no re-dispatches, no flakes.

| Workflow                                  | Status | Run           | Notes                                                                    |
| ----------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------ |
| `test.yml`                                | GREEN  | `30835749626` | Inspected job-by-job: **21/21 success, 0 skipped**.                      |
| `docker.yml`                              | GREEN  | `30835752124` | Server/web/cli/ml images build.                                          |
| `static_analysis.yml`                     | GREEN  | `30835754609` | `dart analyze --fatal-infos`, `dart format`, codegen freshness.          |
| `gallery-build-mobile.yml`                | GREEN  | `30835769790` | iOS + Android compile (development, no store upload).                    |
| `gallery-mobile-smoke.yml`                | GREEN  | `30835765347` |                                                                          |
| `gallery-ml-smoke.yml`                    | GREEN  | `30835763272` |                                                                          |
| `gallery-rebase-smoke.yml`                | GREEN  | `30835756466` |                                                                          |
| `storage-migration-tests.yml`             | GREEN  | `30835758886` |                                                                          |
| `storage-migration-e2e.yml`               | GREEN  | `30835767508` |                                                                          |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `30835761009` | Both halves — coverage grep **and** the `:main` Docker-boot drift check. |

- **Failures fixed**: none (both fix commits were made pre-push, from local gates).
- **Confirmed flakes**: none.

PR-only workflows (codeql / zizmor / docs-build / cli) were not run — this was a LOW-risk batch
with no source changes in their scope.

## Post-Rebase Verification

- Fork commits ahead of upstream: **1079** (unchanged from pre-rebase)
- Commits behind upstream: **0** — level with `upstream/main` @ `0d7147dceca`
- Fork diff clean: **YES** — `git diff backup/rolling-pre-batch45-49-20260803 HEAD --stat` contains
  only the 14 upstream commits' files plus the three documented resolutions and two fix commits.
- Backup branch: `backup/rolling-pre-batch45-49-20260803` @ `417d9b76f20`

## Environment note

Mid-rebase, git emitted repeated `packfile ... index unavailable` errors. Cause: a concurrent
repack in the main checkout consolidated packs while the worktree's `multi-pack-index` still
referenced the old pack. The errors were **non-fatal** (git fell back to reading packs directly)
and the rebase completed correctly — verified by fork commit count and the backup diff. Repaired
with `rm .git/objects/pack/multi-pack-index && git multi-pack-index write`.
