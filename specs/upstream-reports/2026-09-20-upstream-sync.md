# Upstream Sync Report — 2026-09-20

## Summary

- **Cycle**: rolling, targeting the next upstream release (expected **v3.3.0** — no tag exists yet)
- **Branch**: `rebase/upstream-rolling-v3.3.0`, cut from `origin/main` (`c566f2766cc`)
- **Upstream base**: `ca4637adc79` → **`202015ed95d`**
- **Upstream commits pulled**: **40**, in 17 batches
- **Conflicts resolved**: ~45 regions across 26 files
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — routine cycle, stays off `main` (no upstream tag yet)
- **CI**: 6/6 workflows GREEN, `Test` 22/22 jobs with 0 skipped

The previous cycle (v3.2.1) landed on `main` on 2026-09-16, and the old rolling branch was
byte-identical to `origin/main`, so this is a clean restart rather than a continuation.

**Character of the cycle: mobile-heavy.** 19 of the 40 commits are mobile-only, and they land on
the fork's most-diverged mobile surface — the Person/people layer, which `CLAUDE.md` documents with
six standing divergences. Every genuinely hard reconciliation this cycle was in that area.

## Incoming Upstream Changes

| SHA                          | Summary                                         | Area        | Risk     | Notes                                                          |
| ---------------------------- | ----------------------------------------------- | ----------- | -------- | -------------------------------------------------------------- |
| `54e7ffa4e67`                | feat: asset face v3                             | server, sdk | **HIGH** | Sync contract + faces. Product gate fired — see below.         |
| `efbbd32e550`                | feat(mobile): asset face v3                     | mobile      | **HIGH** | Drift **v33** collides with the fork's shipped v33.            |
| `c5cdbef26f5`                | refactor: remove assets from album action       | web         | **HIGH** | Deletes a component the fork extends. Product gate fired.      |
| `909b8aac933`                | clamp out-of-range datetimes                    | mobile      | **HIGH** | Drift **v34** collides; deprecates `Table.dateTime()`.         |
| `962ffaacc12`                | stack edited photos over the original on upload | mobile      | **HIGH** | Drift **v32** collides; widens `BackgroundUploadService` deps. |
| `241ca1e2a29`                | make Person Store reactive via Drift            | mobile      | **HIGH** | Rewrites the DAO the fork's #727/#737 build on.                |
| `99fd5611444`                | transition to nullable `user.oauthId`           | server      | MEDIUM   | New migration; needs a `revert-to-immich.sql` entry.           |
| `ab5a9ae48c0`                | drop tsc-alias                                  | server      | MEDIUM   | Partially reverses the fork's ESM work.                        |
| `e35aa718d9e`                | skip faces of other users when reassigning      | server      | MEDIUM   | Upstream's original of the fork's backport.                    |
| `9e0362dca09`                | base-image → `202609151314`                     | server      | MEDIUM   | Shape H check — see below.                                     |
| `64de38092e1`                | centralize mesmerizing header components        | mobile      | MEDIUM   | Drops `MesmerizingSliverAppBar`'s `icon:` parameter.           |
| `bd59a373dec`                | make EXIF provider reactive                     | mobile      | MEDIUM   | Removes `getExif`/`byId`.                                      |
| `32b2cdba61a`, `bc1d6a6acc7` | web styling refactors                           | web         | LOW      | Migrating `pl-`/`pr-` → `ps-`/`pe-`.                           |
| 26 others                    | dep bumps, docs, small web/mobile fixes         | mixed       | LOW      | No fork interaction.                                           |

## Product-Direction Gate

The gate fired on two commits. Both were put to the maintainer before the affected batch was rebased.

### 1. Asset face v3 (`54e7ffa4e67` + `efbbd32e550`) — **PULLED**

V3 replaces `where asset.ownerId = :me` with `where owner.clusterGroupId = (my clusterGroupId)`.
Gallery adopted upstream's cluster groups **inertly** (Option M — `ClusterGroupController` unmounted,
`person_personGroupId_key` forcing person↔personGroup 1:1), so every cluster group is a singleton and
**V3 is behaviourally identical to V2 here**. Unlike Search V3 this is not a dormant path that can be
declined: upstream deprecates V2 and mobile switches to V3 behind a server-capability flag.

Decision: pull as upstream ships it. Verified after the replay: `AssetFacesV3`/`AssetFaceV3` present
in `enum.ts`, `getUpsertsV3`/`getDeletesV3` in `sync.repository.ts`, `syncAssetFacesV3` dispatched in
`sync.service.ts`; the unique index and the unmounted controller both still in place, and
`ci-invariants-check`'s `people-merge-inert` green.

### 2. Remove-from-album action (`c5cdbef26f5`) — **RETAINED, port deferred**

Upstream deletes `web/src/lib/components/timeline/actions/RemoveFromAlbumAction.svelte` and folds the
logic into `asset.service.ts` as an `ActionItem`. The fork extends that component (#752 per-asset
partial-removal toasts, a Playwright testid), tests it, and renders it from `SelectionToolbar` gated by
a fork-specific `canRemoveFromAlbum` capability — not upstream's menu predicate.

The port was initially chosen, then re-scoped once the full surface was measured (a fork-only Space
album page, a test wrapper, a unit spec and an e2e testid). Decision: **retain the component this
cycle** and port it in a follow-up PR with its own review.

No duplication resulted: upstream's `ActionMenuItem` renders on the album page and the asset-viewer
nav bar; the fork's component renders only from `SelectionToolbar`, which the upstream album page does
not use.

## Conflict Resolutions

### `mobile/lib/data/db/main/database.dart` (~10 regions)

**Fork's migration chain is authoritative.** The first attempt took HEAD and produced **duplicate
`fromXToY` named arguments** — which do not compile in Dart — because the fork's shared-space steps and
upstream's steps occupy the same numbers. Backed out and redone: take the fork's side, then re-add
upstream's colliding steps on top as v39/v40/v41.

### Drift migration collisions (three)

The rolling base had upstream at v31; the fork owns **v32–v38**; upstream added **v32, v33, v34**.

`schemaVersion => 38` shipped in the Release Mobile runs of 2026-09-10 and 2026-09-16, so the fork's
numbering cannot move. Upstream's three were renumbered on top:

| Upstream | Renumbered | What it does                           |
| -------- | ---------- | -------------------------------------- |
| v32      | **v39**    | `local_asset.previous_checksum` column |
| v33      | **v40**    | `asset_face` FK removal                |
| v34      | **v41**    | `_healV33DateTimes` data heal          |

Snapshots generated for all three; `drift_dev make-migrations` is a no-op afterwards, and the full
1→41 chain passes (825 drift migration tests).

### Other notable resolutions

- **`packages/scripts/package.json`** — modify/delete. The fork's deletion wins (its own
  `fork-deletions.spec.ts` rule); the lockfile importer block was removed with it.
- **`@immich/ui` patch lockfile region** (twice) — merged upstream's `@types/node` 24.13.4 with the
  fork's `patch_hash`, proven by construction (theirs-minus-patch equals base).
- **`tab_shell.page.dart`** — upstream made `localAlbumProvider` reactive and deleted the Library-tab
  block; the fork's server-backed people invalidation lives inside it, so the block survives minus
  upstream's line. End state is `ref.invalidateServerPeopleLists()`.
- **`DetailPanelDescription.svelte`** — textbook Shape K: the region aligned asymmetrically, so the
  fork's copy of the block sat in the shared tail still carrying `pl-0`. Took theirs, then re-applied
  upstream's `pl-0`→`ps-0` that would otherwise have vanished silently.
- **`getAssetBulkActions` / `getAssetActions`** — both sides widened the signature (upstream a
  positional `album`, the fork an options bag). Merged into a single options bag; the one positional
  call site updated.
- **Branded docs and `README_zh_CN`** — the fork's branding kept, upstream's new `ComposeBuilder`
  import and its `atl=`→`alt=` typo fix applied on top.
- **`server/package.json` / `mise.toml` / `nest-cli.json`** — took upstream's `tsc-alias` removal while
  keeping the fork's `postbuild` migration-sync step.

### The fork's v3.2.2 backport

`09b5a13c651` (backport of immich-31580) reduced to **spec-only** during the replay: git recognised the
production hunk as already applied once upstream's `e35aa718d9e` arrived, leaving the fork's 52-line
`person.service.spec.ts` addition. That is the intended outcome. The commit's message now describes a
change it no longer makes; left as-is rather than rewriting 156 commits of replayed history.

## Zero-Conflict Semantic Breaks Found

These are the breaks that merged cleanly and would have shipped silently.

| What                                                                                                                                                 | How it surfaced                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `_BackupIndicator` → `backupProvider` → `BackgroundUploadService` now resolves `ApiService` (immich-31082), breaking a fork-only app-bar layout test | `flutter test`. Confirmed cycle-caused: the widget, provider and test are byte-identical to `origin/main`. |
| `setupSyncMocks` enumerates method names by hand; immich-31591's rename left the fork's V2 test stubbing names the service no longer calls           | Server unit suite. Invisible to `tsc` — the mock is untyped.                                               |
| Fork's seven Drift tables left on the deprecated `Table.dateTime()` after upstream converted its own                                                 | `dart analyze --fatal-infos`. The same latent crash upstream fixed.                                        |
| Orphaned `album.provider` import in `tab_shell.page.dart` after upstream's block deletion                                                            | Static Code Analysis on the batch-09 push — **not** locally.                                               |
| Stale generated `codegen_loader.g.dart` rendering `reset_sqlite_error_hint` as its raw key                                                           | Upstream's new widget test. Cost the most time of anything this cycle.                                     |
| Fork's `MemoryService` takes the API repository too (#997), so upstream's new test resolved `ApiService`                                             | Same test.                                                                                                 |

### Detectors run

| Detector                                                     | Result                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Shape I — upstream adds a path fork history touched          | Only the three drift snapshots (the known collision).       |
| Shape I — rename onto a fork-touched path                    | None.                                                       |
| Shape I — retired directories still empty (`mobile/openapi`) | Clean.                                                      |
| Shape S — deleted members the fork still calls               | 9 triage hits, all resolved during the replay.              |
| Silent-noop literal (branding `sed` anchors)                 | Clean, **proven able to fire** with a seeded probe.         |
| i18n branding-override gap                                   | Clean — no new upstream string names the upstream product.  |
| Zero-byte tracked files                                      | 15, **byte-identical to `origin/main`** — all pre-existing. |
| Stranded conflict markers                                    | Clean at the tip.                                           |
| `make commit-autolink-check`                                 | OK — 1535 messages scanned, no cross-repo autolink.         |

### Shape H — base-image bump

`docker run` on both digests rather than reasoning about it:

|                      | `202608300913` | `202609151314` |
| -------------------- | -------------- | -------------- |
| Debian               | trixie         | trixie         |
| node                 | 24.18.1        | 24.21.0        |
| npm                  | 11.16.0        | 11.19.0        |
| `binaryen` candidate | 120-4          | 120-4          |

`binaryen` is what the fork's plugins stage installs in place of upstream's `mise install --locked`;
it is unchanged and still installable. No fork exposure.

## Database Migration Analysis

### New upstream migrations

| Timestamp     | Name                                | Tables | Risk   | Notes                                            |
| ------------- | ----------------------------------- | ------ | ------ | ------------------------------------------------ |
| 1789419229196 | ConvertUserOAuthIdEmptyStringToNull | `user` | MEDIUM | Post-tag; needed a `revert-to-immich.sql` entry. |

No timestamp collisions with the 67 Gallery migrations. `postbuild` intact — the build reports
"Synced 67 Gallery migrations … wrote 2 compatibility aliases", both of which remain load-bearing on
already-deployed databases.

### `revert-to-immich.sql`

`upstream.version` is 3.2.2 and the branch now sits ahead of it, so the previously-empty post-tag group
gained its first entry. Step 8 takes the `kysely_migrations` row (the load-bearing half); step 7 takes
an idempotent schema rollback, written so it is also safe against the tagged `:main` image where the
migration never ran. The coverage detector (the CI gate's own logic) reports no `MISSING` entries.

## Pattern Propagation

| Refactor                           | Old → New                                                                       | Fork files                                                                            | Decision                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| immich-30490 clamping datetime     | `dateTime()` → `customType(clampedDateTime)`                                    | 7 tables, 13 columns                                                                  | **Bundled** — it was an analyzer error and a real latent crash. Fork tables also added to the v41 heal map. |
| immich-31661 reactive people DAO   | `get`/`getAssetPeople`/`watch` → `watchPerson`/`watchPeopleForAsset`/`watchAll` | DAO, service, store, 3 tests                                                          | **Bundled** — names adopted; the fork's `sortBy` kept on `watchAll`.                                        |
| immich-31269/31550 logical padding | `pl-`/`pr-` → `ps-`/`pe-`                                                       | `SpaceLinkLibraryModal`, `SpaceLinkAlbumModal`, `space-activity-feed`, `spaces-table` | **Deferred** — cosmetic/RTL only, no gate fails.                                                            |

### Follow-up work

1. **Port `RemoveFromAlbumAction` onto `asset.service.ts`** — move the removal logic (with #752's
   per-asset partial-removal toasts) into the service, delete the component, and rewire the Space album
   page and its two specs, preserving the `canRemoveFromAlbum` gating and the Playwright testid.
2. **Fork-only components onto logical paddings** (`ps-`/`pe-`).
3. **Consider a StreamProvider hybrid for `Store.people.forAsset`** — stream the owned arm, wrap the
   server arm in `Stream.fromFuture`, recovering upstream's reactivity without losing #727.

## Standing Divergences Recorded This Cycle

- **`Store.people.forAsset` stays a `FutureProvider`** keyed by `({id, ownerId})`. Upstream made it a
  Drift StreamProvider; the fork's #727 arm resolves people for a non-owned asset from the **server**,
  which cannot be a local stream. Upstream's two `forAsset` reactivity tests are removed with a comment
  saying why. Renames still refresh through the explicit `ref.invalidate` in `people_details`.
- **`RemoveFromAlbumAction.svelte` remains fork-owned** pending the follow-up PR above.

## Fork Feature Verification

| Feature                   | Status | Notes                                                                        |
| ------------------------- | ------ | ---------------------------------------------------------------------------- |
| Shared Spaces             | OK     | Sync types, tables and RBAC intact; `ci-invariants-check` green.             |
| Space Albums              | OK     | `SelectionToolbar` path preserved; #752 partial-removal semantics unchanged. |
| Faces / people            | OK     | #727, #737, #683 sort all preserved through the DAO rename.                  |
| Storage Migration         | OK     | Untouched.                                                                   |
| Pet Detection             | OK     | Untouched.                                                                   |
| Image Editing             | OK     | Upstream's upload-stacking lands beside it.                                  |
| Branding                  | OK     | Docs and READMEs kept branded; literal detector clean.                       |
| Google Photos Import      | OK     | Untouched.                                                                   |
| Cluster groups stay inert | OK     | Controller unmounted, unique index present, invariant green.                 |
| Search V3 stays dormant   | OK     | `search-v3-not-dispatched` green.                                            |

## Local CI Verification

| Check                                        | Status | Notes                                     |
| -------------------------------------------- | ------ | ----------------------------------------- |
| `server pnpm build` (+ postbuild)            | PASS   | 67 migrations, 2 compatibility aliases    |
| `server pnpm check`                          | PASS   | 0 errors                                  |
| `web check:typescript`                       | PASS   |                                           |
| `web check:svelte`                           | PASS   | 640 files, 0 errors, 0 warnings           |
| `server pnpm lint`                           | PASS   |                                           |
| prettier — server / web / `.github` / `i18n` | PASS   | one web file fixed                        |
| Server unit tests                            | PASS   | 201 files, **6436 passed**                |
| Web unit tests                               | PASS   | 391 files, **6396 passed**                |
| `dart analyze --fatal-infos`                 | PASS   | No issues found                           |
| `dart format`                                | PASS   | 0 changed                                 |
| `flutter test`                               | PASS   | **4000 passed**                           |
| Drift migration chain 1→41                   | PASS   | 825 tests                                 |
| OpenAPI + SDK + Dart client regenerated      | PASS   | spec delta is V2→V3 plus two enum members |
| `server/src/queries/` regenerated            | PASS   | **no diff** — already current             |
| `make commit-autolink-check`                 | PASS   |                                           |
| Base-image `docker run` diff                 | PASS   | `binaryen` unchanged                      |
| revert-to-immich coverage detector           | PASS   | no MISSING entries                        |

### Standing audit note

`upstream-postrebase-audit`'s **Generated Query Block Survival** reports
`SyncRepository.assetFace.getDeletes`/`getUpserts` as lost. They are **renamed**, not lost —
immich-31591 made them `getDeletesV2`/`getUpsertsV2` and added V3, and all four blocks are present in
`sync.repository.sql`. The check diffs block headers against a baseline branch and cannot see renames.

## Remote CI Verification

- **Branch**: `rebase/upstream-rolling-v3.3.0`
- **Commit validated**: `bf3101348ec`, plus `7f8626e394b` for the revert gate (see below)

| Workflow                                  | Status    | Run         | Notes                                                     |
| ----------------------------------------- | --------- | ----------- | --------------------------------------------------------- |
| `test.yml`                                | **GREEN** | 35513683898 | **22/22 jobs, 0 skipped, 0 failed**                       |
| `docker.yml`                              | **GREEN** | 35513750079 | builds the shipped images                                 |
| `static_analysis.yml`                     | **GREEN** | 35513720040 | `dart analyze` + `dart format` + generated-file freshness |
| `gallery-rebase-smoke.yml`                | **GREEN** | 35513780032 |                                                           |
| `storage-migration-tests.yml`             | **GREEN** | 35513867658 |                                                           |
| `gallery-revert-to-immich-validation.yml` | **GREEN** | 35514494256 | on `7f8626e394b` after the fix below                      |

The five workflows above the revert gate ran on `bf3101348ec`; the only code difference up to
`7f8626e394b` is `scripts/revert-to-immich.sql`, which no other workflow exercises, plus this report.

### Failure found and fixed

`gallery-revert-to-immich-validation` failed first time on `bf3101348ec`:

> corrupted migrations: previously executed migration 1776735180298-ChangeDurationToInteger is missing

**Cause, and it was self-inflicted.** Appending the new post-tag entry to step 8's `IN` list left the
line above it — `'1776735180298-ChangeDurationToInteger'`, the build-time compatibility alias — without
a trailing comma. **Postgres concatenates adjacent string literals across a newline into one literal
rather than erroring**, so the list silently lost _both_ names: the alias row survived the revert and
the tagged v3.2.2 migrator aborted on boot.

Confirmed self-inflicted rather than pre-existing by control: that gate is green on `main` across its
last five runs, all on `c566f2766cc`. Fixed, and all three `IN` lists in the file audited — 173
literals, no other missing comma.

This is worth remembering: a dropped comma in a SQL `IN` list of string literals is **not** a syntax
error. It silently merges two entries into one, and only an end-to-end boot catches it.

### Earlier batch push

Batch 09 (`58ebf713fbb`) was pushed and gated mid-cycle: Docker green, Test green, and **Static Code
Analysis caught a real orphaned import** in `tab_shell.page.dart` that local reasoning had waved
through. Running the gates per batch rather than only at the end is what surfaced it.

## Known Blemish

One replayed commit, the fork's `@immich/ui` patch commit, carries conflict markers in
`pnpm-lock.yaml`: the scripted resolver correctly refused an asymmetric region and the file was staged
anyway. Caught by the tree-wide marker sweep and fixed forward rather than rewriting 156 commits. The
branch tip is clean, and because that commit is a replayed copy of one intact on `origin/main`, the
markers do not survive the next cycle.
