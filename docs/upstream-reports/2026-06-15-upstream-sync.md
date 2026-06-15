# Upstream Sync Report — 2026-06-15

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`, deployed to staging)
- **Fork commits synced** (origin/main `22b368f7..3e783c3b`): 4 (#693 skipped as empty, #695, #697, #698)
- **Upstream commits pulled** (`b21af784..622a330d8`): 10 (batches 245 + 246)
- **Conflicts resolved**: 5 (1 fork-sync i18n, 4 during the upstream rebase)
- **New migrations this batch**: 0 (server and mobile) — no renumbering, no revert-to-immich additions
- **Risk level**: LOW–MEDIUM (single genuine reconciliation: upstream #29028 map signature vs fork #364 shared-space map)
- **Recommendation**: PROCEED — all local checks green; full server (4645) + web (3164) unit suites pass; 0 commits behind upstream

> **Scope note (held rolling branch):** This is the v3-cutover rolling branch, not `main`. It is **not** force-pushed to `main`; it is pushed to its own remote (`origin/rebase/upstream-rolling-20260509-active`, the staging-deployed branch). The skill's "force-push to main" and "version reference bump" steps (`branding/config.json` `upstream.version`, README, marketing) are intentionally **skipped** — the fork's revert-to-immich baseline stays at the tagged `v2.7.5`, and the v3 version story is handled at cutover/release time, not per-batch.

## Part A — Fork sync (origin/main → rolling branch)

`make upstream-sync-fork-main` is all-or-nothing and threw on the first commit (#693 came back empty). Resolved by hand commit-by-commit per the skill escape hatch; `integratedForkHead` advanced manually to `3e783c3b`.

| Source SHA | PR                                | Result              | Notes                                                                                                                                                                                                                          |
| ---------- | --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `7e7fa00a` | #693 iOS plugins via CocoaPods    | **Skipped (empty)** | The rolling branch already carries an equivalent iOS-14/CocoaPods fix (`65b39180`, `749997e4`); git's 3-way merge produced an empty cherry-pick (line 371 `flutter config --no-enable-swift-package-manager` already present). |
| `dcfdf0d0` | #695 pet-detection clear on reset | `64ca2d247f`        | Clean (auto-merged `en.json`, `person.repository.ts`, `QueuePanel.svelte`).                                                                                                                                                    |
| `12ccbe06` | #697 de/fr fork translations      | `3b1ef97ccb`        | i18n conflict — see below.                                                                                                                                                                                                     |
| `3e783c3b` | #698 docs deploy → Bunny          | `20921a75a6`        | Clean (`gallery-docs-deploy.yml`).                                                                                                                                                                                             |

### Conflict: `i18n/de.json` + `i18n/fr.json` (#697)

- **Fork side (#697)**: purely additive (+513/0) fork-only translation keys, authored against the v2.7.5-era sparse `origin/main` de/fr files.
- **Rolling side (HEAD)**: newer upstream Weblate German/French (the v3 base has many more translated keys).
- **Resolution**: deterministic deep-merge — HEAD wins on every overlapping key, only the genuinely fork-only keys from #697 are injected. Diagnostics found **14 overlapping keys, all of which are upstream strings** (`admin.oauth_*`, `link`, `load_more`, `my_immich_*`, `system_theme`, `screencast_mode_*`, `show_less`, `remove_filter`) — these correctly keep HEAD's upstream Weblate values, not the fork PR's re-translations.
- **Verification**: 0 upstream keys lost, 0 deletions vs HEAD, ~490 fork keys injected per file; prettier-clean; output byte-format matches the repo's sorted/2-space convention.
- **Risk**: LOW.

## Part B — Upstream rebase (10 commits, batches 245 + 246)

| SHA        | PR                                         | Area        | Risk       | Outcome                        |
| ---------- | ------------------------------------------ | ----------- | ---------- | ------------------------------ |
| `5a3be158` | #29080 album names in dup review           | web         | LOW        | clean                          |
| `46631b37` | #29044 upload panel overlap                | web         | LOW        | clean                          |
| `a97e5999` | #29068 login required fields               | web         | LOW        | clean                          |
| `cc54de87` | #29058 image error state                   | web         | LOW        | clean                          |
| `5f1a180d` | #29092 remove dead web code                | web         | LOW        | **2 conflicts** (see below)    |
| `c273ccf2` | #29088 feat: languages                     | i18n/mobile | LOW        | clean                          |
| `a9ee6a7c` | #29010 show asset arrows                   | web         | LOW        | clean                          |
| `b633cc4f` | #29028 hide partner archived map locations | server      | **MEDIUM** | **reconciled** (see below)     |
| `5e8744a5` | #29076 lock transcoding options            | web admin   | LOW        | clean                          |
| `622a330d` | #29079 slideshow transition                | mobile      | LOW        | clean (no Drift schema change) |

### Conflict 1 — `web/src/lib/elements/SearchBar.svelte` (squash commit)

#29092 deleted `web/src/lib/utils/dipatch.ts` and inlined its `SearchOptions` type into `onSearch?: (options: { force?: boolean })`. The fork squash had removed `LoadingSpinner` from the `@immich/ui` import (it uses its own `$lib/components/shared-components/LoadingSpinner.svelte`). Both touched the same import lines.

- **Resolution**: `import { IconButton } from '@immich/ui';` — drop the dead `dipatch` import (upstream removed the file; no body usage of `SearchOptions`) and keep `LoadingSpinner` out (fork uses its own).
- **Risk**: LOW. svelte-check + tsc clean.

### Conflict 2 — `web/src/lib/utils/exif-utils.ts` + `.spec.ts` (modify/delete, #29092)

#29092 deleted `exif-utils.ts` (it only held the now-unused `getExifCount`). Fork commit `3d36d7e4` ("add map provider links to image info panel") had added `getGoogleMapsUrl`/`getAppleMapsUrl`/`getOpenStreetMapUrl`/`getMapProviderLinks` to the same file.

- **Resolution**: keep the file with the fork's map-provider helpers; honour upstream's dead-code removal by dropping `getExifCount` + its now-unused `AssetResponseDto` import (verified 0 references outside the file). Dropped the `getExifCount` test block from the spec, kept the map-provider URL coverage. A later fork formatting commit (`7d65d3ab`) re-conflicted on the same block and was resolved identically.
- **Risk**: LOW. Web unit suite green.

### Reconciliation — `#29028` map (MEDIUM, the one real merge)

Upstream #29028 added an `authUserId` first parameter to `MapRepository.getMapMarkers` and scoped the archive-visibility branch to the authed user (`eb.and([asset.ownerId = authUserId, visibility = Archive])`), so a partner's archived asset locations no longer leak onto the map. The fork's #364 ("shared-space photos on personal map") had extended the same method with `timelineSpaceIds` (shared-space + library subqueries) against the old signature.

- **Repository** (`map.repository.ts`): auto-merged **coherently** — the final method carries both upstream's `authUserId` archive filter and the fork's `timelineSpaceIds` shared-space queries, with `@GenerateSql` params updated to the new arity. Verified by inspection + `sync-sql` producing zero diff (committed `map.repository.sql` already matches).
- **Service** (`map.service.ts`, conflict): combined both sides — the fork's `searchOptions`/`timelineSpaceIds` construction is preserved and the final call prepends `auth.user.id`: `getMapMarkers(auth.user.id, userIds, albumIds, searchOptions)`.
- **Specs** (post-rebase fix, commit `d4e25ba2`): adapted the fork's `map.service.spec.ts` (one stale 3-arg expectation from a later `withSharedAlbums` commit) and `map.repository.spec.ts` medium test (all calls now pass `member.id` as `authUserId`). The new archive semantics are **consistent with the fork tests' intent** — `ownerId === authUserId` keeps owner-archived space assets hidden from members (the "member archive toggle does not leak owner archive" test passes).
- **Risk after reconciliation**: LOW. tsc clean; server unit suite green; `getMapMarkers` has a single repository caller, all updated.

## Fork Feature Verification

| Feature                                    | Status | Evidence                                                                     |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------- |
| Shared Spaces (incl. map markers)          | OK     | files present; map reconciliation unit-tested; postrebase symbol audit green |
| Storage Migration                          | OK     | service/controller present; postrebase file survival green                   |
| Pet Detection                              | OK     | service + ML model dir present; #695 fix integrated                          |
| Auto-Classification                        | OK     | service present                                                              |
| User Groups                                | OK     | service/controller present                                                   |
| Gallery Map (shared-space on personal map) | OK     | controller present; #29028 reconciled                                        |
| Global Search / cmdk                       | OK     | components present; SearchBar conflict resolved                              |
| Image Editing / map-provider links         | OK     | exif-utils map helpers preserved + tested                                    |
| Branding / revert-to-immich                | OK     | `revert-to-immich.sql` coverage detector: 0 missing                          |

## CI / Infrastructure Verification

| Check                           | Status | Notes                                                                             |
| ------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `ci-invariants-check`           | OK     | no PUSH_O_MATIC; gallery release images; upstream docs-deploy stays dispatch-only |
| `fork-patches-check`            | OK     | `@immich/ui` patch metadata consistent                                            |
| `fork-ownership-coverage-check` | OK     | covers 2515 fork files (advisory narrowing suggestions only)                      |
| Docker image references         | OK     | unchanged by batch                                                                |

## Database Migration Analysis

- **New upstream migrations in batch**: 0 (none of the 10 commits touch `server/src/schema/migrations/`).
- **Gallery migration count**: 33 (expected 33) — postrebase audit green, no filename/timestamp collisions.
- **Mobile Drift**: `schemaVersion`, snapshots, and Gallery callbacks consistent (postrebase mobile-drift-check green). #29079 slideshow touched mobile config but **not** the Drift schema.
- **revert-to-immich.sql**: coverage complete (detector run against `v2.7.5` tree, 68 upstream migrations; 0 missing).

## Local Verification

| Check                                   | Status                                        |
| --------------------------------------- | --------------------------------------------- |
| `pnpm --filter immich build`            | PASS (postbuild synced 33 gallery migrations) |
| server `tsc --noEmit`                   | PASS                                          |
| web `check:svelte` + `check:typescript` | PASS (0 errors / 0 warnings)                  |
| server unit suite                       | PASS (4645 passed, 9 skipped)                 |
| web unit suite                          | PASS (3164 passed, 2 skipped, 8 todo)         |
| `sync-sql` regen                        | PASS — no diff (SQL in sync)                  |
| OpenAPI spec sync                       | PASS — no diff (API surface unchanged)        |
| postrebase-audit (245 + 246)            | PASS                                          |
| mobile-drift-rebase-check (246)         | PASS                                          |

## Post-Rebase Verification

- Commits behind upstream: **0**
- Fork commits ahead of upstream: 752
- All 10 upstream commits confirmed ancestors of HEAD
- No leftover conflict markers anywhere in the tree
- Upstream content spot-checks: `dipatch.ts` removed, `en_GB.json` present, slideshow + TimelineAssetViewer intact

## Safety Tags

- `rebase-presync-20260615` → `50b74443` (pre fork-sync)
- `rebase-prebatch245-20260615` → `20921a75` (post fork-sync, pre upstream batch)
- `rebase-batch245-done-20260615` → `1bf74e0c`
- `rebase-batch246-done-20260615` → `1205251618`
