# Mobile Filter Parity — Slice 6: Camera dimension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 6 row; "BDD — Slice 6: Camera"; "UI anatomy → Camera picker" `#mockup-camera-picker` + Camera section in `#mockup-deep`).

**Goal:** Add the **Camera** filter dimension end-to-end: a new deep section + browse strip + full-screen picker (makes upfront from suggestions; models lazy-loaded per make on expand; single make + single model), a new `cameraModelSuggestionsProvider(make)`, a `setCamera` notifier setter, an active-filter chip, and `FilterSectionId.camera` in the registry.

**Architecture:** The model layer and the outgoing search query are ALREADY wired (`SearchFilter.camera` flows into `SmartSearchDto`/`MetadataSearchDto` — verified). Slice 6 is UI + a setter + chips + registry + i18n, mirroring **Places** (make→model ≈ country→city). New `@RoutePage() CameraPickerPage` + accordion + search header + `camera_picker.provider.dart`; new `CameraCascadeSection` (deep) + `CameraStrip` (browse); `setCamera` + `CameraChipId` + chip wiring; `FilterSectionId.camera` (between `tags` and `when`); route → `mise run codegen`.

**Tech Stack:** Flutter 3.44.1, `hooks_riverpod`, `auto_route` (+ codegen), `easy_localization`.

## Global Constraints

- Package `package:immich_mobile/...`; Flutter 3.44.1 via `mise exec --`; CI `dart analyze --fatal-infos` over lib AND test.
- **Route codegen:** after editing `router.dart`, run `mise run codegen` from `mobile/`; commit `router.dart` + `router.gr.dart` together; never hand-edit the generated file.
- **Already wired — do NOT touch:** `SearchCameraFilter`/`SearchFilter.camera` model, `SmartSearchDto`/`MetadataSearchDto` make/model inclusion (`search_api.repository.dart`), `cameraMakes` in the suggestions DTO, `SearchSuggestionType.cameraModel`. Selecting a make/model already filters the timeline.
- **Single make + single model** via a new `setCamera(SearchCameraFilter?)` (mirror `setLocation`: whole sub-filter replaces; null clears). Make pick = `setCamera(SearchCameraFilter(make: m))`; model pick = `setCamera(SearchCameraFilter(make: m, model: mm))`.
- **Models fetch ONLY on make-expand** via the new `cameraModelSuggestionsProvider(make)` (mirror `citySuggestionsProvider`), never proactively on search (same rule as Places).
- Makes come free from `photosFilterSuggestionsProvider(...).cameraMakes` (no counts).
- `FilterSectionId.camera` uses `storageId: 'camera'` (persistence is by storageId string — mid-enum insertion is safe). Place it between `tags` and `when`.
- Must NOT change People/Places/Tags/collapse/visibility behavior (beyond camera auto-appearing in the enum-driven Manage/collapse/hide surfaces).
- Worktree branch `worktree-mobile-filter-parity`. No trailers.

## Baseline

Slices 1–5 complete. Mirrors: Places (`places_cascade_section.widget.dart`, `places_strip.widget.dart`, `places_picker.page.dart`, `places_picker_country_accordion.widget.dart`, `places_picker_search_header.widget.dart`, `places_picker.provider.dart`), `citySuggestions.provider.dart`, and the chip files (`chip_id.dart`, `active_chips.dart`, `active_filter_chip.widget.dart`, `photos_filter.provider.dart` `removeChip`).

## File Structure

**Create:** `camera_picker.provider.dart`; `camera_model_suggestions.provider.dart` (or add `cameraModelSuggestionsProvider` to a suitable existing file); `CameraCascadeSection` (`deep/camera_cascade_section.widget.dart`); `CameraStrip` (`strips/camera_strip.widget.dart`); `CameraPickerPage` (`pages/photos_filter/camera_picker.page.dart`) + `camera_picker_make_accordion.widget.dart` + `camera_picker_search_header.widget.dart`; tests for each.

**Modify:** `photos_filter.provider.dart` (`setCamera` + `removeChip` camera case); `chip_id.dart` (`CameraChipId`); `active_chips.dart` (camera block + `ChipVisual.camera`); `active_filter_chip.widget.dart` (`_leading` camera case); `filter_section_id.dart` (`camera` value); `deep_content.widget.dart` (`_sectionFor` camera case + Builder); `browse_content.widget.dart` (add `CameraStrip`); `router.dart` (+ regen `router.gr.dart`); `i18n/en.json`. Reconcile enum-driven tests.

---

### Task 1: i18n keys

- [ ] **Step 1:** In `i18n/en.json` add, mirroring the Places keys exactly (alphabetical):

```json
"filter_sheet_camera": "Camera",
"filter_sheet_deep_camera_section": "Camera",
"filter_sheet_deep_empty_camera": "Cameras will appear when photos have them",
"filter_sheet_deep_search_n_cameras": { "one": "Search {count} camera →", "other": "Search {count} cameras →" },
"filter_sheet_picker_camera_title": "Camera",
"filter_sheet_picker_search_camera_hint": "Search make or model…",
```

- [ ] **Step 2: Regenerate** — `mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart`.
- [ ] **Step 3: Commit** — `git add ../i18n/en.json && git commit -m "feat(mobile-filter): add camera i18n keys (slice 6)"`.

---

### Task 2: Camera providers (model suggestions + picker query/makes)

**Files:** Create `mobile/lib/providers/photos_filter/camera_model_suggestions.provider.dart` and `mobile/lib/providers/photos_filter/camera_picker.provider.dart`; Tests: `camera_model_suggestions_provider_test.dart`, `camera_picker_provider_test.dart`.

**Interfaces:** `cameraModelSuggestionsProvider = FutureProvider.autoDispose.family<List<String>, String?>` (mirror `citySuggestionsProvider`, `SearchSuggestionType.cameraModel`, `make:`); `cameraPickerQueryProvider = StateProvider.autoDispose<String>`; `cameraPickerMakesProvider = Provider.autoDispose<AsyncValue<List<String>>>` (filters `.cameraMakes` by query — mirror `placesPickerCountriesProvider`).

- [ ] **Step 1: Write failing tests.**
  - `camera_model_suggestions_provider_test.dart`: mirror `city_suggestions_provider_test.dart` exactly — `ProviderContainer` overriding `apiServiceProvider` with a mock, stub `getSearchSuggestionsWithHttpInfo(SearchSuggestionType.cameraModel, make: 'Canon', withSharedSpaces: true)` → `http.Response(jsonEncode(['EOS R5','EOS R6']), 200)`; assert the provider returns them; null/empty make → `[]`. `registerFallbackValue(SearchSuggestionType.cameraModel)`.
  - `camera_picker_provider_test.dart`: mirror `places_picker_provider_test.dart` — override suggestions to `cameraMakes: ['Canon','Sony','Nikon']`; empty query → all; `'son'` → `['Sony']`; case-insensitive.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**

```dart
// mobile/lib/providers/photos_filter/camera_model_suggestions.provider.dart
import 'dart:convert';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart'; // match citySuggestions' apiServiceProvider import
import 'package:openapi/api.dart';

final cameraModelSuggestionsProvider = FutureProvider.autoDispose.family<List<String>, String?>((ref, make) async {
  if (make == null || make.isEmpty) return const <String>[];
  final api = ref.watch(apiServiceProvider).searchApi;
  final response = await api.getSearchSuggestionsWithHttpInfo(
    SearchSuggestionType.cameraModel,
    make: make,
    withSharedSpaces: true,
  );
  if (response.body.isEmpty) return const <String>[];
  return List<String>.from(jsonDecode(utf8.decode(response.bodyBytes)) as List);
});
```

(Copy the EXACT imports/api access from `city_suggestions.provider.dart` — match `apiServiceProvider`'s import path.)

```dart
// mobile/lib/providers/photos_filter/camera_picker.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';

final cameraPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

final cameraPickerMakesProvider = Provider.autoDispose<AsyncValue<List<String>>>((ref) {
  final filter = ref.watch(photosFilterDebouncedProvider);
  final suggestions = ref.watch(photosFilterSuggestionsProvider(filter));
  final query = ref.watch(cameraPickerQueryProvider).trim().toLowerCase();
  return suggestions.whenData((s) {
    final makes = s.cameraMakes;
    if (query.isEmpty) return makes;
    return makes.where((m) => m.toLowerCase().contains(query)).toList();
  });
});
```

- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): camera model-suggestions + picker providers (slice 6)"`.

---

### Task 3: `setCamera` + active-filter chip

**Files:** Modify `photos_filter.provider.dart`, `chip_id.dart`, `active_chips.dart`, `active_filter_chip.widget.dart`; Tests: `photos_filter_provider_test.dart`, `chip_id_test.dart`, `active_chips_test.dart`, `active_filter_chip_test.dart`.

**Interfaces:** `PhotosFilterNotifier.setCamera(SearchCameraFilter? camera)`; `final class CameraChipId extends ChipId { const CameraChipId(); }` (value-less, mirror `LocationChipId`); `activeChipsFromFilter` emits a camera chip when `camera.make != null || camera.model != null` (label = `[make, model].where(non-empty).join(' · ')`, `id: const CameraChipId()`, `icon: Icons.photo_camera_rounded`, visual `ChipVisual.camera`); `removeChip(CameraChipId())` → `state.copyWith(camera: SearchCameraFilter())`; `ChipVisual.camera` handled in `_leading` (icon group).

- [ ] **Step 1: Write failing tests.**
  - `photos_filter_provider_test.dart`: `setCamera(SearchCameraFilter(make:'Canon',model:'R5'))` sets `state.camera`; `setCamera(null)` clears; `removeChip(const CameraChipId())` clears camera.
  - `chip_id_test.dart`: `CameraChipId() == CameraChipId()` (value equality) + hashCode.
  - `active_chips_test.dart`: filter with `camera.make='Canon', model='R5'` → one chip whose id is `CameraChipId` and label contains "Canon · R5"; make-only → "Canon".
  - `active_filter_chip_test.dart`: a spec with `ChipVisual.camera` renders (no exhaustiveness crash).

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**
  - `photos_filter.provider.dart`: add `void setCamera(SearchCameraFilter? camera) => state = state.copyWith(camera: camera ?? SearchCameraFilter());` (near `setLocation`). Add `case CameraChipId(): state = state.copyWith(camera: SearchCameraFilter());` to `removeChip`'s switch. (Import `SearchCameraFilter` if not already.)
  - `chip_id.dart`: add `final class CameraChipId extends ChipId { const CameraChipId(); }` mirroring `LocationChipId`.
  - `active_chips.dart`: add `ChipVisual.camera` to the enum; add a camera block after the location block emitting `ActiveChipSpec(id: const CameraChipId(), label: [camera.make, camera.model].where((s)=>s!=null && s.isNotEmpty).join(' · '), visual: ChipVisual.camera, icon: Icons.photo_camera_rounded)` when make or model set. (Match `ActiveChipSpec`'s exact constructor — read the location block.)
  - `active_filter_chip.widget.dart`: add `case ChipVisual.camera:` to the `_leading` icon group (renders `spec.icon`).

- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): camera setCamera + active-filter chip (slice 6)"`.

---

### Task 4: `FilterSectionId.camera` + reconcile enum-driven surfaces

**Files:** Modify `filter_section_id.dart`, `deep_content.widget.dart`; Tests: `filter_section_id_test.dart` + reconcile `deep_content*`, `manage_sections_sheet_test.dart`, `hidden_sections_provider_test.dart`, `collapsed_sections_provider_test.dart` if they assert counts/order.

- [ ] **Step 1: Update the enum test.** In `filter_section_id_test.dart`, change the expected render order to include `camera` between `tags` and `when` (8 values); add `camera`→`'camera'` storageId + a non-empty titleKey assertion.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement.** Add `camera('camera', 'filter_sheet_deep_camera_section')` to `FilterSectionId` between `tags` and `when`. Add a TEMPORARY `case FilterSectionId.camera: return const SizedBox.shrink();` to `deep_content.widget.dart` `_sectionFor` (keeps the exhaustive switch compiling; the real section is wired in Task 6). Import nothing new yet.
- [ ] **Step 4: Run the enum test → GREEN**, then run the broader `filter_sheet/` + `photos_filter/` suites and fix any test asserting an exact section COUNT (e.g. a deep_content test expecting 7 sections; manage-sheet test expecting 7 toggles). Update those to expect 8 / include camera. Do NOT weaken them.
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): register FilterSectionId.camera (slice 6)"`.

---

### Task 5: `CameraPickerPage` + make→model accordion + route (codegen)

**Files:** Create `camera_picker.page.dart`, `camera_picker_make_accordion.widget.dart`, `camera_picker_search_header.widget.dart`; Modify `router.dart` (+ regen); Tests: `camera_picker_test.dart`, `camera_picker_make_accordion_test.dart`.

**Interfaces:** `@RoutePage() class CameraPickerPage extends ConsumerStatefulWidget` → `CameraPickerRoute`. AppBar back / `filter_sheet_picker_camera_title` / Done (`Key('camera-picker-done')`). Body `CustomScrollView`: `CameraPickerSearchHeader` (hint `filter_sheet_picker_search_camera_hint` → `cameraPickerQueryProvider`) + `CameraPickerMakeAccordion`. The accordion mirrors `PlacesPickerCountryAccordion` exactly: single-expand `String? expandedMake` (lifted to page); make rows `Key('camera-picker-make-<make>')` + chevron; on expand, `ref.watch(cameraModelSuggestionsProvider(make)).when(...)` → model radios `Key('camera-picker-model-<model>')`; selecting a model → `setCamera(SearchCameraFilter(make: make, model: model))`; selecting a make (row tap) → `setCamera(SearchCameraFilter(make: make))` + expand. Source makes from `cameraPickerMakesProvider`.

- [ ] **Step 1: Read the mirrors** — `places_picker.page.dart`, `places_picker_country_accordion.widget.dart`, `places_picker_search_header.widget.dart`. Copy structure, swapping country→make, city→model, `citySuggestionsProvider`→`cameraModelSuggestionsProvider`, `setLocation`→`setCamera`.

- [ ] **Step 2: Write failing widget tests** (mirror `places_picker_test.dart` + `places_picker_country_accordion_test.dart`): AppBar title "Camera" + `camera-picker-done`; make rows render from `cameraPickerMakesProvider`; expanding a make fetches ONLY that make's models (assert un-expanded make not fetched); selecting a model calls `setCamera(make,model)`; selecting a make row sets `setCamera(make)`; search filters makes; already-loaded-model search-match surfaces the expanded make even if its name doesn't match the query (mirror the Slice-4 page-level fix — ensure the page doesn't short-circuit to no-results when the expanded make has a matching loaded model).

- [ ] **Step 3: Run → RED.**
- [ ] **Step 4: Implement** the three widgets. Register route in `router.dart` (import + `AutoRoute(page: CameraPickerRoute.page, guards: [_authGuard, _duplicateGuard])`).
- [ ] **Step 5: Regenerate** — `mise run codegen`; confirm `CameraPickerRoute` in `router.gr.dart`.
- [ ] **Step 6: Run → GREEN.**
- [ ] **Step 7: Analyze & commit** (incl. regenerated router) — `git commit -m "feat(mobile-filter): add Camera picker page + route (slice 6)"`.

---

### Task 6: `CameraCascadeSection` (deep) + wire

**Files:** Create `deep/camera_cascade_section.widget.dart`; Modify `deep_content.widget.dart`; Test `camera_cascade_section_test.dart`.

**Interfaces:** `CameraCascadeSection extends ConsumerWidget` with `final VoidCallback? onOpenPicker;`. Mirror `PlacesCascadeSection`: source `.cameraMakes`; `DeepSectionScaffold<String>(sectionId: FilterSectionId.camera, titleKey: 'filter_sheet_deep_camera_section', emptyCaptionKey: 'filter_sheet_deep_empty_camera', trailingHeader: <"Search N cameras →" TextButton key 'camera-section-search-more' when count>0>, childBuilder: <_MakeWrap ↔ _ModelCascade on selected make>)`. `_MakeWrap` caps to 10 makes, `FilterChip`s → `setCamera(SearchCameraFilter(make: m))`. `_ModelCascade` shows selected make `InputChip` (onDeleted → `setCamera(null)`) + `cameraModelSuggestionsProvider(make)` model chips → `setCamera(SearchCameraFilter(make: make, model: model))`. Replace the Task-4 temporary `SizedBox.shrink()` in `deep_content._sectionFor` with a `Builder`-wrapped `CameraCascadeSection(key: Key('deep-section-camera'), onOpenPicker: () => context.pushRoute(const CameraPickerRoute()))`.

- [ ] **Step 1: Write failing tests** (mirror `places_cascade_section_test.dart`): renders makes; >10 → capped + `camera-section-search-more` trailing → `onOpenPicker`; selecting a make swaps to the model cascade; empty → "(0)".
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** the section (mirror Places) + replace the deep_content camera case with the Builder-wrapped section.
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): add camera deep section + wire picker (slice 6)"`.

---

### Task 7: `CameraStrip` (browse) + wire

**Files:** Create `strips/camera_strip.widget.dart`; Modify `browse_content.widget.dart`; Test: extend `strips_test.dart` with a `CameraStrip` group.

**Interfaces:** `CameraStrip` mirrors `PlacesStrip` (`StripScaffold(titleKey: 'filter_sheet_camera', ...)`, source `.cameraMakes`, `_MakeTile` selected border + tap `setCamera(SearchCameraFilter(make: m))`, trailing `Key('camera-strip-more')` "+N" → `context.pushRoute(const CameraPickerRoute())`). Insert `const CameraStrip()` in `browse_content.widget.dart` between `TagsStrip` and `WhenStrip` (+ import).

- [ ] **Step 1: Write failing tests** (mirror the Places/Tags strip tests incl. the RootStackRouter nav harness): renders makes ≤10 + `camera-strip-more` when >10 → navigates to `CameraPickerPage`; tapping a make tile sets camera; empty → strip hidden.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** + wire into `browse_content`.
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): add camera browse strip + wire (slice 6)"`.

---

### Task 8: Full green + analyze + reconcile

- [ ] **Step 1: Run** — `mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/`.
- [ ] **Step 2: Fix breakage** preserving intent (browse_content now has 5 strips; deep has 8 sections; manage sheet 8 toggles).
- [ ] **Step 3: Re-run until green** — All tests passed (≥ prior baseline + Slice 6's new tests).
- [ ] **Step 4: Full analyze** — `mise exec -- dart analyze lib test` → No issues found!
- [ ] **Step 5: Commit** — `git commit -m "test(mobile-filter): reconcile camera dimension (slice 6)"`.

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 6 BDD):** camera section appears respecting visibility (T4 enum-driven + T6 section), makes load no-fetch (T2/T6), models lazy on expand (T5/T6), single make+model (T3 setCamera + T5/T6), search matches makes + loaded models (T2 + T5 page-level, mirroring the Slice-4 fix), Done applies (T5), empty/offline (T6 "(0)" + accordion error branch). Mockup `#mockup-camera-picker` (nav bar, "Search make or model…", MAKE bucket, make rows + expand chevron, indented model radios, lazy hint) reproduced (T5). Active-filter chip (T3) makes a selected camera removable from the timeline.
- **Already-wired guardrail:** T-none touches the model/query — only consumes them. Verified `SearchFilter.camera` already reaches `SmartSearchDto`/`MetadataSearchDto`.
- **Route codegen** explicit (T5). **Chip exhaustiveness**: adding `CameraChipId` forces the `removeChip` case (T3); adding `ChipVisual.camera` forces the `_leading` case (T3) — both compile-enforced.
- **Placeholder scan:** the Task-4 temporary `SizedBox.shrink()` is explicitly replaced in Task 6 — not a leftover.
- **Type consistency:** `CameraPickerRoute`, `setCamera`, `cameraModelSuggestionsProvider`, `cameraPickerMakesProvider`, `CameraChipId`, `ChipVisual.camera`, `FilterSectionId.camera`, keys `camera-picker-*`/`camera-section-search-more`/`camera-strip-more`/`deep-section-camera` consistent.
- **Out of scope:** no People/Places/Tags/collapse/visibility logic changes (camera only ADDS to enum-driven surfaces).
