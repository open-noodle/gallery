# Mobile Filter Parity — Slice 2: Manage Sections (hide/show) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 2 row; BDD "Slice 2: Manage Sections (hide/show)"; mockup `#mockup-manage-sections` + the ⚙ entry in `#mockup-deep`).

**Goal:** Let users hide/show whole filter sections from a "Manage sections" sheet reached from a ⚙ icon in the deep-sheet header, with the visible/hidden set persisted across app restarts; hidden sections are not built, but their active filters keep applying (and stay removable via the existing timeline chips).

**Architecture:** Mirror Slice 1's persistence exactly, but store the **hidden** set as exceptions (empty = all visible), via a NEW `filterSheetHiddenSections` `StoreKey<String>` and a NEW, SEPARATE `FilterSectionVisibilityPrefs` gateway + `hiddenSectionsProvider` (do NOT extend Slice 1's `FilterSectionPrefs` interface — 13 test files implement it as `_FakePrefs`, and adding methods would break them all). Restructure `deep_content` to render sections from a `FilterSectionId`→widget map, skipping hidden ones. Add a ⚙ entry in `DeepHeader` opening a `ManageSectionsSheet` modal with one `SwitchListTile.adaptive` per section.

**Tech Stack:** Flutter 3.44.1, `hooks_riverpod`, `easy_localization`, Drift `Store`. Tests via `tester.pumpConsumerWidget(..., overrides: [...])` + in-memory Store harness.

## Global Constraints

- Package prefix `package:immich_mobile/...`. Flutter **3.44.1** via `mise exec -- flutter`; Dart via `mise exec -- dart`.
- CI = `dart analyze --fatal-infos` over **lib AND test** — zero info/warning.
- **Do NOT extend the Slice 1 `FilterSectionPrefs` interface.** Create a new `FilterSectionVisibilityPrefs`.
- Persist the **hidden** set (exceptions). Empty stored set = all sections visible (default). Never persist "all visible" as an explicit full list.
- Slice 2 is hide/show ONLY. Do NOT change suggestion providers, pickers, the "Search N →" behavior, browse strips, or Slice 1's collapse behavior. Collapse (Slice 1) and visibility (Slice 2) are independent axes.
- Hiding a section is pure UI: it must NOT clear or mutate `photosFilterProvider` state. A hidden section's selection keeps filtering and stays removable via the timeline subheader (`PhotosFilterSubheader`, unchanged).
- Mockup fidelity: ⚙ "manage" icon in the deep-sheet header (deep snap only), opening a sheet listing every section with a show/hide toggle (`#mockup-manage-sections`). Default: all visible.
- Test harness: reuse `test/widget_tester_extensions.dart` `pumpConsumerWidget(widget, overrides: [...])`; key-based finders. Provider tests may use the in-memory Drift Store `setUpAll`/`tearDownAll`/`setUp('[]')` block (see Slice 1 plan's "Test harness" section for the exact block and imports).
- Worktree branch `worktree-mobile-filter-parity`. No `Co-Authored-By`/`Generated-with` trailers.

## Baseline

Slice 1 is complete: `FilterSectionId` enum, `collapsedSectionsProvider`, `CollapsibleSection`, all 7 sections collapsible; `StoreKey.filterSheetCollapsedSections` = id 143. Current suite: **388 passing** in `filter_sheet/` + `photos_filter/`, `dart analyze lib test` clean. Do not regress this.

## File Structure

**Create:**

- `mobile/lib/providers/photos_filter/hidden_sections.provider.dart` — codec + `FilterSectionVisibilityPrefs` + `StoreFilterSectionVisibilityPrefs` + `filterSectionVisibilityPrefsProvider` + `hiddenSectionsProvider` (`HiddenSectionsNotifier`).
- `mobile/lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart` — `ManageSectionsSheet` widget + `showManageSectionsSheet(BuildContext)` helper.
- `mobile/test/providers/photos_filter/hidden_sections_provider_test.dart`
- `mobile/test/presentation/widgets/filter_sheet/deep/manage_sections_sheet_test.dart`

**Modify:**

- `mobile/lib/domain/models/store.model.dart` — add `filterSheetHiddenSections<String>._(144)` (confirm 144 free).
- `i18n/en.json` — add `"filter_sheet_deep_manage_sections": "Manage sections"` (alphabetical position within the `filter_sheet_deep_*` block).
- `mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart` — add the ⚙ manage IconButton.
- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` — render only visible sections (map + filter).
- Existing tests under `mobile/test/presentation/widgets/filter_sheet/` asserting the deep header / deep_content structure (Task 6).

---

### Task 1: i18n key + StoreKey

**Files:** Modify `i18n/en.json`, `mobile/lib/domain/models/store.model.dart`.

- [ ] **Step 1: Add the i18n key.** In `i18n/en.json`, insert within the `filter_sheet_deep_*` alphabetical block (before `filter_sheet_deep_media_*`):

```json
"filter_sheet_deep_manage_sections": "Manage sections",
```

- [ ] **Step 2: Confirm StoreKey 144 is free, then add it.**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
grep -nE "\._\(144\)" lib/domain/models/store.model.dart || echo "144 free"
```

Add next to `filterSheetCollapsedSections` (id 143):

```dart
  filterSheetHiddenSections<String>._(144),
```

- [ ] **Step 3: Regenerate localization keys** (the `.g.dart` is gitignored; the new key must resolve):

```bash
mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart
```

- [ ] **Step 4: Analyze & commit**

```bash
mise exec -- dart analyze lib/domain/models/store.model.dart
git add lib/domain/models/store.model.dart ../i18n/en.json
git commit -m "feat(mobile-filter): add hidden-sections StoreKey + manage-sections i18n (slice 2)"
```

Expected: `No issues found!`

---

### Task 2: `hiddenSectionsProvider` (persistence, mirrors Slice 1)

**Files:** Create `mobile/lib/providers/photos_filter/hidden_sections.provider.dart`; Test `mobile/test/providers/photos_filter/hidden_sections_provider_test.dart`.

**Interfaces:**

- Consumes: `FilterSectionId`, `StoreKey.filterSheetHiddenSections`.
- Produces: `encodeHiddenSections`/`decodeHiddenSections` (`@visibleForTesting`); `abstract class FilterSectionVisibilityPrefs { Set<FilterSectionId> loadHidden(); Future<void> saveHidden(Set<FilterSectionId>); }`; `StoreFilterSectionVisibilityPrefs`; `filterSectionVisibilityPrefsProvider`; `hiddenSectionsProvider = NotifierProvider<HiddenSectionsNotifier, Set<FilterSectionId>>` with `bool isVisible(FilterSectionId)` and `void setVisible(FilterSectionId, bool)`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/providers/photos_filter/hidden_sections_provider_test.dart
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
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  Set<FilterSectionId>? lastSaved;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async {
    lastSaved = ids;
    stored = ids;
  }
}

ProviderContainer _c(FilterSectionVisibilityPrefs prefs) {
  final c = ProviderContainer(overrides: [filterSectionVisibilityPrefsProvider.overrideWithValue(prefs)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('codec', () {
    test('round-trips', () {
      final s = {FilterSectionId.camera, FilterSectionId.rating};
      expect(decodeHiddenSections(encodeHiddenSections(s)), s);
    });
    test('ignores unknown/malformed', () {
      expect(decodeHiddenSections('["tags","junk"]'), {FilterSectionId.tags});
      expect(decodeHiddenSections('nope'), <FilterSectionId>{});
      expect(decodeHiddenSections('[]'), <FilterSectionId>{});
    });
  });

  group('hiddenSectionsProvider (fake gateway)', () {
    test('default: nothing hidden → all visible', () {
      final c = _c(_FakeVis({}));
      expect(c.read(hiddenSectionsProvider), isEmpty);
      expect(c.read(hiddenSectionsProvider.notifier).isVisible(FilterSectionId.tags), isTrue);
    });
    test('loads persisted hidden set', () {
      final c = _c(_FakeVis({FilterSectionId.tags}));
      expect(c.read(hiddenSectionsProvider.notifier).isVisible(FilterSectionId.tags), isFalse);
    });
    test('setVisible(false) hides, setVisible(true) shows, and persists', () {
      final prefs = _FakeVis({});
      final c = _c(prefs);
      final n = c.read(hiddenSectionsProvider.notifier);
      n.setVisible(FilterSectionId.tags, false);
      expect(c.read(hiddenSectionsProvider), {FilterSectionId.tags});
      expect(prefs.lastSaved, {FilterSectionId.tags});
      n.setVisible(FilterSectionId.tags, true);
      expect(c.read(hiddenSectionsProvider), isEmpty);
      expect(prefs.lastSaved, isEmpty);
    });
  });

  group('StoreFilterSectionVisibilityPrefs (real Store)', () {
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
    setUp(() async => Store.put(StoreKey.filterSheetHiddenSections, '[]'));

    test('save/load round-trips through Store; fresh container reloads (restart)', () async {
      const prefs = StoreFilterSectionVisibilityPrefs();
      expect(prefs.loadHidden(), isEmpty);
      await prefs.saveHidden({FilterSectionId.media});
      expect(prefs.loadHidden(), {FilterSectionId.media});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(hiddenSectionsProvider), {FilterSectionId.media});
    });
  });
}
```

- [ ] **Step 2: Run to verify it fails** — `mise exec -- flutter test test/providers/photos_filter/hidden_sections_provider_test.dart` → FAIL (file missing).

- [ ] **Step 3: Implement** (mirror `collapsed_sections.provider.dart`)

```dart
// mobile/lib/providers/photos_filter/hidden_sections.provider.dart
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

@visibleForTesting
String encodeHiddenSections(Set<FilterSectionId> ids) => jsonEncode(ids.map((e) => e.storageId).toList());

@visibleForTesting
Set<FilterSectionId> decodeHiddenSections(String json) {
  try {
    final raw = jsonDecode(json);
    if (raw is! List) return {};
    return raw.whereType<String>().map(FilterSectionId.fromStorageId).whereType<FilterSectionId>().toSet();
  } catch (_) {
    return {};
  }
}

/// Persistence gateway for the hidden-section set (empty = all visible). SEPARATE
/// from Slice 1's FilterSectionPrefs so existing FilterSectionPrefs test fakes
/// are unaffected.
abstract class FilterSectionVisibilityPrefs {
  Set<FilterSectionId> loadHidden();
  Future<void> saveHidden(Set<FilterSectionId> ids);
}

class StoreFilterSectionVisibilityPrefs implements FilterSectionVisibilityPrefs {
  const StoreFilterSectionVisibilityPrefs();

  @override
  Set<FilterSectionId> loadHidden() =>
      decodeHiddenSections(Store.get(StoreKey.filterSheetHiddenSections, '[]'));

  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) =>
      Store.put(StoreKey.filterSheetHiddenSections, encodeHiddenSections(ids));
}

final filterSectionVisibilityPrefsProvider =
    Provider<FilterSectionVisibilityPrefs>((_) => const StoreFilterSectionVisibilityPrefs());

final hiddenSectionsProvider =
    NotifierProvider<HiddenSectionsNotifier, Set<FilterSectionId>>(HiddenSectionsNotifier.new);

class HiddenSectionsNotifier extends Notifier<Set<FilterSectionId>> {
  @override
  Set<FilterSectionId> build() => ref.read(filterSectionVisibilityPrefsProvider).loadHidden();

  bool isVisible(FilterSectionId id) => !state.contains(id);

  void setVisible(FilterSectionId id, bool visible) {
    final next = Set<FilterSectionId>.from(state);
    if (visible) {
      next.remove(id);
    } else {
      next.add(id);
    }
    state = next;
    ref.read(filterSectionVisibilityPrefsProvider).saveHidden(next);
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `mise exec -- flutter test test/providers/photos_filter/hidden_sections_provider_test.dart` → PASS (6 tests).

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/providers/photos_filter/hidden_sections.provider.dart test/providers/photos_filter/hidden_sections_provider_test.dart
git add lib/providers/photos_filter/hidden_sections.provider.dart test/providers/photos_filter/hidden_sections_provider_test.dart
git commit -m "feat(mobile-filter): persist hidden filter sections via Store (slice 2)"
```

---

### Task 3: `ManageSectionsSheet` widget + opener

**Files:** Create `mobile/lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart`; Test `mobile/test/presentation/widgets/filter_sheet/deep/manage_sections_sheet_test.dart`.

**Interfaces:**

- Consumes: `FilterSectionId`, `hiddenSectionsProvider`.
- Produces: `class ManageSectionsSheet extends ConsumerWidget` (one `SwitchListTile.adaptive` per `FilterSectionId.values`, `key: Key('manage-section-<storageId>')`, `value: !hidden.contains(s)`); `Future<void> showManageSectionsSheet(BuildContext context)`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/manage_sections_sheet_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async => stored = ids;
}

List<Override> _vis([Set<FilterSectionId> hidden = const {}]) =>
    [filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({...hidden}))];

void main() {
  testWidgets('renders a toggle per section; hidden ones are OFF', (t) async {
    await t.pumpConsumerWidget(const ManageSectionsSheet(), overrides: _vis({FilterSectionId.tags}));
    for (final s in FilterSectionId.values) {
      expect(find.byKey(Key('manage-section-${s.storageId}')), findsOneWidget);
    }
    final tagsTile = t.widget<SwitchListTile>(find.byKey(const Key('manage-section-tags')));
    expect(tagsTile.value, isFalse);
    final peopleTile = t.widget<SwitchListTile>(find.byKey(const Key('manage-section-people')));
    expect(peopleTile.value, isTrue);
  });

  testWidgets('toggling a section off updates the provider', (t) async {
    final container = ProviderContainer(overrides: _vis());
    addTearDown(container.dispose);
    await t.pumpConsumerWidgetWithContainer(const ManageSectionsSheet(), container); // see note below
    await t.tap(find.byKey(const Key('manage-section-people')));
    await t.pumpAndSettle();
    expect(container.read(hiddenSectionsProvider), {FilterSectionId.people});
  });
}
```

> Note: if `widget_tester_extensions.dart` has no container-injecting variant, instead read state via a `Consumer` probe or assert the `SwitchListTile.value` flips after tap: pump with `overrides: _vis()`, tap `manage-section-people`, `pumpAndSettle`, then `expect(t.widget<SwitchListTile>(find.byKey(const Key('manage-section-people'))).value, isFalse)`. Use whichever the harness supports; the behavioral assertion (toggle flips the switch and persists via the fake) is what matters. Prefer the `SwitchListTile.value` assertion — it needs no extra harness.

- [ ] **Step 2: Run to verify it fails** — FAIL (file missing).

- [ ] **Step 3: Implement**

```dart
// mobile/lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

Future<void> showManageSectionsSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => const ManageSectionsSheet(),
    );

class ManageSectionsSheet extends ConsumerWidget {
  const ManageSectionsSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final hidden = ref.watch(hiddenSectionsProvider);
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
            child: Text('filter_sheet_deep_manage_sections'.tr(), style: theme.textTheme.titleMedium),
          ),
          for (final section in FilterSectionId.values)
            SwitchListTile.adaptive(
              key: Key('manage-section-${section.storageId}'),
              title: Text(section.titleKey.tr()),
              value: !hidden.contains(section),
              onChanged: (visible) {
                HapticFeedback.selectionClick();
                ref.read(hiddenSectionsProvider.notifier).setVisible(section, visible);
              },
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2 tests).

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart test/presentation/widgets/filter_sheet/deep/manage_sections_sheet_test.dart
git add lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart test/presentation/widgets/filter_sheet/deep/manage_sections_sheet_test.dart
git commit -m "feat(mobile-filter): add ManageSectionsSheet (slice 2)"
```

---

### Task 4: ⚙ entry in `DeepHeader`

**Files:** Modify `mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart`; Test: extend `mobile/test/presentation/widgets/filter_sheet/deep/deep_header_test.dart`.

**Interfaces:** Adds a manage `IconButton` (`key: Key('deep-header-manage')`, `Icons.tune_rounded`, `tooltip: 'filter_sheet_deep_manage_sections'.tr()`) on the trailing side next to Reset; `onPressed` → `HapticFeedback.selectionClick()` then `showManageSectionsSheet(context)`.

- [ ] **Step 1: Read the current header.** Read `deep_header.widget.dart`. The trailing slot currently renders a `TextButton` (Reset) when `!isEmpty`, else a `SizedBox(width: 48, height: 48)` placeholder. Change the trailing slot to a `Row(mainAxisSize: MainAxisSize.min, ...)` containing the always-present manage `IconButton` plus the conditional Reset. The manage button is ALWAYS shown (unlike Reset). Perfect title centering is not required (the mockup deep header is itself simplified); keep it visually balanced enough — the leading `close` (48) and trailing (`⚙` 48 + optional Reset) with the title in an `Expanded`.

- [ ] **Step 2: Write the failing test.** Extend `deep_header_test.dart`:

```dart
testWidgets('shows a manage-sections button that opens the sheet', (t) async {
  await t.pumpConsumerWidget(const DeepHeader()); // add filterSectionVisibilityPrefs override if the sheet reads it on open
  expect(find.byKey(const Key('deep-header-manage')), findsOneWidget);
  await t.tap(find.byKey(const Key('deep-header-manage')));
  await t.pumpAndSettle();
  // The manage sheet is now open — its section toggles are present.
  expect(find.byKey(const Key('manage-section-people')), findsOneWidget);
});
```

(Include `overrides: [filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({}))]` on the `pumpConsumerWidget` call, with a local `_FakeVis` like Task 3, so opening the sheet doesn't hit an uninitialized Store. Also keep any existing DeepHeader test overrides.)

- [ ] **Step 3: Run to verify it fails** — FAIL (no `deep-header-manage` key).

- [ ] **Step 4: Implement.** Add the import for `manage_sections_sheet.widget.dart`. Replace the trailing slot. Example shape (adapt to the file's exact current code):

```dart
// trailing slot
Row(
  mainAxisSize: MainAxisSize.min,
  children: [
    IconButton(
      key: const Key('deep-header-manage'),
      icon: const Icon(Icons.tune_rounded),
      tooltip: 'filter_sheet_deep_manage_sections'.tr(),
      onPressed: () {
        HapticFeedback.selectionClick();
        showManageSectionsSheet(context);
      },
    ),
    if (!isEmpty)
      TextButton(
        key: const Key('deep-header-reset'),
        onPressed: () {
          HapticFeedback.mediumImpact();
          ref.read(photosFilterProvider.notifier).reset();
        },
        child: Text('filter_sheet_reset'.tr()),
      ),
  ],
)
```

Remove the old standalone `SizedBox(width: 48, height: 48)` placeholder (the manage button now always occupies trailing space). Keep the `deep-header-close` button and the centered title.

- [ ] **Step 5: Run to verify it passes** — the new test PASSES; run the whole `deep_header_test.dart` (fix any centering/structure assertions in Task 6 if they break).

- [ ] **Step 6: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
git add lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
git commit -m "feat(mobile-filter): add manage-sections entry to deep header (slice 2)"
```

---

### Task 5: `deep_content` renders only visible sections

**Files:** Modify `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart`; Test `mobile/test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart`.

**Interfaces:** `deep_content` builds section widgets from a `FilterSectionId`→builder map and includes only sections where `!ref.watch(hiddenSectionsProvider).contains(id)`, in `FilterSectionId.values` order. Header + search bar + Done bar unchanged. People/When keep their `Builder`-wrapped `onOpenPicker` callbacks. Each section keeps its existing `Key('deep-section-<name>')`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart
// Use the in-memory Store harness (copy setUpAll/tearDownAll/setUp from Slice 1 plan's Test harness),
// plus a ScrollController. Set the viewport tall (tester.binding.setSurfaceSize(const Size(400, 2400)))
// so all ListView children build, matching deep_content_test.dart.
testWidgets('hidden sections are not rendered; visible ones are', (t) async {
  await Store.put(StoreKey.filterSheetHiddenSections, jsonEncode(['tags', 'camera']));
  // pump DeepContent within a MaterialApp that has the auto_route/router context
  // (reuse deep_content_test.dart's harness for DeepContent).
  ...
  expect(find.byKey(const Key('deep-section-tags')), findsNothing);
  expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
  expect(find.byKey(const Key('deep-section-media')), findsOneWidget);
});

testWidgets('default: all sections visible', (t) async {
  await Store.put(StoreKey.filterSheetHiddenSections, '[]');
  ...
  expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
  expect(find.byKey(const Key('deep-section-toggles')), findsOneWidget);
});
```

Read `deep_content_test.dart` first and reuse its exact `DeepContent` harness (it already sets up Store, router, viewport). The two new tests differ only by the `filterSheetHiddenSections` Store value.

- [ ] **Step 2: Run to verify it fails** — the "hidden" test FAILS (tags still rendered).

- [ ] **Step 3: Implement.** In `deep_content.widget.dart`, watch `hiddenSectionsProvider`. Build an ordered list of section widgets via a helper that maps each `FilterSectionId` to its widget (preserving the `Builder` wrapper + `onOpenPicker` for `people` and `when`), and include only `FilterSectionId.values.where((id) => !hidden.contains(id))`. Keep `DeepHeader`, `FilterSheetSearchBar`, and the `MatchCountFooter` exactly as-is. Example structure:

```dart
final hidden = ref.watch(hiddenSectionsProvider);
Widget sectionFor(FilterSectionId id) {
  switch (id) {
    case FilterSectionId.people:
      return Builder(
        key: const Key('deep-section-people-wrapper'),
        builder: (context) => PeopleSectionDeep(
          key: const Key('deep-section-people'),
          onOpenPicker: () => context.pushRoute(const PersonPickerRoute()),
        ),
      );
    case FilterSectionId.places:
      return const PlacesCascadeSection(key: Key('deep-section-places'));
    case FilterSectionId.tags:
      return const TagsSectionDeep(key: Key('deep-section-tags'));
    case FilterSectionId.when:
      return Builder(
        key: const Key('deep-section-when-wrapper'),
        builder: (context) => WhenAccordionSection(
          key: const Key('deep-section-when'),
          onOpenPicker: () => context.pushRoute(const WhenPickerRoute()),
        ),
      );
    case FilterSectionId.rating:
      return const RatingStarsSection(key: Key('deep-section-rating'));
    case FilterSectionId.media:
      return const MediaTypeSection(key: Key('deep-section-media'));
    case FilterSectionId.toggles:
      return const TogglesSection(key: Key('deep-section-toggles'));
    case FilterSectionId.camera:
      return const SizedBox.shrink(); // added in Slice 6
  }
}

// ListView children:
children: [
  const KeyedSubtree(key: Key('deep-header'), child: DeepHeader()),
  const Padding(padding: EdgeInsets.fromLTRB(20, 4, 20, 4),
      child: KeyedSubtree(key: Key('deep-search'), child: FilterSheetSearchBar())),
  for (final id in FilterSectionId.values)
    if (!hidden.contains(id)) sectionFor(id),
],
```

Note: `FilterSectionId.camera` does not exist until Slice 6 — do NOT add a `camera` case now; the `switch` covers exactly the 7 current values (no `camera` case, no default needed since the enum is exhaustive). Remove the camera line above.

- [ ] **Step 4: Run to verify it passes** — both new tests PASS.

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep_content.widget.dart test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart
git add lib/presentation/widgets/filter_sheet/deep_content.widget.dart test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart
git commit -m "feat(mobile-filter): render only visible sections in deep sheet (slice 2)"
```

---

### Task 6: "Hidden section keeps its active filter" + reconcile + full green

**Files:** Test `mobile/test/presentation/widgets/filter_sheet/deep_content_hidden_filter_test.dart`; fix any existing broken tests.

- [ ] **Step 1: Write the "hidden ≠ inactive" test.** With the in-memory Store harness: set a tag filter via `photosFilterProvider`, hide the tags section (`Store.put(StoreKey.filterSheetHiddenSections, jsonEncode(['tags']))`), pump `DeepContent`, assert `deep-section-tags` is absent AND `container.read(photosFilterProvider).tagIds` still contains the tag (filter state untouched by hiding). Use `deep_content_test.dart`'s harness + a `ProviderContainer` read, or a `Consumer` probe.

```dart
testWidgets('hiding a section does not clear its active filter', (t) async {
  // seed a tag selection in photosFilterProvider, then hide 'tags'
  // assert: deep-section-tags absent, but the tag id is still in photosFilterProvider.tagIds
});
```

- [ ] **Step 2: Run the full filter-sheet + photos_filter suites**

```bash
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/
```

Identify failures caused by the header restructure (Task 4) or deep_content change (Task 5) — likely `deep_header_test.dart` (trailing-slot structure), `deep_content_test.dart` / `deep_content_integration_test.dart` (section list now behind `hiddenSectionsProvider`, which reads the Store — these already init Store in `setUpAll`, so default `[]` = all visible, and they should still pass; if any assert exact child structure/order, update to the map-driven output preserving order).

- [ ] **Step 3: Fix each broken test**, preserving intent. Add a `filterSectionVisibilityPrefsProvider` fake override only where a test renders `DeepContent`/`DeepHeader` WITHOUT initializing the Store (mirror the Slice 1 `_FakePrefs` pattern; here it's `_FakeVis`). Where the Store is initialized in `setUpAll`, no override is needed (default `[]` = all visible).

- [ ] **Step 4: Re-run until green**

```bash
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/
```

Expected: **All tests passed!** (≥ 388 + Slice 2's new tests).

- [ ] **Step 5: Full analyze gate**

```bash
mise exec -- dart analyze lib test
```

Expected: `No issues found!`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(mobile-filter): hidden-section filter retention + reconcile (slice 2)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 2 BDD):** open from ⚙ (Task 4), deep-snap only (⚙ lives in DeepHeader which only renders in the deep snap — DeepContent; verified by Task 4 opening the sheet), hide a section (Task 5), persists (Task 2 real-Store restart test), show hidden (Task 2 setVisible true + Task 3 toggle), hidden keeps active filter (Task 6), default all visible (Task 2 + Task 5). Mockup `#mockup-manage-sections` (toggle per section) reproduced (Task 3); ⚙ entry (Task 4).
- **Placeholder scan:** the `camera` case note in Task 5 explicitly says to OMIT it (enum has no camera until Slice 6) — the exhaustive switch covers the 7 current values with no default. No TODO/TBD.
- **Type consistency:** `FilterSectionVisibilityPrefs` / `hiddenSectionsProvider` / `filterSectionVisibilityPrefsProvider` / `setVisible`/`isVisible` used consistently Tasks 2–5. Separate from Slice 1's `FilterSectionPrefs` (does not break existing fakes).
- **Out of scope guarded:** no picker/cap/camera/suggestion/browse-strip/collapse changes; hiding never mutates `photosFilterProvider`.
- **Deep-snap-only ⚙:** the ⚙ is in `DeepHeader`, which is only built inside `DeepContent` (deep snap). `BrowseContent` has its own header without a ⚙ — confirm during Task 4 that no change is needed to browse.
