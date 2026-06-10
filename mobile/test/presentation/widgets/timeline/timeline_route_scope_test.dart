import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';

TimelineService _emptyService(TimelineOrigin origin) {
  return TimelineService((
    bucketSource: () => Stream.value(const <Bucket>[]),
    assetSource: (offset, count) async => const <BaseAsset>[],
    origin: origin,
  ));
}

String _anchorLabel(TimelineZoomAnchor anchor) {
  return switch (anchor) {
    TimelineZoomAnchorNone() => 'none',
    TimelineZoomYearAnchor(:final year) => 'year:$year',
    TimelineZoomMonthAnchor(:final year, :final month) => 'month:$year-$month',
    TimelineZoomDateAnchor(:final date) => 'date:$date',
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  testWidgets('isolates temporal scope across sibling route subtrees', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Row(
            children: [
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) => TextButton(
                    key: const Key('left'),
                    onPressed: () => ref.read(timelineTemporalScopeProvider.notifier).setYear(2025),
                    child: Text('left:${ref.watch(timelineTemporalScopeProvider).kind.name}'),
                  ),
                ),
              ),
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) =>
                      Text('right:${ref.watch(timelineTemporalScopeProvider).kind.name}', key: const Key('right')),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('left:none'), findsOneWidget);
    expect(find.text('right:none'), findsOneWidget);

    await tester.tap(find.byKey(const Key('left')));
    await tester.pump();

    expect(find.text('left:year'), findsOneWidget);
    expect(find.text('right:none'), findsOneWidget);
  });

  testWidgets('isolates zoom anchors across sibling route subtrees', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Row(
            children: [
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) => TextButton(
                    key: const Key('left-anchor'),
                    onPressed: () => ref.read(timelineZoomAnchorProvider.notifier).setYear(2025),
                    child: Text('left:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}'),
                  ),
                ),
              ),
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) => Text(
                    'right:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
                    key: const Key('right-anchor'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('left:none'), findsOneWidget);
    expect(find.text('right:none'), findsOneWidget);

    await tester.tap(find.byKey(const Key('left-anchor')));
    await tester.pump();

    expect(find.text('left:year:2025'), findsOneWidget);
    expect(find.text('right:none'), findsOneWidget);
  });

  testWidgets('overrides overview drilldown with shared handler', (tester) async {
    TimelineOverviewDrilldownHandler? routeHandler;
    TimelineOverviewDrilldownHandler? sharedHandler;

    await tester.pumpWidget(
      ProviderScope(
        child: TimelineRouteScope(
          child: Consumer(
            builder: (context, ref, child) {
              routeHandler = ref.watch(timelineOverviewDrilldownProvider);
              sharedHandler = ref.watch(sharedTimelineOverviewDrilldownProvider);
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );

    expect(routeHandler, isNotNull);
    expect(routeHandler, same(sharedHandler));
  });

  testWidgets('overview drilldown updates only the invoking route zoom anchor', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Row(
            children: [
              Expanded(
                child: TimelineRouteScope(
                  child: Consumer(
                    builder: (context, ref, child) => TextButton(
                      key: const Key('left-drilldown'),
                      onPressed: () {
                        final handler = ref.read(timelineOverviewDrilldownProvider);
                        handler?.call(TimeBucket(date: DateTime(2025), assetCount: 4), GroupAssetsBy.year);
                      },
                      child: Text(
                        'left:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}:${ref.watch(timelineGroupingProvider).name}',
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: TimelineRouteScope(
                  child: Consumer(
                    builder: (context, ref, child) => Text(
                      'right:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}:${ref.watch(timelineGroupingProvider).name}',
                      key: const Key('right-drilldown'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('left:none:none:day'), findsOneWidget);
    expect(find.text('right:none:none:day'), findsOneWidget);

    await tester.tap(find.byKey(const Key('left-drilldown')));
    await tester.pumpAndSettle();

    expect(find.text('left:none:year:2025:month'), findsOneWidget);
    expect(find.text('right:none:none:day'), findsOneWidget);
    // Drilldown inside a route changes only the route-local grouping; the persisted
    // setting is never written.
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
  });

  testWidgets('route grouping opens at All regardless of the persisted setting', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            child: Consumer(
              builder: (context, ref, child) => Text('grouping:${ref.watch(timelineGroupingProvider).name}'),
            ),
          ),
        ),
      ),
    );

    expect(find.text('grouping:day'), findsOneWidget);
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
  });

  testWidgets('grouping changes stay local to the invoking route', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Row(
            children: [
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) => TextButton(
                    key: const Key('left-grouping'),
                    onPressed: () => unawaited(ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.month)),
                    child: Text('left:${ref.watch(timelineGroupingProvider).name}'),
                  ),
                ),
              ),
              TimelineRouteScope(
                child: Consumer(
                  builder: (context, ref, child) =>
                      Text('right:${ref.watch(timelineGroupingProvider).name}', key: const Key('right-grouping')),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('left:day'), findsOneWidget);
    expect(find.text('right:day'), findsOneWidget);

    await tester.tap(find.byKey(const Key('left-grouping')));
    await tester.pump();

    expect(find.text('left:month'), findsOneWidget);
    expect(find.text('right:day'), findsOneWidget);
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
  });

  testWidgets('persistGrouping: true follows and writes the persisted setting', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            persistGrouping: true,
            child: Consumer(
              builder: (context, ref, child) =>
                  Text('grouping:${ref.watch(timelineGroupingProvider).name}', key: const Key('persist-probe')),
            ),
          ),
        ),
      ),
    );

    expect(find.text('grouping:month'), findsOneWidget);

    final ref = ProviderScope.containerOf(tester.element(find.byKey(const Key('persist-probe'))));
    await tester.runAsync(() => ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.year));
    await tester.pump();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
    expect(find.text('grouping:year'), findsOneWidget);
  });

  testWidgets('timelineServiceProvider rebuilds with the route-local grouping', (tester) async {
    final groupings = <GroupAssetsBy>[];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: (ref, temporalScope, groupBy) {
              groupings.add(groupBy);
              return _emptyService(TimelineOrigin.main);
            },
            child: Consumer(
              builder: (context, ref, child) {
                ref.watch(timelineServiceProvider);
                return TextButton(
                  key: const Key('grouping-service'),
                  onPressed: () => unawaited(ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.month)),
                  child: Text('grouping:${ref.watch(timelineGroupingProvider).name}'),
                );
              },
            ),
          ),
        ),
      ),
    );

    expect(groupings, [GroupAssetsBy.day]);

    await tester.tap(find.byKey(const Key('grouping-service')));
    await tester.pump();

    expect(groupings, [GroupAssetsBy.day, GroupAssetsBy.month]);
  });

  testWidgets('grouping selector tap inside a route stays route-local', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            child: CustomScrollView(slivers: [SliverToBoxAdapter(child: TimelineGroupingSelector())]),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('timeline-grouping-month')));
    await tester.pump();

    final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingSelector)));
    expect(ref.read(timelineGroupingProvider), GroupAssetsBy.month);
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
  });

  testWidgets('timelineServiceProvider rebuilds from route-local temporal scope changes', (tester) async {
    final scopes = <TimelineTemporalScope>[];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: (ref, temporalScope, groupBy) {
              scopes.add(temporalScope);
              return _emptyService(switch (temporalScope.kind) {
                TimelineTemporalScopeKind.none => TimelineOrigin.main,
                TimelineTemporalScopeKind.year => TimelineOrigin.favorite,
                TimelineTemporalScopeKind.month => TimelineOrigin.archive,
              });
            },
            child: Consumer(
              builder: (context, ref, child) => TextButton(
                key: const Key('scope'),
                onPressed: () => ref.read(timelineTemporalScopeProvider.notifier).setYear(2025),
                child: Text(ref.watch(timelineServiceProvider).origin.name),
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text(TimelineOrigin.main.name), findsOneWidget);
    expect(scopes, [const TimelineTemporalScope.none()]);

    await tester.tap(find.byKey(const Key('scope')));
    await tester.pump();

    expect(find.text(TimelineOrigin.favorite.name), findsOneWidget);
    expect(scopes, [const TimelineTemporalScope.none(), const TimelineTemporalScope.year(2025)]);
  });
}
