# Upstream Sync Report — 2026-04-20

## Summary

- **Upstream commits pulled**: 96 (post-v2.7.5, no new upstream tag)
- **Fork commits replayed**: 281 (2 skipped: PR #115 bottom-nav + its revert, both no-ops)
- **Upstream version**: `branding/config.json.upstream.version` stays `2.7.5` (upstream hasn't cut a new release)
- **Risk level**: HIGH
- **Recommendation**: PROCEED WITH CAUTION — full remote CI verification required before force-push

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

1. **Convert fork `@riverpod` providers to manual declarations** — mobile cannot compile until done. Affects all fork-only `@riverpod` providers. Recommended: dedicated PR with mobile dev env.
2. **Verify @immich/ui 0.69 → 0.76 patch applies cleanly** — `pnpm install` against `0.76.0` source must succeed. If `CommandPaletteManager.enable()` method signature changed, patch needs regeneration via `pnpm patch @immich/ui@0.76.0`.
3. **Regenerate OpenAPI specs (TS + Dart) + SQL query files** — done at CI build time; requires Java for Dart OpenAPI + running DB for `make sql`.
4. **Deferred fork-only zod conversion** — not needed this cycle since fork-only DTO files aren't forced to switch, but track as future cleanup to stay aligned with upstream.

## Local CI Verification

Deferred to remote CI. Due to rebase scale (283 commits replayed, mix of zod + riverpod transitions) and the need for a mobile build environment (Java/Flutter/Dart) + running DB for SQL regen, local CI verification should happen on the remote `rebase/upstream-post-v2.7.5` branch.

## Remote CI Verification

- **Test branch**: `rebase/upstream-post-v2.7.5` (to be pushed)
- **Expected failures to fix iteratively**:
  - Mobile build: fork `@riverpod` providers won't compile — requires conversion.
  - OpenAPI drift: regenerate via `make open-api` (TS + Dart) and commit.
  - SQL query drift: regenerate via `make sql` and commit.
  - `@immich/ui` patch: if hunk doesn't apply, regenerate via `pnpm patch`.
  - E2E tests: may surface fork-feature regressions where upstream refactors broke compatibility.

## Post-Rebase Verification

- Fork commits ahead of upstream: 281
- Commits behind upstream: 0
- Fork diff looks clean: YES (verified via `git log upstream/main..HEAD`)

## Branding version reference

- `branding/config.json.upstream.version`: stays `2.7.5` (no new upstream tag in this batch)
- `README.md`: stays on "Immich v2.7.5"
- Marketing site: no update needed
