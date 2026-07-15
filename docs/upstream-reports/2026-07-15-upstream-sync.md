# Upstream Sync Report — 2026-07-15

## Summary

- **Upstream sync**: Immich **v3.0.2 → v3.0.3** (22 upstream commits)
- **Method**: linear `git rebase --onto immich-v3.0.3 immich-v3.0.2` (fork main sits exactly on the upstream tag)
- **Fork commits replayed**: 914 (base `origin/main` @ `3af0abbfbd`, #782) + 2 fork-side post-rebase commits (fdroid disable, version bump) = **916 ahead of `immich-v3.0.3`, 0 behind**
- **Conflicts resolved**: 9 (all mechanical / low-risk)
- **Risk level**: **LOW**
- **Recommendation**: **PROCEED**

No broad architectural refactor, no breaking API/contract change, no non-additive migration, no mobile Drift renumbering. The one new upstream migration is additive/data-only and part of the v3.0.3 base.

## Incoming Upstream Changes

| SHA                                                                                                                               | Summary                                                                                                                                                                                  | Area            | Risk to Fork | Notes                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `35fcca6254`                                                                                                                      | #29887 locked visibility in search/random                                                                                                                                                | server          | LOW          | Fork's `searchRandom` **already carried** the identical `visibility ?? 'not-locked'` fix. Merged via union (see conflicts). Closes the prior H1 finding (searchRandom leaking Locked assets).                                                      |
| `ffafc144c6`                                                                                                                      | #29880 single bucket for "none" grouping                                                                                                                                                 | mobile          | LOW          | Fork's `_generateBuckets` was byte-identical to old upstream → 3-way auto-merged to upstream's one-liner; `kTimelineNoneSegmentSize` + `constants.dart` import cleanly removed (no other refs).                                                    |
| `99883096d6`                                                                                                                      | #29884 live-photo still hidden on bg upload (+ migration)                                                                                                                                | server+mobile   | LOW          | Migration `1782500000000-RestoreLivePhotoStillVisibility` = additive data-only `UPDATE`, part of v3.0.3 base. Mobile `background_upload.service.dart` + `foreground_upload.service.dart` auto-merged with fork bg-upload code.                     |
| `84dff19ca9`                                                                                                                      | #29883 unauthorized album-owner update                                                                                                                                                   | server          | LOW          | Additive guard in `album.service.updateUser` (throws "User is owner"); auto-merged over fork space-RBAC. Full server unit suite green.                                                                                                             |
| `2ed8b2bddd`                                                                                                                      | #29907 memory search date validation                                                                                                                                                     | server+web      | LOW          | `memory.dto` `for:` → `isoDateToDate`; web `load()` now sends `yyyy-MM-dd`. Fork adopts both (required for DTO/web consistency).                                                                                                                   |
| `89b0d906e8`                                                                                                                      | #29908 hvc1 tag when using hwa                                                                                                                                                           | server          | LOW          | `utils/media.ts` `BaseConfig` clean apply; new media.service.spec test green.                                                                                                                                                                      |
| `19e59ebd98`                                                                                                                      | #29894 github-actions SHA bumps                                                                                                                                                          | CI              | LOW          | Pinned-action SHA bumps only (codeql v4.37.0, docker/login v4.4.0, setup-uv v8.3.2, setup-java v5.5.0, setup-ruby v1.316.0, labeler v6.2.0). One touched fork-formatted `pr-labeler.yml` (resolved).                                               |
| `89d31aaba1` `24556cd3fc`                                                                                                         | #29804/#29797 FUTO F-Droid publish (new `fdroid.yml` + docs)                                                                                                                             | CI/docs         | LOW          | `fdroid.yml` is Immich-only infra (gitlab.futo.org, `apps/Immich/index.yml`, needs `FDROID_REPO_TOKEN`). **Disabled to `workflow_dispatch`-only** so it never fires on a Gallery release. Docs fdroid link resolved to Gallery-only download list. |
| `20e123c839`                                                                                                                      | #29895 base-image + ML deps bump                                                                                                                                                         | deps            | LOW          | Dockerfile base-image tag + `machine-learning/pyproject.toml`/`uv.lock`; standard.                                                                                                                                                                 |
| `352c8086f9`                                                                                                                      | #29774 translations                                                                                                                                                                      | i18n            | LOW          | Only `transcoding_realtime_resolutions` (fr) — **no** location/branding strings, so the recurring Immich-branding regression did not occur. Verified location strings still "Noodle Gallery".                                                      |
| `19313e75fd` `9057ae9759` `f2ddace584` `c84ab54889` `12061f3bf8` `da8774801b` `557189d7a8` `2460d431af` `9c8d718ddc` `3c43e8d6c1` | #29799 test-deprecations, #29784 plugin-picker, mobile asset-viewer (system appbar / zoom / Ken Burns), #29868 person-age plural, CODEOWNERS, integrity docs, memories-widget add+revert | web/mobile/docs | LOW          | Small, localized. Fork-touched specs + `person_sliver_app_bar.dart` auto-merged.                                                                                                                                                                   |

## Conflict Resolutions

All 9 conflicts were low-risk. The rebase **integrity check is exact**: `git diff origin/main..HEAD` changes _only_ the v3.0.2→v3.0.3 upstream-delta files — zero fork content dropped or reverted.

### Conflict: `CODEOWNERS`

- **Fork side**: file deleted (empty — fork doesn't use upstream maintainer routing)
- **Upstream side**: #29816 added `@agg23` to `/mobile/`
- **Resolution**: keep fork's empty file (matches `origin/main`)
- **Risk**: LOW

### Conflict: `mobile/pubspec.yaml`

- **Fork side**: `version: 1.0.0+1` (placeholder, stamped at build by `apply-branding`)
- **Upstream side**: `3.0.3+3056`
- **Resolution**: keep fork placeholder `1.0.0+1`
- **Risk**: LOW

### Conflict: `mobile/ios/Runner/Info.plist`

- **Fork side**: tab-indent + placeholder `CFBundleShortVersionString 3.0.0` / `CFBundleVersion 240`
- **Upstream side**: space-indent + `3.0.3` / `4`
- **Resolution**: `checkout --theirs` (fork's version) — verified byte-identical to `origin/main`. Content differed only at the two version placeholders (stamped at build); rest was indentation.
- **Risk**: LOW

### Conflict: `docs/docs/partials/_mobile-app-download.md`

- **Fork side**: Gallery-only list (Play Store `de.opennoodle.gallery` + GitHub Releases)
- **Upstream side**: #29797 added a FUTO F-Droid link to the Immich list
- **Resolution**: keep fork's Gallery-only list
- **Risk**: LOW

### Conflict: `.github/workflows/prepare-release.yml`

- **Fork side**: deleted (fork uses decoupled `gallery-release-*` workflows)
- **Upstream side**: #29894 SHA-bumped `setup-uv`
- **Resolution**: keep fork deletion (`git rm`)
- **Risk**: LOW

### Conflict: `.github/workflows/pr-labeler.yml`

- **Fork side**: prettier reformatting (removed a blank line)
- **Upstream side**: #29894 bumped `actions/labeler` v6.1.0 → v6.2.0
- **Resolution**: union — upstream's newer SHA **and** fork's formatting
- **Risk**: LOW

### Conflict: `server/src/services/search.service.ts` (`searchRandom`)

- **Fork side**: #495 space scoping (`timelineSpaceIds` + `resolveScopedPersonFilters` → `...resolvedDto`)
- **Upstream side**: #29887 visibility fallback (`visibility ?? (hasElevatedPermission ? undefined : 'not-locked')`)
- **Resolution**: union — keep fork scoping **and** upstream visibility fix. Matches `origin/main`'s final `searchRandom` exactly. `searchMetadata`/`searchStatistics` already carried the same fix.
- **Risk**: LOW — verified by full server unit suite + the medium searchRandom test.

### Conflict: `server/test/medium/specs/services/search.service.spec.ts`

- **Fork side**: #319 added a `getFilterSuggestions` describe block
- **Upstream side**: #29887 added a `searchRandom` describe block (asserts Locked assets filtered)
- **Resolution**: union — keep both describe blocks
- **Risk**: LOW

### Conflict: `server/src/dtos/memory.dto.ts`

- **Fork side**: #418 added `import { AnyMemoryData, MemoryDataOf } from 'src/types'`
- **Upstream side**: #29907 added `isoDateToDate` to the `src/validation` import (used by the `for:` field)
- **Resolution**: union — keep both imports
- **Risk**: LOW

### Conflict: `web/src/lib/managers/memory-manager.svelte.ts`

- **Fork side**: #455 replaced timeline imports with `memory-viewer-source` helpers (`findMemoryAsset`, `removeAssetsFromMemoryList`, `MemoryAssetSource`)
- **Upstream side**: #29907 removed the now-unused `asLocalTimeISO` import (its only use, `load()`, changed to `DateTime.now().toFormat('yyyy-MM-dd')`)
- **Resolution**: keep `memory-viewer-source` import; drop `asLocalTimeISO` (unused post-#29907) and `TimelineAsset`/`toTimelineAsset` (unused in fork body). Verified against `origin/main` imports + web tsc.
- **Risk**: LOW

### Conflict: `packages/sdk/src/fetch-client.ts` (×2)

- Generated version banner (`3.0.1`/`3.0.2` fork vs `3.0.3` base). Resolved to `3.0.3`; full SDK regen confirmed no diff.
- **Risk**: LOW

## Fork Feature Verification

| Feature                                                      | Status | Notes                                                            |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| Shared Spaces                                                | OK     | search.service space scoping intact + visibility fix merged      |
| Global Face Identities (#495)                                | OK     | searchRandom union preserved fork scoping                        |
| Fork Memories (rule pipeline / historic page / config types) | OK     | memory.dto + memory-manager merges verified; web tests green     |
| Storage Migration / S3                                       | OK     | untouched by delta                                               |
| Pet Detection                                                | OK     | untouched                                                        |
| Image Editing / media                                        | OK     | hvc1 fix applied; media.service tests green                      |
| Timeline Grouping (mobile)                                   | OK     | adopted upstream's single-bucket refactor; analyze/test green    |
| Mobile bg upload (#657/#663/#769)                            | OK     | live-photo visibility relocation auto-merged; flutter test green |
| Branding                                                     | OK     | i18n location strings still "Noodle Gallery"; no Immich CI leaks |
| Library Manifest Export (#700)                               | OK     | SDK regen clean                                                  |

## CI and Infrastructure Verification

| Check                                               | Status   | Notes                                                                                                                                                                                            |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow set preserved (origin/main vs HEAD)        | OK       | Only `fdroid.yml` added (disabled); nothing dropped (34 → 35)                                                                                                                                    |
| Fork `gallery-*` workflows intact                   | OK       | release-mobile, release-server-only, prerelease-server, rc-build, ml-smoke, mobile-smoke, build-mobile, rebase-smoke, revert-to-immich-validation, docs-deploy, storage-migration-\* all present |
| Docker image references (gallery-\*, not immich-\*) | OK       | `docker.yml` diff = SHA bump only; fork suffix matrix intact                                                                                                                                     |
| Branding (no Immich leaks)                          | OK       | only intentional upstream-image boots in `gallery-revert-to-immich-validation.yml`                                                                                                               |
| PUSH_O_MATIC removed                                | OK       | none except `merge-translations.yml` (expected)                                                                                                                                                  |
| `prepare-release.yml` deletion                      | OK       | stays deleted (modify/delete → keep fork)                                                                                                                                                        |
| `fdroid.yml`                                        | DISABLED | trigger → `workflow_dispatch` (Gallery has no FUTO infra)                                                                                                                                        |
| github-actions SHA bumps                            | OK       | applied (codeql/docker-login/setup-uv/java/ruby/labeler)                                                                                                                                         |

## Database Migration Analysis

### New Upstream Migrations

| Timestamp     | Migration                                | Tables  | Risk | Notes                                                                                                                                           |
| ------------- | ---------------------------------------- | ------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1782500000000 | RestoreLivePhotoStillVisibility (#29884) | `asset` | LOW  | Additive data-only `UPDATE` (`visibility='timeline'` for hidden live-photo stills). No schema change, no fork-table touch. Part of v3.0.3 base. |

- **Timestamp ordering**: OK — no collisions with `migrations-gallery/` (interleaving unaffected)
- **Table conflict check**: none — only an `UPDATE` on existing `asset` columns
- **Fork migration count**: 34 (`postbuild` synced "34 Gallery migrations", none clobbered)
- **`postbuild` merge / `CompositeMigrationProvider`**: intact (server build ran the sync + 1 compatibility alias)
- **`revert-to-immich.sql`**: coverage detector reports **0 missing** — the new migration is in the v3.0.3 tagged tree (so ignored), all fork migrations covered. No change needed.

## Mobile Drift Migration Analysis

- **No mobile Drift changes in the delta** — `schemaVersion` unchanged, no `drift_schema_vN.json` added, no renumbering. Collision check N/A.

## Inconsistencies Found

None. `git diff origin/main..HEAD` changed only upstream-delta files; the 6 delta files absent from that diff (`CODEOWNERS`, `prepare-release.yml`, `_mobile-app-download.md`, `Info.plist`, `pubspec.yaml`, `search.service.ts`) were all legitimately absorbed (fork already had the fix / deleted / placeholder), not dropped.

## Pattern Propagation

No broad upstream refactors in this delta.

## Local Verification

| Check                                                        | Status | Notes                                                        |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| SDK build                                                    | PASS   |                                                              |
| Server build (`nest build` + postbuild)                      | PASS   | 34 gallery migrations synced                                 |
| Server tsc (`pnpm check`)                                    | PASS   | (needed plugin-sdk/plugin-core built)                        |
| Web tsc (`check:typescript`)                                 | PASS   |                                                              |
| Web svelte-check                                             | PASS   | 0 files (known local no-op)                                  |
| Server unit tests                                            | PASS   | 4799 passed / 9 skipped                                      |
| Web unit tests (×2)                                          | PASS   | 3403 passed / 2 skipped / 8 todo (no flake)                  |
| Server lint                                                  | PASS   |                                                              |
| Web lint                                                     | PASS   | 0 errors, 640 tolerated tailwind warns                       |
| OpenAPI + Dart + SDK regen                                   | PASS   | no diff (in sync)                                            |
| SQL query docs                                               | N/A    | no repository changes → unaffected (DB-less, skipped safely) |
| Mobile `dart analyze` (`mise //mobile:analyze`)              | PASS   | No issues found                                              |
| Mobile `dart format` (`mise //mobile:format`, lib)           | PASS   | 0 changed                                                    |
| Mobile `flutter test`                                        | PASS   | 2520 passed / ~1 skipped                                     |
| Mobile generated code current (`verify-changed-files` scope) | PASS   | 0 committed generated files changed after build_runner       |

## Post-Rebase Verification

- Fork commits ahead of `immich-v3.0.3`: **916**
- Commits behind: **0**
- Fork diff clean: **YES** (integrity check exact — only upstream-delta files changed)
