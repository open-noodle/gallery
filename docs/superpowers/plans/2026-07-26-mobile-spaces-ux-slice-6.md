# Mobile Spaces UX — Slice 6: `SpaceCollectionSection`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The spaces half of the picker — writable spaces, lazily expandable into their linked
albums, with six mutually exclusive gating states.

**Architecture:** A plain **box** widget (not a sliver), so it is trivially pumpable in tests; Slice 7
wraps it in a `SliverToBoxAdapter`. Space rows come from the network `sharedSpacesProvider`; a row's
linked albums come from the local Drift `spaceAlbumsProvider(spaceId)`, watched only while expanded.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `hooks_riverpod`, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §3 and Slice 6.

## Global Constraints

- All commands from `mobile/` via `mise exec -- <cmd>` (Flutter 3.44.1 / Dart 3.12.1).
- Format gate (`lib`-only, generated excluded, **must** use `bash -c`):
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never bare `dart format .`.
- Analyze gate: `mise exec -- dart analyze --fatal-infos` from `mobile/`.
- Exit codes on the line _after_ the command.
- Baseline after Slice 5 is **2848 passing, 1 skipped**.
- **This slice DOES add one i18n key** (Task 1) — the only slice that touches `i18n/`. It must land in
  `en.json` **and all nine locale files** in the same commit.
- After editing `i18n/en.json` you must regenerate the loader or `.t()` will not resolve the new key:
  ```bash
  cd mobile && mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart
  ```
  Those outputs (`lib/generated/*.g.dart`) are gitignored — regenerate, do not commit them.

## Verified facts (do not re-derive)

- `sharedSpacesProvider` is `FutureProvider<List<SharedSpaceResponseDto>>` (network `getAll`).
- `spaceAlbumsProvider` is `StreamProvider.family<List<SpaceAlbum>, String>` (local Drift).
- `SharedSpaceResponseDto.albumCount` is `Optional<num?>` and is populated by `getAll`
  (`shared-space.service.ts:143,190`). Read it with `.orElse(null) ?? 0`; **never** `.value`.
- `spaceIsWritable(space, userId)` / `spaceIsOwned` live in `lib/utils/space_permissions.dart`.
- `kMaxSpaceAssetsPerRequest = 50000` (inclusive) lives in `lib/constants/collection.dart`.
- `CollectionTarget` / `SpacePoolTarget` / `SpaceAlbumTarget` live in
  `lib/domain/models/collection_target.dart`.
- Locked-folder assets are `RemoteAsset` with `visibility == AssetVisibility.locked`.
  `MultiSelectState.lockedSelectionAssets` is **unrelated** (it means "already in this album").
- `RemoteAsset` is a `part of base_asset.model.dart` — import `base_asset.model.dart`, never the part.
- `multiSelectProvider`'s notifier exposes `selectAsset(BaseAsset)` only; no bulk setter.

## File Structure

| File                                                                                       | Responsibility          |
| ------------------------------------------------------------------------------------------ | ----------------------- |
| `i18n/en.json` + 9 locale files (modify)                                                   | One new key.            |
| `mobile/lib/utils/selection_targets.dart` (create)                                         | Pure gating predicates. |
| `mobile/test/utils/selection_targets_test.dart` (create)                                   | Predicate truth table.  |
| `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart` (create) | The section.            |
| `mobile/test/presentation/widgets/collection/space_collection_section_test.dart` (create)  | Gating + row behaviour. |

---

### Task 1: The new i18n key, in all ten files

**Files:** `i18n/en.json`, and `de`, `fr`, `it`, `es`, `nl`, `pl`, `ru`, `zh_Hans`, `zh_Hant`.

The reused `add_to_collection_restricted_to_space` says "…so only albums in this space can accept
them", which is web's contribution-mode promise — a destination mobile deliberately does not offer.
Using it would point the user at something not on screen, so this key is new.

- [ ] **Step 1: Insert `spaces_hidden_non_owned_selection` into all ten files**

Keys in these files are sorted alphabetically and the repo runs prettier with
`prettier-plugin-sort-json` over `i18n/`, so insert in the correct sorted position (immediately
after `spaces_hidden_too_many_assets` if present, else in alphabetical order among the `spaces_*`
keys). Values, verbatim:

| File           | Value                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `en.json`      | `Your selection includes photos owned by other members, so it can't be added to a space.`                         |
| `de.json`      | `Deine Auswahl enthält Fotos anderer Mitglieder und kann daher nicht zu einem Space hinzugefügt werden.`          |
| `fr.json`      | `Votre sélection contient des photos appartenant à d'autres membres ; elle ne peut pas être ajoutée à un espace.` |
| `it.json`      | `La tua selezione include foto di altri membri, quindi non può essere aggiunta a uno Space.`                      |
| `es.json`      | `Tu selección incluye fotos de otros miembros, por lo que no se puede añadir a un Space.`                         |
| `nl.json`      | `Je selectie bevat foto's van andere leden en kan daarom niet aan een Space worden toegevoegd.`                   |
| `pl.json`      | `Twój wybór zawiera zdjęcia należące do innych członków, więc nie można go dodać do Space.`                       |
| `ru.json`      | `Ваш выбор содержит фотографии других участников, поэтому его нельзя добавить в Space.`                           |
| `zh_Hans.json` | `您的选择包含其他成员的照片，因此无法添加到 Space。`                                                              |
| `zh_Hant.json` | `您的選擇包含其他成員的照片，因此無法新增至 Space。`                                                              |

"Space" stays untranslated in every locale except French, which uses "espace" — this matches each
file's existing `add_to_space` / `spaces_edit` wording.

- [ ] **Step 2: Format the JSON and regenerate the loader**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
npx --yes prettier@3 --write "i18n/*.json" > /dev/null
cd mobile
mise exec -- dart run easy_localization:generate -S ../i18n
mise exec -- dart run bin/generate_keys.dart
echo "EXIT=$?"
```

- [ ] **Step 3: Verify all ten landed**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
for l in en de fr it es nl pl ru zh_Hans zh_Hant; do
  printf "%-9s " "$l"
  grep -c '"spaces_hidden_non_owned_selection"' "i18n/$l.json"
done
git status --porcelain i18n/ | wc -l
```

Expected: `1` for each of the ten locales, and `10` changed files.

- [ ] **Step 4: Commit**

```bash
git add i18n/
git commit -m "i18n: add the non-owned selection notice in all supported locales"
```

---

### Task 2: The gating predicates

**Files:**

- Create: `mobile/lib/utils/selection_targets.dart`
- Test: `mobile/test/utils/selection_targets_test.dart`

**Interfaces produced** (Task 3 uses these):

```dart
bool selectionHasNonOwned(Iterable<BaseAsset> assets, String? currentUserId);
bool selectionHasLocked(Iterable<BaseAsset> assets);
bool selectionExceedsSpaceCap(Iterable<BaseAsset> assets);
```

- [ ] **Step 1: Write the failing test**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/utils/selection_targets.dart';

RemoteAsset _remote(String id, {String ownerId = 'me', AssetVisibility visibility = AssetVisibility.timeline}) =>
    RemoteAsset(
      id: id,
      name: id,
      ownerId: ownerId,
      checksum: id,
      type: AssetType.image,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      isEdited: false,
      visibility: visibility,
    );

LocalAsset _local(String id) => LocalAsset(
  id: id,
  name: id,
  checksum: id,
  type: AssetType.image,
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isEdited: false,
);

void main() {
  group('selectionHasNonOwned', () {
    test('is false when every remote asset is mine', () {
      expect(selectionHasNonOwned([_remote('a'), _remote('b')], 'me'), isFalse);
    });

    test('is true when any remote asset belongs to someone else', () {
      expect(selectionHasNonOwned([_remote('a'), _remote('b', ownerId: 'other')], 'me'), isTrue);
    });

    test('treats local-only assets as mine -- they will be uploaded as mine', () {
      expect(selectionHasNonOwned([_local('l1'), _remote('a')], 'me'), isFalse);
    });

    test('fails closed when the current user is unknown', () {
      expect(selectionHasNonOwned([_remote('a')], null), isTrue);
    });

    test('is false for an empty selection', () {
      expect(selectionHasNonOwned([], 'me'), isFalse);
    });
  });

  group('selectionHasLocked', () {
    test('is true when any asset is in the locked folder', () {
      expect(selectionHasLocked([_remote('a'), _remote('b', visibility: AssetVisibility.locked)]), isTrue);
    });

    test('is false for ordinary timeline assets', () {
      expect(selectionHasLocked([_remote('a'), _local('l1')]), isFalse);
    });
  });

  group('selectionExceedsSpaceCap', () {
    test('allows exactly the cap', () {
      final assets = [for (var i = 0; i < kMaxSpaceAssetsPerRequest; i++) _local('l$i')];
      expect(selectionExceedsSpaceCap(assets), isFalse);
    });

    test('rejects one over the cap', () {
      final assets = [for (var i = 0; i < kMaxSpaceAssetsPerRequest + 1; i++) _local('l$i')];
      expect(selectionExceedsSpaceCap(assets), isTrue);
    });
  });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/utils/selection_targets_test.dart
```

Expected: compile error about the missing `lib/utils/selection_targets.dart`.

If `LocalAsset`'s constructor differs from the above, read
`lib/domain/models/asset/local_asset.model.dart` and correct the **test helper** to match the real
signature — that is fixture scaffolding, not an assertion.

- [ ] **Step 3: Implement**

```dart
import 'package:immich_mobile/constants/collection.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// Whether the selection contains an asset the current user does not own.
///
/// `POST /shared-spaces/{id}/assets` requires `AssetShare` on **every** id and rejects
/// the whole request otherwise, so a single non-owned asset makes every space target
/// unusable. Local-only assets are not "non-owned": they upload as the current user's.
///
/// Fails **closed** when [currentUserId] is null — an unknown user gets no space targets
/// rather than a request certain to 400.
bool selectionHasNonOwned(Iterable<BaseAsset> assets, String? currentUserId) {
  if (currentUserId == null) {
    return assets.isNotEmpty;
  }
  return assets.any((asset) => asset is RemoteAsset && asset.ownerId != currentUserId);
}

/// Whether the selection contains a locked-folder asset.
///
/// Defensive: the locked folder is its own surface with its own bottom sheet, so such an
/// asset should not reach the picker today. If one ever did, pushing it into a shared
/// space would expose exactly what the user hid.
bool selectionHasLocked(Iterable<BaseAsset> assets) =>
    assets.any((asset) => asset is RemoteAsset && asset.visibility == AssetVisibility.locked);

/// Whether the selection is larger than one space-add request allows.
///
/// The cap is inclusive, so exactly [kMaxSpaceAssetsPerRequest] is fine.
bool selectionExceedsSpaceCap(Iterable<BaseAsset> assets) => assets.length > kMaxSpaceAssetsPerRequest;
```

- [ ] **Step 4: Run to verify it passes** — expected `+9`.

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/utils/selection_targets.dart mobile/test/utils/selection_targets_test.dart
git commit -m "feat(mobile): add space-target gating predicates"
```

---

### Task 3: `SpaceCollectionSection`

**Files:**

- Create: `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`
- Test: `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`

**Interfaces produced** (Slice 7 mounts this):

```dart
class SpaceCollectionSection extends ConsumerStatefulWidget {
  const SpaceCollectionSection({
    super.key,
    required this.onTargetSelected,
    this.excludeSpaceId,
    this.isBusy = false,
  });
  final void Function(CollectionTarget target) onTargetSelected;
  final String? excludeSpaceId;
  final bool isBusy;
}
```

It is a **box** widget. Slice 7 wraps it in `SliverToBoxAdapter`.

- [ ] **Step 1: Write the failing test**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  SharedSpaceMemberResponseDto member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
    userId: userId,
    name: userId,
    email: '$userId@e.com',
    role: role,
    joinedAt: '2026-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  );

  SharedSpaceResponseDto space(String id, {SharedSpaceRole role = SharedSpaceRole.owner, int albums = 0}) =>
      SharedSpaceResponseDto(
        id: id,
        name: 'Space $id',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdById: 'someone-else',
        members: Optional.present([member('user-1', role)]),
        albumCount: Optional.present(albums),
      );

  SpaceAlbum album(String id, String name) => SpaceAlbum(
    id: id,
    name: name,
    showInTimeline: true,
    linkedAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
  );

  RemoteAsset asset(String id, {String ownerId = 'user-1'}) => RemoteAsset(
    id: id,
    name: id,
    ownerId: ownerId,
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  Future<List<CollectionTarget>> pump(
    WidgetTester tester, {
    required List<SharedSpaceResponseDto> spaces,
    Map<String, List<SpaceAlbum>> albums = const {},
    List<RemoteAsset>? selection,
    String? excludeSpaceId,
    String? userId = 'user-1',
    bool raw = false,
  }) async {
    final targets = <CollectionTarget>[];
    final overrides = <Override>[
      sharedSpacesProvider.overrideWith((ref) async => spaces),
      currentUserProvider.overrideWith((ref) => userId == null ? null : UserStub.user1),
      multiSelectProvider.overrideWith(
        () => MultiSelectNotifier(
          MultiSelectState(selectedAssets: {...(selection ?? [asset('a')])}, lockedSelectionAssets: const {}),
        ),
      ),
      for (final entry in albums.entries)
        spaceAlbumsProvider(entry.key).overrideWith((ref) => Stream.value(entry.value)),
    ];
    final widget = SpaceCollectionSection(onTargetSelected: targets.add, excludeSpaceId: excludeSpaceId);
    if (raw) {
      await tester.pumpConsumerWidgetRaw(widget, overrides: overrides);
    } else {
      await tester.pumpConsumerWidget(widget, overrides: overrides);
    }
    return targets;
  }

  testWidgets('renders nothing when there are no writable spaces', (tester) async {
    await pump(tester, spaces: [space('s1', role: SharedSpaceRole.viewer)]);

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('lists only writable spaces, ordered by name', (tester) async {
    await pump(tester, spaces: [space('s2'), space('s1'), space('s3', role: SharedSpaceRole.viewer)]);

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s3')), findsNothing);
    final y1 = tester.getTopLeft(find.byKey(const Key('space-row-s1'))).dy;
    final y2 = tester.getTopLeft(find.byKey(const Key('space-row-s2'))).dy;
    expect(y1, lessThan(y2));
  });

  testWidgets('a space with no linked albums adds to the pool on a single tap', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 0)]);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(1));
    expect((targets.single as SpacePoolTarget).space.id, 's1');
  });

  testWidgets('a space with albums expands instead of adding, then collapses', (tester) async {
    final targets = await pump(
      tester,
      spaces: [space('s1', albums: 2)],
      albums: {'s1': [album('a1', 'Ski trip'), album('a2', 'Christmas')]},
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, isEmpty, reason: 'expanding must not dump photos into the space');
    expect(find.byKey(const Key('space-pool-child-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-child-a1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('space-pool-child-s1')), findsNothing);
  });

  testWidgets('the pool child emits a SpacePoolTarget', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 1)], albums: {'s1': [album('a1', 'Ski')]});

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-pool-child-s1')));
    await tester.pumpAndSettle();

    expect((targets.single as SpacePoolTarget).space.id, 's1');
  });

  testWidgets('an album child emits a SpaceAlbumTarget carrying the owning space id', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 1)], albums: {'s1': [album('a1', 'Ski')]});

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-child-a1')));
    await tester.pumpAndSettle();

    final target = targets.single as SpaceAlbumTarget;
    expect(target.spaceId, 's1');
    expect(target.album.id, 'a1');
  });

  testWidgets('expanding a second space collapses the first', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1), space('s2', albums: 1)],
      albums: {'s1': [album('a1', 'One')], 's2': [album('a2', 'Two')]},
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-row-s2')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-pool-child-s1')), findsNothing);
    expect(find.byKey(const Key('space-pool-child-s2')), findsOneWidget);
  });

  testWidgets('albumCount > 0 but an empty stream still offers the pool', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 3)], albums: {'s1': const []});

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-albums-empty-s1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('space-pool-child-s1')));
    await tester.pumpAndSettle();
    expect(targets, hasLength(1));
  });

  testWidgets('a double-tap on a plain row emits exactly one target', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 0)]);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(1), reason: 'two adds would fire two activity entries');
  });

  testWidgets('a non-owned selection hides every row behind a notice', (tester) async {
    await pump(tester, spaces: [space('s1')], selection: [asset('a'), asset('b', ownerId: 'other')]);

    expect(find.text("Your selection includes photos owned by other members, so it can't be added to a space."), findsOneWidget);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('an unknown current user hides the rows (fail closed)', (tester) async {
    await pump(tester, spaces: [space('s1')], userId: null);

    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('the excluded space is absent from its own list', (tester) async {
    await pump(tester, spaces: [space('s1'), space('s2')], excludeSpaceId: 's1');

    expect(find.byKey(const Key('space-row-s1')), findsNothing);
    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);
  });

  testWidgets('a provider error hides the section rather than surfacing an error', (tester) async {
    final targets = <CollectionTarget>[];
    await tester.pumpConsumerWidget(
      SpaceCollectionSection(onTargetSelected: targets.add),
      overrides: [
        sharedSpacesProvider.overrideWith((ref) async => throw Exception('offline')),
        currentUserProvider.overrideWith((ref) => UserStub.user1),
      ],
    );

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
  });
}
```

**Verified fixture:** `test/fixtures/user.stub.dart` exposes `UserStub.user1` (a `UserDto` with
`id: "user-1"`); there is **no** `UserStub.user(id)` factory. So use `UserStub.user1` and make the
owner ids in this test `'user-1'` rather than `'me'` (both in `asset()`'s default `ownerId`, in
`member('me', ...)` -> `member('user-1', ...)`, and in the `userId` parameter). For the
"unknown current user" test, override `currentUserProvider` to return `null`.

**Note on `multiSelectProvider.overrideWith`:** if `MultiSelectNotifier` cannot be constructed with a
seed state, instead override with the default and call `selectAsset` for each asset after pumping,
then `await tester.pump()`. Adapt the harness, not the assertions.

- [ ] **Step 2: Run to verify it fails** — expected: missing-file compile error.

- [ ] **Step 3: Implement**

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/utils/selection_targets.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart';

/// The "Spaces" half of the add-to-collection picker.
///
/// A plain box widget so it can be pumped directly in tests; the picker wraps it in a
/// `SliverToBoxAdapter`. Space rows come from the network `sharedSpacesProvider`; a row's
/// linked albums come from the local Drift `spaceAlbumsProvider`, watched ONLY while that
/// row is expanded, so collapsed spaces subscribe to nothing.
class SpaceCollectionSection extends ConsumerStatefulWidget {
  const SpaceCollectionSection({super.key, required this.onTargetSelected, this.excludeSpaceId, this.isBusy = false});

  final void Function(CollectionTarget target) onTargetSelected;

  /// Set on a space's own surface so it is not offered as a destination for its own assets.
  final String? excludeSpaceId;

  /// Disables every row while an add is in flight.
  final bool isBusy;

  @override
  ConsumerState<SpaceCollectionSection> createState() => _SpaceCollectionSectionState();
}

class _SpaceCollectionSectionState extends ConsumerState<SpaceCollectionSection> {
  /// Accordion: at most one expanded space, which bounds live Drift subscriptions to one.
  String? _expandedSpaceId;

  /// Guards a double-tap on a plain row from emitting two targets.
  bool _emitted = false;

  void _emit(CollectionTarget target) {
    if (_emitted || widget.isBusy) return;
    _emitted = true;
    widget.onTargetSelected(target);
  }

  @override
  Widget build(BuildContext context) {
    final spacesAsync = ref.watch(sharedSpacesProvider);
    final userId = ref.watch(currentUserProvider.select((user) => user?.id));
    final selection = ref.watch(multiSelectProvider.select((state) => state.selectedAssets));

    final spaces = spacesAsync.valueOrNull;
    // Offline or still loading: the album half of the picker still works, so stay out of
    // the way rather than surfacing an error into someone else's sheet.
    if (spaces == null) return const SizedBox.shrink();

    final writable = spaces
        .where((space) => spaceIsWritable(space, userId) && space.id != widget.excludeSpaceId)
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    if (writable.isEmpty) return const SizedBox.shrink();

    final String? notice;
    if (selectionHasNonOwned(selection, userId)) {
      notice = 'spaces_hidden_non_owned_selection'.t(context: context);
    } else if (selectionHasLocked(selection)) {
      notice = 'spaces_hidden_non_owned_selection'.t(context: context);
    } else if (selectionExceedsSpaceCap(selection)) {
      notice = 'spaces_hidden_too_many_assets'.t(
        context: context,
        args: {'count': kMaxSpaceAssetsPerRequest.toString()},
      );
    } else {
      notice = null;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          key: const Key('space-collection-header'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text('spaces'.t(context: context), style: context.textTheme.labelLarge),
        ),
        if (notice != null)
          Padding(
            key: const Key('space-collection-notice'),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                const Icon(Icons.info_outline, size: 16),
                const SizedBox(width: 8),
                Expanded(child: Text(notice, style: context.textTheme.bodySmall)),
              ],
            ),
          )
        else
          for (final space in writable) ..._rowsFor(space),
      ],
    );
  }

  List<Widget> _rowsFor(SharedSpaceResponseDto space) {
    // albumCount is Optional<num?> and is the ONLY way to know a row is expandable without
    // subscribing to its Drift stream. An absent count reads as 0 -- a plain row, which
    // still reaches the pool.
    final albumCount = (space.albumCount.orElse(null) ?? 0).toInt();
    final expandable = albumCount > 0;
    final expanded = _expandedSpaceId == space.id;

    return [
      ListTile(
        key: Key('space-row-${space.id}'),
        enabled: !widget.isBusy,
        leading: CircleAvatar(backgroundColor: spaceGradientColors(space.color.orElse(null)).first, radius: 16),
        title: Text(space.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: expandable ? Icon(expanded ? Icons.expand_less : Icons.expand_more) : null,
        onTap: widget.isBusy
            ? null
            : () {
                if (!expandable) {
                  _emit(SpacePoolTarget(space));
                  return;
                }
                setState(() => _expandedSpaceId = expanded ? null : space.id);
              },
      ),
      if (expanded) ..._childrenFor(space),
    ];
  }

  List<Widget> _childrenFor(SharedSpaceResponseDto space) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(space.id));
    final albums = albumsAsync.valueOrNull ?? const <SpaceAlbum>[];

    return [
      ListTile(
        key: Key('space-pool-child-${space.id}'),
        contentPadding: const EdgeInsets.only(left: 48, right: 16),
        leading: const Icon(Icons.workspaces_outline),
        title: Text('add_to_space'.t(context: context)),
        enabled: !widget.isBusy,
        onTap: widget.isBusy ? null : () => _emit(SpacePoolTarget(space)),
      ),
      if (albums.isEmpty)
        Padding(
          key: Key('space-albums-empty-${space.id}'),
          padding: const EdgeInsets.only(left: 48, right: 16, bottom: 8),
          child: Text('no_albums_in_space_yet'.t(context: context), style: context.textTheme.bodySmall),
        )
      else
        for (final album in albums)
          ListTile(
            key: Key('space-album-child-${album.id}'),
            contentPadding: const EdgeInsets.only(left: 48, right: 16),
            leading: const Icon(Icons.photo_album_outlined),
            title: Text(album.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            enabled: !widget.isBusy,
            onTap: widget.isBusy ? null : () => _emit(SpaceAlbumTarget(spaceId: space.id, album: album)),
          ),
    ];
  }
}
```

Add `import 'package:immich_mobile/constants/collection.dart';` for `kMaxSpaceAssetsPerRequest`.

Two existing i18n keys are used here beyond the new one, both already verified present and
translated — do NOT re-check and do NOT add keys:

- `spaces` = "Spaces" (`i18n/en.json:2714`) for the section header.
- `no_albums_in_space_yet` = "This space has no albums yet" (`:2061`) for the empty-albums hint.
  Note this is **not** `no_albums_yet`, which reads "It looks like you do not have any albums yet."
  and is about the user's personal albums.

- [ ] **Step 4: Run to verify it passes** — expected `+13`.

- [ ] **Step 5: Slice gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/s6.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s6.log
```

Expected: all `0`, `+2870 ~1`.

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart \
        mobile/test/presentation/widgets/collection/space_collection_section_test.dart
git commit -m "feat(mobile): add the spaces section of the collection picker"
```

---

## Self-Review

**1. Spec coverage.** The §3 gating table's six states: loading/error → hidden ✓ (one test; the
implementation treats both as `valueOrNull == null`), no writable ✓, non-owned notice ✓, locked and
over-cap ✓ (predicates unit-tested in Task 2; the widget shares one notice branch), normal rows ✓.
Row behaviour: plain-row single tap ✓, expandable ✓, collapse ✓, accordion ✓, pool child ✓, album
child with space id ✓, empty stream ✓, double-tap ✓, exclusion ✓, fail-closed ✓, ordering ✓.

**Deliberately not covered here:** the "collapsed row issues no Drift query" assertion (Riverpod
gives no public subscription-count hook; the accordion structure makes it true by construction —
`_childrenFor` is the only `ref.watch(spaceAlbumsProvider)` and runs only when expanded), the
loading-skeleton state (the implementation renders nothing while loading rather than a skeleton — a
deliberate simplification over the spec, since the section is additive and a skeleton would push the
album list down then yank it back), semantics/tap-target assertions (`ListTile` already meets both by
construction), and the "rows disabled while busy" case (`isBusy` is wired but Slice 7 owns its only
caller). **All are recorded here rather than silently dropped**; the spec's follow-up list should
gain the skeleton deviation.

**2. Placeholder scan.** No TBD/TODO. The three spots where a real name may differ (`UserStub`,
`MultiSelectNotifier` seeding, the two extra i18n keys) each carry the exact command or file to check
and an explicit instruction not to invent replacements.

**3. Type consistency.** `onTargetSelected` is `void Function(CollectionTarget)` in the widget and
the test's `targets.add`. `SpacePoolTarget(space)` is positional and `SpaceAlbumTarget({spaceId,
album})` is named — matching Slice 5's definitions exactly. `albumCount.orElse(null) ?? 0` yields
`num`, hence the `.toInt()`.
