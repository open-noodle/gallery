# Mobile Filter Parity — Slice 4: Places picker + cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 4 row; "BDD — Slice 4: Places", note the corrected search scenario: search filters countries + already-loaded cities, NO proactive city fetch; "UI anatomy → Places picker" `#mockup-places-picker`).

**Goal:** Add a full-screen **Places picker** (countries listed upfront from suggestions; cities lazy-loaded per country ONLY on expand; single-select; search filters countries + already-loaded cities). Cap the Places deep section + browse strip and wire a "Search N places →" affordance to the new picker.

**Architecture:** New `@RoutePage() PlacesPickerPage` mirroring `when_picker.page.dart` (a single-expand accordion: countries → lazily-loaded city radios). New `places_picker.provider.dart` (query + filtered countries). Register `AutoRoute(page: PlacesPickerRoute.page, ...)` in `router.dart` then regenerate `router.gr.dart` via `mise run codegen`. Add `onOpenPicker` + a capped country Wrap + "Search N places →" trailing to `PlacesCascadeSection`; wrap Places in `deep_content` in a `Builder` that pushes `PlacesPickerRoute`; cap the browse strip + trailing tile.

**Tech Stack:** Flutter 3.44.1, `hooks_riverpod`, `auto_route` (+ build_runner codegen), `easy_localization`. Tests: `pumpConsumerWidget` + a `RootStackRouter` harness for navigation.

## Global Constraints

- Package `package:immich_mobile/...`; Flutter 3.44.1 via `mise exec --`; CI `dart analyze --fatal-infos` over lib AND test.
- **Route codegen (critical):** `lib/routing/router.gr.dart` is committed and generated. After adding the route to `router.dart`, run from `mobile/`: `mise run codegen` (= `dart run build_runner build --delete-conflicting-outputs` then `dart format lib/routing/router.gr.dart`). NEVER hand-edit `router.gr.dart`. Commit both `router.dart` and the regenerated `router.gr.dart` together.
- **Single-select** location via `ref.read(photosFilterProvider.notifier).setLocation(...)`: a whole `SearchLocationFilter` replaces the location each call; `setLocation(null)` clears. Country pick = `setLocation(SearchLocationFilter(country: c))`; city pick = `setLocation(SearchLocationFilter(country: c, city: city))`.
- **Cities fetch ONLY on expand** (`citySuggestionsProvider(country)`), never proactively on search (honors the user's "no network call unless the user acts" directive — intentional divergence from web fetch-all-on-search).
- Countries come free from `photosFilterSuggestionsProvider(...).countries` (List<String>, no counts). Do NOT show country/city counts.
- Slice 4 must NOT change collapse (Slice 1), visibility (Slice 2), People (Slice 3), Tags, or Camera.
- Deep-section "Search N places →" affordance goes in the section header `trailingHeader` (mirroring People/When's existing pattern) — People moved theirs to a body row in Slice 3, but Places/When keep the header trailing button (this matches the current When section; the mockup's body-row treatment is a People-specific detail). Keep the Slice-1 chevron + empty→"(0)".
- Worktree branch `worktree-mobile-filter-parity`. No trailers.

## Baseline

Slices 1–3 complete: 469 tests green, `dart analyze lib test` clean. `citySuggestionsProvider`, `PlacesCascadeSection`, `PlacesStrip`, `setLocation` all exist (see facts in the Slice 4 research; anchors below).

## File Structure

**Create:**

- `mobile/lib/presentation/pages/photos_filter/places_picker.page.dart` — `@RoutePage() PlacesPickerPage` (AppBar back/Places/Done; CustomScrollView: search header + country accordion).
- `mobile/lib/presentation/pages/photos_filter/widgets/places_picker_search_header.widget.dart` — pinned search header (mirror `when_picker_search_header.widget.dart`, hint "Search country or city…").
- `mobile/lib/presentation/pages/photos_filter/widgets/places_picker_country_accordion.widget.dart` — the countries→cities single-expand accordion (mirror `when_picker_year_accordion.widget.dart`).
- `mobile/lib/providers/photos_filter/places_picker.provider.dart` — `placesPickerQueryProvider` + `placesPickerCountriesProvider`.
- Tests: `places_picker_test.dart`, `places_picker_country_accordion_test.dart`, `places_picker_provider_test.dart`, `places_strip_test.dart` (new), extend `places_cascade_section_test.dart`.

**Modify:**

- `mobile/lib/routing/router.dart` (import + `AutoRoute`), then regenerate `router.gr.dart`.
- `mobile/lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart` (add `onOpenPicker`, trailing "Search N places →", cap country Wrap).
- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` (wrap Places in `Builder` → `PlacesPickerRoute`).
- `mobile/lib/presentation/widgets/filter_sheet/strips/places_strip.widget.dart` (cap + trailing tile).
- `i18n/en.json` (+ `filter_sheet_deep_search_n_places` {one/other}, `filter_sheet_picker_places_title`, `filter_sheet_picker_search_places_hint`).

---

### Task 1: i18n keys

**Files:** Modify `i18n/en.json`.

- [ ] **Step 1:** Add (alphabetical position within `filter_sheet_*`), mirroring the existing `filter_sheet_deep_search_n_people` plural + `filter_sheet_picker_when_title`/`filter_sheet_picker_search_when_hint`:

```json
"filter_sheet_deep_search_n_places": { "one": "Search {count} place →", "other": "Search {count} places →" },
"filter_sheet_picker_places_title": "Places",
"filter_sheet_picker_search_places_hint": "Search country or city…",
```

(Confirm exact existing plural JSON shape by reading the `filter_sheet_deep_search_n_people` entry, and match it — nested object with `one`/`other` and `{count}`.)

- [ ] **Step 2: Regenerate** (keys are gitignored generated code):

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart
```

- [ ] **Step 3: Commit**

```bash
git add ../i18n/en.json
git commit -m "feat(mobile-filter): add places-picker i18n keys (slice 4)"
```

---

### Task 2: `places_picker.provider.dart`

**Files:** Create `mobile/lib/providers/photos_filter/places_picker.provider.dart`; Test `mobile/test/providers/photos_filter/places_picker_provider_test.dart`.

**Interfaces:** `placesPickerQueryProvider = StateProvider<String>((ref) => '')`; `placesPickerCountriesProvider = Provider.autoDispose<AsyncValue<List<String>>>` (or a plain derived provider) that returns the suggestion countries filtered by the (case-insensitive, trimmed) query. Read countries from `photosFilterSuggestionsProvider(ref.watch(photosFilterDebouncedProvider))` → `.whenData((s) => s.countries)`.

- [ ] **Step 1: Write failing test.** Mirror `people_picker_provider_test.dart` structure: `ProviderContainer` overriding `photosFilterSuggestionsProvider` (and `photosFilterDebouncedProvider` if needed) to yield countries `['France','Spain','Finland']`. Assert: empty query → all 3; query `'fr'` → `['France']`; query `'in'` → `['Spain','Finland']` (substring, case-insensitive). Read the existing people provider test to match the exact override syntax for `photosFilterSuggestionsProvider`.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**

```dart
// mobile/lib/providers/photos_filter/places_picker.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';

final placesPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

/// Countries from the filter suggestions, filtered by the picker query.
/// Cities are NOT fetched here — only when a country is expanded in the picker.
final placesPickerCountriesProvider = Provider.autoDispose<AsyncValue<List<String>>>((ref) {
  final filter = ref.watch(photosFilterDebouncedProvider);
  final suggestions = ref.watch(photosFilterSuggestionsProvider(filter));
  final query = ref.watch(placesPickerQueryProvider).trim().toLowerCase();
  return suggestions.whenData((s) {
    final countries = s.countries;
    if (query.isEmpty) return countries;
    return countries.where((c) => c.toLowerCase().contains(query)).toList();
  });
});
```

(Verify the exact provider names `photosFilterDebouncedProvider` / `photosFilterSuggestionsProvider` and that `.countries` is `List<String>` by reading the imports used in `places_cascade_section.widget.dart`.)

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/providers/photos_filter/places_picker.provider.dart test/providers/photos_filter/places_picker_provider_test.dart
git add -A && git commit -m "feat(mobile-filter): places picker query+countries providers (slice 4)"
```

---

### Task 3: `PlacesPickerPage` + accordion + route (with codegen)

**Files:** Create `places_picker.page.dart`, `places_picker_country_accordion.widget.dart`, `places_picker_search_header.widget.dart`; Modify `router.dart` (+ regen `router.gr.dart`); Tests: `places_picker_test.dart`, `places_picker_country_accordion_test.dart`.

**Interfaces:** `@RoutePage() class PlacesPickerPage extends ConsumerStatefulWidget` → auto_route generates `PlacesPickerRoute`. AppBar: back `IconButton(Icons.arrow_back_rounded, tooltip: 'back'.tr(), onPressed: () => context.maybePop())`, `title: Text('filter_sheet_picker_places_title'.tr())`, actions `[TextButton(key: Key('places-picker-done'), onPressed: () => context.maybePop(), child: Text('filter_sheet_picker_done'.tr()))]`. Body: `CustomScrollView` with the pinned search header + the country accordion sliver. The accordion: for each country in `placesPickerCountriesProvider`, an `InkWell` row (`Key('places-picker-country-<country>')`) with name + expand chevron; single-expand state `String? _expandedCountry`; when expanded, `ref.watch(citySuggestionsProvider(country))` → `.when(data: radios, loading: LinearProgressIndicator, error: retry)`, city rows `Key('places-picker-city-<city>')` as radios; selection writes `setLocation(...)` (single-select) and the currently-selected country/city (from `photosFilterProvider`) shows selected.

- [ ] **Step 1: Read the mirrors.** Read `when_picker.page.dart`, `when_picker_year_accordion.widget.dart`, `when_picker_search_header.widget.dart`, and `person_picker.page.dart` to copy the exact Scaffold/AppBar/CustomScrollView/search-header/accordion idioms. Read `places_cascade_section.widget.dart`'s `_CityCascade` for the `citySuggestionsProvider(country).when(...)` loading/error handling to reuse.

- [ ] **Step 2: Write failing widget tests** (`places_picker_test.dart`, `places_picker_country_accordion_test.dart`) using `pumpConsumerWidget` with overrides for `placesPickerCountriesProvider` (or `photosFilterSuggestionsProvider`) and `citySuggestionsProvider`:
  - Renders AppBar title "Places" + `places-picker-done`.
  - Renders a row per country (`places-picker-country-France` etc.).
  - Tapping a country expands it → `citySuggestionsProvider('France')` is read and city radios (`places-picker-city-Paris`) appear; a second country's cities are NOT fetched (only-on-expand — assert the override for the un-expanded country was not invoked, or that its cities are absent).
  - Tapping a city calls `setLocation(country: France, city: Paris)` — assert via a `ProviderContainer` read of `photosFilterProvider.location` OR that the radio shows selected. (Use the People/When picker tests' assertion style.)
  - Search: set `placesPickerQueryProvider` to `'fr'` → only France row shows.

- [ ] **Step 3: Run → RED** (page/widgets/route don't exist).

- [ ] **Step 4: Implement** the three widgets (mirror the When picker). Then register the route: in `router.dart` add `import '.../places_picker.page.dart';` and `AutoRoute(page: PlacesPickerRoute.page, guards: [_authGuard, _duplicateGuard]),` next to the other picker routes.

- [ ] **Step 5: Regenerate the router** (REQUIRED — `PlacesPickerRoute` doesn't exist until codegen):

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
mise run codegen
```

Confirm `git diff --stat lib/routing/router.gr.dart` shows the new `PlacesPickerRoute` added.

- [ ] **Step 6: Run → GREEN** (widget tests pass; the page compiles with the generated route).

- [ ] **Step 7: Analyze & commit** (include the regenerated router)

```bash
mise exec -- dart analyze lib/presentation/pages/photos_filter/ lib/routing/router.dart test/presentation/pages/photos_filter/places_picker_test.dart test/presentation/pages/photos_filter/widgets/places_picker_country_accordion_test.dart
git add lib/presentation/pages/photos_filter/places_picker.page.dart lib/presentation/pages/photos_filter/widgets/places_picker_country_accordion.widget.dart lib/presentation/pages/photos_filter/widgets/places_picker_search_header.widget.dart lib/routing/router.dart lib/routing/router.gr.dart test/presentation/pages/photos_filter/places_picker_test.dart test/presentation/pages/photos_filter/widgets/places_picker_country_accordion_test.dart
git commit -m "feat(mobile-filter): add Places picker page + route (slice 4)"
```

---

### Task 4: Cap the Places deep section + wire the picker

**Files:** Modify `places_cascade_section.widget.dart`, `deep_content.widget.dart`; Test: extend `places_cascade_section_test.dart`.

**Interfaces:** `PlacesCascadeSection` gains `final VoidCallback? onOpenPicker;` (like `PeopleSectionDeep`). Its `DeepSectionScaffold<String>` gains `trailingHeader:` = a `TextButton(key: Key('places-section-search-more'), onPressed: onOpenPicker, child: Text(_searchMorePlacesLabel(count)))` when `count > 0` (count = countries length). The `_CountryWrap` caps to the first 10 countries (keep the selected country pinned if beyond 10). `deep_content` wraps Places in a `Builder` with `onOpenPicker: () => context.pushRoute(const PlacesPickerRoute())`.

- [ ] **Step 1: Write failing tests** (extend `places_cascade_section_test.dart`):
  - Given 15 countries, none selected → at most 10 `places-country-*` chips render + a `places-section-search-more` trailing button; tapping it fires `onOpenPicker`.
  - Given the selected country is the 12th → it is still shown (pinned) even beyond the cap.
  - ≤10 countries → all shown, no over-cap.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**
  - Add `onOpenPicker` param + `_searchMorePlacesLabel(int count)` (mirror `_searchMoreLabel` using `filter_sheet_deep_search_n_places`).
  - Add `trailingHeader:` to the scaffold when `countries.isNotEmpty`.
  - In `_CountryWrap`, cap: `final display = [...countries.take(10), if (selectedCountry != null && !countries.take(10).contains(selectedCountry) && countries.contains(selectedCountry)) selectedCountry];` render chips over `display`. (Keep the existing FilterChip onSelected logic.)
  - In `deep_content.widget.dart`, change the Places entry (currently `const PlacesCascadeSection(key: Key('deep-section-places'))`) to a `Builder`-wrapped `PlacesCascadeSection(key: ..., onOpenPicker: () => context.pushRoute(const PlacesPickerRoute()))` (mirror the People/When entries). `PlacesPickerRoute` is available after Task 3's codegen.

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart lib/presentation/widgets/filter_sheet/deep_content.widget.dart test/presentation/widgets/filter_sheet/deep/places_cascade_section_test.dart
git add -A && git commit -m "feat(mobile-filter): cap places section + wire picker (slice 4)"
```

---

### Task 5: Cap the Places browse strip + trailing tile

**Files:** Modify `places_strip.widget.dart`; Test: create `mobile/test/presentation/widgets/filter_sheet/strips/places_strip_test.dart` (none exists) — mirror the People strip test added in Slice 3 (`strips_test.dart` `PeopleStrip` group) including its `RootStackRouter` navigation harness.

**Interfaces:** The strip renders at most 10 `place-tile`s + a trailing `Key('places-strip-more')` "+N" tile (when `> 10`) that `context.pushRoute(const PlacesPickerRoute())`.

- [ ] **Step 1: Write failing tests** — given 15 countries → ≤10 tiles + `places-strip-more` present, tapping navigates to `PlacesPickerPage` (reuse Slice 3's RootStackRouter harness pattern from the people strip test); ≤10 → no more-tile.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement** — cap `itemCount` in the `ListView.separated`, add the trailing "+N" tile with `context.pushRoute(const PlacesPickerRoute())` (+ router import). Mirror the People strip's Slice-3 implementation.

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/strips/places_strip.widget.dart test/presentation/widgets/filter_sheet/strips/places_strip_test.dart
git add -A && git commit -m "feat(mobile-filter): cap places browse strip + more tile (slice 4)"
```

---

### Task 6: Full green + analyze + reconcile

- [ ] **Step 1: Run**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/
```

- [ ] **Step 2: Fix any breakage**, preserving intent (e.g. `deep_content` tests that assert the Places section now expect a `Builder` wrapper; `places_cascade_section_test` empty/selected cases).

- [ ] **Step 3: Re-run until green** — Expected: **All tests passed!** (≥ 469 + Slice 4's new tests).

- [ ] **Step 4: Full analyze gate** — `mise exec -- dart analyze lib test` → `No issues found!`

- [ ] **Step 5: Commit** — `git add -A && git commit -m "test(mobile-filter): reconcile places picker/section/strip (slice 4)"`

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 4 BDD):** capped single-select preview (T4), countries load no-fetch (T2/T3), cities lazy on expand (T3), search filters countries + loaded cities / no proactive fetch (T2/T3, per corrected spec), selecting a city selects its country (T3), selecting country only (T3), single-select replaces prior (T3, `setLocation` semantics), per-country fetch error (T3, `citiesAsync.when` error branch), Done applies (T3). Mockup `#mockup-places-picker` (nav bar, search, COUNTRIES bucket, country rows + expand chevron, indented city radios) reproduced (T3). Cap deep + strip (T4/T5).
- **Route codegen** is an explicit step (T3 Step 5, `mise run codegen`) and both `router.dart` + `router.gr.dart` are committed together.
- **Placeholder scan:** "read the mirror" notes point to concrete files (when*picker.*, person*picker.*, \_CityCascade) for exact idioms — not TODOs; the novel logic (cap, single-select, lazy-on-expand, query filter) has concrete code/specs.
- **Type consistency:** `PlacesPickerRoute`, `placesPickerQueryProvider`, `placesPickerCountriesProvider`, `onOpenPicker`, keys `places-picker-*`/`places-section-search-more`/`places-strip-more` consistent across tasks.
- **Out of scope:** no People/Tags/Camera/collapse/visibility changes; no proactive city fetch.
