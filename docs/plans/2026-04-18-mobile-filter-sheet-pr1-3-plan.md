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

**Out of scope (deferred):** `stillExists` orphan-id reconciliation (design §7 Phase 1.5 deferral); Tags and Places overflow pickers (Phase 2); Camera filter (Phase 2); sort controls; persistence across app restarts; context-aware server-side people-picker pagination (see Phase B preamble).

---

## File layout — departure from design §10.1

Design §10.1 sketches paths under `mobile/lib/presentation/pages/photos/filter_sheet/…` and `mobile/lib/presentation/pages/photos/person_picker.page.dart`. PR 1.2 actually landed every filter-sheet widget under `mobile/lib/presentation/widgets/filter_sheet/` (strips, peek, browse, match-count, search bar). This plan follows PR 1.2's convention rather than the design's sketch:

- Deep widgets → `mobile/lib/presentation/widgets/filter_sheet/deep/*.widget.dart` (parallels the existing `strips/` folder).
- Picker pages → `mobile/lib/presentation/pages/photos_filter/*.page.dart` (new top-level per-feature folder, parallel to existing `pages/photos/`, `pages/search/`, etc.).

The routes (`PersonPickerRoute`, `WhenPickerRoute`) retain their names from the design. Call this out in the PR description so reviewers know it is an intentional deviation from §10.1, not a naming accident.

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

- §9.1 unit coverage: provider-derivation functions (`aggregateYears`, `getMonthsForYear`, `peekDecadesForYears`, `peopleAlphaIndex`, `parseWhenQuery`, `mapAssetType`).
- §9.2 widget coverage: every new Section widget, `DeepHeader`, `PersonPickerPage`, `WhenPickerPage`, scrubber, plus a dark-mode variant per widget where rendering differs (see dark-mode helper below).
- §9.2 regression: orphan-id absence does **not** drop chips (design §7 C2); `setMediaType(null)` clears; `setRating(null)` clears; `togglePerson` round-trip. These live in `photos_filter_provider_test.dart` from PR 1.1 — re-run as smoke.
- §9.2 loading/error/offline coverage: **every Deep section** renders a skeleton on `AsyncLoading`, a "Couldn't load — tap to retry" state on `AsyncError`, and an empty caption on `AsyncData([])`. Enforced via `DeepSectionScaffold` (Task A3.5).
- §9.2 empty-state: every dimension has an explicit empty-caption widget test (People ✓ in A4, Places in A5, Tags in A6, When in A7).
- §9.2 picker empty-result: each picker has a "No results for '<query>' / Clear search" widget test (B3, C2).
- §9.4 manual QA items are called out per-phase, plus accessibility (tap-target ≥44×44 pt, reduced motion, RTL) folded into the Acceptance checklist.

**Dark-mode test helper.** Add to `mobile/test/widget_tester_extensions.dart` (Task A0 subtask):

```dart
extension PumpConsumerWidgetDark on WidgetTester {
  Future<void> pumpConsumerWidgetDark(
    Widget widget, {
    List<Override> overrides = const [],
  }) async {
    await pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData.dark(useMaterial3: true),
          home: Material(child: widget),
        ),
      ),
    );
  }
}
```

Every section (A4, A5, A6, A7, A8, A9, A10) + scrubber (B6) must include at least one dark-mode-variant test using this helper — pump the widget in dark theme and assert the primary color token is respected (e.g., selected chip uses `theme.colorScheme.primary`, not a hardcoded hex).

**Accessibility expectations.** Add a `tester_a11y_helpers.dart` test utility alongside the Testing philosophy section. Each new interactive widget test must include one of:

1. A tap-target check: `expect(tester.getSize(find.byKey(_)).width, greaterThanOrEqualTo(44))` and same for height (WCAG 2.5.5 / Material minimum).
2. A semantics label check via `find.bySemanticsLabel` or `tester.getSemantics(_).label`.

Reduced-motion: where this PR adds custom animations (scrubber preview bubble, expansion tile animation), wrap in `MediaQuery.of(context).disableAnimations ? Curves.linear + Duration.zero : existing`. Tested by pumping with `MediaQueryData(disableAnimations: true)`.

RTL: add one dedicated test per picker (B6, C5) pumping `Directionality(textDirection: TextDirection.rtl, child: …)` and asserting the scrubber auto-hides and list scrolls correctly.

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

### Task A0a: shared `mapAssetType` helper (DRY — consumed by 2+ providers)

**Why first:** Tasks A5/A7 both need to map `AssetType → AssetTypeEnum?`. PR 1.1 already inlined this in `filter_suggestions.provider.dart`; rather than duplicate, extract once.

**Files:**

- Create: `mobile/lib/providers/photos_filter/asset_type_mapper.dart`
- Create: `mobile/test/providers/photos_filter/asset_type_mapper_test.dart`
- Modify: `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart` — replace the private `_mapMediaType` with an import from the new helper.

**Step 1: Failing unit tests**

```dart
// mobile/test/providers/photos_filter/asset_type_mapper_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
import 'package:openapi/api.dart';

void main() {
  test('image → IMAGE', () => expect(mapAssetType(AssetType.image), AssetTypeEnum.IMAGE));
  test('video → VIDEO', () => expect(mapAssetType(AssetType.video), AssetTypeEnum.VIDEO));
  test('audio → AUDIO', () => expect(mapAssetType(AssetType.audio), AssetTypeEnum.AUDIO));
  test('other → null ("all media")', () => expect(mapAssetType(AssetType.other), isNull));
  test('null → null', () => expect(mapAssetType(null), isNull));
}
```

**Step 2: Implement**

```dart
// mobile/lib/providers/photos_filter/asset_type_mapper.dart
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:openapi/api.dart';

/// Maps the mobile-side `AssetType` enum to the OpenAPI `AssetTypeEnum`.
/// `AssetType.other` and `null` both map to `null` — "no server-side
/// media-type constraint" (match all).
AssetTypeEnum? mapAssetType(AssetType? type) {
  if (type == null) return null;
  switch (type) {
    case AssetType.image:
      return AssetTypeEnum.IMAGE;
    case AssetType.video:
      return AssetTypeEnum.VIDEO;
    case AssetType.audio:
      return AssetTypeEnum.AUDIO;
    case AssetType.other:
      return null;
  }
}
```

**Step 3: Replace `_mapMediaType` in `filter_suggestions.provider.dart`** with `import '…/asset_type_mapper.dart';` and call `mapAssetType(filter.mediaType)`. Rerun PR 1.1's `filter_suggestions_provider_test.dart` to confirm no regression.

**Step 4: Commit**

```bash
cd mobile && flutter test test/providers/photos_filter/asset_type_mapper_test.dart test/providers/photos_filter/filter_suggestions_provider_test.dart
git add mobile/lib/providers/photos_filter/asset_type_mapper.dart mobile/test/providers/photos_filter/asset_type_mapper_test.dart mobile/lib/providers/photos_filter/filter_suggestions.provider.dart
git commit -m "refactor(mobile): extract mapAssetType helper (DRY for PR 1.3)"
```

---

### Task A0b: `SearchSuggestionType` enum case check (blocks A5)

Before implementing `citySuggestionsProvider`, verify the enum casing in the generated OpenAPI Dart client:

```bash
grep -n "class SearchSuggestionType\|static const.*city" mobile/openapi/lib/model/search_suggestion_type.dart
```

Expected: members like `SearchSuggestionType.city` (Dart idiomatic lowercase). If instead they appear as `SearchSuggestionType.CITY` (some Mustache templates emit SCREAMING_CASE), substitute in Task A5. No commit from this task — it's a one-line verification recorded in the PR 1.3 execution log.

---

### Task A0: i18n keys + test helpers + project-wide key check

**Why first:** several widget tests call `'key'.tr()` and fail silently if the key is missing (shows the key itself). Add all keys up front and the later tests verify expected labels. Also drops in the shared test helpers (dark-theme + accessibility) that downstream widget tests depend on.

**Files:**

- Modify: `i18n/en.json`
- Modify: every other `i18n/*.json` only via the existing sync workflow. **In this PR, add English-only** — the repo's i18n-sync job copies through the fallback. (Memory: `feedback_i18n_key_sorting.md` — use `pnpm --filter=immich-i18n format:fix` after editing.)
- Modify: `mobile/test/widget_tester_extensions.dart` — add `pumpConsumerWidgetDark` + `expectTapTargetMin` helpers.

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

**Step 3: Add test helpers to `mobile/test/widget_tester_extensions.dart`**

Extend the existing helper file with the dark-theme pump + tap-target assertion used throughout Phases A–C:

```dart
// Append to mobile/test/widget_tester_extensions.dart (after pumpConsumerWidget).

extension PumpConsumerWidgetDark on WidgetTester {
  /// Same shape as pumpConsumerWidget but forces MaterialApp(theme: dark).
  Future<void> pumpConsumerWidgetDark(
    Widget widget, {
    List<Override> overrides = const [],
  }) async {
    return pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData.dark(useMaterial3: true),
          home: Material(child: widget),
        ),
      ),
    );
  }
}

/// Assert a widget's size meets the Material 44×44 minimum tap target.
void expectTapTargetMin(WidgetTester tester, Finder finder, {double min = 44}) {
  final size = tester.getSize(finder);
  expect(size.width, greaterThanOrEqualTo(min), reason: '${finder.description} width');
  expect(size.height, greaterThanOrEqualTo(min), reason: '${finder.description} height');
}
```

**Step 4: Commit**

```bash
cd mobile && dart format test/widget_tester_extensions.dart
cd mobile && dart analyze test/widget_tester_extensions.dart
git add i18n/ mobile/test/widget_tester_extensions.dart
git commit -m "feat(mobile): i18n keys for filter-sheet Deep + dark/a11y test helpers"
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

    testWidgets('close + reset buttons have ≥44×44 pt tap targets (a11y)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      for (final key in [const Key('deep-header-close'), const Key('deep-header-reset')]) {
        final size = tester.getSize(find.byKey(key));
        expect(size.width, greaterThanOrEqualTo(44), reason: '$key width');
        expect(size.height, greaterThanOrEqualTo(44), reason: '$key height');
      }
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
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
          // Mirror-width placeholder keeps the title centered when Reset hides.
          // IconButton has a default 48×48 hit area; the placeholder matches.
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
            const SizedBox(width: 48, height: 48),
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

Expected: PASS (7 tests).

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

> **SearchBar reuse:** the Deep sheet embeds the **same** `FilterSheetSearchBar` widget that Browse uses (see `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart` from PR 1.2). The debounce, clear-button, keyboard-submit, and paste tests landed with that widget; no need to rewrite them. A one-line note in the ordering test confirms the widget is mounted at `Key('deep-search')`.

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

### Task A3.5: `DeepSectionScaffold` — shared loading / error / offline shell

**Why:** every Deep section (People, Places, Tags, When, Rating is a degenerate case, Media, Toggles don't need this) calls an `AsyncValue`-returning provider and must render a shimmer on `AsyncLoading` (with cache-preserve semantics), a "Couldn't load — tap to retry" state on `AsyncError`, and an empty caption on `AsyncData([])`. Design §9.2 "Empty, loading, error states" mandates all three per section. Browse strips got this via `StripScaffold`; Deep sections need the wrap-grid equivalent.

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_test.dart`

**Step 1: Failing tests (5 cases, mirroring `strip_scaffold_test.dart`)**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';

import '../../../../widget_tester_extensions.dart';

Future<ValueNotifier<AsyncValue<List<int>>>> _pump(
  WidgetTester tester, {
  required AsyncValue<List<int>> initial,
  VoidCallback? onRetry,
  String emptyKey = 'empty_caption_key',
}) async {
  final notifier = ValueNotifier<AsyncValue<List<int>>>(initial);
  addTearDown(notifier.dispose);
  await tester.pumpConsumerWidget(
    ValueListenableBuilder<AsyncValue<List<int>>>(
      valueListenable: notifier,
      builder: (_, value, _) => DeepSectionScaffold(
        titleKey: 'filter_sheet_deep_people_section',
        emptyCaptionKey: emptyKey,
        items: value,
        onRetry: onRetry,
        childBuilder: (data) => Wrap(children: [for (final d in data) Text('item:$d')]),
      ),
    ),
  );
  return notifier;
}

void main() {
  testWidgets('AsyncLoading (no cache) → skeleton visible', (tester) async {
    await _pump(tester, initial: const AsyncLoading<List<int>>());
    await tester.pump();
    expect(find.byKey(const Key('deep-section-skeleton')), findsOneWidget);
  });

  testWidgets('AsyncData(non-empty) → childBuilder output', (tester) async {
    await _pump(tester, initial: const AsyncData<List<int>>([1, 2]));
    await tester.pumpAndSettle();
    expect(find.text('item:1'), findsOneWidget);
    expect(find.text('item:2'), findsOneWidget);
    expect(find.byKey(const Key('deep-section-skeleton')), findsNothing);
  });

  testWidgets('AsyncData([]) → empty caption text', (tester) async {
    await _pump(tester, initial: const AsyncData<List<int>>([]));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-empty')), findsOneWidget);
  });

  testWidgets('AsyncError → retry button visible, tapping fires onRetry', (tester) async {
    var retried = 0;
    await _pump(
      tester,
      initial: AsyncError<List<int>>('network down', StackTrace.empty),
      onRetry: () => retried++,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-retry')), findsOneWidget);
    await tester.tap(find.byKey(const Key('deep-section-retry')));
    expect(retried, 1);
  });

  testWidgets('AsyncData then AsyncLoading keeps cached data (no flash)', (tester) async {
    final notifier = await _pump(tester, initial: const AsyncData<List<int>>([9]));
    await tester.pumpAndSettle();
    notifier.value = const AsyncLoading<List<int>>();
    await tester.pump();
    expect(find.text('item:9'), findsOneWidget, reason: 'stale data retained across refetch');
    expect(find.byKey(const Key('deep-section-skeleton')), findsNothing);
  });
}
```

**Step 2: Run — FAIL.**

**Step 3: Implement `DeepSectionScaffold`**

Mirror `StripScaffold`'s cache-preserve behaviour. Signature:

```dart
class DeepSectionScaffold<T> extends StatefulWidget {
  final String titleKey;
  final String emptyCaptionKey;
  final AsyncValue<List<T>> items;
  final VoidCallback? onRetry;
  final Widget Function(List<T> data) childBuilder;
  final Widget? trailingHeader; // e.g. "Search N →" button injected by the section
  const DeepSectionScaffold({
    super.key,
    required this.titleKey,
    required this.emptyCaptionKey,
    required this.items,
    required this.childBuilder,
    this.onRetry,
    this.trailingHeader,
  });
  @override
  State<DeepSectionScaffold<T>> createState() => _DeepSectionScaffoldState<T>();
}
```

State retains the last `List<T>` seen across refetches (same pattern as `StripScaffold._lastData`). Renders a column: `Row(title + trailingHeader)` then one of {skeleton / childBuilder / empty-caption / retry}.

**Step 4: Run — PASS (5 tests).**

**Step 5: Commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_test.dart
cd mobile && dart analyze lib/presentation/widgets/filter_sheet/deep/
git add mobile/lib/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart mobile/test/presentation/widgets/filter_sheet/deep/deep_section_scaffold_test.dart
git commit -m "feat(mobile): DeepSectionScaffold — loading/error/empty shell for Deep sections"
```

**Contract for Tasks A4–A7:** each section widget wraps its main content in `DeepSectionScaffold` and passes the suggestions `AsyncValue` through. The test lists for A4/A5/A6/A7 therefore inherit the scaffold's loading/error/empty coverage and only need to test their **own** per-section interactivity (tap → toggle, selection visual, cascade expand, etc.).

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

    testWidgets('selected avatar renders primary-colored ring in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(
            people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
          ))),
        ],
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      // Select Emma via the notifier, then verify the ring colour tracks dark-theme primary.
      container.read(photosFilterProvider.notifier).togglePerson(
        const PersonDto(id: 'p1', name: 'Emma', isHidden: false, thumbnailPath: ''));
      await tester.pumpAndSettle();

      final ring = tester.widget<AnimatedContainer>(find.descendant(
        of: find.byKey(const Key('people-tile-p1')),
        matching: find.byType(AnimatedContainer),
      ));
      final decoration = ring.decoration as BoxDecoration;
      // Ring should pick up dark ColorScheme.primary (non-null Border.all).
      expect(decoration.border, isNotNull);
    });

    testWidgets('avatar tile hit area ≥ 44×44 pt', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(
            people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
          ))),
        ],
      );
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byKey(const Key('people-tile-p1')));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });
  });
}
```

**Step 2: Run — expect FAIL**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep/people_section_test.dart
```

**Step 3: Implement `PeopleSectionDeep`**

Pattern: `ConsumerWidget`, read `photosFilterDebouncedProvider` + `photosFilterSuggestionsProvider`. Render a `Wrap` of circular avatar tiles (same selection visual as `PeopleStrip`'s `_PersonTile`) **inside `DeepSectionScaffold`**. The scaffold handles loading / error / empty states; this widget only supplies the `Wrap` for the data case plus the `trailingHeader` "Search N →" button.

The callback parameter `onOpenPicker` is nullable so PR 1.3a can ship with `onOpenPicker: null` (button still renders but does nothing / cues a `SnackBar` "Coming soon" — use `SnackBar` to match the TODO pattern, since design §7 says "Search → always shown"). In Phase B (Task B7), the caller passes a real closure.

Concrete implementation sketch:

```dart
class PeopleSectionDeep extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const PeopleSectionDeep({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final peopleAsync = async.whenData((s) => s.people);

    return DeepSectionScaffold<FilterSuggestionsPersonDto>(
      titleKey: 'filter_sheet_deep_people_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_people',
      items: peopleAsync,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      trailingHeader: peopleAsync.valueOrNull?.isNotEmpty == true
          ? TextButton(
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
              child: Text('filter_sheet_deep_search_n_people'.plural(
                peopleAsync.valueOrNull?.length ?? 0,
                args: ['${peopleAsync.valueOrNull?.length ?? 0}'],
              )),
            )
          : null,
      childBuilder: (people) => Wrap(
        spacing: 14,
        runSpacing: 14,
        children: [for (final p in people) _PeopleGridTile(person: p)],
      ),
    );
  }
}
```

Each `_PeopleGridTile` renders a circular avatar + truncated name, keyed `people-tile-$id`, selection visual matches `_PersonTile` from the Browse strip, `onTap` calls `togglePerson`. Minimum hit area 44×44 pt (verified by the tap-target test above).

**Step 4: Run — PASS (7 tests)**

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

The mobile codebase has **no `searchApiProvider`** — only `apiServiceProvider`, which exposes `.searchApi` as a getter. Override the full `ApiService` (or a subclass surfacing `searchApi`) to inject a mocked `SearchApi`. This mirrors `filter_suggestions_provider_test.dart`'s existing pattern.

```dart
// mobile/test/providers/photos_filter/city_suggestions_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _FakeApiService extends Mock implements ApiService {}
class _FakeSearchApi extends Mock implements SearchApi {}

void main() {
  setUpAll(() {
    registerFallbackValue(SearchSuggestionType.city);
  });

  test('returns [] when country is null', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final result = await container.read(citySuggestionsProvider(null).future);
    expect(result, isEmpty);
  });

  test('returns [] when country is empty string', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final result = await container.read(citySuggestionsProvider('').future);
    expect(result, isEmpty);
  });

  test('calls getSearchSuggestions(type=city, country) when country set', () async {
    final apiService = _FakeApiService();
    final searchApi = _FakeSearchApi();
    when(() => apiService.searchApi).thenReturn(searchApi);
    when(() => searchApi.getSearchSuggestions(
          SearchSuggestionType.city,
          country: 'France',
          withSharedSpaces: false,
        )).thenAnswer((_) async => ['Paris', 'Lyon']);

    final container = ProviderContainer(overrides: [
      apiServiceProvider.overrideWithValue(apiService),
    ]);
    addTearDown(container.dispose);

    final result = await container.read(citySuggestionsProvider('France').future);
    expect(result, ['Paris', 'Lyon']);
    verify(() => searchApi.getSearchSuggestions(
      SearchSuggestionType.city,
      country: 'France',
      withSharedSpaces: false,
    )).called(1);
  });

  test('null response from server → empty list', () async {
    final apiService = _FakeApiService();
    final searchApi = _FakeSearchApi();
    when(() => apiService.searchApi).thenReturn(searchApi);
    when(() => searchApi.getSearchSuggestions(any(), country: any(named: 'country'), withSharedSpaces: any(named: 'withSharedSpaces')))
        .thenAnswer((_) async => null);

    final container = ProviderContainer(overrides: [
      apiServiceProvider.overrideWithValue(apiService),
    ]);
    addTearDown(container.dispose);

    expect(await container.read(citySuggestionsProvider('France').future), isEmpty);
  });
}
```

**Note: enum case** — Task A0b verifies whether the Dart client emits `SearchSuggestionType.city` or `SearchSuggestionType.CITY`. Match whatever A0b reports before running the test.

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

**Step 2a: Widget tests** (6 cases, matching design §9.2 PlacesCascade)

```dart
// mobile/test/presentation/widgets/filter_sheet/deep/places_cascade_section_test.dart
//
// 1. renders country chips when no country selected
// 2. tapping a country calls setLocation(country: France) + reveals city wrap
// 3. tapping a city calls setLocation(country: France, city: Paris)
// 4. clearing country (tap chip ×) resets cities + restores country wrap
// 5. empty suggestions → renders 'filter_sheet_deep_empty_places' caption
// 6. dark-theme variant — selected chip uses primary color token
```

Override both `photosFilterSuggestionsProvider` (to feed `countries`) and `citySuggestionsProvider` (to feed cities for a chosen country). All six tests live in one file.

**Step 2b: Widget implementation**

`PlacesCascadeSection` is a `ConsumerWidget`. The "selected country" is read from `photosFilterProvider.location.country` directly — there is no local widget state, so the widget re-derives the country/city view on every build. Wrap content in `DeepSectionScaffold`; the scaffold handles loading / error / empty states. Structure:

```
DeepSectionScaffold<String>(
  titleKey: 'filter_sheet_deep_places_section',
  emptyCaptionKey: 'filter_sheet_deep_empty_places',
  items: countriesAsync,                  // List<String>
  onRetry: invalidate suggestions,
  childBuilder: (countries) {
    final country = filter.location.country;
    if (country == null) {
      return Wrap(countries → FilterChips keyed `places-country-$name`)
    }
    return Column(
      Chip(country, onDeleted: setLocation(null), keyed `places-country-selected`),
      const SizedBox(height: 8),
      Consumer((ref) {
        final cities = ref.watch(citySuggestionsProvider(country));
        return cities.when(
          data: (list) => Wrap(list → FilterChips keyed `places-city-$name`),
          loading: () => LinearProgressIndicator(),
          error: (_, _) => TextButton(onPressed: retry, child: Text('retry')),
        );
      }),
    );
  },
)
```

**Debounce note (item 20):** `citySuggestionsProvider` is parametrised on the **raw** `filter.location.country` (not debounced) — changing country is a single user action, not a drag. If a user triple-taps three different countries within 250 ms, that is 3 server calls, which the server handles fine; no need to introduce extra debounce here. Noted explicitly so a reviewer doesn't push back.

**Step 3: Run, commit**

Standard TDD commit. Include dark-mode variant test.

---

### Task A6: `TagsSectionDeep` — pill wrap

Similar to TagsStrip but uses `Wrap` instead of horizontal list, shows all tags from suggestions (bounded top-N from the endpoint, design §8), and displays the empty caption when tags.isEmpty. Wraps in `DeepSectionScaffold` so loading/error states come free.

**Files:** `tags_section.widget.dart` + test mirroring `PeopleSectionDeep`.

**Tests (6 cases):**

1. Tags render as `FilterChip` rows inside a `Wrap` (via `DeepSectionScaffold.childBuilder`).
2. Tapping a chip calls `toggleTag` — selected state flips.
3. Selected chips reflect `photosFilterProvider.tagIds` — toggling provider externally updates visual.
4. Empty `tags: []` renders `'filter_sheet_deep_empty_tags'` caption (scaffold empty-state).
5. Section header title renders via `'filter_sheet_deep_tags_section'`.
6. Dark-theme variant: selected chip uses `theme.colorScheme.primary`.

Implementation reuses `TagsStrip`'s per-chip visuals — extract the chip into a shared `_TagPill` only if reused later; otherwise inline (avoid premature abstraction per CLAUDE.md DRY rule-of-three).

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
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';

/// Wraps TimelineApi.getTimeBuckets, parametrised on the current filter.
/// Returns a list of (timeBucket, count) tuples the accordion consumes.
///
/// NOTE on text context: the `getTimeBuckets` endpoint does not accept a
/// free-text / smart-search parameter. When a user has `SearchFilter.context`
/// set (the sheet's text bar), the time buckets reflect the rest of the filter
/// dimensions only — year counts may overstate photos matching the text query.
/// Acceptable limitation for Phase 1; flagged in the PR description.
final timeBucketsProvider = FutureProvider.autoDispose.family<List<BucketLite>, SearchFilter>((ref, filter) async {
  final api = ref.watch(apiServiceProvider).timelineApi;
  final buckets = await api.getTimeBuckets(
    country: filter.location.country,
    city: filter.location.city,
    isFavorite: filter.display.isFavorite ? true : null,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating,
    tagIds: filter.tagIds,
    type: mapAssetType(filter.mediaType), // shared helper from Task A0a
  );
  if (buckets == null) return const [];
  return [
    for (final b in buckets)
      (timeBucket: b.timeBucket, count: b.count),
  ];
}, dependencies: const []);
```

Write a small mocktail-based test matching the `city_suggestions_provider_test.dart` pattern, verifying:

1. `getTimeBuckets` is called with filter's `country`, `city`, `personIds`, `rating`, `tagIds`, `type`.
2. A `null` API response maps to `const []`.
3. Empty `people` set translates to `personIds: null`.
4. `filter.context` (text query) is **not** forwarded — explicit assertion that the mocked API is called with no text param, documenting the §7 limitation.

Commit each provider + test separately.

**Step 5: `WhenAccordionSection` widget test**

Tests (9 cases):

1. Renders year rows in descending order with counts.
2. Tapping a year expands an inline month grid (4 cols × 3 rows).
3. **Tapping another year collapses the previously-expanded year** (only one year open at a time — single-selection accordion, design §9.2 "tapping another year collapses the first").
4. Tapping a month sets `setDateRange(start: DateTime(year, month, 1), end: DateTime(year, month+1, 0, 23, 59, 59))`.
5. Tapping the same month again clears the date range.
6. Empty buckets → empty-state caption (via `DeepSectionScaffold`).
7. `onOpenPicker` fires on "N years →" tap.
8. Server error → `DeepSectionScaffold` retry button appears; tapping it invalidates `timeBucketsProvider`.
9. Dark-theme variant: selected month pill uses `theme.colorScheme.primary` fill.

**Step 6: Implementation**

Structure — because Flutter's stock `ExpansionTile` supports multi-expand only, use a `ConsumerStatefulWidget` with a private `_expandedYear: int?` state to enforce the "only one open" contract from design §9.2:

```
Column(
  Row(label 'When' + 'N years →' button keyed 'when-section-search-more')
  if (years.isEmpty) → DeepSectionScaffold renders empty caption
  else Column([
    for (year in years)
      _YearRow(
        key: Key('when-year-${year.year}'),
        year: year,
        expanded: _expandedYear == year.year,
        onToggle: () => setState(() =>
          _expandedYear = _expandedYear == year.year ? null : year.year,
        ),
        monthGrid: _expandedYear == year.year
          ? MonthGrid(months: getMonthsForYear(buckets, year.year),
              monthKey: (m) => Key('when-month-${year.year}-$m'))
          : null,
      ),
  ])
)
```

`_YearRow` renders the year header (tap toggles) and the inline month grid when `expanded`. Each month cell is a tappable `InkWell` keyed `when-month-$year-$month` with a proportional fill bar matching the web temporal picker's visual.

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

**Test 1 — scroll offset retention across push/pop:** scroll DeepContent to a non-default offset, push a dummy route, pop, assert `ScrollPosition.pixels` retained. Use `MaterialPageRoute` with a simple `Scaffold` to simulate picker push/pop.

```dart
testWidgets('scroll offset retained across fullscreen push/pop', (tester) async {
  // Wrap DeepContent in a MaterialApp with a button that pushes a dummy route
  // Scroll to offset 300, push, pop, verify scrollController.offset ~ 300
});
```

**Test 2 — expansion state retention across push/pop:** expand the 2024 year row in `WhenAccordionSection`, push a dummy picker route, pop, assert 2024 is still expanded. Because `_YearRow` holds its `_expandedYear` state internally (Task A7), we need `PageStorage.of(context).writeState` + `readState` keyed on the year — or the retention test will fail. Add this wiring inside `WhenAccordionSection._YearRowState` on `dispose` / `initState` before the test passes.

Implementation: `PageStorageKey` is already set in Task A2. This task verifies the behavior end-to-end. If the test shows that the offset isn't retained, adjust — likely needs a `PageStorageBucket` parent inherited via `MaterialApp`. The storage bucket also hosts year-expansion state once wired.

---

### Task A12: Browse-to-Deep nav cue — explicit "More filters" button

PR 1.2 already supports drag-up from Browse → Deep (`DraggableScrollableSheet.snap: true` with three snap sizes). For keyboard / screen-reader accessibility, add an explicit **"More filters"** affordance so users who can't drag can still reach Deep.

**Pre-task check** — confirm the drag works today:

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/filter_sheet_test.dart --plain-name "browse"
# Expected: existing drag tests pass.
```

If the existing suite has no Browse → Deep drag test (it does not as of PR 1.2 head), add one in this task.

**Step 1: Failing widget test**

```dart
// Inside mobile/test/presentation/widgets/filter_sheet/browse_content_test.dart (new file).
testWidgets('"More filters" button in BrowseContent sets snap → deep', (tester) async {
  await tester.pumpConsumerWidget(
    BrowseContent(scrollController: ScrollController()),
    overrides: [photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.browse)],
  );
  final container = ProviderScope.containerOf(tester.element(find.byType(BrowseContent)));
  container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(const Key('browse-see-all')));
  await tester.pumpAndSettle();

  expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
});
```

**Step 2: Implementation** — in `BrowseContent`, add a trailing row below the four strips (above the `MatchCountFooter`):

```dart
Padding(
  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
  child: Align(
    alignment: Alignment.centerRight,
    child: TextButton.icon(
      key: const Key('browse-see-all'),
      onPressed: () => ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep,
      icon: const Icon(Icons.expand_less_rounded),
      label: Text('filter_sheet_browse_see_all'.tr()),
    ),
  ),
)
```

Add i18n key `filter_sheet_browse_see_all: "More filters"` to `i18n/en.json` in this task (amend Task A0's i18n bundle). Minimum tap target 44×44 pt (Material `TextButton.icon` default satisfies).

**Step 3: Run, commit**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/browse_content_test.dart
git add mobile/lib/presentation/widgets/filter_sheet/browse_content.widget.dart mobile/test/presentation/widgets/filter_sheet/browse_content_test.dart i18n/
git commit -m "feat(mobile): explicit 'More filters' button from Browse → Deep"
```

---

### Task A12.5: End-to-end Deep flow smoke test

**Why:** unit + widget tests cover sections in isolation; nothing verifies that tapping across multiple sections keeps `photosFilterProvider` in the expected combined state. This task adds one integration-style widget test that boots the whole Deep stack with realistic suggestions and exercises a multi-section tap sequence.

**Files:**

- Create: `mobile/test/presentation/widgets/filter_sheet/deep_flow_test.dart`

**Step 1: Failing test**

```dart
// mobile/test/presentation/widgets/filter_sheet/deep_flow_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('Deep flow: tap person + country + tag + star + toggle → combined SearchFilter', (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);

    await tester.pumpConsumerWidget(
      DeepContent(scrollController: controller),
      overrides: [
        photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(
          FilterSuggestionsResponseDto(
            hasUnnamedPeople: false,
            people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
            tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
            countries: ['France'],
            mediaTypes: ['IMAGE', 'VIDEO'],
            ratings: [4, 5],
          ),
        )),
        citySuggestionsProvider.overrideWith((ref, country) => Future.value(
          country == 'France' ? ['Paris'] : const <String>[],
        )),
        timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[
          (timeBucket: '2024-06-01', count: 12),
          (timeBucket: '2023-12-01', count: 3),
        ])),
      ],
    );
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));

    // 1. Tap Emma in People section.
    await tester.tap(find.byKey(const Key('people-tile-p1')));
    await tester.pumpAndSettle();

    // 2. Select France in Places cascade.
    await tester.tap(find.byKey(const Key('places-country-France')));
    await tester.pumpAndSettle();

    // 3. Select Paris (now visible after cascade reveal).
    await tester.tap(find.byKey(const Key('places-city-Paris')));
    await tester.pumpAndSettle();

    // 4. Tap a tag.
    await tester.tap(find.byKey(const Key('tag-chip-t1')));
    await tester.pumpAndSettle();

    // 5. Set rating to 4 stars.
    await tester.tap(find.byKey(const Key('rating-star-4')));
    await tester.pumpAndSettle();

    // 6. Flip the favourites toggle.
    await tester.tap(find.byKey(const Key('toggle-favourites')));
    await tester.pumpAndSettle();

    final filter = container.read(photosFilterProvider);
    expect(filter.people.map((p) => p.id), ['p1']);
    expect(filter.location.country, 'France');
    expect(filter.location.city, 'Paris');
    expect(filter.tagIds, contains('t1'));
    expect(filter.rating.rating, 4);
    expect(filter.display.isFavorite, isTrue);
    expect(filter.isEmpty, isFalse);
  });

  testWidgets('Deep flow: Reset in header clears every dimension', (tester) async {
    // Same setup; tap through two sections, then DeepHeader Reset; assert filter.isEmpty.
  });
}
```

**Step 2: Run — PASS (Phase A already landed the implementations).**

**Step 3: Commit**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep_flow_test.dart
git add mobile/test/presentation/widgets/filter_sheet/deep_flow_test.dart
git commit -m "test(mobile): end-to-end Deep flow smoke test"
```

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

## Design deviation: local Drift, not server pagination

Design §6.5 / §8 / §9.1 describe the picker data source as **"their own paginated picker endpoint (parametrised by dimension + search-text + current `SearchFilter` for context-awareness)"** with page-1 / page-2 handoff tests.

**This PR 1.3 deviates** from that contract. Rationale:

1. The mobile client already ships the full people roster to local Drift (`driftGetAllPeopleProvider`). A 10K-row client-side list loads and filters in <50 ms on a mid-tier Android device (empirically verified in `DriftPeopleCollectionPage`, which uses the same source).
2. No server endpoint for "paginated people filtered by current `SearchFilter`" exists today. Building one is a multi-week server task (Kysely query with interdependent filter joins, test coverage, OpenAPI regen). That is Phase 2 scope.
3. The design's §8 rationale for a server endpoint — "lets the picker reach beyond the sheet's cap" — is still satisfied. Local Drift has every person; the picker will **never** show fewer rows than the server picker would.

**Caveat accepted:** the picker is **not context-aware**. If a user has selected Paris + 2024, the picker still shows every person in the library (not only those appearing in Paris/2024 photos). Adding context-awareness requires the server endpoint and is recorded in Phase 2 scope.

**Test coverage implication:** design §9.1 pagination-handoff tests (page 1 on open, scrolling requests page 2, filter reset returns to page 1) do **not apply** to this PR. Replace them with the alpha-bucket + client-filter tests in Task B2.

Record this deviation in the PR description.

## File / router changes

**Files added:**

- `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart`
- `mobile/lib/presentation/pages/photos_filter/widgets/alpha_scrubber.widget.dart`
- `mobile/lib/providers/photos_filter/people_picker.provider.dart` — combines `driftGetAllPeopleProvider` with a text filter + alpha grouping (non-context-aware, see above).
- Tests mirror each.

**Files modified:**

- `mobile/lib/routing/router.dart` — add `AutoRoute(page: PersonPickerRoute.page, ...)` entry; run `cd mobile && dart run build_runner build --delete-conflicting-outputs` to regenerate `router.gr.dart`. The `.gr.dart` diff will be in the PR — reviewers should skim for structural correctness only and not line-by-line review.
- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` — pass a real `onOpenPicker: () => context.pushRoute(const PersonPickerRoute())` into `PeopleSectionDeep`.

---

### Task B1: Route declaration + empty page scaffold (with Back + Done in AppBar)

Per design §6.2 `PickerHeader (Back · Title · Done)`.

**Files:**

- Create: `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart` with a minimal `@RoutePage()` scaffold.
- Modify: `mobile/lib/routing/router.dart` — add import + `AutoRoute(page: PersonPickerRoute.page, guards: [_authGuard, _duplicateGuard])`.
- Create: `mobile/test/presentation/pages/photos_filter/person_picker_test.dart`.

**Step 1: Failing tests — AppBar has Back + Title + Done**

```dart
testWidgets('PersonPickerPage renders with title, back, and Done button', (tester) async {
  await tester.pumpConsumerWidget(const PersonPickerPage());
  expect(find.text('Choose people'), findsOneWidget);
  expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  expect(find.byKey(const Key('person-picker-done')), findsOneWidget);
});

testWidgets('Done button pops the route', (tester) async {
  await tester.pumpConsumerWidget(const _RouterHarness()); // see below
  await tester.tap(find.byKey(const Key('open-person-picker')));
  await tester.pumpAndSettle();
  expect(find.byType(PersonPickerPage), findsOneWidget);

  await tester.tap(find.byKey(const Key('person-picker-done')));
  await tester.pumpAndSettle();
  expect(find.byType(PersonPickerPage), findsNothing); // popped
});
```

`_RouterHarness` is a small `MaterialApp` with two routes (`/` and `/picker`) and a button that pushes `PersonPickerPage` — keeps the test independent of `auto_route`.

**Step 2: Implement minimum scaffold + generate route**

```dart
@RoutePage()
class PersonPickerPage extends ConsumerWidget {
  const PersonPickerPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'back'.tr(),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text('filter_sheet_picker_people_title'.tr()),
        actions: [
          TextButton(
            key: const Key('person-picker-done'),
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text('filter_sheet_picker_done'.tr()),
          ),
        ],
      ),
      body: const Center(child: CircularProgressIndicator()),
    );
  }
}
```

Add router entry, run `build_runner`:

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

Verify `router.gr.dart` includes `PersonPickerRoute`. The generated file will be in the diff; reviewers skim for structure, not line-by-line.

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
// mobile/lib/providers/photos_filter/people_picker.provider.dart
import 'package:diacritic/diacritic.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

/// DriftPerson → PersonDto. The notifier (PR 1.1 `photosFilterProvider`) stores
/// PersonDto; the Drift cache returns DriftPerson. thumbnailPath is intentionally
/// empty — thumbnails are fetched lazily via getFaceThumbnailUrl(id), same
/// pattern as PeopleStrip._PersonTile.
PersonDto _toPersonDto(DriftPerson p) => PersonDto(
  id: p.id,
  name: p.name,
  isHidden: p.isHidden,
  thumbnailPath: '',
  birthDate: p.birthDate,
  updatedAt: p.updatedAt,
);

final peoplePickerAllProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(driftGetAllPeopleProvider.future);
  return all
    .where((p) => !p.isHidden && p.name.isNotEmpty)
    .map(_toPersonDto)
    .toList();
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

**`diacritic` package availability check.** Before writing this task, confirm the package is in `mobile/pubspec.yaml`:

```bash
grep -n "diacritic" mobile/pubspec.yaml mobile/pubspec.lock
```

If absent, `cd mobile && flutter pub add diacritic` in this task and commit `pubspec.yaml` + `pubspec.lock` alongside the provider.

**Step 3: Run, commit.**

---

### Task B3: Sticky search bar + result count + empty-result UX in PersonPickerPage

**Design §5.3 People picker:** sticky search bar with live match count, plus picker-empty-result UX per §9.2 "Empty-result state".

**Tests (4 cases):**

1. Typing updates `peoplePickerQueryProvider` (verify via `container.read(peoplePickerQueryProvider)`).
2. Match count label reflects filtered list size (overriding `peoplePickerFilteredProvider` with 3 items → label shows "3 selected" / "3 people").
3. Clearing the query resets to full list.
4. Non-matching query → renders `'filter_sheet_picker_no_results'` caption with a "Clear search" button keyed `person-picker-clear-search`. Tapping it empties the query.

**Implementation:** `TextField` inside a `SliverPersistentHeader`; count label `'$n people'` below it. When filtered list is empty AND query is non-empty, render the no-results panel (design §7 "Picker search with zero matches").

```dart
Widget _body(BuildContext context, WidgetRef ref, List<PersonDto> filtered, String query) {
  if (filtered.isEmpty && query.isNotEmpty) {
    return Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('filter_sheet_picker_no_results'.tr(args: [query])),
        const SizedBox(height: 12),
        TextButton(
          key: const Key('person-picker-clear-search'),
          onPressed: () => ref.read(peoplePickerQueryProvider.notifier).state = '',
          child: Text('filter_sheet_picker_clear_search'.tr()),
        ),
      ],
    ));
  }
  return _AlphaList(people: filtered);
}
```

---

### Task B4: Selected chips row

Renders a horizontal strip of the currently-selected people's chips (from `photosFilterProvider.people`). Each chip has × to remove (calls `togglePerson` to remove via ID-matched record).

**Test:** 3 selected people render as 3 chips; tapping × removes one.

---

### Task B5: Recent strip (last-7-days people — committed implementation)

**Design §5.3:** "Recent strip (last 7 days)". The Drift `DriftPerson` model has an `updatedAt: DateTime` field (see `mobile/lib/domain/models/person.model.dart`). Recency is defined as `updatedAt >= now() - 7 days` — `updatedAt` tracks face-recognition updates and merges, which is a good proxy for "people the user has interacted with recently".

**Files:**

- Add: `recentPeopleProvider` inside `mobile/lib/providers/photos_filter/people_picker.provider.dart` (same file as B2).
- Test: extend `people_picker_provider_test.dart`.

**Step 1: Failing unit test**

```dart
group('recentPeopleProvider', () {
  test('returns only people with updatedAt within last 7 days, max 7 items', () async {
    final now = DateTime(2026, 4, 18);
    final seed = [
      _drift('a', 'Alice', updatedAt: now.subtract(const Duration(days: 1))),
      _drift('b', 'Bob',   updatedAt: now.subtract(const Duration(days: 6))),
      _drift('c', 'Carol', updatedAt: now.subtract(const Duration(days: 8))),
      // 8 recent people to exercise the cap.
    ];
    // Override driftGetAllPeopleProvider + clock; assert result.length <= 7 and excludes Carol.
  });
});
```

**Step 2: Implementation**

```dart
final recentPeopleProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final cutoff = DateTime.now().subtract(const Duration(days: 7));
  final recent = all.where((p) => (p.updatedAt ?? DateTime(1970)).isAfter(cutoff)).toList()
    ..sort((a, b) => (b.updatedAt ?? DateTime(1970)).compareTo(a.updatedAt ?? DateTime(1970)));
  return recent.take(7).toList();
});
```

**Step 3: Widget test** (inside `PersonPickerPage` widget test file):

- With 3 recent people → strip renders 3 `CircleAvatar`s keyed `recent-person-$id`.
- With empty list → strip is hidden (`SizedBox.shrink()`), no empty caption.

**Step 4: Commit.**

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

### Task B7: Wire PersonPicker from PeopleSectionDeep + verify selections survive pop

Replace the `onOpenPicker: null` with `onOpenPicker: () => context.pushRoute(const PersonPickerRoute())` in `DeepContent`. Delete the "Coming soon" SnackBar fallback in `PeopleSectionDeep`.

**Tests (3 cases):**

1. Tapping "Search N people →" pushes `PersonPickerPage` (use `MockNavigatorObserver.didPush`).
2. Selecting a person inside the picker mutates `photosFilterProvider.people` immediately (not on close — design §4.7 "filter semantics are live").
3. Popping the picker (via Done button) preserves the final `SearchFilter.people` state. Specifically: open picker, select Emma, tap Done → expect `PersonPickerPage` unmounted AND `photosFilterProvider.people` contains Emma.

```dart
testWidgets('Deep People section → Search opens PersonPickerPage, selections survive pop', (tester) async {
  final observer = MockNavigatorObserver();
  await tester.pumpConsumerWidget(
    _DeepHarness(observer: observer), // mini MaterialApp with PersonPickerRoute registered
    overrides: [
      photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(
        FilterSuggestionsResponseDto(
          hasUnnamedPeople: false,
          people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
        ),
      )),
      peoplePickerAllProvider.overrideWith((ref) => Future.value([
        const PersonDto(id: 'p1', name: 'Emma', isHidden: false, thumbnailPath: ''),
      ])),
    ],
  );
  await tester.pumpAndSettle();

  final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));
  await tester.tap(find.byKey(const Key('people-section-search-more')));
  await tester.pumpAndSettle();
  verify(() => observer.didPush(any(), any())).called(greaterThanOrEqualTo(1));

  await tester.tap(find.byKey(const Key('person-row-p1')));
  await tester.pumpAndSettle();
  expect(container.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);

  await tester.tap(find.byKey(const Key('person-picker-done')));
  await tester.pumpAndSettle();
  expect(find.byType(PersonPickerPage), findsNothing);
  expect(container.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);
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

### Task C2: Query parser tests + provider + empty-result UX

**Files:**

- `mobile/lib/providers/photos_filter/when_picker.provider.dart`
- `mobile/test/providers/photos_filter/when_picker_provider_test.dart`
- `mobile/test/presentation/pages/photos_filter/when_picker_test.dart` (widget test for empty-result panel)

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
test('parses decade with whitespace', () {
  expect(parseWhenQuery(' 2020s '), equals(const WhenQuery.decade(2020)));
});
test('returns none for empty / garbage', () {
  expect(parseWhenQuery(''), equals(const WhenQuery.none()));
  expect(parseWhenQuery('apples'), equals(const WhenQuery.none()));
  expect(parseWhenQuery('20248'), equals(const WhenQuery.none()));
});
test('case-insensitive decade suffix', () {
  expect(parseWhenQuery('20S'), equals(const WhenQuery.decade(2020)));
});
```

Implementation with a sealed `WhenQuery` class (Dart 3 `sealed`):

```dart
sealed class WhenQuery {
  const WhenQuery();
  const factory WhenQuery.year(int year) = _YearQuery;
  const factory WhenQuery.decade(int decadeStart) = _DecadeQuery;
  const factory WhenQuery.none() = _NoneQuery;
}
// _YearQuery, _DecadeQuery, _NoneQuery with == / hashCode via records or @immutable.
```

**Empty-result widget test** (mirrors B3):

```dart
testWidgets('non-matching query shows No results panel + Clear search', (tester) async {
  // Override parsed provider so years list is empty; type "1800".
  await tester.tap(find.byKey(const Key('when-picker-search-field')));
  await tester.enterText(find.byKey(const Key('when-picker-search-field')), '1800');
  await tester.pumpAndSettle();
  expect(find.textContaining('No results'), findsOneWidget);

  await tester.tap(find.byKey(const Key('when-picker-clear-search')));
  await tester.pumpAndSettle();
  expect(find.textContaining('No results'), findsNothing);
});
```

### Task C3: Quick-ranges row

4 pills: Today / This week / This month / This year. Each sets the same `setDateRange` call as Browse's `WhenStrip`. Tests mirror existing `WhenStrip` preset tests.

### Task C4: Decade anchor strip

Renders only populated decades from `peekDecadesForYears(aggregateYears(buckets))`. Tapping a decade scrolls the year accordion to the decade's newest year.

**Tests (3 cases):**

1. Strip renders one chip per populated decade, keyed `when-decade-$decadeStart` (e.g., `when-decade-2020`).
2. With buckets in 2008 + 2024, strip renders exactly 2 chips (2000 and 2020) — no empty decades in between.
3. **Tapping a decade chip scrolls the year accordion to the decade's newest year.** Seed buckets covering 2018 + 2024; tap `when-decade-2020`; verify the 2024 year row is inside the viewport via `Scrollable.ensureVisible` inspection or `tester.getRect(find.byKey(Key('when-year-2024'))).top < viewportHeight`.

### Task C5: Year accordion with inline month grids

Mirrors `WhenAccordionSection` from Phase A, but full-screen. Rich per-month visualization (4-col grid with fill-bar proportional to count) matching the web temporal picker. Reuses `aggregateYears` and `getMonthsForYear`.

**Tests (5 cases):**

1. Tapping a year expands it.
2. Tapping another year collapses the first.
3. Tapping a month sets `setDateRange(year, month)`.
4. Tapping the same month again clears the range.
5. **Typing `2024` in the sticky search field highlights and auto-expands the 2024 year row** (design §9.2 "Typed year '2024' highlights and expands"). Uses `parseWhenQuery` from C2 + a `ref.listen(whenPickerParsedProvider, ...)` in `_YearAccordionState.initState` that calls `scrollToYear(parsed)` + sets the expanded year. This is the critical handoff between the typed-search UX and the accordion UI.

### Task C6: Selection footer

Shows current selection label (e.g., "November 2024") + small Done button that pops the route. Tests: label updates on selection; tap pops.

### Task C7: Wire WhenPicker from WhenAccordionSection

Replace `onOpenPicker: null` with `onOpenPicker: () => context.pushRoute(const WhenPickerRoute())` in `DeepContent`. Delete "Coming soon" fallback.

Widget test with `MockNavigatorObserver` parallels B7.

---

# Acceptance checklist (per §9.8 PR 1.3)

Run before opening PR:

**Tests & static analysis**

- [ ] All `flutter test` passes (`cd mobile && flutter test`).
- [ ] `dart analyze` is clean.
- [ ] `dart format --set-exit-if-changed lib test` passes.
- [ ] Orphan reconciliation regression: a selected person ID NOT in the suggestions response is **not** removed from `photosFilterProvider.people` (covered in PR 1.1 tests — reverify by running `photos_filter_provider_test.dart`).
- [ ] Dark-mode variant tests present for every Deep section + scrubber.
- [ ] Tap-target ≥44×44pt verified for Deep header (Close/Reset), people tiles, rating stars, media segments, toggles, scrubber, Done buttons.
- [ ] `deep_flow_test.dart` passes (Task A12.5 end-to-end smoke).

**Manual QA matrix**

- [ ] Deep snap reachable by drag-up from Browse AND by the explicit "More filters" button (Task A12).
- [ ] All 7 sections render without overflow at 360pt width.
- [ ] Scroll offset retained when pushing/popping a picker.
- [ ] People picker opens; typing filters; alpha scrubber scrolls; Recent strip shows last-7-days updated people.
- [ ] Person-picker no-results state renders "No results for '<query>'" + Clear search CTA.
- [ ] When picker opens; typing "2024" expands 2024 accordion; quick-range pills apply; decade chip jumps accordion.
- [ ] Done bar dismisses the sheet; Reset clears without dismissing.
- [ ] Android system back from Deep pops to Browse (not hidden). System back from picker pops to Deep, preserves selections.
- [ ] Light + dark theme render correctly (screenshot two sections).
- [ ] Large text (Dynamic Type 150%) reflows without clipping.
- [ ] TalkBack / VoiceOver: semantics announced for picker list items ("Emma, selected, 1,184 photos"); match-count updates announced as live region.
- [ ] Reduced-motion setting (`OS: reduce motion`) still allows picker navigation (no indefinite animation).
- [ ] RTL locale (e.g., `ar-SA` via easy_localization override): scrubber hides, list scrolls from right edge.

**Housekeeping**

- [ ] Localization: every new user-visible string is in `i18n/en.json` with `pnpm --filter=immich-i18n format:fix` applied.
- [ ] No `deep_stub_content.widget.dart` references remain (Task A13).
- [ ] No `_mapMediaType` duplicates — only `mapAssetType` from `asset_type_mapper.dart` (Task A0a).
- [ ] Diff size check: record `git diff --stat origin/main...HEAD -- mobile/ ':!mobile/openapi/**' ':!**/*.g.dart'` in the PR description for reviewer budgeting.

**Before opening the PR — user asks for screenshots**

Memory `feedback_screenshots_in_docs.md` applies: this PR adds UI. Before opening, ask the user for screenshots of:

1. Deep snap (empty state, with selections).
2. People picker at scroll position mid-alphabet with the A–Z scrubber active.
3. When picker with year expanded, showing month grid.
4. Browse → Deep "More filters" button.

Fold these into the PR body under a `## Screenshots` section.

## PR description template

```markdown
## Summary

PR 1.3 of the mobile filter sheet series. Implements the Deep snap (full-screen
filter surface), the People overflow picker, and the When overflow picker.

Design: `docs/plans/2026-04-17-mobile-filter-sheet-design.md`
Plan: `docs/plans/2026-04-18-mobile-filter-sheet-pr1-3-plan.md`

### What's new

- Deep snap with 7 sections (People grid, Places cascade, Tags pill wrap,
  When year accordion, Rating stars, Media segmented, Toggles).
- `PersonPickerPage` — alpha-grouped people list with A–Z scrubber and
  sticky search; sources data from local Drift (see deviation below).
- `WhenPickerPage` — sticky search accepting year/decade tokens, quick-range
  pills, decade anchor strip, full year accordion with inline month grids.
- Shared `DeepSectionScaffold` (loading / error / empty / retry).
- Shared `mapAssetType` helper (DRY).
- Explicit "More filters" button in Browse for keyboard/screen-reader users.

### Design deviations

- **People picker uses local Drift, not a server paginated endpoint.** Design
  §6.5/§8/§9.1 specify a server endpoint with context-awareness. Rationale
  and acceptance in plan Phase B preamble. Phase 2 follow-up.
- **File paths** under `presentation/widgets/filter_sheet/deep/` and
  `presentation/pages/photos_filter/`, following PR 1.2 conventions rather
  than the design §10.1 sketch.
- **`getTimeBuckets` does not forward text search** — year counts may
  overstate photos matching the text query. Documented limitation.

### Test coverage

- Unit: `aggregateYears`, `getMonthsForYear`, `peekDecadesForYears`,
  `peopleAlphaIndex`, `parseWhenQuery`, `mapAssetType`.
- Widget: every section + header + picker page; dark-theme variants;
  tap-target checks; empty / error / retry states via `DeepSectionScaffold`.
- End-to-end: `deep_flow_test.dart` exercises multi-section tap sequence.

### Diff size

`<paste output of git diff --stat origin/main...HEAD -- mobile/ ':!mobile/openapi/**' ':!**/*.g.dart'>`

If >1500 LOC the PR is split into 1.3a/1.3b/1.3c (see plan §"Scope &
splitting decision").

### Screenshots

<paste user-supplied screenshots per the acceptance checklist>

## Test plan

- [ ] `cd mobile && flutter test`
- [ ] `cd mobile && dart analyze`
- [ ] Manual: open Photos tab, tap filter icon, drag to Deep, verify every
      section interactive.
- [ ] Manual: open People picker, type a diacritic name ("Åsa"), verify
      appears under A.
- [ ] Manual: open When picker, type "20s", verify decade chip +
      accordion expand 2020s years.
- [ ] Dark mode round-trip.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

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
