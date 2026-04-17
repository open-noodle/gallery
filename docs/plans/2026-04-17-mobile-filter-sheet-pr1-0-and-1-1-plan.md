# Mobile Filter Sheet — PR 1.0 & PR 1.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the two foundational PRs for the mobile filter sheet feature — PR 1.0 (a throw-away keyboard-interaction spike) and PR 1.1 (new Photos-tab filter-state providers with no UI wiring). Design doc: [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md).

**Architecture:** PR 1.0 lives on a spike branch that never merges; its outcome decides whether PR 1.2 uses Flutter's stock `DraggableScrollableSheet` or a custom `ModalBottomSheet` wrapper. PR 1.1 lands the Riverpod state layer — `photosFilterProvider` (notifier over the existing `SearchFilter` model), `photosFilterSheetProvider` (snap-state enum), `photosFilterSuggestionsProvider` (wraps existing `getFilterSuggestions()` API), `photosFilterCountProvider` (total match count via search endpoint), and `photosTimelineQueryProvider` (empty-vs-non-empty query switcher). No UI, no navigation changes.

**Tech stack:** Flutter, `hooks_riverpod` (mix of `@riverpod` codegen and manual `NotifierProvider`), `flutter_test` + `mocktail` for tests, `SearchFilter` from `mobile/lib/models/search/search_filter.model.dart`, OpenAPI-generated `SearchApi.getFilterSuggestions()`.

---

## Landmarks & pre-verified facts

- Branch: `feat/mobile-filter-panel` (worktree at `.worktrees/mobile-filter-panel`).
- `SearchFilter` at `mobile/lib/models/search/search_filter.model.dart:210-343` has `copyWith`, `isEmpty` getter, and nested value types (`SearchLocationFilter`, `SearchCameraFilter`, `SearchDateFilter`, `SearchRatingFilter`, `SearchDisplayFilters`). People field is `Set<PersonDto>` (not ids).
- `SearchApi.getFilterSuggestions()` at `mobile/openapi/lib/api/search_api.dart:276` — response DTO `FilterSuggestionsResponseDto` has `people`, `tags`, `countries`, `cameraMakes`, `ratings`, `mediaTypes`, `hasUnnamedPeople`. **No total match count; no `stillExists` echo for selected ids.**
- Existing search state: `mobile/lib/providers/search/paginated_search.provider.dart` (`StateNotifierProvider<PaginatedSearchNotifier, SearchResult>`) and `mobile/lib/providers/search/search_filter.provider.dart` (different concern — suggestion-list by type). Neither is touched in PR 1.1.
- Test container helper: `mobile/test/test_utils.dart` → `TestUtils.createContainer({overrides})`.
- Riverpod idiom in this repo mixes `@riverpod` annotation (codegen, `.g.dart`) with manual `NotifierProvider`/`StateNotifierProvider`. The plan below uses **manual `NotifierProvider`** to keep the diff simple and avoid build-runner coupling on the state layer.

---

## PR 1.0 — Keyboard interaction spike

This branch is deliberately throw-away and not held to TDD discipline. Its job is to answer one question: **does `DraggableScrollableSheet` with an embedded focused `TextField` work well enough to ship in PR 1.2, or do we need a custom sheet?**

Base branch: `main`. Spike branch: `spike/mobile-filter-keyboard`. **Never merged.**

### Task 0.1: Create the spike branch

**Files:** no file changes yet.

**Step 1:** From the worktree root.

```bash
cd /home/pierre/dev/gallery/.worktrees/mobile-filter-panel
git checkout main
git pull origin main
git checkout -b spike/mobile-filter-keyboard
```

**Step 2:** Verify.

```bash
git branch --show-current
```

Expected: `spike/mobile-filter-keyboard`.

### Task 0.2: Scaffold a dev-only spike page

**Files:**
- Create: `mobile/lib/presentation/pages/dev/spike_filter_keyboard.page.dart`

**Step 1:** Write the spike page — minimal content, focus is the sheet + TextField.

```dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

@RoutePage()
class SpikeFilterKeyboardPage extends StatelessWidget {
  const SpikeFilterKeyboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Spike · filter keyboard')),
      body: Stack(
        children: [
          // Fake timeline behind
          Container(color: Colors.grey.shade900),
          // Sheet
          DraggableScrollableSheet(
            initialChildSize: 0.6,
            minChildSize: 0.15,
            maxChildSize: 0.95,
            snap: true,
            snapSizes: const [0.15, 0.6, 0.95],
            builder: (context, scrollController) {
              return Container(
                color: Theme.of(context).colorScheme.surface,
                child: ListView(
                  controller: scrollController,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: TextField(
                        autofocus: false,
                        decoration: const InputDecoration(
                          hintText: 'Search photos, faces, text…',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    for (int i = 0; i < 40; i++)
                      ListTile(title: Text('Spike row $i')),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
```

### Task 0.3: Wire the spike route

**Files:**
- Modify: `mobile/lib/routing/router.dart` — add the spike route declaration.

**Step 1:** Locate the routes list in `router.dart`. Add the new route alongside other dev routes (search for existing `@RoutePage`-decorated pages to find the pattern; typical entry is `AutoRoute(page: SomePageRoute.page, path: '/some-path')`).

**Step 2:** Add:

```dart
AutoRoute(page: SpikeFilterKeyboardRoute.page, path: '/spike/filter-keyboard'),
```

**Step 3:** Generate route files.

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

Expected: build completes without errors; `router.gr.dart` updated to include `SpikeFilterKeyboardRoute`.

### Task 0.4: Manually test on iOS + Android

**Not automated.** Use the Flutter dev loop: `cd mobile && flutter run`. Navigate to `/spike/filter-keyboard` via whatever dev deep-link mechanism exists (or briefly wire a button on the Photos tab for spike use; remove before abandoning the branch).

Test cases — observe and record for each:

1. Open the page → is the sheet at the `0.6` (Browse-like) snap? Does the grey "timeline" show behind?
2. Tap the text field → does the keyboard open?
3. With keyboard open, can you still see the text field? Does it stay visible above the keyboard, or is it hidden?
4. With keyboard open, try dragging the sheet down. Does it go to the 0.15 snap? Does it collapse cleanly?
5. With keyboard open, try dragging the sheet up to 0.95. Does the content underneath remain scrollable?
6. Hit the keyboard close button — does the sheet stay at its current snap, or jump?
7. On iOS: does the sheet fight with `SafeArea`? Any visual glitches at the bottom inset?
8. On Android: does the sheet play nicely with the gesture-nav bar?
9. Rotate to landscape — does the sheet reflow? Any clipping?
10. Repeat 1–9 on a small-screen device (e.g., iPhone SE / Pixel 4a simulator).

### Task 0.5: Write the spike decision note

**Files:**
- Modify: `docs/plans/2026-04-17-mobile-filter-sheet-design.md` — fill in §11.4.

**Step 1:** Check out the feature branch (not the spike branch) to edit the design doc.

```bash
git stash --include-untracked  # if any uncommitted spike work
git checkout feat/mobile-filter-panel
```

**Step 2:** Replace the `§11.4 Spike outcome (filled after PR 1.0)` placeholder with a concrete decision:

```markdown
### 11.4 Spike outcome (2026-MM-DD)

- **Implementation chosen:** [stock `DraggableScrollableSheet` | custom `ModalBottomSheet` wrapper]
- **Key quirks observed:**
  - [observation 1]
  - [observation 2]
- **Devices exercised:** iPhone 15 sim / iOS 17, Pixel 8 sim / Android 14, iPhone SE sim, Pixel 4a sim.
- **Follow-up work that affects PR 1.2:**
  - [item or "none"]
```

**Step 3:** Commit the decision note.

```bash
git add docs/plans/2026-04-17-mobile-filter-sheet-design.md
git commit -m "docs: fill §11.4 with spike outcome — [stock or custom]"
```

**Step 4:** Abandon the spike branch. Do not merge; do not delete the branch (keep for reference).

```bash
git push origin spike/mobile-filter-keyboard  # push the branch as a record
git checkout feat/mobile-filter-panel
```

**Done with PR 1.0.** PR 1.1 can now begin.

---

## PR 1.1 — State infrastructure (no UI)

Branch: `feat/mobile-filter-panel`. Tests are `flutter_test`-based, one provider / one method at a time, TDD with frequent commits.

### Task 1.1.1: OpenAPI audit — verify `getFilterSuggestions()` is callable and documented

**Files:** no file changes — this is a verification step whose outcome is written into the code comments of Task 1.1.4.

**Step 1:** Run the regen to confirm it is a no-op (the endpoint is already generated on this branch).

```bash
cd /home/pierre/dev/gallery/.worktrees/mobile-filter-panel
make open-api-dart
```

Expected: generated files have no diff from HEAD.

```bash
git status mobile/openapi/
```

Expected: no changes, or only whitespace/comment-level changes.

**Step 2:** Read `mobile/openapi/lib/api/search_api.dart:276` and capture the full `getFilterSuggestions` signature. Copy the parameter list into a note — Task 1.1.4 will need it. Also read `mobile/openapi/lib/model/filter_suggestions_response_dto.dart` to confirm the response DTO fields.

**Step 3:** Search for an `echo` / `stillExists` / selected-id validation field in the response.

```
Use Grep on mobile/openapi/lib/model/filter_suggestions_* for "stillExists|exists|selected|echo"
```

Expected: **no match.** This confirms orphan reconciliation needs either a separate server endpoint or a deferred strategy. **Decision for Phase 1:** defer proactive orphan reconciliation to Phase 1.5. Phase 1 ships *without* auto-removal of deleted-id chips; timeline returning zero matches is the user's cue. Update §7 of the design doc in a separate commit if this decision lands.

**Step 4:** Commit the audit finding as a tiny design-doc update.

```bash
# Update §7 orphan-id reconciliation paragraph to note: "Phase 1 defers this; revisit Phase 1.5 pending server `stillExists` echo or a new validate-selection endpoint."
git add docs/plans/2026-04-17-mobile-filter-sheet-design.md
git commit -m "docs: mark orphan reconciliation as deferred to Phase 1.5 post-audit"
```

### Task 1.1.2: Create the provider directory with a placeholder barrel file

**Files:**
- Create: `mobile/lib/providers/photos_filter/photos_filter.dart` (barrel export file)

**Step 1:** Write an empty barrel:

```dart
// Barrel for photos_filter providers (populated across PR 1.1 tasks).
```

**Step 2:** Commit.

```bash
git add mobile/lib/providers/photos_filter/photos_filter.dart
git commit -m "feat(mobile): scaffold photos_filter provider directory"
```

### Task 1.1.3: Define `FilterSheetSnap` enum

**Files:**
- Create: `mobile/lib/providers/photos_filter/filter_sheet.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_sheet_provider_test.dart`

**Step 1:** Write the failing test.

```dart
// mobile/test/providers/photos_filter/filter_sheet_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

void main() {
  group('FilterSheetSnap', () {
    test('has exactly four states: hidden, peek, browse, deep', () {
      expect(FilterSheetSnap.values, [
        FilterSheetSnap.hidden,
        FilterSheetSnap.peek,
        FilterSheetSnap.browse,
        FilterSheetSnap.deep,
      ]);
    });
  });
}
```

**Step 2:** Run it to verify it fails.

```bash
cd mobile && flutter test test/providers/photos_filter/filter_sheet_provider_test.dart
```

Expected: FAIL — `filter_sheet.provider.dart` doesn't exist.

**Step 3:** Implement the minimal code.

```dart
// mobile/lib/providers/photos_filter/filter_sheet.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';

enum FilterSheetSnap { hidden, peek, browse, deep }

final photosFilterSheetProvider = StateProvider<FilterSheetSnap>(
  (ref) => FilterSheetSnap.hidden,
);
```

**Step 4:** Add a test for the default state.

```dart
test('photosFilterSheetProvider defaults to hidden', () {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  expect(container.read(photosFilterSheetProvider), FilterSheetSnap.hidden);
});
```

**Step 5:** Run tests.

```bash
flutter test test/providers/photos_filter/filter_sheet_provider_test.dart
```

Expected: PASS.

**Step 6:** Commit.

```bash
git add mobile/lib/providers/photos_filter/filter_sheet.provider.dart mobile/test/providers/photos_filter/filter_sheet_provider_test.dart
git commit -m "feat(mobile): add FilterSheetSnap enum + photosFilterSheetProvider"
```

### Task 1.1.4: Skeleton `PhotosFilterNotifier` with `reset()`

**Files:**
- Create: `mobile/lib/providers/photos_filter/photos_filter.provider.dart`
- Test: `mobile/test/providers/photos_filter/photos_filter_provider_test.dart`

**Step 1:** Write the failing tests.

```dart
// mobile/test/providers/photos_filter/photos_filter_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

void main() {
  late ProviderContainer container;
  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  group('photosFilterProvider default state', () {
    test('builds to an empty SearchFilter', () {
      final filter = container.read(photosFilterProvider);
      expect(filter.isEmpty, true);
    });
  });

  group('reset', () {
    test('reset() clears all dimensions back to the empty filter', () {
      final notifier = container.read(photosFilterProvider.notifier);
      notifier.setText('paris');
      expect(container.read(photosFilterProvider).isEmpty, false);
      notifier.reset();
      expect(container.read(photosFilterProvider).isEmpty, true);
    });
  });
}
```

**Step 2:** Run — expect FAIL (no `photosFilterProvider` yet).

```bash
flutter test test/providers/photos_filter/photos_filter_provider_test.dart
```

**Step 3:** Implement minimal code — state is `SearchFilter`, empty by default, `reset()` and `setText()` (just enough to satisfy the reset test).

```dart
// mobile/lib/providers/photos_filter/photos_filter.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

final photosFilterProvider =
    NotifierProvider<PhotosFilterNotifier, SearchFilter>(PhotosFilterNotifier.new);

class PhotosFilterNotifier extends Notifier<SearchFilter> {
  @override
  SearchFilter build() => SearchFilter.empty();

  void reset() => state = SearchFilter.empty();

  void setText(String text) =>
      state = state.copyWith(context: text.isEmpty ? null : text);
}
```

**Step 4:** Confirm `SearchFilter.empty()` exists on the model (audit per Task 1.1.1). If it doesn't, add a static constructor to the model file in a separate commit and reference it here.

**Step 5:** Run — expect PASS.

```bash
flutter test test/providers/photos_filter/photos_filter_provider_test.dart
```

**Step 6:** Commit.

```bash
git add mobile/lib/providers/photos_filter/photos_filter.provider.dart mobile/test/providers/photos_filter/photos_filter_provider_test.dart
git commit -m "feat(mobile): photosFilterProvider skeleton with reset()"
```

### Task 1.1.5: `togglePerson(PersonDto)` — idempotent add/remove

**Files:**
- Modify: `mobile/lib/providers/photos_filter/photos_filter.provider.dart`
- Modify: `mobile/test/providers/photos_filter/photos_filter_provider_test.dart`

**Step 1:** Add failing tests.

```dart
group('togglePerson', () {
  final alice = PersonDto(id: 'alice', name: 'Alice');  // adjust to actual PersonDto shape
  test('adding a person sets it in state.people', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.togglePerson(alice);
    expect(container.read(photosFilterProvider).people, contains(alice));
  });
  test('toggling the same person twice ends in empty set', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.togglePerson(alice);
    notifier.togglePerson(alice);
    expect(container.read(photosFilterProvider).people, isEmpty);
  });
  test('toggling two people leaves both in state', () {
    final bob = PersonDto(id: 'bob', name: 'Bob');
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.togglePerson(alice);
    notifier.togglePerson(bob);
    expect(container.read(photosFilterProvider).people, {alice, bob});
  });
});
```

**Step 2:** Run — FAIL (method doesn't exist).

**Step 3:** Implement.

```dart
// inside PhotosFilterNotifier
void togglePerson(PersonDto person) {
  final next = Set<PersonDto>.from(state.people);
  if (!next.add(person)) next.remove(person);
  state = state.copyWith(people: next);
}
```

**Step 4:** Run — PASS.

**Step 5:** Commit.

```bash
git commit -am "feat(mobile): photosFilterNotifier togglePerson"
```

### Task 1.1.6: `toggleTag(String tagId)` — idempotent add/remove on nullable list

**Files:** same provider + test files.

**Step 1:** Failing tests.

```dart
group('toggleTag', () {
  test('adding a tag sets it in state.tagIds', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.toggleTag('tag-1');
    expect(container.read(photosFilterProvider).tagIds, ['tag-1']);
  });
  test('toggling same tag twice ends with null or empty tagIds', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.toggleTag('tag-1');
    notifier.toggleTag('tag-1');
    final tagIds = container.read(photosFilterProvider).tagIds;
    expect(tagIds == null || tagIds.isEmpty, true);
  });
  test('toggle persists null-ness on an empty list', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.toggleTag('tag-1');
    notifier.toggleTag('tag-2');
    notifier.toggleTag('tag-1');
    expect(container.read(photosFilterProvider).tagIds, ['tag-2']);
  });
});
```

**Step 2:** FAIL.

**Step 3:** Implement. `SearchFilter.tagIds` is `List<String>?` — treat null as empty.

```dart
void toggleTag(String tagId) {
  final current = List<String>.from(state.tagIds ?? const []);
  if (current.contains(tagId)) {
    current.remove(tagId);
  } else {
    current.add(tagId);
  }
  state = state.copyWith(tagIds: current.isEmpty ? null : current);
}
```

**Step 4:** PASS. Commit.

```bash
git commit -am "feat(mobile): photosFilterNotifier toggleTag"
```

### Task 1.1.7: `setText(String)` — already minimal; add clearing test + commit

**Step 1:** Add test for the clearing-semantics-on-empty case.

```dart
group('setText', () {
  test('empty string clears context to null', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.setText('paris');
    notifier.setText('');
    expect(container.read(photosFilterProvider).context, null);
  });
});
```

**Step 2:** Run — should PASS (already implemented in Task 1.1.4). Commit the test.

```bash
git commit -am "test(mobile): setText clearing semantics"
```

### Task 1.1.8: `setLocation(SearchLocationFilter?)`

**Step 1:** Failing tests.

```dart
group('setLocation', () {
  test('assigns a location filter', () {
    final loc = SearchLocationFilter(country: 'France');  // use actual constructor
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.setLocation(loc);
    expect(container.read(photosFilterProvider).location.country, 'France');
  });
  test('passing null resets to the empty SearchLocationFilter', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.setLocation(SearchLocationFilter(country: 'France'));
    notifier.setLocation(null);
    expect(container.read(photosFilterProvider).location.country, null);
  });
});
```

**Step 2:** FAIL.

**Step 3:** Implement — `SearchFilter.location` is non-nullable; null input clears to `SearchLocationFilter()`.

```dart
void setLocation(SearchLocationFilter? location) =>
    state = state.copyWith(location: location ?? SearchLocationFilter());
```

**Step 4:** PASS. Commit.

```bash
git commit -am "feat(mobile): photosFilterNotifier setLocation"
```

### Task 1.1.9: `setDateRange({DateTime? start, DateTime? end})`

**Step 1:** Failing tests (both passing, either, both null clears).

```dart
group('setDateRange', () {
  final a = DateTime(2024, 1, 1);
  final b = DateTime(2024, 12, 31);
  test('sets both endpoints', () {
    container.read(photosFilterProvider.notifier).setDateRange(start: a, end: b);
    final d = container.read(photosFilterProvider).date;
    expect(d.takenAfter, a);
    expect(d.takenBefore, b);
  });
  test('both null clears the range', () {
    final notifier = container.read(photosFilterProvider.notifier);
    notifier.setDateRange(start: a, end: b);
    notifier.setDateRange(start: null, end: null);
    final d = container.read(photosFilterProvider).date;
    expect(d.takenAfter, null);
    expect(d.takenBefore, null);
  });
});
```

**Step 2:** FAIL. **Step 3:** Implement.

```dart
void setDateRange({DateTime? start, DateTime? end}) =>
    state = state.copyWith(date: SearchDateFilter(takenAfter: start, takenBefore: end));
```

**Step 4:** PASS. Commit.

```bash
git commit -am "feat(mobile): photosFilterNotifier setDateRange"
```

### Task 1.1.10: `setRating(int?)` and `setMediaType(AssetType?)`

**Step 1:** Write both sets of tests (rating set 4, rating null clears; mediaType IMAGE, mediaType null → all).

**Step 2:** FAIL. **Step 3:** Implement with the nested value-type copyWiths. **Step 4:** PASS. Commit each with its own message.

```bash
git commit -am "feat(mobile): photosFilterNotifier setRating"
git commit -am "feat(mobile): photosFilterNotifier setMediaType"
```

### Task 1.1.11: Display flags — `setFavouritesOnly`, `setArchivedIncluded`, `setNotInAlbum`

**Step 1:** For each boolean, test true/false toggle round-trips.

**Step 2:** FAIL. **Step 3:** Implement. Each writes into `SearchDisplayFilters`.

```dart
void setFavouritesOnly(bool v) =>
    state = state.copyWith(display: state.display.copyWith(isFavorite: v));
void setArchivedIncluded(bool v) =>
    state = state.copyWith(display: state.display.copyWith(isArchive: v));
void setNotInAlbum(bool v) =>
    state = state.copyWith(display: state.display.copyWith(isNotInAlbum: v));
```

**Step 4:** PASS. One commit per method.

### Task 1.1.12: `clearPeople()`, `clearTags()`, `clearDimension(Dimension)`

**Step 1:** Define a `Dimension` enum in the provider file.

```dart
enum Dimension { people, tags, location, date, camera, rating, mediaType, display, text }
```

**Step 2:** Write tests for each clear method — adding a few items, then clearing, then asserting only that dimension is empty.

**Step 3:** FAIL. **Step 4:** Implement each. `clearDimension` is a switch over the enum.

**Step 5:** PASS. One commit per public method.

### Task 1.1.13: `removeChip(ChipId id)` + `ChipId` type

**Files:**
- Create: `mobile/lib/providers/photos_filter/chip_id.dart` — a sealed class with cases for each chip type.

**Step 1:** Write `ChipId`.

```dart
sealed class ChipId {
  const ChipId();
}
class PersonChipId extends ChipId { final String personId; const PersonChipId(this.personId); }
class TagChipId extends ChipId { final String tagId; const TagChipId(this.tagId); }
class LocationChipId extends ChipId { const LocationChipId(); }
class DateChipId extends ChipId { const DateChipId(); }
class RatingChipId extends ChipId { const RatingChipId(); }
class MediaTypeChipId extends ChipId { const MediaTypeChipId(); }
class FavouriteChipId extends ChipId { const FavouriteChipId(); }
class ArchiveChipId extends ChipId { const ArchiveChipId(); }
class NotInAlbumChipId extends ChipId { const NotInAlbumChipId(); }
class TextChipId extends ChipId { const TextChipId(); }
```

**Step 2:** Failing test — one `expect` per chip type: adding a filter, calling `removeChip(corresponding id)`, asserting that dimension is empty, others untouched.

**Step 3:** Implement `removeChip`:

```dart
void removeChip(ChipId id) {
  switch (id) {
    case PersonChipId(:final personId):
      state = state.copyWith(
        people: state.people.where((p) => p.id != personId).toSet(),
      );
    case TagChipId(:final tagId):
      toggleTag(tagId);  // idempotent remove
    case LocationChipId(): setLocation(null);
    case DateChipId(): setDateRange(start: null, end: null);
    case RatingChipId(): setRating(null);
    case MediaTypeChipId(): setMediaType(null);
    case FavouriteChipId(): setFavouritesOnly(false);
    case ArchiveChipId(): setArchivedIncluded(false);
    case NotInAlbumChipId(): setNotInAlbum(false);
    case TextChipId(): setText('');
  }
}
```

**Step 4:** PASS. Commit.

```bash
git commit -am "feat(mobile): photosFilterNotifier removeChip with ChipId sealed type"
```

### Task 1.1.14: No-op safety tests

**Step 1:** Add regression tests.

- `clearPeople()` on an already-empty filter → no state change event.
- `removeChip(PersonChipId('nonexistent'))` → no state change event.
- `togglePerson` then `togglePerson` with the same `PersonDto` within the same microtask → net state change is none.

Use `Listener` from `mocktail` (per `mobile/test/test_utils.dart` `ListenerMock<T>` pattern) to assert listener invocation counts.

**Step 2:** FAIL or PASS depending on implementation. If any fail, tighten the notifier to compare old/new and skip emission when equal.

**Step 3:** Commit.

### Task 1.1.15: Export the provider from the barrel

**Files:**
- Modify: `mobile/lib/providers/photos_filter/photos_filter.dart`

**Step 1:**

```dart
export 'chip_id.dart';
export 'filter_sheet.provider.dart';
export 'photos_filter.provider.dart';
```

**Step 2:** Commit.

```bash
git commit -am "feat(mobile): photos_filter barrel export"
```

### Task 1.1.16: `photosFilterSuggestionsProvider`

**Files:**
- Create: `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_suggestions_provider_test.dart`

**Step 1:** Failing test — given a mocked `SearchApi` that returns a fixed `FilterSuggestionsResponseDto`, assert the provider returns it when read with a specific `SearchFilter`.

**Step 2:** Implement:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:openapi/api.dart';
import 'package:immich_mobile/providers/api.provider.dart';  // whatever surfaces ApiService

final photosFilterSuggestionsProvider =
    FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>(
  (ref, filter) async {
    final api = ref.watch(apiServiceProvider).searchApi;
    return await api.getFilterSuggestions(
      city: filter.location.city,
      country: filter.location.country,
      isFavorite: filter.display.isFavorite,
      make: filter.camera.make,
      mediaType: _mapMediaType(filter.mediaType),
      model: filter.camera.model,
      personIds: filter.people.map((p) => p.id).toList(),
      rating: filter.rating.rating,
      tagIds: filter.tagIds,
      takenAfter: filter.date.takenAfter,
      takenBefore: filter.date.takenBefore,
    ) ?? FilterSuggestionsResponseDto(hasUnnamedPeople: false);
  },
);

// _mapMediaType: convert local AssetType → openapi AssetTypeEnum. Pattern exists in the repo; copy it.
```

**Step 3:** Add a debounce — use a simple `Timer(Duration(milliseconds: 250), ...)` wrapper OR lean on `family.autoDispose` + upstream `photosFilterProvider.select` caller throttling. **Keep Phase 1 simple: no built-in debounce in the provider itself. Debouncing moves to the consumer (Timeline / sheet) in PR 1.2.** Document this in a file-level comment.

**Step 4:** PASS. Commit.

### Task 1.1.17: `photosFilterCountProvider`

**Files:**
- Create: `mobile/lib/providers/photos_filter/filter_count.provider.dart`
- Test: same pattern.

**Step 1:** Failing test — mocked `SearchService.search()` returning a `SearchResult` with `assets.length == 42`; provider returns 42 (placeholder strategy).

**Step 2:** Implement — call `searchServiceProvider.search(filter, 1)` and return `result?.assets.length ?? 0` as a **placeholder** total. Add a `// TODO(phase-1.2): replace with a true total-count endpoint if one exists post-audit.` comment.

```dart
final photosFilterCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final filter = ref.watch(photosFilterProvider);
  if (filter.isEmpty) return 0;  // placeholder — timeline service will supply total in PR 1.2
  final service = ref.watch(searchServiceProvider);
  final result = await service.search(filter, 1);
  return result?.assets.length ?? 0;  // placeholder: page-1 count, not total
});
```

**Step 3:** PASS. Commit with a message flagging the placeholder.

```bash
git commit -am "feat(mobile): photosFilterCountProvider (placeholder count pending total-count audit)"
```

### Task 1.1.18: `photosTimelineQueryProvider` — empty-vs-non-empty switcher

**Files:**
- Create: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Test: same pattern.

**Step 1:** Failing tests.

```dart
test('isEmpty filter returns a library-service-backed stream', () { ... });
test('non-empty filter returns a search-service-backed stream', () { ... });
test('empty → non-empty transition: cancels prior subscription', () { ... });
```

**Step 2:** Implement — watch `photosFilterProvider`, branch on `isEmpty`, return the appropriate stream. Use `ref.listenSelf((_, __) => ref.invalidateSelf())` on the filter to invalidate on change; debounce 500 ms via a `Timer` in a notifier wrapper.

Example shape:

```dart
final photosTimelineQueryProvider =
    AsyncNotifierProvider.autoDispose<_PhotosTimelineQueryNotifier, RenderList>(
  _PhotosTimelineQueryNotifier.new,
);

class _PhotosTimelineQueryNotifier extends AutoDisposeAsyncNotifier<RenderList> {
  Timer? _debounce;

  @override
  FutureOr<RenderList> build() async {
    final filter = ref.watch(photosFilterProvider);
    if (filter.isEmpty) {
      // library path
      final userId = ref.watch(currentUserProvider).userId;
      return ref.watch(timelineServiceProvider).watchHomeTimeline(userId).first;
    } else {
      // search path
      final service = ref.watch(searchServiceProvider);
      final result = await service.search(filter, 1);
      return _toRenderList(result);  // adapter TBD in PR 1.2
    }
  }
}
```

**Step 3:** The `_toRenderList` adapter is not trivial — flag it as TODO. Tests stub both services and assert which was called.

**Step 4:** PASS. Commit.

### Task 1.1.19: Final barrel export + tidy

**Files:**
- Modify: `mobile/lib/providers/photos_filter/photos_filter.dart`

```dart
export 'chip_id.dart';
export 'filter_sheet.provider.dart';
export 'filter_count.provider.dart';
export 'filter_suggestions.provider.dart';
export 'photos_filter.provider.dart';
export 'timeline_query.provider.dart';
```

**Commit.**

### Task 1.1.20: Full-suite test run + formatter + analyzer

**Step 1:** Run the full test file.

```bash
cd mobile && flutter test test/providers/photos_filter/
```

Expected: all new tests pass. Stop and fix if any fail.

**Step 2:** Run analyzer on the new files.

```bash
flutter analyze lib/providers/photos_filter/
```

Expected: no warnings, no errors.

**Step 3:** Run the full mobile unit-test suite to catch regressions.

```bash
flutter test
```

Expected: pre-existing failures stay the same number (record the baseline before the PR); no new failures. If the baseline has flakes, retry twice.

**Step 4:** Commit any formatter-only changes separately.

```bash
git commit -am "chore(mobile): dart format photos_filter"  # only if diff exists
```

### Task 1.1.21: Open PR 1.1 as draft

**Step 1:** Push the branch.

```bash
git push -u origin feat/mobile-filter-panel
```

**Step 2:** Open a draft PR with the description scaffold below. Title: `feat(mobile): photos-filter state infrastructure (PR 1.1)`.

```markdown
Part of the mobile filter sheet feature (design: [`docs/plans/2026-04-17-mobile-filter-sheet-design.md`](./docs/plans/2026-04-17-mobile-filter-sheet-design.md), PR 1.1 per §10.3).

## What

- Five new Riverpod providers under `mobile/lib/providers/photos_filter/`:
  - `photosFilterProvider` (NotifierProvider over `SearchFilter` with full method surface per §6.3)
  - `photosFilterSheetProvider` (FilterSheetSnap enum)
  - `photosFilterSuggestionsProvider` (wraps existing `SearchApi.getFilterSuggestions()`)
  - `photosFilterCountProvider` (placeholder page-1 count — see audit TODO)
  - `photosTimelineQueryProvider` (empty/non-empty filter switcher, §6.4.1)
- `ChipId` sealed type in `chip_id.dart`.
- Unit tests under `mobile/test/providers/photos_filter/` — every notifier method, clearing semantics, no-op safety, debounce-less suggestions, timeline-path switch.

## What this PR does NOT ship

- No UI wiring (PR 1.2).
- No orphan-id reconciliation (deferred to Phase 1.5 per audit; `§7` updated).
- No total-count endpoint — `photosFilterCountProvider` uses page-1 length as a placeholder.

## Tests

Full new test file passes. Full mobile suite at or below the baseline failure count.

## Checklist

- [ ] Passing `flutter analyze lib/providers/photos_filter/`
- [ ] Passing `flutter test test/providers/photos_filter/`
- [ ] No new regressions in `flutter test` (baseline captured pre-PR)
- [ ] Design doc §11.4 filled with PR 1.0 spike outcome (landed separately)
```

Mark as **Draft** until the spike outcome (§11.4) is in on `feat/mobile-filter-panel`.

---

## After PR 1.0 & PR 1.1

Write the PR 1.2 / 1.3 / 1.4 plan once both of these are merged (or at least PR 1.1 is). The spike outcome changes whether PR 1.2 uses stock or custom sheet widgets; that's the reason for staging.
