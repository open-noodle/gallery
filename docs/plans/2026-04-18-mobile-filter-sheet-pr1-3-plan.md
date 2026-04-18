# Mobile Filter Sheet — PR 1.3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the **Deep** snap of the Photos filter sheet plus the **People** and **When** overflow pickers, bringing the mobile filter sheet to parity with the web FilterPanel on Photos (minus Camera — Phase 2).

**Architecture:** Replace `DeepStubContent` with a real `DeepContent` widget that hosts every filter section end-to-end. Re-use the PR 1.2 infrastructure: `photosFilterProvider` for writes, `photosFilterDebouncedProvider` + `photosFilterSuggestionsProvider(filter)` for dynamic context-aware reads, `MatchCountFooter` as the Done bar. The two pickers are new full-screen routes pushed over the sheet (`PersonPickerRoute`, `WhenPickerRoute`) that read and write the same `photosFilterProvider` — no route arguments, no adapter layer.

**Tech Stack:** Flutter 3.x, Dart, Riverpod (`hooks_riverpod`), `auto_route`, `easy_localization`, `flutter_test`, generated `openapi` client (mobile SDK). No server-side changes and no OpenAPI regen in this PR — the unified filter-suggestions endpoint and `getSearchSuggestions`/`getTimeBuckets` are already exposed by PR 1.1.

**Design reference:** `docs/plans/2026-04-17-mobile-filter-sheet-design.md` (sections §4, §5.2, §5.3, §6, §7, §8, §9, §10).

---

## Scope & splitting decision

Design §10.3 allows PR 1.3 to split into **1.3a (Deep state only)**, **1.3b (People picker)**, **1.3c (When picker)** if the net diff exceeds ~1500 LOC excluding generated code. This plan is structured in three phases that **can each become a standalone PR at draft time**:

- **Phase A (Deep state, Tasks A1–A13)** — ships `DeepContent` with every section wired to real providers. People and When section headers use stub `onTap` handlers (`TODO(pr1.3b/c)`) until their pickers land.
- **Phase B (People picker, Tasks B1–B7)** — replaces the Phase A stub `onTap` for People with a real `PersonPickerRoute` push.
- **Phase C (When picker, Tasks C1–C7)** — replaces the Phase A stub `onTap` for When with a real `WhenPickerRoute` push.

**At the end of Phase A, stop and measure the diff.** If `git diff --stat origin/main...HEAD -- mobile/ ':!mobile/openapi/**' ':!**/*.g.dart'` is >1500 LOC net, open PR 1.3a standalone, then do 1.3b and 1.3c as follow-up PRs. Otherwise continue straight into Phases B and C in the same branch for a single PR 1.3.

**No server, no OpenAPI, no SDK changes.** Every endpoint consumed in this PR (`getFilterSuggestions`, `getSearchSuggestions`, `getTimeBuckets`, `searchPerson`, `driftGetAllPeopleProvider`) is already exposed on `origin/main`.

**Out of scope (deferred):** `stillExists` orphan-id reconciliation (design §7 Phase 1.5 deferral); Tags and Places overflow pickers (Phase 2); Camera filter (Phase 2); sort controls; persistence across app restarts.

---

## Testing philosophy

Every task follows strict TDD: **Red → Green → Refactor → Commit.** Tests are unit (`flutter_test` + `ProviderScope` overrides) or widget tests with `pumpConsumerWidget` — no integration tests in this PR (patrol removed per `project_play_store_publishing.md`).

**Running tests** — all commands from repo root unless noted:

```bash
# All mobile tests (fast subset first)
cd mobile && flutter test --concurrency=1

# Single test file (preferred for inner loop)
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep/rating_stars_section_test.dart

# Single test by name
cd mobile && flutter test --plain-name "rating tap sets stars" test/path/to/file.dart

# Static analysis (must pass before commit — CI enforces)
cd mobile && dart analyze
cd mobile && dart format --set-exit-if-changed lib test
```

**`pumpConsumerWidget` helper:** lives at `mobile/test/widget_tester_extensions.dart`. Takes a widget and optional `overrides`, wraps in `ProviderScope → MaterialApp → Material`. Every widget test below uses it.

**Override pattern for `StateProvider`:**

```dart
// Wrong — overrideWith gets a Ref, not a value
photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),

// Right — read container, push state, pump
final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));
container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
await tester.pumpAndSettle();
```

**Suggestion-provider override pattern** (covers every section test):

```dart
photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(
  FilterSuggestionsResponseDto(
    hasUnnamedPeople: false,
    people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
    tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
    countries: ['France'],
    cameraMakes: [],
    mediaTypes: ['IMAGE', 'VIDEO'],
    ratings: [4, 5],
  ),
)),
```

**Test coverage gates (from design §9):**

- §9.1 unit coverage: provider-derivation functions (`cityForCountryProvider`, `aggregateYears`, `peopleAlphaIndex`, `peekDecadesForBuckets`, etc.).
- §9.2 widget coverage: every new Section widget, `DeepHeader`, `PersonPickerPage`, `WhenPickerPage`, scrubber.
- §9.2 regression: orphan-id absence does **not** drop chips (design §7 C2); `setMediaType(null)` clears; `setRating(null)` clears; `togglePerson` round-trip.
- §9.4 manual QA items are called out per-phase.

---

## Prereqs & baseline (do once, before any task)

**P.1 Worktree + branch** — already created at `.worktrees/mobile-filter-deep/` on `feat/mobile-filter-deep` tracking `origin/main`. Confirm:

```bash
cd .worktrees/mobile-filter-deep
git status          # clean
git branch --show-current   # feat/mobile-filter-deep
git log --oneline -1        # 809491211 feat(mobile): photos filter sheet UI (PR 1.2)
```

**P.2 Flutter deps** — run once per fresh worktree:

```bash
cd mobile && flutter pub get
```

**P.3 Baseline tests** — must pass before writing any new test. Run the PR 1.1/1.2 suites:

```bash
cd mobile && flutter test test/providers/photos_filter/ test/presentation/widgets/filter_sheet/
```

Expected: all green, 0 failures. If red, **stop and investigate** — do not proceed with new tasks on top of a broken baseline (memory: `feedback_no_flake_allowance.md`).

**P.4 No OpenAPI regen this PR** — the suggestions/search endpoints are already in `mobile/openapi/`. Do **not** run `make open-api-dart` for PR 1.3.

---

# PHASE A — Deep state (Tasks A1–A13)

Scope: `DeepContent` widget replacing `DeepStubContent`, every section from design §5.2, `PageStorageKey` for scroll retention, new i18n keys.

**Files added this phase:**

- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/tags_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart`
- `mobile/lib/providers/photos_filter/city_suggestions.provider.dart`
- `mobile/lib/providers/photos_filter/time_buckets.provider.dart`
- `mobile/lib/providers/photos_filter/temporal_utils.dart` (pure helpers)
- Mirror `mobile/test/…` files for each widget + provider added above.

**Files modified:**

- `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart` — swap `DeepStubContent` → `DeepContent` in `_snapChild`.
- `mobile/lib/presentation/widgets/filter_sheet/deep_stub_content.widget.dart` — **delete** at the end of Phase A (Task A13).
- `i18n/en.json` — add keys enumerated in Task A0.

---

### Task A0: i18n keys + project-wide key check

**Why first:** several widget tests call `'key'.tr()` and fail silently if the key is missing (shows the key itself). Add all keys up front and the later tests verify expected labels.

**Files:**

- Modify: `i18n/en.json`
- Modify: every other `i18n/*.json` only via the existing sync workflow. **In this PR, add English-only** — the repo's i18n-sync job copies through the fallback. (Memory: `feedback_i18n_key_sorting.md` — use `pnpm --filter=immich-i18n format:fix` after editing.)

**Step 1: Add keys alphabetically in `i18n/en.json`**

Insert these keys (alphabetically placed in the file):

```json
"filter_sheet_deep_people_section": "People",
"filter_sheet_deep_places_section": "Places",
"filter_sheet_deep_tags_section": "Tags",
"filter_sheet_deep_when_section": "When",
"filter_sheet_deep_rating_section": "Rating",
"filter_sheet_deep_media_section": "Media",
"filter_sheet_deep_toggles_section": "Options",
"filter_sheet_deep_search_n_people": {
  "one": "Search {count} person →",
  "other": "Search {count} people →"
},
"filter_sheet_deep_search_n_years": {
  "one": "{count} year →",
  "other": "{count} years →"
},
"filter_sheet_deep_empty_people": "Filters appear as you upload photos",
"filter_sheet_deep_empty_tags": "No tags yet — tap a photo to add one",
"filter_sheet_deep_empty_places": "Locations will appear when photos have them",
"filter_sheet_deep_rating_any": "Any rating",
"filter_sheet_deep_media_any": "All",
"filter_sheet_deep_places_all_countries": "All countries",
"filter_sheet_deep_places_all_cities": "All cities",
"filter_sheet_deep_when_any_year": "Any year",
"filter_sheet_deep_when_month_jan": "Jan",
"filter_sheet_deep_when_month_feb": "Feb",
"filter_sheet_deep_when_month_mar": "Mar",
"filter_sheet_deep_when_month_apr": "Apr",
"filter_sheet_deep_when_month_may": "May",
"filter_sheet_deep_when_month_jun": "Jun",
"filter_sheet_deep_when_month_jul": "Jul",
"filter_sheet_deep_when_month_aug": "Aug",
"filter_sheet_deep_when_month_sep": "Sep",
"filter_sheet_deep_when_month_oct": "Oct",
"filter_sheet_deep_when_month_nov": "Nov",
"filter_sheet_deep_when_month_dec": "Dec",
"filter_sheet_picker_people_title": "Choose people",
"filter_sheet_picker_when_title": "Choose when",
"filter_sheet_picker_search_people_hint": "Search people",
"filter_sheet_picker_search_when_hint": "Year or decade — e.g. 2024 or 20s",
"filter_sheet_picker_recent": "Recent",
"filter_sheet_picker_no_results": "No results for '{query}'",
"filter_sheet_picker_clear_search": "Clear search",
"filter_sheet_picker_selection_count": {
  "one": "{count} selected",
  "other": "{count} selected"
},
"filter_sheet_picker_done": "Done"
```

**Step 2: Run i18n formatter**

```bash
pnpm --filter=immich-i18n format:fix
```

Expected: the other `i18n/*.json` files get their English fallbacks synced automatically, no manual edits.

**Step 3: Commit**

```bash
git add i18n/
git commit -m "feat(mobile): i18n keys for filter-sheet Deep sections and pickers"
```

---

### Task A1: `DeepHeader` widget

**Design reference:** §5.2 "Deep" header layout — Close · Title · Reset. §9.2 DeepState widget tests (DeepHeader Reset, DeepHeader Close).

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep/deep_header_test.dart`

**Step 1: Write the failing widget tests**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('DeepHeader', () {
    testWidgets('renders Close icon, title, and Reset button when filter non-empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
      expect(find.text('Filters'), findsOneWidget);
      expect(find.byKey(const Key('deep-header-reset')), findsOneWidget);
    });

    testWidgets('Reset button is hidden when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-reset')), findsNothing);
    });

    testWidgets('Close button sets sheet snap to browse', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-close')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    });

    testWidgets('Reset calls reset() on notifier and filter becomes empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(photosFilterProvider.notifier).setRating(4);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
    });

    testWidgets('Reset does not dismiss the sheet', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    });
  });
}
```

**Step 2: Run test to verify it fails**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
```

Expected: FAIL — file not found / symbol `DeepHeader` not defined.

**Step 3: Implement `DeepHeader`**

```dart
// mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

class DeepHeader extends ConsumerWidget {
  const DeepHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 12, 4),
      child: Row(
        children: [
          IconButton(
            key: const Key('deep-header-close'),
            icon: const Icon(Icons.close_rounded),
            tooltip: 'close'.tr(),
            onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse,
          ),
          Expanded(
            child: Text(
              'filter_sheet_title'.tr(),
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ),
          if (!isEmpty)
            TextButton(
              key: const Key('deep-header-reset'),
              onPressed: () {
                HapticFeedback.mediumImpact();
                ref.read(photosFilterProvider.notifier).reset();
              },
              child: Text('filter_sheet_reset'.tr()),
            )
          else
            const SizedBox(width: 48),
        ],
      ),
    );
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
```

Expected: PASS (5 tests).

**Step 5: Format + analyze + commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/deep/ test/presentation/widgets/filter_sheet/deep/
cd mobile && dart analyze lib/presentation/widgets/filter_sheet/deep/ test/presentation/widgets/filter_sheet/deep/
git add mobile/lib/presentation/widgets/filter_sheet/deep/deep_header.widget.dart mobile/test/presentation/widgets/filter_sheet/deep/deep_header_test.dart
git commit -m "feat(mobile): DeepHeader with Close + Reset (TDD)"
```

---

### Task A2: `DeepContent` scaffold (empty shell, tests for ordering)

Design §5.2 top-to-bottom order: search → People → Places cascade → Tags → When accordion → Rating → Media → toggles → DoneBar. Each section is added in Tasks A4–A10; this task wires the shell with placeholder widgets using keyed `SizedBox`es so the **ordering test** can be written first and stays meaningful as sections are filled in.

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep_content_test.dart`

**Step 1: Write the failing ordering test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep_content_test.dart
import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

import '../../widget_tester_extensions.dart';

void main() {
  group('DeepContent', () {
    testWidgets('sections render in the §5.2 order', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [
          photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),
        ],
      );
      await tester.pumpAndSettle();

      final orderedKeys = [
        const Key('deep-header'),
        const Key('deep-search'),
        const Key('deep-section-people'),
        const Key('deep-section-places'),
        const Key('deep-section-tags'),
        const Key('deep-section-when'),
        const Key('deep-section-rating'),
        const Key('deep-section-media'),
        const Key('deep-section-toggles'),
        const Key('deep-done-bar'),
      ];

      // Positions must be strictly increasing in global Y.
      double prev = double.negativeInfinity;
      for (final key in orderedKeys) {
        expect(find.byKey(key), findsOneWidget, reason: '$key missing');
        final box = tester.getTopLeft(find.byKey(key));
        expect(box.dy, greaterThan(prev), reason: '$key not below previous');
        prev = box.dy;
      }
    });

    testWidgets('PageStorageKey is set on the scroll body (§6.5 retention)', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      await tester.pumpConsumerWidget(DeepContent(scrollController: controller));
      await tester.pumpAndSettle();

      final storage = find.byKey(const PageStorageKey('filter-sheet-deep-scroll'));
      expect(storage, findsOneWidget);
    });
  });
}
```

**Step 2: Run test to verify it fails**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep_content_test.dart
```

Expected: FAIL — `DeepContent` not defined.

**Step 3: Implement `DeepContent` with keyed placeholder sections**

```dart
// mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/match_count_footer.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';

/// The Deep snap body. Owns the scroll view, the sticky Done bar, and the
/// PageStorageKey that retains scroll offset across picker pushes (design §6.5).
class DeepContent extends ConsumerWidget {
  final ScrollController scrollController;
  const DeepContent({super.key, required this.scrollController});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: Stack(
        children: [
          ListView(
            key: const PageStorageKey('filter-sheet-deep-scroll'),
            controller: scrollController,
            padding: const EdgeInsets.only(bottom: 88),
            children: const [
              KeyedSubtree(key: Key('deep-header'), child: DeepHeader()),
              Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 4),
                child: KeyedSubtree(key: Key('deep-search'), child: FilterSheetSearchBar()),
              ),
              SizedBox(height: 8, key: Key('deep-section-people')),
              SizedBox(height: 8, key: Key('deep-section-places')),
              SizedBox(height: 8, key: Key('deep-section-tags')),
              SizedBox(height: 8, key: Key('deep-section-when')),
              SizedBox(height: 8, key: Key('deep-section-rating')),
              SizedBox(height: 8, key: Key('deep-section-media')),
              SizedBox(height: 8, key: Key('deep-section-toggles')),
            ],
          ),
          const Positioned(
            left: 0, right: 0, bottom: 0,
            child: KeyedSubtree(key: Key('deep-done-bar'), child: MatchCountFooter()),
          ),
        ],
      ),
    );
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep_content_test.dart
```

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/deep_content.widget.dart test/presentation/widgets/filter_sheet/deep_content_test.dart
cd mobile && dart analyze lib/presentation/widgets/filter_sheet/deep_content.widget.dart
git add mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart mobile/test/presentation/widgets/filter_sheet/deep_content_test.dart
git commit -m "feat(mobile): DeepContent scaffold with ordered section placeholders"
```

---

### Task A3: Wire `DeepContent` into `FilterSheet._snapChild`

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart`
- Modify: `mobile/test/presentation/widgets/filter_sheet/filter_sheet_test.dart`

**Step 1: Update failing test — deep renders `DeepContent` (replaces `DeepStubContent` expectation)**

Add to `filter_sheet_test.dart`:

```dart
testWidgets('deep → DeepContent mounted (replaces stub)', (tester) async {
  await _pump(tester, snap: FilterSheetSnap.deep);
  expect(find.byType(DeepContent), findsOneWidget);
  expect(find.byType(DeepStubContent), findsNothing);
});
```

Add imports. Expected run: FAIL — `DeepContent` not referenced by `FilterSheet` yet.

**Step 2: Implementation — swap `DeepStubContent` → `DeepContent`**

```dart
// filter_sheet.widget.dart – inside _snapChild
case FilterSheetSnap.deep:
  return DeepContent(scrollController: scrollController);
```

Also remove the `deep_stub_content.widget.dart` import.

**Step 3: Run**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/filter_sheet_test.dart
```

Expected: PASS.

**Step 4: Commit**

```bash
git add mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart mobile/test/presentation/widgets/filter_sheet/filter_sheet_test.dart
git commit -m "feat(mobile): mount DeepContent at deep snap (replaces stub)"
```

Do **not** delete `deep_stub_content.widget.dart` yet — it remains referenced by its own tests until Task A13 sweeps it up.

---

### Task A4: `PeopleSectionDeep` widget

**Design reference:** §5.2 "People grid" and §5.3 "Search N →". Uses `photosFilterSuggestionsProvider` (the same suggestions API as the Browse strip) but renders a **wrap grid** of circular avatars instead of a horizontal strip.

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep/people_section_test.dart`
- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` — replace the `SizedBox(key: Key('deep-section-people'))` placeholder with the real widget, preserving the same key.

**Step 1: Failing widget test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/people_section_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/people_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg({List<FilterSuggestionsPersonDto>? people}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, people: people ?? const []);

void main() {
  group('PeopleSectionDeep', () {
    testWidgets('renders section title + "Search N people →" header when suggestions > 0', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(
            people: [
              FilterSuggestionsPersonDto(id: 'p1', name: 'Emma'),
              FilterSuggestionsPersonDto(id: 'p2', name: 'Lars'),
            ],
          ))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('People'), findsOneWidget);
      expect(find.text('Emma'), findsOneWidget);
      expect(find.text('Lars'), findsOneWidget);
      expect(find.byKey(const Key('people-section-search-more')), findsOneWidget);
    });

    testWidgets('tap avatar toggles togglePerson in photosFilterProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(
            people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
          ))),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      await tester.tap(find.byKey(const Key('people-tile-p1')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);
    });

    testWidgets('empty list → empty state string and no "Search N" affordance', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('Filters appear as you upload photos'), findsOneWidget);
      expect(find.byKey(const Key('people-section-search-more')), findsNothing);
    });

    testWidgets('onOpenPicker callback fires when "Search N →" tapped', (tester) async {
      var opened = false;
      await tester.pumpConsumerWidget(
        Material(child: PeopleSectionDeep(onOpenPicker: () => opened = true)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(
            people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
          ))),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('people-section-search-more')));
      expect(opened, isTrue);
    });
  });
}
```

**Step 2: Run — expect FAIL**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep/people_section_test.dart
```

**Step 3: Implement `PeopleSectionDeep`**

Pattern: `ConsumerWidget`, read `photosFilterDebouncedProvider` + `photosFilterSuggestionsProvider`. Render a `Wrap` of circular avatar tiles (same selection visual as `PeopleStrip`'s `_PersonTile`). Header row: `Text('filter_sheet_deep_people_section'.tr())` + trailing `TextButton.icon` keyed `people-section-search-more` rendered only when `people.isNotEmpty`.

The callback parameter `onOpenPicker` is nullable so PR 1.3a can ship with `onOpenPicker: null` (button still renders but does nothing / cues a `SnackBar` "Coming soon" — use `SnackBar` to match the TODO pattern, since design §7 says "Search → always shown"). In Phase B (Task B7), the caller passes a real closure.

Concrete implementation sketch:

```dart
class PeopleSectionDeep extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const PeopleSectionDeep({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final people = async.valueOrNull?.people ?? const <FilterSuggestionsPersonDto>[];

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'filter_sheet_deep_people_section'.tr(),
                style: theme.textTheme.labelLarge?.copyWith(
                  letterSpacing: 1.2,
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              if (people.isNotEmpty)
                TextButton(
                  key: const Key('people-section-search-more'),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    if (onOpenPicker != null) {
                      onOpenPicker!();
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Full people picker coming soon')),
                      );
                    }
                  },
                  child: Text('filter_sheet_deep_search_n_people'.plural(people.length, args: ['${people.length}'])),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (people.isEmpty)
            _EmptyCaption(text: 'filter_sheet_deep_empty_people'.tr())
          else
            Wrap(
              spacing: 14,
              runSpacing: 14,
              children: [for (final p in people) _PeopleGridTile(person: p)],
            ),
        ],
      ),
    );
  }
}
```

Each `_PeopleGridTile` renders a circular avatar + truncated name, keyed `people-tile-$id`, selection visual matches `_PersonTile` from the Browse strip, `onTap` calls `togglePerson`.

**Step 4: Run — PASS**

**Step 5: Wire into `DeepContent`** — replace the `SizedBox(key: Key('deep-section-people'))` placeholder with `const PeopleSectionDeep(key: Key('deep-section-people'))`. Update the ordering test (already passes due to the same key).

**Step 6: Commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart test/presentation/widgets/filter_sheet/deep/people_section_test.dart lib/presentation/widgets/filter_sheet/deep_content.widget.dart
cd mobile && dart analyze lib/presentation/widgets/filter_sheet/deep/
git add mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart mobile/test/presentation/widgets/filter_sheet/deep/people_section_test.dart mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart
git commit -m "feat(mobile): PeopleSectionDeep grid + Search N affordance"
```

---

### Task A5: `PlacesCascadeSection` — country list + city subprovider

**Design reference:** §5.2 "Places cascade (country → city)". The suggestions endpoint returns only `countries`; cities require a second call via `getSearchSuggestions(SearchSuggestionType.city, country: ...)`.

**Files:**

- Create: `mobile/lib/providers/photos_filter/city_suggestions.provider.dart`
- Create: `mobile/test/providers/photos_filter/city_suggestions_provider_test.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep/places_cascade_section_test.dart`
- Modify: `DeepContent` — slot this section at `Key('deep-section-places')`.

**Step 1a: Provider test (unit)**

```dart
// mobile/test/providers/photos_filter/city_suggestions_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _FakeSearchApi extends Mock implements SearchApi {}

void main() {
  test('returns [] when country is null', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final result = await container.read(citySuggestionsProvider(null).future);
    expect(result, isEmpty);
  });

  test('calls getSearchSuggestions(type=city, country) when country set', () async {
    final api = _FakeSearchApi();
    when(() => api.getSearchSuggestions(
          SearchSuggestionType.city,
          country: 'France',
          withSharedSpaces: false,
        )).thenAnswer((_) async => ['Paris', 'Lyon']);

    final container = ProviderContainer(overrides: [
      searchApiProvider.overrideWithValue(api),
    ]);
    addTearDown(container.dispose);

    final result = await container.read(citySuggestionsProvider('France').future);
    expect(result, ['Paris', 'Lyon']);
    verify(() => api.getSearchSuggestions(SearchSuggestionType.city, country: 'France', withSharedSpaces: false)).called(1);
  });
}
```

Note: `searchApiProvider` should already exist (PR 1.1 lazy-resolution pattern — see memory `feedback_mobile_api_repo_eager_capture.md`). If not, use `apiServiceProvider.searchApi` as a fallback pattern mirroring `filter_suggestions.provider.dart`.

**Step 1b: Provider implementation**

```dart
// mobile/lib/providers/photos_filter/city_suggestions.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

final citySuggestionsProvider = FutureProvider.autoDispose.family<List<String>, String?>((ref, country) async {
  if (country == null || country.isEmpty) return const <String>[];
  final api = ref.watch(apiServiceProvider).searchApi;
  final cities = await api.getSearchSuggestions(
    SearchSuggestionType.city,
    country: country,
    withSharedSpaces: false,
  );
  return cities ?? const [];
});
```

**Step 1c: Run + commit**

```bash
cd mobile && flutter test test/providers/photos_filter/city_suggestions_provider_test.dart
git add mobile/lib/providers/photos_filter/city_suggestions.provider.dart mobile/test/providers/photos_filter/city_suggestions_provider_test.dart
git commit -m "feat(mobile): citySuggestionsProvider (country → city cascade)"
```

**Step 2a: Widget test — PlacesCascadeSection renders country list, clicks expand to city list**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/places_cascade_section_test.dart
// Tests: render country list when country unset; clicking country selects + reveals city list;
// clicking city calls setLocation(country+city); clearing country resets cities; empty-state text.
```

Write four widget tests matching these cases. Override both `photosFilterSuggestionsProvider` (to feed `countries`) and `citySuggestionsProvider` (to feed cities for a chosen country).

**Step 2b: Widget implementation**

`PlacesCascadeSection` is a `ConsumerStatefulWidget` (needs local state: selected country — driven by `photosFilterProvider.location.country`). Structure:

```
Column(
  Header row: 'Places' label + 'Search N cities →' (hidden in Phase 1, stub w/ null handler → 'Phase 2')
  if (selectedCountry == null) → Wrap of country FilterChips
  else → Row(
    Chip(selectedCountry, onDeleted: clear country)
    Wrap of city FilterChips below
  )
)
```

Each country chip keyed `places-country-$name`; each city chip keyed `places-city-$name`. Taps call `setLocation(SearchLocationFilter(country: ..., city: ...))`.

**Step 3: Run, commit**

Standard TDD commit.

---

### Task A6: `TagsSectionDeep` — pill wrap

Similar to TagsStrip but uses `Wrap` instead of horizontal list, shows all tags from suggestions (bounded top-N from the endpoint, design §8), and displays the empty caption when tags.isEmpty.

**Files:** `tags_section.widget.dart` + test mirroring PeopleSectionDeep.

**Tests:**

- Tags render as `FilterChip` rows in a `Wrap`.
- Tapping a chip calls `toggleTag`.
- Selected chips reflect `photosFilterProvider.tagIds`.
- Empty list renders `'filter_sheet_deep_empty_tags'` caption.
- Section header title 'Tags' renders.

Implementation reuses `TagsStrip`'s per-chip visuals — extract the chip into a shared `_TagPill` if used by both, otherwise inline (avoid premature abstraction per CLAUDE.md DRY rule of three).

Commit: `feat(mobile): TagsSectionDeep pill-wrap`.

---

### Task A7: `WhenAccordionSection` — inline year+month (requires time-buckets provider + temporal utils)

**Design reference:** §5.2 "When accordion" and §9.1 alpha-scrubber-like pattern for year aggregation. The web code at `web/src/lib/components/filter-panel/temporal-utils.ts` has the reference algorithm: `aggregateYears(buckets)` and `getMonthsForYear(buckets, year)`. Port to Dart.

**Files:**

- Create: `mobile/lib/providers/photos_filter/temporal_utils.dart` — pure helpers (aggregation + typedefs).
- Create: `mobile/test/providers/photos_filter/temporal_utils_test.dart` — unit tests per web temporal-utils cases.
- Create: `mobile/lib/providers/photos_filter/time_buckets.provider.dart` — `FutureProvider.autoDispose.family<List<TimeBucketsResponseDto>, SearchFilter>` wrapping `timelineApi.getTimeBuckets`.
- Create: `mobile/test/providers/photos_filter/time_buckets_provider_test.dart`.
- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep/when_accordion_section_test.dart`

**Step 1: Unit tests for temporal utils**

```dart
// mobile/test/providers/photos_filter/temporal_utils_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';

void main() {
  group('aggregateYears', () {
    test('sums counts across months of the same year', () {
      final buckets = [
        (timeBucket: '2024-01-01', count: 10),
        (timeBucket: '2024-03-01', count: 5),
        (timeBucket: '2023-12-01', count: 7),
      ];
      final years = aggregateYears(buckets);
      expect(years, hasLength(2));
      expect(years.firstWhere((y) => y.year == 2024).count, 15);
      expect(years.firstWhere((y) => y.year == 2023).count, 7);
    });

    test('sorts descending by year', () {
      final buckets = [
        (timeBucket: '2019-01-01', count: 1),
        (timeBucket: '2024-01-01', count: 1),
        (timeBucket: '2022-01-01', count: 1),
      ];
      expect(aggregateYears(buckets).map((y) => y.year), [2024, 2022, 2019]);
    });

    test('empty input → empty list', () {
      expect(aggregateYears(const []), isEmpty);
    });
  });

  group('getMonthsForYear', () {
    test('returns 12 entries with counts for the matching year only', () {
      final buckets = [
        (timeBucket: '2024-01-01', count: 3),
        (timeBucket: '2024-05-01', count: 7),
        (timeBucket: '2023-05-01', count: 42),
      ];
      final months = getMonthsForYear(buckets, 2024);
      expect(months, hasLength(12));
      expect(months[0].count, 3); // January
      expect(months[4].count, 7); // May
      expect(months[11].count, 0); // December not in source → 0
    });
  });

  group('peekDecadesForYears', () {
    test('returns only decades present in the data', () {
      final years = [
        YearCount(year: 2024, count: 1),
        YearCount(year: 2021, count: 1),
        YearCount(year: 2018, count: 1),
        YearCount(year: 2008, count: 1),
      ];
      final decades = peekDecadesForYears(years);
      expect(decades.map((d) => d.decadeStart), [2020, 2010, 2000]);
    });
  });
}
```

**Step 2: Implement temporal_utils.dart**

```dart
// mobile/lib/providers/photos_filter/temporal_utils.dart

class YearCount {
  final int year;
  final int count;
  const YearCount({required this.year, required this.count});
}

class MonthCount {
  final int month; // 1..12
  final int count;
  const MonthCount({required this.month, required this.count});
}

class DecadeBucket {
  final int decadeStart; // 2020 for 2020s
  final int count;
  const DecadeBucket({required this.decadeStart, required this.count});
}

typedef BucketLite = ({String timeBucket, int count});

List<YearCount> aggregateYears(List<BucketLite> buckets) {
  final byYear = <int, int>{};
  for (final b in buckets) {
    final year = int.parse(b.timeBucket.substring(0, 4));
    byYear[year] = (byYear[year] ?? 0) + b.count;
  }
  final entries = byYear.entries.toList()..sort((a, b) => b.key.compareTo(a.key));
  return [for (final e in entries) YearCount(year: e.key, count: e.value)];
}

List<MonthCount> getMonthsForYear(List<BucketLite> buckets, int year) {
  final counts = List<int>.filled(12, 0);
  for (final b in buckets) {
    if (!b.timeBucket.startsWith('$year-')) continue;
    final month = int.parse(b.timeBucket.substring(5, 7));
    counts[month - 1] += b.count;
  }
  return [for (var i = 0; i < 12; i++) MonthCount(month: i + 1, count: counts[i])];
}

List<DecadeBucket> peekDecadesForYears(List<YearCount> years) {
  final byDecade = <int, int>{};
  for (final y in years) {
    final d = (y.year ~/ 10) * 10;
    byDecade[d] = (byDecade[d] ?? 0) + y.count;
  }
  final entries = byDecade.entries.toList()..sort((a, b) => b.key.compareTo(a.key));
  return [for (final e in entries) DecadeBucket(decadeStart: e.key, count: e.value)];
}
```

**Step 3: Run temporal utils tests; commit.**

**Step 4: `timeBucketsProvider`**

```dart
// mobile/lib/providers/photos_filter/time_buckets.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:openapi/api.dart';

/// Wraps TimelineApi.getTimeBuckets, parametrised on current filter.
/// Returns a list of (timeBucket, count) tuples the accordion consumes.
final timeBucketsProvider = FutureProvider.autoDispose.family<List<BucketLite>, SearchFilter>((ref, filter) async {
  final api = ref.watch(apiServiceProvider).timelineApi;
  final buckets = await api.getTimeBuckets(
    country: filter.location.country,
    city: filter.location.city,
    isFavorite: filter.display.isFavorite ? true : null,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating,
    tagIds: filter.tagIds,
    // Dart AssetTypeEnum mapping — see filter_suggestions.provider.dart
    type: _mapMediaType(filter.mediaType),
  );
  if (buckets == null) return const [];
  return [
    for (final b in buckets)
      (timeBucket: b.timeBucket, count: b.count),
  ];
}, dependencies: const []);

AssetTypeEnum? _mapMediaType(dynamic mediaType) {
  // Same rules as in filter_suggestions.provider.dart — consolidate later if a third caller appears.
  if (mediaType == null) return null;
  final name = mediaType.toString();
  if (name.contains('image')) return AssetTypeEnum.IMAGE;
  if (name.contains('video')) return AssetTypeEnum.VIDEO;
  if (name.contains('audio')) return AssetTypeEnum.AUDIO;
  return null;
}
```

Write a small mocktail-based test matching the city_suggestions_provider pattern, verifying that `getTimeBuckets` is called with the filter's country/city/personIds.

Commit each provider + test separately.

**Step 5: `WhenAccordionSection` widget test**

Tests (6 cases):

1. Renders year rows in descending order with counts.
2. Tapping a year expands an inline month grid (4 cols × 3 rows).
3. Tapping a month sets `setDateRange(start: DateTime(year, month, 1), end: DateTime(year, month+1, 0, 23, 59, 59))`.
4. Tapping the same month again clears the date range.
5. Empty buckets → empty-state caption.
6. `onOpenPicker` fires on "N years →" tap.

**Step 6: Implementation**

Structure:

```
Column(
  Row(label: 'When' + 'N years →' trailing button keyed 'when-section-search-more')
  if (years.isEmpty) → empty caption
  else ListView(shrinkWrap: true, physics: NeverScrollable, …)
    for year in years:
      ExpansionTile(
        title: Text('${year.year} (${year.count})'),
        children: [ MonthGrid(year: year.year, months: getMonthsForYear(...)) ]
      )
)
```

Make each ExpansionTile keyed `when-year-$year` and each month `when-month-$year-$month`.

**Step 7: Wire into DeepContent at `Key('deep-section-when')` and commit.**

---

### Task A8: `RatingStarsSection`

**Design:** 5 stars always rendered (memory `feedback_no_dynamic_rating_media_hiding.md` — never dim or hide stars positionally). Tapping a star sets rating 1–5; tapping the currently-selected rating clears it.

**Files:**

- `rating_stars_section.widget.dart`
- `rating_stars_section_test.dart`

**Step 1: Failing tests**

```dart
testWidgets('5 stars rendered always, regardless of suggestions', (tester) async { ... expect 5 star icons ... });
testWidgets('tap star 4 → setRating(4)', (tester) async { ... });
testWidgets('tap star 4 twice → rating cleared', (tester) async { ... });
testWidgets('active-indicator dot on filled stars only', (tester) async { ... verify icon type switch ... });
```

**Step 2: Implementation**

```dart
class RatingStarsSection extends ConsumerWidget {
  const RatingStarsSection({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(photosFilterProvider.select((f) => f.rating.rating?.toInt()));
    return Padding(padding: ..., child: Row([
      Text('filter_sheet_deep_rating_section'.tr(), ...),
      const Spacer(),
      for (int i = 1; i <= 5; i++)
        IconButton(
          key: Key('rating-star-$i'),
          icon: Icon(i <= (current ?? 0) ? Icons.star_rounded : Icons.star_outline_rounded),
          color: theme.colorScheme.primary,
          onPressed: () {
            HapticFeedback.selectionClick();
            ref.read(photosFilterProvider.notifier).setRating(current == i ? null : i);
          },
        ),
    ]));
  }
}
```

**Step 3–5: Run, wire, commit as usual.**

---

### Task A9: `MediaTypeSection` (segmented control)

**Design:** segmented control with All · Photos · Videos · Audio. All clears `mediaType`; each other segment sets `AssetType.{image,video,audio}` respectively.

**Files:** `media_type_section.widget.dart` + test.

**Tests:**

1. Four segments render with `'filter_sheet_deep_media_any'`, `'filter_sheet_media_photos'`, `'filter_sheet_media_videos'`, `'filter_sheet_media_audio'` labels.
2. Tapping Photos → `setMediaType(AssetType.image)`.
3. Tapping All → `setMediaType(null)`.
4. Current selection reflected visually (selected segment filled).

Use Flutter's `SegmentedButton<AssetType?>` for Material 3 compliance.

---

### Task A10: `TogglesSection`

Three `SwitchListTile.adaptive`s: Favourites / Archived / Not-in-album. Each calls the matching setter on the notifier.

Tests: each toggle flips independently; initial state reflects provider; tapping emits the expected `setFavouritesOnly`/`setArchivedIncluded`/`setNotInAlbum` call.

---

### Task A11: Section-spacing polish + `PageStorageKey` integration test

**Test:** retention — scroll DeepContent to a non-default offset, push a dummy route, pop, assert `ScrollPosition.pixels` retained. Use `MaterialPageRoute` with a simple `Scaffold` to simulate picker push/pop.

```dart
testWidgets('scroll offset retained across fullscreen push/pop', (tester) async {
  // Wrap DeepContent in a MaterialApp with a button that pushes a dummy route
  // Scroll to offset 300, push, pop, verify scrollController.offset ~ 300
});
```

Implementation: `PageStorageKey` is already set in Task A2. This task verifies the behavior end-to-end. If the test shows that the offset isn't retained, adjust — likely needs a `PageStorageBucket` parent inherited via `MaterialApp`.

---

### Task A12: Browse-to-Deep nav cue + drag-up wiring verification

The sheet already supports drag-up from Browse → Deep (PR 1.2 infra). Phase A adds a keyboard-accessible route: the Browse footer's `MatchCountFooter.Done` currently dismisses. We need a "Show all filters" button in Browse that sets `photosFilterSheetProvider` = `deep` — confirm this is wired.

**Verify** (no implementation change expected):

1. Drag the sheet from Browse with `tester.drag(...)` and assert `photosFilterSheetProvider` reaches `deep`.
2. If not wired, add a `TextButton('More filters')` in `BrowseContent` keyed `browse-see-all` that sets snap to deep.

**Test:** `filter_sheet_browse_to_deep_test.dart` — verifies the drag transition + any explicit "More filters" button.

---

### Task A13: Phase A sweep — delete `DeepStubContent`, run full suite

Final Phase A task. Removes the stub file and its test, verifies nothing references it, runs the full mobile test suite.

```bash
# Confirm no other file imports DeepStubContent
grep -r "deep_stub_content\|DeepStubContent" mobile/lib mobile/test
# Expected: no matches

rm mobile/lib/presentation/widgets/filter_sheet/deep_stub_content.widget.dart
# (there's no dedicated test for the stub; remove any test file if it exists)

cd mobile && flutter test
# Expected: all green
cd mobile && dart analyze
# Expected: no errors
cd mobile && dart format --set-exit-if-changed lib test
# Expected: exit 0
```

**Commit:**

```bash
git add -A mobile/
git commit -m "chore(mobile): remove DeepStubContent now that DeepContent is wired"
```

**Checkpoint: measure diff size.**

```bash
git diff --stat origin/main...HEAD -- mobile/ ':!mobile/openapi/**' ':!**/*.g.dart'
```

If >1500 lines: **stop**, open PR 1.3a covering Phases A only, wait for merge, then start a new branch for Phases B+C. Otherwise proceed to Phase B on the same branch.

---

# PHASE B — People overflow picker (Tasks B1–B7)

Scope: `PersonPickerPage`, route, sticky search, selected chips row, recent strip, alpha-grouped virtualised list, A–Z scrubber, wire Phase A's `onOpenPicker` to push the route.

**Files added:**

- `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart`
- `mobile/lib/presentation/pages/photos_filter/widgets/alpha_scrubber.widget.dart`
- `mobile/lib/providers/photos_filter/people_picker.provider.dart` — combines `driftGetAllPeopleProvider` (local Drift cache) with a text filter + alpha grouping. **No server paginated endpoint in Phase 1**; the mobile client already ships every person to local Drift, so client-side filter + alpha index is acceptable at 10K rows.
- Tests mirror each.

**Files modified:**

- `mobile/lib/routing/router.dart` — add `AutoRoute(page: PersonPickerRoute.page, ...)` entry; run `cd mobile && dart run build_runner build --delete-conflicting-outputs` to regenerate `router.gr.dart`.
- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` — pass a real `onOpenPicker: () => context.pushRoute(const PersonPickerRoute())` into `PeopleSectionDeep`.

---

### Task B1: Route declaration + empty page scaffold

**Files:**

- Create: `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart` with a minimal `@RoutePage()` scaffold.
- Modify: `mobile/lib/routing/router.dart` — add import + `AutoRoute(page: PersonPickerRoute.page, guards: [_authGuard, _duplicateGuard])`.
- Create: `mobile/test/presentation/pages/photos_filter/person_picker_test.dart`.

**Step 1: Failing test — route push renders empty scaffold with AppBar "Choose people"**

```dart
testWidgets('PersonPickerPage renders with title and back button', (tester) async {
  await tester.pumpConsumerWidget(const PersonPickerPage());
  expect(find.text('Choose people'), findsOneWidget);
  expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
});
```

**Step 2: Implement minimum scaffold + generate route**

```dart
@RoutePage()
class PersonPickerPage extends ConsumerWidget {
  const PersonPickerPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: Text('filter_sheet_picker_people_title'.tr())),
      body: const Center(child: CircularProgressIndicator()),
    );
  }
}
```

Add router entry, run `build_runner`:

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

Verify `router.gr.dart` includes `PersonPickerRoute`.

**Step 3: Run, commit.**

---

### Task B2: People source provider + alpha-bucket index

**Files:**

- Create: `mobile/lib/providers/photos_filter/people_picker.provider.dart`
- Create: `mobile/test/providers/photos_filter/people_picker_provider_test.dart`

**Step 1: Unit tests for ASCII-folded alpha bucketing (design §7 "Diacritics & non-Latin names", §9.1 "Alpha scrubber index")**

```dart
group('peopleAlphaIndex', () {
  test('ASCII first letter', () {
    final index = peopleAlphaIndex([_p('p1', 'Alice'), _p('p2', 'Bob')]);
    expect(index.keys, contains('A'));
    expect(index.keys, contains('B'));
  });

  test('diacritics fold to base letter', () {
    final index = peopleAlphaIndex([_p('p1', 'Ångström'), _p('p2', 'Østergaard'), _p('p3', 'Čapek')]);
    expect(index['A']!.first.id, 'p1');
    expect(index['O']!.first.id, 'p2');
    expect(index['C']!.first.id, 'p3');
  });

  test('non-Latin → #', () {
    final index = peopleAlphaIndex([_p('p1', '中村'), _p('p2', 'Алексей')]);
    expect(index['#']!.map((p) => p.id), containsAll(['p1', 'p2']));
  });

  test('empty name falls under #', () {
    final index = peopleAlphaIndex([_p('p1', '')]);
    expect(index['#']!.first.id, 'p1');
  });

  test('alpha-bucket preserves input order within a bucket', () { ... });
});

PersonDto _p(String id, String name) => PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '');
```

**Step 2: Implementation**

```dart
// people_picker.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:diacritic/diacritic.dart'; // already in pubspec.yaml — verify in B2 setup

final peoplePickerAllProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(driftGetAllPeopleProvider.future);
  // Map DriftPerson → PersonDto if the models differ; keep only named, non-hidden.
  return all.where((p) => !p.isHidden && p.name.isNotEmpty).map(_toPersonDto).toList();
});

final peoplePickerQueryProvider = StateProvider<String>((ref) => '');

final peoplePickerFilteredProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final query = ref.watch(peoplePickerQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return all;
  return all.where((p) => p.name.toLowerCase().contains(query)).toList();
});

Map<String, List<PersonDto>> peopleAlphaIndex(List<PersonDto> people) {
  final map = <String, List<PersonDto>>{};
  for (final p in people) {
    final first = p.name.isEmpty ? '#' : removeDiacritics(p.name).substring(0, 1).toUpperCase();
    final key = RegExp(r'^[A-Z]$').hasMatch(first) ? first : '#';
    map.putIfAbsent(key, () => []).add(p);
  }
  return map;
}
```

If `diacritic` package isn't in `pubspec.yaml`, add it: `cd mobile && flutter pub add diacritic`, commit the lockfile.

**Step 3: Run, commit.**

---

### Task B3: Sticky search bar + result count in PersonPickerPage

**Design §5.3 People picker:** sticky search bar with live match count.

**Test:**

- Typing updates `peoplePickerQueryProvider`.
- Match count reflects filtered list size.
- Clearing the query resets to full list.

**Implementation:** `TextField` inside a `SliverPersistentHeader`; count label `'$n people'` below it.

---

### Task B4: Selected chips row

Renders a horizontal strip of the currently-selected people's chips (from `photosFilterProvider.people`). Each chip has × to remove (calls `togglePerson` to remove via ID-matched record).

**Test:** 3 selected people render as 3 chips; tapping × removes one.

---

### Task B5: Recent strip (last-7-days people — mobile best-effort)

**Design §5.3:** "Recent strip (last 7 days)". The mobile Drift DB doesn't expose a direct "people added in last 7 days" query; if it's already available (check `driftPeopleServiceProvider`), use it. Otherwise, **ship Phase B without the Recent strip** and mark it as follow-up. Check the `DriftPeopleService` API before writing this task — if `getRecentPeople` or similar doesn't exist, skip and record in the PR description.

Test (if shipped): renders up to 7 people; empty list collapses the strip.

---

### Task B6: Alpha-grouped virtualised list + A–Z scrubber

**Files:**

- Create: `mobile/lib/presentation/pages/photos_filter/widgets/alpha_scrubber.widget.dart`
- Create: `mobile/test/presentation/pages/photos_filter/widgets/alpha_scrubber_test.dart`

**Tests:**

1. Scrubber shows A–Z + `#`, muted letters for empty buckets.
2. Tapping a letter jumps the list to that bucket's first entry (via `ScrollController.jumpTo`).
3. Drag across scrubber emits haptic feedback per letter crossed.
4. "Letter preview" bubble (48×48 overlay) appears during drag.
5. Scrubber hides in landscape / width < 480 pt (design §7 "Landscape").

**Implementation sketch:**

```dart
class AlphaScrubber extends StatefulWidget {
  final ScrollController controller;
  final Map<String, int> letterToIndex; // pre-computed letter → list index

  const AlphaScrubber({super.key, required this.controller, required this.letterToIndex});
  @override
  State<AlphaScrubber> createState() => _AlphaScrubberState();
}
```

State tracks current-drag letter, drives the preview bubble, calls `jumpTo` on each crossing. Use `GestureDetector.onPanUpdate` + `RenderBox.localToGlobal`/hit-test to map Y → letter (26+1 uniform bands).

---

### Task B7: Wire PersonPicker from PeopleSectionDeep

Replace the `onOpenPicker: null` with `onOpenPicker: () => context.pushRoute(const PersonPickerRoute())` in `DeepContent`. Delete the "Coming soon" SnackBar fallback in `PeopleSectionDeep`.

**Test:** widget test that taps the "Search N people →" button and expects `Navigator` to be pushed with `PersonPickerPage` (use `MockNavigatorObserver`).

```dart
testWidgets('Deep People section → Search opens PersonPickerPage', (tester) async {
  final observer = MockNavigatorObserver();
  // Build with MaterialApp(navigatorObservers: [observer], onGenerateRoute: …)
  // Tap the button
  // verify observer.didPush was called with a route whose widget is PersonPickerPage
});
```

Commit each picker sub-task (B1–B7) individually.

---

# PHASE C — When overflow picker (Tasks C1–C7)

Scope: `WhenPickerPage`, route, sticky search with year/decade parsing, quick-ranges row, decade anchor strip, year accordion with inline months, selection footer. Wire from `WhenAccordionSection.onOpenPicker`.

**Files added:**

- `mobile/lib/presentation/pages/photos_filter/when_picker.page.dart`
- `mobile/lib/providers/photos_filter/when_picker.provider.dart` — `whenPickerQueryProvider` (StateProvider<String>), `whenPickerParsedProvider` (derives a candidate year/decade/range from the query string). Reuses `timeBucketsProvider` + `temporal_utils.dart` from Phase A.
- Tests mirror each.

**Files modified:**

- `mobile/lib/routing/router.dart` — add `WhenPickerRoute`; regenerate `router.gr.dart`.
- `mobile/lib/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart` — pass real `onOpenPicker: () => context.pushRoute(const WhenPickerRoute())`.

---

### Task C1: Route + page scaffold

Mirror B1. Title `filter_sheet_picker_when_title` = 'Choose when'.

### Task C2: Query parser tests + provider

**Files:**

- `mobile/lib/providers/photos_filter/when_picker.provider.dart`
- `mobile/test/providers/photos_filter/when_picker_provider_test.dart`

**Unit tests for query parsing (design §11.2 open question: MVP = year or decade):**

```dart
test('parses 4-digit year', () {
  expect(parseWhenQuery('2024'), equals(const WhenQuery.year(2024)));
});
test('parses 2-digit decade suffix', () {
  expect(parseWhenQuery('20s'), equals(const WhenQuery.decade(2020)));
});
test('parses 4-digit decade', () {
  expect(parseWhenQuery('2020s'), equals(const WhenQuery.decade(2020)));
});
test('returns none for empty / garbage', () {
  expect(parseWhenQuery(''), equals(const WhenQuery.none()));
  expect(parseWhenQuery('apples'), equals(const WhenQuery.none()));
});
```

Implementation with a sealed `WhenQuery` class (or Dart 3 pattern-match enum).

### Task C3: Quick-ranges row

4 pills: Today / This week / This month / This year. Each sets the same `setDateRange` call as Browse's `WhenStrip`. Tests mirror existing `WhenStrip` preset tests.

### Task C4: Decade anchor strip

Renders only populated decades from `peekDecadesForYears(aggregateYears(buckets))`. Tapping a decade scrolls the year accordion to the decade's newest year.

### Task C5: Year accordion with inline month grids

Mirrors `WhenAccordionSection` from Phase A, but full-screen. Rich per-month visualization (4-col grid with fill-bar proportional to count) matching the web temporal picker. Reuses `aggregateYears` and `getMonthsForYear`.

Tests: tapping a year expands; tapping a month sets `setDateRange(year, month)`; tapping same month clears.

### Task C6: Selection footer

Shows current selection label (e.g., "November 2024") + small Done button that pops the route. Tests: label updates on selection; tap pops.

### Task C7: Wire WhenPicker from WhenAccordionSection

Replace `onOpenPicker: null` with `onOpenPicker: () => context.pushRoute(const WhenPickerRoute())` in `DeepContent`. Delete "Coming soon" fallback.

Widget test with `MockNavigatorObserver` parallels B7.

---

# Acceptance checklist (per §9.8 PR 1.3)

Run before opening PR:

- [ ] All `flutter test` passes (`cd mobile && flutter test`).
- [ ] `dart analyze` is clean.
- [ ] `dart format --set-exit-if-changed lib test` passes.
- [ ] Orphan reconciliation regression: a selected person ID NOT in the suggestions response is **not** removed from `photosFilterProvider.people` (covered in PR 1.1 tests — reverify by running `photos_filter_provider_test.dart`).
- [ ] Manual QA matrix:
  - [ ] Deep snap reachable by drag-up from Browse and by keyboard from BrowseContent.
  - [ ] All 7 sections render without overflow at 360pt width.
  - [ ] Scroll offset retained when pushing/popping a picker.
  - [ ] People picker opens; typing filters; alpha scrubber scrolls.
  - [ ] When picker opens; typing "2024" expands 2024 accordion; quick-range pills apply.
  - [ ] Done bar dismisses the sheet; Reset clears without dismissing.
  - [ ] Android system back from Deep pops to Browse (not hidden).
  - [ ] Light + dark theme render correctly (snapshot two sections manually).
  - [ ] Large text (Dynamic Type 150%) reflows without clipping (manually set system font scale).
- [ ] Localization: every new user-visible string is in `i18n/en.json` with `pnpm --filter=immich-i18n format:fix` applied.
- [ ] No `deep_stub_content.widget.dart` references remain.
- [ ] Diff size check: record `git diff --stat origin/main...HEAD -- mobile/ ':!mobile/openapi/**' ':!**/*.g.dart'` in the PR description for reviewer budgeting.

---

# Open questions recorded in the design but NOT addressed this PR

- Month-year parsing ("nov 2024", "11/2024") — Phase 1.5 if year-only proves insufficient (§11.2).
- Orphan-id reconciliation (`stillExists` echo) — deferred to Phase 1.5 (§7 post-audit).
- Camera filter — Phase 2.
- Tags + Places overflow pickers — Phase 2.
- Spaces-scoped filtering — Phase 3.

None of these block PR 1.3. Each is covered in the design doc.

---

# Execution handoff

At the end of this plan, ask the user which execution mode:

**1. Subagent-Driven (this session)** — dispatch fresh subagent per task, code review between tasks, fast iteration.
**2. Parallel Session (separate)** — open new session in this worktree with `superpowers:executing-plans`, batch execution with checkpoints.

Given the task count (~27) and Phase A / B / C natural boundaries, **option 1 is recommended** — per-task review catches regressions early and Phase A's checkpoint (Task A13 diff measurement) drives the split decision cleanly.
