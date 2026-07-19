# Space-Albums Remediation — Slice 10 (Mobile Hygiene) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four mobile-hygiene findings from the space-albums review — space-aware client-side garbage collection (`mobile-3`/`gaps-1`), fork-space table clearing on `SyncResetV1` (`mobile-4`), an accurate album-shelf count (`mobile-5`), and archived-asset visibility in space/space-album timelines (`mobile-6`) — all in the Flutter/Dart mobile app.

**Architecture:** Four independent, query-only Drift edits in `mobile/lib/infrastructure/repositories/` plus one one-line dispatch enablement in `mobile/lib/domain/services/sync_stream.service.dart`. Each fix is TDD'd against an in-memory Drift database (`NativeDatabase.memory()`), red→green, and lands as its own commit. No Drift entity **schema** changes, so no `build_runner` codegen is needed — every edit is a change to a Dart-builder query or a `deleteAll()` call over an **existing** table.

**Tech Stack:** Flutter 3.44.1 (via mise), Dart, Drift (SQLite query builder), `flutter_test`, `mocktail`, `drift/native.dart` in-memory DB.

## Global Constraints

- **Toolchain:** Flutter 3.44.1 via mise. Run tests with `cd mobile && mise exec -- flutter test <file>`. Run the analyzer with `cd mobile && mise exec -- dart analyze --fatal-infos lib test`. CI runs `dart analyze --fatal-infos` over **both** `lib` **and** `test` — a lint in a test file fails CI, so keep test files clean too.
- **One-time env setup (only if `flutter test` fails to _compile_):** run `cd mobile && mise exec -- flutter pub get` and, if generated localization keys are missing, `cd mobile && mise exec -- mise run codegen:translation` once. This is an environment fixup, **not** a code change, and is **not** committed.
- **No `build_runner`:** All four fixes are query-only (new joins / new `deleteAll()` over existing tables / predicate swaps). No `@DataClassName`/column/table schema change → **do not** run `dart run build_runner build`. Confirm by never editing any file under `lib/infrastructure/entities/*.entity.dart` or any `*.drift.dart`.
- **No ESLint / no `pnpm run lint`:** This slice is Dart-only. The Dart compile+lint gate **is** `dart analyze --fatal-infos lib test`. Do not add any per-slice `pnpm`/ESLint step.
- **Commits:** exactly one commit per fix (four total). Use the exact messages given in each task's final step. **No** `Co-Authored-By` / "Generated with" trailers on any commit.
- **Drift IN-over-enum idiom (used by `mobile-5` and `mobile-6`):** the codebase expresses `visibility IN (timeline, archive)` as an OR of two `equalsValue` calls — verbatim from `timeline.repository.dart:789` / `:804`:
  ```dart
  (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive))
  ```
  `AssetVisibility` is the app enum defined in `lib/domain/models/asset/remote_asset.model.dart` and re-exported through `part` by `lib/domain/models/asset/base_asset.model.dart`. Import `package:immich_mobile/domain/models/asset/base_asset.model.dart` to reach it.
- **Never leak Hidden/Locked:** `mobile-5` and `mobile-6` predicates admit **only** `timeline` + `archive`. Never add `hidden` or `locked` to any of these predicates.

---

## File Structure

- `mobile/lib/infrastructure/repositories/sync_stream.repository.dart` — `reset()` (Task 1, `mobile-4`) and `pruneAssets()` (Task 4, `mobile-3`).
- `mobile/lib/domain/services/sync_stream.service.dart` — enable the commented-out `pruneAssets()` call on `syncCompleteV1` (Task 4, `mobile-3`).
- `mobile/lib/infrastructure/repositories/timeline.repository.dart` — the 6 `visibility == timeline` predicate sites (Task 2, `mobile-6`).
- `mobile/lib/infrastructure/repositories/space_album.repository.dart` — `watchLinkedAlbums()` shelf count (Task 3, `mobile-5`).
- Tests:
  - `mobile/test/domain/repositories/sync_stream_repository_test.dart` — `reset()` (Task 1) + `pruneAssets()` (Task 4) — in-memory `Drift(...)`, seeded via `sut.updateXxxV1(...)` handlers (the established pattern in this file).
  - `mobile/test/domain/services/sync_stream_service_test.dart` — the `syncCompleteV1 → pruneAssets()` dispatch test (Task 4) — `mocktail` `MockSyncStreamRepository`.
  - `mobile/test/medium/repositories/timeline_repository_test.dart` — `mobile-6` archived-visibility (Task 2) — `MediumRepositoryContext`.
  - `mobile/test/medium/repositories/space_album_repository_test.dart` — `mobile-5` shelf count (Task 3) — `MediumRepositoryContext`.

---

## Task 1: `mobile-4` — `reset()` clears the fork space tables

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:52-94` (`reset()`, add 8 `deleteAll()` calls inside the transaction, after line 82 `await _db.assetOcrEntity.deleteAll();`)
- Test: `mobile/test/domain/repositories/sync_stream_repository_test.dart` (extend the existing `group('SyncStreamRepository - reset()', ...)` at ~line 232)

**Context.** `reset()` runs under `PRAGMA foreign_keys = OFF` inside `_db.exclusively(...)` + `transaction(...)`. It currently deletes 17 remote tables but **none** of the 8 fork space tables. A stale `shared_space_album_asset` + link row joined to a re-synced `remote_asset` after a reset wrongly re-places assets in space timelines. The 8 Drift accessors → SQLite table names (all confirmed already used elsewhere in this same file, so all accessors exist):

| Drift accessor (`_db.…`)      | SQLite table                      |
| ----------------------------- | --------------------------------- |
| `sharedSpaceAlbumAssetEntity` | `shared_space_album_asset_entity` |
| `sharedSpaceAlbumLinkEntity`  | `shared_space_album_link_entity`  |
| `sharedSpaceAlbumEntity`      | `shared_space_album_entity`       |
| `sharedSpaceAssetEntity`      | `shared_space_asset_entity`       |
| `sharedSpaceLibraryEntity`    | `shared_space_library_entity`     |
| `sharedSpaceMemberEntity`     | `shared_space_member_entity`      |
| `sharedSpaceEntity`           | `shared_space_entity`             |
| `libraryEntity`               | `library_entity`                  |

- [ ] **Step 1: Write the failing test**

Add these two tests inside the existing `group('SyncStreamRepository - reset()', () { … })` block in `mobile/test/domain/repositories/sync_stream_repository_test.dart` (just before the group's closing `});` at ~line 282). They reuse the top-level `_createUser` / `_createAsset` helpers already in the file.

```dart
    test('reset() clears all 8 fork space + library tables (mobile-4)', () async {
      // Seed a fully-populated fork-space graph via the real sync handlers so
      // FK-parent ordering (space → album/library → link/membership) is honoured.
      await sut.updateUsersV1([_createUser()]);
      await sut.updateSharedSpacesV1([
        SyncSharedSpaceV1(
          id: 'space-1',
          name: 'Space',
          description: null,
          color: null,
          createdById: 'user-1',
          thumbnailAssetId: null,
          thumbnailCropY: null,
          faceRecognitionEnabled: true,
          petsEnabled: false,
          lastActivityAt: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceMembersV1([
        SyncSharedSpaceMemberV1(
          spaceId: 'space-1',
          userId: 'user-1',
          role: 'editor',
          joinedAt: DateTime(2026, 4, 6),
          showInTimeline: true,
        ),
      ]);
      await sut.updateAssetsV1([_createAsset(id: 'asset-1', checksum: 'c1', fileName: 'a.jpg')]);
      await sut.updateSharedSpaceToAssetsV1([
        SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'asset-1'),
      ]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumsV1([
        SyncAlbumV2(
          id: 'album-1',
          name: 'Album',
          description: '',
          isActivityEnabled: true,
          order: AssetOrder.asc,
          thumbnailAssetId: null,
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumLinksV1([
        SyncSharedSpaceAlbumLinkV1(
          spaceId: 'space-1',
          albumId: 'album-1',
          showInTimeline: true,
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceAlbumToAssetsV1([
        SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'asset-1'),
      ]);

      // Sanity: every table is non-empty before reset.
      expect(await db.sharedSpaceEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceMemberEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAssetEntity.select().get(), isNotEmpty);
      expect(await db.libraryEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceLibraryEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumLinkEntity.select().get(), isNotEmpty);
      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isNotEmpty);

      // reset() must not throw under foreign_keys = OFF and must empty all 8.
      await sut.reset();

      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAlbumLinkEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAlbumEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceAssetEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceLibraryEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceMemberEntity.select().get(), isEmpty);
      expect(await db.sharedSpaceEntity.select().get(), isEmpty);
      expect(await db.libraryEntity.select().get(), isEmpty);
    });

    test('reset() on an empty DB does not throw under foreign_keys = OFF (mobile-4)', () async {
      // No seed at all — the added deleteAll() calls must be safe no-ops.
      await sut.reset();
      expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
      expect(await db.libraryEntity.select().get(), isEmpty);
    });
```

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart --plain-name 'reset()'`
Expected: FAIL — `reset() clears all 8 fork space + library tables (mobile-4)` fails at the first post-reset `isEmpty` assertion (e.g. `sharedSpaceAlbumAssetEntity` still has 1 row) because `reset()` does not yet delete the fork tables. (The empty-DB test passes trivially; that's fine.)

- [ ] **Step 3: Add the 8 `deleteAll()` calls to `reset()`**

In `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`, inside the `transaction(() async { … })` body, immediately **after** the existing line `await _db.assetOcrEntity.deleteAll();` (line 82) and **before** the closing `});` of the transaction (line 83), insert:

```dart
            // --- gallery-fork: clear fork space + library tables (mobile-4) ---
            // SyncResetV1 must wipe every fork-only remote table too, or a stale
            // shared_space_album_asset + link row joined to a re-synced remote_asset
            // wrongly re-places assets in space timelines after a reset. Runs under
            // PRAGMA foreign_keys = OFF (see reset() preamble), so ordering is free;
            // children-before-parents kept for readability.
            await _db.sharedSpaceAlbumAssetEntity.deleteAll();
            await _db.sharedSpaceAlbumLinkEntity.deleteAll();
            await _db.sharedSpaceAlbumEntity.deleteAll();
            await _db.sharedSpaceAssetEntity.deleteAll();
            await _db.sharedSpaceLibraryEntity.deleteAll();
            await _db.sharedSpaceMemberEntity.deleteAll();
            await _db.sharedSpaceEntity.deleteAll();
            await _db.libraryEntity.deleteAll();
```

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart --plain-name 'reset()'`
Expected: PASS (all `reset()` group tests green).

- [ ] **Step 5: Analyze + commit**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: `No issues found!`

```bash
git add mobile/lib/infrastructure/repositories/sync_stream.repository.dart mobile/test/domain/repositories/sync_stream_repository_test.dart
git commit -m "fix(spaces): clear fork space tables on mobile SyncResetV1"
```

---

## Task 2: `mobile-6` — space queries return Archived assets (6 predicate sites)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` — 6 sites, lines **505, 551, 611, 657, 682, 719**
- Test: `mobile/test/medium/repositories/timeline_repository_test.dart` (add a new `group('mobile-6: archived visibility', …)`)

**Context — the exact 6 sites** (each currently reads `_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline)`):

| #   | Function                      | Branch                                        | Line |
| --- | ----------------------------- | --------------------------------------------- | ---- |
| 1   | `_watchSharedSpaceBucket`     | `groupBy == GroupAssetsBy.none` (count query) | 505  |
| 2   | `_watchSharedSpaceBucket`     | `groupBy != none` (grouped query)             | 551  |
| 3   | `_getSharedSpaceBucketAssets` | (asset page)                                  | 611  |
| 4   | `_watchSpaceAlbumBucket`      | `groupBy == GroupAssetsBy.none` (count query) | 657  |
| 5   | `_watchSpaceAlbumBucket`      | `groupBy != none` (grouped query)             | 682  |
| 6   | `_getSpaceAlbumBucketAssets`  | (asset page)                                  | 719  |

The server streams **Timeline + Archive** to non-owners and mobile stores archived rows; requiring `== timeline` drops archived-but-shared assets that web shows. All 6 must change to `IN (timeline, archive)` using the confirmed OR idiom. Missing **any one** leaves that surface dropping archived assets — the test below exercises all 6 (both `assetSource` and `bucketSource` at `.none` and `.day`).

**Interfaces (already exist, used by the test):**

- `DriftTimelineRepository.sharedSpace(String spaceId, GroupAssetsBy groupBy)` → `TimelineQuery` with `.bucketSource()` (`Stream<List<Bucket>>`) and `.assetSource(int offset, int count)` (`Future<List<BaseAsset>>`).
- `DriftTimelineRepository.spaceAlbum(String spaceId, String albumId, GroupAssetsBy groupBy)` → same shape.
- `Bucket.assetCount` (int) — sum across buckets = number of visible assets.

- [ ] **Step 1: Write the failing test**

In `mobile/test/medium/repositories/timeline_repository_test.dart`, add this group just before `main()`'s final closing `}` (after the `group('sharedSpace album branch', …)` block ends at ~line 198). It imports nothing new — `AssetVisibility`, `RemoteAsset`, and `GroupAssetsBy` are all reachable through the existing `base_asset.model.dart` / `timeline.repository.dart` imports.

```dart
  group('mobile-6: archived visibility', () {
    // Sum of per-bucket assetCount == number of visible assets in the timeline.
    Future<int> bucketTotal(TimelineQuery q) async {
      final buckets = await q.bucketSource().first;
      return buckets.fold<int>(0, (sum, b) => sum + b.assetCount);
    }

    test('spaceAlbum detail returns an Archived album asset (sites 4-6)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final archived = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: archived.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);

      // Site 6: assetSource.
      final assets = await sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id).toList();
      expect(ids, contains(archived.id), reason: 'archived album asset must surface on mobile');
      expect(ids, isNot(contains(hidden.id)), reason: 'hidden must never leak');

      // Site 4 (groupBy none count) + Site 5 (groupBy day): 1 visible (archived) only.
      expect(await bucketTotal(sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none)), 1);
      expect(await bucketTotal(sut.spaceAlbum(space.id, album.id, GroupAssetsBy.day)), 1);
    });

    test('sharedSpace timeline returns an Archived direct-added asset (sites 1-3)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final archived = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: archived.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: hidden.id);

      // Site 3: assetSource.
      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id).toList();
      expect(ids, contains(archived.id), reason: 'archived direct-added asset must surface on mobile');
      expect(ids, isNot(contains(hidden.id)), reason: 'hidden must never leak');

      // Site 1 (groupBy none count) + Site 2 (groupBy day): 1 visible (archived) only.
      expect(await bucketTotal(sut.sharedSpace(space.id, GroupAssetsBy.none)), 1);
      expect(await bucketTotal(sut.sharedSpace(space.id, GroupAssetsBy.day)), 1);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart --plain-name 'mobile-6'`
Expected: FAIL — both tests fail: `assetSource` omits the archived id and `bucketTotal(...)` returns `0` instead of `1`, because all 6 sites still require `== timeline`.

- [ ] **Step 3: Change all 6 predicate sites**

In `mobile/lib/infrastructure/repositories/timeline.repository.dart`, replace each of the 6 occurrences of

```dart
              _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
```

with

```dart
              (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                      _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
```

Apply at lines **505, 551, 611, 657, 682, 719**. Preserve each site's own surrounding indentation exactly (the leading whitespace differs per site — match the file). Only these 6 space/space-album sites change; do **not** touch the personal-timeline `== timeline` predicates at lines 778, 879, 909, 965, 999, 1035, 1067, 1085, 1120, or the customStatement variants at 1182/1231.

Precise anchor for each (the line and its two-line context) so no other `== timeline` is touched:

- **505** — inside `_watchSharedSpaceBucket` `groupBy == none` `..where(` block, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.
- **551** — inside `_watchSharedSpaceBucket` grouped `..where(`, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.
- **611** — inside `_getSharedSpaceBucketAssets` `..where(`, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.
- **657** — inside `_watchSpaceAlbumBucket` `groupBy == none` `..where(`, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.
- **682** — inside `_watchSpaceAlbumBucket` grouped `..where(`, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.
- **719** — inside `_getSpaceAlbumBucketAssets` `..where(`, preceded by `_db.remoteAssetEntity.deletedAt.isNull() &`.

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart --plain-name 'mobile-6'`
Expected: PASS (both tests).

Also run the whole file to confirm no regression in the existing space/timeline reactivity tests:
Run: `cd mobile && mise exec -- flutter test test/medium/repositories/timeline_repository_test.dart`
Expected: PASS (all green).

- [ ] **Step 5: Analyze + commit**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: `No issues found!`

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart mobile/test/medium/repositories/timeline_repository_test.dart
git commit -m "fix(spaces): show archived assets in mobile space and space-album timelines"
```

---

## Task 3: `mobile-5` — shelf count via `remote_asset` join

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/space_album.repository.dart:11-42` (`watchLinkedAlbums`) + add one import
- Test: `mobile/test/medium/repositories/space_album_repository_test.dart` (extend `group('watchLinkedAlbums', …)`) + add one import

**Context.** `watchLinkedAlbums` currently counts **membership rows** directly (`assetMembership.assetId.count()`), so the shelf badge counts assets that are Hidden / deleted / not-yet-synced at link time — overstating vs. the detail view (`_getSpaceAlbumBucketAssets`, which after `mobile-6` shows `deletedAt IS NULL AND visibility IN (timeline, archive)`). Fix: count via a **LEFT JOIN to `remote_asset`** with the detail predicate in the **JOIN ON-clause** (not the WHERE) so an album with zero visible assets still surfaces with `assetCount == 0`. `remote_asset.id.count()` ignores the NULLs a LEFT JOIN produces, giving the correct visible count.

**Interfaces:**

- Produces: `watchLinkedAlbums(String spaceId) → Stream<List<SpaceAlbum>>` where `SpaceAlbum.assetCount` = count of the album's assets that are `deletedAt IS NULL AND visibility IN (timeline, archive)`. Signature and `SpaceAlbum` shape are unchanged.

- [ ] **Step 1: Write the failing test**

First add the model import to the test file `mobile/test/medium/repositories/space_album_repository_test.dart` (after the existing `import '…/space_album.repository.dart';` line):

```dart
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
```

Then add these tests inside the existing `group('watchLinkedAlbums', () { … })` block (before its closing `});` at ~line 62):

```dart
    test('assetCount counts only visible assets — excludes hidden, deleted, and unsynced (mobile-5)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Mixed');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final visibleTimeline = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.timeline);
      final visibleArchive = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      final deleted = await ctx.newRemoteAsset(ownerId: user.id, deletedAt: DateTime(2026, 1, 1));

      // 4 membership rows with a remote_asset + 1 membership row whose asset was
      // never synced (no remote_asset row at all) → only 2 are visible.
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: visibleTimeline.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: visibleArchive.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: deleted.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: 'never-synced-asset');

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 2, reason: 'timeline + archive only; hidden/deleted/unsynced excluded');
    });

    test('assetCount is 0 for an album with no visible assets but the album still lists (mobile-5)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'AllHidden');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.map((a) => a.id), contains(album.id), reason: 'album must still appear on the shelf');
      expect(albums.single.assetCount, 0);
    });
```

Note: the existing `assetCount reflects shared_space_album_asset rows for each album` test (two default-`timeline` assets → count 2, empty album → 0) stays green under the new predicate.

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/space_album_repository_test.dart --plain-name 'watchLinkedAlbums'`
Expected: FAIL — `assetCount counts only visible assets …` fails with `assetCount` = `5` (membership-row count: timeline+archive+hidden+deleted+never-synced) instead of `2`, because the count is still `assetMembership.assetId.count()`.

- [ ] **Step 3: Rewrite `watchLinkedAlbums` to count via the `remote_asset` join**

In `mobile/lib/infrastructure/repositories/space_album.repository.dart`:

1. Add the import (after the existing `import 'package:immich_mobile/domain/models/space_album.model.dart';`):

```dart
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
```

2. Replace the body of `watchLinkedAlbums` (lines 11-42) with:

```dart
  Stream<List<SpaceAlbum>> watchLinkedAlbums(String spaceId) {
    final link = _db.sharedSpaceAlbumLinkEntity;
    final meta = _db.sharedSpaceAlbumEntity;
    final assetMembership = _db.sharedSpaceAlbumAssetEntity;
    final asset = _db.remoteAssetEntity;

    // mobile-5: count only assets the detail view would show. LEFT JOIN
    // membership → remote_asset and apply the space-album detail predicate
    // (deletedAt IS NULL AND visibility IN (timeline, archive) — matching
    // _getSpaceAlbumBucketAssets after mobile-6) in the JOIN ON-clause, NOT the
    // WHERE, so an album with zero visible assets still surfaces with count 0.
    // remote_asset.id.count() ignores the NULLs a LEFT JOIN produces.
    final assetCountExp = asset.id.count();

    final query =
        _db.select(link).join([
            innerJoin(meta, meta.id.equalsExp(link.albumId)),
            leftOuterJoin(assetMembership, assetMembership.albumId.equalsExp(link.albumId), useColumns: false),
            leftOuterJoin(
              asset,
              asset.id.equalsExp(assetMembership.assetId) &
                  asset.deletedAt.isNull() &
                  (asset.visibility.equalsValue(AssetVisibility.timeline) |
                      asset.visibility.equalsValue(AssetVisibility.archive)),
              useColumns: false,
            ),
          ])
          ..where(link.spaceId.equals(spaceId))
          ..addColumns([assetCountExp])
          ..groupBy([link.spaceId, link.albumId, meta.id])
          ..orderBy([OrderingTerm.asc(meta.name)]);

    return query.watch().map(
      (rows) => rows.map((row) {
        final m = row.readTable(meta);
        final l = row.readTable(link);
        return SpaceAlbum(
          id: m.id,
          name: m.name,
          thumbnailAssetId: m.thumbnailAssetId,
          showInTimeline: l.showInTimeline,
          assetCount: row.read(assetCountExp) ?? 0,
        );
      }).toList(),
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/space_album_repository_test.dart`
Expected: PASS (the two new `mobile-5` tests + the pre-existing `watchLinkedAlbums` / `deleteAlbumMetadata` / `deleteLink` tests all green).

- [ ] **Step 5: Analyze + commit**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: `No issues found!`

```bash
git add mobile/lib/infrastructure/repositories/space_album.repository.dart mobile/test/medium/repositories/space_album_repository_test.dart
git commit -m "fix(spaces): count shelf albums via visible remote_asset join"
```

---

## Task 4: `mobile-3` / `gaps-1` — space-aware `pruneAssets` on `syncCompleteV1`

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:1336-1368` (`pruneAssets`, extend the keep-set)
- Modify: `mobile/lib/domain/services/sync_stream.service.dart:289-291` (enable the `pruneAssets()` call on `syncCompleteV1`)
- Test: `mobile/test/domain/repositories/sync_stream_repository_test.dart` (new `group('SyncStreamRepository - pruneAssets', …)`)
- Test: `mobile/test/domain/services/sync_stream_service_test.dart` (dispatch test)

**Context.** After a purge/unlink/revocation the member's Drift DB keeps `remote_asset` (filename, checksum, thumbhash) + `remote_exif` (GPS, city, camera) forever, and `pruneAssets` is disabled (call site commented out) and space-unaware. Extend the keep-set to every path that legitimately reaches an asset, and enable the call on `syncCompleteV1`.

Keep-set = owned ∪ partner ∪ `remote_album_asset` (classic album) ∪ `shared_space_asset` (direct) ∪ `shared_space_album_asset` (granted album) ∪ library-reachable (`shared_space_library` via `library_id`). Deletion is expressed as the negation of that keep-set.

**Two correctness pins the plan bakes in:**

1. **NULL `library_id` trap.** `library_id.isNotInQuery(...)` is `NULL` (not `TRUE`) when `library_id` is NULL, and `X & NULL == NULL` → the row would **not** be deleted — so a common orphan (an asset with no library) would never be pruned. The library term must be `(library_id IS NULL OR library_id NOT IN sharedSpaceLibrary)` so a NULL-library orphan still deletes: `asset.libraryId.isNull() | asset.libraryId.isNotInQuery(...)`.
2. **`remote_exif` cascades automatically.** `remote_exif_entity.assetId` has `onDelete: KeyAction.cascade` and `pruneAssets` runs inside `_db.transaction()` **without** disabling foreign keys (the DB opens with `PRAGMA foreign_keys = ON`), so deleting a `remote_asset` row deletes its `remote_exif` row. The test asserts this rather than adding a redundant explicit delete.

**Thumbnail byte-cache eviction — DEFERRED (documented).** The privacy-critical part (row-level GC of `remote_asset` + cascaded `remote_exif` — the filename/checksum/thumbhash/GPS/city/camera metadata) is done here. In-memory thumbnail **bytes** live in the UI-layer `CustomImageCache` (a `PaintingBinding.instance.imageCache` singleton keyed by **`ImageProvider` instances**, not asset ids) and, for full images, a URL-keyed disk cache — neither is reachable from a `DriftDatabaseRepository`, and neither can be driven from a `flutter test` unit test against an in-memory DB (no binding, no providers, no network). Wiring eviction would require threading pruned ids out to a UI/service layer that resolves them into provider cache keys / disk URLs — out of scope for this repo-level fix and flagged "unverified" by the review. This task adds an explicit code comment marking the deferral so a follow-up (evict `imageCache` + disk cache for pruned ids at the service layer) is discoverable. **No byte-eviction test is written** (correct per the spec's "explicitly deferred with a follow-up note" allowance).

**Interfaces:**

- Consumes (service test): `SyncStreamRepository.pruneAssets() → Future<void>` (mockable via `MockSyncStreamRepository`).
- Produces: `syncCompleteV1` dispatch now calls `pruneAssets()`.

- [ ] **Step 1: Write the failing repository tests**

Add these imports to the top of `mobile/test/domain/repositories/sync_stream_repository_test.dart` (with the other `package:` imports):

```dart
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/infrastructure/entities/auth_user.entity.drift.dart';
```

Add this new top-level group inside `main()` (e.g. after the `group('SyncStreamRepository - Libraries', …)` block, before `main()`'s closing `}`):

```dart
  group('SyncStreamRepository - pruneAssets', () {
    // pruneAssets reads the current user id from authUserEntity (not userEntity).
    Future<void> seedAuthUser(String id) => db.authUserEntity.insertOne(
      AuthUserEntityCompanion.insert(id: id, name: 'me', email: '$id@test.com', avatarColor: AvatarColor.primary),
    );

    // A foreign-owned asset optionally tied to a library, for the keep-path cases.
    SyncAssetV1 foreignAsset({required String id, required String checksum, String? libraryId}) => SyncAssetV1(
      id: id,
      checksum: checksum,
      originalFileName: '$id.jpg',
      type: AssetTypeEnum.IMAGE,
      ownerId: 'user-foreign',
      isFavorite: false,
      fileCreatedAt: DateTime(2024, 1, 1),
      fileModifiedAt: DateTime(2024, 1, 1),
      localDateTime: DateTime(2024, 1, 1),
      createdAt: DateTime(2024, 1, 1),
      visibility: AssetVisibility.timeline,
      width: 100,
      height: 100,
      deletedAt: null,
      duration: null,
      libraryId: libraryId,
      livePhotoVideoId: null,
      stackId: null,
      thumbhash: null,
      isEdited: false,
    );

    setUp(() async {
      await sut.updateUsersV1([
        _createUser(id: 'user-1'),
        _createUser(id: 'user-partner'),
        _createUser(id: 'user-foreign'),
      ]);
      await seedAuthUser('user-1');
    });

    test('skips pruning when there is no authenticated user', () async {
      // Fresh DB with no authUser row (override the group setUp by clearing it).
      await db.authUserEntity.deleteAll();
      await sut.updateAssetsV1([foreignAsset(id: 'orphan', checksum: 'c1')]);

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), hasLength(1), reason: 'no auth user → no pruning');
    });

    test('deletes an unreachable foreign orphan and cascades its remote_exif', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'orphan', checksum: 'c1')]);
      await sut.updateAssetsExifV1([_createExif(assetId: 'orphan', width: 100, height: 100, orientation: '1')]);
      expect(await db.remoteExifEntity.select().get(), hasLength(1));

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), isEmpty);
      expect(await db.remoteExifEntity.select().get(), isEmpty, reason: 'FK ON DELETE CASCADE removes exif');
    });

    test('keeps an owned asset even with no album/space path', () async {
      await sut.updateAssetsV1([_createAsset(id: 'mine', checksum: 'c1', fileName: 'mine.jpg', ownerId: 'user-1')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['mine']);
    });

    test('keeps a partner-owned asset', () async {
      await db.into(db.partnerEntity).insert(
        PartnerEntityCompanion.insert(
          sharedById: 'user-partner',
          sharedWithId: 'user-1',
          inTimeline: const drift.Value(true),
        ),
      );
      await sut.updateAssetsV1([_createAsset(id: 'partner', checksum: 'c1', fileName: 'p.jpg', ownerId: 'user-partner')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['partner']);
    });

    test('keeps an asset reachable via remote_album_asset (classic album)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'classic', checksum: 'c1')]);
      await sut.updateAlbumsV2([
        SyncAlbumV2(
          id: 'classic-album',
          name: 'Classic',
          description: '',
          isActivityEnabled: true,
          order: AssetOrder.asc,
          thumbnailAssetId: null,
          createdAt: DateTime(2026, 6, 1),
          updatedAt: DateTime(2026, 6, 1),
        ),
      ]);
      await sut.updateAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'classic-album', assetId: 'classic')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['classic']);
    });

    test('keeps an asset reachable via shared_space_asset (direct add)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'direct', checksum: 'c1')]);
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'direct')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['direct']);
    });

    test('keeps an asset reachable via shared_space_album_asset (granted album)', () async {
      await sut.updateAssetsV1([foreignAsset(id: 'album-add', checksum: 'c1')]);
      await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'album-add')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['album-add']);
    });

    test('keeps an asset reachable via a space-linked library (shared_space_library)', () async {
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-foreign',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateAssetsV1([foreignAsset(id: 'lib-asset', checksum: 'c1', libraryId: 'library-1')]);

      await sut.pruneAssets();

      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['lib-asset']);
    });

    test('multi-path: pruned only when ALL paths are gone', () async {
      // Reachable via BOTH a direct add and a space album.
      await sut.updateAssetsV1([foreignAsset(id: 'multi', checksum: 'c1')]);
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateSharedSpaceToAssetsV1([SyncSharedSpaceToAssetV1(spaceId: 'space-1', assetId: 'multi')]);
      await sut.updateSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'multi')]);

      // Drop ONE path — still reachable via the other → kept.
      await sut.deleteSharedSpaceToAssetsV1([SyncSharedSpaceToAssetDeleteV1(spaceId: 'space-1', assetId: 'multi')]);
      await sut.pruneAssets();
      expect((await db.remoteAssetEntity.select().get()).map((a) => a.id), ['multi']);

      // Drop the last path → now unreachable → pruned.
      await sut.deleteSharedSpaceAlbumToAssetsV1([SyncAlbumToAssetDeleteV1(albumId: 'album-1', assetId: 'multi')]);
      await sut.pruneAssets();
      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });

    test('prunes an orphan with a NULL library_id (NULL-in-subquery trap regression)', () async {
      // A space-linked library exists but this orphan is not in it (null library_id).
      await sut.updateSharedSpacesV1([_pruneSpace()]);
      await sut.updateLibrariesV1([
        SyncLibraryV1(
          id: 'library-1',
          name: 'Lib',
          ownerId: 'user-foreign',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      await sut.updateSharedSpaceLibrariesV1([
        SyncSharedSpaceLibraryV1(
          spaceId: 'space-1',
          libraryId: 'library-1',
          addedById: 'user-1',
          createdAt: DateTime(2026, 4, 6),
          updatedAt: DateTime(2026, 4, 6),
        ),
      ]);
      // Orphan has libraryId: null → must still be pruned (not shielded by NULL NOT IN).
      await sut.updateAssetsV1([foreignAsset(id: 'null-lib-orphan', checksum: 'c1')]);

      await sut.pruneAssets();

      expect(await db.remoteAssetEntity.select().get(), isEmpty);
    });
  });
```

Add this small helper as a top-level function in the same test file (next to `_createUser` / `_createAsset` at the top), used by several prune tests:

```dart
SyncSharedSpaceV1 _pruneSpace({String id = 'space-1'}) => SyncSharedSpaceV1(
  id: id,
  name: 'Space',
  description: null,
  color: null,
  createdById: 'user-1',
  thumbnailAssetId: null,
  thumbnailCropY: null,
  faceRecognitionEnabled: true,
  petsEnabled: false,
  lastActivityAt: null,
  createdAt: DateTime(2026, 4, 6),
  updatedAt: DateTime(2026, 4, 6),
);
```

- [ ] **Step 2: Run the repository tests to verify they fail (red)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart --plain-name 'pruneAssets'`
Expected: FAIL — the keep-path tests fail because the current `pruneAssets` keep-set is only owned ∪ partner ∪ `remote_album_asset`:

- `keeps an asset reachable via shared_space_asset …`, `… shared_space_album_asset …`, `… space-linked library …`, and `multi-path …` all fail: their asset is **deleted** (empty result) though it should be kept.
- `prunes an orphan with a NULL library_id …` passes on the current code (current predicate has no library term) — it becomes the regression guard for Step 3.
  (`skips pruning …`, `deletes an unreachable foreign orphan …`, `keeps an owned asset …`, `keeps a partner-owned asset …`, `keeps … remote_album_asset …` pass on current code.)

- [ ] **Step 3: Extend the `pruneAssets` keep-set**

In `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`, replace the `deleteWhere` block in `pruneAssets` (lines 1355-1362) with:

```dart
        // Delete assets no longer reachable by ANY path. Keep-set:
        //   owned ∪ partner ∪ remote_album_asset (classic album)
        //   ∪ shared_space_asset (direct) ∪ shared_space_album_asset (granted album)
        //   ∪ library-reachable (library_id ∈ shared_space_library).
        // mobile-3/gaps-1: without the space/album/library arms a member's Drift DB
        // keeps remote_asset (filename, checksum, thumbhash) + remote_exif (GPS, city,
        // camera) forever after a purge/unlink, defeating the purge's privacy goal.
        //
        // remote_exif rows are removed automatically: remote_exif_entity.assetId has
        // ON DELETE CASCADE and this transaction runs with foreign_keys = ON.
        //
        // DEFERRED (follow-up): evicting cached thumbnail BYTES (in-memory
        // CustomImageCache — a PaintingBinding.imageCache singleton keyed by
        // ImageProvider instances, not asset ids — and the URL-keyed disk cache) is a
        // UI/service-layer concern not reachable from this Drift repository. Row-level
        // GC (remote_asset + cascaded remote_exif) is done here; byte eviction is a
        // future service-layer step (resolve pruned ids → provider keys / disk URLs).
        await _db.remoteAssetEntity.deleteWhere((asset) {
          return asset.ownerId.isNotIn(validUsers) &
              asset.id.isNotInQuery(
                _db.remoteAlbumAssetEntity.selectOnly()..addColumns([_db.remoteAlbumAssetEntity.assetId]),
              ) &
              asset.id.isNotInQuery(
                _db.sharedSpaceAssetEntity.selectOnly()..addColumns([_db.sharedSpaceAssetEntity.assetId]),
              ) &
              asset.id.isNotInQuery(
                _db.sharedSpaceAlbumAssetEntity.selectOnly()..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId]),
              ) &
              // Library-reachable exclusion. NULL-safe: `library_id NOT IN (...)` is NULL
              // (not TRUE) when library_id is NULL, so a null-library orphan would never
              // be deleted — guard with `IS NULL OR ...` so it still prunes.
              (asset.libraryId.isNull() |
                  asset.libraryId.isNotInQuery(
                    _db.sharedSpaceLibraryEntity.selectOnly()..addColumns([_db.sharedSpaceLibraryEntity.libraryId]),
                  ));
        });
```

- [ ] **Step 4: Run the repository tests to verify they pass (green)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart --plain-name 'pruneAssets'`
Expected: PASS (all `pruneAssets` group tests green, including the NULL-library regression).

- [ ] **Step 5: Write the failing service dispatch test**

In `mobile/test/domain/services/sync_stream_service_test.dart`, add this test inside the existing `group("SyncStreamService - _handleEvents", () { … })` block (e.g. after the "does not process or ack when event list is empty" test at ~line 267). It uses the file's existing `simulateEvents` helper and `SyncEvent` import.

```dart
    test("syncCompleteV1 triggers pruneAssets (mobile-3)", () async {
      when(() => mockSyncStreamRepo.pruneAssets()).thenAnswer((_) async {});

      await simulateEvents([
        SyncEvent(type: SyncEntityType.syncCompleteV1, data: 'complete', ack: 'ack-complete'),
      ]);

      verify(() => mockSyncStreamRepo.pruneAssets()).called(1);
    });
```

- [ ] **Step 6: Run the service test to verify it fails (red)**

Run: `cd mobile && mise exec -- flutter test test/domain/services/sync_stream_service_test.dart --plain-name 'syncCompleteV1 triggers pruneAssets'`
Expected: FAIL — `pruneAssets` is never called (the `syncCompleteV1` arm currently `return;`s with the call commented out), so `verify(...).called(1)` fails with "No matching calls (actually, none were made)".

- [ ] **Step 7: Enable the `pruneAssets` call on `syncCompleteV1`**

In `mobile/lib/domain/services/sync_stream.service.dart`, replace the `syncCompleteV1` arm (lines 288-291):

```dart
      // SyncCompleteV1 is used to signal the completion of the sync process. Cleanup stale assets and signal completion
      case SyncEntityType.syncCompleteV1:
        return;
      // return _syncStreamRepository.pruneAssets();
```

with:

```dart
      // SyncCompleteV1 signals the end of the sync process. mobile-3/gaps-1: run the
      // space-aware GC to drop remote_asset/remote_exif rows no longer reachable by
      // any path (owner/partner/classic-album/direct/space-album/space-library).
      case SyncEntityType.syncCompleteV1:
        return _syncStreamRepository.pruneAssets();
```

- [ ] **Step 8: Run both test files to verify they pass (green)**

Run: `cd mobile && mise exec -- flutter test test/domain/services/sync_stream_service_test.dart --plain-name 'syncCompleteV1 triggers pruneAssets'`
Expected: PASS.

Run the whole service suite to confirm no dispatch regression (unstubbed `pruneAssets` in other tests is only reached on a `syncCompleteV1` event, which they don't send):
Run: `cd mobile && mise exec -- flutter test test/domain/services/sync_stream_service_test.dart`
Expected: PASS.

- [ ] **Step 9: Analyze + commit**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: `No issues found!`

```bash
git add mobile/lib/infrastructure/repositories/sync_stream.repository.dart mobile/lib/domain/services/sync_stream.service.dart mobile/test/domain/repositories/sync_stream_repository_test.dart mobile/test/domain/services/sync_stream_service_test.dart
git commit -m "fix(spaces): space-aware mobile pruneAssets on syncComplete"
```

---

## Final Validation (run after all four tasks)

- [ ] **Full analyzer gate (lib + test, `--fatal-infos`, as CI runs it):**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: `No issues found!`

- [ ] **Full targeted test run for every touched file:**

Run:

```bash
cd mobile && mise exec -- flutter test \
  test/domain/repositories/sync_stream_repository_test.dart \
  test/domain/services/sync_stream_service_test.dart \
  test/medium/repositories/timeline_repository_test.dart \
  test/medium/repositories/space_album_repository_test.dart
```

Expected: All tests pass (0 failures).

- [ ] **Confirm no codegen drift:** `git status` shows only the 4 source files + 4 test files changed — **no** `*.drift.dart` / `*.g.dart` / entity files touched (proves no `build_runner` was needed).

---

## Notes / Out of Scope

- **Full album delete leaves orphan `shared_space_album_link_entity` rows** (spec §10 final edge case): the `mobile-4` `reset()` fix now clears these on any `SyncResetV1`, so a reset heals the orphan. A per-delete fix requires the **server** to emit `SharedSpaceAlbumLinkDeleteV1` per link on album delete — that is a server concern and is **out of scope** for this mobile-only slice. Documented here per the spec's "note it; fix only if cheap" guidance.
- **Thumbnail byte eviction** is intentionally deferred with an in-code follow-up note (Task 4, Step 3) — see the deferral rationale in Task 4's context.

---

## Self-Review

- **Spec coverage:** `mobile-3`/`gaps-1` → Task 4 (keep-set + call-site enablement + deferral note). `mobile-4` → Task 1 (8 `deleteAll`). `mobile-5` → Task 3 (remote_asset join count). `mobile-6` → Task 2 (all 6 sites). Every §10 edge case is a named test: multi-path pruned only when all gone (Task 4), never deletes owned/partner (Task 4), byte eviction deferred-with-note (Task 4), reset under FK=OFF doesn't error (Task 1 empty-DB test), all 6 sites changed / hidden never leaks (Task 2), shelf count matches detail predicate (Task 3). Plus the NULL-library-id trap regression (Task 4) and remote_exif cascade (Task 4).
- **Placeholder scan:** none — every step has concrete code and exact commands.
- **Type consistency:** `SpaceAlbum(id/name/thumbnailAssetId/showInTimeline/assetCount)` matches the model; `AssetVisibility.timeline/.archive/.hidden`, `GroupAssetsBy.none/.day`, `Bucket.assetCount`, `TimelineQuery.bucketSource()/.assetSource(offset,count)`, and the 8 `_db.*Entity` accessors are all verified against the current worktree.
