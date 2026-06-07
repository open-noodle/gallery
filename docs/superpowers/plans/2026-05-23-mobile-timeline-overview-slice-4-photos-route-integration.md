# Mobile Timeline Overview Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the mobile timeline overview controls into the main Photos route with app-bar grouping selection, clearable temporal chips, and year/month card drilldown.

**Architecture:** Keep `Timeline` and overview cards generic by adding a nullable drilldown handler provider. The main Photos route overrides that handler, replaces the app-bar filter action with `TimelineGroupingSelector`, and surfaces temporal scope through `PhotosFilterSubheader` beside existing active filters.

**Tech Stack:** Flutter, hooks_riverpod, EasyLocalization, Drift-backed `StoreService`, existing `TimelineService`/`GroupAssetsBy`/`SearchFilter` models.

---

## Current Baseline

- Spec: `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`
- Branch/worktree: `explore/discussion-387-timeline-spec` at `/home/pierre/dev/gallery/.worktrees/discussion-387-timeline-spec`
- Completed slices:
  - Slice 1: `TimelineGroupingSelector` syncs with `Setting.groupAssetsBy`.
  - Slice 2: `TimelineTemporalScope` composes into Photos timeline filter queries.
  - Slice 3: year/month buckets render compact `TimelineOverviewCard` rows.

## Files And Responsibilities

- Modify `mobile/lib/providers/photos_filter/chip_id.dart`
  - Add a value-less `TemporalScopeChipId` so temporal chips can be identified separately from user date-filter chips.
- Modify `mobile/lib/providers/photos_filter/photos_filter.provider.dart`
  - Add a no-op `TemporalScopeChipId` switch case for analyzer exhaustiveness; temporal scope is still cleared through `ActiveFilterChip.onRemove`.
- Modify `mobile/lib/providers/photos_filter/active_chips.dart`
  - Add `activeTemporalScopeChip(...)` helper for year/month scope labels.
- Modify `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
  - Add an optional `onRemove` callback so temporal chips can clear temporal scope while normal chips keep using `photosFilterProvider.notifier.removeChip`.
- Modify `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart`
  - Render the subheader when either the normal Photos filter or temporal scope is active.
  - Append the temporal chip, clear it independently, and make Clear all reset both normal filters and temporal scope.
- Create `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
  - Define the generic nullable drilldown hook and the Photos drilldown handler.
- Modify `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`
  - Read the drilldown handler and pass `onTap` into `TimelineOverviewCard` for non-empty year/month `TimeBucket`s.
- Modify `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
  - Replace `FilterIconButton` with `TimelineGroupingSelector`.
  - Override `timelineOverviewDrilldownProvider` with `photosTimelineOverviewDrilldownProvider`.
  - Keep `FilterSheet` in the page stack so the bottom search/filter path remains available.
- Create or modify tests:
  - `mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart`
  - `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`
  - `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`
  - `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`
  - `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`
  - `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`

## Task 1: Temporal Chip Specs And Removable Chip Callback

**Files:**

- Modify: `mobile/lib/providers/photos_filter/chip_id.dart`
- Modify: `mobile/lib/providers/photos_filter/photos_filter.provider.dart`
- Modify: `mobile/lib/providers/photos_filter/active_chips.dart`
- Modify: `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
- Test: `mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`

- [ ] **Step 1: Write failing tests for temporal chip helper**

Create `mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  group('activeTemporalScopeChip', () {
    test('returns null when no temporal scope is active', () {
      expect(activeTemporalScopeChip(const TimelineTemporalScope.none(), locale: 'en'), isNull);
    });

    test('builds a year chip with temporal scope id', () {
      final chip = activeTemporalScopeChip(const TimelineTemporalScope.year(2025), locale: 'en');

      expect(chip, isNotNull);
      expect(chip!.id, const TemporalScopeChipId());
      expect(chip.label, '2025');
      expect(chip.visual, ChipVisual.when);
    });

    test('builds a month chip with localized month and year', () {
      final chip = activeTemporalScopeChip(TimelineTemporalScope.month(year: 2025, month: 3), locale: 'en');

      expect(chip, isNotNull);
      expect(chip!.id, const TemporalScopeChipId());
      expect(chip.label, 'Mar 2025');
      expect(chip.visual, ChipVisual.when);
    });
  });
}
```

- [ ] **Step 2: Run temporal chip helper tests and verify they fail**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/active_temporal_scope_chip_test.dart
```

Expected: fail because `activeTemporalScopeChip` and `TemporalScopeChipId` do not exist.

- [ ] **Step 3: Add `TemporalScopeChipId`**

In `mobile/lib/providers/photos_filter/chip_id.dart`, add after `DateChipId`:

```dart
class TemporalScopeChipId extends ChipId {
  const TemporalScopeChipId();
  @override
  bool operator ==(Object other) => other is TemporalScopeChipId;
  @override
  int get hashCode => (TemporalScopeChipId).hashCode;
}
```

- [ ] **Step 4: Write failing no-op removal test**

Append this test to `mobile/test/providers/photos_filter/photos_filter_provider_test.dart`:

```dart
test('removeChip ignores temporal scope chips because scope is not part of SearchFilter', () {
  container.read(photosFilterProvider.notifier).setText('paris');

  container.read(photosFilterProvider.notifier).removeChip(const TemporalScopeChipId());

  expect(container.read(photosFilterProvider).context, 'paris');
});
```

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/photos_filter_provider_test.dart
```

Expected: fail because `PhotosFilterNotifier.removeChip` does not handle the new sealed `TemporalScopeChipId` case.

- [ ] **Step 5: Add analyzer-exhaustive no-op removal case**

In `mobile/lib/providers/photos_filter/photos_filter.provider.dart`, add this final case to `PhotosFilterNotifier.removeChip`:

```dart
      case TemporalScopeChipId():
        return;
```

This exists only because `ChipId` is sealed and the switch must be exhaustive. Temporal scope removal is still handled by `ActiveFilterChip.onRemove`, not by mutating `SearchFilter`.

- [ ] **Step 6: Add `activeTemporalScopeChip`**

In `mobile/lib/providers/photos_filter/active_chips.dart`, import `TimelineTemporalScope`:

```dart
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
```

Add below `ActiveChipSpec`:

```dart
ActiveChipSpec? activeTemporalScopeChip(TimelineTemporalScope scope, {String? locale}) {
  return switch (scope.kind) {
    TimelineTemporalScopeKind.none => null,
    TimelineTemporalScopeKind.year => ActiveChipSpec(
      id: const TemporalScopeChipId(),
      label: DateFormat.y(locale).format(DateTime(scope.year!)),
      visual: ChipVisual.when,
    ),
    TimelineTemporalScopeKind.month => ActiveChipSpec(
      id: const TemporalScopeChipId(),
      label: DateFormat.yMMM(locale).format(DateTime(scope.year!, scope.month!)),
      visual: ChipVisual.when,
    ),
  };
}
```

- [ ] **Step 7: Run temporal chip helper tests and verify they pass**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/active_temporal_scope_chip_test.dart
```

Expected: all tests pass.

- [ ] **Step 8: Write failing test for custom chip removal**

Append this test to `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`:

```dart
testWidgets('custom onRemove overrides provider chip removal', (tester) async {
  var removed = 0;
  const spec = ActiveChipSpec(id: TemporalScopeChipId(), label: '2025', visual: ChipVisual.when);

  await tester.pumpConsumerWidget(ActiveFilterChip(spec: spec, onRemove: () => removed++));
  await tester.pumpAndSettle();

  await tester.tap(find.byIcon(Icons.close_rounded));
  await tester.pumpAndSettle();

  expect(removed, 1);
});
```

- [ ] **Step 9: Run chip widget test and verify it fails**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/filter_sheet/active_filter_chip_test.dart
```

Expected: fail because `ActiveFilterChip` has no `onRemove` parameter.

- [ ] **Step 10: Add optional `onRemove` callback**

In `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`, update the constructor and tap handler:

```dart
class ActiveFilterChip extends ConsumerWidget {
  final ActiveChipSpec spec;
  final VoidCallback? onRemove;
  const ActiveFilterChip({super.key, required this.spec, this.onRemove});
```

Replace the close tap body with:

```dart
onTap: () {
  HapticFeedback.selectionClick();
  final onRemove = this.onRemove;
  if (onRemove != null) {
    onRemove();
  } else {
    ref.read(photosFilterProvider.notifier).removeChip(spec.id);
  }
},
```

- [ ] **Step 11: Run Task 1 tests**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/photos_filter/active_temporal_scope_chip_test.dart \
  test/providers/photos_filter/chip_id_test.dart \
  test/providers/photos_filter/photos_filter_provider_test.dart \
  test/presentation/widgets/filter_sheet/active_filter_chip_test.dart
```

Expected: all tests pass.

- [ ] **Step 12: Task 1 self-review**

Check:

- Normal chips still call `photosFilterProvider.notifier.removeChip`.
- `TemporalScopeChipId` is a no-op in `removeChip` and does not change `SearchFilter`.
- `TemporalScopeChipId` equality matches the value-less id pattern in `chip_id.dart`.
- Temporal chip labels use `DateFormat.y` and `DateFormat.yMMM`, not hard-coded month strings.

## Task 2: Photos Filter Subheader Temporal Scope Composition

**Files:**

- Modify: `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart`
- Test: `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`

- [ ] **Step 1: Write failing subheader tests**

Append these imports to `mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart`:

```dart
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
```

Then append these tests:

```dart
testWidgets('renders when only temporal scope is active', (tester) async {
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));

  container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
  await tester.pumpAndSettle();

  expect(find.byKey(const Key('photos-filter-subheader')), findsOneWidget);
  expect(find.text('2025'), findsOneWidget);
  expect(find.byType(ActiveFilterChip), findsOneWidget);
});

testWidgets('clearing temporal chip keeps normal Photos filters intact', (tester) async {
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
  container.read(photosFilterProvider.notifier).setText('paris');
  container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
  await tester.pumpAndSettle();

  await tester.tap(find.descendant(of: find.widgetWithText(ActiveFilterChip, 'Mar 2025'), matching: find.byIcon(Icons.close_rounded)));
  await tester.pumpAndSettle();

  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(container.read(photosFilterProvider).context, 'paris');
  expect(find.text('"paris"'), findsOneWidget);
});

testWidgets('clear all resets normal filters and temporal scope', (tester) async {
  await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
  container.read(photosFilterProvider.notifier).setText('paris');
  container.read(timelineTemporalScopeProvider.notifier).setYear(2025);
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(const Key('photos-filter-subheader-clear-all')));
  await tester.pumpAndSettle();

  expect(container.read(photosFilterProvider).isEmpty, isTrue);
  expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
});
```

- [ ] **Step 2: Run subheader tests and verify they fail**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/photos_filter/filter_subheader_test.dart
```

Expected: fail because the subheader ignores `timelineTemporalScopeProvider`, cannot render a temporal-only chip, and Clear all does not clear temporal scope.

- [ ] **Step 3: Compose temporal scope in subheader**

In `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart` add imports:

```dart
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
```

Update `build`:

```dart
final isFilterEmpty = ref.watch(photosFilterProvider.select((f) => f.isEmpty));
final temporalScope = ref.watch(timelineTemporalScopeProvider);
if (isFilterEmpty && temporalScope.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());

final filter = ref.watch(photosFilterProvider);
final debounced = ref.watch(photosFilterDebouncedProvider);
final suggestions = ref.watch(photosFilterSuggestionsProvider(debounced)).valueOrNull;
final temporalChip = activeTemporalScopeChip(temporalScope, locale: Localizations.localeOf(context).toLanguageTag());
final chips = [
  ...activeChipsFromFilter(filter, suggestions: suggestions),
  if (temporalChip != null) temporalChip,
];
```

Update Clear all:

```dart
ref.read(photosFilterProvider.notifier).reset();
ref.read(timelineTemporalScopeProvider.notifier).clear();
```

Render temporal chips with a custom remove handler:

```dart
itemBuilder: (_, i) {
  final chip = chips[i];
  return Center(
    child: ActiveFilterChip(
      spec: chip,
      onRemove: chip.id is TemporalScopeChipId
          ? () => ref.read(timelineTemporalScopeProvider.notifier).clear()
          : null,
    ),
  );
},
```

- [ ] **Step 4: Run subheader tests and verify they pass**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/photos_filter/filter_subheader_test.dart
```

Expected: all tests pass.

- [ ] **Step 5: Task 2 self-review**

Check:

- The subheader is hidden only when both normal filters and temporal scope are empty.
- The temporal chip clears only temporal scope.
- Clear all clears both temporal and non-temporal filters.
- Existing match-count and filter-suggestions behavior remains untouched.

## Task 3: Overview Drilldown Provider And Card Tap Wiring

**Files:**

- Create: `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`
- Test: `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`

- [ ] **Step 1: Write failing provider tests**

Create `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  test('year drilldown sets year scope and switches grouping to month', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(photosFilterProvider.notifier).setText('paris');

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025), assetCount: 3),
      GroupAssetsBy.year,
    );

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2025));
    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
    expect(container.read(photosFilterProvider).context, 'paris');
  });

  test('month drilldown sets month scope and switches grouping to day', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3), assetCount: 4),
      GroupAssetsBy.month,
    );

    expect(container.read(timelineTemporalScopeProvider), TimelineTemporalScope.month(year: 2025, month: 3));
    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
  });

  test('non-overview grouping is ignored', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.year.index);

    await container.read(photosTimelineOverviewDrilldownProvider)(
      TimeBucket(date: DateTime(2025, 3, 2), assetCount: 1),
      GroupAssetsBy.day,
    );

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
    expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
  });
}
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/timeline/overview_drilldown_provider_test.dart
```

Expected: fail because `overview_drilldown.provider.dart` does not exist.

- [ ] **Step 3: Implement drilldown providers**

Create `mobile/lib/providers/timeline/overview_drilldown.provider.dart`:

```dart
import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

typedef TimelineOverviewDrilldownHandler = Future<void> Function(TimeBucket bucket, GroupAssetsBy groupBy);

final timelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler?>((ref) => null);

final photosTimelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler>((ref) {
  return (bucket, groupBy) async {
    switch (groupBy) {
      case GroupAssetsBy.year:
        ref.read(timelineTemporalScopeProvider.notifier).setYear(bucket.date.year);
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.month.index);
        unawaited(_emitScrollToTop());
      case GroupAssetsBy.month:
        ref.read(timelineTemporalScopeProvider.notifier).setMonth(year: bucket.date.year, month: bucket.date.month);
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.day.index);
        unawaited(_emitScrollToTop());
      case GroupAssetsBy.day || GroupAssetsBy.auto || GroupAssetsBy.none:
        return;
    }
  };
});

Future<void> _emitScrollToTop() async {
  await Future<void>.delayed(Duration.zero);
  EventStream.shared.emit(const ScrollToTopEvent());
}
```

- [ ] **Step 4: Run provider tests and verify they pass**

Run:

```bash
cd mobile
mise exec -- flutter test test/providers/timeline/overview_drilldown_provider_test.dart
```

Expected: all tests pass.

- [ ] **Step 5: Write failing segment tap tests**

Append to `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`:

```dart
testWidgets('overview segment invokes drilldown handler when tapped', (tester) async {
  final calls = <({DateTime date, GroupAssetsBy groupBy})>[];
  final timelineService = TimelineService((
    bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
    assetSource: (offset, count) async => [TestUtils.createRemoteAsset(id: 'asset-1')],
    origin: TimelineOrigin.main,
  ));
  addTearDown(timelineService.dispose);
  final segment = TimelineOverviewSegment(
    firstIndex: 0,
    lastIndex: 0,
    startOffset: 0,
    endOffset: kTimelineOverviewSegmentExtent,
    firstAssetIndex: 0,
    bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
    groupBy: GroupAssetsBy.year,
    header: HeaderType.year,
  );

  await tester.pumpWidget(
    EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: ProviderScope(
        overrides: [
          timelineServiceProvider.overrideWithValue(timelineService),
          timelineOverviewDrilldownProvider.overrideWith(
            (ref) => (bucket, groupBy) async => calls.add((date: bucket.date, groupBy: groupBy)),
          ),
        ],
        child: MaterialApp(home: Scaffold(body: Builder(builder: (context) => segment.builder(context, 0)))),
      ),
    ),
  );

  await tester.pumpAndSettle();
  await tester.tap(find.byType(TimelineOverviewCard));
  await tester.pumpAndSettle();

  expect(calls, [(date: DateTime(2025), groupBy: GroupAssetsBy.year)]);
});

testWidgets('overview segment without drilldown handler is not tappable', (tester) async {
  final timelineService = TimelineService((
    bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: 1)]),
    assetSource: (offset, count) async => [TestUtils.createRemoteAsset(id: 'asset-1')],
    origin: TimelineOrigin.main,
  ));
  addTearDown(timelineService.dispose);
  final segment = TimelineOverviewSegment(
    firstIndex: 0,
    lastIndex: 0,
    startOffset: 0,
    endOffset: kTimelineOverviewSegmentExtent,
    firstAssetIndex: 0,
    bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
    groupBy: GroupAssetsBy.year,
    header: HeaderType.year,
  );

  await tester.pumpWidget(
    EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: ProviderScope(
        overrides: [timelineServiceProvider.overrideWithValue(timelineService)],
        child: MaterialApp(home: Scaffold(body: Builder(builder: (context) => segment.builder(context, 0)))),
      ),
    ),
  );

  await tester.pumpAndSettle();

  final card = tester.widget<TimelineOverviewCard>(find.byType(TimelineOverviewCard));
  expect(card.onTap, isNull);
});
```

Add this import to `mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart`:

```dart
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
```

- [ ] **Step 6: Run segment tap tests and verify they fail**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
```

Expected: fail because `TimelineOverviewSegment` does not read `timelineOverviewDrilldownProvider` or pass `onTap`.

- [ ] **Step 7: Wire segment cards to the nullable drilldown handler**

In `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`, import:

```dart
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
```

In `_TimelineOverviewSegmentCard.build`, add this immediately after the existing non-time-bucket guard:

```dart
final drilldown = ref.watch(timelineOverviewDrilldownProvider);
final onTap = drilldown != null && bucket.assetCount > 0
    ? () => unawaited(drilldown(bucket, segment.groupBy))
    : null;
```

Add `import 'dart:async';` at the top.

Pass `onTap` in both card returns:

```dart
return TimelineOverviewCard(
  bucket: bucket,
  groupBy: segment.groupBy,
  representativeAsset: representativeAsset,
  onTap: onTap,
);
```

and:

```dart
return TimelineOverviewCard(
  bucket: bucket,
  groupBy: segment.groupBy,
  representativeAsset: assets.firstOrNull,
  onTap: onTap,
);
```

- [ ] **Step 8: Run Task 3 tests**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/timeline/overview_drilldown_provider_test.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
```

Expected: all tests pass.

- [ ] **Step 9: Task 3 self-review**

Check:

- Default `timelineOverviewDrilldownProvider` is null so shared routes are not changed in this slice.
- Photos handler preserves non-time filters by touching only `timelineTemporalScopeProvider` and `Setting.groupAssetsBy`.
- Year cards switch to month grouping; month cards switch to day grouping.
- Empty buckets do not get tap behavior.

## Task 4: Main Photos Route App-Bar Integration

**Files:**

- Modify: `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
- Test: `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`
- Regression command: `mobile/test/providers/gallery_nav/gallery_search_action_test.dart`

- [ ] **Step 1: Write failing route app-bar test**

Create `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';

void main() {
  group('PhotosTimelineAppBar', () {
    test('configures grouping selector instead of filter icon action', () {
      expect(PhotosTimelineAppBar.actions, hasLength(1));
      expect(PhotosTimelineAppBar.actions.single, isA<TimelineGroupingSelector>());
      expect(PhotosTimelineAppBar.actions.whereType<FilterIconButton>(), isEmpty);
    });
  });
}
```

- [ ] **Step 2: Run route app-bar test and verify it fails**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/pages/dev/main_timeline_page_test.dart
```

Expected: fail because `PhotosTimelineAppBar` and its `actions` constant do not exist.

- [ ] **Step 3: Add `PhotosTimelineAppBar` and route override**

In `mobile/lib/presentation/pages/dev/main_timeline.page.dart`:

Remove:

```dart
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
```

Add imports:

```dart
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
```

Update `ProviderScope` overrides:

```dart
overrides: [
  timelineServiceProvider.overrideWith((ref) => ref.watch(photosTimelineQueryProvider)),
  timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(photosTimelineOverviewDrilldownProvider)),
],
```

Replace the app bar:

```dart
appBar: const PhotosTimelineAppBar(),
```

Add below `_MainTimelinePageState`:

```dart
class PhotosTimelineAppBar extends StatelessWidget {
  const PhotosTimelineAppBar({super.key});

  static const actions = <Widget>[TimelineGroupingSelector()];

  @override
  Widget build(BuildContext context) {
    return const ImmichSliverAppBar(
      floating: true,
      pinned: false,
      snap: false,
      actions: actions,
    );
  }
}
```

- [ ] **Step 4: Run route app-bar test and verify it passes**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/pages/dev/main_timeline_page_test.dart
```

Expected: all tests pass.

- [ ] **Step 5: Run Slice 4 regression tests**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/photos_filter/active_temporal_scope_chip_test.dart \
  test/providers/photos_filter/chip_id_test.dart \
  test/presentation/widgets/filter_sheet/active_filter_chip_test.dart \
  test/presentation/widgets/photos_filter/filter_subheader_test.dart \
  test/providers/timeline/overview_drilldown_provider_test.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart \
  test/presentation/pages/dev/main_timeline_page_test.dart \
  test/presentation/widgets/timeline/timeline_grouping_selector_test.dart \
  test/providers/photos_filter/timeline_temporal_filter_provider_test.dart \
  test/providers/photos_filter/timeline_query_provider_test.dart \
  test/providers/gallery_nav/gallery_search_action_test.dart
```

Expected: all tests pass. This covers the bottom search path regression without restoring a top app-bar filter icon.

- [ ] **Step 6: Run analyzer for changed Dart files**

Run:

```bash
cd mobile
mise exec -- dart analyze \
  lib/providers/photos_filter/chip_id.dart \
  lib/providers/photos_filter/photos_filter.provider.dart \
  lib/providers/photos_filter/active_chips.dart \
  lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart \
  lib/presentation/widgets/photos_filter/filter_subheader.widget.dart \
  lib/providers/timeline/overview_drilldown.provider.dart \
  lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
  lib/presentation/pages/dev/main_timeline.page.dart
```

Expected: `No issues found!`

- [ ] **Step 7: Diff and whitespace checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended Slice 4 files are modified or added.

- [ ] **Step 8: Commit Slice 4 implementation**

Run:

```bash
git add \
  mobile/lib/providers/photos_filter/chip_id.dart \
  mobile/lib/providers/photos_filter/photos_filter.provider.dart \
  mobile/lib/providers/photos_filter/active_chips.dart \
  mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart \
  mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart \
  mobile/lib/providers/timeline/overview_drilldown.provider.dart \
  mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
  mobile/lib/presentation/pages/dev/main_timeline.page.dart \
  mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart \
  mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart \
  mobile/test/presentation/widgets/photos_filter/filter_subheader_test.dart \
  mobile/test/providers/timeline/overview_drilldown_provider_test.dart \
  mobile/test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart \
  mobile/test/presentation/pages/dev/main_timeline_page_test.dart
git commit -m "feat(mobile): wire timeline overview drilldown"
```

Expected: commit succeeds.

## Slice 4 Review Checklist

- TDD order is preserved for every behavior:
  - Temporal chip helper red before implementation.
  - Custom chip removal red before implementation.
  - Subheader temporal scope red before implementation.
  - Drilldown provider red before implementation.
  - Segment tap wiring red before implementation.
  - Photos app-bar replacement red before implementation.
- Tests cover:
  - Year temporal chip label and id.
  - Month temporal chip label and id.
  - No chip for no temporal scope.
  - Temporal chip clears only temporal scope.
  - Clear all clears temporal scope and normal filters.
  - Non-time filters survive drilldown.
  - Year tap switches grouping to `GroupAssetsBy.month`.
  - Month tap switches grouping to `GroupAssetsBy.day`.
  - Non-overview grouping does not mutate scope/settings.
  - Overview cards call the route override when present.
  - Overview cards remain non-tappable when no route override is present.
  - Main Photos app bar contains `TimelineGroupingSelector`, not `FilterIconButton`.
  - Bottom search action tests still pass.
- Edge cases covered:
  - Temporal-only active state.
  - Combined normal filter plus temporal scope.
  - Clearing temporal scope while a text filter is active.
  - Empty scope hidden state.
  - Non-Photos routes default to no drilldown handler.
  - Empty buckets do not become tappable.
- Scope guard:
  - Do not adopt non-Photos routes in this slice.
  - Do not implement accessibility semantic labels for overview cards here; that is Slice 6.
  - Do not add a new top-right search/filter icon.
  - Do not change `GroupAssetsBy` enum indexes.
