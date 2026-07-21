# Upstream Sync Report — 2026-07-21 (batches 18–23)

## Summary

- **Upstream commits pulled**: 12 of 35 available (`4a4d468aa2` → `df970da59e`)
- **Fork commits synced**: 1 (`a3c34a9f92`, #823 space-album sidebar drill-down)
- **Batches completed**: 18, 19, 20, 21, 22, 23
- **Conflicts resolved**: 21 (2 of them fork-owned file deletions)
- **Risk level**: HIGH (two toolchain migrations landed)
- **Recommendation**: PROCEED — branch pushed as a checkpoint; batches 24–32 deferred to a fresh session
- **Branch**: `rebase/upstream-rolling-v3.0.3` @ `7422a087b4`
- **Quarantine**: HELD at `7a7303aceb` — `ee4bd3f833` (batch 33) is **not** pulled

## Why this run stopped at batch 23

The 35-commit range contains four toolchain migrations and one product-surface
collision. Batches 19 and 23 (openapi-generator v7.24 and eslint-unicorn v70)
were the two most dangerous and are now landed and verified. The remaining
batches include **TypeScript v6 → v7** — a compiler swap affecting ~3,100
fork-changed files — which warrants a full context budget of its own.

## Incoming Upstream Changes (pulled)

| SHA          | Summary                                              | Area            | Risk to Fork | Notes                                                                                                    |
| ------------ | ---------------------------------------------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `bf64f3867b` | do not show whats-new page on fresh login (#30072)   | server/mobile   | MEDIUM       | Added a `SettingsRepository.instance` call to the fresh-install migration path; broke a fork mobile test |
| `45a6ea84af` | prevent crash on video widget dispose (#30078)       | mobile          | LOW          | —                                                                                                        |
| `89d0a9d59f` | attach file picker input to DOM (#29660)             | web             | LOW          | —                                                                                                        |
| `3f6897ef80` | Xcode inline Flutter issues (#30080)                 | mobile          | LOW          | Build config only                                                                                        |
| `6fa3f2feac` | **openapi-generator v7.23 → v7.24 (#30067)**         | open-api/mobile | **HIGH**     | ★★ civil-date patch trap; Dart enum representation change                                                |
| `4c754f2999` | timebuckets locked permissions (#30066)              | server          | MEDIUM       | Lands in fork-extended `timeline.service.ts` (+146)                                                      |
| `77091b0107` | search statistics locked folder permissions (#30063) | server          | MEDIUM       | Lands in fork-extended `search.service.ts` (+470)                                                        |
| `8061a2e5ff` | Country/State filters when set to Unknown (#30026)   | web             | LOW          | Only touches a modal the fork deleted — see below                                                        |
| `df970da59e` | **eslint-unicorn v64 → v70 (#29684)**                | all             | **HIGH**     | 266-file upstream sweep; fork-only code needed the same treatment                                        |

### High-risk changes — detailed analysis

#### `6fa3f2feac` — openapi-generator v7.24.0

Two independent hazards, both realised:

1. **The civil-date patch (★★).** Mid-replay the auto-merge did drop the fork's
   two civil-date hunks from `native_class.mustache.patch`; they were restored
   by the still-pending `2f1f09f170` re-derivation commit. Verified explicitly
   rather than assumed.
2. **`native_class_nullable_items_in_arrays.patch` genuinely broke.** Its
   `@@ -34,14 +34,44 @@` hunk no longer applied because v7.24 added
   `{{#useFinalProperties}}final {{/useFinalProperties}}` to every property
   declaration. Re-derived programmatically (build the intended template, then
   `diff -u`) and round-trip verified: apply → byte-identical to the target.

Post-regeneration verification:

| Check                                                   | Expected         | Actual          |
| ------------------------------------------------------- | ---------------- | --------------- |
| `_dateFormatter.format(… .toUtc())` occurrences         | 0                | **0**           |
| `toUtc().toIso8601String()` datetime fields             | unchanged (~144) | **144**         |
| `mobile/openapi/.openapi-generator/VERSION`             | 7.24.0           | **7.24.0**      |
| Fork-only `Permission` enum entries                     | 30               | **30**          |
| Fork-only APIs (`gallery_map_api`, `shared_spaces_api`) | present          | **present**     |
| `TZ=America/New_York` civil-date test                   | pass             | **pass**        |
| `dart analyze --fatal-infos lib test`                   | clean            | **clean**       |
| `mise //mobile:format`                                  | clean            | **clean**       |
| `flutter test`                                          | pass             | **2817 passed** |

The off-UTC test is the load-bearing one: CI runners are UTC, so this
regression class is structurally invisible in CI.

**Fork fallout from exhaustive Dart enums** (v7.24 emits real enums; `_ =>`
wildcards are now unreachable and `.value` is private):

- `api.AssetEditAction.trim` (fork video trimming, #191) needed an explicit arm —
  it had been riding the `_ => AssetEditAction.other` default upstream deleted.
- `SharedSpaceRole.value` / `SyncRequestType.value` → `toString()`.
- The `SyncEntityType` dispatch lost its `default:` arm (it would now trip
  `unreachable_switch_default`). The fork's Task-18 forward-compat contract is
  unaffected — it is enforced one layer up by the `_kResponseMap` null-check in
  `sync_api.repository.dart` — and the comment there now says so.

#### `df970da59e` — eslint-unicorn v70

Upstream swept its own 266 files. The fork's **674 new + 307 modified**
TS/Svelte files were not in that sweep, and both packages gate on zero
errors. Pattern propagation (skill step 7h) was mandatory, not optional.

- **server**: 235 → 0 errors (autofix handled 175; 60 by hand)
- **web**: 237 → 0 errors (autofix handled 131; 106 by hand)

Notable non-mechanical outcomes:

- **bullmq `lrem` broke the build.** v70's lockfile regen moved bullmq
  5.76.10 → 5.80.2, and 5.80 narrowed `IRedisClient` to only the commands
  bullmq itself issues — dropping `LREM`. The fork's #648 orphan-active-job
  sweep calls it, so `pnpm check` went red. Fixed by casting to ioredis (the
  concrete client) rather than reimplementing LREM as a Lua script. **This is a
  dependency change silently breaking fork-only code — exactly the class the
  skill warns about, and it would not have been caught by the rebase audits.**
- **`web/eslint.config.js`**: added `'unicorn/prefer-promise-try': 'off'` under
  upstream's own "not yet compatible with all our supported browsers" comment —
  `Promise.try` trips the `compat`/`tscompat` rules.
- **Tailwind autofix modernised fork classes** (`h-6 w-6`→`size-6`,
  `h-full w-full`→`size-full`, `duration-[80ms]`→`duration-80`,
  `group-data-[selected]:`→`group-data-selected:`). Behaviour-equivalent;
  fork specs asserting the literal strings were updated.
- **`globalThis.location.href = route` → `location.assign(route)`** (autofix).
  Equivalent, but the fork spec spied the `href` setter — updated to spy
  `assign`.

## Conflict Resolutions

21 conflicts. The dominant shape was _"upstream applied a lint refactor to a
region the fork had already rewritten"_; those were resolved as a union —
fork semantics in upstream's style — never by taking a side wholesale.

### Notable entries

| File                                                          | Fork side                                        | Upstream side                              | Resolution                                                               | Risk   |
| ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| `mobile/lib/domain/services/sync_stream.service.dart` (×4)    | fork sync-entity case arms + `default:`          | `default:` removed                         | Union: keep fork arms, drop `default:`; document the parsing-layer guard | LOW    |
| `server/src/services/search.service.ts`                       | space guards (`spaceId`/`withSharedSpaces`)      | `getUserIdsToSearch(auth, dto.visibility)` | Union — **upstream's arg is the security fix, must not be lost**         | LOW    |
| `server/src/utils/fetch.ts`                                   | env-tagged `gallery-server/...` UA               | `fetch` + eslint-disable                   | Union                                                                    | LOW    |
| `server/src/utils/file.ts`                                    | preserve HttpException status (RBAC 401<403<404) | `!(x instanceof Y)`                        | Fork block already in the wanted form                                    | LOW    |
| `server/src/utils/database.ts`                                | `isStaleAssetForeignKeyConstraint`               | early-return inversion                     | Union in upstream's shape                                                | LOW    |
| `web/src/lib/services/user-admin.service.ts`                  | rejection sampling (modulo-bias fix, #112)       | string-concat + `/=` autofix               | Fork algorithm in upstream's style                                       | LOW    |
| `web/src/lib/components/Image.svelte`                         | re-capture on source change + cancel old URL     | early-return inversion                     | Fork semantics in upstream's shape                                       | MEDIUM |
| `server/src/services/media.service.ts`, `metadata.service.ts` | S3 `localOriginalPath` / `ensureLocalFile`       | cosmetic boolean renames                   | Fork side (verified `localOriginalPath`×9, `ensureLocalFile`×4 survive)  | LOW    |
| `pnpm-lock.yaml` (×6)                                         | —                                                | —                                          | Upstream, then `pnpm install --no-frozen-lockfile`                       | LOW    |

### Accepted deletions

Upstream lint-fixed files the fork had already deleted. Verified zero remaining
references before accepting each:

- `web/src/lib/modals/SearchFilterModal.svelte`, `search-bar/SearchBar.svelte`,
  `search-bar/SearchHistoryBox.svelte` (fork #416 removed the legacy SearchBar flow)
- `web/src/routes/(user)/people/PeopleInfiniteScroll.svelte`,
  `.../MergeFaceSelector.svelte` (fork #450 replaced them)
- `handleFetch` in `web/src/service-worker/index.ts` (fork #502, S3 direct delivery)

**Process note:** one resolver pass staged `service-worker/index.ts` with
conflict markers still in it (an empty "theirs" section defeated the regex).
The mandatory full-tree marker scan caught it and it was fixed properly. The
scan is not optional — it is the only thing that catches this.

### `8061a2e5ff` (Country/State "Unknown") — no fork action needed

Upstream's fix distinguishes "Unknown" (explicit `null`) from "not set"
(`undefined`) in `SearchFilterModal.svelte`. The fork deleted that modal.
Checked whether the fork's replacement filter panel carries the same bug: it
has **no "Unknown" option**, so the bug class does not apply. No follow-up.

## Fork Feature Verification

| Feature                       | Status | Notes                                                                    |
| ----------------------------- | ------ | ------------------------------------------------------------------------ |
| Shared Spaces                 | OK     | Space guards preserved in `search.service.ts`; sync dispatch arms intact |
| Storage Migration / S3        | OK     | `localOriginalPath` (9) + `ensureLocalFile` (4) verified present         |
| Direct S3 media delivery      | OK     | Service-worker `handleFetch` removal preserved                           |
| Global Search / cmdk          | OK     | 0 lint errors after propagation; specs pass                              |
| Timeline grouping             | OK     | Grouping guard merged into upstream's early-return                       |
| Image Editing (trim)          | OK     | `AssetEditAction.trim` explicitly mapped                                 |
| Face Identity / people        | OK     | `checkAccess` + identity resolution preserved                            |
| Environment-tagged User-Agent | OK     | `gallery-server/${version} (${label})` intact                            |
| Branding                      | OK     | Audits green                                                             |
| Fork migrations               | OK     | 48/48, no timestamp collisions                                           |

## CI and Infrastructure Verification

| Check                                    | Status                              |
| ---------------------------------------- | ----------------------------------- |
| Fork-Owned File Survival                 | OK                                  |
| Fork Extension Symbol Survival           | OK                                  |
| Gallery Migration Count (48)             | OK                                  |
| Migration Timestamp Collision            | OK                                  |
| Mobile Drift schema/callbacks            | OK                                  |
| `@immich/ui` patch metadata              | OK                                  |
| No `PUSH_O_MATIC` dependency             | OK                                  |
| Gallery release images                   | OK                                  |
| Upstream docs-deploy stays dispatch-only | OK                                  |
| `revert-to-immich.sql` coverage          | OK (no new migration in this range) |

## Database Migration Analysis

No new upstream migrations in batches 18–23. The one in the pending range —
`1784647658615-AddOAuthBearerTokenToSession` (batch 35, additive
`session.oauthBearerToken`) — **will need a `revert-to-immich.sql` entry** when
pulled, or the coverage gate fails on this branch and everything based on it.

## Mobile Drift Migration Analysis

No upstream `schemaVersion` change. Fork ownership unchanged. Drift check green.

## Pattern Propagation

| Refactor                        | Old → New                               | Fork files affected                      | Decision    | Commit       |
| ------------------------------- | --------------------------------------- | ---------------------------------------- | ----------- | ------------ |
| eslint-unicorn v64 → v70        | ~25 rules newly enforced                | 674 new + 307 modified TS/Svelte         | **Bundled** | `7422a087b4` |
| openapi-generator v7.23 → v7.24 | Dart enums exhaustive; `.value` private | mobile enum switches, 2 template patches | **Bundled** | `c8a45df151` |

## Local CI Verification

| Check                                          | Status                                 |
| ---------------------------------------------- | -------------------------------------- |
| `server` lint (`--max-warnings 0`)             | PASS                                   |
| `server` `tsc --noEmit`                        | PASS                                   |
| `server` prettier                              | PASS                                   |
| `server` unit tests                            | PASS — 5098 passed, 9 skipped          |
| `web` lint                                     | PASS — 0 errors (8 tolerated warnings) |
| `web` `check:typescript`                       | PASS                                   |
| `web` unit tests                               | PASS — 3687 passed                     |
| `mobile` `dart analyze --fatal-infos lib test` | PASS                                   |
| `mobile` `dart format`                         | PASS                                   |
| `mobile` `flutter test`                        | PASS — 2817 passed                     |
| Off-UTC civil-date test                        | PASS                                   |
| Full-tree conflict-marker scan                 | CLEAN                                  |

## Remote CI Verification

**Not yet run.** The branch is pushed as a checkpoint only. The full dispatch
set should run once batches 24–32 land, since TypeScript v7 will change the
type-check surface again.

## Remaining Work (batches 24–32)

| Batch | Tip         | Content                                                             | Risk                                |
| ----- | ----------- | ------------------------------------------------------------------- | ----------------------------------- |
| 24    | `2e587fc7e` | Bulgarian README                                                    | LOW (conflicts with branded README) |
| 25    | `e918658cc` | mise docker tag                                                     | LOW                                 |
| 26    | `1b4d41324` | **TypeScript v6 → v7**, pnpm 11.11→11.13, svelte 5.56.5, upload fix | **HIGH**                            |
| 27    | `ce022233a` | base-image bump                                                     | LOW                                 |
| 28    | `aa08dad1f` | eslint-unicorn v72                                                  | MEDIUM                              |
| 29    | `ae8398ffe` | valkey digest                                                       | LOW                                 |
| 30    | `e6fff3b15` | android, lens search, cmdk maintenance link                         | MEDIUM                              |
| 31    | `59bc81423` | **GitHub Actions major** across 15 fork-modified workflows          | **HIGH**                            |
| 32    | `7a7303ace` | mobile fixes                                                        | LOW                                 |
| —     | **GATE**    | `ee4bd3f833` album asset events — product decision pending          | —                                   |
| 33–35 | `73329a8ce` | album events, OIDC + new migration                                  | MEDIUM                              |

## Quarantined — product decision required

`ee4bd3f833` (**feat: add album asset event handling**, #29008) reshapes
`AlbumUpdate: {id, recipientId}` → `{id, userIds, recipientIds}` and adds an
`on_album_update` websocket event. The fork built its own parallel model for
the same job — `AlbumAssetsAdd` / `AlbumAssetsRemove` / `AlbumDelete` feeding
`shared-space.service.ts` handlers, plus ~214 lines in `album.service.ts` — to
sync space-album contributions.

It will rebase mechanically. The open question is whether the fork's
space-album sync should converge onto upstream's album-event contract or stay
deliberately parallel. Deferred by the maintainer on 2026-07-21; recorded in
`rolling-state.json` under `quarantine`.

## Post-Rebase Verification

- Fork commits ahead of batch-23 tip: 945
- Behind `upstream/main`: 26 (all deliberately held)
- `ee4bd3f833` pulled: **no** (quarantine holding)
- Backup branches: `backup/rolling-pre-batch{18,19,20,21,22,23}-20260721`,
  `backup/rolling-pre-forksync-20260721`
