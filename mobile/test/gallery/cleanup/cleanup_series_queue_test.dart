import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/bytes_units.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_queue_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The series queues in the session screen (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Bursts and
// Duplicates" and the Slice 7 behaviours). The walks through the recorded server are cleanup_bursts_e2e_test.dart and
// cleanup_duplicates_e2e_test.dart; these cover the rest against an in-memory server.
//
// Given bursts x (x1–x3, x2 the sharpest), y (y1–y2) and z (z1–z2), and duplicate groups d (d1, d2 suggested) and e
// Bursts     When x is swiped left and y up, and applied   Then x's frames all go in trashIds and y's in keepIds
//            When a series is decided and Undo pressed   Then that series is back on top and nothing is pending
//            When the big frame is swiped sideways   Then the frames step and nothing is decided
//            When the deck is on x   Then only x and y are built: z's previews do not load
//            When ⓘ is tapped on the big frame   Then the details sheet is for the frame shown, offers only Keep and
//                                     Trash, and its choice flips that frame
//            When a trashed-whole series is applied and the toast's Undo pressed   Then it comes back with every frame
//            When the app dies with a decided series and the queue reopens   Then the decision is back, and it says so
// Grid       When "Keep the suggestion for all" is pressed   Then every loaded series is accepted on its suggestion, a
//                                     frame flipped before goes back to the suggestion, and nothing is sent until
//                                     Apply
// Duplicates When ⓘ is tapped   Then only the albums are asked (the copy is already a full asset)
//            When the trash is off and a copy is marked for trash   Then Apply asks first; cancelling sends nothing
// Permission Given the duplicates count is refused   Then there is no Duplicates card and no duplicates request
//            Given the duplicates list is refused   Then the queue shows its error and the overview then has no
//                                     Duplicates card, without asking again
// Overview   When the Bursts or Duplicates quick win is tapped   Then its series queue opens
// Session    The first series session shows the series card's own gesture lesson (right as set, up keep all, left
//            trash all or "Keep at least one copy"), seen once shown; How it works replays it; the menu has no
//            swipe / button choice; Swipe ↔ Grid flies the big frame (reduced motion: nothing flies)

Map<String, Object?> _burst(String id, List<String> frames, {required String suggested}) => {
  'groupId': id,
  'source': 'burstId',
  'suggestedKeepId': suggested,
  'assets': [
    for (final (index, frame) in frames.indexed)
      assetJson(frame, localDateTime: '2023-09-01T10:00:0$index.000Z', fileSize: 1000.0 + index),
  ],
};

Map<String, Object?> _copy(String id, {required int size, required int width, required int height}) => {
  'checksum': 'checksum-$id',
  'createdAt': '2023-10-01T10:00:00.000Z',
  'duplicateId': 'dup',
  'duration': null,
  'exifInfo': {'fileSizeInByte': size, 'exifImageWidth': width, 'exifImageHeight': height, 'city': 'Lisbon'},
  'fileCreatedAt': '2023-10-01T10:00:00.000Z',
  'fileModifiedAt': '2023-10-01T10:00:00.000Z',
  'hasMetadata': true,
  'height': height,
  'id': id,
  'isArchived': false,
  'isEdited': false,
  'isFavorite': false,
  'isOffline': false,
  'isTrashed': false,
  'localDateTime': '2023-10-01T10:00:00.000Z',
  'originalFileName': '$id.jpg',
  'originalPath': 'originalPath',
  'ownerId': 'user-1',
  'thumbhash': null,
  'type': 'IMAGE',
  'updatedAt': '2023-10-01T10:00:00.000Z',
  'visibility': 'timeline',
  'width': width,
};

/// An in-memory server for the series queues, and the overview's other sections.
class _SeriesLibrary {
  final bursts = [
    _burst('x1', ['x1', 'x2', 'x3'], suggested: 'x2'),
    _burst('y1', ['y1', 'y2'], suggested: 'y1'),
    _burst('z1', ['z1', 'z2'], suggested: 'z1'),
  ];
  final duplicates = [
    {
      'duplicateId': 'd',
      'suggestedKeepAssetIds': ['d2'],
      'assets': [
        _copy('d1', size: 3000, width: 4000, height: 3000),
        _copy('d2', size: 6000, width: 2000, height: 1500),
      ],
    },
    {
      'duplicateId': 'e',
      'suggestedKeepAssetIds': ['e1'],
      'assets': [_copy('e1', size: 2000, width: 100, height: 100), _copy('e2', size: 1000, width: 100, height: 100)],
    },
  ];
  bool countForbidden = false;
  bool listForbidden = false;
  final commits = <Map<String, Object?>>[];
  final restored = <List<String>>[];

  late final server = FakeCleanupServer(_respond);
  List<String> get routes => server.routes;

  FakeResponse? _respond(SeenRequest request) {
    final body = request.body is Map ? (request.body! as Map).cast<String, Object?>() : const <String, Object?>{};
    switch (request.route) {
      case 'GET /cleanup/queues/bursts/count':
        return FakeResponse({'count': bursts.length, 'bytes': 0});
      case 'GET /cleanup/queues/bursts':
        return FakeResponse({'items': const <Object>[], 'groups': bursts, 'nextCursor': null});
      case 'GET /cleanup/queues/duplicates/count':
        return countForbidden
            ? const FakeResponse({'message': 'no'}, 403)
            : FakeResponse({'count': duplicates.length, 'bytes': 0});
      case 'GET /duplicates':
        return listForbidden ? const FakeResponse({'message': 'no'}, 403) : FakeResponse(duplicates);
      case 'POST /cleanup/in-spaces':
        return const FakeResponse({'assetIds': <String>[], 'externalAssetIds': <String>[]});
      case 'POST /cleanup/commit':
        commits.add(body);
        final trash = (body['trashIds']! as List).cast<String>();
        return FakeResponse(commitJson(trashed: trash, kept: (body['keepIds']! as List).length));
      case 'POST /trash/restore/assets':
        final ids = (body['ids']! as List).cast<String>();
        restored.add(ids);
        return FakeResponse({'count': ids.length});
      case 'GET /albums':
        return const FakeResponse(<Object>[]);
      case 'GET /cleanup/calendar':
        return FakeResponse(calendarJson(days: const []));
      case 'GET /cleanup/trash':
        return const FakeResponse({'count': 0, 'bytes': 0});
    }
    if (RegExp(r'^GET /cleanup/rewind/\d+$').hasMatch(request.route)) {
      return const FakeResponse({'years': <Object>[]});
    }
    if (RegExp(r'^GET /cleanup/queues/\w+/count$').hasMatch(request.route)) {
      return const FakeResponse({'count': 0, 'bytes': 0});
    }
    if (RegExp(r'^GET /assets/[^/]+$').hasMatch(request.route)) {
      return const FakeResponse({'message': 'not in this test'}, 500);
    }
    return null;
  }
}

void main() {
  setUpAll(initOverviewStore);

  late _SeriesLibrary library;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = _SeriesLibrary();
    await setQueuePrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<void> open(
    WidgetTester tester,
    LibraryCleanupQueue? queue, {
    bool trashEnabled = true,
    Directory? directory,
    bool overview = false,
    bool reduceMotion = false,
  }) async {
    listenToPlatform(tester);
    final container = queueContainer(
      server: library.server,
      directory: directory ?? tempDirectory(),
      trashEnabled: trashEnabled,
    );
    await pumpQueue(
      tester,
      container,
      queue: queue,
      first: overview ? const LibraryCleanupOverviewRoute() : null,
      reduceMotion: reduceMotion,
      requests: () => library.routes.length,
    );
    await settle(tester);
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(Key(key)));
    await settle(tester);
  }

  Finder inCard(String series, String key) =>
      find.descendant(of: find.byKey(Key('cleanup-series-card-$series')), matching: find.byKey(Key(key)));

  Future<void> swipe(WidgetTester tester, String series, Offset offset) async {
    await tester.fling(inCard(series, 'cleanup-series-header'), offset, 1500);
    await settle(tester);
  }

  String badge(WidgetTester tester) => textOf(tester, 'cleanup-session-badge-count');
  String position(WidgetTester tester) =>
      tester.widget<Text>(inCard(topCardId(tester)!, 'cleanup-series-position')).data!;

  group('Bursts', () {
    testWidgets('left trashes every frame, up keeps every frame; both are sent only on Apply', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      await swipe(tester, 'x1', const Offset(-300, 0));
      await swipe(tester, 'y1', const Offset(0, -300));
      expect(badge(tester), '2');
      expect(library.commits, isEmpty);

      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(library.commits, [
        {
          'queue': 'bursts',
          'trashIds': ['x1', 'x2', 'x3'],
          'favoriteIds': <String>[],
          'keepIds': ['y1', 'y2'],
        },
      ]);
    });

    testWidgets('Undo steps back one series', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      await swipe(tester, 'x1', const Offset(300, 0));
      expect(topCardId(tester), 'y1');
      await tapKey(tester, 'cleanup-series-undo');
      expect(topCardId(tester), 'x1');
      expect(find.byKey(const Key('cleanup-session-badge-count')), findsNothing);
    });

    testWidgets('a sideways swipe on the big frame steps through the frames and decides nothing', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      expect(position(tester), 'Frame 2 of 3', reason: 'opens on the sharpest');
      await tester.fling(find.byKey(const Key('cleanup-series-frame-x1')), const Offset(-200, 0), 1500);
      await settle(tester);
      expect(position(tester), 'Frame 3 of 3');
      expect(inCard('x1', 'cleanup-series-shown-x3'), findsOneWidget);
      await tester.fling(find.byKey(const Key('cleanup-series-frame-x1')), const Offset(200, 0), 1500);
      await settle(tester);
      expect(position(tester), 'Frame 2 of 3');
      expect(topCardId(tester), 'x1');
      expect(find.byKey(const Key('cleanup-session-badge-count')), findsNothing);
    });

    testWidgets('only the top and next series are built, so later previews wait', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      expect(find.byKey(const Key('cleanup-series-card-x1')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-series-card-y1')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-series-card-z1')), findsNothing);
      await swipe(tester, 'x1', const Offset(300, 0));
      expect(find.byKey(const Key('cleanup-series-card-z1')), findsOneWidget);
    });

    testWidgets('ⓘ opens the details of the frame shown; its Trash marks that frame', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      expect(inCard('x1', 'cleanup-series-mark-x2-keep'), findsOneWidget);
      await tapKey(tester, 'cleanup-series-details');
      expect(find.byKey(const Key('cleanup-details-sheet')), findsOneWidget);
      expect(textOf(tester, 'cleanup-details-subtitle'), 'Frame 2 of 3');
      expect(find.byKey(const Key('cleanup-details-favorite')), findsNothing);
      expect(library.routes, containsAll(['GET /assets/x2', 'GET /albums']));
      await tapKey(tester, 'cleanup-details-trash');
      expect(find.byKey(const Key('cleanup-details-sheet')), findsNothing);
      expect(inCard('x1', 'cleanup-series-mark-x2-trash'), findsOneWidget);
      expect(topCardId(tester), 'x1', reason: 'a frame changed; the series is not decided');
    });

    testWidgets("a series trashed whole comes back with every frame from the toast's Undo", (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      await swipe(tester, 'x1', const Offset(-300, 0));
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(find.byKey(const Key('test-home')), findsOneWidget, reason: 'y and z are left');
      // Back home: the trash gives the frames back.
      await tapKey(tester, 'cleanup-toast-undo');
      expect(library.restored, [
        ['x1', 'x2', 'x3'],
      ]);
    });

    testWidgets('killed with a decided series, the reopened queue restores it and says so', (tester) async {
      final directory = tempDirectory();
      await open(tester, LibraryCleanupQueue.bursts, directory: directory);
      await tapKey(tester, 'cleanup-series-stack');
      await tester.pumpWidget(const SizedBox());
      await settle(tester);

      await open(tester, LibraryCleanupQueue.bursts, directory: directory);
      expect(find.text('Restored your marks'), findsOneWidget);
      expect(badge(tester), '1');
      expect(topCardId(tester), 'y1');
    });
  });

  testWidgets('Grid: "Keep the suggestion for all" accepts every loaded series on its suggestion', (tester) async {
    await setQueuePrefs(views: {LibraryCleanupQueue.bursts: LibraryCleanupView.grid});
    await open(tester, LibraryCleanupQueue.bursts);
    expect(find.byKey(const Key('cleanup-series-list')), findsOneWidget);
    // A frame flipped before goes back to the suggestion.
    await tapKey(tester, 'cleanup-series-frame-x1');
    expect(inCard('x1', 'cleanup-series-mark-x2-trash'), findsOneWidget);

    await tapKey(tester, 'cleanup-series-keep-suggestion-all');
    expect(badge(tester), '3');
    expect(inCard('x1', 'cleanup-series-mark-x2-keep'), findsOneWidget);
    expect(library.commits, isEmpty);

    await tapKey(tester, 'cleanup-session-done');
    await tapKey(tester, 'cleanup-finish-apply');
    expect(library.commits.single['keepIds'], ['x2', 'y1', 'z1']);
    expect(library.commits.single['trashIds'], ['x1', 'x3', 'y2', 'z2']);
  });

  group('the session parts every cleanup shares', () {
    String overlayText(WidgetTester tester, String key) => textOf(tester, 'cleanup-gesture-$key');

    testWidgets('the first Bursts session teaches the series swipes; How it works replays them', (tester) async {
      await setQueuePrefs(overlaySeen: false);
      await open(tester, LibraryCleanupQueue.bursts);
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsOneWidget);
      expect(
        [overlayText(tester, 'right'), overlayText(tester, 'up'), overlayText(tester, 'left')],
        ['→  Keep as set', '↑  Keep all', 'Trash all  ←'],
      );
      expect(find.byKey(const Key('cleanup-gesture-hint')), findsOneWidget);
      expect(storedPrefs().seriesOverlaySeen, isTrue, reason: 'seen as soon as it shows');
      expect(storedPrefs().overlaySeen, isFalse, reason: "the photo decks' lesson is still to come");

      await tapKey(tester, 'cleanup-gesture-overlay-ok');
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsNothing);
      await tapKey(tester, 'cleanup-session-menu');
      await tapKey(tester, 'cleanup-menu-how-it-works');
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsOneWidget);
    });

    testWidgets('Duplicates: left keeps at least one copy, so the lesson says so', (tester) async {
      await setQueuePrefs(overlaySeen: false);
      await open(tester, LibraryCleanupQueue.duplicates);
      expect(overlayText(tester, 'left'), 'Keep at least one copy  ✕');
      expect(overlayText(tester, 'right'), '→  Keep as set');
    });

    testWidgets('the menu offers Swipe / Grid but no swipe / button choice: the series card has one layout', (
      tester,
    ) async {
      await open(tester, LibraryCleanupQueue.bursts);
      await tapKey(tester, 'cleanup-session-menu');
      expect(find.byKey(const Key('cleanup-menu-grid')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-menu-how-it-works')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-menu-mode-swipe')), findsNothing);
      expect(find.byKey(const Key('cleanup-menu-mode-button')), findsNothing);
    });

    Future<List<Rect>> flights(WidgetTester tester) async {
      final rects = <Rect>[];
      for (var i = 0; i < 40; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        final flight = find.byKey(const Key('gallery-flight'));
        if (flight.evaluate().isNotEmpty) {
          rects.add(tester.getRect(flight));
        }
      }
      await settle(tester);
      return rects;
    }

    testWidgets('Swipe ↔ Grid: the big frame flies into its series in the list and back', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts);
      await swipe(tester, 'x1', const Offset(300, 0));
      final frame = tester.getRect(find.byKey(const Key('cleanup-series-frame-y1')));

      await tester.tap(find.byKey(const Key('cleanup-view-grid')));
      final there = await flights(tester);
      expect(there, isNotEmpty, reason: "the deck's frame flies");
      expect(there.first.width, closeTo(frame.width, frame.width * 0.25));
      expect(
        (there.last.center - tester.getRect(find.byKey(const Key('cleanup-series-frame-y1'))).center).distance,
        lessThan(12),
        reason: "it lands on y's frame in the list, the first undecided series",
      );

      await tester.tap(find.byKey(const Key('cleanup-view-swipe')));
      expect(await flights(tester), isNotEmpty, reason: 'and flies back into the deck');
      expect(topCardId(tester), 'y1');
    });

    testWidgets('Swipe ↔ Grid under reduced motion: nothing flies', (tester) async {
      await open(tester, LibraryCleanupQueue.bursts, reduceMotion: true);
      await tester.tap(find.byKey(const Key('cleanup-view-grid')));
      expect(await flights(tester), isEmpty);
      expect(find.byKey(const Key('cleanup-series-list')), findsOneWidget);
    });
  });

  group('Duplicates', () {
    testWidgets('ⓘ asks only for the albums: the copy is already a full asset', (tester) async {
      await open(tester, LibraryCleanupQueue.duplicates);
      await tapKey(tester, 'cleanup-series-details');
      expect(find.byKey(const Key('cleanup-details-sheet')), findsOneWidget);
      expect(library.routes.where((route) => route.startsWith('GET /assets/')), isEmpty);
      expect(library.routes, contains('GET /albums'));
      // The sheet shows the full asset's file details at once.
      expect(find.textContaining('2000 × 1500'), findsOneWidget);
    });

    testWidgets('with the trash off, Apply asks first; cancelling sends nothing', (tester) async {
      await open(tester, LibraryCleanupQueue.duplicates, trashEnabled: false);
      await swipe(tester, 'd', const Offset(300, 0));
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(find.byKey(const Key('cleanup-trash-confirm')), findsOneWidget);
      await tapKey(tester, 'cleanup-trash-confirm-cancel');
      expect(library.routes.where((route) => route.startsWith('POST /duplicates')), isEmpty);
      expect(find.byKey(const Key('cleanup-finish-apply')), findsOneWidget);
      expect(textOf(tester, 'cleanup-session-badge-count'), '1');
    });
  });

  group('Permission', () {
    testWidgets('a refused duplicates count: no Duplicates card, no duplicates request', (tester) async {
      library.countForbidden = true;
      await open(tester, null, overview: true);
      expect(find.byKey(const Key('cleanup-quick-win-bursts')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-quick-win-duplicates')), findsNothing);
      expect(library.routes, isNot(contains('GET /duplicates')));
    });

    testWidgets('a refused duplicates list: the error, then no Duplicates card and nothing asked again', (
      tester,
    ) async {
      library.listForbidden = true;
      await open(tester, null, overview: true);
      await tester.ensureVisible(find.byKey(const Key('cleanup-quick-win-duplicates')));
      await tapKey(tester, 'cleanup-quick-win-duplicates');
      expect(find.text('Retry'), findsOneWidget);
      final asked = library.routes.length;
      await tapKey(tester, 'cleanup-session-back');
      expect(find.byKey(const Key('cleanup-quick-wins')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-quick-win-duplicates')), findsNothing);
      expect(library.routes.skip(asked).where((route) => route.contains('duplicates')), isEmpty);
    });
  });

  testWidgets('the Bursts and Duplicates quick wins open their series queues', (tester) async {
    await open(tester, null, overview: true);
    await tester.ensureVisible(find.byKey(const Key('cleanup-quick-win-bursts')));
    await tapKey(tester, 'cleanup-quick-win-bursts');
    expect(textOf(tester, 'cleanup-session-title'), 'Bursts & series · 1 of 3');
    expect(topCardId(tester), 'x1');
    await tapKey(tester, 'cleanup-session-back');
    await tester.ensureVisible(find.byKey(const Key('cleanup-quick-win-duplicates')));
    await tapKey(tester, 'cleanup-quick-win-duplicates');
    expect(textOf(tester, 'cleanup-session-title'), 'Duplicates · 1 of 2');
    expect(inCard('d', 'cleanup-series-size-d2'), findsOneWidget);
    expect(textOf(tester, 'cleanup-series-size-d2'), formatBytes(6000));
  });
}
