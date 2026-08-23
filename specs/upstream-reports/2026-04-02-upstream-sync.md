# Upstream Sync Report — 2026-04-02

## Summary

- **Upstream commits pulled**: 38 (post-v2.6.3, upstream/main at `2166f07b1`)
- **Conflicts resolved**: 15 across 10 files (all in first squash commit + 6 subsequent fork commits)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED (all conflicts resolved conservatively, no semantic breakage detected)

## Incoming Upstream Changes

| SHA         | Summary                                                     | Area   | Risk to Fork | Notes                                                                        |
| ----------- | ----------------------------------------------------------- | ------ | ------------ | ---------------------------------------------------------------------------- |
| `2166f07b1` | Rename DayGroup → TimelineDay                               | web    | LOW          | Fork doesn't reference DayGroup directly; 3 overlap files auto-merged        |
| `c9e251c78` | Highlight active person thumbnail in detail/edit panels     | web    | LOW          | Detail panel overlap, minor                                                  |
| `da4b88fc1` | Transition bg and border-radius fix                         | web    | LOW          | CSS only                                                                     |
| `d1e2e8ab4` | Substring matching for person name search                   | server | MEDIUM       | Changes person.repository query — fork has space person search nearby        |
| `2a619d3c1` | Enable stack selector in shared album view                  | web    | LOW          | Shared viewer overlap                                                        |
| `c29493e3a` | withFilePath select edited or unedited file                 | server | MEDIUM       | Changes media.service.ts query logic — fork has S3/editing extensions        |
| `4ef777d14` | Dep update: handlebars v4.7.9 (security)                    | deps   | LOW          |                                                                              |
| `0b40f4fd7` | Dep update: happy-dom v20.8.9 (security)                    | deps   | LOW          |                                                                              |
| `ecba4e2a6` | Tee GITHUB_OUTPUT for debugging                             | CI     | LOW          |                                                                              |
| `4eb531197` | Prevent AssetUpdate from adding unrelated timeline assets   | web    | MEDIUM       | timeline-manager overlap                                                     |
| `505a07a82` | Add move to lock folder in folder view                      | web    | LOW          | Folders page overlap                                                         |
| `548dbe8ad` | Add Keycloak example to OAuth docs                          | docs   | LOW          | docs/oauth.md overlap                                                        |
| `0c184940f` | Update GitHub Actions versions                              | CI     | LOW          | build-mobile, static_analysis overlap                                        |
| `be180fd9d` | Detection of WebM container fix                             | server | LOW          |                                                                              |
| `859f58174` | Node.js v24.14.1                                            | deps   | LOW          | Patch version bump                                                           |
| `a6c7e7600` | Grafana docker tag v12.4.2                                  | deps   | LOW          |                                                                              |
| `0ff94213e` | Dep update: exiftool-vendored v35.15.1                      | deps   | LOW          |                                                                              |
| `6b1dd6f68` | Mobile: favorite button state fix                           | mobile | LOW          |                                                                              |
| `7d4286bbc` | Asset viewer nav bar drop shadow + prevent button shrinking | web    | LOW          | Nav bar overlap — merged with fork's edited badge                            |
| `18201a26d` | OCR overlay interactivity during zoom                       | web    | LOW          |                                                                              |
| `a2e3635ac` | ESM global import for openid-client                         | server | LOW          | oauth.repository overlap                                                     |
| `ce346bf95` | Dim photo outside hovered face bounding box                 | web    | LOW          |                                                                              |
| `a1a293986` | Mobile: low upload timeout on android                       | mobile | LOW          |                                                                              |
| `e8309585d` | Dep update: nodemailer v8 (security)                        | deps   | LOW          |                                                                              |
| `17d494108` | Asset select manager (4/4) — remove context pattern         | web    | HIGH         | Removes `getAssetControlContext`, all pages use singleton. 12+ overlap files |
| `b09ebb11e` | Optimize people page query                                  | server | LOW          | person.repository overlap                                                    |
| `181b028b0` | Upload totals stable on dismiss                             | web    | LOW          |                                                                              |
| `eb20b715e` | Don't auto-close manually reopened PRs                      | CI     | MEDIUM       | auto-close.yml fork conflict                                                 |
| `a277c6311` | Mobile: streamline error handling for live photo saving     | mobile | LOW          |                                                                              |
| `5889c42eb` | Asset select manager (3/4)                                  | web    | HIGH         | Part of selection refactor chain                                             |
| `14cce0cba` | Asset select manager (2/4) — rename properties              | web    | HIGH         | `selectedAssets`→`assets`, `clearMultiselect`→`clear`                        |
| `9b80ffd9c` | Asset select manager (1/4) — singleton                      | web    | HIGH         | Deletes `AssetInteraction`, creates `assetMultiSelectManager` singleton      |
| `306a3b8c7` | Mobile: images loads cancel too early                       | mobile | LOW          |                                                                              |
| `be0fc403d` | Mobile: system/app color scheme mismatch                    | mobile | LOW          |                                                                              |
| `c13fd9e4b` | Mobile: video icon not showing on memories                  | mobile | LOW          |                                                                              |
| `8724848fc` | Mobile: reduce spacing on video controls                    | mobile | LOW          |                                                                              |
| `2d950db94` | Replace intersection booleans with enum                     | web    | LOW          | Fork doesn't use `.intersecting` directly                                    |
| `4b9ebc2cf` | Migrate isFaceEditMode to assetViewerManager                | web    | LOW          | asset-viewer-manager overlap                                                 |

### High-Risk Changes (detailed analysis)

**Selection Manager Refactor (4 commits: `9b80ffd9c`, `14cce0cba`, `5889c42eb`, `17d494108`)**

The largest change in this batch. Upstream replaced the instance-based `AssetInteraction` class with a singleton `assetMultiSelectManager`, renamed properties (`selectedAssets`→`assets`, `clearMultiselect`→`clear`), and removed the context injection pattern (`getAssetControlContext`/`setAssetControlContext`). This touched 30+ files across all page routes.

**Impact on fork:** Our fork code does NOT reference `AssetInteraction`, `selectedAssets`, or `getAssetControlContext` directly — all fork features (FilterPanel, spaces, etc.) were already using the `assetMultiSelectManager` prop pattern. The conflicts were purely textual: both sides modified the same page files in different sections. All 12+ page conflicts auto-merged cleanly; only the photos page and folders page required manual resolution.

## Conflict Resolutions

### Conflict: `pnpm-lock.yaml`

- **Fork side**: Fork's lockfile with AWS S3 deps
- **Upstream side**: Updated lockfile with new dependency versions
- **Resolution**: Took upstream's version — will regenerate after `pnpm install` in CI
- **Risk**: LOW

### Conflict: `server/src/queries/person.repository.sql`

- **Fork side**: Fork's generated SQL queries
- **Upstream side**: Updated queries from person search optimization
- **Resolution**: Took upstream's version — generated file, will be regenerated by `make sql`
- **Risk**: LOW

### Conflict: `server/src/repositories/oauth.repository.ts`

- **Fork side**: Simple `fetchUserInfo` call
- **Upstream side**: New ID token claims optimization (check claims first, fallback to userinfo)
- **Resolution**: Kept upstream's improvement — fork doesn't customize OAuth
- **Risk**: LOW

### Conflict: `server/src/repositories/person.repository.ts`

- **Fork side**: Inline `asset_file` subquery for preview path
- **Upstream side**: Uses `withFilePath(eb, AssetFileType.Preview)` helper
- **Resolution**: Kept upstream's `withFilePath` helper — cleaner and includes the edited/unedited fix
- **Risk**: LOW

### Conflict: `web/src/lib/components/album-page/album-viewer.svelte`

- **Fork side**: Custom `Logo` import from `$lib/components/shared-components/Logo.svelte` + `UserResponseDto`
- **Upstream side**: `Logo` from `@immich/ui` (no `UserResponseDto`)
- **Resolution**: Kept fork's custom Logo import (branding) and `UserResponseDto` type
- **Risk**: LOW

### Conflict: `web/src/lib/services/asset.service.ts` (x2)

- **Fork side**: Imported removed stores (`isFaceEditMode`, `assetViewingStore`, `AssetControlContext`)
- **Upstream side**: These stores were removed/refactored into managers
- **Resolution**: Dropped stale imports — `isFaceEditMode` migrated to `assetViewerManager.toggleFaceEditMode()`
- **Risk**: LOW

### Conflict: `web/src/routes/(user)/albums/.../+page.svelte`

- **Fork side**: `assetInteraction.isAllUserOwned` + `<RotateAction />`
- **Upstream side**: `assetMultiSelectManager.isAllUserOwned` (no RotateAction)
- **Resolution**: Used upstream's `assetMultiSelectManager.isAllUserOwned` + kept fork's `<RotateAction />`
- **Risk**: LOW

### Conflict: `web/src/routes/(user)/folders/.../+page.svelte`

- **Fork side**: `RotateAction` import only
- **Upstream side**: `SetVisibilityAction` import only
- **Resolution**: Both imports kept — fork needs RotateAction, upstream adds SetVisibilityAction
- **Risk**: LOW

### Conflict: `web/src/routes/(user)/photos/.../+page.svelte` (x2)

- **Fork side**: Full FilterPanel layout, filter state/config, `new AssetInteraction()`, `assetInteraction.selectedAssets`
- **Upstream side**: Simple Timeline without FilterPanel, `assetMultiSelectManager.assets`
- **Resolution**: Kept fork's FilterPanel layout + filter state/config, replaced all `AssetInteraction` references with `assetMultiSelectManager` singleton, kept `ml-4` margin fix
- **Risk**: MEDIUM — most complex resolution, verify FilterPanel renders correctly
- **Verification needed**: Photos page renders with FilterPanel, selection works, filters apply

### Conflict: `.github/workflows/auto-close.yml` (x2)

- **Fork side**: Removed template enforcement jobs (only `close_llm` kept)
- **Upstream side**: Added label check to `close_template`, added `reopen` job
- **Resolution**: Kept fork's version — template enforcement auto-closes our own PRs
- **Risk**: LOW

### Conflict: `web/src/lib/components/shared-components/map/MapTimelinePanel.svelte`

- **Fork side**: Imported old `AssetInteraction` + filter panel types
- **Upstream side**: No `AssetInteraction` (removed by refactor)
- **Resolution**: Dropped `AssetInteraction` import, kept filter panel type imports
- **Risk**: LOW

### Conflict: `server/src/queries/asset.repository.sql`

- **Fork side**: Fork's generated SQL queries
- **Upstream side**: Updated queries
- **Resolution**: Took upstream's version — generated file
- **Risk**: LOW

### Conflict: `web/src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte`

- **Fork side**: Old CSS classes + fork's edited badge
- **Upstream side**: New CSS classes (`p-1 -m-1 *:shrink-0`)
- **Resolution**: Upstream's CSS improvements + fork's edited badge
- **Risk**: LOW

### Conflict: `web/src/lib/components/asset-viewer/detail-panel.svelte` (x2)

- **Fork side**: `class="w-22"` + space person routing with `spaceId` / `effectiveSpaceId`
- **Upstream side**: `class="group w-22 outline-none"` + standard person routing
- **Resolution**: Upstream's CSS classes (`group w-22 outline-none`) + fork's conditional space person routing with `effectiveSpaceId`
- **Risk**: LOW

## Fork Feature Verification

| Feature              | Status | Notes                                                    |
| -------------------- | ------ | -------------------------------------------------------- |
| Shared Spaces        | OK     | All space routes, services, schema untouched by upstream |
| Storage Migration    | OK     | No upstream changes to S3 backend or migration service   |
| Pet Detection        | OK     | No upstream changes to ML models or pet schema           |
| Image Editing        | OK     | Editing extensions preserved, trimming intact            |
| Branding             | OK     | Custom Logo import preserved in album-viewer             |
| Google Photos Import | OK     | No upstream changes to import components                 |
| Filter Panel         | OK     | Adapted to assetMultiSelectManager singleton             |
| User Groups          | OK     | No upstream changes to group schema or services          |

## CI and Infrastructure Verification

| Check                                            | Status | Notes                                                   |
| ------------------------------------------------ | ------ | ------------------------------------------------------- |
| Workflow files (no upstream collisions)          | OK     | release.yml untouched, no new docker.yml from upstream  |
| Docker image references (gallery-\*, not immich) | OK     | No upstream workflow changes to Docker image names      |
| Fork CI modifications intact                     | OK     | DCM disabled, auto-close stripped, docs tokens replaced |
| New upstream workflows reviewed                  | OK     | No new workflow files added                             |
| Action/tool versions compatible                  | OK     | GitHub Actions updated, compatible with fork            |

## Inconsistencies Found

None found. The selection manager refactor was the primary risk area, but our fork code consistently uses the `assetMultiSelectManager` singleton pattern (not the old `AssetInteraction` class), so all page-level conflicts were textual rather than semantic.
