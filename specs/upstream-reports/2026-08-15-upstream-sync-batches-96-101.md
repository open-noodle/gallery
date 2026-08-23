# Upstream Sync Report — 2026-08-15

## Summary

- **Upstream commits pulled**: 9 (`af33a78d180..f9c05af45f8`, batches 96–101)
- **Fork commits synced**: 8 (`93f844e9aaa..690fd44e12c`, #982 → #987)
- **Conflicts resolved**: 10 during the upstream replay, 10 during the fork sync
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED

Branch `rebase/upstream-rolling-v3.1.1` is **level with `upstream/main`** and **fork-synced to the tip**
(`make upstream-rolling-status` → 101/101 batches, 0 fork commits pending). Still **off `main`** —
upstream's newest tag is still `v3.1.0`, so the standing landing rule is not satisfied.

## Incoming Upstream Changes

| SHA           | Summary                                       | Area              | Risk to Fork | Notes                                                                                                        |
| ------------- | --------------------------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `447cc40a509` | feat: workflow logging (#29878)               | server/web/mobile | MEDIUM       | New `workflow_log` table + migration; touches `workflow.dto.ts` where the fork hardens `name` with `.min(1)` |
| `f9c05af45f8` | fix(server): migration order (#30774)         | server            | MEDIUM       | Re-timestamps that migration `1783930557118` → `1786741078327`                                               |
| `652ef8a427b` | refactor: server capabilities (#30663)        | mobile            | HIGH         | Rewrites the version gates in `sync_api.repository.dart`, where the fork's space-album gate lives            |
| `14241ac7bc1` | chore(server): remove unused code (#30772)    | server/e2e        | HIGH         | 328 deletions across `types.ts`, `enum.ts`, repositories, test fixtures                                      |
| `b19c4a591e4` | chore(web): remove unused code (#30768)       | web               | HIGH         | 329 deletions across stores, utils, factories                                                                |
| `342a9472c4a` | refactor: duplicate e2e (#30773)              | e2e/server        | LOW          | Deletes `duplicate.e2e-spec.ts` (651 lines), adds a medium test                                              |
| `6a61901e799` | fix: shared link create validation (#30762)   | server            | LOW-MED      | Behavioural: now rejects `albumId`+`assetIds` together, or neither                                           |
| `190a939af7c` | fix(mobile): iOS smart quotes/dashes (#30767) | mobile            | LOW-MED      | Touches `login_form.dart`, which carries the fork's demo-mode button                                         |
| `66d010381e3` | fix(mobile): pinch-to-zoom release (#29343)   | mobile            | LOW          | One line                                                                                                     |

**Fork divergence: 32 of 84 touched files (38%)** — above the 36% that previously forecast a
12-step/31-conflict cycle. It over-predicted here (10 conflicts), consistent with the standing note
that the ratio measures how much fork content sits in the touched files, not how much upstream changed.

### Per-batch product-direction gate: did NOT fire

Each candidate was checked against its diff rather than its subject:

- **Workflow logging** — additive logging on upstream's own engine. The fork's merged workflow surface
  is one `.min(1)` validation, a fork-only `WorkflowSummary.svelte` and fork-authored specs. The
  shared-space workflow actions are still **unmerged PR #981**, so there is no competing direction;
  #981 will land on an engine that now logs, which helps it.
- **Shared link validation** — a `superRefine` tightening on upstream's own DTO, not a rework of the
  sharing model. Shared Spaces untouched.
- **Server capabilities** — mechanical: version comparisons become a `ServerCapability` enum. Upstream's
  mechanism is version-derived; the fork's space-album gate is _server-declared_ via
  `GET /server/features`. Parallel mechanisms, no collision.
- **Duplicate e2e** — `duplicate.e2e-spec.ts` was **byte-identical to the upstream base**, so its
  deletion loses no fork tests.

## Zero-Conflict Semantic Breaks

Six this cycle — four found before the rebase, one during the fork sync, one only in remote CI. All
merge clean and break in a file upstream never touched.

| Upstream change                                                                 | What broke, elsewhere                                                                                                                                             | Caught by                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| #30768 deleted `userFactory` from `web/src/test-data/factories/user-factory.ts` | fork-diverged `album-factory.ts` (fork added `albumUsers`) + fork-only `SpaceLinkAlbumModal.spec.ts`                                                              | pre-rebase symbol sweep; confirmed by `web check:typescript` |
| #30772 deleted `DatabaseRepository.revertLastMigration`                         | fork-only `database-migration.service.spec.ts` scenarios D and G                                                                                                  | pre-rebase symbol sweep; confirmed by `server pnpm check`    |
| #30772 deleted `StorageCore.getTempPathInDir`                                   | fork-only `describe('getTempPathInDir')` block in `storage.core.spec.ts`                                                                                          | `server pnpm check`                                          |
| #30774 re-timestamped `AddWorkflowLogsTable`                                    | `revert-to-immich.sql` coverage gate                                                                                                                              | the step-7i detector                                         |
| #30667–#30672 deleted `lib/extensions/translate_extensions.dart`                | fork-sync commit #970 (authored on `main`, where it still exists) called `'<key>'.t(context:)` in `collection_picker.widget.dart`                                 | `dart analyze --fatal-infos`                                 |
| #30773 converted the duplicate suite from an **e2e** spec to a **medium** spec  | the fork's #317 space-membership carry-over in `resolveGroup` reaches `SharedSpaceRepository`, which upstream's new DI list does not name → 14 of 25 tests failed | **remote `Medium Tests (Server)` only**                      |

### The sixth is a new shape worth naming: e2e → medium conversion drops a fork repository

An e2e spec boots the real DI container, so every fork repository is present whether the test knows
about it or not. A medium spec declares its dependencies **explicitly** — and upstream's list only
names upstream's. So the moment upstream converts a suite covering a service the fork has extended,
the fork's extra repository is silently `undefined` and every call through it throws.

It surfaces as a _behavioural_ failure, not a type error: `resolveGroup` throws
`Cannot read properties of undefined (reading 'getEditableByAssetIds')`, `resolve` catches it, and the
suite sees `success: false, error: "unknown"` — 14 assertions reading
`expected [ { …(3) } ] to deeply equal [ { …(2) } ]`, which looks like a DTO-shape drift and is not.
`tsc` cannot see it (the property access is on an injected class, typed fine), and no audit looks at
medium DI lists. **Only running the medium suite finds it.**

Generalise: **after any batch that converts an upstream e2e spec into a medium/unit spec, check whether
the service under test is one the fork extends, and diff the new spec's `real`/`mock` lists against
`BASE_SERVICE_DEPENDENCIES` for fork repositories the fork's code path reaches.**

Ruled out on inspection: `SidebarSettings` was a **false positive** — the fork's hits are a Svelte
component of that name from the sidebar rail (#921), not the deleted `preferences.store.ts` interface.
`CropPreset.svelte` and its `CropAspectRatio` type were upstream-identical with no fork importer.

### Detectors

- **URL-literal (silent branding no-op)**: one hit, `https://docs.immich.app` — **false positive**. It is
  a `DOCS_BASE` const deleted from `web/src/lib/route.ts` as dead code; the literal still occurs in ~10
  other files `apply-branding.sh` rewrites, so no rule became a no-op.
- **Shape D/E (fork patch anchor deleted / shared mise-task semantics)**: clear. The batch touches no
  workflow file, `mise.toml`, `Makefile`, or `package.json` script.
- **Cross-ownership asset↔test coupling**: no new pairs.

## Conflict Resolutions

### Upstream replay (10)

The governing rule throughout was **resolve each conflict at its own point in history**, and for import
blocks **count body uses rather than pick a side**.

#### Conflict: `server/src/repositories/machine-learning.repository.ts`

- **Fork side**: keeps `DetectedFaces` and adds the pet-detection types + extended `MachineLearningRequest`.
- **Upstream side**: deletes `DetectedFaces` as unused.
- **Resolution**: accepted the deletion (`DetectedFaces` has no other reference anywhere in the fork),
  kept every pet-detection addition.
- **Risk**: LOW. **Verified**: `git grep -w DetectedFaces` across `server machine-learning web e2e`.

#### Conflict: `server/test/small.factory.ts` (3 blocks)

- **Fork side**: a large fork factory set plus `jobAssets: { sidecarWrite }`.
- **Upstream side**: deletes `assetSidecarWriteFactory`, the `jobAssets` entry and the `Exif` /
  `AssetFileType` imports.
- **Resolution**: kept the fork's factories and **restored `assetSidecarWriteFactory` as fork-owned**,
  because `metadata.service.spec.ts` drives four sidecar-write cases through it. Note the _definition_
  deletion auto-merged silently — only the object-literal entry conflicted.
- **Risk**: LOW. **Verified**: upstream's tree has zero `jobAssets` references, so all four call sites
  are the fork's.

#### Conflict: `mobile/lib/infrastructure/repositories/sync_api.repository.dart`

- **Fork side**: the fork's shared-space/library request types.
- **Upstream side**: `serverVersion >= SemVer(...)` becomes `serverVersion.supports(.capability)`.
- **Resolution**: upstream's `.supports()` form for upstream's entries, fork block verbatim.
- **Risk**: LOW. **Verified**: the resolved file diffs against the fork side by exactly upstream's six
  `.supports()` conversions plus the new import — nothing else.

#### Conflicts: `storage.core.ts`, `search.repository.ts`, `person.repository.ts` (×2), `types.ts`, `utils/database.ts`

All the same shape — upstream deletes an unused export, the fork commit adds a different one to the same
import block or region. Each resolved by counting body uses: dropped `randomUUID`, `OcrSearchOptions`,
`Selectable`, `ISidecarWriteJob`, `asVector` (all zero uses at the fork tip); kept `isAbsolute`,
`SmartSearchFacets*`, `SqlBool`, `Transaction`, `IAssetDetectFacesJob`, `uniqueTruthyIds`.
**Risk**: LOW, all compiler-verified.

#### Conflicts: `server/test/medium.factory.ts` (×3)

Adjacent additions — upstream adds `DuplicateRepository` exactly where the fork adds
`FaceIdentityRepository` / `DownloadRepository`. Kept both, in list order. The third instance sat on the
`#749 → revert → #752` sequence and was resolved **at each commit's own point**: the revert removes
`DownloadRepository`, #752 re-adds it. Verified consistent afterwards (both import and `case` present).
**Risk**: LOW.

#### Conflicts: `web/src/lib/managers/edit/transform-manager.svelte.ts` (×2), `web/src/lib/services/album.service.ts`

Upstream deletes `CropAspectRatio` (its only consumer, `CropPreset.svelte`, is deleted and nothing
imports it) and `handleConfirmAlbumDelete` (no fork caller). Accepted both deletions; kept the fork's
`handleLinkAlbumToSpace`. **Risk**: LOW, verified against the fork tip.

#### Generated artifacts — `packages/sdk/src/fetch-client.ts`

Deferred through the whole replay and resolved by **one authoritative regen** at the end
(`mise run //:open-api-typescript`). Two fork commits whose entire content was this file became empty
and were dropped by git (1167 → 1165 fork commits) — expected, and covered by the regen.

**Verification** (this is what makes the deferral safe rather than merely convenient): the spec has
**zero drift**, and the regenerated client differs from the pre-rebase fork tip by **exactly 52 lines,
all of them upstream's workflow-logging surface** (`getWorkflowLogs`, `WorkflowLogEntryDto`,
`WorkflowResult`, the `logging` field, the `searchWorkflows` signature). Every fork route family
(`/gallery/map/markers`, `/shared-spaces`, `/storage-migration`, `/user-groups`, `/classification`) has
an identical occurrence count before and after.

### Fork sync (10 across 3 commits)

`make upstream-sync-fork-main` threw on a real conflict in #970 and rolled the whole batch back
(all-or-nothing). All 8 commits were then cherry-picked `--ff` by hand and `rolling-state.json`
reconciled with `handApplied: true`.

Every conflict was the **standing action-model divergence**: `main` still predates upstream #29617 (the
move out of `presentation/widgets/action_buttons/`) and #30667–#30672 (the generated translations
accessor), so each fork commit touching a bottom sheet collides on `main`'s older import block.
Resolved per the standing rule as **rolling's minimal import set + the commit's real delta**
(`git diff <commit>^ <commit> -- <file>`), never by taking `main`'s import block.

- **#970** (6 files): `add_action_button` and four bottom sheets swap `AlbumSelector` for
  `CollectionPicker` and drop their local `addToAlbum` helpers; `collection_picker_test` import union.
- **#984** (3 files): the `sliverAfterSearch` restructure kept in the `context.t` idiom;
  `space_collection_section` gains `thumbnail.widget`; `space_album_bottom_sheet_test` unions rolling's
  `_actionOfType` helper and settings override with #984's new stubs.
- **#985** (1 file): `writableOnly: true` onto rolling's `searchHint` line.

**Verification**: the replayed file set equals `main`'s for all 8 commits (2/30/17/7/11/7/8/1 files,
zero differences). None touched `mobile/openapi`, so the standing de-commit conflict class did not apply.

## Fork Feature Verification

| Feature              | Status | Notes                                                                                           |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Shared Spaces        | OK     | Space-album sync types and the `supportedSyncTypes` gate intact through the capability refactor |
| Storage Migration    | OK     | `isAbsolute` S3 relative-path guard preserved in `storage.core.ts`                              |
| Pet Detection        | OK     | `DetectedPet` / `PetDetectionRequest` / extended union intact                                   |
| Image Editing        | OK     | Only dead `CropAspectRatio` removed; `transform-manager` behaviour unchanged                    |
| Branding             | OK     | `gallery-branding-check.sh` passed end to end                                                   |
| Google Photos Import | OK     | Untouched                                                                                       |
| Global Face Identity | OK     | `FaceIdentityRepository` registration preserved in `medium.factory`                             |
| Fork migrations      | OK     | 58 gallery migrations; postbuild reports "Synced 58 … 1 compatibility aliases"                  |

## CI and Infrastructure Verification

| Check                                        | Status | Notes                                                              |
| -------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `make upstream-postrebase-audit BATCH=101`   | OK     | 7/7 checks pass, including migration count 58 (expected 58)        |
| `make fork-patches-check`                    | OK     | `@immich/ui` patch metadata consistent                             |
| `make ci-invariants-check`                   | OK     | no-push-o-matic, gallery release image names, docs-deploy disabled |
| `make mobile-drift-rebase-check BATCH=101`   | OK     | schemaVersion, snapshots and Gallery callbacks consistent          |
| `make fork-ownership-coverage-check`         | OK     | 3670 fork files covered; cursor advanced to #987                   |
| `branding/scripts/gallery-branding-check.sh` | OK     | Branding + mobile image asset verification passed                  |

## Database Migration Analysis

### New Upstream Migrations

| Timestamp     | Migration            | Tables                                   | Risk to Fork | Notes                                           |
| ------------- | -------------------- | ---------------------------------------- | ------------ | ----------------------------------------------- |
| 1786741078327 | AddWorkflowLogsTable | `workflow_log` (new), `workflow.logging` | LOW          | Purely additive; no fork-extended table touched |

The migration arrived as `1783930557118` in #29878 and was re-timestamped to `1786741078327` by #30774
in the same batch, so only the final name lands on disk and no deployed fork database ever recorded the
earlier one. No compatibility alias is needed.

- **Timestamp ordering**: `1786741078327` sits below the fork's `1787000000000`–`1790000000000` block.
  Collision check passes.
- **Postbuild merge**: intact — "Synced 58 Gallery migrations … wrote 1 compatibility aliases".

### `revert-to-immich.sql`

The step-7i detector reported exactly one gap, now closed: section 7 drops `workflow_log` (taking its
two indexes and two foreign keys with it) and the `workflow.logging` column, both `IF EXISTS`-guarded
because the script also runs against a tagged-release DB where neither existed; step 8 deletes the
`'1786741078327-AddWorkflowLogsTable'` row. Detector re-run clean.

## Mobile Drift Migration Analysis

No upstream mobile migrations in this batch. `mobile-drift-rebase-check` reports schemaVersion,
snapshots and Gallery callbacks consistent. No renumbering was needed.

## Inconsistencies Found

None beyond the five semantic breaks above, all fixed in this branch.

## Pattern Propagation

| Refactor                     | Old → New Pattern                                                      | Fork Files Affected                                  | Decision     | Commit / Follow-up |
| ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------ | ------------------ |
| Server capabilities (#30663) | `serverVersion >= SemVer(...)` → `serverVersion.supports(.capability)` | 1 (`sync_api.repository.dart`, the space-album gate) | **Deferred** | See below          |

The fork's space-album gate is **server-declared**, not version-derived: `GET /server/features`
advertises `syncRequestTypes` and the version comparison survives only as a fallback for fork servers
that predate capability signalling. Upstream's `ServerCapability` enum maps a capability to a minimum
_upstream_ version, which cannot express a fork version boundary or a server-declared list. Converting
would mean inventing a fork-only enum entry whose semantics differ from every other entry in it.
Deliberately left on the raw comparison; revisit only if upstream generalises `ServerCapability` beyond
version thresholds.

## Local CI Verification

| Check                                            | Status | Notes                                                                      |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync) | PASS   | Synced 58 Gallery migrations, 1 compatibility alias                        |
| `server pnpm check` (tsc)                        | PASS   |                                                                            |
| `web check:typescript`                           | PASS   |                                                                            |
| `web check:svelte`                               | PASS   | 609 files, 0 errors, 0 warnings                                            |
| `server pnpm lint`                               | PASS   |                                                                            |
| web eslint (`tscompat` off)                      | PASS   | 0 errors; 13 warnings are artifacts of the local rule override             |
| `e2e pnpm lint` + `tsc --noEmit`                 | PASS   |                                                                            |
| Server unit tests                                | PASS   | 171 files, 5685 passed / 12 skipped                                        |
| Web unit tests                                   | PASS   | 363 files, 5694 passed / 2 skipped / 8 todo                                |
| `dart analyze --fatal-infos lib test`            | PASS   | No issues found                                                            |
| `dart format` (lib, mirroring CI)                | PASS   | 802 files, 0 changed                                                       |
| `flutter test`                                   | PASS   | 3336 passed / 1 skipped / 0 failed                                         |
| OpenAPI regeneration                             | PASS   | Zero spec drift; SDK delta is exactly upstream's new surface               |
| ML gates                                         | N/A    | `machine-learning/` provably untouched by both the batch and the fork sync |

Mobile gates were run with the pinned toolchain invoked directly
(`~/.local/share/mise/installs/aqua-flutter-flutter/3.44.9/flutter/bin`). Both `mise.lock` files are
unmodified.

## Remote CI Verification

- **Test branch**: `rebase/upstream-b101`
- **Commit validated**: `568ace3fce0` (final); the seven unaffected workflows are green on
  `6b17f7857fc`, with the delta between them being three files — see the skew note below.

| Workflow                                  | Status | Green on      | Notes                                        |
| ----------------------------------------- | ------ | ------------- | -------------------------------------------- |
| `test.yml`                                | GREEN  | `568ace3fce0` | 21/21 jobs, 0 skipped                        |
| `docker.yml`                              | GREEN  | `568ace3fce0` | re-run because it builds the web bundle      |
| `gallery-rebase-smoke.yml`                | GREEN  | `568ace3fce0` | re-run because it drives a web build         |
| `static_analysis.yml`                     | GREEN  | `6b17f7857fc` | mobile-only; unaffected by the delta         |
| `gallery-build-mobile.yml`                | GREEN  | `6b17f7857fc` | Android **and** iOS legs both success        |
| `gallery-mobile-smoke.yml`                | GREEN  | `6b17f7857fc` | mobile-only; unaffected                      |
| `storage-migration-tests.yml`             | GREEN  | `6b17f7857fc` | does not run server medium specs             |
| `storage-migration-e2e.yml`               | GREEN  | `6b17f7857fc` | does not run server medium specs             |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `6b17f7857fc` | coverage **and** Docker-boot half; see below |
| `gallery-ml-smoke.yml`                    | GREEN  | `6b17f7857fc` | `machine-learning/` untouched                |

**On the SHA skew**: the delta from `6b17f7857fc` to `568ace3fce0` is exactly three files — a trailing
blank line in `web/src/lib/services/album.service.ts`, the DI entry in
`duplicate.service.spec.ts`, and this report. The three workflows whose inputs that delta actually
reaches were re-dispatched; the other seven read only paths the delta does not touch.

**Revert-to-immich validation was checked past the coverage grep**, since a passing grep is necessary
but not sufficient. The run log shows both new statements executing against the tagged `:main` image
and correctly no-op'ing —
`NOTICE: table "workflow_log" does not exist, skipping` /
`NOTICE: column "logging" of relation "workflow" does not exist, skipping` — followed by
`Post-phase drift (0 item(s))` and `revert-to-immich validation PASSED`. That is the proof the
`IF EXISTS` guards were load-bearing.

**First-round failures and their classification** (`test.yml` on `6b17f7857fc`, 17/21):

| Job                    | Cause                                                             | Class                    |
| ---------------------- | ----------------------------------------------------------------- | ------------------------ |
| Test Web               | trailing blank line from the `handleConfirmAlbumDelete` removal   | real — local gate hole   |
| Medium Tests (Server)  | `SharedSpaceRepository` absent from upstream's new medium DI list | real — semantic break #6 |
| End-to-End Tests (Web) | `maintenance.e2e-spec.ts` "enter and exit maintenance mode"       | **flake**                |

The maintenance failure was classified as a flake on evidence, not assumption: the spec and
`maintenance-auth.guard.ts` are both **byte-identical to `upstream/main`**, the entire maintenance-mode
surface has zero fork divergence (only the unrelated `database-backups` specs diverge), the batch's
only change there deleted two unused exports, and it passed on a re-run in which nothing touching it
had changed. The accompanying `Error: 404` noise points at the server restart that entering
maintenance mode triggers.

## Post-Rebase Verification

- Fork commits ahead of upstream: 1179 (1167 → 1165 through the replay as two pure OpenAPI-regen
  commits emptied and were dropped, then +14 from the fork sync, the fix commits and this report)
- Commits behind upstream: 0
- `make upstream-rolling-status`: 101 / 101 batches, 0 fork commits pending
- Fork diff looks clean: YES

## Landing

Not a cutover cycle. Upstream's newest tag is still `v3.1.0`, so `branding/config.json`
`upstream.version` stays at `3.1.0` and the branch stays off `main`.
