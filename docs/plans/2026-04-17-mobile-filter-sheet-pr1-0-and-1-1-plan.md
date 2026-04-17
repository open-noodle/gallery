# Mobile Filter Sheet — PR 1.0 & PR 1.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the two foundational PRs for the mobile filter sheet feature — PR 1.0 (a throw-away keyboard-interaction spike) and PR 1.1 (new Photos-tab filter-state providers with no UI wiring). Design doc: [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md).

**Architecture:** PR 1.0 lives on a spike branch that never merges; its outcome decides whether PR 1.2 uses Flutter's stock `DraggableScrollableSheet` or a custom `ModalBottomSheet` wrapper. PR 1.1 lands the Riverpod state layer — `photosFilterProvider` (notifier over the existing `SearchFilter` model), `photosFilterSheetProvider` (snap-state enum), `photosFilterSuggestionsProvider` (wraps existing `getFilterSuggestions()` API), and `photosFilterCountProvider` (placeholder page-1-count pending a true total-count source). The `photosTimelineQueryProvider` (empty-vs-non-empty query switcher) is deferred from PR 1.1 to PR 1.2 so the adapter from `SearchResult` to `RenderList` lands next to its consumer. No UI, no navigation changes in PR 1.1.

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

### Task 1.1.0: Pre-work — `SearchFilter.empty()` + test baseline

**Files:**

- Modify: `mobile/lib/models/search/search_filter.model.dart`
- Test: `mobile/test/models/search/search_filter_empty_test.dart` (create)

**Step 1:** Capture the current `flutter test` baseline so later tasks can distinguish new regressions from pre-existing flakes.

```bash
cd /home/pierre/dev/gallery/.worktrees/mobile-filter-panel/mobile
flutter test --reporter=compact 2>&1 | tee /tmp/pre-pr-test-baseline.txt
tail -5 /tmp/pre-pr-test-baseline.txt
```

Record the pass/fail counts. The later Task 1.1.20 diffs against this file.

**Step 2:** Write a failing test for the new factory.

```dart
// mobile/test/models/search/search_filter_empty_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  group('SearchFilter.empty', () {
    test('returns a canonical empty filter', () {
      final f = SearchFilter.empty();
      expect(f.isEmpty, true);
      expect(f.people, isEmpty);
      expect(f.tagIds, anyOf(isNull, isEmpty));
      expect(f.context, anyOf(isNull, isEmpty));
    });
    test('two empty filters compare empty-equivalent', () {
      expect(SearchFilter.empty().isEmpty, SearchFilter.empty().isEmpty);
    });
  });
}
```

**Step 3:** Run — FAIL (`SearchFilter.empty` not defined).

```bash
flutter test test/models/search/search_filter_empty_test.dart
```

**Step 4:** Add the static factory to the model. Open `mobile/lib/models/search/search_filter.model.dart` and add inside the `SearchFilter` class, alongside the existing constructor:

```dart
static SearchFilter empty() => SearchFilter(
  people: const {},
  location: SearchLocationFilter(),
  camera: SearchCameraFilter(),
  date: SearchDateFilter(),
  display: SearchDisplayFilters(
    isFavorite: false,
    isArchive: false,
    isNotInAlbum: false,
  ),
  rating: SearchRatingFilter(),
  mediaType: AssetType.other,
);
```

If any of `SearchLocationFilter`, `SearchCameraFilter`, `SearchDateFilter`, `SearchRatingFilter` don't offer a no-arg constructor (check each), pass explicit `null`s for all their fields.

**Step 5:** Run — PASS.

**Step 6:** Commit.

```bash
git add mobile/lib/models/search/search_filter.model.dart mobile/test/models/search/search_filter_empty_test.dart
git commit -m "feat(mobile): add SearchFilter.empty() factory for filter-sheet use"
```

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

Expected: **no match.** This confirms orphan reconciliation needs either a separate server endpoint or a deferred strategy. **Decision for Phase 1:** defer proactive orphan reconciliation to Phase 1.5. Phase 1 ships _without_ auto-removal of deleted-id chips; timeline returning zero matches is the user's cue. Update §7 of the design doc in a separate commit if this decision lands.

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

**Step 4:** `SearchFilter.empty()` was added in Task 1.1.0 — no action needed here beyond importing the model.

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

**Step 1:** Write `ChipId`. Sealed classes in Dart do **not** get free value-equality; every subclass declares `==` and `hashCode` explicitly, otherwise two `PersonChipId('alice')` instances compare unequal and `removeChip` will silently fail to match.

```dart
sealed class ChipId {
  const ChipId();
}

class PersonChipId extends ChipId {
  final String personId;
  const PersonChipId(this.personId);
  @override
  bool operator ==(Object other) => other is PersonChipId && other.personId == personId;
  @override
  int get hashCode => Object.hash('PersonChipId', personId);
}

class TagChipId extends ChipId {
  final String tagId;
  const TagChipId(this.tagId);
  @override
  bool operator ==(Object other) => other is TagChipId && other.tagId == tagId;
  @override
  int get hashCode => Object.hash('TagChipId', tagId);
}

// Value-less chip ids: singletons via identity; define == as runtimeType match.
class LocationChipId extends ChipId {
  const LocationChipId();
  @override
  bool operator ==(Object other) => other is LocationChipId;
  @override
  int get hashCode => (LocationChipId).hashCode;
}
class DateChipId extends ChipId {
  const DateChipId();
  @override
  bool operator ==(Object other) => other is DateChipId;
  @override
  int get hashCode => (DateChipId).hashCode;
}
class RatingChipId extends ChipId {
  const RatingChipId();
  @override
  bool operator ==(Object other) => other is RatingChipId;
  @override
  int get hashCode => (RatingChipId).hashCode;
}
class MediaTypeChipId extends ChipId {
  const MediaTypeChipId();
  @override
  bool operator ==(Object other) => other is MediaTypeChipId;
  @override
  int get hashCode => (MediaTypeChipId).hashCode;
}
class FavouriteChipId extends ChipId {
  const FavouriteChipId();
  @override
  bool operator ==(Object other) => other is FavouriteChipId;
  @override
  int get hashCode => (FavouriteChipId).hashCode;
}
class ArchiveChipId extends ChipId {
  const ArchiveChipId();
  @override
  bool operator ==(Object other) => other is ArchiveChipId;
  @override
  int get hashCode => (ArchiveChipId).hashCode;
}
class NotInAlbumChipId extends ChipId {
  const NotInAlbumChipId();
  @override
  bool operator ==(Object other) => other is NotInAlbumChipId;
  @override
  int get hashCode => (NotInAlbumChipId).hashCode;
}
class TextChipId extends ChipId {
  const TextChipId();
  @override
  bool operator ==(Object other) => other is TextChipId;
  @override
  int get hashCode => (TextChipId).hashCode;
}
```

**Step 2a:** Write equality tests BEFORE any `removeChip` tests — this is the bug-prevention layer.

```dart
// mobile/test/providers/photos_filter/chip_id_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';

void main() {
  group('ChipId equality', () {
    test('PersonChipId value equality', () {
      expect(const PersonChipId('alice'), const PersonChipId('alice'));
      expect(const PersonChipId('alice').hashCode, const PersonChipId('alice').hashCode);
      expect(const PersonChipId('alice'), isNot(const PersonChipId('bob')));
    });
    test('TagChipId value equality', () {
      expect(const TagChipId('t1'), const TagChipId('t1'));
      expect(const TagChipId('t1'), isNot(const TagChipId('t2')));
    });
    test('Value-less chip ids are equal across instances', () {
      expect(const LocationChipId(), const LocationChipId());
      expect(const DateChipId(), const DateChipId());
      expect(const RatingChipId(), const RatingChipId());
      expect(const MediaTypeChipId(), const MediaTypeChipId());
      expect(const FavouriteChipId(), const FavouriteChipId());
      expect(const ArchiveChipId(), const ArchiveChipId());
      expect(const NotInAlbumChipId(), const NotInAlbumChipId());
      expect(const TextChipId(), const TextChipId());
    });
    test('Different value-less chip ids are NOT equal', () {
      expect(const LocationChipId(), isNot(const DateChipId()));
    });
  });
}
```

**Step 2b:** Failing test for `removeChip` — one `expect` per chip type: adding a filter, calling `removeChip(corresponding id)`, asserting that dimension is empty, others untouched.

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

**Step 2:** Implement. Note `_mapMediaType` converts the local `AssetType` enum (from `immich_mobile/entities/asset.entity.dart`) to the OpenAPI `AssetTypeEnum` — the existing `SearchApiRepository.search()` does this inline using index comparisons; the helper below is the extracted form.

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

final photosFilterSuggestionsProvider =
    FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>(
  (ref, filter) async {
    final api = ref.watch(apiServiceProvider).searchApi;
    final response = await api.getFilterSuggestions(
      city: filter.location.city,
      country: filter.location.country,
      isFavorite: filter.display.isFavorite ? true : null,
      make: filter.camera.make,
      mediaType: _mapMediaType(filter.mediaType),
      model: filter.camera.model,
      personIds: filter.people.isEmpty
          ? null
          : filter.people.map((p) => p.id).toList(),
      rating: filter.rating.rating,
      tagIds: filter.tagIds,
      takenAfter: filter.date.takenAfter,
      takenBefore: filter.date.takenBefore,
    );
    return response ?? FilterSuggestionsResponseDto(hasUnnamedPeople: false);
  },
);

AssetTypeEnum? _mapMediaType(AssetType type) {
  // Mirrors SearchApiRepository.search() inline conversion. AssetType.other → null
  // means "no server-side media-type constraint" (match all).
  if (type.index == AssetType.image.index) return AssetTypeEnum.IMAGE;
  if (type.index == AssetType.video.index) return AssetTypeEnum.VIDEO;
  if (type.index == AssetType.audio.index) return AssetTypeEnum.AUDIO;
  return null;
}
```

Notes baked into the snippet:

- `isFavorite: filter.display.isFavorite ? true : null` — sending `false` to the server means "non-favourites only"; we want "no constraint" when the toggle is off. Verify this matches `SearchApiRepository.search()`'s pattern; adjust if needed.
- `personIds: filter.people.isEmpty ? null : [...]` — empty list and null may be treated differently by the server; null is the safer default for "no constraint."
- `AssetType.other` in the local enum maps to `null` (match all types) — the server interprets omitted `mediaType` as unconstrained.

**Step 3:** Add a debounce — use a simple `Timer(Duration(milliseconds: 250), ...)` wrapper OR lean on `family.autoDispose` + upstream `photosFilterProvider.select` caller throttling. **Keep Phase 1 simple: no built-in debounce in the provider itself. Debouncing moves to the consumer (Timeline / sheet) in PR 1.2.** Document this in a file-level comment.

**Step 4:** PASS. Commit.

### Task 1.1.17: `photosFilterCountProvider`

**Files:**

- Create: `mobile/lib/providers/photos_filter/filter_count.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_count_provider_test.dart`

> **⚠ `searchServiceProvider` collision.** The codebase has **two providers named `searchServiceProvider`** — the legacy 3-dep version at `mobile/lib/services/search.service.dart:14` and the newer domain-layer 1-dep version at `mobile/lib/providers/infrastructure/search.provider.dart:8`. They expose different `SearchService` classes with different `search()` return shapes. **This plan uses the domain-layer version** (cleaner DI, forward-facing), imported explicitly as shown below. Do not add an ambiguous import.

**Step 1:** Failing test — mocked domain `SearchService.search()` returning a `SearchResult` with `assets.length == 42`; provider returns 42 (placeholder strategy).

**Step 2:** Implement — call `searchServiceProvider.search(filter, 1)` (domain variant) and return `result?.assets.length ?? 0` as a **placeholder** total. Add a `// TODO(phase-1.2): replace with a true total-count endpoint if one exists post-audit.` comment.

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';  // ← domain variant, NOT services/search.service.dart
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

final photosFilterCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final filter = ref.watch(photosFilterProvider);
  if (filter.isEmpty) return 0; // placeholder — timeline service will supply total in PR 1.2
  final service = ref.watch(searchServiceProvider);
  final result = await service.search(filter, 1);
  // TODO(phase-1.2): replace with a true total-count endpoint if one exists post-audit.
  return result?.assets.length ?? 0;
});
```

**Step 3:** PASS. Commit with a message flagging the placeholder.

```bash
git add mobile/lib/providers/photos_filter/filter_count.provider.dart mobile/test/providers/photos_filter/filter_count_provider_test.dart
git commit -m "feat(mobile): photosFilterCountProvider (placeholder count pending total-count audit)"
```

### Task 1.1.18: ~~`photosTimelineQueryProvider`~~ — **deferred to PR 1.2**

This provider was originally planned for PR 1.1 but is deferred to PR 1.2 for two reasons:

1. **No consumer exists until PR 1.2.** PR 1.1 ships state providers only; there is no Timeline wiring yet that would benefit from a unified query provider. Building it now ships dead code.
2. **The `SearchResult` → `RenderList` adapter is non-trivial** — the two services return different asset shapes (legacy `List<Asset>` vs domain `List<RemoteAsset>` vs `RenderList`). The adapter is the kind of logic that belongs next to its consumer, not orphaned in an infra PR.

**What PR 1.1 does instead:** stops at `photosFilterCountProvider`. PR 1.2 takes on:

- `photosTimelineQueryProvider` (empty/non-empty switcher per design §6.4.1).
- The `SearchResult → RenderList` adapter.
- `currentUserProvider` null-guard — note the provider returns `UserDto?` (nullable), field is `.id` not `.userId`. PR 1.2 must handle not-logged-in: `ref.watch(currentUserProvider)?.id ?? '<fallback>'`.
- Wiring the Timeline widget to listen to the new provider.
- 500 ms debounce on the empty↔non-empty transition.

This task is kept in the plan as a placeholder so PR 1.2 planning can reference it directly.

### Task 1.1.19: Final barrel export + tidy

**Files:**

- Modify: `mobile/lib/providers/photos_filter/photos_filter.dart`

```dart
export 'chip_id.dart';
export 'filter_sheet.provider.dart';
export 'filter_count.provider.dart';
export 'filter_suggestions.provider.dart';
export 'photos_filter.provider.dart';
// timeline_query.provider.dart is exported from this barrel in PR 1.2 (deferred per Task 1.1.18).
```

Add a one-line test in `mobile/test/providers/photos_filter/barrel_test.dart` that imports only from the barrel path and references each symbol — this catches missing exports at compile time.

```dart
// mobile/test/providers/photos_filter/barrel_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.dart';

void main() {
  test('barrel exports are resolvable', () {
    // Compile-time smoke test — if any symbol isn't exported, this file won't build.
    expect(PhotosFilterNotifier, isNotNull);
    expect(FilterSheetSnap.values, isNotEmpty);
    expect(const PersonChipId('x'), isA<ChipId>());
    expect(photosFilterProvider, isNotNull);
    expect(photosFilterSheetProvider, isNotNull);
    expect(photosFilterSuggestionsProvider, isNotNull);
    expect(photosFilterCountProvider, isNotNull);
  });
}
```

**Commit.**

```bash
git add mobile/lib/providers/photos_filter/photos_filter.dart mobile/test/providers/photos_filter/barrel_test.dart
git commit -m "feat(mobile): photos_filter barrel final exports + smoke test"
```

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

Expected: all tests pass. If a test fails (whether or not it appears related to this PR), investigate the root cause and fix it — do not retry, do not tolerate flakes. A test that "passes alone but fails in the full suite" is leaked state between test files; fix the leak.

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

- `SearchFilter.empty()` factory added to the existing filter model (enables the rest of this PR and reused by future PR 1.3 Reset button).
- Four new Riverpod providers under `mobile/lib/providers/photos_filter/`:
  - `photosFilterProvider` — `NotifierProvider<PhotosFilterNotifier, SearchFilter>` with the full method surface per design §6.3.
  - `photosFilterSheetProvider` — `FilterSheetSnap` enum state.
  - `photosFilterSuggestionsProvider` — wraps the existing `SearchApi.getFilterSuggestions()` with filter-state input and `FilterSuggestionsResponseDto` output.
  - `photosFilterCountProvider` — placeholder returning page-1 length of a search call; to be replaced with a true total-count mechanism in PR 1.2.
- `ChipId` sealed type in `chip_id.dart` with explicit `==` / `hashCode` overrides per subclass (so `removeChip` matches value-equal ids).
- Unit tests under `mobile/test/providers/photos_filter/` — every notifier method, clearing semantics, no-op safety, suggestions marshalling, ChipId equality, barrel-smoke.

## What this PR does NOT ship

- No UI wiring (PR 1.2).
- No `photosTimelineQueryProvider` — deferred to PR 1.2 where the adapter lands next to its consumer (see Task 1.1.18 note).
- No orphan-id reconciliation — deferred to Phase 1.5 (see §7 update committed in Task 1.1.1).
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
