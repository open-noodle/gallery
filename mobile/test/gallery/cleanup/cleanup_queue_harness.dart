import 'dart:async';
import 'dart:io';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_details.repository.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// Slice 6's screen under a small router: a home stand-in, the real overview, the real queue page and a stand-in for the
// asset viewer. The in-memory server holds the three photo queues and answers what the queue page
// asks, filtering and paging as the server does, and records every commit.

const _homeName = 'QueueTestHome';
const _viewerName = 'QueueTestViewer';

class QueueTestRouter extends RootStackRouter {
  late final _home = PageInfo(
    _homeName,
    builder: (_) => const Scaffold(body: Text('home', key: Key('test-home'))),
  );
  late final _viewer = PageInfo(
    _viewerName,
    builder: (_) => Scaffold(
      appBar: AppBar(),
      body: const Text('viewer', key: Key('test-viewer')),
    ),
  );

  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: _home, initial: true),
    AutoRoute(page: LibraryCleanupOverviewRoute.page),
    AutoRoute(page: LibraryCleanupRewindRoute.page),
    AutoRoute(page: LibraryCleanupQueueRoute.page),
    AutoRoute(page: _viewer),
  ];
}

/// A blurry photo, newest first by [day] (2023-06-[day]), with its reason and sharpness.
Map<String, Object?> blurryJson(String id, {int day = 1, String reason = 'blurry', double sharpness = 5}) => {
  ...assetJson(id, localDateTime: '2023-06-${day.toString().padLeft(2, '0')}T10:00:00.000Z', city: 'Berlin'),
  'reason': reason,
  'sharpness': sharpness,
};

Map<String, Object?> screenshotJson(String id, {int? width = 1170, int? height = 2532}) => {
  ...assetJson(id, localDateTime: '2023-07-03T14:12:00.000Z'),
  'width': width,
  'height': height,
};

Map<String, Object?> hogJson(String id, int bytes, {String type = 'VIDEO'}) => {
  ...assetJson(id, localDateTime: '2023-08-01T10:00:00.000Z', fileSize: bytes.toDouble()),
  'type': type,
};

/// An in-memory server for the queues: their photos in server order, filtered and paged as the server does.
class QueueLibrary {
  QueueLibrary({Map<String, List<Map<String, Object?>>>? queues})
    : queues = queues ?? {'blurry': [], 'screenshots': [], 'space_hogs': []};

  /// Queue slug → its photos, in the server's order.
  final Map<String, List<Map<String, Object?>>> queues;
  final Set<String> inSpaces = {};

  /// The details sheet's answers: `GET /assets/{id}` and `GET /albums?assetId=`. A photo without an entry is a 500,
  /// which the sheet shows nothing for.
  final assetInfo = <String, Map<String, Object?>>{};
  final albumsOf = <String, List<Map<String, Object?>>>{};
  final commits = <Map<String, Object?>>[];
  final restored = <List<String>>[];

  /// Every page request, with its query.
  final pages = <Map<String, List<String>>>[];

  /// Every count request, with its query.
  final counts = <Map<String, List<String>>>[];

  // Trashed photos, kept for a restore: id → (queue, position).
  final _trashed = <String, (String, int, Map<String, Object?>)>{};

  late final server = FakeCleanupServer(_respond);

  List<String> get routes => server.routes;

  List<Map<String, Object?>> _filtered(String queue, Map<String, List<String>> query) {
    String? one(String key) => query[key]?.single;
    bool keep(Map<String, Object?> asset) {
      if (queue == 'blurry') {
        final reason = one('reason') ?? 'all';
        return reason == 'all' || asset['reason'] == reason;
      }
      if (queue == 'space_hogs') {
        final type = one('type') ?? 'video';
        final typeOk = type == 'all' || asset['type'] == (type == 'video' ? 'VIDEO' : 'IMAGE');
        return typeOk && (asset['fileSize']! as double) >= int.parse(one('minSize') ?? '104857600');
      }
      return true;
    }

    return (queues[queue] ?? const <Map<String, Object?>>[]).where(keep).toList();
  }

  FakeResponse? _respond(SeenRequest request) {
    final route = request.route;
    final count = RegExp(r'^GET /cleanup/queues/(\w+)/count$').firstMatch(route);
    if (count != null) {
      counts.add(request.query);
      final items = _filtered(count.group(1)!, request.query);
      return FakeResponse({
        'count': items.length,
        'bytes': items.fold<double>(0, (sum, asset) => sum + (asset['fileSize']! as double)),
      });
    }
    final page = RegExp(r'^GET /cleanup/queues/(\w+)$').firstMatch(route);
    if (page != null) {
      pages.add(request.query);
      final items = _filtered(page.group(1)!, request.query);
      final start = int.tryParse(request.query['cursor']?.single ?? '') ?? 0;
      final limit = int.parse(request.query['limit']?.single ?? '100');
      final end = start + limit < items.length ? start + limit : items.length;
      return FakeResponse({
        'items': start >= items.length ? const <Object>[] : items.sublist(start, end),
        'groups': const <Object>[],
        'nextCursor': end < items.length ? '$end' : null,
      });
    }
    if (route == 'POST /cleanup/in-spaces') {
      final asked = ((request.body! as Map)['assetIds'] as List).cast<String>();
      return FakeResponse({'assetIds': asked.where(inSpaces.contains).toList(), 'externalAssetIds': <String>[]});
    }
    if (route == 'POST /cleanup/commit') {
      final body = (request.body! as Map).cast<String, Object?>();
      commits.add(body);
      final queue = body['queue']! as String;
      final trash = (body['trashIds']! as List).cast<String>();
      final decided = {...trash, ...(body['keepIds']! as List).cast<String>(), ...(body['favoriteIds']! as List)};
      // The server's side: decided photos leave the queue (kept ones are recorded, so they do not come back).
      final list = queues[queue]!;
      for (final id in trash) {
        final index = list.indexWhere((asset) => asset['id'] == id);
        if (index >= 0) {
          _trashed[id] = (queue, index, list[index]);
        }
      }
      list.removeWhere((asset) => decided.contains(asset['id']));
      return FakeResponse(
        commitJson(
          trashed: trash,
          favorited: (body['favoriteIds']! as List).length,
          kept: decided.length - trash.length,
        ),
      );
    }
    if (route == 'POST /trash/restore/assets') {
      final ids = ((request.body! as Map)['ids'] as List).cast<String>();
      restored.add(ids);
      for (final id in ids) {
        final entry = _trashed.remove(id);
        if (entry != null) {
          final list = queues[entry.$1]!;
          list.insert(entry.$2.clamp(0, list.length), entry.$3);
        }
      }
      return FakeResponse({'count': ids.length});
    }
    // The overview's other sections: the calendar, an empty rewind, the trash.
    if (route == 'GET /cleanup/calendar') {
      return FakeResponse(calendarJson(days: const []));
    }
    if (RegExp(r'^GET /cleanup/rewind/\d+$').hasMatch(route)) {
      return const FakeResponse({'years': <Object>[]});
    }
    if (route == 'GET /cleanup/trash') {
      return const FakeResponse({'count': 0, 'bytes': 0});
    }
    final info = RegExp(r'^GET /assets/([^/]+)$').firstMatch(route);
    if (info != null) {
      final found = assetInfo[info.group(1)];
      return found == null ? const FakeResponse({'message': 'boom'}, 500) : FakeResponse(found);
    }
    if (route == 'GET /albums') {
      return FakeResponse(albumsOf[request.query['assetId']?.single] ?? const <Object>[]);
    }
    return null;
  }

  /// The page requests' filters and cursors, without the limit.
  List<Map<String, List<String>>> get pageQueries => [for (final query in pages) Map.of(query)..remove('limit')];
}

/// A container for the queues: [library]'s server (or [server], or [repository]), pages of [pageSize], today fixed,
/// saved marks in [directory], "Open in library" pushing the viewer stand-in, and the details sheet asking the server.
ProviderContainer queueContainer({
  QueueLibrary? library,
  FakeCleanupServer? server,
  LibraryCleanupRepository? repository,
  required Directory directory,
  bool trashEnabled = true,
  int pageSize = 4,
}) {
  openedInLibrary.clear();
  final fake = server ?? library?.server;
  final client = fake?.client;
  return cleanupContainer(
    server: fake,
    repository: repository,
    directory: directory,
    trashEnabled: trashEnabled,
    overrides: [
      libraryCleanupPageSizeProvider.overrideWithValue(pageSize),
      libraryCleanupClockProvider.overrideWithValue(rewindNow),
      libraryCleanupEmptyTrashProvider.overrideWithValue(() async => true),
      libraryCleanupOpenInLibraryProvider.overrideWithValue((context, ref, asset) async {
        openedInLibrary.add(asset.id);
        await context.router.push(const PageRouteInfo(_viewerName));
        return true;
      }),
      libraryCleanupInlineVideoProvider.overrideWithValue(
        (asset) => ColoredBox(key: Key('test-video-${asset.id}'), color: Colors.black),
      ),
      if (client != null)
        libraryCleanupDetailsRepositoryProvider.overrideWithValue(
          LibraryCleanupDetailsRepository(assetsApi: AssetsApi(client), albumsApi: AlbumsApi(client)),
        ),
    ],
  );
}

/// The remembered choices the next container starts from.
Future<void> setQueuePrefs({
  bool overlaySeen = true,
  Map<LibraryCleanupQueue, LibraryCleanupView> views = const {},
  Map<LibraryCleanupQueue, LibraryCleanupFilters> filters = const {},
}) => Store.put(
  StoreKey.libraryCleanupPrefs,
  LibraryCleanupPrefs(
    overlaySeen: overlaySeen,
    seriesOverlaySeen: overlaySeen,
    views: views,
    filters: filters,
  ).toJsonString(),
);

LibraryCleanupPrefs storedPrefs() => LibraryCleanupPrefs.fromJsonString(Store.tryGet(StoreKey.libraryCleanupPrefs));

/// Pumps the router at home, attaches the motion host, then pushes [queue]'s page (or [first]) and settles.
Future<QueueTestRouter> pumpQueue(
  WidgetTester tester,
  ProviderContainer container, {
  LibraryCleanupQueue? queue,
  PageRouteInfo? first,
  bool reduceMotion = false,
  int Function()? requests,
}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(GalleryMotionHost.debugReset);
  final router = QueueTestRouter();
  await tester.pumpWidget(
    localizedForTest(
      UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp.router(
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
              child: child!,
            ),
            routerConfig: router.config(),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  GalleryMotionHost.attach(tester.state<OverlayState>(find.byType(Overlay).first));
  final route = first ?? (queue == null ? null : LibraryCleanupQueueRoute(queue: queue.slug));
  if (route != null) {
    unawaited(router.push(route));
  }
  await settleCleanup(tester, requests: requests);
  return router;
}
