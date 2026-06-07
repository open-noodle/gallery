# Mobile Timeline Overview Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the mobile timeline grouping selector and temporal drilldown on shared photo routes, while forcing asset-picking and embedded workflows to stay in selectable day mode.

**Architecture:** Promote the Slice 4 Photos drilldown handler into a shared timeline handler, wrap adopted routes in a reusable route-local timeline scope, and pass temporal scope into the timeline repository/factory methods that back those routes. Non-Photos routes use a lightweight top-of-content selector/chip sliver; picker, search, cleanup, and map-embedded timelines keep explicit non-overview group modes.

**Tech Stack:** Flutter, hooks_riverpod, mocktail, Drift repository tests, existing `Timeline`, `TimelineFactory`, `TimelineTemporalScope`, `TimelineGroupingSelector`, and overview card segments.

---

## Current Baseline

- Spec: `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`
- Slice 4 commit: `08a8d545b4 feat(mobile): wire timeline overview drilldown`
- Main Photos already:
  - shows `TimelineGroupingSelector` in the app bar,
  - surfaces temporal scope through `PhotosFilterSubheader`,
  - wires overview-card taps to temporal scope and grouping changes.

## Slice 5 Scope

Adopt shared route support for:

- Main Photos route-local temporal scope.
- People timelines.
- Remote albums.
- Local albums.
- Shared spaces.
- Favorites.
- Archive.
- Trash.
- Locked folder.
- Videos.
- Recently taken.
- Places.
- Partner detail timelines.

Guard non-overview workflows:

- `DriftAssetSelectionTimelinePage` must force day buckets and day rendering.
- `MapBottomSheet` timeline must force day buckets and day rendering.
- `CleanupPreviewPage` must remain day/read-only.
- Search result timelines must remain `GroupAssetsBy.none`.

Do not implement Slice 6 accessibility/localization polish here beyond reusing existing visible chip labels.

## Files And Responsibilities

- Modify `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
  - Add a shared drilldown provider name.
  - Keep `photosTimelineOverviewDrilldownProvider` as an alias for existing tests and imports.
- Create `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`
  - Route-local temporal scope override.
  - Shared overview drilldown override.
  - Optional route-local `timelineServiceProvider` builder that receives the active temporal scope.
- Modify `mobile/lib/domain/services/timeline.service.dart`
  - Add optional `TimelineTemporalScope` and `GroupAssetsBy? groupBy` parameters to route factory methods.
- Modify `mobile/lib/infrastructure/repositories/timeline.repository.dart`
  - Add temporal-scope predicates for remote and local query paths.
  - Apply the predicates to both bucket and asset queries, including `GroupAssetsBy.none` count queries where supported.
- Create `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart`
  - Top-of-content selector/chip sliver for non-Photos routes.
  - Hidden during selected or forced multi-select mode.
- Modify `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
  - Fix top-sliver height addition used by scrubber snapping.
- Modify adopted route pages
  - Use `TimelineRouteScope`.
  - Pass route-local temporal scope into the factory method.
  - Add `TimelineGroupingHeaderSliver` and correct `topSliverWidgetHeight`.
- Modify guarded pages/widgets
  - Force day or none grouping through both factory query and rendered `Timeline`.

## Task 1: Shared Drilldown And Route-Local Scope Harness

**Files:**

- Modify: `mobile/lib/providers/timeline/overview_drilldown.provider.dart`
- Create: `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`
- Test: `mobile/test/providers/timeline/overview_drilldown_provider_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`

- [ ] **Step 1: Write failing tests for shared drilldown naming and route-local service scope**

Create `mobile/test/presentation/widgets/timeline/timeline_route_scope_test.dart`:

```dart
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

TimelineService _emptyService(TimelineOrigin origin) {
  return TimelineService((
    bucketSource: () => Stream.value(const <Bucket>[]),
    assetSource: (offset, count) async => const <BaseAsset>[],
    origin: origin,
  ));
}

void main() {
  testWidgets('TimelineRouteScope provides isolated temporal scope per route subtree', (tester) async {
    late WidgetRef firstRef;
    late WidgetRef secondRef;

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Column(
          children: [
            TimelineRouteScope(child: Consumer(builder: (_, ref, __) { firstRef = ref; return const SizedBox(); })),
            TimelineRouteScope(child: Consumer(builder: (_, ref, __) { secondRef = ref; return const SizedBox(); })),
          ],
        ),
      ),
    );

    firstRef.read(timelineTemporalScopeProvider.notifier).setYear(2025);
    await tester.pump();

    expect(firstRef.read(timelineTemporalScopeProvider), const TimelineTemporalScope.year(2025));
    expect(secondRef.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  testWidgets('TimelineRouteScope wires shared overview drilldown handler by default', (tester) async {
    late WidgetRef scopedRef;

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: TimelineRouteScope(
          child: Consumer(builder: (_, ref, __) { scopedRef = ref; return const SizedBox(); }),
        ),
      ),
    );

    expect(scopedRef.read(timelineOverviewDrilldownProvider), same(scopedRef.read(sharedTimelineOverviewDrilldownProvider)));
  });

  testWidgets('TimelineRouteScope rebuilds its service from route-local temporal scope', (tester) async {
    final seenScopes = <TimelineTemporalScope>[];
    late WidgetRef scopedRef;

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: TimelineRouteScope(
          timelineServiceBuilder: (ref, scope) {
            seenScopes.add(scope);
            return _emptyService(TimelineOrigin.person);
          },
          child: Consumer(builder: (_, ref, __) { scopedRef = ref; ref.watch(timelineServiceProvider); return const SizedBox(); }),
        ),
      ),
    );

    expect(seenScopes.last, const TimelineTemporalScope.none());

    scopedRef.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
    await tester.pump();

    expect(seenScopes.last, TimelineTemporalScope.month(year: 2025, month: 3));
  });
}
```

Update `mobile/test/providers/timeline/overview_drilldown_provider_test.dart` so the year/month/no-op drilldown tests read `sharedTimelineOverviewDrilldownProvider`. Keep one alias assertion that `photosTimelineOverviewDrilldownProvider` returns the shared handler.

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/timeline/overview_drilldown_provider_test.dart \
  test/presentation/widgets/timeline/timeline_route_scope_test.dart
```

Expected: compile failure because `sharedTimelineOverviewDrilldownProvider`, `TimelineRouteScope`, and `timelineServiceBuilder` do not exist.

- [ ] **Step 3: Add shared provider and route scope**

In `overview_drilldown.provider.dart`, move the current Photos handler body into:

```dart
final sharedTimelineOverviewDrilldownProvider = Provider<TimelineOverviewDrilldownHandler>((ref) {
  return (bucket, groupBy) async {
    switch (groupBy) {
      case GroupAssetsBy.year:
        ref.read(timelineTemporalScopeProvider.notifier).setYear(bucket.date.year);
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.month.index);
      case GroupAssetsBy.month:
        ref.read(timelineTemporalScopeProvider.notifier).setMonth(year: bucket.date.year, month: bucket.date.month);
        await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, GroupAssetsBy.day.index);
      case GroupAssetsBy.day:
      case GroupAssetsBy.auto:
      case GroupAssetsBy.none:
        return;
    }

    await Future<void>.delayed(Duration.zero);
    EventStream.shared.emit(const ScrollToTopEvent());
  };
});

final photosTimelineOverviewDrilldownProvider = sharedTimelineOverviewDrilldownProvider;
```

Create `timeline_route_scope.dart`:

```dart
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

typedef TimelineRouteServiceBuilder = TimelineService Function(Ref ref, TimelineTemporalScope temporalScope);

class TimelineRouteScope extends StatelessWidget {
  const TimelineRouteScope({super.key, required this.child, this.timelineServiceBuilder, this.overrides = const []});

  final Widget child;
  final TimelineRouteServiceBuilder? timelineServiceBuilder;
  final List<Override> overrides;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        timelineTemporalScopeProvider.overrideWith(TimelineTemporalScopeNotifier.new),
        timelineOverviewDrilldownProvider.overrideWith((ref) => ref.watch(sharedTimelineOverviewDrilldownProvider)),
        if (timelineServiceBuilder != null)
          timelineServiceProvider.overrideWith((ref) {
            final service = timelineServiceBuilder!(ref, ref.watch(timelineTemporalScopeProvider));
            ref.onDispose(service.dispose);
            return service;
          }),
        ...overrides,
      ],
      child: child,
    );
  }
}
```

- [ ] **Step 4: Run tests and verify green**

Run the same command as Step 2.

Expected: all tests pass.

## Task 2: Temporal Scope In Repository And Factory Queries

**Files:**

- Modify: `mobile/lib/domain/services/timeline.service.dart`
- Modify: `mobile/lib/infrastructure/repositories/timeline.repository.dart`
- Test: `mobile/test/infrastructure/repositories/timeline_temporal_scope_repository_test.dart`
- Test: `mobile/test/domain/services/timeline_factory_temporal_scope_test.dart`

- [ ] **Step 1: Write failing repository tests for every adopted route family**

Create `mobile/test/infrastructure/repositories/timeline_temporal_scope_repository_test.dart`. Use `MediumRepositoryContext` from `mobile/test/medium/repository_context.dart`; define any extra local insert helpers in this test file for `assetFaceEntity`, `remoteExifEntity`, and map bounds. Do not reference non-existent helpers.

The test file must include these cases:

- `remote()` year scope filters buckets and assets for recently taken/partner-detail origins.
- `remote()` `GroupAssetsBy.none` count query respects year scope.
- `favorite()` year scope keeps favorite constraint.
- `archived()` year scope keeps archive visibility.
- `trash()` year scope keeps deleted constraint.
- `locked()` year scope keeps locked visibility.
- `remoteAlbum()` month scope keeps album membership and filters both buckets and assets.
- `remoteAlbum()` `GroupAssetsBy.none` count query respects month scope.
- `localAlbum()` year scope keeps album membership and filters both buckets and assets.
- `localAlbum()` `GroupAssetsBy.none` count query respects year scope.
- `sharedSpace()` year scope keeps direct asset membership.
- `sharedSpace()` `GroupAssetsBy.none` count query respects scope.
- `video()` year scope keeps video type and visibility.
- `place()` year scope keeps place and visibility.
- `person()` year scope keeps visible face/person constraint.
- `person()` `GroupAssetsBy.none` count query respects scope.
- `map()` year scope keeps bounds, favorites, archive, partner visibility, and relative-day constraints.
- December 31 and January 1 assets fall into the correct year scopes.
- February 29 assets fall into the correct month scope.
- A remote asset with `localDateTime = null` uses existing `createdAt` fallback semantics. Write this test by updating the inserted remote asset row directly with `RemoteAssetEntityCompanion(localDateTime: Value(null))`, because `MediumRepositoryContext.newRemoteAsset()` always fills `localDateTime`.

Use this helper skeleton at the top of the test:

```dart
Future<List<TimeBucket>> timeBuckets(TimelineQuery query) async {
  final buckets = await query.bucketSource().first;
  return buckets.cast<TimeBucket>();
}

Future<List<String>> assetIds(TimelineQuery query) async {
  final assets = await query.assetSource(0, 100);
  return assets.map((asset) => asset.id).toList();
}
```

Example required test:

```dart
test('remoteAlbum month scope filters buckets, assets, and none-count buckets inside the album', () async {
  final user = await ctx.newUser();
  final album = await ctx.newRemoteAlbum(ownerId: user.id, order: AlbumAssetOrder.desc);
  final mar = await ctx.newRemoteAsset(id: 'album-mar', ownerId: user.id, createdAt: DateTime(2025, 3, 7, 12));
  final apr = await ctx.newRemoteAsset(id: 'album-apr', ownerId: user.id, createdAt: DateTime(2025, 4, 7, 12));
  final outside = await ctx.newRemoteAsset(id: 'not-album-mar', ownerId: user.id, createdAt: DateTime(2025, 3, 8, 12));
  await ctx.insertRemoteAlbumAsset(albumId: album.id, assetId: mar.id);
  await ctx.insertRemoteAlbumAsset(albumId: album.id, assetId: apr.id);

  final scoped = sut.remoteAlbum(
    album.id,
    GroupAssetsBy.month,
    temporalScope: TimelineTemporalScope.month(year: 2025, month: 3),
  );
  expect(await timeBuckets(scoped), [TimeBucket(date: DateTime(2025, 3), assetCount: 1)]);
  expect(await assetIds(scoped), ['album-mar']);

  final none = await sut
      .remoteAlbum(album.id, GroupAssetsBy.none, temporalScope: TimelineTemporalScope.month(year: 2025, month: 3))
      .bucketSource()
      .first;
  expect(none.fold<int>(0, (sum, bucket) => sum + bucket.assetCount), 1);
  expect(outside.id, isNot('album-mar'));
});
```

- [ ] **Step 2: Write failing factory tests for scope and forced group overrides**

Create `mobile/test/domain/services/timeline_factory_temporal_scope_test.dart` with a mock `DriftTimelineRepository` and stub settings service. Verify every factory method forwards both `temporalScope` and optional `groupBy`:

- `remoteAssets(userId, temporalScope: year, groupBy: day)`
- `localAlbum(albumId, temporalScope: year, groupBy: day)`
- `remoteAlbum(albumId, temporalScope: month, groupBy: day)`
- `sharedSpace(spaceId, temporalScope: year, groupBy: month)`
- `favorite`, `trash`, `archive`, `lockedFolder`
- `video`, `place`, `person`, `map`

Expected red failure: method signatures do not accept `temporalScope` or `groupBy`.

- [ ] **Step 3: Run tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/infrastructure/repositories/timeline_temporal_scope_repository_test.dart \
  test/domain/services/timeline_factory_temporal_scope_test.dart
```

Expected: compile failures for missing `temporalScope` and `groupBy` parameters.

- [ ] **Step 4: Add temporal-scope predicates to repository queries**

Import `TimelineTemporalScope` in `timeline.repository.dart`; keep the existing `easy_localization` `DateFormat` import available for date formatting. Add helpers:

```dart
final _scopeDateFormat = DateFormat('yyyy-MM-dd', 'en');

Expression<bool> _remoteWithinTemporalScope($RemoteAssetEntityTable row, TimelineTemporalScope scope) {
  if (scope.isEmpty) return const Constant(true);
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.effectiveCreatedAt(GroupAssetsBy.day);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}

Expression<bool> _localWithinTemporalScope($LocalAssetEntityTable row, TimelineTemporalScope scope) {
  if (scope.isEmpty) return const Constant(true);
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.createdAt.dateFmt(GroupAssetsBy.day, toLocal: true);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}
```

Add `TimelineTemporalScope temporalScope = const TimelineTemporalScope.none()` to repository methods:

- `localAlbum`
- `remoteAlbum`
- `sharedSpace`
- `remote`
- `favorite`
- `trash`
- `archived`
- `locked`
- `video`
- `place`
- `person`
- `map`

Apply the predicate to both bucket and asset queries. `GroupAssetsBy.none` count queries for `remote`, `remoteAlbum`, `localAlbum`, `sharedSpace`, and `person` must include the same predicate as the corresponding asset query.

- [ ] **Step 5: Thread scope and forced grouping through `TimelineFactory`**

In `timeline.service.dart`, import `TimelineTemporalScope` and add `GroupAssetsBy? groupBy` plus `TimelineTemporalScope temporalScope = const TimelineTemporalScope.none()` to these methods:

- `main`
- `localAlbum`
- `remoteAlbum`
- `sharedSpace`
- `remoteAssets`
- `favorite`
- `trash`
- `archive`
- `lockedFolder`
- `video`
- `place`
- `person`
- `map`

Pattern:

```dart
TimelineService remoteAssets(
  String userId, {
  GroupAssetsBy? groupBy,
  TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
}) =>
    TimelineService(_timelineRepository.remote(userId, groupBy ?? this.groupBy, temporalScope: temporalScope));
```

Use the same pattern for picker/embedded factory methods, especially `remoteAssets` and `map`.

- [ ] **Step 6: Run tests and verify green**

Run the same command as Step 3.

Expected: all tests pass.

## Task 3: Route-Local Grouping Header And Scrubber Offset

**Files:**

- Create: `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_scrubber_offset_test.dart`

- [ ] **Step 1: Write failing widget tests for selector, chip, and forced selection**

Create `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

import '../../../widget_tester_extensions.dart';

Widget _scroll() => const CustomScrollView(slivers: [TimelineGroupingHeaderSliver()]);

void main() {
  testWidgets('renders grouping selector in a top-of-content sliver', (tester) async {
    await tester.pumpConsumerWidget(_scroll());
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsOneWidget);
    expect(find.byType(TimelineGroupingSelector), findsOneWidget);
  });

  testWidgets('renders clearable temporal scope chip', (tester) async {
    await tester.pumpConsumerWidget(_scroll());
    final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
    container.read(timelineTemporalScopeProvider.notifier).setMonth(year: 2025, month: 3);
    await tester.pumpAndSettle();

    expect(find.text('Mar 2025'), findsOneWidget);
    expect(find.byType(ActiveFilterChip), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();

    expect(container.read(timelineTemporalScopeProvider), const TimelineTemporalScope.none());
  });

  testWidgets('hides selector while forced or active multi-select mode is enabled', (tester) async {
    await tester.pumpConsumerWidget(
      _scroll(),
      overrides: [
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(
            const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {}, forceEnable: true),
          ),
        ),
      ],
    );
    await tester.pumpAndSettle();

    expect(find.byType(TimelineGroupingSelector), findsNothing);
  });
}
```

Create `mobile/test/presentation/widgets/timeline/timeline_scrubber_offset_test.dart` and extract a small pure function from `Timeline` named `timelineScrubberSnappingOffset`. Test the helper directly:

```dart
expect(timelineScrubberSnappingOffset(topSliverWidgetHeight: 56, appBarExpandedHeight: 64), 120);
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart \
  test/presentation/widgets/timeline/timeline_scrubber_offset_test.dart
```

Expected: header sliver does not exist and offset helper/test fails because the current expression drops `appBarExpandedHeight` when `topSliverWidgetHeight` is non-null.

- [ ] **Step 3: Implement header sliver and offset fix**

Create `timeline_grouping_header_sliver.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';

const double kTimelineGroupingHeaderSliverHeight = 56.0;

class TimelineGroupingHeaderSliver extends ConsumerWidget {
  const TimelineGroupingHeaderSliver({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectionState = ref.watch(multiSelectProvider);
    if (selectionState.forceEnable || selectionState.isEnabled) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    final scope = ref.watch(timelineTemporalScopeProvider);
    final chip = activeTemporalScopeChip(scope, locale: Localizations.localeOf(context).toLanguageTag());

    return SliverToBoxAdapter(
      child: SizedBox(
        key: const Key('timeline-grouping-header-sliver'),
        height: kTimelineGroupingHeaderSliverHeight,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              const TimelineGroupingSelector(),
              if (chip != null) ...[
                const SizedBox(width: 8),
                ActiveFilterChip(spec: chip, onRemove: () => ref.read(timelineTemporalScopeProvider.notifier).clear()),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
```

In `timeline.widget.dart`, change:

```dart
monthSegmentSnappingOffset: widget.topSliverWidgetHeight ?? 0 + appBarExpandedHeight,
```

to:

```dart
monthSegmentSnappingOffset: (widget.topSliverWidgetHeight ?? 0) + appBarExpandedHeight,
```

Use the tested `timelineScrubberSnappingOffset` helper in the `Scrubber` constructor.

- [ ] **Step 4: Run tests and verify green**

Run the same command as Step 2.

Expected: all tests pass.

## Task 4: Adopt Shared Routes With Scoped Queries

**Files:**

- Modify:
  - `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
  - `mobile/lib/presentation/pages/drift_person.page.dart`
  - `mobile/lib/presentation/pages/drift_remote_album.page.dart`
  - `mobile/lib/presentation/pages/local_timeline.page.dart`
  - `mobile/lib/pages/library/spaces/space_detail.page.dart`
  - `mobile/lib/presentation/pages/drift_favorite.page.dart`
  - `mobile/lib/presentation/pages/drift_archive.page.dart`
  - `mobile/lib/presentation/pages/drift_trash.page.dart`
  - `mobile/lib/presentation/pages/drift_locked_folder.page.dart`
  - `mobile/lib/presentation/pages/drift_video.page.dart`
  - `mobile/lib/presentation/pages/drift_recently_taken.page.dart`
  - `mobile/lib/presentation/pages/drift_place_detail.page.dart`
  - `mobile/lib/presentation/pages/drift_partner_detail.page.dart`
- Test:
  - `mobile/test/presentation/pages/timeline_route_adoption_test.dart`
  - update `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`

- [ ] **Step 1: Write failing route adoption tests**

Create `mobile/test/presentation/pages/timeline_route_adoption_test.dart` with two kinds of tests:

1. A behavioral route-scope harness that proves a non-Photos route can render `TimelineGroupingHeaderSliver`, drill down, and rebuild its service with the new temporal scope.
2. Route contract assertions that every adopted page exposes test-visible constants used by its `Timeline` construction.

Use mocktail for the factory/service calls. The behavioral test must verify the actual `TimelineRouteScope` service-builder behavior rather than a marker constant:

```dart
testWidgets('non-Photos route scope renders selector and rebuilds service with drilldown scope', (tester) async {
  final seenScopes = <TimelineTemporalScope>[];

  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: TimelineRouteScope(
          timelineServiceBuilder: (ref, scope) {
            seenScopes.add(scope);
            return TimelineService((
              bucketSource: () => Stream.value(const <Bucket>[]),
              assetSource: (offset, count) async => const <BaseAsset>[],
              origin: TimelineOrigin.person,
            ));
          },
          child: const CustomScrollView(slivers: [TimelineGroupingHeaderSliver()]),
        ),
      ),
    ),
  );

  expect(find.byType(TimelineGroupingHeaderSliver), findsOneWidget);
  expect(seenScopes.last, const TimelineTemporalScope.none());

  final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingHeaderSliver)));
  await ref.read(sharedTimelineOverviewDrilldownProvider)(TimeBucket(date: DateTime(2025), assetCount: 3), GroupAssetsBy.year);
  await tester.pumpAndSettle();

  expect(seenScopes.last, const TimelineTemporalScope.year(2025));
});
```

For route contract assertions, add test-visible constants that are actually used by each page's `build` method:

- `static const timelineOverviewControlsEnabled = true`
- `static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight` for routes with no existing top sliver.
- `static const timelineOverviewTopSliverHeight = kTimelineGroupingHeaderSliverHeight + existingHeight` for routes with an existing top sliver.

The test must assert all adopted routes and their expected heights:

- Main Photos: no header sliver; uses app-bar selector and `TimelineRouteScope`.
- Person, remote album, local album, favorite, archive, locked, video, recently taken, place: `56`.
- Trash: `56 + 24`.
- Partner detail: `56 + 110`.
- Shared space: `56 + kSyncStatusBannerSliverHeight` after adding or exposing that existing banner height constant.

Expected red failure: the route contracts, route scope usage, and heights do not exist.

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/pages/timeline_route_adoption_test.dart \
  test/presentation/pages/dev/main_timeline_page_test.dart
```

Expected: compile or assertion failures because routes have not been adopted.

- [ ] **Step 3: Update Main Photos to use route-local scope**

Wrap the Photos page body's existing `ProviderScope` equivalent with `TimelineRouteScope`. Keep the app-bar selector from Slice 4 and keep `PhotosFilterSubheader`; do not add `TimelineGroupingHeaderSliver` to Main Photos.

The Photos timeline service override must continue to use the Photos search/filter query provider, but the route-local scope must be the scope read by `photosTimelineEffectiveFilterProvider`.

- [ ] **Step 4: Update non-Photos route pages**

For each adopted route:

- Replace the route-level `ProviderScope` with `TimelineRouteScope`.
- Use `timelineServiceBuilder: (ref, scope) { ... temporalScope: scope ... }`.
- Pass the same route constraints as before.
- Add `topSliverWidget: const TimelineGroupingHeaderSliver()` when there was no existing top sliver.
- Add `topSliverWidgetHeight: kTimelineGroupingHeaderSliverHeight` when there was no existing top sliver.
- For existing top slivers, compose:

```dart
topSliverWidget: const SliverMainAxisGroup(
  slivers: [
    TimelineGroupingHeaderSliver(),
    ExistingTopSliver(),
  ],
),
topSliverWidgetHeight: kTimelineGroupingHeaderSliverHeight + existingHeight,
```

Route-specific factory calls:

- Person: `.person(user.id, person.id, temporalScope: scope)`
- Remote album: `.remoteAlbum(albumId: album.id, temporalScope: scope)`
- Local album: `.localAlbum(albumId: album.id, temporalScope: scope)`
- Shared space: `.sharedSpace(spaceId: widget.spaceId, temporalScope: scope)`
- Favorite: `.favorite(user.id, temporalScope: scope)`
- Archive: `.archive(user.id, temporalScope: scope)`
- Trash: `.trash(user.id, temporalScope: scope)`
- Locked folder: `.lockedFolder(user.id, temporalScope: scope)`
- Videos: `.video(timelineUsers, user.id, temporalScope: scope)`
- Recently taken: `.remoteAssets(user.id, temporalScope: scope)`
- Places: `.place(place, timelineUsers, user.id, temporalScope: scope)`
- Partner detail: `.remoteAssets(partner.id, temporalScope: scope)`

- [ ] **Step 5: Run route tests and verify green**

Run the same command as Step 2.

Expected: all tests pass.

## Task 5: Picker, Embedded, Search, And Cleanup Guardrails

**Files:**

- Modify: `mobile/lib/presentation/pages/drift_asset_selection_timeline.page.dart`
- Modify: `mobile/lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart`
- Modify: `mobile/lib/presentation/pages/search/drift_search.page.dart`
- Modify: `mobile/lib/presentation/pages/cleanup_preview.page.dart`
- Test: `mobile/test/presentation/pages/drift_asset_selection_timeline_page_test.dart`
- Test: `mobile/test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart`
- Test: `mobile/test/presentation/pages/search/drift_search_page_timeline_guardrail_test.dart`
- Test: `mobile/test/presentation/pages/cleanup_preview_page_test.dart`

- [ ] **Step 1: Write failing guardrail tests**

`DriftAssetSelectionTimelinePage` test must pump the page with a mocked `TimelineFactory`, verify `.remoteAssets(user.id, groupBy: GroupAssetsBy.day)` is called, and verify the rendered `Timeline` has `groupBy == GroupAssetsBy.day`.

`MapBottomSheet` test must pump a newly public `MapBottomSheetTimeline` wrapper, verify `.map(..., groupBy: GroupAssetsBy.day)` is called, and verify the rendered `Timeline` has `groupBy == GroupAssetsBy.day`.

Search guardrail test must verify the search results timeline still renders with `GroupAssetsBy.none` and no `TimelineGroupingHeaderSliver`. Extract a test-visible `DriftSearchPage.searchResultsGroupBy` constant, use that constant in the actual `Timeline(groupBy: ...)` constructor, and assert the constant from the test.

Cleanup guardrail test must verify `CleanupPreviewPage` still renders `Timeline(groupBy: GroupAssetsBy.day, readOnly: true)` and no `TimelineGroupingHeaderSliver`.

Expected red failure: picker/map factory methods do not accept forced group overrides, and guardrail constants or widget paths are missing.

- [ ] **Step 2: Run guardrail tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/pages/drift_asset_selection_timeline_page_test.dart \
  test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart \
  test/presentation/pages/search/drift_search_page_timeline_guardrail_test.dart \
  test/presentation/pages/cleanup_preview_page_test.dart
```

Expected: compile or assertion failures before production changes.

- [ ] **Step 3: Force day/none group modes in guarded workflows**

In `DriftAssetSelectionTimelinePage`:

```dart
static const forcedGroupBy = GroupAssetsBy.day;
```

Use both:

```dart
ref.watch(timelineFactoryProvider).remoteAssets(user.id, groupBy: forcedGroupBy);
const Timeline(groupBy: forcedGroupBy);
```

In `MapBottomSheet`, rename/extract the current private `_ScopedMapTimeline` widget to a public `MapBottomSheetTimeline`, use it from `MapBottomSheet`, and expose the forced grouping constant on `MapBottomSheet` so tests and production code share the same value:

```dart
static const forcedTimelineGroupBy = GroupAssetsBy.day;
```

Use both:

```dart
ref.watch(timelineFactoryProvider).map(users, user.id, options, groupBy: MapBottomSheet.forcedTimelineGroupBy);
const Timeline(appBar: null, bottomSheet: null, withScrubber: false, groupBy: MapBottomSheet.forcedTimelineGroupBy);
```

In `DriftSearchPage`, keep the actual results timeline on `GroupAssetsBy.none` using the test-visible constant. Do not add a selector/header.

In `CleanupPreviewPage`, keep the actual timeline on day/read-only. Do not add a selector/header.

- [ ] **Step 4: Run guardrail tests and verify green**

Run the same command as Step 2.

Expected: all tests pass.

## Task 6: Full Slice Verification And Commit

**Files:** no new source files unless tests identify a gap.

- [ ] **Step 1: Run the full Slice 5 targeted test suite**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/timeline/overview_drilldown_provider_test.dart \
  test/presentation/widgets/timeline/timeline_route_scope_test.dart \
  test/infrastructure/repositories/timeline_temporal_scope_repository_test.dart \
  test/domain/services/timeline_factory_temporal_scope_test.dart \
  test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart \
  test/presentation/widgets/timeline/timeline_scrubber_offset_test.dart \
  test/presentation/pages/timeline_route_adoption_test.dart \
  test/presentation/pages/dev/main_timeline_page_test.dart \
  test/presentation/pages/drift_asset_selection_timeline_page_test.dart \
  test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart \
  test/presentation/pages/search/drift_search_page_timeline_guardrail_test.dart \
  test/presentation/pages/cleanup_preview_page_test.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart
```

Expected: all tests pass.

- [ ] **Step 2: Run analyzer on changed production files**

Run:

```bash
cd mobile
mise exec -- dart analyze \
  lib/providers/timeline/overview_drilldown.provider.dart \
  lib/presentation/widgets/timeline/timeline_route_scope.dart \
  lib/domain/services/timeline.service.dart \
  lib/infrastructure/repositories/timeline.repository.dart \
  lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart \
  lib/presentation/widgets/timeline/timeline.widget.dart \
  lib/presentation/pages/dev/main_timeline.page.dart \
  lib/presentation/pages/drift_person.page.dart \
  lib/presentation/pages/drift_remote_album.page.dart \
  lib/presentation/pages/local_timeline.page.dart \
  lib/pages/library/spaces/space_detail.page.dart \
  lib/presentation/pages/drift_favorite.page.dart \
  lib/presentation/pages/drift_archive.page.dart \
  lib/presentation/pages/drift_trash.page.dart \
  lib/presentation/pages/drift_locked_folder.page.dart \
  lib/presentation/pages/drift_video.page.dart \
  lib/presentation/pages/drift_recently_taken.page.dart \
  lib/presentation/pages/drift_place_detail.page.dart \
  lib/presentation/pages/drift_partner_detail.page.dart \
  lib/presentation/pages/drift_asset_selection_timeline.page.dart \
  lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart \
  lib/presentation/pages/search/drift_search.page.dart \
  lib/presentation/pages/cleanup_preview.page.dart
```

Expected: `No issues found!`

- [ ] **Step 3: Run diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only Slice 5 files are modified or added.

- [ ] **Step 4: Commit Slice 5**

Run:

```bash
git add mobile/lib mobile/test
git commit -m "feat(mobile): adopt timeline overview on shared routes"
```

Expected: commit succeeds.

## Slice 5 Review Checklist

- TDD evidence exists for route-local temporal scope isolation and service rebuilding.
- Shared drilldown handler is route-neutral and Photos keeps an alias.
- Temporal scope filters repository bucket and asset queries for every adopted route family.
- `GroupAssetsBy.none` count queries keep temporal scope where supported.
- Factory methods forward both temporal scope and forced group overrides.
- Non-Photos routes render a top-of-content selector/chip row with correct scrubber height offsets.
- Header sliver hides during active or forced multi-select mode.
- Main Photos keeps app-bar selector and `PhotosFilterSubheader`, with route-local temporal scope.
- Picker and map timelines force day buckets and day rendering.
- Search remains `GroupAssetsBy.none`; cleanup preview remains day/read-only.
- No bottom floating control is added.
- No Slice 6 accessibility/localization redesign is included.
