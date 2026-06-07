# Mobile Timeline Overview Slice 2 Temporal Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable non-persisted temporal scope model and compose it into the Photos timeline query without clearing existing filters.

**Architecture:** Temporal scope is separate from `SearchFilter` state so clearing it can remove only the year/month drilldown while preserving people, tags, text, rating, media, location, and display filters. Photos gets an effective timeline filter provider that combines the debounced user filter with the current temporal scope. This slice does not render chips, overview cards, or drilldown UI; it only creates the state and query composition those later slices will call.

**Tech Stack:** Flutter, Dart, Riverpod, SearchFilter model, TimelineService provider tests, flutter_test, mocktail.

---

## Scope Boundaries

In scope:

- Add `TimelineTemporalScope` with `none`, `year`, and `month` states.
- Add a non-persisted Riverpod notifier for temporal scope.
- Add a pure helper that applies temporal scope to a `SearchFilter`.
- Add `photosTimelineEffectiveFilterProvider` and make `photosTimelineQueryProvider` use it.
- Test date boundaries, leap February, filter preservation, clear behavior, cold-container non-persistence, and query-provider search filter composition.

Out of scope:

- Tapping year/month cards.
- Active temporal chips in `PhotosFilterSubheader`.
- Route-local chips for non-Photos routes.
- Overview card data or representative assets.
- App-bar replacement or shared route adoption.

## File Map

- Create: `mobile/lib/domain/models/timeline_temporal_scope.model.dart`
  - Immutable temporal scope value with date-range helpers.
- Create: `mobile/lib/providers/timeline/temporal_scope.provider.dart`
  - Non-persisted scope notifier with `setYear`, `setMonth`, and `clear`.
- Create: `mobile/lib/providers/photos_filter/timeline_temporal_filter.provider.dart`
  - Pure composition helper and effective Photos timeline filter provider.
- Modify: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
  - Watches `photosTimelineEffectiveFilterProvider` instead of `photosTimelineFilterProvider`.
- Create: `mobile/test/domain/models/timeline_temporal_scope_test.dart`
- Create: `mobile/test/providers/timeline/temporal_scope_provider_test.dart`
- Create: `mobile/test/providers/photos_filter/timeline_temporal_filter_provider_test.dart`
- Modify: `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`

## Task 1: Temporal Scope Model

**Files:**

- Create: `mobile/test/domain/models/timeline_temporal_scope_test.dart`
- Create: `mobile/lib/domain/models/timeline_temporal_scope.model.dart`

- [ ] **Step 1: Write failing model tests**

Create `mobile/test/domain/models/timeline_temporal_scope_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';

void main() {
  group('TimelineTemporalScope', () {
    test('none has no range and is empty', () {
      const scope = TimelineTemporalScope.none();

      expect(scope.kind, TimelineTemporalScopeKind.none);
      expect(scope.isEmpty, isTrue);
      expect(scope.start, isNull);
      expect(scope.end, isNull);
    });

    test('year scope covers the full year', () {
      const scope = TimelineTemporalScope.year(2025);

      expect(scope.kind, TimelineTemporalScopeKind.year);
      expect(scope.isEmpty, isFalse);
      expect(scope.year, 2025);
      expect(scope.month, isNull);
      expect(scope.start, DateTime(2025));
      expect(scope.end, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope covers the full month including leap February', () {
      final scope = TimelineTemporalScope.month(year: 2024, month: 2);

      expect(scope.kind, TimelineTemporalScopeKind.month);
      expect(scope.year, 2024);
      expect(scope.month, 2);
      expect(scope.start, DateTime(2024, 2));
      expect(scope.end, DateTime(2024, 2, 29, 23, 59, 59));
    });

    test('december month scope ends inside the same calendar year', () {
      final scope = TimelineTemporalScope.month(year: 2025, month: 12);

      expect(scope.start, DateTime(2025, 12));
      expect(scope.end, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope rejects months outside 1 through 12', () {
      expect(() => TimelineTemporalScope.month(year: 2025, month: 0), throwsRangeError);
      expect(() => TimelineTemporalScope.month(year: 2025, month: 13), throwsRangeError);
    });

    test('value equality includes kind, year, and month', () {
      expect(const TimelineTemporalScope.year(2025), const TimelineTemporalScope.year(2025));
      expect(const TimelineTemporalScope.year(2025), isNot(const TimelineTemporalScope.year(2024)));
      expect(
        TimelineTemporalScope.month(year: 2025, month: 3),
        TimelineTemporalScope.month(year: 2025, month: 3),
      );
      expect(
        TimelineTemporalScope.month(year: 2025, month: 3),
        isNot(TimelineTemporalScope.month(year: 2025, month: 4)),
      );
    });
  });
}
```

- [ ] **Step 2: Run model tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/domain/models/timeline_temporal_scope_test.dart
```

Expected red failure:

- Import failure for missing `timeline_temporal_scope.model.dart`.

- [ ] **Step 3: Implement the model**

Create `mobile/lib/domain/models/timeline_temporal_scope.model.dart`:

```dart
enum TimelineTemporalScopeKind { none, year, month }

class TimelineTemporalScope {
  const TimelineTemporalScope._({required this.kind, this.year, this.month});

  const TimelineTemporalScope.none() : this._(kind: TimelineTemporalScopeKind.none);

  const TimelineTemporalScope.year(int year) : this._(kind: TimelineTemporalScopeKind.year, year: year);

  factory TimelineTemporalScope.month({required int year, required int month}) {
    RangeError.checkValueInInterval(month, 1, 12, 'month');
    return TimelineTemporalScope._(kind: TimelineTemporalScopeKind.month, year: year, month: month);
  }

  final TimelineTemporalScopeKind kind;
  final int? year;
  final int? month;

  bool get isEmpty => kind == TimelineTemporalScopeKind.none;

  DateTime? get start {
    return switch (kind) {
      TimelineTemporalScopeKind.none => null,
      TimelineTemporalScopeKind.year => DateTime(year!),
      TimelineTemporalScopeKind.month => DateTime(year!, month!),
    };
  }

  DateTime? get end {
    return switch (kind) {
      TimelineTemporalScopeKind.none => null,
      TimelineTemporalScopeKind.year => DateTime(year!, 12, 31, 23, 59, 59),
      TimelineTemporalScopeKind.month => DateTime(year!, month! + 1, 0, 23, 59, 59),
    };
  }

  @override
  bool operator ==(Object other) {
    return other is TimelineTemporalScope && other.kind == kind && other.year == year && other.month == month;
  }

  @override
  int get hashCode => Object.hash(kind, year, month);

  @override
  String toString() => 'TimelineTemporalScope(kind: $kind, year: $year, month: $month)';
}
```

- [ ] **Step 4: Format and run model tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/domain/models/timeline_temporal_scope.model.dart test/domain/models/timeline_temporal_scope_test.dart
mise exec -- flutter test test/domain/models/timeline_temporal_scope_test.dart
```

Expected green result:

- All model tests pass.

## Task 2: Temporal Scope Provider

**Files:**

- Create: `mobile/test/providers/timeline/temporal_scope_provider_test.dart`
- Create: `mobile/lib/providers/timeline/temporal_scope.provider.dart`

- [ ] **Step 1: Write failing provider tests**

Create `mobile/test/providers/timeline/temporal_scope_provider_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  test('defaults to non-persisted none scope', () {
    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  test('setYear stores a year scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setYear(2025);

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2025));
  });

  test('setMonth stores a month scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 8);

    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2025, month: 8));
  });

  test('clear returns to none', () {
    final notifier = container.read(timelineTemporalScopeProvider.notifier);
    notifier.setMonth(year: 2025, month: 8);

    notifier.clear();

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  test('new provider container does not restore previous temporal scope', () {
    container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
    container.dispose();

    final fresh = ProviderContainer();
    addTearDown(fresh.dispose);

    expect(fresh.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });
}
```

- [ ] **Step 2: Run provider tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/timeline/temporal_scope_provider_test.dart
```

Expected red failure:

- Import failure for missing `temporal_scope.provider.dart`.

- [ ] **Step 3: Implement provider**

Create `mobile/lib/providers/timeline/temporal_scope.provider.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';

class TimelineTemporalScopeNotifier extends Notifier<TimelineTemporalScope> {
  @override
  TimelineTemporalScope build() => const TimelineTemporalScope.none();

  void setYear(int year) => state = TimelineTemporalScope.year(year);

  void setMonth({required int year, required int month}) =>
      state = TimelineTemporalScope.month(year: year, month: month);

  void clear() => state = const TimelineTemporalScope.none();
}

final timelineTemporalScopeProvider =
    NotifierProvider<TimelineTemporalScopeNotifier, TimelineTemporalScope>(TimelineTemporalScopeNotifier.new);
```

- [ ] **Step 4: Format and run provider tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/providers/timeline/temporal_scope.provider.dart test/providers/timeline/temporal_scope_provider_test.dart
mise exec -- flutter test test/providers/timeline/temporal_scope_provider_test.dart
```

Expected green result:

- All temporal scope provider tests pass.

## Task 3: Effective Photos Timeline Filter

**Files:**

- Create: `mobile/test/providers/photos_filter/timeline_temporal_filter_provider_test.dart`
- Create: `mobile/lib/providers/photos_filter/timeline_temporal_filter.provider.dart`

- [ ] **Step 1: Write failing effective-filter tests**

Create `mobile/test/providers/photos_filter/timeline_temporal_filter_provider_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/timeline_temporal_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

void main() {
  group('applyTimelineTemporalScope', () {
    test('none returns the original filter instance', () {
      final filter = SearchFilter.empty();

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.none());

      expect(result, same(filter));
    });

    test('year scope applies year boundaries without mutating the base filter', () {
      final filter = SearchFilter.empty().copyWith(context: 'paris');

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(filter.date.takenAfter, isNull);
      expect(filter.date.takenBefore, isNull);
      expect(result.context, 'paris');
      expect(result.date.takenAfter, DateTime(2025));
      expect(result.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('month scope applies leap-month boundaries', () {
      final result = applyTimelineTemporalScope(
        SearchFilter.empty(),
        TimelineTemporalScope.month(year: 2024, month: 2),
      );

      expect(result.date.takenAfter, DateTime(2024, 2));
      expect(result.date.takenBefore, DateTime(2024, 2, 29, 23, 59, 59));
    });

    test('scope intersects an existing user date range', () {
      final filter = SearchFilter.empty().copyWith(
        date: SearchDateFilter(takenAfter: DateTime(2025, 3, 5), takenBefore: DateTime(2025, 9, 10)),
      );

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(result.date.takenAfter, DateTime(2025, 3, 5));
      expect(result.date.takenBefore, DateTime(2025, 9, 10));
    });

    test('non-time filters survive temporal scope composition', () {
      final filter = SearchFilter.empty().copyWith(
        tagIds: ['tag-1'],
        rating: SearchRatingFilter(rating: 4),
        mediaType: AssetType.image,
      )..context = 'mountains';

      final result = applyTimelineTemporalScope(filter, const TimelineTemporalScope.year(2025));

      expect(result.context, 'mountains');
      expect(result.tagIds, ['tag-1']);
      expect(result.rating.rating, 4);
      expect(result.mediaType, AssetType.image);
      expect(result.date.takenAfter, DateTime(2025));
    });
  });

  group('photosTimelineEffectiveFilterProvider', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer();
      addTearDown(container.dispose);
    });

    test('combines current Photos filter with temporal scope', () {
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setYear(2025);

      final filter = container.read(photosTimelineEffectiveFilterProvider);

      expect(filter.context, 'paris');
      expect(filter.date.takenAfter, DateTime(2025));
      expect(filter.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
    });

    test('clearing temporal scope keeps non-time Photos filters intact', () {
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
      expect(container.read(photosTimelineEffectiveFilterProvider).date.takenAfter, DateTime(2025, 3));

      container.read(timelineTemporalScopeProvider.notifier).clear();

      final filter = container.read(photosTimelineEffectiveFilterProvider);
      expect(filter.context, 'paris');
      expect(filter.date.takenAfter, isNull);
      expect(filter.date.takenBefore, isNull);
    });
  });
}
```

- [ ] **Step 2: Run effective-filter tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/timeline_temporal_filter_provider_test.dart
```

Expected red failure:

- Import failure for missing `timeline_temporal_filter.provider.dart`.

- [ ] **Step 3: Implement effective-filter provider**

Create `mobile/lib/providers/photos_filter/timeline_temporal_filter.provider.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

final photosTimelineEffectiveFilterProvider = Provider<SearchFilter>((ref) {
  final filter = ref.watch(photosTimelineFilterProvider);
  final scope = ref.watch(timelineTemporalScopeProvider);

  return applyTimelineTemporalScope(filter, scope);
});

SearchFilter applyTimelineTemporalScope(SearchFilter filter, TimelineTemporalScope scope) {
  final scopeStart = scope.start;
  final scopeEnd = scope.end;
  if (scopeStart == null && scopeEnd == null) {
    return filter;
  }

  final current = filter.date;
  final effectiveStart = _maxDate(current.takenAfter, scopeStart);
  final effectiveEnd = _minDate(current.takenBefore, scopeEnd);

  return filter.copyWith(date: SearchDateFilter(takenAfter: effectiveStart, takenBefore: effectiveEnd));
}

DateTime? _maxDate(DateTime? a, DateTime? b) {
  if (a == null) return b;
  if (b == null) return a;
  return a.isAfter(b) ? a : b;
}

DateTime? _minDate(DateTime? a, DateTime? b) {
  if (a == null) return b;
  if (b == null) return a;
  return a.isBefore(b) ? a : b;
}
```

- [ ] **Step 4: Format and run effective-filter tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/providers/photos_filter/timeline_temporal_filter.provider.dart test/providers/photos_filter/timeline_temporal_filter_provider_test.dart
mise exec -- flutter test test/providers/photos_filter/timeline_temporal_filter_provider_test.dart
```

Expected green result:

- All effective-filter provider tests pass.

## Task 4: Wire Effective Filter Into Photos Timeline Query

**Files:**

- Modify: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Modify: `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`

- [ ] **Step 1: Write failing timeline-query tests**

Append these tests inside the `photosTimelineQueryProvider` group in `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`:

```dart
    test('temporal scope alone makes the Photos timeline search-backed with date bounds', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      SearchFilter? captured;
      when(() => search.search(any(), 1)).thenAnswer((invocation) async {
        captured = invocation.positionalArguments.first as SearchFilter;
        return const SearchResult(assets: []);
      });
      when(() => factory.fromAssetStream(any(), any(), TimelineOrigin.search)).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(captured, isNotNull);
      expect(captured!.date.takenAfter, DateTime(2025));
      expect(captured!.date.takenBefore, DateTime(2025, 12, 31, 23, 59, 59));
      verify(() => factory.fromAssetStream(any(), any(), TimelineOrigin.search)).called(1);
    });

    test('temporal scope composes with active text filter for search-backed timeline', () async {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      SearchFilter? captured;
      when(() => search.search(any(), 1)).thenAnswer((invocation) async {
        captured = invocation.positionalArguments.first as SearchFilter;
        return const SearchResult(assets: []);
      });
      when(() => factory.fromAssetStream(any(), any(), TimelineOrigin.search)).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(captured, isNotNull);
      expect(captured!.context, 'paris');
      expect(captured!.date.takenAfter, DateTime(2025, 3));
      expect(captured!.date.takenBefore, DateTime(2025, 3, 31, 23, 59, 59));
    });

    test('cleared temporal scope returns empty Photos filter to main-library service', () {
      final factory = _MockFactory();
      final search = _MockSearch();
      final fake = _FakeService();
      when(() => factory.main(any(), any())).thenReturn(fake);

      final container = _container(factory: factory, search: search, user: _user('u1'));
      final temporal = container.read(timelineTemporalScopeProvider.notifier);
      temporal.setYear(2025);
      temporal.clear();
      addTearDown(container.dispose);

      final svc = container.read(photosTimelineQueryProvider);
      expect(svc, same(fake));
      verify(() => factory.main(any(), 'u1')).called(1);
      verifyNever(() => search.search(any(), any()));
    });
```

Also add this import at the top of the test file:

```dart
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
```

- [ ] **Step 2: Run timeline-query tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/timeline_query_provider_test.dart
```

Expected red failure:

- The temporal-scope tests fail because `photosTimelineQueryProvider` still watches `photosTimelineFilterProvider`.

- [ ] **Step 3: Wire provider**

Modify `mobile/lib/providers/photos_filter/timeline_query.provider.dart`:

Update the file header comment from:

```dart
// `buildPhotosFilterSearchTimeline`. 500 ms debounce lives in
// `photosTimelineFilterProvider`; consumers watch the result here.
```

to:

```dart
// `buildPhotosFilterSearchTimeline`. 500 ms debounce lives in
// `photosTimelineEffectiveFilterProvider` through `photosTimelineFilterProvider`;
// consumers watch the composed result here.
```

Remove this import:

```dart
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
```

Add this import:

```dart
import 'package:immich_mobile/providers/photos_filter/timeline_temporal_filter.provider.dart';
```

Change:

```dart
final filter = ref.watch(photosTimelineFilterProvider);
```

to:

```dart
final filter = ref.watch(photosTimelineEffectiveFilterProvider);
```

- [ ] **Step 4: Format and run timeline-query tests**

Run:

```bash
cd mobile
mise exec -- dart format lib/providers/photos_filter/timeline_query.provider.dart test/providers/photos_filter/timeline_query_provider_test.dart
mise exec -- flutter test test/providers/photos_filter/timeline_query_provider_test.dart
```

Expected green result:

- All timeline-query provider tests pass.

## Task 5: Final Slice 2 Verification And Commit

**Files:**

- Verify all Slice 2 files.

- [ ] **Step 1: Run targeted tests together**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/domain/models/timeline_temporal_scope_test.dart \
  test/providers/timeline/temporal_scope_provider_test.dart \
  test/providers/photos_filter/timeline_temporal_filter_provider_test.dart \
  test/providers/photos_filter/photos_filter_provider_test.dart \
  test/providers/photos_filter/timeline_query_provider_test.dart
```

Expected green result:

- All targeted tests pass.

- [ ] **Step 2: Run analyzer on touched production files**

Run:

```bash
cd mobile
mise exec -- dart analyze \
  lib/domain/models/timeline_temporal_scope.model.dart \
  lib/providers/timeline/temporal_scope.provider.dart \
  lib/providers/photos_filter/timeline_temporal_filter.provider.dart \
  lib/providers/photos_filter/timeline_query.provider.dart
```

Expected green result:

- Analyzer exits `0` with no errors or warnings for touched production files.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected result:

- `git diff --check` exits `0`.
- `git status --short` shows only intended Slice 2 files.

- [ ] **Step 4: Commit Slice 2**

Run:

```bash
git add \
  mobile/lib/domain/models/timeline_temporal_scope.model.dart \
  mobile/lib/providers/timeline/temporal_scope.provider.dart \
  mobile/lib/providers/photos_filter/timeline_temporal_filter.provider.dart \
  mobile/lib/providers/photos_filter/timeline_query.provider.dart \
  mobile/test/domain/models/timeline_temporal_scope_test.dart \
  mobile/test/providers/timeline/temporal_scope_provider_test.dart \
  mobile/test/providers/photos_filter/timeline_temporal_filter_provider_test.dart \
  mobile/test/providers/photos_filter/timeline_query_provider_test.dart
git commit -m "feat(mobile): compose timeline temporal scope"
```

Expected result:

- Commit succeeds.
- Commit contains only Slice 2 temporal scope and Photos timeline query composition work.

## Plan Self-Review

Spec coverage for Slice 2:

- TDD: each task writes failing tests before implementation and names expected red failures.
- Temporal scope model: covered by `none`, `year`, `month`, leap February, December, equality, and invalid-month tests.
- Non-persistence: covered by the fresh `ProviderContainer` test.
- Filter composition: covered by preserving text, tags, rating, media type, existing user date ranges, and clear behavior.
- Query composition: covered by temporal-only search-backed timeline, temporal + text filter, and cleared scope returning to main-library service.
- Edge cases: leap day, year boundaries, existing non-time filters, clearing scope, and cold app launch are covered.

Future-slice requirements intentionally not implemented here:

- Tapping year/month overview cards to set scope belongs to Slice 4.
- Active temporal chips and clear-chip UI belong to Slice 4.
- Route-local chips and non-Photos route overrides belong to Slice 5.
- Representative overview cards belong to Slice 3.
