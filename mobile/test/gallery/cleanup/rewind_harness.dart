import 'dart:async';
import 'dart:io';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_rewind.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_details.repository.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/motion/motion_host.dart';
import 'package:immich_mobile/platform/remote_image_api.g.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';
import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';

// Slice 3's screens under a small router: a home stand-in, the real overview, the real rewind, and stand-ins for the
// asset viewer, which "Open in library" pushes, and for a day's search results, which "Show that day" pushes. The
// in-memory server holds a few days of photos and answers what the rewind and the details sheet ask, recording every
// commit.

const _homeName = 'CleanupTestHome';
const _viewerName = 'CleanupTestViewer';
const _dayName = 'CleanupTestDay';

class RewindTestRouter extends RootStackRouter {
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
  late final _day = PageInfo(
    _dayName,
    builder: (_) => Scaffold(
      appBar: AppBar(),
      body: const Text('day', key: Key('test-day')),
    ),
  );

  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: _home, initial: true),
    AutoRoute(page: LibraryCleanupOverviewRoute.page),
    AutoRoute(page: LibraryCleanupPlaceholderRoute.page),
    AutoRoute(page: LibraryCleanupRewindRoute.page),
    AutoRoute(page: _viewer),
    AutoRoute(page: _day),
  ];
}

/// An in-memory server for rewinds: photos per date and year, the calendar they make, shared spaces and commits.
class RewindLibrary {
  RewindLibrary({Map<int, Map<int, List<Map<String, Object?>>>>? days}) : days = days ?? {815: rewindDay815()};

  /// monthDay → year → the year's photos (as the server returns them).
  final Map<int, Map<int, List<Map<String, Object?>>>> days;
  final Set<int> reviewed = {};
  final Set<String> inSpaces = {};
  int streak = 0;
  bool yearsFail = false;

  /// While set, the years requests wait for it.
  Completer<void>? hold;

  /// The details sheet's answers: `GET /assets/{id}` and `GET /albums?assetId=`. A photo without an entry is a 404.
  final assetInfo = <String, Map<String, Object?>>{};
  final albumsOf = <String, List<Map<String, Object?>>>{};
  bool detailsFail = false;

  /// While set, the details requests wait for it.
  Completer<void>? detailsHold;
  final commits = <Map<String, Object?>>[];
  final restored = <List<String>>[];

  late final server = FakeCleanupServer(
    _respond,
    gate: (request) => RegExp(r'^GET /cleanup/rewind/\d+$').hasMatch(request.route)
        ? hold?.future
        : RegExp(r'^GET /(assets/[^/]+|albums)$').hasMatch(request.route)
        ? detailsHold?.future
        : null,
  );

  Map<String, Object?> get _calendar => {
    'days': [
      for (final entry in days.entries)
        dayJson(
          entry.key,
          entry.value.values.fold(0, (sum, list) => sum + list.length),
          reviewedAt: reviewed.contains(entry.key) ? '2026-08-15T09:00:00.000Z' : null,
        ),
    ],
    'daysReviewed': reviewed.length,
    'streak': streak,
  };

  FakeResponse? _respond(SeenRequest request) {
    final route = request.route;
    if (route == 'GET /cleanup/calendar') {
      return FakeResponse(_calendar);
    }
    final years = RegExp(r'^GET /cleanup/rewind/(\d+)$').firstMatch(route);
    if (years != null) {
      if (yearsFail) {
        return const FakeResponse({'message': 'boom'}, 500);
      }
      final day = days[int.parse(years.group(1)!)] ?? const {};
      final sorted = day.keys.toList()..sort((a, b) => b.compareTo(a));
      return FakeResponse({
        'years': [
          for (final year in sorted) {'year': year, 'count': day[year]!.length},
        ],
      });
    }
    final year = RegExp(r'^GET /cleanup/rewind/(\d+)/(\d+)$').firstMatch(route);
    if (year != null) {
      return FakeResponse({'assets': days[int.parse(year.group(1)!)]?[int.parse(year.group(2)!)] ?? const []});
    }
    if (route == 'POST /cleanup/in-spaces') {
      final asked = ((request.body! as Map)['assetIds'] as List).cast<String>();
      return FakeResponse({'assetIds': asked.where(inSpaces.contains).toList(), 'externalAssetIds': <String>[]});
    }
    if (route == 'POST /cleanup/commit') {
      final body = (request.body! as Map).cast<String, Object?>();
      commits.add(body);
      final trash = (body['trashIds']! as List).cast<String>();
      final keep = (body['keepIds']! as List).cast<String>();
      final favorite = (body['favoriteIds']! as List).cast<String>();
      // The server's side: trashed photos leave the day, kept and favourited ones come back as kept.
      for (final day in days.values) {
        for (final list in day.values) {
          list.removeWhere((asset) => trash.contains(asset['id']));
          for (final asset in list) {
            if (keep.contains(asset['id']) || favorite.contains(asset['id'])) {
              asset['kept'] = true;
            }
          }
        }
      }
      final complete = body['completeMonthDay'];
      if (complete is int) {
        reviewed.add(complete);
        streak++;
      }
      return FakeResponse(commitJson(trashed: trash, favorited: favorite.length, kept: keep.length + favorite.length));
    }
    // The overview's other sections, quiet: every queue empty, the trash empty.
    if (RegExp(r'^GET /cleanup/queues/\w+/count$').hasMatch(route)) {
      return const FakeResponse({'count': 0, 'bytes': 0});
    }
    if (RegExp(r'^GET /cleanup/queues/\w+$').hasMatch(route)) {
      return FakeResponse(pageJson(const []));
    }
    if (route == 'GET /cleanup/trash') {
      return const FakeResponse({'count': 0, 'bytes': 0});
    }
    final info = RegExp(r'^GET /assets/([^/]+)$').firstMatch(route);
    if (info != null) {
      final found = assetInfo[info.group(1)];
      return detailsFail || found == null ? const FakeResponse({'message': 'boom'}, 500) : FakeResponse(found);
    }
    if (route == 'GET /albums') {
      return detailsFail
          ? const FakeResponse({'message': 'boom'}, 500)
          : FakeResponse(albumsOf[request.query['assetId']?.single] ?? const <Object>[]);
    }
    if (route == 'POST /trash/restore/assets') {
      final ids = ((request.body! as Map)['ids'] as List).cast<String>();
      restored.add(ids);
      return FakeResponse({'count': ids.length});
    }
    return null;
  }

  List<String> get routes => server.routes;
}

/// 15 August: p1, p2 in 2022 (Lisbon), q1–q3 in 2020 (Porto), p1 in an album and 1.5 MB.
Map<int, List<Map<String, Object?>>> rewindDay815() => {
  2022: [
    assetJson('p1', city: 'Lisbon', localDateTime: '2022-08-15T09:00:00.000Z', fileSize: 1500000)..['inAlbum'] = true,
    assetJson('p2', city: 'Lisbon', localDateTime: '2022-08-15T15:30:00.000Z'),
  ],
  2020: [
    for (final id in ['q1', 'q2', 'q3']) assetJson(id, city: 'Porto', localDateTime: '2020-08-15T08:00:00.000Z'),
  ],
};

/// What the app's platform channels were asked: haptics and image requests.
class RewindPlatform {
  final haptics = <String>[];
  final images = <String>[];

  int count(String haptic) => haptics.where((h) => h == haptic).length;

  bool requested(String id, {String size = 'preview'}) =>
      images.any((url) => url.contains('/assets/$id/thumbnail') && url.contains('size=$size'));
}

RewindPlatform listenToPlatform(WidgetTester tester) {
  final platform = RewindPlatform();
  const api = 'dev.flutter.pigeon.immich_mobile.RemoteImageApi';
  tester.binding.defaultBinaryMessenger
    ..setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'HapticFeedback.vibrate') {
        platform.haptics.add(call.arguments as String);
      }
      return null;
    })
    ..setMockDecodedMessageHandler<Object?>(
      const BasicMessageChannel<Object?>('$api.requestImage', RemoteImageApi.pigeonChannelCodec),
      (message) {
        platform.images.add((message! as List<Object?>).first! as String);
        return Completer<Object?>().future;
      },
    )
    ..setMockDecodedMessageHandler<Object?>(
      const BasicMessageChannel<Object?>('$api.cancelRequest', RemoteImageApi.pigeonChannelCodec),
      (_) async => const <Object?>[null],
    );
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return platform;
}

/// 15 August 2026, 10:00: 2022 is "4 years ago".
DateTime rewindNow() => DateTime(2026, 8, 15, 10);

/// Opens of "Open in library", by asset id.
final openedInLibrary = <String>[];

/// Days "Show that day" opened.
final shownDays = <DateTime>[];

/// What `GET /assets/{id}` answers for a photo: [exif] and [people] (name, or '' for an unnamed face) as given.
Map<String, Object?> assetInfoJson(
  String id, {
  String localDateTime = '2022-08-15T09:00:00.000Z',
  Map<String, Object?> exif = const {},
  List<String> people = const [],
}) => {
  'id': id,
  'checksum': 'checksum-$id',
  'createdAt': '2026-01-01T00:00:00.000Z',
  'updatedAt': '2026-01-01T00:00:00.000Z',
  'fileCreatedAt': localDateTime,
  'fileModifiedAt': localDateTime,
  'localDateTime': localDateTime,
  'hasMetadata': true,
  'isArchived': false,
  'isEdited': false,
  'isFavorite': false,
  'isOffline': false,
  'isTrashed': false,
  'originalFileName': 'IMG_$id.JPG',
  'originalPath': '/library/$id.jpg',
  'ownerId': 'user-1',
  'thumbhash': null,
  'type': 'IMAGE',
  'visibility': 'timeline',
  'duration': null,
  'width': 6240,
  'height': 4160,
  'exifInfo': exif,
  'people': [
    for (final (index, name) in people.indexed)
      {'id': '$id-person-$index', 'name': name, 'isHidden': false, 'thumbnailPath': '/thumbs/$index.jpg'},
  ],
};

Map<String, Object?> albumJson(String id, String name) => {
  'id': id,
  'albumName': name,
  'albumUsers': const <Object>[],
  'assetCount': 3,
  'createdAt': '2026-01-01T00:00:00.000Z',
  'updatedAt': '2026-01-01T00:00:00.000Z',
  'description': '',
  'hasSharedLink': false,
  'isActivityEnabled': false,
  'shared': false,
};

/// A container for the rewind: [library]'s server (or [repository]), today fixed, saved marks in [directory], and
/// "Open in library" pushing the viewer stand-in.
ProviderContainer rewindContainer({
  RewindLibrary? library,
  LibraryCleanupRepository? repository,
  LibraryCleanupDetailsRepository? details,
  required Directory directory,
  bool trashEnabled = true,
}) {
  openedInLibrary.clear();
  shownDays.clear();
  final client = library?.server.client;
  return cleanupContainer(
    server: library?.server,
    repository: repository,
    directory: directory,
    trashEnabled: trashEnabled,
    overrides: [
      libraryCleanupClockProvider.overrideWithValue(rewindNow),
      libraryCleanupEmptyTrashProvider.overrideWithValue(() async => true),
      libraryCleanupOpenInLibraryProvider.overrideWithValue((context, ref, asset) async {
        openedInLibrary.add(asset.id);
        await context.router.push(const PageRouteInfo(_viewerName));
        return true;
      }),
      libraryCleanupShowDayProvider.overrideWithValue((context, day) async {
        shownDays.add(day);
        await context.router.push(const PageRouteInfo(_dayName));
      }),
      if (details != null || client != null)
        libraryCleanupDetailsRepositoryProvider.overrideWithValue(
          details ?? LibraryCleanupDetailsRepository(assetsApi: AssetsApi(client), albumsApi: AlbumsApi(client)),
        ),
      libraryCleanupInlineVideoProvider.overrideWithValue(
        (asset) => ColoredBox(key: Key('test-video-${asset.id}'), color: Colors.black),
      ),
    ],
  );
}

/// The remembered choices the next container starts from (the gesture overlay is seen unless [overlaySeen] is false).
Future<void> setPrefs({bool overlaySeen = true, LibraryCleanupDeckMode mode = LibraryCleanupDeckMode.swipe}) =>
    Store.put(
      StoreKey.libraryCleanupPrefs,
      LibraryCleanupPrefs(overlaySeen: overlaySeen, deckMode: mode).toJsonString(),
    );

/// Pumps the router at home, attaches the motion host, then pushes [first] (the rewind of 15 August by default).
Future<RewindTestRouter> pumpRewind(
  WidgetTester tester,
  ProviderContainer container, {
  PageRouteInfo? first,
  bool openRewind = true,
  bool reduceMotion = false,
  bool settle = true,
  int Function()? requests,
}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(GalleryMotionHost.debugReset);
  final router = RewindTestRouter();
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
  // The rewind reads the calendar the probe fetched.
  await tester.runAsync(() => container.read(libraryCleanupSupportProvider.future));
  final route = first ?? (openRewind ? LibraryCleanupRewindRoute(monthDay: 815) : null);
  if (route != null) {
    unawaited(router.push(route));
  }
  if (settle) {
    await settleCleanup(tester, requests: requests);
  }
  return router;
}

/// The id of the card on top of the deck.
String? topCardId(WidgetTester tester) {
  final cards = find.byWidgetPredicate(
    (widget) => widget.key is ValueKey && '${(widget.key! as ValueKey).value}'.startsWith('top-'),
  );
  if (cards.evaluate().isEmpty) {
    return null;
  }
  return '${(tester.widget(cards.first).key! as ValueKey).value}'.substring(4);
}

/// Pumps frames in fake time only (no file or socket work): for watching an animation's progress.
Future<void> frames(WidgetTester tester, Duration total, {Duration step = const Duration(milliseconds: 16)}) async {
  for (var elapsed = Duration.zero; elapsed < total; elapsed += step) {
    await tester.pump(step);
  }
}
