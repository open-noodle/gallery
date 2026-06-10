# People Sort — Slice 2 (Mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-controlled People-view sort (Name A–Z / Most photos) in the Flutter app, persisted via the settings store, defaulting to Most photos, with the person picker pinned to its current ordering.

**Architecture:** A `PeopleSortBy` domain enum + `Setting.peopleSortBy` (int index, Store-backed), two `ORDER BY` variants in `DriftPeopleRepository.getAllPeople` (tiers: favorites → named(trimmed) → unnamed; mode changes within-tier order), `driftGetAllPeopleProvider` becomes a `.family` keyed by mode (family-root invalidation keeps all existing `ref.invalidate` sites working unchanged), and a `PeopleSortButton` AppBar action styled on the albums `_SortButton` MenuAnchor.

**Tech Stack:** Flutter/Dart, drift 2.33 (in-memory `NativeDatabase.memory()` for tests), hooks_riverpod, easy_localization, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-06-10-people-sort-design.md` (Sort semantics + Edge cases). i18n keys `sort_people_by` / `sort_people_most_photos` already exist in `i18n/en.json` (slice 1); mobile's generated i18n files are NOT committed — no codegen step needed.

**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/people-sort-676`. Run mobile commands from `mobile/` with `export PATH="$HOME/.local/share/mise/shims:$PATH"` so the mise-pinned flutter/dart are used. NEVER run bare `dart analyze` (it pulls `packages/ui/showcase`); use `dart analyze --fatal-infos lib test`.

**Critical invariants:**

- `StoreKey` integer ids are append-only; `peopleSortBy` takes the next free id **1015** (current max: `backgroundBackupStatus` = 1014).
- The person picker (`peoplePickerAllProvider`) and the library page people card pin `PeopleSortBy.photoCount` — the People-view preference must NOT leak into them (`peopleAlphaIndex` preserves input order within letter buckets).
- The `having` clause (≥3 faces OR named, untrimmed `name != ''`) is inclusion logic and stays byte-identical; only `orderBy` changes (plus the new favorites tier and trimmed-name tiering).
- `ref.invalidate(driftGetAllPeopleProvider)` call sites (tab_shell.page.dart:119, gallery_bottom_nav.widget.dart:141, person_edit_name_modal.widget.dart:34, person_edit_birthday_modal.widget.dart:36) need NO changes — invalidating a family root invalidates all members.
- TDD throughout: failing test first (a compile error in a test file counts as red), then implement, then green. Report red and green evidence.

---

### Task 1: Domain enum, StoreKey, Setting

**Files:**

- Modify: `mobile/lib/domain/models/person.model.dart` (append at end of file)
- Modify: `mobile/lib/domain/models/store.model.dart` (~line 99)
- Modify: `mobile/lib/domain/models/setting.model.dart` (~line 12)
- Test: Create `mobile/test/domain/models/people_sort_test.dart`

- [ ] **Step 1: Write the failing test**

Create `mobile/test/domain/models/people_sort_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';

void main() {
  group('peopleSortByFromSettingIndex', () {
    test('maps valid indices to modes', () {
      expect(peopleSortByFromSettingIndex(PeopleSortBy.photoCount.index), PeopleSortBy.photoCount);
      expect(peopleSortByFromSettingIndex(PeopleSortBy.name.index), PeopleSortBy.name);
    });

    test('clamps out-of-range indices to the photoCount default', () {
      expect(peopleSortByFromSettingIndex(-1), PeopleSortBy.photoCount);
      expect(peopleSortByFromSettingIndex(99), PeopleSortBy.photoCount);
    });
  });

  test('Setting.peopleSortBy defaults to photoCount', () {
    expect(Setting.peopleSortBy.defaultValue, PeopleSortBy.photoCount.index);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd mobile && flutter test test/domain/models/people_sort_test.dart
```

Expected: FAIL to compile — `PeopleSortBy`, `peopleSortByFromSettingIndex`, `Setting.peopleSortBy` undefined.

- [ ] **Step 3: Implement**

a) `mobile/lib/domain/models/person.model.dart` — append at the end of the file:

```dart
enum PeopleSortBy { photoCount, name }

PeopleSortBy peopleSortByFromSettingIndex(int index) {
  if (index < 0 || index >= PeopleSortBy.values.length) {
    return PeopleSortBy.photoCount;
  }

  return PeopleSortBy.values[index];
}
```

b) `mobile/lib/domain/models/store.model.dart` — the enum currently ends with:

```dart
  syncMigrationStatus<String>._(1013),
  backgroundBackupStatus<String>._(1014);
```

Change to:

```dart
  syncMigrationStatus<String>._(1013),
  backgroundBackupStatus<String>._(1014),

  peopleSortBy<int>._(1015);
```

c) `mobile/lib/domain/models/setting.model.dart` — the enum currently ends with:

```dart
  enableBackup<bool>(StoreKey.enableBackup, false);
```

Change to:

```dart
  enableBackup<bool>(StoreKey.enableBackup, false),
  peopleSortBy<int>(StoreKey.peopleSortBy, 0);
```

(0 = `PeopleSortBy.photoCount.index` — the Most photos default.)

- [ ] **Step 4: Run to verify it passes**

```bash
cd mobile && flutter test test/domain/models/people_sort_test.dart
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/domain/models/person.model.dart mobile/lib/domain/models/store.model.dart mobile/lib/domain/models/setting.model.dart mobile/test/domain/models/people_sort_test.dart
git commit -m "feat(mobile): PeopleSortBy setting with photoCount default (#676)"
```

---

### Task 2: Repository ordering + service passthrough

**Files:**

- Modify: `mobile/test/medium/repository_context.dart` (add `newPerson` / `newAssetFace` helpers)
- Modify: `mobile/lib/infrastructure/repositories/people.repository.dart:35-62`
- Modify: `mobile/lib/domain/services/people.service.dart:21-23`
- Test: Create `mobile/test/infrastructure/repositories/people_repository_test.dart`

- [ ] **Step 1: Add factory helpers to MediumRepositoryContext**

In `mobile/test/medium/repository_context.dart`, add inside `MediumRepositoryContext` (next to `newRemoteAsset`; the file already imports `Value`, `Uuid`, and the drift db with all entities):

```dart
  Future<PersonEntityData> newPerson({
    String? id,
    required String ownerId,
    String name = '',
    bool isFavorite = false,
    bool isHidden = false,
  }) {
    return db
        .into(db.personEntity)
        .insertReturning(
          PersonEntityCompanion(
            id: Value(id ?? const Uuid().v4()),
            ownerId: Value(ownerId),
            name: Value(name),
            isFavorite: Value(isFavorite),
            isHidden: Value(isHidden),
          ),
        );
  }

  Future<AssetFaceEntityData> newAssetFace({
    String? id,
    required String assetId,
    String? personId,
    bool isVisible = true,
    DateTime? deletedAt,
  }) {
    return db
        .into(db.assetFaceEntity)
        .insertReturning(
          AssetFaceEntityCompanion(
            id: Value(id ?? const Uuid().v4()),
            assetId: Value(assetId),
            personId: Value(personId),
            imageWidth: const Value(1000),
            imageHeight: const Value(1000),
            boundingBoxX1: const Value(0),
            boundingBoxY1: const Value(0),
            boundingBoxX2: const Value(100),
            boundingBoxY2: const Value(100),
            sourceType: const Value('machine-learning'),
            isVisible: Value(isVisible),
            deletedAt: Value(deletedAt),
          ),
        );
  }
```

If `PersonEntityData`/`AssetFaceEntityCompanion` are unresolved, add the missing entity imports the same way the file imports the other entities (check its import block and mirror it).

- [ ] **Step 2: Write the failing repository test**

Create `mobile/test/infrastructure/repositories/people_repository_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';

import '../../medium/repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late DriftPeopleRepository sut;
  late String userId;
  late String assetId;

  setUp(() async {
    ctx = MediumRepositoryContext();
    sut = DriftPeopleRepository(ctx.db);
    final user = await ctx.newUser();
    userId = user.id;
    final asset = await ctx.newRemoteAsset(ownerId: userId);
    assetId = asset.id;
  });

  tearDown(() async {
    await ctx.dispose();
  });

  /// Inserts a person with [faces] visible face rows on the shared asset.
  Future<String> seedPerson({
    required String id,
    String name = '',
    bool isFavorite = false,
    bool isHidden = false,
    int faces = 3,
  }) async {
    await ctx.newPerson(id: id, ownerId: userId, name: name, isFavorite: isFavorite, isHidden: isHidden);
    for (var i = 0; i < faces; i++) {
      await ctx.newAssetFace(assetId: assetId, personId: id);
    }
    return id;
  }

  group('getAllPeople', () {
    test('photoCount mode: favorites first, then named by face count, unnamed last', () async {
      await seedPerson(id: 'named-mid', name: 'Zoe', faces: 5);
      await seedPerson(id: 'unnamed-high', faces: 9);
      await seedPerson(id: 'named-top', name: 'Mara', faces: 7);
      await seedPerson(id: 'fav-unnamed', isFavorite: true, faces: 3);
      await seedPerson(id: 'fav-named', name: 'Ada', isFavorite: true, faces: 3);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['fav-named', 'fav-unnamed', 'named-top', 'named-mid', 'unnamed-high']);
    });

    test('photoCount mode: equal counts tie-break by name then id', () async {
      await seedPerson(id: 'tie-b', name: 'bob', faces: 4);
      await seedPerson(id: 'tie-a', name: 'Alice', faces: 4);
      await seedPerson(id: 'u-b', faces: 4);
      await seedPerson(id: 'u-a', faces: 4);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['tie-a', 'tie-b', 'u-a', 'u-b']);
    });

    test('name mode: named A-Z case-insensitively ignoring counts, unnamed by count last', () async {
      await seedPerson(id: 'named-b', name: 'bob', faces: 9);
      await seedPerson(id: 'named-a', name: 'Alice', faces: 3);
      await seedPerson(id: 'unnamed-low', faces: 4);
      await seedPerson(id: 'unnamed-high', faces: 6);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.name);

      expect(people.map((p) => p.id), ['named-a', 'named-b', 'unnamed-high', 'unnamed-low']);
    });

    test('whitespace-only names land in the unnamed tier in both modes', () async {
      await seedPerson(id: 'blank', name: '  ', faces: 9);
      await seedPerson(id: 'named', name: 'Zoe', faces: 3);

      for (final mode in PeopleSortBy.values) {
        final people = await sut.getAllPeople(sortBy: mode);
        expect(people.map((p) => p.id), ['named', 'blank'], reason: 'mode: $mode');
      }
    });

    test('defaults to photoCount ordering when no mode is passed', () async {
      await seedPerson(id: 'named-small', name: 'Alice', faces: 3);
      await seedPerson(id: 'named-big', name: 'Zoe', faces: 8);

      final people = await sut.getAllPeople();

      expect(people.map((p) => p.id), ['named-big', 'named-small']);
    });

    test('keeps exclusion rules: hidden people and unnamed people with fewer than 3 faces', () async {
      await seedPerson(id: 'hidden', name: 'Hidden', isHidden: true, faces: 9);
      await seedPerson(id: 'unnamed-two-faces', faces: 2);
      await seedPerson(id: 'named-one-face', name: 'Solo', faces: 1);

      final people = await sut.getAllPeople(sortBy: PeopleSortBy.photoCount);

      expect(people.map((p) => p.id), ['named-one-face']);
    });
  });
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd mobile && flutter test test/infrastructure/repositories/people_repository_test.dart
```

Expected: FAIL to compile — `getAllPeople` takes no `sortBy` parameter yet.

- [ ] **Step 4: Implement the repository ordering**

In `mobile/lib/infrastructure/repositories/people.repository.dart`, replace `getAllPeople` (lines 35–62) with:

```dart
  Future<List<DriftPerson>> getAllPeople({PeopleSortBy sortBy = PeopleSortBy.photoCount}) async {
    final people = _db.personEntity;
    final faces = _db.assetFaceEntity;
    final assets = _db.remoteAssetEntity;

    final favoritesFirst = OrderingTerm(expression: people.isFavorite, mode: OrderingMode.desc);
    // BTRIM semantics: whitespace-only names belong to the unnamed tier.
    final namedFirst = OrderingTerm(expression: people.name.trim().equals('').not(), mode: OrderingMode.desc);
    final byFaceCount = OrderingTerm(expression: faces.id.count(), mode: OrderingMode.desc);
    final byName = OrderingTerm(expression: people.name.trim().lower());
    final byId = OrderingTerm(expression: people.id);

    final query =
        _db.select(people).join([
            innerJoin(faces, faces.personId.equalsExp(people.id)),
            innerJoin(assets, assets.id.equalsExp(faces.assetId)),
          ])
          ..where(
            people.isHidden.equals(false) &
                assets.deletedAt.isNull() &
                assets.visibility.equalsValue(AssetVisibility.timeline) &
                faces.isVisible.equals(true) &
                faces.deletedAt.isNull(),
          )
          ..groupBy([people.id], having: faces.id.count().isBiggerOrEqualValue(3) | people.name.equals('').not())
          ..orderBy(switch (sortBy) {
            PeopleSortBy.photoCount => [favoritesFirst, namedFirst, byFaceCount, byName, byId],
            PeopleSortBy.name => [favoritesFirst, namedFirst, byName, byFaceCount, byId],
          });

    return query.map((row) {
      final person = row.readTable(people);
      return person.toDto();
    }).get();
  }
```

(`person.model.dart` is already imported by this file; `OrderingTerm` defaults to ascending, so `byName`/`byId` need no explicit mode.)

- [ ] **Step 5: Service passthrough**

In `mobile/lib/domain/services/people.service.dart`, replace `getAllPeople` (lines 21–23) with:

```dart
  Future<List<DriftPerson>> getAllPeople({PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
    return _repository.getAllPeople(sortBy: sortBy);
  }
```

(`person.model.dart` is already imported.)

- [ ] **Step 6: Run to verify it passes**

```bash
cd mobile && flutter test test/infrastructure/repositories/people_repository_test.dart
```

Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add mobile/test/medium/repository_context.dart mobile/lib/infrastructure/repositories/people.repository.dart mobile/lib/domain/services/people.service.dart mobile/test/infrastructure/repositories/people_repository_test.dart
git commit -m "feat(mobile): two-mode people ordering in DriftPeopleRepository (#676)"
```

---

### Task 3: Provider family + pinned consumers

**Files:**

- Modify: `mobile/lib/providers/infrastructure/people.provider.dart:21-24`
- Modify: `mobile/lib/providers/photos_filter/people_picker.provider.dart:21`
- Modify: `mobile/lib/presentation/pages/drift_library.page.dart:246` (+ import)
- Test: Modify `mobile/test/providers/photos_filter/people_picker_provider_test.dart` and `mobile/test/presentation/pages/photos_filter/person_picker_test.dart` (override syntax), add picker regression test

- [ ] **Step 1: Write the failing picker regression test**

In `mobile/test/providers/photos_filter/people_picker_provider_test.dart`, inside `group('peoplePickerAllProvider', ...)`, add:

```dart
    test('pins photoCount ordering regardless of the people sort preference', () async {
      final c = ProviderContainer(
        overrides: [
          driftGetAllPeopleProvider.overrideWith(
            (ref, sortBy) async => sortBy == PeopleSortBy.photoCount ? [_d('pinned', 'Alice')] : [_d('leaked', 'Bob')],
          ),
        ],
      );
      addTearDown(c.dispose);
      final result = await c.read(peoplePickerAllProvider.future);
      expect(result.map((p) => p.id), ['pinned']);
    });
```

`PeopleSortBy` resolves via the existing `person.model.dart` import in this file.

- [ ] **Step 2: Run to verify it fails**

```bash
cd mobile && flutter test test/providers/photos_filter/people_picker_provider_test.dart
```

Expected: FAIL to compile — `overrideWith` on the non-family provider doesn't accept a two-arg closure.

- [ ] **Step 3: Implement the family + consumers**

a) `mobile/lib/providers/infrastructure/people.provider.dart` — replace lines 21–24 with:

```dart
final driftGetAllPeopleProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>((ref, sortBy) async {
  final service = ref.watch(driftPeopleServiceProvider);
  return service.getAllPeople(sortBy: sortBy);
});
```

(`person.model.dart` is already imported. The four `ref.invalidate(driftGetAllPeopleProvider)` sites elsewhere compile unchanged — family-root invalidation invalidates all members.)

b) `mobile/lib/providers/photos_filter/people_picker.provider.dart:21` — change:

```dart
  final all = await ref.watch(driftGetAllPeopleProvider(PeopleSortBy.photoCount).future);
```

Also extend the doc comment above `peoplePickerAllProvider` with one line:

```dart
/// Pinned to photoCount ordering: peopleAlphaIndex preserves input order within
/// letter buckets, so the People-view sort preference must not leak in here.
```

c) `mobile/lib/presentation/pages/drift_library.page.dart:246` — change:

```dart
    final people = ref.watch(driftGetAllPeopleProvider(PeopleSortBy.photoCount));
```

and add the import (the file does not import person.model yet):

```dart
import 'package:immich_mobile/domain/models/person.model.dart';
```

d) Migrate the three existing overrides in `mobile/test/presentation/pages/photos_filter/person_picker_test.dart` (lines ~93, ~134, ~153) from:

```dart
driftGetAllPeopleProvider.overrideWith((ref) async => [...])
```

to:

```dart
driftGetAllPeopleProvider.overrideWith((ref, sortBy) async => [...])
```

and the one in `mobile/test/providers/photos_filter/people_picker_provider_test.dart:21` (`_containerWith`) the same way. Add the `person.model.dart` import to `person_picker_test.dart` only if it doesn't already have one.

- [ ] **Step 4: Run to verify pass**

```bash
cd mobile && flutter test test/providers/photos_filter/people_picker_provider_test.dart test/presentation/pages/photos_filter/person_picker_test.dart
```

Expected: PASS — all tests in both files including the new regression test.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/providers/infrastructure/people.provider.dart mobile/lib/providers/photos_filter/people_picker.provider.dart mobile/lib/presentation/pages/drift_library.page.dart mobile/test/providers/photos_filter/people_picker_provider_test.dart mobile/test/presentation/pages/photos_filter/person_picker_test.dart
git commit -m "feat(mobile): sort-keyed people provider family with pinned picker and library card (#676)"
```

---

### Task 4: PeopleSortButton widget

**Files:**

- Create: `mobile/lib/presentation/widgets/people/people_sort_button.widget.dart`
- Test: Create `mobile/test/presentation/widgets/people/people_sort_button_test.dart`

- [ ] **Step 1: Write the failing widget test**

Create `mobile/test/presentation/widgets/people/people_sort_button_test.dart` (bootstrap mirrors `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`):

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pumpButton(WidgetTester tester) async {
    await tester.pumpConsumerWidget(
      const CustomScrollView(
        slivers: [
          SliverAppBar(actions: [PeopleSortButton()]),
        ],
      ),
    );
    await tester.pumpAndSettle();
  }

  Color? checkColor(WidgetTester tester, PeopleSortBy mode) {
    final icon = tester.widget<Icon>(
      find.descendant(of: find.byKey(Key('people-sort-${mode.name}')), matching: find.byType(Icon)),
    );
    return icon.color;
  }

  group('PeopleSortButton', () {
    testWidgets('defaults to Most photos and writes the Name setting when tapped', (tester) async {
      await pumpButton(tester);

      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('people-sort-photoCount')), findsOneWidget);
      expect(find.byKey(const Key('people-sort-name')), findsOneWidget);
      expect(checkColor(tester, PeopleSortBy.photoCount), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleSortBy.name), Colors.transparent);

      await tester.tap(find.byKey(const Key('people-sort-name')));
      await tester.pumpAndSettle();

      expect(Store.tryGet(StoreKey.peopleSortBy), PeopleSortBy.name.index);
    });

    testWidgets('initializes the selected item from Setting.peopleSortBy', (tester) async {
      await Store.put(StoreKey.peopleSortBy, PeopleSortBy.name.index);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleSortBy.name), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleSortBy.photoCount), Colors.transparent);
    });

    testWidgets('an out-of-range stored value falls back to Most photos', (tester) async {
      await Store.put(StoreKey.peopleSortBy, 99);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleSortBy.photoCount), isNot(Colors.transparent));
    });
  });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd mobile && flutter test test/presentation/widgets/people/people_sort_button_test.dart
```

Expected: FAIL to compile — `people_sort_button.widget.dart` does not exist.

- [ ] **Step 3: Implement the widget**

Create `mobile/lib/presentation/widgets/people/people_sort_button.widget.dart` (MenuAnchor recipe mirrors the albums `_SortButton` in `mobile/lib/presentation/widgets/album/album_selector.widget.dart:233+`):

```dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';

class PeopleSortButton extends ConsumerWidget {
  const PeopleSortButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(
      settingsProvider.select((settings) => peopleSortByFromSettingIndex(settings.get(Setting.peopleSortBy))),
    );

    return MenuAnchor(
      style: MenuStyle(
        elevation: const WidgetStatePropertyAll(1),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(24))),
        ),
        padding: const WidgetStatePropertyAll(EdgeInsets.all(4)),
      ),
      consumeOutsideTap: true,
      menuChildren: PeopleSortBy.values.map((mode) => _menuItem(context, ref, mode, selected)).toList(),
      builder: (context, controller, child) {
        return IconButton(
          key: const Key('people-sort-button'),
          icon: const Icon(Icons.swap_vert),
          tooltip: 'sort_people_by'.tr(),
          onPressed: () {
            if (controller.isOpen) {
              controller.close();
            } else {
              controller.open();
            }
          },
        );
      },
    );
  }

  Widget _menuItem(BuildContext context, WidgetRef ref, PeopleSortBy mode, PeopleSortBy selected) {
    final isSelected = mode == selected;
    final label = switch (mode) {
      PeopleSortBy.photoCount => 'sort_people_most_photos'.tr(),
      PeopleSortBy.name => 'name'.tr(),
    };

    return MenuItemButton(
      key: Key('people-sort-${mode.name}'),
      leadingIcon: Icon(
        Icons.check_rounded,
        color: isSelected ? context.colorScheme.onPrimary : Colors.transparent,
      ),
      onPressed: () async {
        await ref.read(settingsProvider.notifier).set(Setting.peopleSortBy, mode.index);
      },
      style: ButtonStyle(
        padding: WidgetStateProperty.all(const EdgeInsets.fromLTRB(12, 12, 24, 12)),
        backgroundColor: WidgetStateProperty.all(isSelected ? context.colorScheme.primary : Colors.transparent),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
        ),
      ),
      child: Text(
        label,
        style: context.textTheme.labelLarge?.copyWith(
          color: isSelected ? context.colorScheme.onPrimary : context.colorScheme.onSurface.withAlpha(185),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd mobile && flutter test test/presentation/widgets/people/people_sort_button_test.dart
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/people/people_sort_button.widget.dart mobile/test/presentation/widgets/people/people_sort_button_test.dart
git commit -m "feat(mobile): people sort menu button (#676)"
```

---

### Task 5: Page wiring + page test

**Files:**

- Modify: `mobile/lib/presentation/pages/drift_people_collection.page.dart`
- Test: Create `mobile/test/presentation/pages/drift_people_collection_test.dart`

- [ ] **Step 1: Write the failing page test**

Create `mobile/test/presentation/pages/drift_people_collection_test.dart` (the `serverEndpoint` store key makes avatar `RemoteImageProvider` URLs resolvable in tests — pattern from `recent_people_strip_test.dart`):

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/drift_people_collection.page.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

DriftPerson _person(String id, String name) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: name,
  isFavorite: false,
  isHidden: false,
  color: null,
);

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // .first: the page puts ValueKey(person.id) on BOTH the tile Column and its
  // CircleAvatar (drift_people_collection.page.dart:82,92), so byKey matches two widgets.
  double dxOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dx;
  double dyOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dy;

  bool isBefore(WidgetTester tester, String a, String b) {
    final dyA = dyOf(tester, a);
    final dyB = dyOf(tester, b);
    if (dyA != dyB) {
      return dyA < dyB;
    }
    return dxOf(tester, a) < dxOf(tester, b);
  }

  group('DriftPeopleCollectionPage', () {
    testWidgets('renders the sort-keyed provider order and re-queries when the setting changes', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleProvider.overrideWith(
            (ref, sortBy) async => sortBy == PeopleSortBy.photoCount
                ? [_person('zoe', 'Zoe'), _person('alice', 'Alice')]
                : [_person('alice', 'Alice'), _person('zoe', 'Zoe')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'zoe', 'alice'), isTrue);

      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('people-sort-name')));
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'alice', 'zoe'), isTrue);
      expect(Store.tryGet(StoreKey.peopleSortBy), PeopleSortBy.name.index);
    });

    testWidgets('the in-page search filter preserves the provider order', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleProvider.overrideWith(
            (ref, sortBy) async => [_person('zo', 'Zora'), _person('al', 'Alora'), _person('bo', 'Bob')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.search));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'ora');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('bo')), findsNothing);
      expect(find.byKey(const ValueKey('zo')), findsWidgets);
      expect(isBefore(tester, 'zo', 'al'), isTrue);
    });
  });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd mobile && flutter test test/presentation/pages/drift_people_collection_test.dart
```

Expected: FAIL — the page still watches the parameterless provider (compile error on the family override / no `people-sort-button` key found).

- [ ] **Step 3: Wire the page**

In `mobile/lib/presentation/pages/drift_people_collection.page.dart`:

a) Add imports:

```dart
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
```

b) In `build` (line ~33), replace:

```dart
    final people = ref.watch(driftGetAllPeopleProvider);
```

with:

```dart
    final sortBy = ref.watch(
      settingsProvider.select((settings) => peopleSortByFromSettingIndex(settings.get(Setting.peopleSortBy))),
    );
    final people = ref.watch(driftGetAllPeopleProvider(sortBy));
```

c) In the `AppBar` `actions` (line ~53), add the sort button before the search toggle:

```dart
            actions: [
              const PeopleSortButton(),
              IconButton(
                icon: Icon(_search != null ? Icons.close : Icons.search),
                onPressed: () {
                  setState(() => _search = _search == null ? '' : null);
                },
              ),
            ],
```

- [ ] **Step 4: Run to verify pass**

```bash
cd mobile && flutter test test/presentation/pages/drift_people_collection_test.dart
```

Expected: PASS (2 tests). If the avatar network images make the test flaky/erroring, wrap the pump in `mockNetworkImagesFor`-style handling ONLY if the repo already has such a helper; otherwise report DONE_WITH_CONCERNS with the exact error rather than inventing new infrastructure.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/pages/drift_people_collection.page.dart mobile/test/presentation/pages/drift_people_collection_test.dart
git commit -m "feat(mobile): people view sort control with persisted preference (#676)"
```

---

### Task 6: Slice verification gate

**Files:** none — verification only; fix forward if anything fails.

- [ ] **Step 1: Full mobile test suite**

```bash
cd mobile && flutter test
```

Expected: all green (pre-existing skips/todos aside).

- [ ] **Step 2: Analyzer exactly as CI runs it**

```bash
cd mobile && dart analyze --fatal-infos lib test
```

Expected: "No issues found!". (Infos are fatal in CI; never run bare `dart analyze` — it pulls `packages/ui/showcase`.)

- [ ] **Step 3: Formatter**

```bash
cd mobile && dart format --set-exit-if-changed lib/presentation/widgets/people/people_sort_button.widget.dart lib/presentation/pages/drift_people_collection.page.dart lib/infrastructure/repositories/people.repository.dart lib/domain/services/people.service.dart lib/domain/models/person.model.dart lib/domain/models/setting.model.dart lib/domain/models/store.model.dart lib/providers/infrastructure/people.provider.dart lib/providers/photos_filter/people_picker.provider.dart lib/presentation/pages/drift_library.page.dart test/domain/models/people_sort_test.dart test/infrastructure/repositories/people_repository_test.dart test/providers/photos_filter/people_picker_provider_test.dart test/presentation/pages/photos_filter/person_picker_test.dart test/presentation/widgets/people/people_sort_button_test.dart test/presentation/pages/drift_people_collection_test.dart test/medium/repository_context.dart
```

Expected: exit 0 (no reformatting). If it reformats, re-run tests and amend the relevant commit.

- [ ] **Step 4: Commit any verification fixes**

Only if Steps 1–3 surfaced changes:

```bash
git add -A && git commit -m "fix(mobile): people sort verification fixes (#676)"
```
