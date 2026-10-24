# Upstream Sync Report — 2026-10-24 (v3.4 rolling, batches 89–132)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.4`, now on upstream/main `cf719e733e6` (was `188d64e4359`). 0 commits behind upstream/main; 1745 fork commits ahead.
- **Upstream commits pulled**: 75 (batches 89–132), replayed in three steps (89–105, 106–125, 126–132) because every step replays the whole fork history.
- **Fork sync**: the 13 commits main gained when it was rebuilt on Immich v3.3.5 (`b3d94884c73..e9eb6f68586`), plus upstream's v3.3.4 and v3.3.5 version commits, carried the way the earlier v3.3 version commits are. The base is now **3.3.5** (`branding/config.json`, `server/package.json`).
- **Upstream tag**: none for v3.4 yet, so this branch stays off `main`.
- **Risk level**: MEDIUM. **Recommendation**: PROCEED (remote CI below).
- **Decisions (Pierre, 2026-10-24)**: passkeys taken as upstream ships them (enabled by default); the web query-module refactor propagated to fork code in this cycle.

## Incoming upstream changes (high and medium risk)

| SHA                                         | Summary                                                                                                                  | Risk   | Outcome                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `6233a79bf7e`                               | passkeys (immich-32194)                                                                                                  | HIGH   | Taken as is. New `passkey`/`auth_challenge` tables, passkey permissions, login page. Revert script and access oracle updated.                |
| `38a2ce4daa6`                               | more efficient person queries (immich-32523)                                                                             | HIGH   | Identical to immich-32593, so the v3.3.5 Option A resolution applies: schema taken, Gallery's person queries kept.                           |
| `477452b5c51`                               | locking around concurrency-1 jobs (immich-28410)                                                                         | HIGH   | Replayed by hand into the replay-owned `person.service.ts`: both recognition handlers run inside `withLock(DatabaseLock.FacialRecognition)`. |
| `98680ad6993` … `9666eadc5bb`               | web query refactors (workflow, config, notification, shared link, folder view, album, api keys/passkeys/sessions)        | HIGH   | Fork web code moved onto the query modules (see Pattern propagation).                                                                        |
| `9982bee7b04`, `380f3e74e62`, `cd47ee30676` | shared-link fixes: metadata visibility in the mapper, no album members for shared-link viewers, edited files in archives | MEDIUM | Merged into the fork's Space and #1018 code (see Conflict resolutions).                                                                      |
| `e9fb180f466`                               | partner timeline limited to timeline assets                                                                              | MEDIUM | Taken; the #763 rule (favorite filter allowed on other users' timelines) is kept as the one difference.                                      |
| `8dab52c7491`                               | partners' locked assets excluded from legacy search                                                                      | MEDIUM | Taken; applies to the fork's legacy flat search path.                                                                                        |
| `cf719e733e6`                               | createdAt range for "recently added" time buckets                                                                        | MEDIUM | Taken in `getTimeBucket`, with the range sized by the fork's bucket size (year/month/day).                                                   |
| `6b6b38ce093`                               | bullmq 6                                                                                                                 | MEDIUM | Fork queue code moved off the removed `paused` state and `Queue.client` (see Inconsistencies).                                               |
| `bb9f18a1d00`                               | exiftool-vendored 39                                                                                                     | MEDIUM | Fork time-zone helper reads `zoneSource` only (see Inconsistencies).                                                                         |
| `638cfbca5e0`, `8b3d426f14a`                | pnpm 12, vitest 5                                                                                                        | MEDIUM | Lockfile regenerated from upstream's; fork test setup adjusted.                                                                              |
| `d474ec966bc`                               | mobile JXL decoder (Rust `native_core`)                                                                                  | LOW    | Taken; native codegen and `dart analyze` clean.                                                                                              |
| `e6fdb56bcd0`                               | unsupported locale for date format                                                                                       | LOW    | Propagated to the fork's own `DateFormat` callers.                                                                                           |

The remaining commits are dependency bumps, CI chores and small mobile and web fixes with no fork overlap.

## Conflict resolutions

The replay ran through a gated driver. It auto-resolved only these classes, logging each one:

- generated files (taken from the fork, then regenerated);
- the lockfile (upstream's, then regenerated);
- the replay-owned person files (the fork's version whole);
- fork deletions of files upstream modified.

Two further classes, also logged:

- **Block-level rules**: a known upstream rename applied to the fork side, adjacent edits, import and enum unions, list-entry unions.
- **"Fork file plus upstream's delta"**: a 3-way merge with the old upstream file as base.

Everything else stopped for a hand resolution.

| File                                                                                                                                       | Fork side                                                                | Upstream side                                       | Resolution                                                                                                      | Risk   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| `server/src/services/asset.service.ts` (several stops)                                                                                     | Space people resolution, unassigned faces for viewers                    | shared-link metadata handling moved into `mapAsset` | Upstream's mapper; a metadata-hidden link still returns the stripped response untouched; fork overlay call kept | MEDIUM |
| `server/src/dtos/shared-link.dto.ts`, `shared-link.service.ts`                                                                             | #1018 `redactAssetOwners`                                                | `mapSharedLink(link, { auth })`                     | `{ auth, redactAssetOwners? }`: upstream's signature plus one fork option                                       | MEDIUM |
| `server/src/services/album.service.ts`                                                                                                     | `hasDirectAccess` redaction, space album metadata scope                  | album members hidden from shared-link viewers       | `mapAlbum(album, { auth })`; contributor counts also gated on `!auth.sharedLink`                                | MEDIUM |
| `server/src/services/timeline.service.ts`                                                                                                  | #763: favorites allowed for other users; `withSharedSpaces` checks       | `includesOtherUsers` check rejecting favorites      | Upstream's check and message, minus the favorite condition                                                      | MEDIUM |
| `server/src/repositories/asset.repository.ts`                                                                                              | bucket sizes; shared `withTimeBucketAssetFilters` chain                  | createdAt range for "recently added"                | Range moved into the shared filter stage, sized by bucket                                                       | MEDIUM |
| `server/src/utils/database.ts`                                                                                                             | re-indented legacy builder                                               | `viewingUserId` locked-asset filter                 | Upstream's filter applied at the fork's indentation                                                             | LOW    |
| `server/src/services/download.service.ts`                                                                                                  | disk/S3 archive streaming                                                | edited-only for shared links                        | Fork streaming with upstream's `edited` flag                                                                    | LOW    |
| `server/src/services/queue.service.ts`, `metadata.service.ts`                                                                              | job types; `tzSource` + `zoneSource`                                     | bullmq 6 statistics; exiftool 39                    | Both kept; `zoneSource` only                                                                                    | LOW    |
| `server/src/schema/tables/*.ts`, `database.ts`, `editor.spec.ts`, `enum.ts`                                                                | fork triggers and fields                                                 | asset-face state, passkey permissions and locks     | Unions                                                                                                          | LOW    |
| `mobile/lib/presentation/pages/library.page.dart`                                                                                          | Spaces tile (when supported), Albums tile, public `AlbumsCollectionCard` | quick-access tiles as an item list                  | Rebuilt from the fork's final version with upstream's item list (see Inconsistencies)                           | MEDIUM |
| `mobile/test/widget_tester_extensions.dart`, `app_life_cycle_provider_test.dart`, `person_sliver_app_bar.dart`, `VideoNativeViewer.svelte` | fork refactors                                                           | locale, store service, header image, HLS changes    | Upstream's change applied inside the fork's shape                                                               | LOW    |
| web album page, `album.service.ts`, `AlbumMap.svelte`, `DetailPanel.svelte`, `folders.svelte.spec.ts`                                      | many fork commits                                                        | rewritten onto query modules                        | Deferred during the replay (upstream's shape kept), then ported once from the fork's final versions             | MEDIUM |
| `web/src/lib/stores/user.svelte.ts`                                                                                                        | spaces list cache                                                        | deleted                                             | Kept for the replay, then replaced by `lib/gallery/spaces/space.query.ts` and deleted                           | MEDIUM |
| `CONTRIBUTING.md` (fork sync, #1222)                                                                                                       | owner removed two paragraphs                                             | reworded one of them                                | Fork deletion                                                                                                   | LOW    |

**Replay verification**: after each step, every file's change was compared with upstream's own change. The differences are the resolutions above, generated files, files the fork deletes (`packages/scripts`, two workflows), the CRLF repair below, and the ML `uv.lock` header (`uv lock --check` passes).

## Fork feature verification

| Feature                           | Status | Notes                                                                                                   |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Shared Spaces                     | OK     | Access oracle 193 passed (3 new passkey entries, each `{}`); RBAC oracle 13 passed, snapshot unchanged. |
| Per-user favorites (#763)         | OK     | Partner timeline allows favorites; favorite grep gate passes.                                           |
| Shared links from a Space (#1018) | OK     | Owner redaction kept on the new `mapSharedLink` signature.                                              |
| Storage (disk + S3)               | OK     | Archive streaming kept; unit suites pass.                                                               |
| Pet detection and recognition     | OK     | Pet coordinator moved off bullmq's `paused`; ML pytest 240 passed.                                      |
| Image editing, trims, adjust      | OK     | No overlap; migration ledger spec passes.                                                               |
| Branding                          | OK     | No branding gap in the merged i18n bundle; spinner list follows upstream's `OAuthSettings` rename.      |
| Google Photos import              | OK     | Moved onto upstream's `createAlbumMutation`.                                                            |

## Database migration analysis

| Timestamp     | Migration              | Tables                                       | Risk | Notes                                                                   |
| ------------- | ---------------------- | -------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| 1792213725597 | AddAssetFaceAssetState | `asset_face`, `asset` triggers               | LOW  | Already on main via v3.3.5; shipped in the v3.3.5 tag.                  |
| 1792511451454 | AddPasskeyTable        | new `passkey`, `auth_challenge`              | LOW  | Additive; reversed in the revert script (step 7) and deleted in step 8. |
| 1792517020180 | AddUpdateIdIndexes     | indexes on `stack`, `asset_face`, `workflow` | LOW  | Additive; reversed in the revert script.                                |

- No timestamp collisions; no `renamedMigrations` entries needed; no listed upstream key is dropped or rebuilt.
- `migrations:run` on a fresh database applies everything, and `migrations:generate` reports no changes.
- `database-migration.service.spec.ts`: 14 passed.

**Mobile Drift**: upstream made no schema change (only `await` on the connection pool's `close()`). `schemaVersion` stays 42; `make-migrations` regenerates byte-identical snapshots.

## Layering

- **Fork diff over upstream-owned files** (excluding lockfiles, generated files and snapshots): net **−15 lines**.
  - Grew: `person.repository.spec.ts` (+167, Option A keeps the fork's tests rather than upstream's rewritten ones); `album.query.ts` (+28, the `notifyAddToAlbum` hook); `timeline.service.spec.ts` (+28); `asset.repository.ts` (+18, bucket-sized range); `person.service.ts` (+16, the lock); the nine jest-dom spec files (comment removals).
  - Shrank: `album.service.ts` (−131), `user.svelte.ts` (deleted, −54), `AlbumMap.svelte` (−46), `person.repository.ts` (−38), the album page (−29), `library.page.dart` (−17).
- `i18n/*.json` are identical to upstream; `merge.mjs --check` passes.
- Access and RBAC oracles: unchanged apart from the three passkey entries.

## Pattern propagation

| Refactor                      | Old → new                                                             | Fork files                                                                                                          | Decision     | Commit                                                                           |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Album queries (immich-32668)  | `album.service` helpers, events → `album.query` mutations and queries | album page, Space album page, AlbumMap, DetailPanel, collection service, cmdk, Takeout import, Space album creation | Bundled      | `refactor(web): move the fork's album code onto upstream's album queries`        |
| Recent albums store → queries | `stores/user.svelte.ts` → query modules                               | sidebar recent spaces, People pages, person service                                                                 | Bundled      | `refactor(web): read the spaces list and a space's albums through query modules` |
| Config queries (immich-32498) | `serverConfigManager`, `system-config.query` → `config-*` queries     | FeatureSettings, memories/storage settings, map page                                                                | Bundled      | `refactor(web): read the fork's config values through upstream's config queries` |
| Spaces data layer             | direct SDK calls in loaders and pages                                 | space layout, members, people, activity, libraries, album folders (~7600 lines)                                     | **Deferred** | Follow-up                                                                        |

### Follow-up work

- Move the rest of the Spaces web data layer (space layout loader, members, people, activity, libraries, album folders) onto query modules. Upstream's refactor did not touch these pages, so they keep working as they are.

## Inconsistencies found

- **CRLF lost on `mobile/lib/main.dart`**: the resolver read files in text mode. It was repaired across the 1418 affected commits, with no whole-file churn left in history, and the resolver now preserves line endings.
- **Pre-existing conflict marker** in an old replayed fork commit (#379, `QueuePanel.svelte`): dropped during the replay.
- **bullmq 6 (Shape H/S)**: only fork code used the `paused` state and `Queue.client`. `JobRepository`, `QueueMaintenanceRepository`, `FaceIdentityMaintenanceService` and the recognition coordinators now treat a paused queue's jobs as waiting. A stable shared-space job is replaced when it is waiting in a paused queue.
- **exiftool-vendored 39 (Shape H)**: it sets `zoneSource` alongside `tzSource`, and upstream now clears only `zoneSource` for sidecar dates. The fork helper's `zoneSource ?? tzSource` would have applied the server zone to a sidecar date. Fixed and covered.
- **`library.page.dart`**: replay resolutions broke the file and dropped the `showSpaces` gate and the public `AlbumsCollectionCard`. Rebuilt; `dart analyze` and the library widget test pass.
- **Upstream case rename** `OauthSettings` → `OAuthSettings`: the preflight spinner list still named the old file (works on macOS, fails on Linux). Fixed.
- **Space album page cache**: the album query client outlives a page, so a cached copy from an earlier visit could overwrite the freshly loaded album. The page now seeds the query with the loaded album.
- **vitest 5**: the fork's `jest-dom/vitest` import types matchers program-wide, which left upstream's 45 "pending a type fix" `@ts-expect-error` comments unused. 3375 fork assertions rely on that typing, so the comments are removed.
- **Commit autolink**: a carried release cherry-pick (`fix(ml): incorrect outputs on alchemist and battlemage`) referenced `#32148`/`#32110`; reworded to `immich-…`.

## Local CI verification

| Check                                                                                                 | Status | Notes                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `server pnpm build`, `tsc`, `pnpm lint`                                                               | PASS   |                                                                        |
| Server unit tests                                                                                     | PASS   | 6881 passed                                                            |
| Server medium (timeline, access oracle, RBAC oracle, migration ledger)                                | PASS   | 48 / 193 / 13 / 14                                                     |
| `web check:typescript`, `check:svelte`                                                                | PASS   | 658 files, 0 errors                                                    |
| Web eslint on changed files (`tscompat` off)                                                          | PASS   |                                                                        |
| Web unit tests                                                                                        | PASS   | 6681 passed                                                            |
| e2e `tsc`                                                                                             | PASS   |                                                                        |
| Mobile codegen, `dart analyze --fatal-infos`, `dart format`                                           | PASS   | Flutter 3.47.2                                                         |
| Mobile tests                                                                                          | PASS   | the three overview-card locale tests fixed                             |
| ML ruff format, ruff check, mypy `--strict`, pytest                                                   | PASS   | 240 passed, 5 skipped                                                  |
| OpenAPI and SQL regeneration                                                                          | PASS   | spec removals identical to before; only the passkey access query added |
| Preflight suite, post-rebase audit, fork patches, CI invariants, Drift check, autolinks, i18n overlay | PASS   |                                                                        |
| Revert coverage + `revert-to-immich.spec.ts`                                                          | PASS   |                                                                        |

## Remote CI verification

| Workflow                            | Run         | Commit        | Notes                                                     |
| ----------------------------------- | ----------- | ------------- | --------------------------------------------------------- |
| Test                                | 40099000792 | `7d568e00985` | green after the fixes below                               |
| Static Code Analysis                | 40090801392 | `1c910524acc` |                                                           |
| Docker                              | 40090803582 | `1c910524acc` |                                                           |
| Gallery Build Mobile                | 40090814701 | `1c910524acc` |                                                           |
| Gallery Rebase Smoke                | 40090816746 | `1c910524acc` |                                                           |
| Storage Migration Tests             | 40090818855 | `1c910524acc` |                                                           |
| Storage Migration E2E               | 40090820823 | `1c910524acc` |                                                           |
| Gallery ML Smoke                    | 40090822720 | `1c910524acc` |                                                           |
| Gallery Mobile Smoke                | 40090824532 | `1c910524acc` |                                                           |
| Release Candidate Build             | 40090797379 | `1c910524acc` | `gallery-server:rolling-v34-rc2`                          |
| Gallery Revert-to-Immich Validation | 40091927421 | `5110d564057` | RC image above, stock `immich-server:commit-cf719e733e6…` |

After `1c910524acc` only tests, the revert workflow and one comment line changed, so the runs on it still
cover the shipped tree.

What the first Test run found, and the fixes:

- **Revert gate on a branch past the last Immich tag.** The gate booted stock Immich at the
  `upstream.version` tag (3.3.5), which refuses a database carrying upstream's passkey migration.
  The last cycle's run passed only because it tested `main`'s image. The workflow now takes an
  optional `upstream_image` input; this run booted upstream's image for `cf719e733e6` and passed
  every step (stock round trip, revert, no schema drift, data read back).
- **Medium `face-repair.resolve` F12 timeout, on two runs.** Upstream's `AddUpdateIdIndexes`
  (immich-32432) creates an index on the empty `asset_face`, so the medium template now records it
  as known-empty (`reltuples = 0`). A flagged-face plan cached on a pooled connection by an earlier
  test kept assuming an empty table and scanned it once per face: about 4 s per resolve locally and
  past the 30 s timeout on CI. Found by dumping `pg_stat_activity` and the plans from CI. The bulk
  seed now runs `ANALYZE`, as autovacuum would. Production tables are analyzed, so this only affects
  tests, but any other medium test that bulk-seeds `asset_face` after smaller tests can hit it.
- **Fork tests behind upstream changes**: `mapAsset` lost `stripMetadata`; `withPartners` without a
  visibility now defaults to the timeline (immich-32565) rather than returning 400; the client header
  spec mocked `serverConfigManager`, which upstream's `init()` no longer reads. Plus two lint/format
  findings in resolved files.
- **ML training flake.** `test_identity_projection_scores_exactly_like_zeroshot` compared metrics for
  exact equality on near-tied synthetic scores and failed once (AUC 0.354 vs 0.333) on a tree that
  had passed twice. It now checks the projected scores directly and the metrics with a tolerance.
  The test is unchanged from `main`, which has the same flake.
- **Local gaps**: `pnpm build` skips specs (use `pnpm check`), and the changed-files web lint missed
  `asset.service.spec.ts`.

## Before landing on a v3.4 tag

- Validate the pet models under ML v2 (still the landing blocker).
- Bump the base to the v3.4 tag, and drop the carried v3.3 version commits and release cherry-picks.
- Move the rest of the Spaces data layer onto query modules (follow-up above).
- Port the ML training test fix to `main` (same flake there).
