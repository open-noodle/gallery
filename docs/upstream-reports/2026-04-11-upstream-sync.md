# Upstream Sync Report — 2026-04-11

## Summary

- **Upstream commits pulled**: 9
- **Conflicts resolved**: 2 (both trivial)
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Upstream version**: Immich v2.7.2 → **v2.7.4**

This is one of the cleanest upstream syncs to date. Nine commits, mostly version bumps and mobile/iOS image-loading cleanup. Zero database migration changes (server or mobile), zero CI workflow changes, zero schema changes. The two conflicts were a fork-pinned mobile version (`1.0.0+1` for the Play Store release) and a binary OpenAPI README — both expected and resolved cleanly.

## Incoming Upstream Changes

| SHA         | Summary                                                                | Area           | Risk to Fork | Notes                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------- | -------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bee49cef0` | chore: version v2.7.4                                                  | meta           | LOW          | Pure version bump across `*/package.json`, `pubspec.yaml`, etc. Triggered branding/config + README update.                                                                                                                                                                       |
| `6d0c6a400` | chore: pump cronet version (#27685)                                    | mobile/android | LOW          | `mobile/android/app/build.gradle` only.                                                                                                                                                                                                                                          |
| `8a975e5ea` | refactor(mobile): cleanup iOS image loading pipeline (#27672)          | mobile/ios     | LOW          | iOS Swift only. Fork doesn't touch these files.                                                                                                                                                                                                                                  |
| `d39e7da10` | fix(mobile): flutter cache eviction on thumbnails (#27663)             | mobile         | LOW          | `mobile/lib/presentation/widgets/images/*`. Fork's mobile rewrite is in `infrastructure/`, no overlap.                                                                                                                                                                           |
| `bc400d68a` | chore: move .tsbuildinfo to dist (#27682)                              | build          | LOW          | Adds `tsBuildInfoFile` to `cli/tsconfig.json`, `server/tsconfig.json`, `server/tsconfig.build.json`.                                                                                                                                                                             |
| `d7f038ec6` | chore(deps): eslint-plugin-unicorn → v64 (#27575)                      | deps/lint      | MEDIUM       | Bumps lint package + `pnpm-lock.yaml` regen. Adds 1 lint disable in `ocr.repository.ts`. New lint rule version may surface warnings in fork code.                                                                                                                                |
| `26957f37c` | fix(server): hide original filename when not showing metadata (#27581) | server         | MEDIUM       | Modifies `viewThumbnail` filename construction in `asset-media.service.ts`. Fork heavily extends this file (S3 backend abstraction), but the upstream change applies to a non-overlapping region (the size-suffix filename builder) and landed cleanly without textual conflict. |
| `3254d31cd` | chore: version v2.7.3                                                  | meta           | LOW          | Version bump.                                                                                                                                                                                                                                                                    |
| `7b269d163` | fix: ssr open graph tags (#27639)                                      | server         | LOW          | `api.service.ts` switches from `sanitize-html` to `lodash.escape`. Removes `sanitize-html` from `server/package.json` deps. Fork doesn't touch `api.service.ts`.                                                                                                                 |

### High-Risk Changes (detailed analysis)

No HIGH-risk commits in this rebase. Two MEDIUM-risk commits warranted detailed verification:

#### `26957f37c` — fix(server): hide original filename when not showing metadata

**What upstream changed**: In `viewThumbnail`, the size-suffixed filename returned to clients now uses the asset ID instead of the original filename when the request comes through a shared link with `showExif: false`. This prevents leaking the original filename via the `Content-Disposition` header.

**Why it could be risky for the fork**: Fork heavily extends `asset-media.service.ts` for the S3 storage backend abstraction (`StorageService.getWriteBackend()`, `serveFromBackend()`, S3 upload paths in `replaceFileData` and `uploadFile`). A textual or logical conflict was plausible.

**Verification**:

1. Confirmed the upstream change landed at line 263–265 of the rebased file:
   ```ts
   const fileNameBase =
     auth.sharedLink && !auth.sharedLink.showExif ? id : getFileNameWithoutExtension(originalFileName);
   const fileName = `${fileNameBase}_${size}${getFilenameExtension(path)}`;
   ```
2. Confirmed the matching test addition at `asset-media.service.spec.ts:757` (`'should not include original filename if requested using a shared link with showExif false'`).
3. The `serveFromBackend` call below it is the fork's S3-aware response builder — the new `fileName` flows through unchanged, so the privacy fix applies regardless of which storage backend serves the bytes. ✓

#### `d7f038ec6` — chore(deps): eslint-plugin-unicorn → v64

**What upstream changed**: Bumped `eslint-plugin-unicorn` from v63 to v64 in `cli`, `e2e`, `server`, and `web`. Regenerated `pnpm-lock.yaml`. Added one `eslint-disable-next-line unicorn/prefer-ternary` to `server/src/repositories/ocr.repository.ts:61` to silence a new rule.

**Why it could be risky for the fork**: New rule versions can flag previously-clean fork code with new warnings, breaking the zero-warnings lint policy.

**Verification**: Will be confirmed by `make lint-server` and `make lint-web` in the local CI verification phase.

## Conflict Resolutions

### Conflict: `mobile/pubspec.yaml`

- **Fork side (incoming cherry-pick)**: `version: 1.0.0+1` (PR #121, "bump version to 1.0.0+1 for initial Play Store release")
- **Upstream side**: `version: 2.7.4+3045`
- **Resolution**: Took fork's `1.0.0+1`. The fork commit explicitly pinned the mobile app to a Play Store release version, deliberately diverging from upstream's `mobile.pubspec.yaml` versioning scheme. Verified `git show main:mobile/pubspec.yaml` matched the resolution.
- **Risk**: LOW — intentional fork divergence for store submission.
- **Verification needed**: None — `mobile/pubspec.yaml` was the only fork-pinned version file and was already at this value pre-rebase.

### Conflict: `mobile/openapi/README.md` (binary)

- **Fork side**: HEAD (upstream-regenerated README from current OpenAPI spec)
- **Upstream side (incoming cherry-pick)**: Fork commit `40c7ec87a`'s regenerated README from a previous rebase
- **Resolution**: Took the incoming fork-regenerated version. This is a generated artifact — would have been overwritten by step 6's `make open-api` regen anyway.
- **Risk**: LOW — generated file.
- **Verification needed**: Confirmed `make open-api` produced no further diff, meaning the regenerated state is consistent with the current source.

## Fork Feature Verification

| Feature                      | Status | Notes                                                                                                                                                                                                                             |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                | OK     | No upstream commits touched any `shared-space*` file. Verified `migrations-gallery/` UNTOUCHED.                                                                                                                                   |
| Storage Migration            | OK     | `asset-media.service.ts` upstream change verified as additive at line 263, `serveFromBackend` flow intact. Workflows `storage-migration-tests.yml` and `-e2e.yml` present.                                                        |
| Pet Detection                | OK     | No upstream touch on ML models, server pet-detection service, or `petsEnabled` columns.                                                                                                                                           |
| User Groups                  | OK     | No upstream touch.                                                                                                                                                                                                                |
| Image Editing                | OK     | No upstream touch on web edit components or `media.service.ts` edit extensions.                                                                                                                                                   |
| Branding                     | OK     | No upstream touch on `branding/` or `apply-branding/` action.                                                                                                                                                                     |
| Auto-Classification          | OK     | No upstream touch.                                                                                                                                                                                                                |
| Video Duplicate Detection    | OK     | No upstream touch.                                                                                                                                                                                                                |
| Discord/GitHub Support UI    | OK     | No upstream touch.                                                                                                                                                                                                                |
| Library User Denormalization | OK     | `library_user` table, triggers in `functions.ts`, and `migrations-gallery/1778300000000-AddLibraryUserTable.ts` UNTOUCHED.                                                                                                        |
| Mobile Spaces (Drift sync)   | OK     | `mobile/lib/infrastructure/repositories/db.repository.dart` UNTOUCHED. Drift `schemaVersion=24` intact. `drift_schema_v23.json` and `drift_schema_v24.json` UNTOUCHED. Fork-owned `from22To23` and `from23To24` callbacks intact. |

## CI and Infrastructure Verification

| Check                                               | Status | Notes                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow files (no upstream collisions)             | OK     | No upstream commits touched `.github/workflows/`. Verified all 7 fork-only workflow files present (gallery-release, gallery-rc-build, gallery-mobile-scale-test, gallery-build-mobile, gallery-docs-deploy, storage-migration-tests, storage-migration-e2e). |
| Docker image references (gallery-\*, not immich-\*) | OK     | No new upstream `ghcr.io/immich-app/immich-*` references introduced. Pre-existing `docker.yml` (which builds upstream `immich-*` images under the fork's namespace) unchanged from `main`.                                                                   |
| Branding (no "Immich" leaks in CI/config)           | OK     | All "immich" references in workflows are pre-existing (package names like `@immich/sdk`, container service names, weblate component, base-image references). None introduced by the rebase.                                                                  |
| Fork CI modifications intact (PUSH_O_MATIC, etc.)   | OK     | `grep -rn 'PUSH_O_MATIC\|create-workflow-token' .github/workflows/` returns clean (excluding `merge-translations.yml`). All fork-only `gallery-*.yml` workflows intact.                                                                                      |
| New upstream workflows reviewed                     | OK     | None added.                                                                                                                                                                                                                                                  |
| Action/tool versions compatible                     | OK     | No CI tool version bumps in upstream commits.                                                                                                                                                                                                                |

## 🗄️ Server Database Migration Analysis

**Server migrations touched in this rebase:** NO

### New Upstream Migrations

| Timestamp | Migration Name | Tables Modified | Purely Additive? | Risk to Fork | User-Approved Resolution | Notes                   |
| --------- | -------------- | --------------- | ---------------- | ------------ | ------------------------ | ----------------------- |
| —         | —              | —               | —                | —            | —                        | None added by upstream. |

### What Each New Upstream Migration Actually Does

None — upstream added zero migrations in this rebase.

### Timestamp Ordering

- Gallery migration interleaving: OK
- Timestamp collisions: NONE
- Ordering creates dependency issues: NONE

### Table Conflict Check

- Tables shared with gallery migrations: NONE (no upstream migrations)
- Column/constraint conflicts: NONE
- Fork migration assumptions still valid after upstream's changes: YES (no changes)

### Schema File Changes (Kysely tables)

- Fork-extended schema tables modified by upstream: NONE
- For each modified fork-extended table: N/A

### Fork-Critical Infrastructure Verification

- `postbuild` script intact: YES (verified in `server/package.json`; `make build-server` ran the postbuild step successfully)
- Filename collisions between upstream and gallery migrations: NONE
- `CompositeMigrationProvider` intact: YES (`server/src/databases/database.repository.ts` UNTOUCHED)
- `allowUnorderedMigrations: true` still set: YES (file UNTOUCHED)
- `migrations-gallery/` directory UNTOUCHED by upstream rebase: YES

### User Sign-Off

- User who reviewed the Server Migration Findings block: N/A — no migration changes in this rebase, the stop-and-report checkpoint did not fire.
- User who reviewed the generated SQL diff (`make sql` output) post-resolution: N/A — `make sql` was skipped (no dev DB running) per the documented `feedback_make_sql_no_db.md` rule. Upstream commits did not touch any `@GenerateSql`-decorated repository methods, so no SQL diff was expected. CI will validate.

## 📱 Mobile Drift Migration Analysis

**Mobile migrations touched in this rebase:** NO

### Fork's Current Mobile Migration State (pre-rebase)

- `schemaVersion`: 24
- Fork-owned snapshots: `drift_schema_v23.json`, `drift_schema_v24.json`
- Fork-owned callbacks: `from22To23` (adds `shared_space_entity`, `shared_space_asset_entity`, `shared_space_library_entity`, `shared_space_member_entity`), `from23To24` (adds `library_entity`)
- Last fork commit touching mobile migrations: PR #313 (mobile shared-space + library Drift sync rewrite, 2026-04-08)

### Did Upstream Touch Mobile Migrations?

`git log upstream/main~9..upstream/main -- mobile/lib/infrastructure/repositories/db.repository.dart mobile/drift_schemas/main/`: **empty** (no commits). Upstream did not touch any mobile Drift migration files in this rebase.

### New Upstream Mobile Migrations

| Schema Version | Source | Tables / Columns | Risk to Fork | Notes                   |
| -------------- | ------ | ---------------- | ------------ | ----------------------- |
| —              | —      | —                | —            | None added by upstream. |

### What Each New Upstream Callback Actually Does

None — upstream added zero mobile migration callbacks in this rebase.

### Fork-Owned Mobile Migrations (post-rebase)

| Schema Version (pre-rebase) | Schema Version (post-rebase) | Feature                                          | Content Unchanged? | Notes                                                        |
| --------------------------- | ---------------------------- | ------------------------------------------------ | ------------------ | ------------------------------------------------------------ |
| 23                          | 23                           | Shared-space + asset + library + member entities | YES                | `from22To23` callback and `drift_schema_v23.json` UNTOUCHED. |
| 24                          | 24                           | Library entity (PR #329)                         | YES                | `from23To24` callback and `drift_schema_v24.json` UNTOUCHED. |

### Collision Check

- Duplicate `drift_schema_vN.json` files: NONE
- Gaps in migration chain: NONE
- `schemaVersion` matches highest snapshot: YES (`schemaVersion = 24`, highest snapshot `drift_schema_v24.json`)
- `fromXToY` callback chain contiguous: YES
- After rebase, does the chain 1 → 24 still match what was on device at the start of the rebase? YES (no changes)

### Release Safety

- Any fork build with pre-rebase `schemaVersion=24` shipped to real users? **N/A** — no resolution required because upstream did not touch mobile migrations. Existing installs at `schemaVersion=24` are unaffected by this rebase.
- Resolution strategy chosen: **NO_ACTION_NEEDED**
- User who signed off on the strategy: N/A — stop-and-report checkpoint did not fire because no mobile migration files were touched.

### Semantic Compatibility Check

Upstream did not modify any mobile migration code, so there is nothing to layer on top of fork's `schemaVersion=24`. Upstream's mobile changes in this rebase touch only the Flutter widget tree (`mobile/lib/presentation/widgets/images/*`), iOS Swift image loading (`mobile/ios/Runner/Images/*`), the Android cronet dependency, and `mobile/pubspec.yaml`. None of these interact with the Drift schema.

- Upstream migrations touch only tables/columns present in BOTH upstream and fork v24? N/A — no upstream migrations.
- Upstream migrations are purely additive? N/A.

### Second-Review Diff

`git diff main..HEAD -- mobile/lib/infrastructure/repositories/db.repository.dart mobile/drift_schemas/`: **empty**. No diff to review.

## Inconsistencies Found

None. After-rebase verification confirmed:

- All 9 upstream commits' changes landed correctly in the rebased fork:
  - `asset-media.service.ts:263` has `fileNameBase` / `showExif` logic ✓
  - `asset-media.service.spec.ts:757` has the new test case ✓
  - `ocr.repository.ts:61` has the `eslint-disable-next-line unicorn/prefer-ternary` ✓
  - `server/tsconfig.json` and `server/tsconfig.build.json` have `tsBuildInfoFile` pointing into `dist/` ✓
  - `cli/tsconfig.json` has `tsBuildInfoFile` ✓
  - `api.service.ts:3` imports `escape` from `lodash` (replacing `sanitize-html`) ✓
  - `server/package.json` no longer lists `sanitize-html` or `@types/sanitize-html` ✓
  - `server/package.json` `eslint-plugin-unicorn` is now `^64.0.0` ✓
- Fork's `mobile/pubspec.yaml` correctly preserved at `1.0.0+1` (Play Store version) ✓
- No silent regressions detected.

## Code Review Findings

The rebase was small enough (9 upstream commits, all well-categorized, no migration or schema changes) that a formal subagent code-review pass was not run for this sync. The manual verification above covers each upstream change end-to-end and confirms each landed in the rebased fork without overwriting fork extensions.

## Local CI Verification

| Check                | Status | Notes                                                                                                               |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `make build-server`  | PASS   | nest build clean, postbuild migration merge succeeded.                                                              |
| `make build-sdk`     | TBD    | Will run as part of step 9.                                                                                         |
| `make check-server`  | TBD    | Will run as part of step 9.                                                                                         |
| `make check-web`     | TBD    | Will run as part of step 9.                                                                                         |
| `make lint-server`   | TBD    | Watch for new `eslint-plugin-unicorn` v64 warnings.                                                                 |
| `make lint-web`      | TBD    | Watch for new `eslint-plugin-unicorn` v64 warnings.                                                                 |
| Server unit tests    | TBD    | Will run as part of step 9.                                                                                         |
| Web unit tests       | TBD    | Will run as part of step 9.                                                                                         |
| OpenAPI regeneration | PASS   | `make open-api` produced no diff — fork already in sync.                                                            |
| SQL queries regen    | SKIP   | No dev DB running; upstream commits did not touch any `@GenerateSql` methods so no diff expected. CI will validate. |

## Remote CI Verification

- **Test branch**: `rebase/upstream-v2.7.4`
- **CI run URL**: TBD (added after step 10)
- **Status**: TBD
- **Failures fixed**: TBD

## Post-Rebase Verification

- Fork commits ahead of upstream: 235 (will become 236 after this report commit)
- Commits behind upstream: 0
- Fork diff looks clean: YES
