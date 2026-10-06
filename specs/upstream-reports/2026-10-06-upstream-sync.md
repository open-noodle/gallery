# Upstream Sync Report — 2026-10-06

## Summary

- **Upstream ref**: `upstream/release/v3.3`, `d15972e7223` → `d1c1a65ed3b` (past `v3.3.0-rc.2`, no rc.3 tag yet)
- **Upstream commits pulled**: 8 (batches 82–84 of the regenerated plan)
- **Conflicts resolved**: 8 stops across the replay (6 in batch 83, 2 in batch 84), all inside a pre-declared file set
- **Fork sync**: `da5480ae42b` → `f047d921872` (`origin/main` tip): #992, #819, #1156, #1159. Requested after the
  upstream batches landed; see "Fork sync" below. `sync-fork-main` threw on #992 and on #1156, so all four were
  finished by hand and `integratedForkHead` / `appendHistory` were reconciled manually.
- **Risk level**: LOW (upstream) / MEDIUM (fork sync: two large features replayed onto rolling's vocabulary)
- **Recommendation**: PROCEED (stays off `main`; v3.3.0 is still an RC)
- **Backup**: local branch `backup/rolling-pre-2026-10-06` (`a40462cff98`); before the fork sync `backup/rolling-pre-forksync-2026-10-06`
  (`54d76b5c758`) and `backup/rolling-pre-forksync2-2026-10-06` (`0586bf047b3`)

## Incoming Upstream Changes

| SHA           | Summary                                                        | Area       | Risk to Fork | Outcome                                                                   |
| ------------- | -------------------------------------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------- |
| `34bec012325` | fix: stale memory cover (#32101)                               | web        | LOW          | Taken as-is (thumbhash cache key on the memories page)                    |
| `17e4cfd96b8` | fix(web): no trash actions when trash is empty (#32104)        | web        | LOW          | Taken; trash page conflict resolved to fork version + upstream's one line |
| `bf04a9fc35f` | fix: bounding box label clipping (#32107)                      | web        | LOW          | Taken as-is; block byte-identical to upstream's                           |
| `983177d5700` | fix: strip workflow step ids from user-facing actions (#32106) | web        | LOW          | Taken as-is                                                               |
| `81de979a35f` | fix: people page search (#32108)                               | server/web | MEDIUM       | **Declined fork-side** (see below)                                        |
| `07b54cf9b4c` | fix(web): album reactivity (#32111)                            | web        | MEDIUM       | `TimelineManager` + `TimelineAssetViewer` taken; album page stays fork's  |
| `06c397add1b` | docs: add QNAP install guide (#32105)                          | docs       | LOW          | Taken, then rebranded like the rest of the install guides (#167)          |
| `d1c1a65ed3b` | fix: select hidden people (#32116)                             | web        | LOW          | Modify/delete on `PersonBulkShareModal.svelte` → kept deleted (`git rm`)  |

### immich-32108 — declined (Pierre's call at Checkpoint 1)

Upstream adds a `name` filter to `GET /people` (`f_unaccent(name) %> f_unaccent($name)` under a
`pg_trgm.word_similarity_threshold` CTE) and rewrites its People page to search through it. Gallery's
`getAllForUser` is its own query (person sharing stays dormant, `withFilters` is not on that path) and
Gallery's People page already searches through `GET /search/person`. So:

- `person.repository.ts`, `person.repository.sql`, `people/+page.svelte`, `people/+page.ts`, `fetch-client.ts`
  were resolved to the replayed fork commit's version at every stop;
- fork commit `fix(people): decline immich-32108's GET /people name filter` drops the residue that merged
  cleanly (`PersonSearchDto.name`, the OpenAPI parameter, `PeopleFilter.name`). Leaving the DTO field alone
  would have made the API accept a filter it never applies, i.e. answer with more people than asked for.

End state: `server/`, `open-api/`, `packages/` trees are byte-identical to the pre-cycle tip.

### immich-32111 — partial

Upstream moves "remove assets from the open album's timeline" out of `TimelineAssetViewer` (which used to
key on its `album` prop) into a `TimelineManager` `AlbumRemoveAssets` handler gated on `#options.albumId`.
Checked against the Shape J pattern (a guard enumerating option names): the only surfaces that pass `album`
to `<Timeline>` are `AlbumViewer` and the album page, and both build options with `albumId`. Space album
pages pass no `album` prop and remove assets themselves (`timelineManager?.removeAssets` at three sites),
so they lose nothing.

The album-page half (`$derived(data.album)`, `refreshAlbum` → `invalidate('album:data')`,
`onAssetsDelete`) was **not** ported. The fork's page already re-syncs `album` from `data.album` when the
route changes, and its `handleRemoveAssets` also prunes the filter-panel search results, which upstream's
manager handler cannot see. A double removal from the timeline (manager handler + fork handler) is
idempotent.

## Conflict Resolutions

| Stop (replayed fork commit)                                     | File                               | Resolution                                                             | Risk |
| --------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ---- |
| `feat: unify people management for spaces (#450)`               | `people/+page.svelte`              | replayed fork version (decline 32108)                                  | LOW  |
| `feat: add global face identities across spaces (#495)`         | `people/+page.ts`                  | replayed fork version (decline 32108)                                  | LOW  |
| `feat: scale face identity backfill … (#542)`                   | `person.repository.ts`             | replayed fork version (decline 32108)                                  | LOW  |
| `feat: add timeline grouping display modes (#625)`              | `trash/…/+page.svelte`             | fork version + `getTrashActions($t, timelineManager?.assetCount ?? 0)` | LOW  |
| `chore(rebase): regen OpenAPI clients … (batch 232)`            | `packages/sdk/src/fetch-client.ts` | replayed fork version (decline 32108)                                  | LOW  |
| `chore(sql): regenerate person.repository.sql …`                | `person.repository.sql`            | replayed fork version (decline 32108)                                  | LOW  |
| `feat: add album detail filter panel (#414)`                    | `albums/[albumId]/…/+page.svelte`  | replayed fork version (see 32111)                                      | LOW  |
| `fix(rebase): keep person sharing dormant through immich-31960` | `PersonBulkShareModal.svelte`      | kept deleted (`git rm`)                                                | LOW  |

A resolver script handled the stops. It refused any file outside the declared set, asserted a single anchor
for the trash edit and no conflict markers before each `git add`, and checked for a stalled
`rebase --continue`.

## Whole-tree audit

`git diff a40462cff98..HEAD --name-status` lists only: `docs/docs/install/qnap.md` (A) plus seven web files,
each matching upstream's own delta (`PhotoViewer`, `TimelineAssetViewer`, `timeline-manager`,
`trash.service`, trash page, memories page, workflow page). Tree identity against the last 10/10-green tip:
only `web/` and `docs/` changed. The zero-byte files (`CODEOWNERS`, `docs/static/.nojekyll`,
`docs/static/CNAME`) were already empty before this cycle.

## Fork Feature Verification

| Feature                    | Status | Notes                                                                  |
| -------------------------- | ------ | ---------------------------------------------------------------------- |
| Person sharing (dormant)   | OK     | Bulk share modal stays deleted; `GET /people` unchanged                |
| People page / Space people | OK     | Fork page and repository untouched                                     |
| Space albums               | OK     | Remove paths unaffected by the `albumId`-only manager guard            |
| Album filter panel         | OK     | Fork album page kept; search-result pruning intact                     |
| Branding                   | OK     | `qnap.md` rebranded (product name, download links, example data path)  |
| Everything else            | OK     | `server/ mobile/ machine-learning/ e2e/ .github/ i18n/` byte-identical |

## Database / Mobile Drift Migrations

None incoming. Server and mobile trees unchanged.

## Local CI Verification

| Check                                                                          | Status | Notes                                                                                                |
| ------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| `upstream-postrebase-audit` BATCH=82/83/84                                     | PASS   | 83's "Generated Artifact Review" flags files restored to the fork version (byte-identical to backup) |
| `ci-invariants-check` / `fork-patches-check` / `fork-ownership-coverage-check` | PASS   |                                                                                                      |
| `commit-autolink-check`                                                        | PASS   | 1612 messages                                                                                        |
| web `check:typescript` / `check:svelte`                                        | PASS   | 630 files, 0 problems                                                                                |
| web eslint (`tscompat` off) + prettier on changed files                        | PASS   |                                                                                                      |
| web unit tests                                                                 | PASS   | 6414 passed                                                                                          |
| docs prettier (`qnap.md`)                                                      | PASS   |                                                                                                      |
| server / mobile / ML / e2e gates                                               | N/A    | trees byte-identical to the 10/10-green `a40462cff98`                                                |

## Fork sync

| Fork PR                                        | Rolling commit | Stops   | Notes                                                                                                                                 |
| ---------------------------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| #992 space editors edit members' assets (#734) | `a30ec455390`  | 7 files | hand-resolved, see below                                                                                                              |
| #819 per-user favorites (#763)                 | `0586bf047b3`  | 8 files | hand-resolved, see below                                                                                                              |
| #1156 one face-assignment module               | `ffb8e599064`  | 1 file  | `face-suggestion.service.ts`: took #1156's `getSettledFaceIds`; rolling's side differed from base only by `isDisjointFrom` (asserted) |
| #1159 S3 backend owns its proxy read slot      | `87a9b2a57ef`  | 0       | clean; per-file numstat identical to `main`                                                                                           |

### #992 on rolling

- **Tag**: `TagAction.svelte` stays deleted (immich-31976 turned it into the bulk `Tag` ActionItem).
  `getAssetBulkActions` takes a new `editableSelectedAssetIds` option, which `SelectionToolbar` passes; with it, Tag sends
  only the editable subset (skipped-count toast, no modal for an empty subset); without it, upstream's all-owned
  behaviour stands. #992's `TagAction.spec.ts` is ported to `asset.service.spec.ts` — red against the pre-port action
  (2 of 3), green after.
- **Rating**: the navbar `RatingAction` is gone (immich-31804); the `isEditable()` gate moves onto the `Rate` ActionItem.
  #992's `W-rating` tests now fire on `document.body` with `commandPaletteManager.enable()` (the dispatcher the app enables
  in `+layout.ts`) and wait for the async handler; the negative case was proved red with the gate removed.
- **Server**: `update()` / `updateAll()` keep upstream's `on_asset_update` websocket sends beside the cross-owner logging.
- **Toolchain drift** (newer unicorn rules on rolling): `face-box-drag.ts` (`prefer-continue`),
  `shared-space.service.ts` (`prefer-early-return`); `detail-panel.spec.ts`'s person fixture gains the dormant sharing arrays.
- Fork migration `1796000000000-AddAssetFaceCreatedBy` arrives with its ORDER and revert-script entries.

### #819 on rolling

- `searchLargeAssets` keeps upstream's Hidden-visibility filter beside the per-caller `isFavoriteForUser` select;
  the generated SQL takes the renumbered `$6`.
- Web `asset.service` keeps `updateAsset` (the Rate action uses it) next to `updateAssetFavorites`; the three new favorite
  tests use rolling's `onAction({ action, event })` signature.
- `#7703` in the squashed message (upstream's e2e refactor) rewritten to `immich-7703`.
- **Dropped-column sweep**: no rolling-only upstream code, migration or generated query still reads `asset.isFavorite`;
  remaining hits are `person."isFavorite"` or #819's own overlay handling. Migrations `1794000000000` /
  `1794100000000` apply cleanly on a fresh DB after every upstream migration.

### #1156 on rolling

The rolling-only dormant-sharing pin `refuses to reassign faces onto another owner's row` probed `person.reassignFace`,
which the new `FaceAssignmentService.assignFaces` path never calls. The guard itself (`assertOwnRecord`) is intact; the
probe now asserts `assignFaces` is not called on the 400 and is called with the face on the caller's own request.

### Verification after the fork sync

| Check                                                                         | Status | Notes                                                                                                         |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| server `pnpm build` / `pnpm check`                                            | PASS   | 70 Gallery migrations synced                                                                                  |
| OpenAPI spec + TS SDK regenerated                                             | PASS   | byte-identical to the merged files                                                                            |
| SQL: fresh DB `migrations:run`, `migrations:generate`, `mise //:sql`          | PASS   | no schema drift; 42 query files rewritten byte-identical (twice: after #819 and after #1159)                  |
| server eslint + prettier (all touched files)                                  | PASS   | after the two unicorn fixes                                                                                   |
| server unit                                                                   | PASS   | 6590 passed, two consecutive full runs                                                                        |
| server medium (40 touched specs)                                              | PASS   | 1538 passed; one failure was a stale local plugin-core wasm (pre-immich-32027), green after `mise //:plugins` |
| web tsc / svelte-check / eslint / unit                                        | PASS   | 643 files 0 problems; 6548 passed                                                                             |
| e2e `pnpm check` + eslint + prettier                                          | PASS   |                                                                                                               |
| mobile codegen + `dart analyze --fatal-infos` + format + `flutter test`       | PASS   | Flutter 3.47.2; 4057 passed                                                                                   |
| revert-to-immich coverage + `IN`-list comma audit                             | PASS   |                                                                                                               |
| invariants / fork patches / ownership / autolink / branding / preflight (301) | PASS   |                                                                                                               |

Local server unit runs before the final two hit the known supertest socket family (`ECONNRESET` / `socket hang up`, a
different untouched controller spec each run). A control on the pre-sync tree (`54d76b5c758`, CI-green) failed 2 of 3
runs the same way at load average ~30, so it is pre-existing and load-driven, not introduced here.

## Remote CI Verification

**Round 1 — `54d76b5c758` (upstream batches only)**: 7/10 green (Test, Static Code Analysis, Rebase Smoke, ML Smoke,
Mobile Smoke, Storage Migration Tests, Storage Migration E2E). Three red, none from this cycle's code:

- **Revert-to-Immich Validation** — the Docker-boot half runs against the released `:main` image, which now carries #819's
  `1794000000000-AddAssetFavoriteTables`; the branch's revert script did not yet know it. Fixed by the fork sync.
- **Gallery Build Mobile** — `build_runner` crashed restoring `mobile/.dart_tool` from the fixed `build-mobile-gradle-*-main`
  cache, saved on `main` after #992 added `asset_editable_dto.dart`; the branch lacked that output
  ("Tried to delete from package not in the build"). Resolved for this branch by the fork sync; the cache key is a
  follow-up (below).
- **Docker** — `mise` inside the plugins stage hit the unauthenticated GitHub API rate limit verifying the
  `extism/js-pdk` attestation (403). Infrastructure; other branches' Docker runs on the same image were green.

**Round 2 — fork-synced tip**: see the follow-up commit on this branch.

## Follow-ups

- `gallery-build-mobile.yml` caches `mobile/.dart_tool` (build_runner incremental state) under a fixed `-main` key: any
  branch whose generated OpenAPI set lacks a model `main` has crashes in codegen. Exclude `mobile/.dart_tool/build` or key
  it on the spec hash.
- `person.service.spec.ts` (also on `main`): five face-detection tests still assert
  `expect(mocks.person.reassignFace).not.toHaveBeenCalled()`, which no longer guards anything after #1156.
- #819's squashed commit on `main` cites `#7703` (an immich PR); rewritten on rolling only.
- Optional: port 32111's `invalidate('album:data')` refresh model onto the fork album page.
