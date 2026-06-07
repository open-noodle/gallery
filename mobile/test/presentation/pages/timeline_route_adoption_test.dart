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
import 'package:immich_mobile/pages/library/spaces/space_detail.page.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/pages/drift_archive.page.dart';
import 'package:immich_mobile/presentation/pages/drift_favorite.page.dart';
import 'package:immich_mobile/presentation/pages/drift_locked_folder.page.dart';
import 'package:immich_mobile/presentation/pages/drift_partner_detail.page.dart';
import 'package:immich_mobile/presentation/pages/drift_person.page.dart';
import 'package:immich_mobile/presentation/pages/drift_place_detail.page.dart';
import 'package:immich_mobile/presentation/pages/drift_recently_taken.page.dart';
import 'package:immich_mobile/presentation/pages/drift_remote_album.page.dart';
import 'package:immich_mobile/presentation/pages/drift_trash.page.dart';
import 'package:immich_mobile/presentation/pages/drift_video.page.dart';
import 'package:immich_mobile/presentation/pages/local_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/overview_drilldown.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
import 'package:immich_mobile/widgets/spaces/sync_status_banner.dart';

TimelineService _emptyService(TimelineOrigin origin) {
  return TimelineService((
    bucketSource: () => const Stream<List<Bucket>>.empty(),
    assetSource: (offset, count) async => const <BaseAsset>[],
    origin: origin,
  ));
}

class _AdoptedRouteCase {
  const _AdoptedRouteCase({required this.label, required this.constraint, required this.origin});

  final String label;
  final String constraint;
  final TimelineOrigin origin;
}

class _ObservedRouteCall {
  const _ObservedRouteCall({required this.constraint, required this.scope, required this.groupBy});

  final String constraint;
  final TimelineTemporalScope scope;
  final GroupAssetsBy groupBy;
}

const _adoptedRouteCases = [
  _AdoptedRouteCase(label: 'remote album', constraint: 'album:album-1', origin: TimelineOrigin.remoteAlbum),
  _AdoptedRouteCase(label: 'space', constraint: 'space:space-1', origin: TimelineOrigin.remoteSpace),
  _AdoptedRouteCase(label: 'person', constraint: 'person:person-1', origin: TimelineOrigin.person),
  _AdoptedRouteCase(label: 'favorites', constraint: 'favorite:true', origin: TimelineOrigin.favorite),
  _AdoptedRouteCase(label: 'archive', constraint: 'archive:true', origin: TimelineOrigin.archive),
  _AdoptedRouteCase(label: 'locked folder', constraint: 'locked:true', origin: TimelineOrigin.lockedFolder),
  _AdoptedRouteCase(label: 'trash', constraint: 'trash:true', origin: TimelineOrigin.trash),
  _AdoptedRouteCase(label: 'videos', constraint: 'media:video', origin: TimelineOrigin.video),
  _AdoptedRouteCase(label: 'place', constraint: 'place:Paris', origin: TimelineOrigin.place),
  _AdoptedRouteCase(label: 'partner', constraint: 'partner:user-2', origin: TimelineOrigin.remoteAssets),
  _AdoptedRouteCase(label: 'recently taken', constraint: 'remote-assets:user-1', origin: TimelineOrigin.remoteAssets),
  _AdoptedRouteCase(label: 'local album', constraint: 'local-album:local-1', origin: TimelineOrigin.localAlbum),
];

GroupAssetsBy _storedGroupBy() {
  return SettingsRepository.instance.appConfig.timeline.groupAssetsBy;
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

  testWidgets('non-Photos route scope renders selector and keeps temporal scope unchanged after zoom activation', (
    tester,
  ) async {
    final seenScopes = <TimelineTemporalScope>[];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: TimelineRouteScope(
            timelineServiceBuilder: (ref, scope) {
              seenScopes.add(scope);
              return TimelineService((
                bucketSource: () => const Stream<List<Bucket>>.empty(),
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
    expect(find.byType(TimelineGroupingSelector), findsOneWidget);
    final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingHeaderSliver)));
    ref.read(timelineServiceProvider);
    expect(seenScopes.last, const TimelineTemporalScope.none());

    await tester.runAsync(
      () async => ref
          .read(timelineOverviewDrilldownProvider)
          ?.call(TimeBucket(date: DateTime(2025), assetCount: 3), GroupAssetsBy.year),
    );
    ref.invalidate(timelineServiceProvider);
    ref.read(timelineServiceProvider);
    await tester.pump();

    expect(seenScopes.last, const TimelineTemporalScope.none());
    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
  });

  group('adopted timeline route contracts', () {
    test('Main Photos keeps app bar selector and route-local controls contract', () {
      expect(MainTimelinePage.timelineOverviewControlsEnabled, isTrue);
      // The Photos app bar leads with the grouping selector (#625); it also carries
      // the live-search sort and filter actions (#654), so it is no longer a single action.
      expect(PhotosTimelineAppBar.actions.first, isA<TimelineGroupingSelector>());
    });

    test('routes expose expected top sliver heights', () {
      expect(DriftPersonPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftPersonPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(RemoteAlbumPage.timelineOverviewControlsEnabled, isTrue);
      expect(RemoteAlbumPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(LocalTimelinePage.timelineOverviewControlsEnabled, isTrue);
      expect(LocalTimelinePage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftFavoritePage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftFavoritePage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftArchivePage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftArchivePage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftLockedFolderPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftLockedFolderPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftVideoPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftVideoPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftRecentlyTakenPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftRecentlyTakenPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftPlaceDetailPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftPlaceDetailPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight);

      expect(DriftTrashPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftTrashPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight + 24);

      expect(DriftPartnerDetailPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftPartnerDetailPage.timelineOverviewTopSliverHeight, kTimelineGroupingHeaderSliverHeight + 110);

      expect(SpaceDetailPage.timelineOverviewControlsEnabled, isTrue);
      expect(
        SpaceDetailPage.timelineOverviewTopSliverHeight(isRemoteSyncing: false),
        kTimelineGroupingHeaderSliverHeight,
      );
      expect(
        SpaceDetailPage.timelineOverviewTopSliverHeight(isRemoteSyncing: true),
        kTimelineGroupingHeaderSliverHeight + kSyncStatusBannerSliverHeight,
      );
    });

    for (final route in _adoptedRouteCases) {
      testWidgets('${route.label} keeps route constraints during year and month zoom', (tester) async {
        await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
        final calls = <_ObservedRouteCall>[];

        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              home: TimelineRouteScope(
                timelineServiceBuilder: (ref, scope) {
                  calls.add(_ObservedRouteCall(constraint: route.constraint, scope: scope, groupBy: _storedGroupBy()));
                  return _emptyService(route.origin);
                },
                child: const CustomScrollView(slivers: [TimelineGroupingHeaderSliver()]),
              ),
            ),
          ),
        );

        final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingHeaderSliver)));
        ref.read(timelineServiceProvider);

        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.year);
        expect(find.byType(TimelineGroupingSelector), findsOneWidget);

        calls.clear();
        await tester.runAsync(
          () async => ref
              .read(timelineOverviewDrilldownProvider)
              ?.call(TimeBucket(date: DateTime(2025), assetCount: 3), GroupAssetsBy.year),
        );
        // The drilldown persists the new grouping to SettingsRepository synchronously, but the
        // reactive rebuild now flows through appConfigProvider's drift watch stream, which does
        // not deliver under flutter_test's fake-async. Invalidate to force the route service to
        // rebuild and re-observe the persisted grouping (matches the standalone test above).
        ref.invalidate(timelineServiceProvider);
        ref.read(timelineServiceProvider);
        await tester.pump();

        expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.month);
        expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
        expect(find.text('2025'), findsNothing);

        calls.clear();
        await tester.runAsync(
          () async => ref
              .read(timelineOverviewDrilldownProvider)
              ?.call(TimeBucket(date: DateTime(2025, 3), assetCount: 3), GroupAssetsBy.month),
        );
        ref.invalidate(timelineServiceProvider);
        ref.read(timelineServiceProvider);
        await tester.pump();

        expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.day);
        expect(ref.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
        expect(find.text('Mar 2025'), findsNothing);
      });
    }
  });
}
