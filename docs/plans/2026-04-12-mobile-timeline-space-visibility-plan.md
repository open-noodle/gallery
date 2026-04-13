# Mobile Timeline Space Visibility — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four mobile Drift queries (`video()`, `place()`, `map()` bucket sheet, `DriftMapRepository.remote()` markers) so they honor shared-space visibility in parity with the main mobile timeline and the server's `withPartners`+`withSharedSpaces` behavior.

**Architecture:** New top-level helper file `mobile/lib/infrastructure/repositories/viewer_visibility.dart` exports two pure functions: `buildViewerVisibilityJoins` (returns `List<Join>` + two aliased `shared_space_member` tables for `.watch()` bucket queries) and `viewerVisibilityPredicate` (returns an `Expression<bool>` composed via `isInQuery` for `.get()` asset-list + marker queries). The two-function split mirrors the existing `sharedSpace()` precedent in `timeline.repository.dart` which uses real LEFT JOINs for reactivity-sensitive streams but `isInQuery` for one-shot futures.

**Tech Stack:** Flutter/Dart, Drift 2.x (SQLite ORM), Riverpod state management, `flutter_test` with `NativeDatabase.memory()` for repository tests.

**Design doc:** `docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md` (read it first — it has the full rationale, edge-case analysis, and test matrix).

**Working directory:** This plan runs in the `.worktrees/mobile-timeline-spaces` worktree on branch `docs/mobile-timeline-space-visibility-design`. All paths below are relative to that worktree root.

---

## Execution order at a glance

| Phase                       | Tasks       | Why in this order                                                                                   |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| 1. Architectural validation | Task 1      | Load-bearing Drift reactivity claim. If this fails, STOP — design must pivot to `.drift` SQL files. |
| 2. Helper file              | Tasks 2–4   | Build the shared primitive; verify it compiles and composes before any consumer uses it.            |
| 3. `video()` rewrite (TDD)  | Tasks 5–8   | Full matrix of 14 visibility tests + 2 reactivity tests. Video is the canonical consumer.           |
| 4. `place()` rewrite        | Tasks 9–10  | Method-specific tests (3) — helper already proven, lighter matrix.                                  |
| 5. `map()` rewrite          | Tasks 11–12 | Method-specific tests (4), preserves dynamic where clauses.                                         |
| 6. Marker rewrite           | Tasks 13–14 | `DriftMapRepository.remote()` — `.get()` path, 2 tests, no reactivity.                              |
| 7. Finalization             | Tasks 15–17 | Full suite + analyze + manual smoke test.                                                           |

---

## Task 1: Pre-flight Drift reactivity smoke test

**Goal:** Verify Drift's `.watch()` stream re-emits when a `shared_space_member` row (accessed via an aliased LEFT OUTER JOIN) mutates. This is the single load-bearing architectural claim in the design — if Drift's `readsFrom` set doesn't track aliased join targets correctly, we must abandon the LEFT-JOIN approach and rewrite the queries in `.drift` SQL files with explicit table imports (like `merged_asset.drift`).

The test uses a **hand-written inline query** — no helper, no method rewrite. It isolates the Drift behavior question from the rest of the design.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`

**Step 0: Verify the Drift aliasing API**

Before writing the pre-flight test, check which aliasing form this Drift version exposes:

```bash
cd mobile && grep -rn "alias(" lib/infrastructure/repositories/ lib/infrastructure/entities/ | grep -v ".g.dart" | head -10
```

Drift exposes aliasing two ways: the top-level `alias(table, 'name')` function imported from `package:drift/drift.dart`, and (in some versions) a method `db.alias(table, 'name')` on the generated database class. This repo has no existing aliasing call, so you must verify.

Write a 3-line throwaway sanity check at the top of the test file (inside `main()`):

```dart
test('sanity: alias() top-level function is available', () {
  final aliased = alias(db.sharedSpaceMemberEntity, 'x');
  expect(aliased, isNotNull);
});
```

Run it: `cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "sanity: alias"`. If it compiles and passes, use `alias(...)` throughout the plan. If it fails to compile with "The function 'alias' isn't defined", try `db.alias(db.sharedSpaceMemberEntity, 'x')` instead. Delete the sanity test after confirming the form works.

**Step 1: Add the pre-flight test inside `main()`**

Add this test as the FIRST test in the file (just after the existing `tearDown`), before any existing `sharedSpace` tests:

```dart
// PRE-FLIGHT: verifies Drift's reactive layer tracks tables reached via
// aliased LEFT OUTER JOINs. The full timeline space visibility design
// (docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md) is
// load-bearing on this behavior — if this test fails, switch the design
// to .drift SQL files with explicit table imports.
test('PRE-FLIGHT: aliased shared_space_member join re-emits on showInTimeline toggle', () async {
  const ownerId = 'owner-1';
  const viewerId = 'viewer-1';
  const spaceId = 'space-1';
  const assetId = 'asset-1';
  final createdAt = DateTime(2024, 1, 1, 12);

  await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: ownerId, email: 'o@test', name: 'O'));
  await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: viewerId, email: 'v@test', name: 'V'));
  await db
      .into(db.remoteAssetEntity)
      .insert(
        RemoteAssetEntityCompanion.insert(
          id: assetId,
          name: 'a.jpg',
          type: AssetType.image,
          checksum: 'c1',
          ownerId: ownerId,
          visibility: AssetVisibility.timeline,
          createdAt: Value(createdAt),
          updatedAt: Value(createdAt),
          localDateTime: Value(createdAt),
        ),
      );
  await db
      .into(db.sharedSpaceEntity)
      .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Space', createdById: ownerId));
  await db
      .into(db.sharedSpaceAssetEntity)
      .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));
  await db
      .into(db.sharedSpaceMemberEntity)
      .insert(
        SharedSpaceMemberEntityCompanion.insert(
          spaceId: spaceId,
          userId: viewerId,
          role: 'viewer',
          showInTimeline: const Value(true),
        ),
      );

  final ssmAsset = alias(db.sharedSpaceMemberEntity, 'ssm_asset');
  final countExp = db.remoteAssetEntity.id.count(distinct: true);
  final query = db.remoteAssetEntity.selectOnly()
    ..addColumns([countExp])
    ..join([
      leftOuterJoin(
        db.sharedSpaceAssetEntity,
        db.sharedSpaceAssetEntity.assetId.equalsExp(db.remoteAssetEntity.id),
        useColumns: false,
      ),
      leftOuterJoin(
        ssmAsset,
        ssmAsset.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
            ssmAsset.userId.equals(viewerId) &
            ssmAsset.showInTimeline.equals(true),
        useColumns: false,
      ),
    ])
    ..where(
      db.remoteAssetEntity.deletedAt.isNull() &
          db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
          ssmAsset.userId.isNotNull(),
    );

  final emissions = <int>[];
  final sub = query.map((row) => row.read(countExp) ?? 0).watchSingle().listen(emissions.add);

  await _waitFor(() => emissions.isNotEmpty);
  expect(emissions.last, 1, reason: 'First emission should see the visible space asset');

  // Toggle showInTimeline=false on the member row. The aliased join's ON clause
  // requires showInTimeline=true, so the asset should drop out of the count.
  await (db.update(db.sharedSpaceMemberEntity)
        ..where((t) => t.spaceId.equals(spaceId) & t.userId.equals(viewerId)))
      .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(false)));

  await _waitFor(() => emissions.length >= 2);
  expect(
    emissions.last,
    0,
    reason:
        'Drift reactive layer must track shared_space_member mutations reached via aliased LEFT OUTER JOIN — '
        'if this fails, the design must switch to .drift SQL files',
  );

  await sub.cancel();
});
```

**Step 2: Run the test**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "PRE-FLIGHT"
```

Expected: **PASS**. If it fails with "Timed out waiting for condition" on the second emission, **STOP ALL WORK**:

1. Unstage and discard the pre-flight test so we don't leave a broken test on the branch:

   ```bash
   git restore mobile/test/infrastructure/repositories/timeline_repository_test.dart
   ```

2. Document the failure by appending to the design doc's Risks section a note: _"PRE-FLIGHT FAILED on $(date). Drift's aliased LEFT OUTER JOIN does not propagate to `readsFrom` — architecture must pivot to `.drift` SQL files with explicit table imports (like `merged_asset.drift`). See plan Task 1 for repro."_

3. Notify the user and propose the `.drift` SQL file redesign before any further work.

**Step 3: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart
git commit -m "test(mobile): pre-flight Drift aliased-join reactivity for timeline space fix"
```

---

## Task 2: Create `viewer_visibility.dart` scaffold

**Goal:** Create the helper file with stub function bodies so it compiles and can be imported. No behavior yet — just shape.

**Files:**

- Create: `mobile/lib/infrastructure/repositories/viewer_visibility.dart`

**Step 1: Write the file**

```dart
// Shared visibility helpers for mobile timeline queries.
//
// Mirrors the main-timeline filter in merged_asset.drift: an asset is visible
// to a viewer if it's owned by one of the viewer's timeline users (self +
// partners with inTimeline=true), OR if it's linked to a shared space whose
// member row for the viewer has showInTimeline=true (directly via
// shared_space_asset, or transitively via shared_space_library).
//
// Two functions, one per Drift access mode:
//   * buildViewerVisibilityJoins — for .watch() bucket queries. Returns
//     real LEFT OUTER JOINs so Drift's readsFrom set tracks the tables
//     (isInQuery subqueries silently break .watch() reactivity).
//   * viewerVisibilityPredicate — for .get() asset-list and marker queries.
//     Returns an Expression<bool> composed from isInQuery subqueries. No
//     reactivity concern, and isInQuery naturally deduplicates.
//
// See docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md for
// the full rationale and the .drift-SQL fallback plan.

import 'package:drift/drift.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

typedef ViewerVisibilityJoinSpec = ({
  List<Join> joins,
  $SharedSpaceMemberEntityTable assetMember,
  $SharedSpaceMemberEntityTable libraryMember,
});

/// Builds the four LEFT OUTER JOINs needed to evaluate shared-space visibility
/// against an asset row, plus the two aliased `shared_space_member` tables the
/// caller uses to write the WHERE predicate.
///
/// Use for `.watch()` bucket queries where Drift reactivity must track the
/// shared_space_* tables. Caller merges the returned `joins` into its own
/// `.join([...existing, ...viz.joins])` call and adds
/// `viz.assetMember.userId.isNotNull() | viz.libraryMember.userId.isNotNull()`
/// to its WHERE predicate (OR-ed with `rae.ownerId.isIn(userIds)`).
ViewerVisibilityJoinSpec buildViewerVisibilityJoins(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  String currentUserId,
) {
  throw UnimplementedError();
}

/// Returns an `Expression<bool>` matching assets visible to the viewer:
/// `ownerId IN userIds`, OR the asset is linked to a shared space (direct or
/// via library) whose member row for `currentUserId` has `showInTimeline=true`.
///
/// Use for `.get()` asset-list and marker queries where Drift reactivity is
/// irrelevant (one-shot futures). `isInQuery` naturally deduplicates.
Expression<bool> viewerVisibilityPredicate(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  List<String> userIds,
  String currentUserId,
) {
  throw UnimplementedError();
}
```

**Step 2: Compile check**

```bash
cd mobile && flutter analyze lib/infrastructure/repositories/viewer_visibility.dart
```

Expected: No errors. (Imports resolve, types parse.)

**Step 3: Commit**

```bash
git add mobile/lib/infrastructure/repositories/viewer_visibility.dart
git commit -m "feat(mobile): scaffold viewer_visibility.dart helper"
```

---

## Task 3: Implement `buildViewerVisibilityJoins`

**Goal:** Fill in the 4 LEFT OUTER JOINs so the function compiles and produces a valid `List<Join>`. No consumer yet — just verify it composes via a targeted test.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/viewer_visibility.dart`
- Create: `mobile/test/infrastructure/repositories/viewer_visibility_test.dart`

**Step 1: Write a failing compile-level test**

Create `mobile/test/infrastructure/repositories/viewer_visibility_test.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/viewer_visibility.dart';

void main() {
  late Drift db;

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  });

  tearDown(() async {
    await db.close();
  });

  test('buildViewerVisibilityJoins returns 4 joins and both aliased members', () {
    final spec = buildViewerVisibilityJoins(db, db.remoteAssetEntity, 'viewer-1');
    expect(spec.joins, hasLength(4));
    expect(spec.assetMember, isNotNull);
    expect(spec.libraryMember, isNotNull);
    // The two aliases must be distinct instances so their column refs don't collide.
    expect(identical(spec.assetMember, spec.libraryMember), isFalse);
  });

  test('viewerVisibilityPredicate returns a non-null Expression', () {
    final pred = viewerVisibilityPredicate(db, db.remoteAssetEntity, const ['user-1'], 'viewer-1');
    expect(pred, isNotNull);
  });
}
```

**Step 2: Run it — expect UnimplementedError**

```bash
cd mobile && flutter test test/infrastructure/repositories/viewer_visibility_test.dart
```

Expected: FAIL with `UnimplementedError`.

**Step 3: Implement `buildViewerVisibilityJoins`**

Replace the stub body in `viewer_visibility.dart`:

```dart
ViewerVisibilityJoinSpec buildViewerVisibilityJoins(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  String currentUserId,
) {
  final assetMember = db.alias(db.sharedSpaceMemberEntity, 'ssm_asset');
  final libraryMember = db.alias(db.sharedSpaceMemberEntity, 'ssm_lib');

  final joins = <Join>[
    leftOuterJoin(
      db.sharedSpaceAssetEntity,
      db.sharedSpaceAssetEntity.assetId.equalsExp(assetTable.id),
      useColumns: false,
    ),
    leftOuterJoin(
      assetMember,
      assetMember.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
          assetMember.userId.equals(currentUserId) &
          assetMember.showInTimeline.equals(true),
      useColumns: false,
    ),
    leftOuterJoin(
      db.sharedSpaceLibraryEntity,
      db.sharedSpaceLibraryEntity.libraryId.equalsExp(assetTable.libraryId),
      useColumns: false,
    ),
    leftOuterJoin(
      libraryMember,
      libraryMember.spaceId.equalsExp(db.sharedSpaceLibraryEntity.spaceId) &
          libraryMember.userId.equals(currentUserId) &
          libraryMember.showInTimeline.equals(true),
      useColumns: false,
    ),
  ];

  return (joins: joins, assetMember: assetMember, libraryMember: libraryMember);
}
```

**Step 4: Re-run test**

```bash
cd mobile && flutter test test/infrastructure/repositories/viewer_visibility_test.dart --plain-name "buildViewerVisibilityJoins"
```

Expected: PASS for the `buildViewerVisibilityJoins` test. The `viewerVisibilityPredicate` test still fails — that's Task 4.

**Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/viewer_visibility.dart mobile/test/infrastructure/repositories/viewer_visibility_test.dart
git commit -m "feat(mobile): buildViewerVisibilityJoins for .watch() bucket queries"
```

---

## Task 4: Implement `viewerVisibilityPredicate`

**Goal:** Fill in the `isInQuery` composition for asset-list / marker queries.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/viewer_visibility.dart`

**Step 1: Write the implementation**

Replace the stub body:

```dart
Expression<bool> viewerVisibilityPredicate(
  Drift db,
  $RemoteAssetEntityTable assetTable,
  List<String> userIds,
  String currentUserId,
) {
  final inSpaceAsset = assetTable.id.isInQuery(
    db.sharedSpaceAssetEntity.selectOnly()
      ..addColumns([db.sharedSpaceAssetEntity.assetId])
      ..join([
        innerJoin(
          db.sharedSpaceMemberEntity,
          db.sharedSpaceMemberEntity.spaceId.equalsExp(db.sharedSpaceAssetEntity.spaceId) &
              db.sharedSpaceMemberEntity.userId.equals(currentUserId) &
              db.sharedSpaceMemberEntity.showInTimeline.equals(true),
          useColumns: false,
        ),
      ]),
  );

  final inSpaceLibrary = assetTable.libraryId.isInQuery(
    db.sharedSpaceLibraryEntity.selectOnly()
      ..addColumns([db.sharedSpaceLibraryEntity.libraryId])
      ..join([
        innerJoin(
          db.sharedSpaceMemberEntity,
          db.sharedSpaceMemberEntity.spaceId.equalsExp(db.sharedSpaceLibraryEntity.spaceId) &
              db.sharedSpaceMemberEntity.userId.equals(currentUserId) &
              db.sharedSpaceMemberEntity.showInTimeline.equals(true),
          useColumns: false,
        ),
      ]),
  );

  return assetTable.ownerId.isIn(userIds) | inSpaceAsset | inSpaceLibrary;
}
```

**Step 2: Run both helper tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/viewer_visibility_test.dart
```

Expected: BOTH tests PASS.

**Step 3: Commit**

```bash
git add mobile/lib/infrastructure/repositories/viewer_visibility.dart
git commit -m "feat(mobile): viewerVisibilityPredicate for .get() asset-list and marker queries"
```

---

## Task 5: Change `video()` signature and thread params through

**Goal:** Update the signature of `video()` through the repository → `TimelineFactory` wrapper → `drift_video.page.dart` caller, WITHOUT implementing the new behavior yet. Give it a minimal body that uses just `ownerId.isIn(userIds)` (no space branch) so the rest of the app still compiles.

This isolates "signature plumbing" from "new behavior" — next task writes the visibility matrix tests against the new signature.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (video method — around line 482, verify first)
- Modify: `mobile/lib/domain/services/timeline.service.dart` (TimelineFactory.video — around line 76, verify first)
- Modify: `mobile/lib/presentation/pages/drift_video.page.dart` (caller — around line 18, verify first)

**Step 0: Verify current line numbers**

Line numbers in this plan come from a conversation-time snapshot. Confirm they're still accurate before editing:

```bash
cd mobile && grep -n 'TimelineQuery video\|^  TimelineService video\|timelineFactoryProvider).video' \
  lib/infrastructure/repositories/timeline.repository.dart \
  lib/domain/services/timeline.service.dart \
  lib/presentation/pages/drift_video.page.dart
```

Expected output: one hit per file showing the method or call. If any file is missing a hit, the line has moved — use the grep output to find the new location.

**Step 1: Update `DriftTimelineRepository.video()`**

Replace the existing `video` method:

```dart
TimelineQuery video(List<String> userIds, String currentUserId, GroupAssetsBy groupBy) => _remoteQueryBuilder(
  filter: (row) =>
      row.deletedAt.isNull() &
      row.type.equalsValue(AssetType.video) &
      row.visibility.equalsValue(AssetVisibility.timeline) &
      row.ownerId.isIn(userIds),
  origin: TimelineOrigin.video,
  groupBy: groupBy,
);
```

(Note: `currentUserId` is unused for now — suppress any lint with `// ignore: unused_element_parameter` if flutter_lints complains, or just accept the warning until Task 6 consumes it.)

**Step 2: Update `TimelineFactory.video()`**

In `mobile/lib/domain/services/timeline.service.dart` around line 76:

```dart
TimelineService video(List<String> userIds, String currentUserId) =>
    TimelineService(_timelineRepository.video(userIds, currentUserId, groupBy));
```

**Step 3: Update `drift_video.page.dart`**

Around lines 18-27:

```dart
timelineServiceProvider.overrideWith((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    throw Exception('User must be logged in to video');
  }
  final users = ref.watch(timelineUsersProvider).valueOrNull ?? [user.id];

  final timelineService = ref.watch(timelineFactoryProvider).video(users, user.id);
  ref.onDispose(timelineService.dispose);
  return timelineService;
}),
```

Check for existing `timelineUsersProvider` import at the top of the file — if absent, add:

```dart
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
```

**Step 4: Run `flutter analyze`**

```bash
cd mobile && flutter analyze lib/infrastructure/repositories/timeline.repository.dart lib/domain/services/timeline.service.dart lib/presentation/pages/drift_video.page.dart
```

Expected: No errors. Warnings about `unused_element_parameter` or similar are acceptable.

**Step 5: Run the existing test suite to confirm nothing broke**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart
```

Expected: all existing tests still PASS (they don't touch `video()` yet).

**Step 6: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart mobile/lib/domain/services/timeline.service.dart mobile/lib/presentation/pages/drift_video.page.dart
git commit -m "refactor(mobile): thread userIds+currentUserId through video() signature"
```

---

## Task 6: TDD the `video()` visibility matrix (14 tests)

**Goal:** Write the 14 visibility tests from the design matrix, run them, watch them fail, then rewrite `video()` to use the helper so all 14 pass.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (rewrite `video`, add `_watchVideoBucket`, `_getVideoBucketAssets`)

**Step 0: Verify `libraryId` exists on `remote_asset_entity`**

The fixture below inserts rows with a nullable `libraryId` column, which tests 7, 8, 10, 11 depend on. Confirm the column exists and is nullable before proceeding:

```bash
cd mobile && grep -n 'libraryId' lib/infrastructure/entities/remote_asset.entity.dart
```

Expected: one or more matches including a `TextColumn get libraryId => text().nullable()` (or similar). If missing, the design's library-linked space visibility assumption is wrong — STOP and reconsider scope.

**Step 1: Add shared fixture helpers at `main()` scope**

These helpers must be declared **at `main()`'s top-level scope** (after `tearDown` but outside any `group` block) so every test group — `video()`, `place()`, `map()`, markers — can reuse them. Do NOT nest them inside the video group.

```dart
Future<void> _insertUser(String id) => db
    .into(db.userEntity)
    .insert(UserEntityCompanion.insert(id: id, email: '$id@test', name: id));

Future<void> _insertVideo(
  String id,
  String ownerId, {
  String? libraryId,
  AssetType type = AssetType.video,
  AssetVisibility visibility = AssetVisibility.timeline,
}) {
  final createdAt = DateTime(2024, 1, 1, 12);
  return db
      .into(db.remoteAssetEntity)
      .insert(
        RemoteAssetEntityCompanion.insert(
          id: id,
          name: '$id.mp4',
          type: type,
          checksum: 'c-$id',
          ownerId: ownerId,
          visibility: visibility,
          createdAt: Value(createdAt),
          updatedAt: Value(createdAt),
          localDateTime: Value(createdAt),
          libraryId: Value(libraryId),
        ),
      );
}

Future<void> _insertSpace(String id, String ownerId) => db
    .into(db.sharedSpaceEntity)
    .insert(SharedSpaceEntityCompanion.insert(id: id, name: id, createdById: ownerId));

Future<void> _insertMember(
  String spaceId,
  String userId, {
  bool showInTimeline = true,
}) => db
    .into(db.sharedSpaceMemberEntity)
    .insert(
      SharedSpaceMemberEntityCompanion.insert(
        spaceId: spaceId,
        userId: userId,
        role: 'viewer',
        showInTimeline: Value(showInTimeline),
      ),
    );

Future<void> _linkAssetToSpace(String spaceId, String assetId) => db
    .into(db.sharedSpaceAssetEntity)
    .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

Future<void> _linkLibraryToSpace(String spaceId, String libraryId) => db
    .into(db.sharedSpaceLibraryEntity)
    .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

Future<int> _videoBucketCount(List<String> userIds, String currentUserId) async {
  final sub = sut.video(userIds, currentUserId, GroupAssetsBy.day).bucketSource();
  final first = await sub.first;
  return first.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
}

Future<List<BaseAsset>> _videoBucketAssets(List<String> userIds, String currentUserId) {
  return sut.video(userIds, currentUserId, GroupAssetsBy.day).assetSource(0, 100);
}
```

Note: the two helper methods at the bottom (`_videoBucketCount`, `_videoBucketAssets`) use the new signature, so the test file will currently fail to compile against the old signature — that's expected, it's the "red" step.

**Step 2: Add a `group('DriftTimelineRepository.video()', () { ... })` block with the 14 tests**

Paste these 14 tests inside the group. Each uses the helpers above. Write them concisely:

```dart
group('DriftTimelineRepository.video() visibility matrix', () {
  test('1. owner asset visible', () async {
    await _insertUser('viewer');
    await _insertVideo('a1', 'viewer');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
    expect(await _videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
  });

  test('2. partner asset (owner in userIds) visible', () async {
    await _insertUser('viewer');
    await _insertUser('partner');
    await _insertVideo('a1', 'partner');
    expect(await _videoBucketCount(['viewer', 'partner'], 'viewer'), 1);
  });

  test('3. unrelated user asset hidden', () async {
    await _insertUser('viewer');
    await _insertUser('stranger');
    await _insertVideo('a1', 'stranger');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 0);
  });

  test('4. space asset, viewer member, showInTimeline=true → visible', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer', showInTimeline: true);
    await _linkAssetToSpace('space1', 'a1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
  });

  test('5. space asset, viewer member, showInTimeline=false → hidden', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer', showInTimeline: false);
    await _linkAssetToSpace('space1', 'a1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 0);
  });

  test('6. space asset where partner is member but viewer is NOT → hidden', () async {
    await _insertUser('viewer');
    await _insertUser('partner');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'partner', showInTimeline: true); // partner yes
    // viewer is NOT inserted as a member
    await _linkAssetToSpace('space1', 'a1');
    // Even though partner is in userIds, currentUserId scopes visibility to viewer.
    expect(await _videoBucketCount(['viewer', 'partner'], 'viewer'), 0);
  });

  test('7. library-in-space, showInTimeline=true → visible', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', libraryId: 'lib1');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer', showInTimeline: true);
    await _linkLibraryToSpace('space1', 'lib1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
  });

  test('8. library-in-space, showInTimeline=false → hidden', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', libraryId: 'lib1');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer', showInTimeline: false);
    await _linkLibraryToSpace('space1', 'lib1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 0);
  });

  test('9. asset in 2 directly-linked spaces → counted once', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner');
    await _insertSpace('space1', 'owner');
    await _insertSpace('space2', 'owner');
    await _insertMember('space1', 'viewer');
    await _insertMember('space2', 'viewer');
    await _linkAssetToSpace('space1', 'a1');
    await _linkAssetToSpace('space2', 'a1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
    expect(await _videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
  });

  test('10. asset reachable via BOTH direct and library links on same space → counted once', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', libraryId: 'lib1');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');
    await _linkLibraryToSpace('space1', 'lib1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
    expect(await _videoBucketAssets(['viewer'], 'viewer'), hasLength(1));
  });

  test('11. asset with library_id NULL reachable via shared_space_asset → visible', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner'); // no libraryId
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 1);
  });

  test('12. asset with library_id NULL NOT in any space → hidden', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner'); // no libraryId, no space link
    expect(await _videoBucketCount(['viewer'], 'viewer'), 0);
  });

  test('13. image asset reachable via space → hidden (type filter still applies)', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');
    expect(await _videoBucketCount(['viewer'], 'viewer'), 0);
  });

  test('14. userIds = [user.id] only (loading fallback) → owner visible, space branches still work', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('owned', 'viewer');
    await _insertVideo('space', 'owner');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'space');
    // userIds contains only viewer (partners still loading) — both should appear.
    expect(await _videoBucketCount(['viewer'], 'viewer'), 2);
  });
});
```

**Step 3: Run the matrix — expect fails**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "video() visibility matrix"
```

Expected: Tests 1, 2, 3, 12, 14 (partial) may pass incidentally against the placeholder `video()` that only uses `ownerId.isIn(userIds)`. Tests 4-11, 13 will fail. That's the "red" state.

**Step 4: Rewrite `video()` to use the helper**

In `timeline.repository.dart`, replace the placeholder `video()` from Task 5 with the full rewrite. Import the helper at the top of the file:

```dart
import 'package:immich_mobile/infrastructure/repositories/viewer_visibility.dart';
```

Replace the method:

```dart
TimelineQuery video(List<String> userIds, String currentUserId, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchVideoBucket(userIds, currentUserId, groupBy: groupBy),
  assetSource: (offset, count) =>
      _getVideoBucketAssets(userIds, currentUserId, offset: offset, count: count),
  origin: TimelineOrigin.video,
);

Stream<List<Bucket>> _watchVideoBucket(
  List<String> userIds,
  String currentUserId, {
  GroupAssetsBy groupBy = GroupAssetsBy.day,
}) {
  if (groupBy == GroupAssetsBy.none) {
    throw UnsupportedError('GroupAssetsBy.none is not supported for _watchVideoBucket');
  }

  final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
  final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
  final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

  final query = _db.remoteAssetEntity.selectOnly()
    ..addColumns([assetCountExp, dateExp])
    ..join(viz.joins)
    ..where(
      _db.remoteAssetEntity.deletedAt.isNull() &
          _db.remoteAssetEntity.type.equalsValue(AssetType.video) &
          _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
          (_db.remoteAssetEntity.ownerId.isIn(userIds) |
              viz.assetMember.userId.isNotNull() |
              viz.libraryMember.userId.isNotNull()),
    )
    ..groupBy([dateExp])
    ..orderBy([OrderingTerm.desc(dateExp)]);

  return query.map((row) {
    final timeline = row.read(dateExp)!.truncateDate(groupBy);
    final assetCount = row.read(assetCountExp)!;
    return TimeBucket(date: timeline, assetCount: assetCount);
  }).watch();
}

Future<List<BaseAsset>> _getVideoBucketAssets(
  List<String> userIds,
  String currentUserId, {
  required int offset,
  required int count,
}) {
  final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

  final query = _db.remoteAssetEntity.select()
    ..where(
      (row) =>
          row.deletedAt.isNull() &
          row.type.equalsValue(AssetType.video) &
          row.visibility.equalsValue(AssetVisibility.timeline) &
          visibilityPredicate,
    )
    ..orderBy([(row) => OrderingTerm.desc(row.createdAt)])
    ..limit(count, offset: offset);

  return query.map((row) => row.toDto()).get();
}
```

> **Row-to-DTO pattern:** before writing `_getVideoBucketAssets`, read `_getRemoteAssets` in `timeline.repository.dart` and mirror its `joinLocal: false` branch. The snippet above uses `row.toDto()` assuming the `RemoteAssetEntityData` extension is a bare `.toDto()`. If `_getRemoteAssets` uses a different shape (e.g., `row.toDto(localId: null)`, or a `.select().join([])` pattern with `readTable`), use that form instead. Do NOT invent a new shape — mirror the existing non-join code path exactly, minus the `filter` lambda indirection.

**Step 5: Re-run the matrix**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "video() visibility matrix"
```

Expected: all 14 tests PASS.

**Step 6: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart mobile/lib/infrastructure/repositories/timeline.repository.dart
git commit -m "feat(mobile): video() respects shared-space visibility

Rewrites video() to use buildViewerVisibilityJoins + viewerVisibilityPredicate.
14-test matrix covers owner, partner, space asset, library-in-space,
dedup, NULL libraryId, type filter, and loading-fallback cases."
```

---

## Task 7: `video()` reactivity test — shared_space_asset delete

**Goal:** Add a reactivity test that mirrors the existing `sharedSpace` reactivity pattern — subscribe to the bucket stream, delete a `shared_space_asset` row, assert re-emission.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`

**Step 1: Add the test inside the video group**

```dart
test('video() bucket stream re-emits when a shared_space_asset row is deleted', () async {
  await _insertUser('viewer');
  await _insertUser('owner');
  await _insertVideo('a1', 'owner');
  await _insertSpace('space1', 'owner');
  await _insertMember('space1', 'viewer');
  await _linkAssetToSpace('space1', 'a1');

  final emissions = <List<Bucket>>[];
  final sub = sut
      .video(['viewer'], 'viewer', GroupAssetsBy.day)
      .bucketSource()
      .listen(emissions.add);

  await _waitFor(() => emissions.isNotEmpty);
  expect(emissions.last, hasLength(1));

  await (db.delete(db.sharedSpaceAssetEntity)
        ..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1')))
      .go();

  await _waitFor(() => emissions.length >= 2);
  expect(emissions.last, isEmpty);

  await sub.cancel();
});
```

**Step 2: Run it**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "video() bucket stream re-emits when a shared_space_asset"
```

Expected: PASS (the pre-flight test in Task 1 already proved aliased-join reactivity works; this test applies it to the helper-built query).

**Step 3: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart
git commit -m "test(mobile): video() reactivity on shared_space_asset delete"
```

---

## Task 8: `video()` reactivity test — showInTimeline toggle (load-bearing)

**Goal:** The strongest reactivity test — toggles `shared_space_member.show_in_timeline` on a live stream. This is functionally the same as the pre-flight (Task 1) but now running through the actual helper and production `video()` method.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`

**Step 1: Add the test inside the video group**

```dart
test('video() bucket stream re-emits when shared_space_member.showInTimeline toggles', () async {
  await _insertUser('viewer');
  await _insertUser('owner');
  await _insertVideo('a1', 'owner');
  await _insertSpace('space1', 'owner');
  await _insertMember('space1', 'viewer', showInTimeline: true);
  await _linkAssetToSpace('space1', 'a1');

  final emissions = <List<Bucket>>[];
  final sub = sut
      .video(['viewer'], 'viewer', GroupAssetsBy.day)
      .bucketSource()
      .listen(emissions.add);

  await _waitFor(() => emissions.isNotEmpty);
  expect((emissions.last.single as TimeBucket).assetCount, 1);

  // Flip the member's showInTimeline flag off.
  await (db.update(db.sharedSpaceMemberEntity)
        ..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer')))
      .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(false)));

  await _waitFor(() => emissions.length >= 2);
  expect(
    emissions.last,
    isEmpty,
    reason:
        'Toggling showInTimeline=false on the viewer\'s member row must drop the space asset '
        'from the video bucket stream immediately',
  );

  // Flip it back on — verify symmetric reactivity.
  await (db.update(db.sharedSpaceMemberEntity)
        ..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer')))
      .write(const SharedSpaceMemberEntityCompanion(showInTimeline: Value(true)));

  await _waitFor(() => emissions.length >= 3);
  expect(
    (emissions.last.single as TimeBucket).assetCount,
    1,
    reason: 'Toggling showInTimeline=true must bring the space asset back into the bucket',
  );

  await sub.cancel();
});

test('video() bucket stream re-emits when shared_space_member row is deleted', () async {
  // Complementary to the toggle test — covers the case where the viewer is
  // removed from the space entirely (member row deleted, not updated).
  await _insertUser('viewer');
  await _insertUser('owner');
  await _insertVideo('a1', 'owner');
  await _insertSpace('space1', 'owner');
  await _insertMember('space1', 'viewer', showInTimeline: true);
  await _linkAssetToSpace('space1', 'a1');

  final emissions = <List<Bucket>>[];
  final sub = sut
      .video(['viewer'], 'viewer', GroupAssetsBy.day)
      .bucketSource()
      .listen(emissions.add);

  await _waitFor(() => emissions.isNotEmpty);
  expect((emissions.last.single as TimeBucket).assetCount, 1);

  await (db.delete(db.sharedSpaceMemberEntity)
        ..where((t) => t.spaceId.equals('space1') & t.userId.equals('viewer')))
      .go();

  await _waitFor(() => emissions.length >= 2);
  expect(
    emissions.last,
    isEmpty,
    reason:
        'Deleting the viewer\'s shared_space_member row must drop the space asset '
        'from the video bucket stream',
  );

  await sub.cancel();
});
```

**Step 2: Run the tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "showInTimeline toggles"
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "shared_space_member row is deleted"
```

Expected: BOTH PASS. If EITHER fails, the helper architecture is broken — stop and redesign around `.drift` SQL files (same rollback procedure as Task 1).

**Step 3: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart
git commit -m "test(mobile): video() reactivity on showInTimeline toggle and member delete (load-bearing)"
```

---

## Task 9: Thread `place()` signature + caller

**Goal:** Same as Task 5 but for `place()`. Signature plumbing only — behavior rewrite comes in Task 10.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (place method)
- Modify: `mobile/lib/domain/services/timeline.service.dart` (TimelineFactory.place)
- Modify: `mobile/lib/presentation/pages/drift_place_detail.page.dart`

**Step 0: Verify current line numbers**

```bash
cd mobile && grep -n 'TimelineQuery place\|^  TimelineService place\|timelineFactoryProvider).place' \
  lib/infrastructure/repositories/timeline.repository.dart \
  lib/domain/services/timeline.service.dart \
  lib/presentation/pages/drift_place_detail.page.dart
```

**Step 1: Update repository method (placeholder body)**

Temporarily keep the existing behavior — just accept the new params but don't use them yet. The implementation in Task 10 will wire them in.

```dart
TimelineQuery place(String place, List<String> userIds, String currentUserId, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchPlaceBucket(place, groupBy: groupBy),
  assetSource: (offset, count) => _getPlaceBucketAssets(place, offset: offset, count: count),
  origin: TimelineOrigin.place,
);
```

**Step 2: Update `TimelineFactory.place`**

```dart
TimelineService place(String place, List<String> userIds, String currentUserId) =>
    TimelineService(_timelineRepository.place(place, userIds, currentUserId, groupBy));
```

**Step 3: Update `drift_place_detail.page.dart`**

```dart
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart'; // or wherever currentUserProvider lives — verify

// inside build():
timelineServiceProvider.overrideWith((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    throw Exception('User must be logged in to access place');
  }
  final users = ref.watch(timelineUsersProvider).valueOrNull ?? [user.id];

  final timelineService = ref.watch(timelineFactoryProvider).place(place, users, user.id);
  ref.onDispose(timelineService.dispose);
  return timelineService;
}),
```

**Check** — verify the exact import path for `currentUserProvider` by grepping:

```bash
cd mobile && grep -r "currentUserProvider" lib/presentation/pages/drift_video.page.dart
```

Use the same import path `drift_video.page.dart` uses.

**Step 4: Analyze**

```bash
cd mobile && flutter analyze lib/infrastructure/repositories/timeline.repository.dart lib/domain/services/timeline.service.dart lib/presentation/pages/drift_place_detail.page.dart
```

Expected: no errors.

**Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart mobile/lib/domain/services/timeline.service.dart mobile/lib/presentation/pages/drift_place_detail.page.dart
git commit -m "refactor(mobile): thread userIds+currentUserId through place() signature"
```

---

## Task 10: TDD the `place()` method-specific tests and rewrite

**Goal:** Add 3 method-specific tests (wrong city hidden, right city via space visible, reactivity) then rewrite `_watchPlaceBucket` / `_getPlaceBucketAssets` to use the helper.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (rewrite `_watchPlaceBucket` + `_getPlaceBucketAssets`)

**Step 1: Add the place test group**

Add a `group('DriftTimelineRepository.place()', () { ... })` inside `main()`:

```dart
group('DriftTimelineRepository.place()', () {
  Future<void> _insertExif(String assetId, String? city) => db
      .into(db.remoteExifEntity)
      .insert(RemoteExifEntityCompanion.insert(assetId: assetId, city: Value(city)));

  test('place() hides assets with wrong city even when viewer-visible', () async {
    await _insertUser('viewer');
    await _insertVideo('a1', 'viewer', type: AssetType.image);
    await _insertExif('a1', 'Berlin');

    final buckets = await sut
        .place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day)
        .bucketSource()
        .first;
    expect(buckets, isEmpty);
  });

  test('place() shows right-city asset reachable via shared space', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExif('a1', 'Paris');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final buckets = await sut
        .place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day)
        .bucketSource()
        .first;
    expect(buckets, hasLength(1));
    expect((buckets.single as TimeBucket).assetCount, 1);
  });

  test('place() bucket stream re-emits when a shared_space_asset row is deleted', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExif('a1', 'Paris');
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final emissions = <List<Bucket>>[];
    final sub = sut
        .place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day)
        .bucketSource()
        .listen(emissions.add);

    await _waitFor(() => emissions.isNotEmpty);
    expect(emissions.last, hasLength(1));

    await (db.delete(db.sharedSpaceAssetEntity)
          ..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1')))
        .go();

    await _waitFor(() => emissions.length >= 2);
    expect(emissions.last, isEmpty);

    await sub.cancel();
  });
});
```

Note the new imports required: `package:immich_mobile/infrastructure/entities/exif.entity.drift.dart` for `RemoteExifEntityCompanion`.

**Step 2: Run the tests — expect reactivity test to fail, others incidental pass**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "DriftTimelineRepository.place"
```

Expected against the Task 9 placeholder (which calls the OLD `_watchPlaceBucket(place, groupBy)` with no viewer filter):

- **Test 1** (wrong city hidden) → PASS. City filter still works on the old query.
- **Test 2** (space asset right-city visible) → PASS **incidentally**. The old query has NO viewer filter at all, so any asset matching the city appears. This test is correct-for-the-wrong-reason — the rewrite in Step 3 makes it correct-for-the-right-reason.
- **Test 3** (reactivity on shared_space_asset delete) → **FAIL**. The old query doesn't reference `shared_space_asset`, so Drift's `readsFrom` set never includes that table. Deleting a row from it does not re-emit the stream; the test times out at "Timed out after 2s waiting for condition" on `emissions.length >= 2`.

Tests 1 and 2 are passing-for-the-wrong-reason; test 3 is the real red. Proceed to Step 3 to rewrite.

**Step 3: Rewrite `_watchPlaceBucket` and `_getPlaceBucketAssets`**

Replace both methods in `timeline.repository.dart`. Find them near line 504 and 537:

```dart
TimelineQuery place(String place, List<String> userIds, String currentUserId, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchPlaceBucket(place, userIds, currentUserId, groupBy: groupBy),
  assetSource: (offset, count) => _getPlaceBucketAssets(place, userIds, currentUserId, offset: offset, count: count),
  origin: TimelineOrigin.place,
);

Stream<List<Bucket>> _watchPlaceBucket(
  String place,
  List<String> userIds,
  String currentUserId, {
  GroupAssetsBy groupBy = GroupAssetsBy.day,
}) {
  if (groupBy == GroupAssetsBy.none) {
    throw UnsupportedError('GroupAssetsBy.none is not supported for _watchPlaceBucket');
  }

  final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
  final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
  final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

  final query = _db.remoteAssetEntity.selectOnly()
    ..addColumns([assetCountExp, dateExp])
    ..join([
      innerJoin(
        _db.remoteExifEntity,
        _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
        useColumns: false,
      ),
      ...viz.joins,
    ])
    ..where(
      _db.remoteExifEntity.city.equals(place) &
          _db.remoteAssetEntity.deletedAt.isNull() &
          _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
          (_db.remoteAssetEntity.ownerId.isIn(userIds) |
              viz.assetMember.userId.isNotNull() |
              viz.libraryMember.userId.isNotNull()),
    )
    ..groupBy([dateExp])
    ..orderBy([OrderingTerm.desc(dateExp)]);

  return query.map((row) {
    final timeline = row.read(dateExp)!.truncateDate(groupBy);
    final assetCount = row.read(assetCountExp)!;
    return TimeBucket(date: timeline, assetCount: assetCount);
  }).watch();
}

Future<List<BaseAsset>> _getPlaceBucketAssets(
  String place,
  List<String> userIds,
  String currentUserId, {
  required int offset,
  required int count,
}) {
  final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

  final query =
      _db.remoteAssetEntity.select().join([
          innerJoin(
            _db.remoteExifEntity,
            _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
              _db.remoteExifEntity.city.equals(place) &
              visibilityPredicate,
        )
        ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
        ..limit(count, offset: offset);

  return query.map((row) => row.readTable(_db.remoteAssetEntity).toDto()).get();
}
```

**Step 4: Re-run place tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "DriftTimelineRepository.place"
```

Expected: all 3 PASS.

Also add a hidden-asset regression test to verify the narrowing:

```dart
test('place() hides stranger asset with matching city (place narrowing)', () async {
  await _insertUser('viewer');
  await _insertUser('stranger');
  await _insertVideo('a1', 'stranger', type: AssetType.image);
  await _insertExif('a1', 'Paris');

  final buckets = await sut
      .place('Paris', ['viewer'], 'viewer', GroupAssetsBy.day)
      .bucketSource()
      .first;
  expect(buckets, isEmpty, reason: 'Unowned, unshared asset must not appear on place detail');
});
```

Run all place tests again to confirm this regression test passes too.

**Step 5: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart mobile/lib/infrastructure/repositories/timeline.repository.dart
git commit -m "feat(mobile): place() respects shared-space visibility

Narrows place() from unfiltered (leaky) to owner+partners+shared-space
via the shared viewer_visibility helpers. Behavior change: assets
the viewer does not own, does not share a partner timeline with, and
is not a shared-space member for will no longer appear on place
detail pages even if they happen to be cached locally."
```

---

## Task 11: Thread `map()` (bucket sheet) signature + caller

**Goal:** Same plumbing pattern as tasks 5 and 9, but for `DriftTimelineRepository.map()`.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart` (map method)
- Modify: `mobile/lib/domain/services/timeline.service.dart` (TimelineFactory.map)
- Modify: `mobile/lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart`

**Step 0: Verify current line numbers**

```bash
cd mobile && grep -n 'TimelineQuery map\|^  TimelineService map\|timelineFactoryProvider).map' \
  lib/infrastructure/repositories/timeline.repository.dart \
  lib/domain/services/timeline.service.dart \
  lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart
```

**Step 1: Update `DriftTimelineRepository.map()` (placeholder)**

```dart
TimelineQuery map(List<String> userIds, String currentUserId, TimelineMapOptions options, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchMapBucket(userIds, options, groupBy: groupBy),
  assetSource: (offset, count) => _getMapBucketAssets(userIds, options, offset: offset, count: count),
  origin: TimelineOrigin.map,
);
```

**Step 2: Update `TimelineFactory.map()`**

```dart
TimelineService map(List<String> userIds, String currentUserId, TimelineMapOptions options) =>
    TimelineService(_timelineRepository.map(userIds, currentUserId, options, groupBy));
```

**Step 3: Update `map_bottom_sheet.widget.dart`**

Around line 47:

```dart
final timelineService = ref
    .watch(timelineFactoryProvider)
    .map(users, user.id, ref.watch(mapStateProvider).toOptions());
```

**Step 4: Analyze**

```bash
cd mobile && flutter analyze lib/infrastructure/repositories/timeline.repository.dart lib/domain/services/timeline.service.dart lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart
```

Expected: no errors.

**Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/timeline.repository.dart mobile/lib/domain/services/timeline.service.dart mobile/lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart
git commit -m "refactor(mobile): thread userIds+currentUserId through TimelineRepository.map()"
```

---

## Task 12: TDD the `map()` method-specific tests and rewrite

**Goal:** 4 method-specific tests (out of bounds hidden, in-bounds via space visible, relativeDays cutoff, reactivity) + rewrite `_watchMapBucket` and `_getMapBucketAssets` to use the helper, preserving dynamic filters.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`

**Step 1: Add the `map()` test group**

```dart
group('DriftTimelineRepository.map() bucket sheet', () {
  LatLngBounds _globeBounds() => LatLngBounds(
        southwest: const LatLng(-89, -179),
        northeast: const LatLng(89, 179),
      );

  LatLngBounds _europeBounds() => LatLngBounds(
        southwest: const LatLng(35, -10),
        northeast: const LatLng(70, 40),
      );

  Future<void> _insertExifAt(String assetId, double lat, double lng) => db
      .into(db.remoteExifEntity)
      .insert(
        RemoteExifEntityCompanion.insert(
          assetId: assetId,
          latitude: Value(lat),
          longitude: Value(lng),
        ),
      );

  test('map() hides out-of-bounds asset even when viewer-visible', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExifAt('a1', 48.85, 2.35); // Paris
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    // North American bounds
    final naBounds = LatLngBounds(
      southwest: const LatLng(20, -130),
      northeast: const LatLng(60, -60),
    );

    final buckets = await sut
        .map(['viewer'], 'viewer', TimelineMapOptions(bounds: naBounds), GroupAssetsBy.day)
        .bucketSource()
        .first;
    expect(buckets, isEmpty);
  });

  test('map() shows in-bounds asset reachable via shared space', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExifAt('a1', 48.85, 2.35);
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final buckets = await sut
        .map(['viewer'], 'viewer', TimelineMapOptions(bounds: _europeBounds()), GroupAssetsBy.day)
        .bucketSource()
        .first;
    expect(buckets, hasLength(1));
    expect((buckets.single as TimeBucket).assetCount, 1);
  });

  test('map() relativeDays cutoff excludes older space asset', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    // Insert an old asset (1 year ago)
    final oldDate = DateTime.now().subtract(const Duration(days: 365));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: 'a1',
            name: 'a1.jpg',
            type: AssetType.image,
            checksum: 'c-a1',
            ownerId: 'owner',
            visibility: AssetVisibility.timeline,
            createdAt: Value(oldDate),
            updatedAt: Value(oldDate),
            localDateTime: Value(oldDate),
          ),
        );
    await _insertExifAt('a1', 48.85, 2.35);
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final buckets = await sut
        .map(
          ['viewer'],
          'viewer',
          TimelineMapOptions(bounds: _globeBounds(), relativeDays: 7),
          GroupAssetsBy.day,
        )
        .bucketSource()
        .first;
    expect(buckets, isEmpty);
  });

  test('map() bucket stream re-emits when shared_space_asset row is deleted', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExifAt('a1', 48.85, 2.35);
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final emissions = <List<Bucket>>[];
    final sub = sut
        .map(
          ['viewer'],
          'viewer',
          TimelineMapOptions(bounds: _europeBounds()),
          GroupAssetsBy.day,
        )
        .bucketSource()
        .listen(emissions.add);

    await _waitFor(() => emissions.isNotEmpty);
    expect(emissions.last, hasLength(1));

    await (db.delete(db.sharedSpaceAssetEntity)
          ..where((t) => t.spaceId.equals('space1') & t.assetId.equals('a1')))
        .go();

    await _waitFor(() => emissions.length >= 2);
    expect(emissions.last, isEmpty);

    await sub.cancel();
  });
});
```

Add the required import at the top: `import 'package:maplibre_gl/maplibre_gl.dart';`.

**Step 2: Run tests — expect failures**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "map() bucket sheet"
```

Expected: the "shows in-bounds asset reachable via shared space" test FAILS (placeholder map() still filters by ownerId only).

**Step 3: Rewrite `_watchMapBucket` and `_getMapBucketAssets`**

Replace both methods in `timeline.repository.dart` (around lines 646 and 696):

```dart
Stream<List<Bucket>> _watchMapBucket(
  List<String> userIds,
  String currentUserId,
  TimelineMapOptions options, {
  GroupAssetsBy groupBy = GroupAssetsBy.day,
}) {
  if (groupBy == GroupAssetsBy.none) {
    throw UnsupportedError('GroupAssetsBy.none is not supported for _watchMapBucket');
  }

  // NOTE: Mobile map() currently allows `withPartners`+shared-space branches
  // when `onlyFavorites` or `includeArchived` is true, which diverges from the
  // server's restriction (timeline.service.ts rejects that combination). We
  // preserve the mobile-specific behavior here intentionally; aligning with
  // the server is tracked separately.

  final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
  final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
  final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

  final query = _db.remoteAssetEntity.selectOnly()
    ..addColumns([assetCountExp, dateExp])
    ..join([
      innerJoin(
        _db.remoteExifEntity,
        _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
        useColumns: false,
      ),
      ...viz.joins,
    ])
    ..where(
      _db.remoteExifEntity.inBounds(options.bounds) &
          _db.remoteAssetEntity.visibility.isIn([
            AssetVisibility.timeline.index,
            if (options.includeArchived) AssetVisibility.archive.index,
          ]) &
          _db.remoteAssetEntity.deletedAt.isNull() &
          (_db.remoteAssetEntity.ownerId.isIn(userIds) |
              viz.assetMember.userId.isNotNull() |
              viz.libraryMember.userId.isNotNull()),
    )
    ..groupBy([dateExp])
    ..orderBy([OrderingTerm.desc(dateExp)]);

  if (options.onlyFavorites) {
    query.where(_db.remoteAssetEntity.isFavorite.equals(true));
  }

  if (options.relativeDays != 0) {
    final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));
    query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate));
  }

  return query.map((row) {
    final timeline = row.read(dateExp)!.truncateDate(groupBy);
    final assetCount = row.read(assetCountExp)!;
    return TimeBucket(date: timeline, assetCount: assetCount);
  }).watch();
}

Future<List<BaseAsset>> _getMapBucketAssets(
  List<String> userIds,
  String currentUserId,
  TimelineMapOptions options, {
  required int offset,
  required int count,
}) {
  final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

  final query =
      _db.remoteAssetEntity.select().join([
          innerJoin(
            _db.remoteExifEntity,
            _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteExifEntity.inBounds(options.bounds) &
              _db.remoteAssetEntity.visibility.isIn([
                AssetVisibility.timeline.index,
                if (options.includeArchived) AssetVisibility.archive.index,
              ]) &
              _db.remoteAssetEntity.deletedAt.isNull() &
              visibilityPredicate,
        )
        ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
        ..limit(count, offset: offset);

  if (options.onlyFavorites) {
    query.where(_db.remoteAssetEntity.isFavorite.equals(true));
  }

  if (options.relativeDays != 0) {
    final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));
    query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate));
  }

  return query.map((row) => row.readTable(_db.remoteAssetEntity).toDto()).get();
}
```

Update the `map()` method call sites to pass `currentUserId`:

```dart
TimelineQuery map(List<String> userIds, String currentUserId, TimelineMapOptions options, GroupAssetsBy groupBy) => (
  bucketSource: () => _watchMapBucket(userIds, currentUserId, options, groupBy: groupBy),
  assetSource: (offset, count) =>
      _getMapBucketAssets(userIds, currentUserId, options, offset: offset, count: count),
  origin: TimelineOrigin.map,
);
```

**Step 4: Run map tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "map() bucket sheet"
```

Expected: all 4 PASS.

**Step 5: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart mobile/lib/infrastructure/repositories/timeline.repository.dart
git commit -m "feat(mobile): TimelineRepository.map() respects shared-space visibility

Rewrites _watchMapBucket and _getMapBucketAssets to use the shared
viewer_visibility helpers. Preserves dynamic where clauses for
onlyFavorites, relativeDays, and includeArchived. Documents the
mobile-specific divergence from the server's withPartners/archive
restriction."
```

---

## Task 13: Thread `DriftMapRepository.remote()` signature + caller

**Goal:** Same plumbing pattern for the marker query.

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/map.repository.dart` (DriftMapRepository.remote)
- Modify: `mobile/lib/domain/services/map.service.dart` (MapFactory.remote)
- Modify: `mobile/lib/providers/infrastructure/map.provider.dart`

**Step 0: Verify `MapFactory.remote` exists and grab line numbers**

```bash
cd mobile && grep -n 'MapQuery remote\|^  MapQuery remote\|mapFactoryProvider).remote' \
  lib/infrastructure/repositories/map.repository.dart \
  lib/domain/services/map.service.dart \
  lib/providers/infrastructure/map.provider.dart
```

Confirm all three hits exist. If `MapFactory.remote()` is missing from `map.service.dart`, the `MapFactory` class may have a different method name — fix the plan before continuing.

**Step 1: Update `DriftMapRepository.remote()` (placeholder)**

```dart
MapQuery remote(List<String> userIds, String currentUserId, TimelineMapOptions options) => _mapQueryBuilder(
  assetFilter: (row) {
    Expression<bool> condition =
        row.deletedAt.isNull() &
        row.ownerId.isIn(userIds) &
        _db.remoteAssetEntity.visibility.isIn([
          AssetVisibility.timeline.index,
          if (options.includeArchived) AssetVisibility.archive.index,
        ]);

    if (options.onlyFavorites) {
      condition = condition & _db.remoteAssetEntity.isFavorite.equals(true);
    }

    if (options.relativeDays != 0) {
      final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));
      condition = condition & _db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate);
    }

    return condition;
  },
);
```

**Step 2: Update `MapFactory.remote`**

```dart
MapQuery remote(List<String> userIds, String currentUserId, TimelineMapOptions options) =>
    _mapRepository.remote(userIds, currentUserId, options);
```

**Step 3: Update `map.provider.dart`**

Around line 22:

```dart
final mapService = ref
    .watch(mapFactoryProvider)
    .remote(users, user.id, ref.watch(mapStateProvider).toOptions());
```

**Step 4: Analyze**

```bash
cd mobile && flutter analyze lib/infrastructure/repositories/map.repository.dart lib/domain/services/map.service.dart lib/providers/infrastructure/map.provider.dart
```

Expected: no errors.

**Step 5: Commit**

```bash
git add mobile/lib/infrastructure/repositories/map.repository.dart mobile/lib/domain/services/map.service.dart mobile/lib/providers/infrastructure/map.provider.dart
git commit -m "refactor(mobile): thread userIds+currentUserId through DriftMapRepository.remote()"
```

---

## Task 14: TDD the marker tests and rewrite

**Goal:** 2 marker tests (owner marker returned, space-visible marker returned) + inject the predicate into the filter.

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart` (add marker group, or create a new file — check existing layout)
- Modify: `mobile/lib/infrastructure/repositories/map.repository.dart`

**Step 1: Check if there's an existing map.repository test**

```bash
cd mobile && ls test/infrastructure/repositories/ | grep -i map
```

If none exists, create `mobile/test/infrastructure/repositories/map_repository_test.dart` with the same setup pattern as `timeline_repository_test.dart` (in-memory Drift, shared fixture helpers) but importing `DriftMapRepository`. Otherwise extend the existing file.

**Step 2: Add the 2 marker tests**

```dart
group('DriftMapRepository.remote()', () {
  late DriftMapRepository mapSut;

  setUp(() {
    mapSut = DriftMapRepository(db);
  });

  LatLngBounds _globeBounds() => LatLngBounds(
        southwest: const LatLng(-89, -179),
        northeast: const LatLng(89, 179),
      );

  Future<void> _insertExifAt(String assetId, double lat, double lng) => db
      .into(db.remoteExifEntity)
      .insert(
        RemoteExifEntityCompanion.insert(
          assetId: assetId,
          latitude: Value(lat),
          longitude: Value(lng),
        ),
      );

  test('owner marker returned', () async {
    await _insertUser('viewer');
    await _insertVideo('a1', 'viewer', type: AssetType.image);
    await _insertExifAt('a1', 48.85, 2.35);

    final markers = await mapSut
        .remote(['viewer'], 'viewer', TimelineMapOptions(bounds: _globeBounds()))
        .markerSource(_globeBounds());
    expect(markers, hasLength(1));
  });

  test('space-visible marker returned', () async {
    await _insertUser('viewer');
    await _insertUser('owner');
    await _insertVideo('a1', 'owner', type: AssetType.image);
    await _insertExifAt('a1', 48.85, 2.35);
    await _insertSpace('space1', 'owner');
    await _insertMember('space1', 'viewer');
    await _linkAssetToSpace('space1', 'a1');

    final markers = await mapSut
        .remote(['viewer'], 'viewer', TimelineMapOptions(bounds: _globeBounds()))
        .markerSource(_globeBounds());
    expect(markers, hasLength(1));
  });
});
```

Note on the double `bounds` argument: the test passes globe bounds twice — once inside `TimelineMapOptions(bounds: _globeBounds())` and once as the argument to `markerSource(_globeBounds())`. This is a pre-existing API oddity: `DriftMapRepository.remote()` reads non-bounds options (`onlyFavorites`, `relativeDays`, `includeArchived`) from `TimelineMapOptions`, but bounds is separately passed to `markerSource(bounds)` at call time by the map UI. The test mirrors that shape.

Verify `markerSource`'s actual signature in `map.repository.dart` before running — the existing `MapQuery` type is `(markerSource: (bounds) => ...)` per the original code. If the signature changed (e.g., now takes `LatLngBounds?` nullable), adjust the test calls accordingly.

**Note on reactivity:** No reactivity test here. `DriftMapRepository.remote()` returns a `MapQuery` whose `markerSource` is a `Future<List<Marker>>`-returning function (one-shot `.get()`, NOT a `Stream`). Toggling membership or deleting space-asset rows has no "re-emit" to observe — reactivity tests belong only to `.watch()`-based bucket queries.

**Step 3: Run — expect 2nd test to fail**

```bash
cd mobile && flutter test test/infrastructure/repositories/map_repository_test.dart
```

Expected: `owner marker returned` passes, `space-visible marker returned` FAILS (placeholder has no space branch).

**Step 4: Rewrite the filter to use the predicate**

In `map.repository.dart`:

```dart
import 'package:immich_mobile/infrastructure/repositories/viewer_visibility.dart';

// ...

MapQuery remote(List<String> userIds, String currentUserId, TimelineMapOptions options) => _mapQueryBuilder(
  assetFilter: (row) {
    Expression<bool> condition =
        row.deletedAt.isNull() &
        viewerVisibilityPredicate(_db, row, userIds, currentUserId) &
        _db.remoteAssetEntity.visibility.isIn([
          AssetVisibility.timeline.index,
          if (options.includeArchived) AssetVisibility.archive.index,
        ]);

    if (options.onlyFavorites) {
      condition = condition & _db.remoteAssetEntity.isFavorite.equals(true);
    }

    if (options.relativeDays != 0) {
      final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));
      condition = condition & _db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate);
    }

    return condition;
  },
);
```

**Step 5: Re-run**

```bash
cd mobile && flutter test test/infrastructure/repositories/map_repository_test.dart
```

Expected: both tests PASS.

**Step 6: Commit**

```bash
git add mobile/test/infrastructure/repositories/map_repository_test.dart mobile/lib/infrastructure/repositories/map.repository.dart
git commit -m "feat(mobile): DriftMapRepository.remote() markers respect shared-space visibility"
```

---

## Task 14.5: Cross-method full permission matrix

**Goal:** The earlier tasks test the full 14-case visibility matrix against `video()` only; `place()`, `map()`, and `DriftMapRepository.remote()` got a smaller method-specific test set. This task adds a parameterized matrix helper and runs the full permission matrix against all four methods, so a regression in the helper cannot silently pass for one method while failing for another.

Also covers three edge cases that didn't fit the video-only matrix:

- Asset in one space with `showInTimeline=true` AND another space with `showInTimeline=false` — visible (OR-branch with showInTimeline=true wins).
- Member `role='admin'` vs `role='viewer'` — both see with the same rules (role is modification-gated, not visibility-gated).
- Symmetric `withPartners`: both viewer and partner are members of the same space where a third user's asset lives — visible (viewer's own member row does the work).

**Files:**

- Modify: `mobile/test/infrastructure/repositories/timeline_repository_test.dart`
- Modify: `mobile/test/infrastructure/repositories/map_repository_test.dart`

**Step 1: Define the parameterized matrix helper**

Inside `main()` at top-level scope (alongside the fixture helpers from Task 6), add:

```dart
typedef _MatrixCase = ({
  String name,
  Future<String> Function() setup, // returns the asset id under test
  int expectedCount,
  List<String> userIds,
  String currentUserId,
});

/// Returns a list of permission matrix cases. Each case sets up one asset
/// via [insertAsset] (which must stash method-specific prereqs like exif
/// city or lat/lng) and returns the asset id. The caller's query runner
/// then asserts the expected count.
List<_MatrixCase> _permissionMatrixCases({
  required Future<void> Function(String assetId, String ownerId) insertAsset,
}) {
  Future<String> single(String ownerId, Future<void> Function(String assetId) extra) async {
    await _insertUser(ownerId);
    await insertAsset('asset-1', ownerId);
    await extra('asset-1');
    return 'asset-1';
  }

  return <_MatrixCase>[
    (
      name: 'M1: owner asset visible',
      setup: () async {
        await _insertUser('viewer');
        await insertAsset('asset-1', 'viewer');
        return 'asset-1';
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M2: partner asset visible',
      setup: () async {
        await _insertUser('viewer');
        await single('partner', (_) async {});
      },
      expectedCount: 1,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M3: unrelated user hidden',
      setup: () async {
        await _insertUser('viewer');
        await single('stranger', (_) async {});
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M4: space member showInTimeline=true visible',
      setup: () async {
        await _insertUser('viewer');
        final id = await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await _insertMember('sp1', 'viewer', showInTimeline: true);
          await _linkAssetToSpace('sp1', a);
        });
        return id;
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M5: space member showInTimeline=false hidden',
      setup: () async {
        await _insertUser('viewer');
        await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await _insertMember('sp1', 'viewer', showInTimeline: false);
          await _linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M6: partner is member, viewer is NOT → hidden',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('partner');
        await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await _insertMember('sp1', 'partner', showInTimeline: true);
          await _linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 0,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M7: library-in-space showInTimeline=true visible',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('owner');
        await insertAsset('asset-1', 'owner');
        // Patch libraryId onto the asset after insertAsset (insertAsset is
        // method-specific and doesn't know about libraryId, so update).
        await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
            .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
        await _insertSpace('sp1', 'owner');
        await _insertMember('sp1', 'viewer', showInTimeline: true);
        await _linkLibraryToSpace('sp1', 'lib-1');
        return 'asset-1';
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M8: library-in-space showInTimeline=false hidden',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('owner');
        await insertAsset('asset-1', 'owner');
        await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
            .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
        await _insertSpace('sp1', 'owner');
        await _insertMember('sp1', 'viewer', showInTimeline: false);
        await _linkLibraryToSpace('sp1', 'lib-1');
        return 'asset-1';
      },
      expectedCount: 0,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M9: asset in 2 direct spaces counted once',
      setup: () async {
        await _insertUser('viewer');
        await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await _insertSpace('sp2', 'owner');
          await _insertMember('sp1', 'viewer');
          await _insertMember('sp2', 'viewer');
          await _linkAssetToSpace('sp1', a);
          await _linkAssetToSpace('sp2', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M10: direct + library link on same space counted once',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('owner');
        await insertAsset('asset-1', 'owner');
        await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
            .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
        await _insertSpace('sp1', 'owner');
        await _insertMember('sp1', 'viewer');
        await _linkAssetToSpace('sp1', 'asset-1');
        await _linkLibraryToSpace('sp1', 'lib-1');
        return 'asset-1';
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M11: opposite showInTimeline across two spaces → visible via true branch',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('owner');
        await insertAsset('asset-1', 'owner');
        await (db.update(db.remoteAssetEntity)..where((t) => t.id.equals('asset-1')))
            .write(const RemoteAssetEntityCompanion(libraryId: Value('lib-1')));
        await _insertSpace('sp_a', 'owner');
        await _insertSpace('sp_b', 'owner');
        await _insertMember('sp_a', 'viewer', showInTimeline: true);
        await _insertMember('sp_b', 'viewer', showInTimeline: false);
        await _linkAssetToSpace('sp_a', 'asset-1');
        await _linkLibraryToSpace('sp_b', 'lib-1');
        return 'asset-1';
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M12: role=admin sees same as role=viewer',
      setup: () async {
        await _insertUser('viewer');
        await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await db.into(db.sharedSpaceMemberEntity).insert(
                SharedSpaceMemberEntityCompanion.insert(
                  spaceId: 'sp1',
                  userId: 'viewer',
                  role: 'admin',
                  showInTimeline: const Value(true),
                ),
              );
          await _linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer'],
      currentUserId: 'viewer',
    ),
    (
      name: 'M13: viewer + partner both members of same space → visible once',
      setup: () async {
        await _insertUser('viewer');
        await _insertUser('partner');
        await single('owner', (a) async {
          await _insertSpace('sp1', 'owner');
          await _insertMember('sp1', 'viewer', showInTimeline: true);
          await _insertMember('sp1', 'partner', showInTimeline: true);
          await _linkAssetToSpace('sp1', a);
        });
      },
      expectedCount: 1,
      userIds: const ['viewer', 'partner'],
      currentUserId: 'viewer',
    ),
  ];
}

void _runPermissionMatrix({
  required String methodName,
  required Future<void> Function(String assetId, String ownerId) insertAsset,
  required Future<int> Function(List<String> userIds, String currentUserId) count,
}) {
  for (final tc in _permissionMatrixCases(insertAsset: insertAsset)) {
    test('$methodName — ${tc.name}', () async {
      await tc.setup();
      final got = await count(tc.userIds, tc.currentUserId);
      expect(got, tc.expectedCount, reason: 'matrix case: ${tc.name}');
    });
  }
}
```

**Step 2: Add the 4 matrix invocations**

Inside `main()`, after the existing per-method groups:

```dart
group('Cross-method permission matrix — video()', () {
  _runPermissionMatrix(
    methodName: 'video',
    insertAsset: (assetId, ownerId) =>
        _insertVideo(assetId, ownerId, type: AssetType.video),
    count: (userIds, currentUserId) async {
      final buckets = await sut.video(userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
      return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
    },
  );
});

group('Cross-method permission matrix — place()', () {
  _runPermissionMatrix(
    methodName: 'place',
    insertAsset: (assetId, ownerId) async {
      await _insertVideo(assetId, ownerId, type: AssetType.image);
      await db
          .into(db.remoteExifEntity)
          .insert(RemoteExifEntityCompanion.insert(assetId: assetId, city: const Value('Paris')));
    },
    count: (userIds, currentUserId) async {
      final buckets = await sut.place('Paris', userIds, currentUserId, GroupAssetsBy.day).bucketSource().first;
      return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
    },
  );
});

group('Cross-method permission matrix — map()', () {
  final bounds = LatLngBounds(
    southwest: const LatLng(-89, -179),
    northeast: const LatLng(89, 179),
  );
  _runPermissionMatrix(
    methodName: 'map',
    insertAsset: (assetId, ownerId) async {
      await _insertVideo(assetId, ownerId, type: AssetType.image);
      await db.into(db.remoteExifEntity).insert(
            RemoteExifEntityCompanion.insert(
              assetId: assetId,
              latitude: const Value(48.85),
              longitude: const Value(2.35),
            ),
          );
    },
    count: (userIds, currentUserId) async {
      final buckets = await sut
          .map(userIds, currentUserId, TimelineMapOptions(bounds: bounds), GroupAssetsBy.day)
          .bucketSource()
          .first;
      return buckets.fold<int>(0, (sum, b) => sum + (b as TimeBucket).assetCount);
    },
  );
});
```

For the marker matrix, put it in `map_repository_test.dart` (since `DriftMapRepository` lives there):

```dart
group('Cross-method permission matrix — DriftMapRepository.remote() markers', () {
  final bounds = LatLngBounds(
    southwest: const LatLng(-89, -179),
    northeast: const LatLng(89, 179),
  );
  _runPermissionMatrix(
    methodName: 'marker',
    insertAsset: (assetId, ownerId) async {
      await _insertVideo(assetId, ownerId, type: AssetType.image);
      await db.into(db.remoteExifEntity).insert(
            RemoteExifEntityCompanion.insert(
              assetId: assetId,
              latitude: const Value(48.85),
              longitude: const Value(2.35),
            ),
          );
    },
    count: (userIds, currentUserId) async {
      final markers = await mapSut
          .remote(userIds, currentUserId, TimelineMapOptions(bounds: bounds))
          .markerSource(bounds);
      return markers.length;
    },
  );
});
```

Note: `_permissionMatrixCases` and `_runPermissionMatrix` need to be accessible from BOTH test files. Either duplicate them (cheap, each file has its own `db` + helpers) or extract them to a shared `_test_matrix.dart` file. For simplicity during subagent-driven execution, **duplicate** them — each file is already independent.

**Step 3: Run the matrix tests**

```bash
cd mobile && flutter test test/infrastructure/repositories/timeline_repository_test.dart --plain-name "Cross-method permission matrix"
cd mobile && flutter test test/infrastructure/repositories/map_repository_test.dart --plain-name "Cross-method permission matrix"
```

Expected: all 52 cases (13 × 4 methods) PASS. If any fails, identify the method and branch that regressed — the failure message includes `matrix case: <case name>`.

**Step 4: Commit**

```bash
git add mobile/test/infrastructure/repositories/timeline_repository_test.dart mobile/test/infrastructure/repositories/map_repository_test.dart
git commit -m "test(mobile): cross-method permission matrix for shared-space visibility

Runs 13 permission cases (owner, partner, stranger, space member
variants, library-in-space variants, dedup, cross-branch opposites,
role-admin, symmetric-partner-member) against all four affected
methods: video(), place(), map(), and DriftMapRepository.remote()."
```

---

## Task 15: Full test suite sweep

**Goal:** Run all mobile tests to catch any regressions in adjacent code paths.

**Step 1: Run the full mobile test suite**

```bash
cd mobile && flutter test
```

Expected: all tests PASS. If anything fails, STOP and investigate — likely a missed signature-plumbing site or a test fixture conflict.

**Step 2: Run `flutter analyze`**

```bash
cd mobile && flutter analyze
```

Expected: no errors. Any unused-import or unused-element warnings introduced by the changes should be cleaned up.

**Step 3: Commit any cleanup**

If `flutter analyze` flagged anything, fix it and commit:

```bash
git add -p
git commit -m "chore(mobile): clean up lint warnings from timeline space fix"
```

---

## Task 16: Manual smoke test

**Goal:** Exercise the four query paths in a running dev build to confirm end-to-end behavior.

> **Autonomous execution note:** If running this plan in a subagent-driven / unattended workflow, **SKIP this task**. The ~70 unit tests (matrix + method-specific + reactivity) plus `flutter analyze` are enough to ship. Add a line to the PR description stating _"Manual smoke test pending — run `flutter run` locally before merging"_ and move on to Task 17.

**Step 1: Start the dev stack**

```bash
make dev
```

Wait for server + web + ml containers to be healthy.

**Step 2: Prepare test data**

In a second terminal, run `/env-prep` or manually:

- Log in as admin, create two users (`alice`, `bob`)
- As `alice`: upload 2-3 photos + 1-2 videos with location metadata
- As `bob`: upload 1 photo with a distinct location
- As `alice`: create a shared space `"Vacation"`, add `bob` as a member with `showInTimeline=true`, add one of alice's photos to the space
- As `bob`: enter the space via the app, verify the asset is visible in the space view (sanity)

**Step 3: Launch the mobile app**

```bash
cd mobile && flutter run
```

Log in as `bob`.

**Step 4: Verify each fixed query path**

- **`video()`**: tap Videos in the drawer — alice's video(s) linked via the shared space should appear. Toggle `showInTimeline=false` for bob on the space (via web or server), refresh — alice's videos should disappear.
- **`place()`**: tap a place chip on a timeline asset, navigate to the place detail — assets include bob's own + shared-space matches. Stranger/unrelated assets do NOT appear.
- **`map()` bucket sheet**: open the map view, zoom/pan over a cluster with both bob's and the shared alice asset — the bottom sheet thumbnails should include the shared asset.
- **`DriftMapRepository.remote()` markers**: on the map, the pins should include the shared alice asset's location.

**Step 5: Toggle and re-verify reactivity**

From the web UI, toggle `showInTimeline` back and forth on bob's membership for the space. The mobile video / place / map views should update within seconds without requiring a navigation refresh (Drift stream reactivity).

**Step 6: Record any issues**

If anything doesn't work, file the observations inline in the commit message for task 17 or note them for follow-up.

---

## Task 17: Open the PR

**Goal:** Push the branch and open a PR with a clear description that flags the `place()` visibility narrowing.

**Step 1: Rename the branch before push**

The branch was created as `docs/mobile-timeline-space-visibility-design` for the design phase, but by now it contains implementation commits too. Rename it so the branch name reflects the net change:

```bash
git branch -m fix/mobile-timeline-space-visibility
```

**Step 2: Push the branch**

```bash
git push -u origin fix/mobile-timeline-space-visibility
```

**Step 3: Open the PR via `gh`**

```bash
gh pr create --title "fix(mobile): shared-space visibility for video, place, map, and marker queries" --body "$(cat <<'EOF'
## Summary

Four mobile Drift queries did not honor shared-space visibility, diverging from the main timeline's `owner + partners + spaces w/ showInTimeline` behavior. This fixes all four via a shared helper split by Drift access mode (LEFT JOINs for `.watch()` bucket paths, `isInQuery` composition for `.get()` asset-list and marker paths).

- `DriftTimelineRepository.video()` — now includes partner + shared-space videos.
- `DriftTimelineRepository.place()` — **narrowed** from unfiltered (leaky) to `owner + partners + shared-space`. Assets that appeared on place detail by virtue of sharing a city but without any permission relationship to the viewer will no longer appear. This is a bug fix, not a regression, but flagging it here so it is not filed as one.
- `DriftTimelineRepository.map()` bucket sheet — now includes shared-space assets in the cluster thumbnail bucket.
- `DriftMapRepository.remote()` map markers — now pins shared-space asset locations.

## Design & Plan

- Design: `docs/plans/2026-04-12-mobile-timeline-space-visibility-design.md`
- Plan: `docs/plans/2026-04-12-mobile-timeline-space-visibility-plan.md`

## Tests

~27 unit tests added to `mobile/test/infrastructure/repositories/timeline_repository_test.dart` (and a new `map_repository_test.dart`), covering the full visibility matrix on `video()` plus method-specific filter interaction and reactivity for each method. The load-bearing architectural verification — that Drift reactivity tracks aliased `shared_space_member` joins — is tested three ways: a pre-flight smoke test, a `showInTimeline` toggle (true→false→true) test, and a member-row deletion test.

## Test Plan

- [x] `cd mobile && flutter test` — all tests green
- [x] `cd mobile && flutter analyze` — no errors
- [ ] Manual smoke test per plan Task 16 (video / place / map bucket / map markers with shared-space + showInTimeline toggle)
EOF
)"
```

**Step 4: Note the PR URL**

Print the returned URL and paste it into the user-facing summary.

---

## Risks and stop conditions

Abort and notify the user if any of these happen:

1. **Task 1 (pre-flight) FAILS.** The aliased-join reactivity claim is wrong. Redesign the bucket paths as `.drift` SQL files with explicit table imports (same shape as `merged_asset.drift`). This changes the entire helper approach — do not continue with the current plan.
2. **Task 8 (showInTimeline toggle) FAILS after helper is in place.** Same as above — something about the helper composition or the alias lifetime breaks reactivity. Debug before any further implementation.
3. **`flutter analyze` errors from generated code** (e.g., `RemoteAssetEntityCompanion` missing `libraryId` parameter). That indicates the `RemoteAssetEntity` schema differs from what the test fixture assumes — check the actual schema in `mobile/lib/infrastructure/entities/remote_asset.entity.dart` and adjust fixtures.
4. **Signature plumbing cascades unexpectedly.** If changing `video()`'s signature reveals callers outside the 4 documented call sites, stop and audit the usages before continuing.

## Out of scope (do NOT do in this PR)

- Stack primary-asset filter (`stack_id IS NULL OR rae.id = se.primary_asset_id`)
- Aligning mobile's `onlyFavorites` / `includeArchived` restrictions with the server's rejection of those combinations under `withPartners`
- Viewer-specific favorites for foreign assets
- Adding `joinLocal` to the rewritten asset-list queries (preserve current no-local-join behavior)
- Renaming `_watchMapMarker` to `_fetchMapMarkers` (cosmetic, do separately)
