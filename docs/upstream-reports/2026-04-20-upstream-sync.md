# Upstream Sync Report — 2026-04-20

## Summary

- **Upstream commits pulled**: 96 (post-v2.7.5, no new upstream tag)
- **Fork commits replayed**: 318 (281 pre-existing + 37 fixup commits added during CI iteration; 2 skipped: PR #115 bottom-nav + its revert, both no-ops)
- **Upstream version**: `branding/config.json.upstream.version` stays `2.7.5` (upstream hasn't cut a new release)
- **Risk level**: HIGH (during execution); **CI status**: ALL GREEN on `a54e8552e`
- **Recommendation**: PROCEED — Test, Static Analysis, Storage Migration all pass; awaiting force-push approval

## Final CI status (commit `a54e8552e` on `rebase/upstream-post-v2.7.5`)

| Workflow              | Status |
| --------------------- | ------ |
| Test                  | ✅ pass |
| Static Code Analysis  | ✅ pass |
| Storage Migration     | ✅ pass |
| PR Label Validation   | ✅ pass |
| Pull Request Labeler  | ✅ pass |

## Strategy used for conflict resolution

The rebase hit three upstream architectural refactors that forced non-trivial resolution strategies:

1. **class-validator → zod migration (#26597, 318 files)** — Fork DTO extensions living in upstream DTO files (model-config, env, person, queue-legacy, search, system-config, time-bucket) had to be converted inline to zod. Fork-only DTOs (shared-space, user-group, classification, storage-migration, gallery-map, pet-detection, editing) stay on class-validator.
2. **Remove riverpod generator (#27874)** — Upstream removed `riverpod_annotation`, `riverpod_generator`, `riverpod_lint` from `mobile/pubspec.yaml`. Fork-only `@riverpod` providers (paginated_search, backup_verification, asset_stack, current_asset, current_album, asset_people, activity_statistics, photos_filter/\*) were kept as-is. Mobile won't compile until these are converted — tracked as a follow-up.
3. **Yeet old timeline (#27666)** — Deleted many timeline/album/library pages and providers that fork-only code extended. Most conflicts resolved by taking fork's version; some upstream-deleted files kept for fork features (e.g., `mobile/lib/pages/library/library.page.dart`).

For non-refactor conflicts, resolution was:

- **Generated files** (mobile/openapi/\*, open-api/typescript-sdk/fetch-client.ts): took one side; CI regenerates.
- **Fork-only additions to upstream files**: "take theirs" (fork side) or targeted inline zod conversion.
- **Upstream-only refactors fork doesn't touch**: "take ours" (HEAD).

## Incoming Upstream Changes

### HIGH-risk commits

| SHA                       | PR Title                                                  | Status                                                                 |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `7d8f843be`               | refactor!: migrate class-validator → zod (#26597)         | Resolved inline — fork DTO extensions converted to zod                 |
| `2070f775d`               | refactor: remove riverpod generator (#27874)              | Accepted; fork `@riverpod` providers still need conversion (follow-up) |
| `79fccdbee`               | refactor: yeet old timeline (#27666)                      | Resolved per-file — fork kept pages it still uses                      |
| `fed5cc1ae` + `8fb2c7755` | upgrade @immich/ui 0.71 → 0.76 + commands (#27792/#27546) | Patch renamed; apply-clean verification deferred to CI                 |
| `6dd605322`               | feat: mobile editing (#25397)                             | Accepted as-is; no collision with fork's web-only image editing        |
| Mobile drift collision    | False alarm — upstream stayed at schemaVersion=22         | No renumber needed                                                     |

### MEDIUM-risk commits

| SHA                       | Summary                                                 | Status                                                                                         |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ac06514db`               | Album map markers endpoint (map.repository.ts refactor) | Mechanical merge applied                                                                       |
| `8ee5d3039`               | Remove deviceId + deviceAssetId                         | No fork references — clean                                                                     |
| `792cb9148`               | Rename API key schemas                                  | Took HEAD                                                                                      |
| `6ba17bb86`               | Remove my shared link dto                               | Took HEAD                                                                                      |
| `e1a84d3ab`               | Remove replace asset                                    | Took HEAD                                                                                      |
| `a69eecf3b`               | Remove without assets                                   | Took HEAD                                                                                      |
| `6da2d3d58`               | Remove getRandom API                                    | Fork uses searchRandom, not /asset/random — clean                                              |
| `88815a034`               | Base image major update                                 | Accepted                                                                                       |
| 5 OAuth commits           | OAuth fixes + logout endpoints                          | Accepted (no fork-only auth code)                                                              |
| 5 new upstream migrations | Timestamps interleave between fork gallery migrations   | No collisions; `CompositeMigrationProvider` + `allowUnorderedMigrations: true` handle ordering |

## Conflict resolutions that silently dropped fork code

Three resolution decisions during the rebase silently lost fork behavior. All three were caught later by CI iteration but should be flagged at Checkpoint 2 in future rebases:

| File                                        | What was lost                                                                                                                                                  | Detected via                                       | Fix commit |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------- |
| `server/src/services/auth.service.ts`       | Fork's S3 upload branch in `syncProfilePicture` — taking upstream cleanly dropped it                                                                            | Manual review during rebase fixup                  | `fee878e34` |
| `web/src/lib/components/asset-viewer/detail-panel.svelte` | "Orphan-div fix" deleted the entire `<div class="px-4 py-4">` containing DetailPanelDate / originalFileName / Location. Camera + lens were re-added INSIDE people section but Date + filename + Location were lost | Web E2E test on `detail-panel-edit-date-button` testid | `60cc13c65` |
| `web/src/lib/managers/auth-manager.svelte.ts` | `this.reset()` call before `goto(redirectUri)` in `logout()` — without it, user stays "authenticated" client-side and `/auth/login` redirects to `/photos`     | Web E2E auth Registration test (URL mismatch)      | `a54e8552e` |

**Side-effect of `pnpm install --no-frozen-lockfile`** during conflict resolution:
- Bumped `@faker-js/faker` 10.3.0 → 10.4.0, which silently changed seeded UUIDs in UI Playwright fixtures (5 tests broke). Fixed in `f75397836`.

## Conflict Resolutions (summary by file category)

### DTOs (7 upstream files, fork extensions converted to zod)

| File                                   | Fork Addition                                                          | Resolution                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `server/src/dtos/model-config.dto.ts`  | `CLIPConfig.maxDistance`, `PetDetectionConfigSchema`                   | Added as zod schemas                                          |
| `server/src/dtos/env.dto.ts`           | 8 S3 env vars + 3 demo-mode env vars (demo removed by #215)            | Added as zod fields                                           |
| `server/src/dtos/person.dto.ts`        | `type: 'person'/'pet'`, `species`                                      | Added to `PersonResponseSchema`                               |
| `server/src/dtos/queue-legacy.dto.ts`  | `PetDetection`, `StorageBackendMigration`, `Classification` queues     | Added to zod schema                                           |
| `server/src/dtos/search.dto.ts`        | `spaceId`, `spacePersonIds`, `takenAfter`/`takenBefore` on suggestions | Added to `BaseSearchSchema` + `SearchSuggestionRequestSchema` |
| `server/src/dtos/system-config.dto.ts` | `petDetection` in SystemConfigJob + ML config                          | Added to zod schemas                                          |
| `server/src/dtos/time-bucket.dto.ts`   | `spaceId`, `spacePersonId`, `withSharedSpaces`                         | Added to `TimeBucketQueryBaseSchema`                          |
| `server/src/dtos/download.dto.ts`      | `spaceId` for bulk download                                            | Added to zod schema                                           |
| `server/src/dtos/server.dto.ts`        | `demoMode` (transient; removed by #215)                                | Added/removed via replay                                      |

### Server enum + services

- `server/src/enum.ts` — all fork enums (`SharedSpaceRole`, `SharedSpaceActivityType`, 49 fork Permission/JobName/QueueName entries) intact.
- `asset-media.service.ts` + spec — upstream removed `replaceAsset`; resolved by taking HEAD.
- `auth.service.ts` + spec — OAuth profile picture sync refactored upstream to use `generateProfileImage` util; fork's S3 branching was consolidated into the util.
- `download.service.ts` — kept fork's `isAbsolute` import alongside upstream's `sanitize-filename`.
- `user.service.ts` — merged upstream's `mimeTypes.lookup` with fork's `serveFromBackend` → `serveFromBackend(path, mimeTypes.lookup(path), CacheControl.None)`.
- `sync.service.spec.ts` — upstream deleted; fork kept (tests still-existing `sync.service.ts`).

### Web components

- `app.html` — took HEAD's inline-style noscript.
- `activity-viewer.svelte`, `detail-panel.svelte`, `AlbumAddUsersModal.svelte` — kept fork's local `LoadingSpinner` import (not @immich/ui) + merged upstream additions (`sortBy`, `modalManager`).
- `map.svelte` — merged HEAD's `Theme`/`themeManager` + fork's `getSpaceMapMarkers` + `mdiThemeLightDark`.
- `navigation-bar.svelte` — kept fork's local `Logo` import; dropped `user` store (HEAD uses `authManager.user`).
- `QueueGraph.svelte` — updated to HEAD's `themeManager` naming; kept fork's local `LoadingSpinner`.
- `asset.service.spec.ts` — merged HEAD's `authManager` + fork's `mergeRotation`/`normalizeAngle` test imports.
- `user-settings-list.svelte`, `oauth-settings.svelte` — took HEAD (file relocated to `/routes/(user)/user-settings/`).

### Mobile

- `android/app/build.gradle` — merged HEAD's modern Gradle DSL (`minSdk =`, `flutter.versionCode`) + fork's `applicationId "de.opennoodle.gallery"`.
- `pubspec.yaml` — took HEAD (removed `riverpod_annotation`/`riverpod_generator`/`riverpod_lint`/`isar_generator`/`custom_lint`; kept fork's `bonsoir: ^5.1.11` override).
- `router.dart` — took HEAD (removed ArchiveRoute/PartnerRoute — replaced by Drift variants) + kept fork's Spaces routes.
- `timeline.service.dart` — merged `folder` (HEAD) + `remoteSpace` (fork) enum values.
- `library.page.dart` — kept fork's version (upstream deleted but fork still uses for Spaces bottom-nav).
- `integration_test/test_utils/general_helper.dart`, `dart_test.yaml`, `immich_app_bar.dart` — deleted (upstream deletions).

### Generated files

- `mobile/openapi/` — took one side during rebase; will be regenerated post-rebase.
- `open-api/typescript-sdk/src/fetch-client.ts` — same.

### e2e

- `auth-server.ts`, `oauth.e2e-spec.ts` — took HEAD (upstream's newer OAuth test setup).
- `e2e/src/utils.ts` — kept fork's `addAssets as addSpaceAssets`/`addMember as addSpaceMember` imports; dropped upstream's removed `checkExistingAssets`.

## Fork Feature Verification

| Feature                                      | Status | Notes                                                        |
| -------------------------------------------- | ------ | ------------------------------------------------------------ |
| Shared Spaces                                | OK     | All 49 fork enum entries + 27 gallery migrations intact      |
| Storage Migration                            | OK     | Fork backend + controller + migration untouched              |
| Pet Detection                                | OK     | ML config + enum + queue legacy entry intact                 |
| Image Editing                                | OK     | editing.dto.ts resolved with fork additions                  |
| Branding                                     | OK     | Fork CI modifications survive; branding script unchanged     |
| User Groups                                  | OK     | Fork-only controller + DTO untouched; UI imports merged      |
| Google Photos Import                         | OK     | Fork-only code, no conflicts                                 |
| Auto-Classification                          | OK     | SystemConfig classification section resolved                 |
| Video Duplicate Detection                    | OK     | duplicate.service.ts multi-frame CLIP intact                 |
| CLIP Relevance Threshold                     | OK     | Added as zod field in CLIPConfigSchema                       |
| Smart Search on Main Timeline                | OK     | Fork /photos page resolved with FilterPanel                  |
| Global Search / Command Palette (cmdk)       | VERIFY | @immich/ui patch renamed; apply-cleanly check deferred to CI |
| Shared-Space Photos on Personal Map          | OK     | gallery-map controller + DTO intact                          |
| Space Library Linking                        | OK     | UNION architecture preserved                                 |
| Activity Logging                             | OK     | Fork schema + service intact                                 |
| Bulk Add to Spaces                           | OK     | Background job code intact                                   |
| Space Person Dedup                           | OK     | Two-layer dedup intact                                       |
| Checksum Tombstone (Dedup)                   | OK     | Resolved via zod                                             |
| Mobile Drift Shared-Space Sync (PR #313)     | OK     | v23/v24 purely additive; no renumber needed                  |
| Release Version Publishing                   | OK     | gallery-release.yml intact                                   |
| RC Build Workflow                            | OK     | gallery-rc-build.yml intact                                  |
| Split Mobile/Server Release Cycles (PR #366) | OK     | All three release workflows intact                           |
| Switch-back-to-Immich                        | OK     | scripts/revert-to-immich.sql + validation workflow intact    |

## CI and Infrastructure Verification

| Check                                                 | Status | Notes                                                                                                                          |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Workflow files (no upstream collisions)               | OK     | 10 gallery-\* + storage-migration + revert-to-immich workflows intact                                                          |
| Docker image references (`gallery-*`, not `immich-*`) | OK     | Not touched by upstream changes                                                                                                |
| Branding (no "Immich" leaks in CI/config)             | OK     | branding/config.json unchanged                                                                                                 |
| Fork CI modifications intact                          | OK     | All `PUSH_O_MATIC` → `${{ github.token }}` replacements intact (only `merge-translations.yml` still uses secret — as expected) |
| `docs-deploy.yml` disabled                            | OK     | Still `workflow_dispatch` only                                                                                                 |
| `auto-close.yml` template jobs removed                | OK     | Only `close_llm` job remains                                                                                                   |
| New upstream workflows reviewed                       | OK     | None add fork-hostile infrastructure                                                                                           |
| Action/tool versions compatible                       | OK     | Minor bumps in #57212f29b (android-actions/setup-android v4, actions/github-script v9) — compatible                            |

## Database Migration Analysis

### New upstream migrations (5)

| Timestamp     | Migration Name                | Tables Modified        | Risk to Fork | Notes                                                                           |
| ------------- | ----------------------------- | ---------------------- | ------------ | ------------------------------------------------------------------------------- |
| 1775165531374 | AddPersonNameTrigramIndex     | `person` (gin index)   | LOW          | Fork already patched idempotency via commit `852b09d4e` — replayed and verified |
| 1776217577402 | DropAuditTable                | `audit` (drop)         | LOW          | Table was for legacy audit; fork doesn't use                                    |
| 1776263790468 | DropDeviceIdAndDeviceAssetId  | `asset` (drop columns) | LOW          | No fork-only references; clean                                                  |
| 1776332807985 | SetOAuthAllowInsecureRequests | `system_config`        | LOW          | Config default change                                                           |
| 1776442031775 | AddOauthSidToSession          | `session` (add column) | LOW          | OAuth backchannel logout support                                                |

### Timestamp ordering

- Gallery migration interleaving: OK — timestamps fit cleanly between fork migrations
- Timestamp collisions: NONE

### Table conflict check

- Tables shared with gallery migrations: `asset`, `person`, `session` — no fork gallery migration modifies columns upstream drops
- Column/constraint conflicts: NONE

### Postbuild merge

- `postbuild` script intact: YES
- Filename collisions: NONE
- `CompositeMigrationProvider` intact: YES

## Mobile Drift Migration Analysis

### Collision check

- Fork's v23/v24 and upstream's v22 do not collide — upstream stayed at schemaVersion=22 across this batch.
- `schemaVersion` matches highest snapshot (v24): YES
- `fromXToY` callback chain contiguous from v1→v24: YES
- No renumbering required.

### Release safety

- Fork's v23/v24 already shipped to `de.opennoodle.gallery` Play Store installations. Renumbering would be required if upstream shipped a collision — not the case here.

## Pattern Propagation

| Refactor                  | Old → New Pattern                                        | Fork Files Affected                                                                                                                                                    | Decision                                                                                                                                                                                        | Commit / Follow-up    |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| class-validator → zod     | class-validator decorators → zod schemas                 | 7 upstream DTO files fork extends; ~10 fork-only DTOs unchanged                                                                                                        | **Bundled** (partial) — fork extensions in upstream DTO files converted inline. Fork-only DTOs (shared-space, user-group, etc.) stay on class-validator (their upstream file hasn't converted). | Within rebase commits |
| Remove riverpod generator | `@riverpod`+`.g.dart` → manual Provider/NotifierProvider | 7+ fork mobile providers (paginated_search, backup_verification, asset_stack, current_asset, current_album, asset_people, activity_statistics, + all photos_filter/\*) | **Deferred** — mobile won't compile until converted; needs follow-up PR                                                                                                                         | Follow-up PR needed   |

### Follow-up work

1. ~~**Convert fork `@riverpod` providers to manual declarations**~~ — **DONE** in this rebase (R5). All fork-only `@riverpod` providers rewritten as manual `Provider`/`NotifierProvider`/`AutoDisposeFutureProvider`.
2. ~~**Verify @immich/ui 0.69 → 0.76 patch applies cleanly**~~ — **DONE**. Patch renamed to `@immich__ui@0.76.2.patch`, regenerated against new source, applies cleanly.
3. ~~**Regenerate OpenAPI specs (TS + Dart) + SQL query files**~~ — **DONE** locally and committed.
4. ~~**Deferred fork-only zod conversion**~~ — **DONE** in this rebase (R3). All 5 fork-only DTOs (system-config, shared-space, time-bucket, classification, pet-detection) converted to zod alongside the upstream-shared ones.

### Bugs surfaced and fixed during CI iteration

See "Remote CI Iteration Log" above. All have memory entries for next rebase:
- `feedback_zod_dto_gotchas` — 3 zod conversion pitfalls (z.date crash, query-param arrays, enum codegen)
- `feedback_e2e_auth_server_no_divergence` — always take upstream's auth-server.ts
- `feedback_mocktail_stream_stub` — Dart mockail null-Stream gotcha
- `feedback_sveltekit_version_name_datenow` — SvelteKit version.name with Date.now() fallback breaks hash coherence
- `feedback_faker_pin_seeded_uuids` — pin @faker-js/faker after rebase to match upstream's lockfile

## Local CI Verification

Performed locally before initial test-branch push:

- Server: `pnpm test` 3861 tests pass; `tsc --noEmit` clean (113→0 errors after fixups); `pnpm build` clean
- Web: `pnpm test` 1937 tests pass; svelte-check clean (15→0); ESLint clean (26→0)
- Mobile: `flutter analyze lib/` clean; `flutter analyze test/` clean (90→0); `flutter test` 1279/1279 pass
- OpenAPI specs (TS SDK + Dart) and SQL queries regenerated and committed
- `@immich/ui` 0.69.0 → 0.76.2 patch refreshed against new upstream

## Remote CI Iteration Log

The push surfaced **8 categories of failures** that needed iterative fixing:

### 1. Mobile generated code stale (`mobile/lib/routing/router.gr.dart`)
Newer `auto_route` adds `operator==`/`hashCode` overrides to RouteArgs. Dart Code Analysis "Verify files have not changed" caught the stale file.
- **Fix**: `make build` in `mobile/` to regenerate.
- **Commit**: `ad9492a32`

### 2. Mobile deprecation: `SemanticsService.announce` → `sendAnnouncement`
Flutter 3.41 deprecated `announce` in favor of `sendAnnouncement(FlutterView, message, textDirection)`. `dart analyze --fatal-infos` failed.
- **File**: `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart`
- **Commit**: `edbe5a232`

### 3. e2e workspace drift: removed-API tests + auth-server divergence
Multiple e2e issues from upstream API removals (#27818 `deviceId`, #27022 `replaceAsset`) and an out-of-date local copy of `e2e-auth-server/auth-server.ts` that lacked upstream's new `OAuthUser.ID_TOKEN_CLAIMS` enum.
- **Fixes**:
  - Took upstream's `e2e-auth-server/auth-server.ts` wholesale (file has zero fork-only content — saved as `feedback_e2e_auth_server_no_divergence`)
  - Deleted `e2e/src/specs/server/api/asset-video-device.e2e-spec.ts` (tested removed `getAllByDeviceId` endpoint)
  - Stripped `deviceAssetId` from createAsset calls in `search.e2e-spec.ts` + `filter-suggestions.e2e-spec.ts`
  - Removed unused `checkExistingAssets` import
- **Commit**: `c861fb57d`

### 4. Lost zod validation rules + `replaceAsset` test cleanup
The class-validator → zod conversion silently dropped 6 validation constraints and broke 25+ e2e tests testing removed endpoints.
- **Server fixes (validation gaps)**:
  - `SmartSearchDto.withSharedSpaces` — was `stringToBool` (rejects native booleans on POST body); switched to `z.boolean()`
  - `ModelConfigSchema.modelName` — added `.min(1)` (was `@IsNotEmpty`)
  - `SearchPeopleDto.name` — added `.min(1)` (was `@IsNotEmpty`)
  - `WorkflowCreateDto.name` — added `.min(1)` (was `@IsNotEmpty`)
  - `ClassificationCategory.prompts` — added `.min(1)` (was `@ArrayMinSize(1)`)
  - `ClassificationConfig.categories` — added uniqueness `.refine` (was `@UniqueNames`)
- **e2e fixes**:
  - Dropped `POST /sync/full-sync` and `/sync/delta-sync` test blocks (endpoints removed)
  - Dropped `replaceAsset` test block; renamed describe to "asset jobs + bulk-upload-check"
  - Rewrote `asset-copy.e2e-spec.ts` album-membership check via `POST /search/metadata` (since `AlbumResponseDto` no longer includes `assets`)
- **Web fix**: typed `MapMediaType.Image`/`Video` enum on map page instead of raw strings
- **Commit**: `5c0a574cf` (memory: `feedback_zod_dto_gotchas`)

### 5. SvelteKit env hash mismatch — Web E2E hung indefinitely
Symptom: every Web E2E test timed out at 30s with browser console showing `Cannot read properties of undefined (reading 'env')`. Server healthy, uploads worked, websocket events fired — but the page stayed on the loading spinner.

Root cause: `web/svelte.config.js` had `version: { name: process.env.IMMICH_BUILD || Date.now().toString() }`. When `IMMICH_BUILD` is unset, SvelteKit's `load_config()` re-imports `svelte.config.js` with `?ts=` cache buster between Vite phases (chunks vs adapter-static prerender). The user's `Date.now()` is recomputed each time, producing different `version_hash = hash(kit.version.name)` values. Chunks bake in one hash (`globalThis.__sveltekit_<hash>.env`), the SPA-fallback `index.html` bakes in another. At runtime the chunk's lookup is undefined — anything reading `$env/dynamic/public` (e.g., `@immich/ui`'s `env.PUBLIC_IMMICH_HOSTNAME`) crashes.

- **Fix**: only set `version.name` when `IMMICH_BUILD` is provided; let SvelteKit's own default handle the unset case (its `Date.now()` default is bound once at options.js module-load time and stays stable across reloads).
- **Commit**: `e0fb67f73` (memory: `feedback_sveltekit_version_name_datenow`)

### 6. Detail-panel orphan-div fix over-deleted upstream content
The earlier orphan-div fix (`5ae8d47fc`) removed the entire `<div class="px-4 py-4">` containing `<DetailPanelDate />`, `originalFileName`/path/dimensions, camera, lens, and `<DetailPanelLocation />`. Camera and lens were re-added inside the people `<section>` but Date + filename + Location were lost. Web E2E test "Detail Panel > Date editor > displays inferred asset timezone" timed out at 30s on the missing `detail-panel-edit-date-button` testid.

- **Fix**: restored the full upstream layout (Date → filename + path + dimensions → camera → lens → Location) inside its own `px-4 py-4` div; restored `DetailPanelDate` import; added inline `getMegapixel`/`getAssetFolderHref` helpers; added `slide` transition import.
- **Commit**: `60cc13c65` (+ `818c9b87e` for prettier format)

### 7. Faker bumped 10.3.0 → 10.4.0 → seeded UUIDs shifted
`pnpm install --no-frozen-lockfile` (run during conflict resolution) bumped `@faker-js/faker` from 10.3.0 to 10.4.0 (allowed by `^10.1.0` specifier). UI Playwright tests under `e2e/src/ui/specs/timeline/` use `faker.seed(42)` and **hardcode** specific UUIDs like `ad31e29f-2069-4574-b9a9-ad86523c92cb`. Faker 10.4.0 produces different UUIDs from the same seed — `getAsset()` returned undefined → `.id` access threw `TypeError`.

- **Fix**: pinned `@faker-js/faker` to `^10.3.0` to match upstream's lockfile.
- **Commit**: `f75397836` (memory: `feedback_faker_pin_seeded_uuids`)

### 8. authManager.logout() lost upstream's `this.reset()` call
Symptom: e2e Registration test ended up on `/photos` after change-password instead of `/auth/login?autoLaunch=0` (the URL the server returns from `LOGIN_URL`).

Root cause: the squashed fork commit was missing the `this.reset()` call that upstream's `authManager.logout()` makes before `goto(redirectUri)`. Without it, `#user`/`#preferences` stay populated; `/auth/login`'s page-load sees `authManager.authenticated === true` and 307s to the continue URL (`/photos`).

- **Fix**: added `this.reset()` call back in `web/src/lib/managers/auth-manager.svelte.ts` to match upstream.
- **Commit**: `a54e8552e`

### CI iteration summary

| Iteration | Commit      | Failure category                                | Outcome             |
| --------- | ----------- | ----------------------------------------------- | ------------------- |
| 1         | `2e6e88148` | Initial push                                    | Test failed (e2e)   |
| 2         | `c861fb57d` | e2e cleanup (auth-server, deviceId)             | Static Analysis ❌  |
| 3         | `ad9492a32` | router.gr.dart regen                            | Static Analysis ❌  |
| 4         | `edbe5a232` | sendAnnouncement migration                      | Static Analysis ✅; Test failed (zod gaps + endpoint tests) |
| 5         | `5c0a574cf` | zod validation + e2e cleanup                    | Test failed (Lint Web + Web E2E hung) |
| 6         | `e0fb67f73` | svelte-config Date.now fallback                 | Web E2E partial — detail-panel test still fails |
| 7         | `60cc13c65` | restore detail-panel details section            | Lint Web (prettier) failed |
| 8         | `818c9b87e` | prettier format detail-panel                    | UI tests fail (faker) |
| 9         | `f75397836` | pin faker 10.3.0                                | Web auth.e2e fails |
| 10        | `a54e8552e` | authManager.logout reset() call                 | **ALL CI GREEN** ✅ |

## Post-Rebase Verification

- Fork commits ahead of upstream: 281
- Commits behind upstream: 0
- Fork diff looks clean: YES (verified via `git log upstream/main..HEAD`)

## Branding version reference

- `branding/config.json.upstream.version`: stays `2.7.5` (no new upstream tag in this batch)
- `README.md`: stays on "Immich v2.7.5"
- Marketing site: no update needed
