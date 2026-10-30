import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/routing/router.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_queue_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The guard on "One session screen for every cleanup" (specs/2026-10-29-mobile-library-cleanup-design.md, Slice 9):
// every cleanup, the rewind and all five queues, has the same session parts, so a later change cannot quietly drop one
// from one of them. Each cleanup is walked the same way:
//
// Loading   Given its first page is still on the way   Then the top bar (‹, title, Done, ⋯), the progress, Swipe / Grid
//           and the deck's skeleton show, and Done waits
// Error     Given that page fails   Then the error shows inline with Retry under the same top bar; Retry loads it
// Top bar   Then the title says what and where ("Blurry & botched · 1 of 3"), and the progress shows under it
// Menu      Then ⋯ holds Swipe, Grid, How it works (which replays the gesture lesson), and swipe / button mode where
//           the deck has both (not on the series card, whose layout is the same in both)
// Deck      Then the deck's buttons are there; the details sheet opens from the card's ⓘ (the big frame's for a series)
// Undo      When a card is decided   Then Done counts it; Undo takes it back
// Back      With a pending mark, ‹ asks Apply / Discard / Keep going; so does the iOS back swipe from the screen's edge
// Grid      When Grid is chosen   Then the grid (the series list) shows, and a held photo opens its details
// The walk runs again under reduced motion, where every transition is a fade or nothing, and must reach every part.

class _Cleanup {
  const _Cleanup(this.name, this.route, this.load, this.title, {this.series = false, required this.first});

  final String name;
  final PageRouteInfo route;

  /// The request that loads the session's first cards.
  final String load;

  /// The title before " · 1 of N".
  final String title;
  final bool series;

  /// The id of the first card (a photo, or a series).
  final String first;
}

final _cleanups = [
  _Cleanup('Rewind', LibraryCleanupRewindRoute(monthDay: 815), 'GET /cleanup/rewind/815', 'Aug 15', first: 'p1'),
  _Cleanup(
    'Blurry',
    LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.blurry.slug),
    'GET /cleanup/queues/blurry',
    'Blurry & botched',
    first: 'b1',
  ),
  _Cleanup(
    'Screenshots',
    LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.screenshots.slug),
    'GET /cleanup/queues/screenshots',
    'Screenshots',
    first: 's1',
  ),
  _Cleanup(
    'Space hogs',
    LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.spaceHogs.slug),
    'GET /cleanup/queues/space_hogs',
    'Space hogs',
    first: 'h1',
  ),
  _Cleanup(
    'Bursts',
    LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.bursts.slug),
    'GET /cleanup/queues/bursts',
    'Bursts & series',
    series: true,
    first: 'x1',
  ),
  _Cleanup(
    'Duplicates',
    LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.duplicates.slug),
    'GET /duplicates',
    'Duplicates',
    series: true,
    first: 'd',
  ),
];

Map<String, Object?> _copy(String id, {required int size, String group = 'd'}) => {
  'checksum': 'checksum-$id',
  'createdAt': '2023-10-01T10:00:00.000Z',
  'duplicateId': group,
  'duration': null,
  'exifInfo': {'fileSizeInByte': size, 'exifImageWidth': 4000, 'exifImageHeight': 3000},
  'fileCreatedAt': '2023-10-01T10:00:00.000Z',
  'fileModifiedAt': '2023-10-01T10:00:00.000Z',
  'hasMetadata': true,
  'height': 3000,
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
  'width': 4000,
};

/// One server for all six: the rewind's day, the photo queues, two bursts and two duplicate groups (so deciding one
/// leaves the deck on screen). The first load of the
/// session's cards waits for [hold] and then fails once when [failFirst] is set.
class _Library {
  final rewind = RewindLibrary();
  final queues = QueueLibrary(
    queues: {
      'blurry': [blurryJson('b1', day: 3), blurryJson('b2', day: 2), blurryJson('b3', day: 1)],
      'screenshots': [screenshotJson('s1'), screenshotJson('s2'), screenshotJson('s3')],
      'space_hogs': [hogJson('h1', 300 << 20), hogJson('h2', 200 << 20), hogJson('h3', 150 << 20)],
    },
  );
  final bursts = [
    for (final frames in [
      ['x1', 'x2', 'x3'],
      ['y1', 'y2'],
    ])
      {
        'groupId': frames.first,
        'source': 'burstId',
        'suggestedKeepId': frames.last,
        'assets': [
          for (final (index, id) in frames.indexed)
            assetJson(id, localDateTime: '2023-09-01T10:00:0$index.000Z', fileSize: 1000.0 + index),
        ],
      },
  ];
  final duplicates = [
    for (final group in ['d', 'e'])
      {
        'duplicateId': group,
        'suggestedKeepAssetIds': ['${group}2'],
        'assets': [_copy('${group}1', size: 3000, group: group), _copy('${group}2', size: 6000, group: group)],
      },
  ];

  String load = '';
  Completer<void>? hold;
  bool failFirst = false;

  late final server = FakeCleanupServer(_respond, gate: (request) => request.route == load ? hold?.future : null);
  List<String> get routes => server.routes;

  FakeResponse? _respond(SeenRequest request) {
    final route = request.route;
    if (route == load && failFirst) {
      failFirst = false;
      return const FakeResponse({'message': 'boom'}, 500);
    }
    switch (route) {
      case 'GET /cleanup/queues/bursts/count':
        return const FakeResponse({'count': 2, 'bytes': 0});
      case 'GET /cleanup/queues/bursts':
        return FakeResponse({'items': const <Object>[], 'groups': bursts, 'nextCursor': null});
      case 'GET /cleanup/queues/duplicates/count':
        return const FakeResponse({'count': 2, 'bytes': 0});
      case 'GET /duplicates':
        return FakeResponse(duplicates);
    }
    if (route.startsWith('GET /cleanup/rewind/') || route == 'GET /cleanup/calendar') {
      return rewind.server.respond(request);
    }
    return queues.server.respond(request);
  }
}

void main() {
  setUpAll(initOverviewStore);

  late _Library library;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = _Library();
    await setQueuePrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(Key(key)));
    await settle(tester);
  }

  Future<void> open(WidgetTester tester, _Cleanup cleanup, {bool hold = false, bool reduceMotion = false}) async {
    library.load = cleanup.load;
    library.hold = hold ? Completer<void>() : null;
    listenToPlatform(tester);
    final container = queueContainer(server: library.server, directory: tempDirectory());
    await pumpQueue(
      tester,
      container,
      first: cleanup.route,
      reduceMotion: reduceMotion,
      requests: () => library.routes.length,
    );
    if (!hold) {
      await settle(tester);
    }
  }

  Finder key(String value) => find.byKey(Key(value));

  void expectTopBar() {
    for (final part in ['back', 'title', 'done', 'menu', 'progress']) {
      expect(key('cleanup-session-$part'), findsOneWidget, reason: 'the top bar has its $part');
    }
  }

  String? badge(WidgetTester tester) {
    final finder = key('cleanup-session-badge-count');
    return finder.evaluate().isEmpty ? null : tester.widget<Text>(finder).data;
  }

  /// Decides the card on top with the deck's own button ("Keep" / the series' primary button).
  Future<void> decide(WidgetTester tester, _Cleanup cleanup) =>
      tapKey(tester, cleanup.series ? 'cleanup-series-apply' : 'cleanup-deck-keep');

  for (final cleanup in _cleanups) {
    group(cleanup.name, () {
      for (final reduced in [false, true]) {
        testWidgets('has every part of the session screen${reduced ? ' (reduced motion)' : ''}', (tester) async {
          // Loading: the real layout with the deck's skeleton, under the full top bar.
          library.failFirst = true;
          await open(tester, cleanup, hold: true, reduceMotion: reduced);
          for (var i = 0; i < 6; i++) {
            await tester.pump(const Duration(milliseconds: 50));
          }
          expectTopBar();
          expect(key('cleanup-view-switch'), findsOneWidget);
          expect(key('cleanup-deck-skeleton'), findsOneWidget, reason: 'a skeleton of the deck, never a spinner');
          expect(tester.widget<TextButton>(key('cleanup-session-done')).onPressed, isNull, reason: 'Done waits');

          // Error: inline, with Retry, under the same top bar.
          library.hold!.complete();
          await settle(tester);
          expectTopBar();
          expect(key('cleanup-session-error'), findsOneWidget);
          await tapKey(tester, 'cleanup-session-retry');
          expect(key('cleanup-session-error'), findsNothing);

          // The top bar says what and where.
          expectTopBar();
          expect(textOf(tester, 'cleanup-session-title'), startsWith('${cleanup.title} · 1 of '));
          expect(key('cleanup-view-switch'), findsOneWidget);

          // The ⋯ menu.
          await tapKey(tester, 'cleanup-session-menu');
          for (final item in ['swipe', 'grid', 'how-it-works']) {
            expect(key('cleanup-menu-$item'), findsOneWidget, reason: 'the menu has $item');
          }
          for (final mode in ['swipe', 'button']) {
            expect(
              key('cleanup-menu-mode-$mode'),
              cleanup.series ? findsNothing : findsOneWidget,
              reason: 'swipe / button mode only where the deck has both',
            );
          }
          await tapKey(tester, 'cleanup-menu-how-it-works');
          expect(key('cleanup-gesture-overlay'), findsOneWidget, reason: 'How it works replays the gesture lesson');
          await tapKey(tester, 'cleanup-gesture-overlay-ok');

          // The deck, its buttons and the details sheet.
          final buttons = cleanup.series
              ? ['cleanup-series-top', 'cleanup-series-undo', 'cleanup-series-apply', 'cleanup-series-skip']
              : ['cleanup-deck-top', 'cleanup-deck-undo', 'cleanup-deck-trash', 'cleanup-deck-favorite'];
          for (final part in [
            ...buttons,
            if (!cleanup.series) 'cleanup-deck-keep',
            if (!cleanup.series) 'cleanup-deck-open',
          ]) {
            expect(key(part), findsOneWidget, reason: 'the deck has $part');
          }
          await tapKey(tester, cleanup.series ? 'cleanup-series-details' : 'cleanup-chip-details-${cleanup.first}');
          expect(key('cleanup-details-sheet'), findsOneWidget, reason: 'details are one tap away');
          await tester.tapAt(tester.getCenter(key('cleanup-details-photo')));
          await settle(tester);
          expect(key('cleanup-details-sheet'), findsNothing);

          // A decision counts on Done; Undo takes it back.
          await decide(tester, cleanup);
          expect(badge(tester), '1');
          await tapKey(tester, cleanup.series ? 'cleanup-series-undo' : 'cleanup-deck-undo');
          expect(badge(tester), isNull);
          expect(topCardId(tester), cleanup.first);

          // Back with a pending mark asks first.
          await decide(tester, cleanup);
          await tapKey(tester, 'cleanup-session-back');
          expect(key('cleanup-close-guard'), findsOneWidget);
          await tapKey(tester, 'cleanup-close-keep-going');
          expect(key('cleanup-session'), findsOneWidget);

          // The grid, with the details a hold away.
          await tapKey(tester, 'cleanup-view-grid');
          if (cleanup.series) {
            expect(key('cleanup-series-list'), findsOneWidget);
            expect(key('cleanup-series-details'), findsWidgets);
          } else {
            expect(key('cleanup-grid'), findsOneWidget);
            await tester.longPress(key('cleanup-grid-tile-${cleanup.first}'));
            await settle(tester);
            expect(key('cleanup-details-sheet'), findsOneWidget, reason: 'a held tile opens its details');
          }
          expect(library.queues.commits, isEmpty);
          expect(library.rewind.commits, isEmpty);
        });
      }

      testWidgets('the iOS back swipe with a pending mark asks, as ‹ does', (tester) async {
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        try {
          await open(tester, cleanup);
          await decide(tester, cleanup);
          final height = tester.view.physicalSize.height / tester.view.devicePixelRatio;
          await tester.dragFrom(Offset(4, height / 2), const Offset(300, 0));
          await settle(tester);
          expect(key('cleanup-close-guard'), findsOneWidget);
          await tapKey(tester, 'cleanup-close-keep-going');
          expect(key('cleanup-session'), findsOneWidget, reason: 'Keep going stays');
          expect(badge(tester), '1');
        } finally {
          debugDefaultTargetPlatformOverride = null;
        }
      });
    });
  }
}
