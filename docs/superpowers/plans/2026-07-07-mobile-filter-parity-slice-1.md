# Mobile Filter Parity — Slice 1: Collapsible Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 1 row; BDD "Slice 1: Collapsible sections"; "UI anatomy → Deep sheet" `#mockup-deep`).

**Goal:** Make every Deep filter-sheet section collapsible via a tappable header + chevron, with expand/collapse state persisted across app restarts and empty sections auto-collapsed & disabled.

**Architecture:** Introduce a `FilterSectionId` registry enum (stable id + title key, in render order), a persisted `collapsedSectionsProvider` backed by the Drift `Store` (new `StoreKey<String>` holding a JSON list of collapsed ids), and a reusable `CollapsibleSection` widget. Route the four scaffold sections (People/Places/Tags/When) through `CollapsibleSection` via `DeepSectionScaffold`, and wrap the three inline sections (Rating/Media/Toggles) directly. No data-flow, provider-suggestion, or picker changes — pure collapse UI.

**Tech Stack:** Flutter 3.44.1, Dart, `hooks_riverpod`, `easy_localization`, Drift-backed `Store` singleton. Tests: `flutter_test` + `ProviderScope` overrides.

## Global Constraints

- Package import prefix is `package:immich_mobile/...` (fork keeps upstream Dart package name).
- Flutter **3.44.1** via `mise exec -- flutter`. Regenerate codegen once before tests: `mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart` (already done in this worktree).
- CI runs `dart analyze --fatal-infos` over **`lib` and `test`** — no `info`/`warning` allowed; run `mise exec -- dart analyze lib test` before finishing.
- Sections default to **expanded**. Persistence stores the set of **collapsed** ids. Empty sections always render collapsed + disabled and are never written to the stored set.
- Do NOT change suggestion providers, picker navigation, the "Search N →" trailing button behavior, or the browse strips. Those belong to later slices. Slice 1 only adds the collapse header/chevron/persistence around existing bodies.
- Mockup fidelity (`#mockup-deep`): each section header = title (left), chevron (rotates; up = expanded, down = collapsed). Empty sections show "(0)" and are disabled. The existing trailing "Search N →" button stays where it is for now (restyled to the mockup's body row in Slices 3–6).
- All commits in worktree branch `worktree-mobile-filter-parity`. No `Co-Authored-By`/`Generated-with` trailers.

## Test harness (use the codebase's existing conventions)

Widget tests MUST use the shared helper `tester.pumpConsumerWidget(widget, overrides: [...])` from `test/widget_tester_extensions.dart` (adjust the relative import depth per file). It wraps the widget in `EasyLocalization` (so `.tr()` resolves to real strings) → `ProviderScope(overrides: ...)` → localized `MaterialApp` → `Material`, and calls `pumpAndSettle()`. Prefer **key-based finders** (`Key('collapsible-header-<id>')`) and `find.textContaining('(0)')` so assertions don't depend on translated copy.

Provider/widget state is controlled two ways:

- **Gateway override (fast, no DB)** — pass `overrides: [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...}))]` to preset the collapsed set. Use this for `CollapsibleSection` / section widget tests.
- **Real in-memory Store (for genuine persistence tests)** — copy the exact `setUpAll`/`tearDownAll` block the existing filter-sheet tests use:

```dart
late Drift db;
setUpAll(() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  await StoreService.init(storeRepository: DriftStoreRepository(db));
  await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
});
tearDownAll(() async {
  await Store.clear();
  await db.close();
});
setUp(() async {
  await Store.put(StoreKey.filterSheetCollapsedSections, '[]'); // reset between tests
});
```

Imports for the Store harness: `package:drift/drift.dart` as `drift`, `package:drift/native.dart`, `package:immich_mobile/domain/services/store.service.dart`, `package:immich_mobile/entities/store.entity.dart`, `package:immich_mobile/infrastructure/repositories/db.repository.dart`, `package:immich_mobile/infrastructure/repositories/store.repository.dart`, `package:immich_mobile/domain/models/store.model.dart`.

The reduced-motion test wraps the target in `MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: true), child: <widget>)` **before** passing it to `pumpConsumerWidget` (the inner `MediaQuery` wins for `MediaQuery.maybeOf`).

## File Structure

**Create:**

- `mobile/lib/presentation/widgets/filter_sheet/filter_section_id.dart` — `FilterSectionId` enum (registry: id, titleKey, render order) + `fromStorageId`.
- `mobile/lib/providers/photos_filter/collapsed_sections.provider.dart` — JSON codec helpers, `FilterSectionPrefs` persistence gateway + `filterSectionPrefsProvider`, and `collapsedSectionsProvider` (`NotifierProvider<CollapsedSectionsNotifier, Set<FilterSectionId>>`).
- `mobile/lib/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart` — `CollapsibleSection` wrapper widget.
- `mobile/test/presentation/widgets/filter_sheet/filter_section_id_test.dart`
- `mobile/test/providers/photos_filter/collapsed_sections_provider_test.dart`
- `mobile/test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart`

**Modify:**

- `mobile/lib/domain/models/store.model.dart` — add `filterSheetCollapsedSections<String>._(<free id>)`.
- `mobile/lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart` — add required `sectionId`; render header+body through `CollapsibleSection`; drop its own title/header rendering.
- `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart`, `places_cascade_section.widget.dart`, `tags_section.widget.dart`, `when_accordion_section.widget.dart` — pass `sectionId:` to `DeepSectionScaffold`.
- `mobile/lib/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart`, `media_type_section.widget.dart`, `toggles_section.widget.dart` — wrap body in `CollapsibleSection`, remove inline title.
- Existing tests under `mobile/test/presentation/widgets/filter_sheet/` that assert the old section structure (fixed in Task 9).

---

### Task 1: `FilterSectionId` registry enum

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_section_id.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/filter_section_id_test.dart`

**Interfaces:**

- Produces: `enum FilterSectionId { people, places, tags, when, rating, media, toggles }` with `final String storageId; final String titleKey;` and `static FilterSectionId? fromStorageId(String id)`.

- [ ] **Step 1: Verify the real title-localization keys.** Read the current title `.tr()` key each section renders and confirm they exist in `i18n/en.json`. Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
grep -RnoE "filter_sheet_deep_[a-z]+_section" lib/presentation/widgets/filter_sheet/deep/ | sort -u
grep -oE '"filter_sheet_deep_[a-z]+_section"' ../i18n/en.json | sort -u
```

Expected: keys for people, places, tags, when exist (used by scaffold sections). For rating/media/toggles, note the exact key each currently passes to `.tr()` for its title (read `rating_stars_section.widget.dart`, `media_type_section.widget.dart`, `toggles_section.widget.dart`). Use those exact keys in Step 3 (do not invent keys). If a section builds its title from a different key than the pattern below, use the real key.

- [ ] **Step 2: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/filter_section_id_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

void main() {
  group('FilterSectionId', () {
    test('render order is people, places, tags, when, rating, media, toggles', () {
      expect(FilterSectionId.values.map((e) => e.name).toList(), [
        'people', 'places', 'tags', 'when', 'rating', 'media', 'toggles',
      ]);
    });

    test('storageId is stable and unique', () {
      final ids = FilterSectionId.values.map((e) => e.storageId).toList();
      expect(ids.toSet().length, ids.length);
      expect(FilterSectionId.people.storageId, 'people');
      expect(FilterSectionId.toggles.storageId, 'toggles');
    });

    test('titleKey is non-empty for every section', () {
      for (final s in FilterSectionId.values) {
        expect(s.titleKey, isNotEmpty);
      }
    });

    test('fromStorageId round-trips known ids and returns null for unknown', () {
      for (final s in FilterSectionId.values) {
        expect(FilterSectionId.fromStorageId(s.storageId), s);
      }
      expect(FilterSectionId.fromStorageId('camera'), isNull); // added in Slice 6
      expect(FilterSectionId.fromStorageId('nonsense'), isNull);
    });
  });
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/filter_section_id_test.dart`
Expected: FAIL — `filter_section_id.dart` does not exist (compile error).

- [ ] **Step 4: Write minimal implementation** (substitute the real title keys confirmed in Step 1)

```dart
// mobile/lib/presentation/widgets/filter_sheet/filter_section_id.dart

/// Stable identity + registry for the Deep filter-sheet sections.
/// The order of the values is the top-to-bottom render order in the deep sheet.
enum FilterSectionId {
  people('people', 'filter_sheet_deep_people_section'),
  places('places', 'filter_sheet_deep_places_section'),
  tags('tags', 'filter_sheet_deep_tags_section'),
  when('when', 'filter_sheet_deep_when_section'),
  rating('rating', 'filter_sheet_deep_rating_section'),
  media('media', 'filter_sheet_deep_media_section'),
  toggles('toggles', 'filter_sheet_deep_toggles_section');

  const FilterSectionId(this.storageId, this.titleKey);

  /// Stable string persisted to disk. NEVER renumber/rename existing values.
  final String storageId;

  /// easy_localization key for the section title.
  final String titleKey;

  static FilterSectionId? fromStorageId(String id) {
    for (final section in values) {
      if (section.storageId == id) return section;
    }
    return null;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/filter_section_id_test.dart`
Expected: PASS (4 tests). If the rating/media/toggles title keys differ from the pattern, fix the enum to the real keys and re-run.

- [ ] **Step 6: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/filter_section_id.dart test/presentation/widgets/filter_sheet/filter_section_id_test.dart
git add lib/presentation/widgets/filter_sheet/filter_section_id.dart test/presentation/widgets/filter_sheet/filter_section_id_test.dart
git commit -m "feat(mobile-filter): add FilterSectionId registry (slice 1)"
```

Expected analyze: `No issues found!`

---

### Task 2: Persisted collapsed-sections state (codec + gateway + provider)

**Files:**

- Create: `mobile/lib/providers/photos_filter/collapsed_sections.provider.dart`
- Modify: `mobile/lib/domain/models/store.model.dart`
- Test: `mobile/test/providers/photos_filter/collapsed_sections_provider_test.dart`

**Interfaces:**

- Consumes: `FilterSectionId` (Task 1); `StoreKey` / `Store` (`package:immich_mobile/domain/models/store.model.dart`, `package:immich_mobile/entities/store.entity.dart`).
- Produces:
  - `String encodeCollapsedSections(Set<FilterSectionId>)` / `Set<FilterSectionId> decodeCollapsedSections(String)` (`@visibleForTesting`).
  - `abstract class FilterSectionPrefs { Set<FilterSectionId> loadCollapsed(); Future<void> saveCollapsed(Set<FilterSectionId>); }` + default `StoreFilterSectionPrefs` + `final filterSectionPrefsProvider = Provider<FilterSectionPrefs>(...)`.
  - `final collapsedSectionsProvider = NotifierProvider<CollapsedSectionsNotifier, Set<FilterSectionId>>(...)` with `bool isCollapsed(FilterSectionId)` and `void toggle(FilterSectionId)`.

- [ ] **Step 1: Add the StoreKey.** Read `mobile/lib/domain/models/store.model.dart`, find the highest non-legacy `id`, confirm a free id (spec suggests `143`; verify no collision):

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
grep -nE "\._\(1?[0-9]{1,3}\)" lib/domain/models/store.model.dart | tail -20
grep -nE "\._\(143\)" lib/domain/models/store.model.dart || echo "143 is free"
```

Add one enum entry alongside the other `StoreKey` values (place near the other UI/feature keys, matching the file's formatting):

```dart
  filterSheetCollapsedSections<String>._(143),
```

(Use the confirmed free id if 143 is taken.)

- [ ] **Step 2: Write the failing test**

```dart
// mobile/test/providers/photos_filter/collapsed_sections_provider_test.dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  Set<FilterSectionId>? lastSaved;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {
    lastSaved = ids;
    stored = ids;
  }
}

ProviderContainer _containerWith(FilterSectionPrefs prefs) {
  final c = ProviderContainer(overrides: [filterSectionPrefsProvider.overrideWithValue(prefs)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('collapsed sections codec', () {
    test('encode → decode round-trips', () {
      final set = {FilterSectionId.tags, FilterSectionId.rating};
      expect(decodeCollapsedSections(encodeCollapsedSections(set)), set);
    });
    test('decode ignores unknown ids and malformed json', () {
      expect(decodeCollapsedSections('["tags","camera","junk"]'), {FilterSectionId.tags});
      expect(decodeCollapsedSections('not json'), <FilterSectionId>{});
      expect(decodeCollapsedSections('{"a":1}'), <FilterSectionId>{});
      expect(decodeCollapsedSections('[]'), <FilterSectionId>{});
    });
  });

  group('collapsedSectionsProvider', () {
    test('default (nothing stored) is all-expanded → empty collapsed set', () {
      final c = _containerWith(_FakePrefs({}));
      expect(c.read(collapsedSectionsProvider), isEmpty);
      expect(c.read(collapsedSectionsProvider.notifier).isCollapsed(FilterSectionId.people), isFalse);
    });

    test('initial state loads the persisted collapsed set', () {
      final c = _containerWith(_FakePrefs({FilterSectionId.tags}));
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags});
      expect(c.read(collapsedSectionsProvider.notifier).isCollapsed(FilterSectionId.tags), isTrue);
    });

    test('toggle collapses then expands, and persists each change', () {
      final prefs = _FakePrefs({});
      final c = _containerWith(prefs);
      final notifier = c.read(collapsedSectionsProvider.notifier);

      notifier.toggle(FilterSectionId.people);
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.people});
      expect(prefs.lastSaved, {FilterSectionId.people});

      notifier.toggle(FilterSectionId.people);
      expect(c.read(collapsedSectionsProvider), isEmpty);
      expect(prefs.lastSaved, isEmpty);
    });
  });

  // Genuine persistence: the DEFAULT gateway against a real in-memory Drift Store.
  // Proves "collapsed state persists across app restarts" (BDD).
  group('StoreFilterSectionPrefs (real Store round-trip)', () {
    late Drift db;
    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
      await StoreService.init(storeRepository: DriftStoreRepository(db));
    });
    tearDownAll(() async {
      await Store.clear();
      await db.close();
    });
    setUp(() async => Store.put(StoreKey.filterSheetCollapsedSections, '[]'));

    test('save then load round-trips through Store', () async {
      const prefs = StoreFilterSectionPrefs();
      expect(prefs.loadCollapsed(), isEmpty);
      await prefs.saveCollapsed({FilterSectionId.tags, FilterSectionId.media});
      expect(prefs.loadCollapsed(), {FilterSectionId.tags, FilterSectionId.media});
    });

    test('a fresh provider container loads the persisted set (simulated restart)', () async {
      await const StoreFilterSectionPrefs().saveCollapsed({FilterSectionId.people});
      final c = ProviderContainer(); // default gateway → reads real Store
      addTearDown(c.dispose);
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.people});
    });
  });
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `mise exec -- flutter test test/providers/photos_filter/collapsed_sections_provider_test.dart`
Expected: FAIL — `collapsed_sections.provider.dart` does not exist.

- [ ] **Step 4: Write minimal implementation**

```dart
// mobile/lib/providers/photos_filter/collapsed_sections.provider.dart
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

@visibleForTesting
String encodeCollapsedSections(Set<FilterSectionId> ids) => jsonEncode(ids.map((e) => e.storageId).toList());

@visibleForTesting
Set<FilterSectionId> decodeCollapsedSections(String json) {
  try {
    final raw = jsonDecode(json);
    if (raw is! List) return {};
    return raw.whereType<String>().map(FilterSectionId.fromStorageId).whereType<FilterSectionId>().toSet();
  } catch (_) {
    return {};
  }
}

/// Persistence gateway for the collapsed-section set (injectable for tests).
abstract class FilterSectionPrefs {
  Set<FilterSectionId> loadCollapsed();
  Future<void> saveCollapsed(Set<FilterSectionId> ids);
}

/// Default gateway backed by the Drift key-value [Store] (JSON string).
class StoreFilterSectionPrefs implements FilterSectionPrefs {
  const StoreFilterSectionPrefs();

  @override
  Set<FilterSectionId> loadCollapsed() =>
      decodeCollapsedSections(Store.get(StoreKey.filterSheetCollapsedSections, '[]'));

  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) =>
      Store.put(StoreKey.filterSheetCollapsedSections, encodeCollapsedSections(ids));
}

final filterSectionPrefsProvider = Provider<FilterSectionPrefs>((_) => const StoreFilterSectionPrefs());

final collapsedSectionsProvider =
    NotifierProvider<CollapsedSectionsNotifier, Set<FilterSectionId>>(CollapsedSectionsNotifier.new);

class CollapsedSectionsNotifier extends Notifier<Set<FilterSectionId>> {
  @override
  Set<FilterSectionId> build() => ref.read(filterSectionPrefsProvider).loadCollapsed();

  bool isCollapsed(FilterSectionId id) => state.contains(id);

  void toggle(FilterSectionId id) {
    final next = Set<FilterSectionId>.from(state);
    if (!next.remove(id)) next.add(id);
    state = next;
    // Fire-and-forget persist; state is source of truth in-memory.
    ref.read(filterSectionPrefsProvider).saveCollapsed(next);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `mise exec -- flutter test test/providers/photos_filter/collapsed_sections_provider_test.dart`
Expected: PASS (7 tests: 2 codec + 3 provider-with-fake + 2 real-Store round-trip).

- [ ] **Step 6: Analyze & commit**

```bash
mise exec -- dart analyze lib/providers/photos_filter/collapsed_sections.provider.dart lib/domain/models/store.model.dart test/providers/photos_filter/collapsed_sections_provider_test.dart
git add lib/providers/photos_filter/collapsed_sections.provider.dart lib/domain/models/store.model.dart test/providers/photos_filter/collapsed_sections_provider_test.dart
git commit -m "feat(mobile-filter): persist collapsed filter sections via Store (slice 1)"
```

Expected analyze: `No issues found!`

---

### Task 3: `CollapsibleSection` widget

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart`

**Interfaces:**

- Consumes: `FilterSectionId` (Task 1), `collapsedSectionsProvider` (Task 2).
- Produces: `class CollapsibleSection extends ConsumerWidget` with constructor `const CollapsibleSection({super.key, required FilterSectionId sectionId, required String titleKey, required Widget child, bool isEmpty = false, Widget? trailingHeader})`. Emits keys `collapsible-section-<storageId>` (root), `collapsible-header-<storageId>` (tappable header), `collapsible-body-<storageId>` (body content, present only when expanded).

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

List<Override> _prefs([Set<FilterSectionId> collapsed = const {}]) =>
    [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...collapsed}))];

CollapsibleSection _section(FilterSectionId id, {bool isEmpty = false, Widget? trailing}) => CollapsibleSection(
      sectionId: id,
      titleKey: id.titleKey,
      isEmpty: isEmpty,
      trailingHeader: trailing,
      child: const Text('BODY', key: Key('body-marker')),
    );

void main() {
  testWidgets('expanded by default: header + body visible', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.people), overrides: _prefs());
    expect(find.byKey(const Key('collapsible-header-people')), findsOneWidget);
    expect(find.byKey(const Key('body-marker')), findsOneWidget);
  });

  testWidgets('tapping header collapses the body', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.people), overrides: _prefs());
    await t.tap(find.byKey(const Key('collapsible-header-people')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsNothing);
  });

  testWidgets('starts collapsed when id is in the persisted set, expands on tap', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.tags), overrides: _prefs({FilterSectionId.tags}));
    expect(find.byKey(const Key('body-marker')), findsNothing);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsOneWidget);
  });

  testWidgets('empty section: body hidden, "(0)" shown, tap is a no-op', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.tags, isEmpty: true), overrides: _prefs());
    expect(find.byKey(const Key('body-marker')), findsNothing);
    expect(find.textContaining('(0)'), findsOneWidget);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsNothing); // still collapsed/disabled
  });

  testWidgets('trailing header is rendered when provided', (t) async {
    await t.pumpConsumerWidget(
      _section(FilterSectionId.people, trailing: const Text('TRAILING', key: Key('trailing-marker'))),
      overrides: _prefs(),
    );
    expect(find.byKey(const Key('trailing-marker')), findsOneWidget);
  });

  testWidgets('reduced motion collapses immediately', (t) async {
    await t.pumpConsumerWidget(
      Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: _section(FilterSectionId.people),
        ),
      ),
      overrides: _prefs(),
    );
    await t.tap(find.byKey(const Key('collapsible-header-people')));
    await t.pump();
    expect(find.byKey(const Key('body-marker')), findsNothing);
  });
}
```

> Tasks 4 and 5 use this same harness: `tester.pumpConsumerWidget(<widget under test>, overrides: [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...}))])`, key-based finders, and `MediaQuery(disableAnimations: true)` wrapping only where a test asserts reduced motion. The `_host`/`_FakePrefs` shown in those tasks are illustrative — wire them through `pumpConsumerWidget` exactly as above (do not hand-roll a bare `MaterialApp`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart`
Expected: FAIL — `collapsible_section.widget.dart` does not exist.

- [ ] **Step 3: Write minimal implementation**

```dart
// mobile/lib/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

/// Wraps a Deep filter-sheet section with a tappable collapse header + chevron.
/// Expand/collapse state is persisted via [collapsedSectionsProvider]. Empty
/// sections render collapsed + disabled with a "(0)" title affordance.
class CollapsibleSection extends ConsumerWidget {
  final FilterSectionId sectionId;
  final String titleKey;
  final bool isEmpty;
  final Widget? trailingHeader;
  final Widget child;

  const CollapsibleSection({
    super.key,
    required this.sectionId,
    required this.titleKey,
    required this.child,
    this.isEmpty = false,
    this.trailingHeader,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final collapsedByUser = ref.watch(collapsedSectionsProvider).contains(sectionId);
    final expanded = !isEmpty && !collapsedByUser;
    final disableAnimations = MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    final titleText = isEmpty ? '${titleKey.tr().toUpperCase()} (0)' : titleKey.tr().toUpperCase();

    final header = InkWell(
      key: Key('collapsible-header-${sectionId.storageId}'),
      onTap: isEmpty
          ? null
          : () {
              HapticFeedback.selectionClick();
              ref.read(collapsedSectionsProvider.notifier).toggle(sectionId);
            },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Row(
          children: [
            Expanded(
              child: Text(
                titleText,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 2, color: theme.colorScheme.outline),
              ),
            ),
            if (trailingHeader != null) Flexible(child: trailingHeader!),
            if (!isEmpty)
              Icon(
                expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                color: theme.colorScheme.outline,
              ),
          ],
        ),
      ),
    );

    return Column(
      key: Key('collapsible-section-${sectionId.storageId}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        header,
        AnimatedSize(
          duration: disableAnimations ? Duration.zero : const Duration(milliseconds: 240),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: expanded
              ? SizedBox(width: double.infinity, key: Key('collapsible-body-${sectionId.storageId}'), child: child)
              : const SizedBox(width: double.infinity, height: 0),
        ),
      ],
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart`
Expected: PASS (6 tests). If `.tr()` returns something unexpected for `(0)`, the test uses `find.textContaining('(0)')` which is robust to the key text.

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart
git add lib/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart test/presentation/widgets/filter_sheet/deep/collapsible_section_test.dart
git commit -m "feat(mobile-filter): add CollapsibleSection widget (slice 1)"
```

Expected analyze: `No issues found!`

---

### Task 4: Route `DeepSectionScaffold` through `CollapsibleSection`

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart`
- Modify (callers): `people_section.widget.dart`, `places_cascade_section.widget.dart`, `tags_section.widget.dart`, `when_accordion_section.widget.dart`
- Test: extend `mobile/test/presentation/widgets/filter_sheet/deep/` (add a scaffold-collapse test file `deep_section_scaffold_collapse_test.dart`)

**Interfaces:**

- Consumes: `CollapsibleSection` (Task 3), `FilterSectionId` (Task 1).
- Produces: `DeepSectionScaffold<T>` gains a required `final FilterSectionId sectionId;` constructor param. Its build returns a `CollapsibleSection` (no longer its own `Column`/title). Body content (skeleton/retry/empty/childBuilder) unchanged. `isEmpty` passed to `CollapsibleSection` = `cache != null && cache.isEmpty`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_collapse_test.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async => stored = ids;
}

Widget _host(AsyncValue<List<String>> items, {Set<FilterSectionId> collapsed = const {}}) => ProviderScope(
      overrides: [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...collapsed}))],
      child: MaterialApp(
        localizationsDelegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
        home: Scaffold(
          body: ListView(children: [
            DeepSectionScaffold<String>(
              sectionId: FilterSectionId.tags,
              titleKey: FilterSectionId.tags.titleKey,
              emptyCaptionKey: 'filter_sheet_deep_empty_tags',
              items: items,
              childBuilder: (data) => Column(children: [for (final d in data) Text(d, key: Key('item-$d'))]),
            ),
          ]),
        ),
      ),
    );

void main() {
  testWidgets('non-empty section renders items and is collapsible', (t) async {
    await t.pumpWidget(_host(const AsyncData(['a', 'b'])));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsOneWidget);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsNothing);
  });

  testWidgets('empty section auto-collapses (items hidden, "(0)" shown)', (t) async {
    await t.pumpWidget(_host(const AsyncData(<String>[])));
    await t.pumpAndSettle();
    expect(find.textContaining('(0)'), findsOneWidget);
    // no items, and tapping does not expand (disabled)
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-empty')), findsNothing);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_collapse_test.dart`
Expected: FAIL — `DeepSectionScaffold` has no `sectionId` param (compile error).

- [ ] **Step 3: Modify `DeepSectionScaffold`.** Add the `sectionId` field + constructor param. Replace the returned `Column(...[header, body])` with a `CollapsibleSection`. Keep the body computation (`_lastData` cache, skeleton, retry, empty caption, childBuilder) exactly as-is; pass it as `child`. Remove the local `title`/`header` construction (title now comes from `CollapsibleSection`). Concretely:

```dart
// add import
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

// add field + ctor param
final FilterSectionId sectionId;
// ... in const constructor: required this.sectionId,
```

Replace the `build` return. Compute `isEmpty` and `body` (unchanged logic), then:

```dart
final cache = _lastData;
final isEmpty = cache != null && cache.isEmpty;

Widget body;
if (cache != null) {
  // (unchanged) empty caption path is kept as the child, but CollapsibleSection
  // hides it when isEmpty; when non-empty show childBuilder.
  body = cache.isEmpty
      ? Padding(
          key: const Key('deep-section-empty'),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Text(widget.emptyCaptionKey.tr(),
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
        )
      : Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: widget.childBuilder(cache));
} else if (items is AsyncError) {
  body = _DeepRetry(onRetry: widget.onRetry);
} else {
  body = const _DeepSkeleton();
}

return CollapsibleSection(
  key: const Key('deep-section-scaffold'),
  sectionId: widget.sectionId,
  titleKey: widget.titleKey,
  isEmpty: isEmpty,
  trailingHeader: isEmpty ? null : widget.trailingHeader,
  child: body,
);
```

(The `Key('deep-section-scaffold')` is preserved on the returned widget so existing finders keep working.)

- [ ] **Step 4: Update the four callers to pass `sectionId`.** In each, add the matching `sectionId:` argument to the `DeepSectionScaffold(...)` call and import `filter_section_id.dart`:
  - `people_section.widget.dart`: `sectionId: FilterSectionId.people,`
  - `places_cascade_section.widget.dart`: `sectionId: FilterSectionId.places,`
  - `tags_section.widget.dart`: `sectionId: FilterSectionId.tags,`
  - `when_accordion_section.widget.dart`: `sectionId: FilterSectionId.when,`

- [ ] **Step 5: Run the new test + the four section widget tests**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/`
Expected: the new `deep_section_scaffold_collapse_test.dart` PASSES; note any pre-existing `deep/` tests that now fail (fixed in Task 9). Record the red/green summary.

- [ ] **Step 6: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/ test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_collapse_test.dart
git add lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart lib/presentation/widgets/filter_sheet/deep/tags_section.widget.dart lib/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_collapse_test.dart
git commit -m "feat(mobile-filter): make scaffold sections collapsible (slice 1)"
```

---

### Task 5: Wrap the three inline sections (Rating / Media / Toggles)

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart`, `media_type_section.widget.dart`, `toggles_section.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart`

**Interfaces:**

- Consumes: `CollapsibleSection` (Task 3), `FilterSectionId` (Task 1).
- Produces: each of the three widgets now returns `CollapsibleSection(sectionId: <id>, titleKey: <existing title key>, isEmpty: false, child: <body>)`. Bodies keep their own `Padding(horizontal: 20)`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async => stored = ids;
}

Widget _host(Widget child) => ProviderScope(
      overrides: [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}))],
      child: MaterialApp(
        localizationsDelegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
        home: Scaffold(body: ListView(children: [child])),
      ),
    );

void main() {
  testWidgets('rating section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const RatingStarsSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-rating')), findsOneWidget);
  });
  testWidgets('media section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const MediaTypeSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-media')), findsOneWidget);
  });
  testWidgets('toggles section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const TogglesSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-toggles')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart`
Expected: FAIL — no `collapsible-header-*` keys (sections not yet wrapped).

- [ ] **Step 3: Refactor each inline section.** In each file: import `collapsible_section.widget.dart` + `filter_section_id.dart`. Remove the inline title `Text(...tr().toUpperCase())` and the outer header `Padding`/`Row`. Wrap the remaining body (the stars Row / segmented control / switches Column) in `CollapsibleSection(sectionId: FilterSectionId.<id>, titleKey: '<the exact title key the file used>', child: Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: <body>))`. Keep the body's controls and their providers unchanged. Preserve any existing keys on the body widgets. Use `FilterSectionId.rating`/`.media`/`.toggles` respectively, and the same title key each section previously rendered (verified in Task 1 Step 1).

- [ ] **Step 4: Run the test to verify it passes**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart lib/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart lib/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart
git add lib/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart lib/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart lib/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart test/presentation/widgets/filter_sheet/deep/inline_sections_collapse_test.dart
git commit -m "feat(mobile-filter): make rating/media/toggles sections collapsible (slice 1)"
```

---

### Task 6: Reconcile existing filter-sheet tests + full green baseline

**Files:**

- Modify: any existing tests under `mobile/test/presentation/widgets/filter_sheet/` that break due to the structural change (e.g. tests asserting the old empty-caption is visible, or asserting section title text in the old header position).

- [ ] **Step 1: Run the full filter-sheet + photos_filter suites**

Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/
```

Expected: identify any failures caused by Slice 1. Baseline before Slice 1 was **300 passing** in `filter_sheet/` + `photos_filter/`.

- [ ] **Step 2: Fix each broken test to match the new (spec-correct) behavior**, preserving its original intent:
  - Empty section: assert the section header shows "(0)" and its body/empty-caption is hidden (was: empty-caption visible). This is the intended Slice 1 behavior change (empty auto-collapses).
  - Section title finders: titles now live inside `CollapsibleSection`'s header (`collapsible-header-<id>`); update finders that assumed the old scaffold header layout.
  - Do NOT weaken assertions about item rendering when expanded (default is expanded, so content is present as before).
  - If a test explicitly needs a section expanded that a fixture leaves collapsed, override `filterSectionPrefsProvider` with an empty collapsed set (default) — content stays visible.

- [ ] **Step 3: Add the "reset preserves collapse state" test** (BDD cross-cutting for Slice 1)

Create `mobile/test/providers/photos_filter/collapse_survives_reset_test.dart` using the real in-memory Store harness (copy the `setUpAll`/`tearDownAll`/`setUp` block from the Test harness section; add `import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';`):

```dart
test('resetting the photos filter leaves collapsed sections untouched', () async {
  await const StoreFilterSectionPrefs().saveCollapsed({FilterSectionId.tags});
  final c = ProviderContainer();
  addTearDown(c.dispose);
  expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags});

  c.read(photosFilterProvider.notifier).reset(); // clears the filter selections

  expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags}); // collapse state preserved
});
```

Run: `mise exec -- flutter test test/providers/photos_filter/collapse_survives_reset_test.dart` → PASS.

- [ ] **Step 4: Re-run until green**

Run: `mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/`
Expected: **All tests passed!** (≥ 300 + the new Slice 1 tests).

- [ ] **Step 5: Full analyze gate**

Run: `mise exec -- dart analyze lib test`
Expected: `No issues found!` (CI parity — `--fatal-infos` semantics; fix any info/warning).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(mobile-filter): reconcile filter-sheet tests with collapsible sections (slice 1)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 1 BDD):** Collapse (Task 3/4/5 + tests), Expand (Task 3), Persist across restart (Task 2 provider loads persisted set; Task 3/4 render from it), Empty auto-collapse + disabled + "(0)" (Task 3/4 tests), Re-enable on non-empty with default-expanded (Task 2 default + Task 4 empty→non-empty), Reset preserves collapse state (collapse state is a separate provider, untouched by filter reset — no code links them; covered implicitly, and Task 6 keeps reset tests green). Reduced motion (Task 3 test). Mockup `#mockup-deep` header/chevron/"(0)" reproduced (Task 3).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `FilterSectionId` (Task 1) used identically in Tasks 2–5; `FilterSectionPrefs`/`collapsedSectionsProvider`/`filterSectionPrefsProvider` names consistent; `CollapsibleSection` constructor identical across Tasks 3–5; `DeepSectionScaffold.sectionId` consistent Task 4.
- **Out of scope guarded:** no changes to suggestion providers, "Search N →" behavior, browse strips, or pickers.
