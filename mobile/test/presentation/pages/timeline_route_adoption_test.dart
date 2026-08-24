import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
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
            timelineServiceBuilder: (ref, scope, groupBy) {
              seenScopes.add(scope);
              return TimelineService((
                bucketSource: () => const Stream<List<Bucket>>.empty(),
                assetSource: (offset, count) async => const <BaseAsset>[],
                origin: TimelineOrigin.person,
              ));
            },
            child: const CustomScrollView(slivers: [SliverToBoxAdapter(child: TimelineGroupingSelector())]),
          ),
        ),
      ),
    );

    expect(find.byType(TimelineGroupingSelector), findsOneWidget);
    final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingSelector)));
    ref.read(timelineServiceProvider);
    expect(seenScopes.last, const TimelineTemporalScope.none());

    await tester.runAsync(
      () async => ref
          .read(timelineOverviewDrilldownProvider)
          ?.call(TimeBucket(date: DateTime(2025), assetCount: 3), TimelineOverviewMode.years),
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

    test('all pill-adopting routes expose controls flag; composed pages expose extra-sliver heights', () {
      // Simple pages: header sliver replaced by withGroupingPill; no extra top sliver.
      expect(DriftPersonPage.timelineOverviewControlsEnabled, isTrue);
      expect(RemoteAlbumPage.timelineOverviewControlsEnabled, isTrue);
      expect(LocalTimelinePage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftFavoritePage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftArchivePage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftLockedFolderPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftVideoPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftRecentlyTakenPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftPlaceDetailPage.timelineOverviewControlsEnabled, isTrue);

      // Composed pages: keep a non-header extra sliver; the const now measures only that sliver.
      expect(DriftTrashPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftTrashPage.trashInfoBannerTopSliverHeight, 24.0);

      expect(DriftPartnerDetailPage.timelineOverviewControlsEnabled, isTrue);
      expect(DriftPartnerDetailPage.partnerInfoBoxTopSliverHeight, 110.0);

      // Space detail: sync-banner height is dynamic; its contract is unchanged.
      expect(SpaceDetailPage.timelineOverviewControlsEnabled, isTrue);
      expect(SpaceDetailPage.syncBannerTopSliverHeight(isRemoteSyncing: false), 0.0);
      expect(SpaceDetailPage.syncBannerTopSliverHeight(isRemoteSyncing: true), kSyncStatusBannerSliverHeight);
    });

    for (final route in _adoptedRouteCases) {
      testWidgets('${route.label} keeps route constraints during year and month zoom', (tester) async {
        // The persisted grouping is seeded to Years to prove detail routes IGNORE it
        // (they open at All) and never write it back.
        await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
        final calls = <_ObservedRouteCall>[];

        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              home: TimelineRouteScope(
                timelineServiceBuilder: (ref, scope, groupBy) {
                  calls.add(_ObservedRouteCall(constraint: route.constraint, scope: scope, groupBy: groupBy));
                  return _emptyService(route.origin);
                },
                child: const CustomScrollView(slivers: [SliverToBoxAdapter(child: TimelineGroupingSelector())]),
              ),
            ),
          ),
        );

        final ref = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingSelector)));
        ref.read(timelineServiceProvider);

        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.day, reason: 'route opens at All regardless of the stored Years');
        expect(find.byType(TimelineGroupingSelector), findsOneWidget);

        // Drive the route to Years through the selector (route-local, never persisted).
        calls.clear();
        await tester.tap(find.byKey(const Key('timeline-grouping-years')));
        await tester.pump();
        ref.read(timelineServiceProvider);

        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.year);

        calls.clear();
        await tester.runAsync(
          () async => ref
              .read(timelineOverviewDrilldownProvider)
              ?.call(TimeBucket(date: DateTime(2025), assetCount: 3), TimelineOverviewMode.years),
        );
        // The drilldown persists the new grouping to SettingsRepository synchronously, but the
        // reactive rebuild now flows through appConfigProvider's drift watch stream, which does
        // not deliver under flutter_test's fake-async. Invalidate to force the route service to
        // rebuild and re-observe the persisted grouping (matches the standalone test above).
        ref.invalidate(timelineServiceProvider);
        ref.read(timelineServiceProvider);
        await tester.pump();

        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.month);
        expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
        expect(find.text('2025'), findsNothing);

        calls.clear();
        await tester.runAsync(
          () async => ref
              .read(timelineOverviewDrilldownProvider)
              ?.call(TimeBucket(date: DateTime(2025, 3), assetCount: 3), TimelineOverviewMode.months),
        );
        ref.invalidate(timelineServiceProvider);
        ref.read(timelineServiceProvider);
        await tester.pump();

        expect(calls.single.constraint, route.constraint);
        expect(calls.single.scope, const TimelineTemporalScope.none());
        expect(calls.single.groupBy, GroupAssetsBy.day);
        expect(ref.read(timelineZoomAnchorProvider), TimelineZoomAnchor.month(year: 2025, month: 3));
        expect(find.text('Mar 2025'), findsNothing);

        // The persisted setting was never written: it still holds the seeded Years.
        expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
      });
    }
  });
}
