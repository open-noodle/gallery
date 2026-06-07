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
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/temporal_scope.provider.dart';
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
                        'left:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: TimelineRouteScope(
                  child: Consumer(
                    builder: (context, ref, child) => Text(
                      'right:${ref.watch(timelineTemporalScopeProvider).kind.name}:${_anchorLabel(ref.watch(timelineZoomAnchorProvider))}',
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

    expect(find.text('left:none:none'), findsOneWidget);
    expect(find.text('right:none:none'), findsOneWidget);

    await tester.tap(find.byKey(const Key('left-drilldown')));
    await tester.pumpAndSettle();

    expect(find.text('left:none:year:2025'), findsOneWidget);
    expect(find.text('right:none:none'), findsOneWidget);
    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
  });

  testWidgets('timelineServiceProvider rebuilds from route-local temporal scope changes', (tester) async {
    final scopes = <TimelineTemporalScope>[];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: (ref, temporalScope) {
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
