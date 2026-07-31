# Mobile Filter Parity — Slice 3: People picker + cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 3 row; "BDD — Slice 3: People (capped section + picker)"; "UI anatomy → People picker" `#mockup-people-picker` and the People section in `#mockup-deep`). **Data-availability facts:** the deep section + browse strip source `FilterSuggestionsPersonDto` (from `getFilterSuggestions`, **no** count); only the full-screen picker can show a photo count, by switching its source to the shared-spaces server list. This matches the mockup (count appears only in picker rows).

**Goal:** (a) Cap the People deep-section preview to the first 6 avatars (selected-but-beyond-cap pinned) + a body "Search N people →" row; (b) cap the People browse strip + a trailing "+N" tile; both opening the full-screen picker. (c) Switch the picker's data source from local Drift to `getAllPeopleWithSharedSpaces` (includes shared-space people; offline falls back to local Drift). (d) Show each picker row's photo count from `numberOfAssets` with NO extra network call.

**Architecture:** Add a nullable `int? numberOfAssets` to `DriftPerson` and `PersonDto`; populate `DriftPerson.numberOfAssets` in `_personToDriftPerson` from the already-fetched `dto.numberOfAssets`, carry it into `PersonDto` via `_toPersonDto`. Point `peoplePickerAllProvider` at `driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount)`. Render the count in the picker's `_PersonRow`. Restructure the deep section's `childBuilder` to a capped `Wrap` + body row, and the strip's `ListView` to capped + trailing tile.

**Tech Stack:** Flutter 3.44.1, `hooks_riverpod`, `easy_localization`, three-state `Optional` DTOs. Tests: `pumpConsumerWidget` + in-memory Store harness + mocktail (repo tests).

## Global Constraints

- Package `package:immich_mobile/...`; Flutter 3.44.1 via `mise exec --`; CI `dart analyze --fatal-infos` over lib AND test.
- `numberOfAssets` is read from the three-state optional as `dto.numberOfAssets.orElse(null)` (→ `int?`). NO extra network call — the shared-spaces endpoint already returns it.
- The deep section / browse strip source (`FilterSuggestionsPersonDto`) has NO count — do NOT try to show a count there; the count is picker-only.
- Cap counts: People preview = first **6** (spec/mockup). Selected people beyond the first 6 that are present in the suggestion set are pinned (shown, checked). A selected person entirely absent from the suggestion set is out of scope for pinning (the timeline chip still removes it).
- Slice 3 must NOT change collapse (Slice 1) or visibility (Slice 2) behavior, or the Places/Tags/Camera surfaces.
- Offline: the local-Drift fallback path leaves `numberOfAssets` null → the picker row hides the count gracefully (no error).
- The "Search N people →" moves to the section BODY (per `#mockup-deep`); remove the header `trailingHeader` button for People (it becomes the body row). Keep the chevron (Slice 1).
- Worktree branch `worktree-mobile-filter-parity`. No trailers.

## Baseline

Slices 1–2 complete: 400 tests green in `filter_sheet/` + `photos_filter/`, `dart analyze lib test` clean. `FilterSectionId`, collapse + hide providers exist.

## File Structure

**Modify:**

- `mobile/lib/domain/models/person.model.dart` — add `int? numberOfAssets` to `DriftPerson` (field + ctor + copyWith + == + hashCode + toString) AND to `PersonDto` (field + ctor + copyWith + == + hashCode + toMap + fromMap).
- `mobile/lib/repositories/person_api.repository.dart` — set `numberOfAssets: dto.numberOfAssets.orElse(null)` in `_personToDriftPerson`.
- `mobile/lib/providers/photos_filter/people_picker.provider.dart` — switch `peoplePickerAllProvider` source; carry count in `_toPersonDto`.
- `mobile/lib/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart` — `_PersonRow` shows "N photos".
- `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart` — cap to 6 + pin selected + body "Search N →" row; remove header trailing.
- `mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart` — cap + trailing "+N" tile → picker.
- Tests: `person_api_repository_test.dart`, `people_picker_provider_test.dart`, `person_picker_list_test.dart`, `people_section_test.dart`, `strips_test.dart`, plus any DriftPerson/PersonDto model tests.

**Create (if none exists):**

- `mobile/test/domain/models/person_dto_number_of_assets_test.dart` (small, if no PersonDto unit test covers the new field).

---

### Task 1: `numberOfAssets` on `DriftPerson` + carry in `_personToDriftPerson`

**Files:** Modify `mobile/lib/domain/models/person.model.dart` (DriftPerson), `mobile/lib/repositories/person_api.repository.dart`; Test `mobile/test/repositories/person_api_repository_test.dart`.

**Interfaces:** `DriftPerson` gains `final int? numberOfAssets;` (nullable, defaults null). `_personToDriftPerson` sets it from `dto.numberOfAssets.orElse(null)`.

- [ ] **Step 1: Write the failing test.** In `person_api_repository_test.dart` (its `personDto(...)` helper already sets `numberOfAssets: Optional.present(...)`), add to the `getAllPeopleWithSharedSpaces` group:

```dart
test('carries numberOfAssets from the DTO onto DriftPerson', () async {
  // Arrange: the MockPeopleApi returns a person with numberOfAssets present (use the existing personDto helper with a count).
  // Act: call repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);
  // Assert: the returned DriftPerson.numberOfAssets == that count.
});
```

Fill it in using the file's existing mock setup + `personDto` helper (read the file; give the person a distinctive count like 1204). Assert `result.first.numberOfAssets` equals it.

- [ ] **Step 2: Run → RED** (`DriftPerson` has no `numberOfAssets`): `mise exec -- flutter test test/repositories/person_api_repository_test.dart` → compile error.

- [ ] **Step 3: Implement.** In `person.model.dart` `DriftPerson`: add `final int? numberOfAssets;` to the field list; add `this.numberOfAssets,` to the const constructor; add `int? numberOfAssets` handling to `copyWith` (`numberOfAssets: numberOfAssets ?? this.numberOfAssets`), to `toString`, to `operator ==` (`other.numberOfAssets == numberOfAssets`), and to `hashCode` (include `numberOfAssets`). In `person_api.repository.dart` `_personToDriftPerson`, add `numberOfAssets: dto.numberOfAssets.orElse(null),` to the `DriftPerson(...)` constructor call.

- [ ] **Step 4: Run → GREEN.** `mise exec -- flutter test test/repositories/person_api_repository_test.dart` → PASS.

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/domain/models/person.model.dart lib/repositories/person_api.repository.dart test/repositories/person_api_repository_test.dart
git add lib/domain/models/person.model.dart lib/repositories/person_api.repository.dart test/repositories/person_api_repository_test.dart
git commit -m "feat(mobile-filter): carry numberOfAssets onto DriftPerson (slice 3)"
```

---

### Task 2: `numberOfAssets` on `PersonDto` + picker source switch

**Files:** Modify `mobile/lib/domain/models/person.model.dart` (PersonDto), `mobile/lib/providers/photos_filter/people_picker.provider.dart`; Test `mobile/test/providers/photos_filter/people_picker_provider_test.dart` (+ a small PersonDto field test).

**Interfaces:** `PersonDto` gains `final int? numberOfAssets;` (nullable). `_toPersonDto(DriftPerson p)` sets `numberOfAssets: p.numberOfAssets`. `peoplePickerAllProvider` sources `driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount)`.

- [ ] **Step 1: Write failing tests.**
  - In `people_picker_provider_test.dart`: this file currently overrides `driftGetAllPeopleProvider`. Change the override target to `driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount)` (read the file to match its `FutureProvider.family` override syntax) and add a `numberOfAssets` to the seeded `DriftPerson`s; add a test that `peoplePickerAllProvider` yields `PersonDto`s whose `numberOfAssets` matches the source `DriftPerson`s.
  - Add `test/domain/models/person_dto_number_of_assets_test.dart` (or extend an existing PersonDto test): assert `PersonDto(..., numberOfAssets: 5).copyWith(...)` preserves it, `==`/`hashCode` include it, and `fromMap(toMap())` round-trips it (null and non-null).

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**
  - `PersonDto`: add `final int? numberOfAssets;`; add to ctor (`this.numberOfAssets`), `copyWith`, `==`, `hashCode`, `toMap` (`'numberOfAssets': numberOfAssets`), `fromMap` (`numberOfAssets: map['numberOfAssets'] as int?`).
  - `people_picker.provider.dart`: in `_toPersonDto`, add `numberOfAssets: p.numberOfAssets`. In `peoplePickerAllProvider`, replace `ref.watch(driftGetAllPeopleProvider(PeopleSortBy.photoCount).future)` with `ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount).future)` (keep the `!p.isHidden && p.name.isNotEmpty` filter + `.map(_toPersonDto)`).

- [ ] **Step 4: Run → GREEN** (both test files).

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/domain/models/person.model.dart lib/providers/photos_filter/people_picker.provider.dart test/providers/photos_filter/people_picker_provider_test.dart test/domain/models/person_dto_number_of_assets_test.dart
git add lib/domain/models/person.model.dart lib/providers/photos_filter/people_picker.provider.dart test/providers/photos_filter/people_picker_provider_test.dart test/domain/models/person_dto_number_of_assets_test.dart
git commit -m "feat(mobile-filter): people picker sources shared-spaces list + numberOfAssets (slice 3)"
```

---

### Task 3: Picker row shows "N photos"

**Files:** Modify `mobile/lib/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart`; Test `mobile/test/presentation/pages/photos_filter/widgets/person_picker_list_test.dart`.

**Interfaces:** `_PersonRow` renders a photo-count subtitle (`Key('person-row-count-<id>')`) below the name when `person.numberOfAssets != null`; hidden when null.

- [ ] **Step 1: Write failing tests** (in `person_picker_list_test.dart`, which inits Store in `setUpAll`):
  - A person with `numberOfAssets: 1204` → a widget keyed `person-row-count-<id>` is present and its text contains "1,204" (use the app's number formatting; if the app doesn't format thousands, assert "1204"). Read the file for the existing person-fixture builder and reuse it.
  - A person with `numberOfAssets: null` → no `person-row-count-<id>` widget.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.** In `_PersonRow`, change the name `Expanded(Text(person.name))` into a `Column(crossAxisAlignment: start, mainAxisSize: min, children: [Text(person.name), if (person.numberOfAssets != null) Text(<count label>, key: Key('person-row-count-${person.id}'), style: theme.textTheme.bodySmall?.copyWith(color: outline))])`. For the count label, use a localizable string if a suitable plural key exists (search `i18n/en.json` for an existing "photos"/"assets" count key, e.g. `filter_sheet_deep_search_n_people` is people-specific — instead look for a generic `items_count`/`assets`/`photos` plural; if none fits, add `"person_picker_photo_count": "{count} photos"` to `i18n/en.json` and regenerate keys). Keep the row height/layout tidy (the row was `_kRowHeight = 56`; a two-line row may need the height relaxed — adjust `_kRowHeight` or use intrinsic height, and update the scrubber offset map if it depends on a fixed row height — read `_build` before changing).

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart test/presentation/pages/photos_filter/widgets/person_picker_list_test.dart
git add -A
git commit -m "feat(mobile-filter): show per-person photo count in picker (slice 3)"
```

---

### Task 4: Cap the People deep section + body "Search N →" row + pin selected

**Files:** Modify `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart`; Test `mobile/test/presentation/widgets/filter_sheet/deep/people_section_test.dart`.

**Interfaces:** The section renders at most 6 avatars by default (plus any selected suggestion beyond the first 6, pinned), followed by a body row `Key('people-section-search-more')` (moved from header) that calls `onOpenPicker`. The header no longer carries the trailing "search more" `TextButton` (keep the Slice-1 chevron).

- [ ] **Step 1: Write failing tests** (in `people_section_test.dart`, Store-initialized, overrides `photosFilterSuggestionsProvider`):
  - Given 10 suggestion people, none selected → exactly 6 `people-tile-<id>` render, and a `people-section-search-more` ROW is present in the body (not the header). (Read the file: today `people-section-search-more` is a header `TextButton`; assert it now lives in the section body — e.g. it renders below the tiles. Assert `find.byKey(const Key('people-section-search-more'))` findsOneWidget and tapping it fires `onOpenPicker`.)
  - Given 10 people where the 8th is selected (in `photosFilterProvider.people`) → that 8th tile is still rendered (pinned) even though it's beyond the first 6, and shows selected state.
  - Given ≤6 people → all render, no over-cap.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.** In `people_section.widget.dart`:
  - Compute the display list in `childBuilder`: `final firstSix = people.take(6).toList(); final overflowSelected = people.skip(6).where(_isSelected).toList(); final display = [...firstSix, ...overflowSelected];` where `_isSelected(FilterSuggestionsPersonDto p)` reuses the section's existing selection check (read how `_PeopleGridTile` determines selected — replicate that predicate at the section level; it matches against `photosFilterProvider.people`).
  - Return `Column(crossAxisAlignment: start, mainAxisSize: min, children: [ Wrap(spacing: 14, runSpacing: 14, children: [for (final p in display) _PeopleGridTile(person: p)]), if (count > 0) <body search row> ])`.
  - The body search row: reuse the current `_searchMoreLabel(count)` text and `onOpenPicker` callback, styled as a full-width tappable row (an `InkWell`/`TextButton` with a leading search icon + the label + trailing arrow) keyed `people-section-search-more`. Fire `HapticFeedback.selectionClick()` + `onOpenPicker` on tap.
  - Remove the `trailingHeader:` argument from the `DeepSectionScaffold(...)` call for People (the search affordance is now the body row). Keep everything else (sectionId, emptyCaptionKey, items).

- [ ] **Step 4: Run → GREEN** (and confirm the empty→"(0)" Slice-1 behavior still holds — the empty case shows no body).

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart test/presentation/widgets/filter_sheet/deep/people_section_test.dart
git add -A
git commit -m "feat(mobile-filter): cap people section to 6 + body search row (slice 3)"
```

---

### Task 5: Cap the People browse strip + trailing "+N" tile

**Files:** Modify `mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart`; Test `mobile/test/presentation/widgets/filter_sheet/strips/strips_test.dart` (`PeopleStrip` group).

**Interfaces:** The strip renders at most 6 person tiles + a trailing "more" tile (`Key('people-strip-more')`) that navigates `context.pushRoute(const PersonPickerRoute())` when there are more than 6 people.

- [ ] **Step 1: Write failing tests** (in `strips_test.dart` `PeopleStrip` group, Store-initialized):
  - Given 10 people → at most 6 `_PersonTile`s render + a `people-strip-more` tile is present. Tapping `people-strip-more` triggers navigation to the person picker (assert via a mock navigator observer OR that the tile exists and is tappable; reuse the file's navigation-assert pattern if present — if none, assert the tile renders and, wrapped in a `MaterialApp` with the router, tapping it does not throw).
  - Given ≤6 people → all render, no `people-strip-more` tile.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.** In `people_strip.widget.dart` `childBuilder`: cap `itemCount` to `min(6, data.length)` for the tiles, and when `data.length > 6` add one trailing item — a "more" tile keyed `people-strip-more` showing "+N" (N = `data.length - 6`) that on tap calls `HapticFeedback.selectionClick()` + `context.pushRoute(const PersonPickerRoute())`. Add the `routing/router.dart` import and use a `Builder`/the strip's `context` so `pushRoute` resolves (the strip currently has no picker import). Keep `_PersonTile` unchanged.

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Analyze & commit**

```bash
mise exec -- dart analyze lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart test/presentation/widgets/filter_sheet/strips/strips_test.dart
git add -A
git commit -m "feat(mobile-filter): cap people browse strip + more tile (slice 3)"
```

---

### Task 6: Full green + analyze + reconcile

- [ ] **Step 1: Run the target suites**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/mobile-filter-parity/mobile
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/ test/repositories/person_api_repository_test.dart test/domain/models/
```

- [ ] **Step 2: Fix any breakage**, preserving intent: the picker-source switch (Task 2) changes the override target — ensure `person_picker_test.dart` overrides `driftGetAllPeopleWithSharedSpacesProvider` (not the old `driftGetAllPeopleProvider`) wherever it seeds picker data; if it seeds via `peoplePickerFilteredProvider` directly it may be unaffected (check). The row-height change (Task 3) may shift scrubber-offset or tap-target tests — update expected offsets, keep tap-target ≥ 48.

- [ ] **Step 3: Re-run until green**

```bash
mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/ test/repositories/ test/domain/models/
```

Expected: **All tests passed!** (≥ 400 + Slice 3's new tests).

- [ ] **Step 4: Full analyze gate**

```bash
mise exec -- dart analyze lib test
```

Expected: `No issues found!`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(mobile-filter): reconcile people picker/section/strip tests (slice 3)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 3 BDD):** preview capped to 6 (T4), selected-but-hidden pinned (T4), open picker (T4/T5), picker includes shared-space people (T2 source switch), search filters (existing `peoplePickerFilteredProvider`, unchanged), A–Z scrubber (existing), multi-select toggle (existing), photo count no extra call (T1/T2/T3), offline fallback hides count (null→hidden, T3 + existing service fallback), selected/recent strips (existing), Done applies (existing), empty/no-match (existing + Slice-1 "(0)"). Mockup `#mockup-people-picker` (search + strips + scrubber + row with "N photos" + checkbox) — count row added (T3); rest pre-exists. `#mockup-deep` People section (6 avatars + body "Search N →") — T4.
- **Placeholder scan:** the only "read the file to match X" notes are for exact test-override syntax and existing predicates — concrete targets named, not TODOs.
- **Type consistency:** `numberOfAssets` (`int?`) added consistently to `DriftPerson`, `PersonDto`, `_personToDriftPerson`, `_toPersonDto`, `_PersonRow`. Provider name `driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount)` consistent T2/T6.
- **Out of scope:** no Places/Tags/Camera/collapse/visibility changes; deep section/strip counts NOT attempted (countless DTO).
- **Known limitation (documented in spec/constraints):** pinning only covers selected people present in the suggestion set beyond the cap; fully-absent selected people rely on the timeline chip (out of scope this slice).
