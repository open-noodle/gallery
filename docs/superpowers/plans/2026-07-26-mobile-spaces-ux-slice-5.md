# Mobile Spaces UX — Slice 5: `CollectionTarget` and dispatch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route a selection to a space pool or a space album, with honest counts, partial-upload
handling, and a re-entrancy guard — all testable without any UI.

**Architecture:** A sealed `CollectionTarget` names the three destinations. Two new methods on the
existing `ActionNotifier` (where upload, `ActionSource` and selection state already live) share one
private helper. `SpaceAlbumActions.addAssets` stays the low-level call underneath.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `hooks_riverpod`, `mocktail`, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §2, §5 and Slice 5.

## Global Constraints

- All commands from `mobile/` via `mise exec -- <cmd>` (Flutter 3.44.1 / Dart 3.12.1).
- Format gate (`lib`-only, generated excluded, **must** use `bash -c` — zsh does not word-split):
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never bare `dart format .`.
- Analyze gate: `mise exec -- dart analyze --fatal-infos` from `mobile/`.
- Exit codes on the line _after_ the command, never after a pipe to `tail`.
- Baseline after Slice 4 is **2840 passing, 1 skipped**.
- No new i18n keys, no UI in this slice.

## Key facts this slice depends on (already verified — do not re-derive)

- `SharedSpaceApiRepository.addAssets` returns **`Future<void>`**. The endpoint is `204 NO_CONTENT`,
  so there is **no server count** for a pool add; report the request length, as web does.
- `SpaceAlbumActions.addAssets(albumId, ids)` returns **`Future<int>`** — the server's real
  `added.length`, which already excludes duplicates. It also fires its own `syncRemote()` nudge.
- `RemoteAlbumService.categorizeCandidates(assets)` returns
  `AlbumAssetCandidates(remoteAssetIds: List<String>, localAssetsToUpload: List<LocalAsset>)`.
- `ActionNotifier.upload(source, {assets, onAssetUploaded})` returns `ActionResult` whose `success`
  is `successCount == assetsToUpload.length`, and calls `onAssetUploaded(asset, remoteId)` per
  successful upload.
- `ActionResult` is `{int count, bool success, String? error, List<String> remoteAssetIds}`.
- `_getAssets(source)` returns `Set<BaseAsset>`; `_logger` exists on the notifier.

## File Structure

| File                                                                          | Responsibility                           |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| `mobile/lib/domain/models/collection_target.dart` (create)                    | The sealed destination type.             |
| `mobile/lib/constants/collection.dart` (create)                               | `kMaxSpaceAssetsPerRequest`.             |
| `mobile/lib/providers/infrastructure/action.provider.dart` (modify)           | `addToSpace`, `addToSpaceAlbum`, helper. |
| `mobile/test/providers/infrastructure/collection_dispatch_test.dart` (create) | The dispatch table.                      |

---

### Task 1: `CollectionTarget` and the cap constant

**Files:**

- Create: `mobile/lib/domain/models/collection_target.dart`
- Create: `mobile/lib/constants/collection.dart`

**Interfaces produced** (Slices 6 and 7 depend on these exact names):

```dart
sealed class CollectionTarget { const CollectionTarget(); }
final class AlbumTarget extends CollectionTarget { final RemoteAlbum album; }
final class SpacePoolTarget extends CollectionTarget { final SharedSpaceResponseDto space; }
final class SpaceAlbumTarget extends CollectionTarget { final String spaceId; final SpaceAlbum album; }
const int kMaxSpaceAssetsPerRequest = 50000;
```

- [ ] **Step 1: Create the constant**

`mobile/lib/constants/collection.dart`:

```dart
/// Maximum asset ids accepted by `POST /shared-spaces/{id}/assets` in one request.
///
/// Mirrors `SharedSpaceAssetAddSchema` (`server/src/dtos/shared-space.dto.ts`) and
/// web's `MAX_SPACE_ASSETS_PER_REQUEST`. Inclusive: 50000 is allowed, 50001 is not.
const int kMaxSpaceAssetsPerRequest = 50000;
```

- [ ] **Step 2: Create the target model**

`mobile/lib/domain/models/collection_target.dart`:

```dart
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:openapi/api.dart';

/// Where a multi-selection can be sent.
///
/// Sealed so the dispatch table in `ActionNotifier` is exhaustive and checked by the
/// compiler: adding a destination without wiring it up becomes a build error.
sealed class CollectionTarget {
  const CollectionTarget();
}

/// A personal or shared album. Dispatches through the existing `addToAlbum`.
final class AlbumTarget extends CollectionTarget {
  const AlbumTarget(this.album);
  final RemoteAlbum album;
}

/// A space's own asset pool.
final class SpacePoolTarget extends CollectionTarget {
  const SpacePoolTarget(this.space);
  final SharedSpaceResponseDto space;
}

/// An album linked to a space.
///
/// [spaceId] is carried even though the add call does not need it: it identifies which
/// `spaceAlbumsProvider` to invalidate afterwards, and lets a space surface exclude its
/// own albums. It must NEVER be dispatched through `addToAlbum` — a linked album can be
/// "absorbed" (present only in `shared_space_album`, with no local `remote_album` row),
/// and `addToAlbum` also writes the local junction, which would hit a foreign-key
/// violation. See `SpaceAlbumActions.addAssets`.
final class SpaceAlbumTarget extends CollectionTarget {
  const SpaceAlbumTarget({required this.spaceId, required this.album});
  final String spaceId;
  final SpaceAlbum album;
}
```

- [ ] **Step 3: Confirm it analyzes**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- dart analyze --fatal-infos lib/domain/models/collection_target.dart lib/constants/collection.dart
echo "EXIT=$?"
```

Expected: `EXIT=0`, "No issues found!". If `RemoteAlbum` or `SpaceAlbum` is not at those import
paths, grep for `class RemoteAlbum` / `class SpaceAlbum` under `lib/domain/models/` and correct the
import — do not redefine the types.

- [ ] **Step 4: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/domain/models/collection_target.dart mobile/lib/constants/collection.dart
git commit -m "feat(mobile): add the collection target model"
```

---

### Task 2: `addToSpace` and `addToSpaceAlbum`

**Files:**

- Modify: `mobile/lib/providers/infrastructure/action.provider.dart`
- Test: `mobile/test/providers/infrastructure/collection_dispatch_test.dart`

**Interfaces produced** (Slice 7 calls these):

```dart
Future<ActionResult> addToSpace(ActionSource source, SharedSpaceResponseDto space)
Future<ActionResult> addToSpaceAlbum(ActionSource source, String spaceId, SpaceAlbum album)
```

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/providers/infrastructure/collection_dispatch_test.dart`. Model the container
setup on the existing `test/providers/infrastructure/space_album_actions_test.dart`.

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/asset/remote_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockSpaceAlbumActions extends Mock implements SpaceAlbumActions {}

void main() {
  late MockSharedSpaceApiRepository spaceRepo;
  late MockSpaceAlbumActions albumActions;
  late ProviderContainer container;

  SharedSpaceResponseDto theSpace() => SharedSpaceResponseDto(
    id: 'space-1',
    name: 'Family',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'user-1',
  );

  SpaceAlbum theAlbum() => SpaceAlbum(
    id: 'album-1',
    name: 'Ski trip',
    showInTimeline: true,
    linkedAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
  );

  RemoteAsset remote(String id) => RemoteAsset(
    id: id,
    name: id,
    ownerId: 'user-1',
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  /// Seeds the timeline multiselect so `_getAssets(timeline)` sees them. The notifier
  /// only exposes `selectAsset` (one at a time) -- there is no bulk setter.
  void select(Iterable<BaseAsset> assets) {
    final notifier = container.read(multiSelectProvider.notifier);
    for (final asset in assets) {
      notifier.selectAsset(asset);
    }
  }

  setUpAll(() {
    registerFallbackValue(<String>[]);
  });

  setUp(() {
    spaceRepo = MockSharedSpaceApiRepository();
    albumActions = MockSpaceAlbumActions();
    when(() => spaceRepo.addAssets(any(), any())).thenAnswer((_) async {});
    when(() => albumActions.addAssets(any(), any())).thenAnswer((_) async => 2);
    container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(spaceRepo),
        spaceAlbumActionsProvider.overrideWithValue(albumActions),
      ],
    );
    addTearDown(container.dispose);
  });

  test('a space pool add sends every id in ONE call', () async {
    select([remote('a'), remote('b')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    final captured = verify(() => spaceRepo.addAssets('space-1', captureAny())).captured.single as List<String>;
    expect(captured..sort(), ['a', 'b']);
    expect(result.success, isTrue);
  });

  test('a space pool add reports the REQUEST length, because the endpoint returns no body', () async {
    select([remote('a'), remote('b'), remote('c')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.count, 3);
  });

  test('a space album add reports the SERVER count, so duplicates are not over-claimed', () async {
    when(() => albumActions.addAssets(any(), any())).thenAnswer((_) async => 0);
    select([remote('a'), remote('b')]);

    final result = await container
        .read(actionProvider.notifier)
        .addToSpaceAlbum(ActionSource.timeline, 'space-1', theAlbum());

    expect(result.count, 0, reason: 'all already present -- do not claim "added 2"');
    expect(result.success, isTrue);
  });

  test('a space album add never touches the space pool endpoint', () async {
    select([remote('a')]);

    await container.read(actionProvider.notifier).addToSpaceAlbum(ActionSource.timeline, 'space-1', theAlbum());

    verify(() => albumActions.addAssets('album-1', any())).called(1);
    verifyNever(() => spaceRepo.addAssets(any(), any()));
  });

  test('an empty selection makes no call and succeeds with zero', () async {
    select([]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.count, 0);
    expect(result.success, isTrue);
    verifyNever(() => spaceRepo.addAssets(any(), any()));
  });

  test('a failed add returns a failure AND leaves the selection intact for retry', () async {
    when(() => spaceRepo.addAssets(any(), any())).thenThrow(Exception('403'));
    select([remote('a')]);

    final result = await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(result.success, isFalse);
    expect(container.read(multiSelectProvider).selectedAssets, isNotEmpty);
  });

  test('a successful add clears the selection', () async {
    select([remote('a')]);

    await container.read(actionProvider.notifier).addToSpace(ActionSource.timeline, theSpace());

    expect(container.read(multiSelectProvider).selectedAssets, isEmpty);
  });

  test('a second add while one is in flight is ignored', () async {
    final gate = Completer<void>();
    when(() => spaceRepo.addAssets(any(), any())).thenAnswer((_) => gate.future);
    select([remote('a')]);

    final notifier = container.read(actionProvider.notifier);
    final first = notifier.addToSpace(ActionSource.timeline, theSpace());
    final second = await notifier.addToSpace(ActionSource.timeline, theSpace());

    expect(second.success, isFalse);
    gate.complete();
    await first;

    verify(() => spaceRepo.addAssets(any(), any())).called(1);
  });
}
```

Add `import 'dart:async';` for `Completer`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/providers/infrastructure/collection_dispatch_test.dart
```

Expected: compile error, `The method 'addToSpace' isn't defined for the type 'ActionNotifier'`.

Verified before writing this plan, so do not re-check: the multiselect notifier exposes
`selectAsset(BaseAsset)` only (no bulk setter); `RemoteAsset` additionally requires `isEdited` and
lives in `lib/domain/models/asset/remote_asset.model.dart`; `RemoteAlbum` is in
`lib/domain/models/album/album.model.dart`.

- [ ] **Step 3: Implement**

In `mobile/lib/providers/infrastructure/action.provider.dart`, add a field on `ActionNotifier`
beside `_logger`:

```dart
  /// Guards against a second destination being dispatched while one is in flight —
  /// two taps in a picker would otherwise fire two adds and two sync nudges.
  bool _spaceAddInFlight = false;
```

Then add these three members next to `addToAlbum`:

```dart
  /// Add the selection to a space's own asset pool.
  ///
  /// Reports the REQUEST length: `POST /shared-spaces/{id}/assets` is 204 with no body,
  /// so there is no server-side count to report (web does the same).
  Future<ActionResult> addToSpace(ActionSource source, SharedSpaceResponseDto space) {
    return _addToSpaceTarget(source, (ids) async {
      await ref.read(sharedSpaceApiRepositoryProvider).addAssets(space.id, ids);
      return ids.length;
    });
  }

  /// Add the selection to an album linked to a space.
  ///
  /// Routed through [SpaceAlbumActions] rather than [addToAlbum]: a linked album may be
  /// "absorbed" (no local `remote_album` row) and the album path also writes the local
  /// junction, which would throw on the foreign key. Returns the server's true count,
  /// which already excludes assets the album had.
  Future<ActionResult> addToSpaceAlbum(ActionSource source, String spaceId, SpaceAlbum album) async {
    final result = await _addToSpaceTarget(
      source,
      (ids) => ref.read(spaceAlbumActionsProvider).addAssets(album.id, ids),
    );
    if (result.success) {
      ref.invalidate(spaceAlbumsProvider(spaceId));
    }
    return result;
  }

  /// Shared body for both space destinations.
  ///
  /// Local assets are uploaded first and then added in a SINGLE call — one call per
  /// asset would fire `SpaceAlbumActions`' `syncRemote()` nudge once per photo.
  /// A partial upload still adds what succeeded: stranding uploaded photos the user
  /// asked to file would be worse than a partial-success result.
  Future<ActionResult> _addToSpaceTarget(
    ActionSource source,
    Future<int> Function(List<String> remoteIds) add,
  ) async {
    if (_spaceAddInFlight) {
      return const ActionResult(count: 0, success: false);
    }
    _spaceAddInFlight = true;
    try {
      final selected = _getAssets(source).toList(growable: false);
      if (selected.isEmpty) {
        return const ActionResult(count: 0, success: true);
      }

      final candidates = RemoteAlbumService.categorizeCandidates(selected);
      final remoteIds = [...candidates.remoteAssetIds];
      final localAssets = candidates.localAssetsToUpload;

      ActionResult? uploadResult;
      if (localAssets.isNotEmpty) {
        final uploaded = <String>[];
        uploadResult = await upload(
          source,
          assets: localAssets,
          onAssetUploaded: (asset, remoteId) => uploaded.add(remoteId),
        );
        remoteIds.addAll(uploaded);
      }

      if (remoteIds.isEmpty) {
        // Every asset was local and none uploaded — nothing to add.
        return ActionResult(count: 0, success: false, error: uploadResult?.error);
      }

      final int added;
      try {
        added = await add(remoteIds);
      } catch (error, stack) {
        _logger.severe('Failed to add assets to space target', error, stack);
        return ActionResult(count: 0, success: false, error: error.toString());
      }

      // Only a fully successful run clears the selection, so a partial upload leaves
      // the photos selected for retry. This deliberately differs from addToAlbum,
      // which resets before its upload and so clears even when the upload fails.
      final fullSuccess = uploadResult?.success ?? true;
      if (fullSuccess && source == ActionSource.timeline) {
        ref.read(multiSelectProvider.notifier).reset();
      }
      return ActionResult(count: added, success: fullSuccess, error: uploadResult?.error);
    } finally {
      _spaceAddInFlight = false;
    }
  }
```

Add imports as needed: `space_album.model.dart`, `space_album.provider.dart`,
`space_album_actions.dart`, `shared_space_api.repository.dart`.

- [ ] **Step 4: Run to verify it passes**

Expected: `+8: All tests passed!`

- [ ] **Step 5: Slice gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/s5.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s5.log
```

Expected: all `0`, `+2848 ~1 All tests passed!`.

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/providers/infrastructure/action.provider.dart \
        mobile/test/providers/infrastructure/collection_dispatch_test.dart
git commit -m "feat(mobile): dispatch selections to spaces and space albums"
```

---

## Self-Review

**1. Spec coverage.** Slice 5 lists thirteen behaviours. Covered by tests here: one-call pool add ✓,
request-length count ✓, server count / duplicates ✓, never-touches-pool (the FK guard) ✓, empty
selection ✓, failure leaves selection ✓, success resets ✓, in-flight guard ✓.

Covered by implementation but **not** by a test in this slice, deliberately: the local-asset upload
paths (single add call, 3-of-5 partial, cancelled upload) and `AlbumTarget` routing.
`ActionNotifier.upload` pulls in `ForegroundUploadService`, `assetUploadProgressProvider` and
`manualUploadCancelTokenProvider`, so exercising it needs a much heavier harness than a
`ProviderContainer` with two mocks — the spec's own "tested without any UI" framing does not hold
for the upload path. `AlbumTarget` simply calls the pre-existing, already-tested `addToAlbum`.
**Both gaps are recorded in the spec's follow-up section rather than silently dropped**, and the
upload branch is written to be obviously correct (single `add` after collecting ids).

**2. Placeholder scan.** No TBD/TODO. The two spots where a real name may differ (`setAssets`, the
model import paths) carry the exact grep and an instruction not to invent replacements.

**3. Type consistency.** `add` is `Future<int> Function(List<String>)` in the helper and both call
sites; `addToSpace` returns `ids.length`, `addToSpaceAlbum` returns `SpaceAlbumActions.addAssets`'s
`Future<int>`. `SpaceAlbumTarget.spaceId` is the `String` passed to `addToSpaceAlbum` and to
`spaceAlbumsProvider(...)`.
