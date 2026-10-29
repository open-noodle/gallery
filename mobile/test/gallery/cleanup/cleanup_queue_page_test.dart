import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_overview.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_queue_card.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_queue_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The photo queues in the session screen (specs/2026-10-29-mobile-library-cleanup-design.md, "Queues: Blurry,
// Screenshots, Space hogs", and the Slice 6 behaviours).
//
// Given Blurry (b1…b12 blurry, d1 too dark, o1 overexposed), Screenshots (s1…s6) and Space hogs (two videos, a photo)
// Signals     When a card is on top   Then Blurry shows its reason and sharpness, a screenshot is whole at its own shape
//                                     (9:19.5 when unknown), a space hog shows its size large
// Marking     When cards are swiped or a button pressed   Then they are marked, Done counts them, nothing is sent; Undo
//                                     steps back one mark
// Paging      When ten or fewer undecided cards remain    Then the next page is asked with the cursor
// End         When the last card is decided   Then the finish screen; Apply commits; an emptied queue is "All clear"
// Filters     When the ⋯ filters change   Then the pages and count are asked with them as the web asks, they are
//                                     remembered for the queue, and the pending marks stay
// Grid        When tiles are tapped, dragged across or all selected   Then the bar counts them with their size, and
//                                     Keep / ♥ / Trash N mark them; the switch is remembered per queue
// Apply       When a photo is in a shared space, or the trash is off   Then one confirmation; cancel commits nothing;
//                                     trash off offers no undo
// Restore     When the app dies with pending marks and the queue is reopened   Then the marks are back, and it says so
// Close       When ‹ is pressed with marks   Then Apply / Discard / Keep going
// Overview    When a quick win is tapped   Then its queue opens with the cover flying in

const _mib = 1048576;

QueueLibrary _library() => QueueLibrary(
  queues: {
    'blurry': [
      blurryJson('b1', day: 30, sharpness: 22),
      for (var i = 2; i <= 12; i++) blurryJson('b$i', day: 30 - i),
      blurryJson('d1', day: 2, reason: 'dark', sharpness: 300),
      blurryJson('o1', day: 1, reason: 'bright', sharpness: 300),
    ],
    'screenshots': [
      screenshotJson('s1'),
      screenshotJson('s2', width: null, height: null),
      screenshotJson('s3', width: 2532, height: 1170),
      screenshotJson('s4'),
      screenshotJson('s5'),
      screenshotJson('s6'),
    ],
    'space_hogs': [hogJson('h1', 300 * _mib), hogJson('h2', 150 * _mib), hogJson('h3', 80 * _mib, type: 'IMAGE')],
  },
);

void main() {
  setUpAll(initOverviewStore);

  late QueueLibrary library;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = _library();
    await setQueuePrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<QueueTestRouter> open(
    WidgetTester tester,
    LibraryCleanupQueue queue, {
    bool trashEnabled = true,
    dynamic directory,
  }) async {
    listenToPlatform(tester);
    final container = queueContainer(
      library: library,
      directory: directory ?? tempDirectory(),
      trashEnabled: trashEnabled,
    );
    final router = await pumpQueue(tester, container, queue: queue, requests: () => library.routes.length);
    await settle(tester);
    return router;
  }

  final top = find.byKey(const Key('cleanup-deck-top'));

  Future<void> swipe(WidgetTester tester, Offset offset) async {
    await tester.fling(top, offset, 1500);
    await settle(tester);
  }

  Future<void> keep(WidgetTester tester) => swipe(tester, const Offset(160, 0));
  Future<void> trash(WidgetTester tester) => swipe(tester, const Offset(-160, 0));
  Future<void> favorite(WidgetTester tester) => swipe(tester, const Offset(0, -160));

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(Key(key)));
    await settle(tester);
  }

  String text(WidgetTester tester, String key) => textOf(tester, key);
  String badge(WidgetTester tester) => text(tester, 'cleanup-session-badge-count');

  double aspectOf(WidgetTester tester, String key) {
    final size = tester.getSize(find.descendant(of: find.byKey(Key(key)), matching: find.byType(AspectRatio)).first);
    return size.width / size.height;
  }

  group('signals', () {
    testWidgets('Blurry: the reason as a badge and a sharpness bar', (tester) async {
      await open(tester, LibraryCleanupQueue.blurry);
      expect(text(tester, 'cleanup-session-title'), 'Blurry & botched · 1 of 14');
      expect(topCardId(tester), 'b1');
      expect(
        find.descendant(of: find.byKey(const Key('cleanup-card-reason-b1')), matching: find.text('Blurry')),
        findsOneWidget,
      );
      final bar = tester.widget<LibraryCleanupSharpnessBar>(find.byKey(const Key('cleanup-card-sharpness-b1')));
      expect(bar.fill, closeTo(22 / 110, 0.001));
      expect(text(tester, 'cleanup-card-headline-b1'), 'Jun 30, 2023');
      expect(find.text('Berlin · 10:00'), findsWidgets);
    });

    testWidgets('Screenshots: whole at their own shape, a phone screen when the shape is unknown', (tester) async {
      await open(tester, LibraryCleanupQueue.screenshots);
      expect(topCardId(tester), 's1');
      expect(aspectOf(tester, 'cleanup-card-whole-s1'), closeTo(1170 / 2532, 0.01));
      expect(find.text('14:12 · 1170×2532'), findsWidgets);
      await trash(tester);
      expect(topCardId(tester), 's2');
      expect(aspectOf(tester, 'cleanup-card-whole-s2'), closeTo(9 / 19.5, 0.01));
      await trash(tester);
      expect(aspectOf(tester, 'cleanup-card-whole-s3'), closeTo(2532 / 1170, 0.01));
    });

    testWidgets('Space hogs: the size, large', (tester) async {
      await open(tester, LibraryCleanupQueue.spaceHogs);
      expect(topCardId(tester), 'h1');
      expect(text(tester, 'cleanup-card-size-h1'), formatBytes(300 * _mib));
      expect(tester.widget<Text>(find.byKey(const Key('cleanup-card-size-h1'))).style!.fontSize, greaterThan(24));
    });
  });

  testWidgets('swipes and buttons mark, Done counts them, nothing is sent; Undo steps back one mark', (tester) async {
    await open(tester, LibraryCleanupQueue.blurry);
    await keep(tester);
    await trash(tester);
    await favorite(tester);
    await tapKey(tester, 'cleanup-deck-trash');
    expect(topCardId(tester), 'b5');
    expect(badge(tester), '4');
    expect(text(tester, 'cleanup-session-title'), 'Blurry & botched · 5 of 14');

    await tapKey(tester, 'cleanup-deck-undo');
    expect(topCardId(tester), 'b4');
    expect(badge(tester), '3');
    expect(library.commits, isEmpty);
    expect(library.routes.where((route) => route.startsWith('POST')), isEmpty, reason: 'marks are local');
  });

  testWidgets('the deck asks for the next page, with the cursor, as ten cards remain', (tester) async {
    await open(tester, LibraryCleanupQueue.blurry);
    // 4, 8, then 12 cards: more than ten wait.
    expect(library.pageQueries, [
      for (final cursor in [null, '4', '8'])
        {
          'strictness': ['balanced'],
          'reason': ['all'],
          'hideFaces': ['true'],
          if (cursor != null) 'cursor': [cursor],
        },
    ]);
    await keep(tester);
    expect(library.pages, hasLength(3));
    await keep(tester);
    expect(library.pages, hasLength(4), reason: 'ten undecided cards remain');
    expect(library.pages.last['cursor'], ['12']);
  });

  group('end of a queue', () {
    testWidgets('the last card leads to the finish screen; Apply commits; the emptied queue is All clear', (
      tester,
    ) async {
      library.queues['space_hogs']!.removeLast();
      await open(tester, LibraryCleanupQueue.spaceHogs);
      await favorite(tester);
      await trash(tester);
      expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-finish-keep-rest')), findsNothing, reason: 'a queue has no day to finish');

      await tapKey(tester, 'cleanup-finish-apply');
      expect(library.commits, [
        {
          'queue': 'space_hogs',
          'trashIds': ['h2'],
          'favoriteIds': ['h1'],
          'keepIds': <String>[],
        },
      ]);
      expect(find.byKey(const Key('cleanup-queue-all-clear')), findsOneWidget);
      expect(find.text('All clear'), findsOneWidget);
      expect(find.text('Trashed 1 asset'), findsOneWidget);

      // Undo on the toast puts the photo back into the queue.
      await tapKey(tester, 'cleanup-toast-undo');
      expect(library.restored, [
        ['h2'],
      ]);
      expect(topCardId(tester), 'h2');

      await tapKey(tester, 'cleanup-deck-keep');
      await tapKey(tester, 'cleanup-finish-apply');
      await tapKey(tester, 'cleanup-queue-back');
      expect(find.byKey(const Key('test-home')), findsOneWidget);
    });

    testWidgets('Done mid-queue applies what is marked and goes back, with the trash undo', (tester) async {
      await open(tester, LibraryCleanupQueue.blurry);
      await keep(tester);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      expect(text(tester, 'cleanup-finish-gone-through'), '2 of 14 gone through');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(library.commits.single, {
        'queue': 'blurry',
        'trashIds': ['b2'],
        'favoriteIds': <String>[],
        'keepIds': ['b1'],
      });
      expect(find.byKey(const Key('test-home')), findsOneWidget);
      await tapKey(tester, 'cleanup-toast-undo');
      expect(library.restored, [
        ['b2'],
      ]);
    });

    testWidgets('an empty queue opens on All clear', (tester) async {
      library.queues['screenshots']!.clear();
      await open(tester, LibraryCleanupQueue.screenshots);
      expect(find.byKey(const Key('cleanup-queue-all-clear')), findsOneWidget);
    });
  });

  group('filters', () {
    testWidgets('Blurry: the request carries them as the web sends them; remembered; the marks stay', (tester) async {
      final directory = tempDirectory();
      await open(tester, LibraryCleanupQueue.blurry, directory: directory);
      await keep(tester);

      await tapKey(tester, 'cleanup-session-menu');
      await tapKey(tester, 'cleanup-menu-filters');
      await tapKey(tester, 'cleanup-filter-reason-dark');
      await tapKey(tester, 'cleanup-filter-strictness-strict');
      await tapKey(tester, 'cleanup-filter-hide-faces');
      expect(library.pages, hasLength(3), reason: 'nothing is asked while the sheet is open');
      await tapKey(tester, 'cleanup-filters-done');

      const dark = {
        'strictness': ['strict'],
        'reason': ['dark'],
        'hideFaces': ['false'],
      };
      expect(library.pageQueries.last, dark);
      expect(library.counts.last, dark);
      expect(topCardId(tester), 'd1');
      expect(badge(tester), '1', reason: 'the keep made before the change is still pending');
      expect(
        storedPrefs().filtersFor(LibraryCleanupQueue.blurry),
        LibraryCleanupFilters.defaults(
          LibraryCleanupQueue.blurry,
        ).copyWith(strictness: CleanupStrictness.strict, reason: CleanupBlurReason.dark, hideFaces: false),
      );

      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(library.commits.single['keepIds'], ['b1']);

      // Reopened, the queue asks with the filters it was left with.
      await open(tester, LibraryCleanupQueue.blurry, directory: directory);
      expect(library.pageQueries.last, dark);
      // Let the first run's toast run out.
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 6));
    });

    testWidgets('Space hogs: type and minimum size', (tester) async {
      await open(tester, LibraryCleanupQueue.spaceHogs);
      expect(library.pageQueries.single, {
        'type': ['video'],
        'minSize': ['104857600'],
      });
      expect(find.byKey(const Key('cleanup-card-h3')), findsNothing);

      await tapKey(tester, 'cleanup-session-menu');
      await tapKey(tester, 'cleanup-menu-filters');
      await tapKey(tester, 'cleanup-filter-type-all');
      await tapKey(tester, 'cleanup-filter-min-size-52428800');
      await tapKey(tester, 'cleanup-filters-done');
      expect(library.pageQueries.last, {
        'type': ['all'],
        'minSize': ['52428800'],
      });
      expect(text(tester, 'cleanup-session-title'), 'Space hogs · 1 of 3');
    });

    testWidgets('Screenshots has no filters', (tester) async {
      await open(tester, LibraryCleanupQueue.screenshots);
      expect(library.pageQueries, [
        <String, List<String>>{},
        {
          'cursor': ['4'],
        },
      ]);
      await tapKey(tester, 'cleanup-session-menu');
      expect(find.byKey(const Key('cleanup-menu-filters')), findsNothing);
    });
  });

  group('details', () {
    final sheet = find.byKey(const Key('cleanup-details-sheet'));
    final photo = find.byKey(const Key('cleanup-details-photo'));

    testWidgets('ⓘ, a tap and an upward drag open it on the card, with the queue\'s signal', (tester) async {
      library.assetInfo['b1'] = assetInfoJson(
        'b1',
        localDateTime: '2023-06-30T10:00:00.000Z',
        exif: {'make': 'Fujifilm', 'model': 'X-T3'},
      );
      await open(tester, LibraryCleanupQueue.blurry);

      await tapKey(tester, 'cleanup-chip-details-b1');
      expect(sheet, findsOneWidget);
      expect(textOf(tester, 'cleanup-details-subtitle'), '3 years ago · Photo 1 of 14');
      expect(textOf(tester, 'cleanup-details-signal-title'), 'Blurry · Sharpness 22');
      expect(library.routes, containsAll(['GET /assets/b1', 'GET /albums']));
      await tester.tapAt(tester.getCenter(photo));
      await settle(tester);
      expect(sheet, findsNothing);

      await tester.tap(top);
      await settle(tester);
      expect(sheet, findsOneWidget);
      await tester.tapAt(tester.getCenter(photo));
      await settle(tester);

      await tester.drag(find.byKey(const Key('cleanup-card-info-b1')), const Offset(0, -80));
      await settle(tester);
      expect(sheet, findsOneWidget);
      expect(find.byKey(const Key('cleanup-session-badge-count')), findsNothing, reason: 'the drag only opened it');
    });

    testWidgets('Trash in the sheet closes it and trashes the card, as the button does', (tester) async {
      await open(tester, LibraryCleanupQueue.blurry);
      await tapKey(tester, 'cleanup-chip-details-b1');
      await tapKey(tester, 'cleanup-details-trash');

      expect(sheet, findsNothing);
      expect(topCardId(tester), 'b2');
      expect(badge(tester), '1');
      expect(library.commits, isEmpty);
    });

    testWidgets('"Review the N first" on the finish screen: a long press opens the sheet', (tester) async {
      await open(tester, LibraryCleanupQueue.spaceHogs);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-review');
      await tester.longPress(find.byKey(const Key('cleanup-review-h1')));
      await settle(tester);
      expect(sheet, findsOneWidget);
      expect(library.routes, contains('GET /assets/h1'));
    });
  });

  group('grid', () {
    Finder tile(String id) => find.byKey(Key('cleanup-grid-tile-$id'));
    bool selected(String id) => find.byKey(Key('cleanup-grid-selected-$id')).evaluate().isNotEmpty;
    bool marked(String id, String mark) => find.byKey(Key('cleanup-grid-mark-$mark-$id')).evaluate().isNotEmpty;

    testWidgets('tap selects, a drag across selects a run, the bar marks them and Done counts up', (tester) async {
      await open(tester, LibraryCleanupQueue.screenshots);
      await tapKey(tester, 'cleanup-view-grid');
      expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);
      expect(find.text('Hold a photo for details'), findsOneWidget);

      await tester.tap(tile('s1'));
      await settle(tester);
      expect(selected('s1'), isTrue);
      expect(text(tester, 'cleanup-grid-selected-count'), '1 selected');

      // s4, s5, s6 are the second row: drag from the first to the last.
      final from = tester.getCenter(tile('s4'));
      await tester.dragFrom(from, tester.getCenter(tile('s6')) - from);
      await settle(tester);
      expect(['s1', 's2', 's3', 's4', 's5', 's6'].where(selected), ['s1', 's4', 's5', 's6']);
      expect(text(tester, 'cleanup-grid-selected-count'), '4 selected');
      expect(text(tester, 'cleanup-grid-selected-size'), formatBytes(4000));
      expect(find.text('Trash 4 selected'), findsOneWidget);

      await tapKey(tester, 'cleanup-grid-trash');
      expect(['s1', 's4', 's5', 's6'].every((id) => marked(id, 'trash')), isTrue);
      expect(find.byKey(const Key('cleanup-grid-bar')), findsNothing, reason: 'the selection clears');
      expect(badge(tester), '4');

      await tapKey(tester, 'cleanup-grid-select-all');
      expect(text(tester, 'cleanup-grid-selected-count'), '6 selected');
      await tapKey(tester, 'cleanup-grid-keep');
      expect(['s1', 's2', 's3', 's4', 's5', 's6'].every((id) => marked(id, 'keep')), isTrue);
      await tester.tap(tile('s2'));
      await settle(tester);
      await tapKey(tester, 'cleanup-grid-favorite');
      expect(marked('s2', 'favorite'), isTrue);
      expect(badge(tester), '6');
      expect(library.commits, isEmpty);

      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(library.commits.single, {
        'queue': 'screenshots',
        'trashIds': <String>[],
        'favoriteIds': ['s2'],
        // In the order first marked (the four trashed first).
        'keepIds': ['s1', 's4', 's5', 's6', 's3'],
      });
    });

    testWidgets('screenshots keep their shape in the grid', (tester) async {
      await setQueuePrefs(views: {LibraryCleanupQueue.screenshots: LibraryCleanupView.grid});
      await open(tester, LibraryCleanupQueue.screenshots);
      expect(aspectOf(tester, 'cleanup-grid-whole-s3'), closeTo(2532 / 1170, 0.01));
      expect(aspectOf(tester, 'cleanup-grid-whole-s2'), closeTo(9 / 19.5, 0.01));
    });

    testWidgets('a long press opens the details sheet; Keep there marks the tile, and the hint is gone', (
      tester,
    ) async {
      await setQueuePrefs(views: {LibraryCleanupQueue.blurry: LibraryCleanupView.grid});
      await open(tester, LibraryCleanupQueue.blurry);
      await tester.longPress(tile('b3'));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-details-sheet')), findsOneWidget);
      expect(library.routes, containsAll(['GET /assets/b3', 'GET /albums']));
      expect(selected('b3'), isFalse, reason: 'holding selects nothing');

      await tapKey(tester, 'cleanup-details-keep');
      expect(find.byKey(const Key('cleanup-details-sheet')), findsNothing);
      expect(marked('b3', 'keep'), isTrue);
      expect(badge(tester), '1');
      expect(find.byKey(const Key('cleanup-grid-hint')), findsNothing);
      expect(library.commits, isEmpty);
    });

    testWidgets('Swipe / Grid is remembered per queue', (tester) async {
      final router = await open(tester, LibraryCleanupQueue.blurry);
      await tapKey(tester, 'cleanup-view-grid');
      await tapKey(tester, 'cleanup-session-back');
      expect(storedPrefs().viewFor(LibraryCleanupQueue.blurry), LibraryCleanupView.grid);

      unawaited(router.push(LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.screenshots.slug)));
      await settle(tester);
      expect(topCardId(tester), 's1', reason: 'Screenshots is still on swipe');
      await tapKey(tester, 'cleanup-session-back');

      unawaited(router.push(LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.blurry.slug)));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);
    });
  });

  group('trash confirmation', () {
    testWidgets('a photo in a shared space is confirmed once on Apply; cancelling commits nothing', (tester) async {
      library.inSpaces.add('b1');
      await open(tester, LibraryCleanupQueue.blurry);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(
        find.text('1 photo is also in a shared space. Trashing removes it for space members too.'),
        findsOneWidget,
      );
      await tapKey(tester, 'cleanup-trash-confirm-cancel');
      expect(library.commits, isEmpty);
      expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);

      await tapKey(tester, 'cleanup-finish-apply');
      await tapKey(tester, 'cleanup-trash-confirm-ok');
      expect(library.commits.single['trashIds'], ['b1']);
    });

    testWidgets('with the trash off: a permanent delete, and no undo', (tester) async {
      await open(tester, LibraryCleanupQueue.blurry, trashEnabled: false);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-apply');
      expect(find.text('Permanently delete'), findsWidgets);
      await tapKey(tester, 'cleanup-trash-confirm-ok');
      expect(library.commits.single['trashIds'], ['b1']);
      expect(find.text('Permanently deleted 1 asset'), findsOneWidget);
      expect(find.byKey(const Key('cleanup-toast-undo')), findsNothing);
    });
  });

  testWidgets('killed with pending marks, the reopened queue restores them and says so', (tester) async {
    final directory = tempDirectory();
    await open(tester, LibraryCleanupQueue.blurry, directory: directory);
    await keep(tester);
    await trash(tester);
    await tester.pumpWidget(const SizedBox());
    await settle(tester);

    await open(tester, LibraryCleanupQueue.blurry, directory: directory);
    expect(find.text('Restored your marks'), findsOneWidget);
    expect(badge(tester), '2');
    expect(topCardId(tester), 'b3');
  });

  testWidgets('‹ with marks asks; Discard leaves without committing', (tester) async {
    await open(tester, LibraryCleanupQueue.blurry);
    await keep(tester);
    await tapKey(tester, 'cleanup-session-back');
    expect(find.byKey(const Key('cleanup-close-guard')), findsOneWidget);
    expect(find.text('Apply'), findsOneWidget);
    await tapKey(tester, 'cleanup-close-discard');
    expect(find.byKey(const Key('test-home')), findsOneWidget);
    expect(library.commits, isEmpty);
  });

  testWidgets('the first-run overlay is the rewind\'s: shown once in all', (tester) async {
    await setQueuePrefs(overlaySeen: false);
    final router = await open(tester, LibraryCleanupQueue.blurry);
    expect(find.byKey(const Key('cleanup-gesture-overlay')), findsOneWidget);
    expect(storedPrefs().overlaySeen, isTrue);
    await tapKey(tester, 'cleanup-gesture-overlay-ok');
    await tapKey(tester, 'cleanup-session-back');

    unawaited(router.push(LibraryCleanupQueueRoute(queue: LibraryCleanupQueue.screenshots.slug)));
    await settle(tester);
    expect(find.byKey(const Key('cleanup-gesture-overlay')), findsNothing);
  });

  group('from the overview', () {
    Future<void> openOverview(WidgetTester tester) async {
      listenToPlatform(tester);
      final container = queueContainer(library: library, directory: tempDirectory());
      await pumpQueue(
        tester,
        container,
        first: const LibraryCleanupOverviewRoute(),
        requests: () => library.routes.length,
      );
      await settle(tester);
    }

    testWidgets("a quick win opens its queue, and its cover flies into the first card", (tester) async {
      await openOverview(tester);
      expect(find.byKey(const Key('cleanup-cover-blurry')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('cleanup-quick-win-blurry')));
      await tapKey(tester, 'cleanup-quick-win-blurry');
      expect(text(tester, 'cleanup-session-title'), 'Blurry & botched · 1 of 14');
      final tag = LibraryCleanupHeroTags.queue(LibraryCleanupQueue.blurry);
      expect(
        find.descendant(
          of: find.byKey(const Key('cleanup-card-b1')),
          matching: find.byWidgetPredicate((widget) => widget is Hero && widget.tag == tag),
        ),
        findsOneWidget,
      );
      await tapKey(tester, 'cleanup-session-back');
      expect(find.byKey(const Key('cleanup-quick-wins')), findsOneWidget);
    });
  });
}
