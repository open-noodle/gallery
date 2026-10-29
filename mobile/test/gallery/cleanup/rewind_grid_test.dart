import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/routing/router.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The rewind's Grid mode (specs/2026-10-29-mobile-library-cleanup-design.md, "Rewind" → "Grid mode", "Motion" →
// "Swipe ↔ Grid", and Slice 5), on 15 August: p1, p2 (2022, Lisbon), q1–q3 (2020, Porto). Today is 15 August 2026.
//
// Sections       Given the grid   Then 2022 then 2020, "4 years ago · Lisbon · 2 photos", each with "Keep all remaining"
// Tap cycle      When a tile is tapped four times   Then keep, favourite, trash, none, the Done badge following
// Keep the rest  When "Keep all remaining" is tapped on 2020   Then q1–q3 are kept, 2020 reads "Year reviewed", 2022 is
//                untouched
// Details        When a tile is held   Then the details sheet opens; Favourite there marks the tile
// Switching      Given marks in the deck, when the grid opens   Then they show on the tiles and the grid is scrolled to
//                the card the deck was on; back in the deck, it is on the first undecided photo
// Flight         When switching   Then the card flies into its tile, which stays empty until it lands, and back;
//                reduced motion crossfades with no flight
// Hint           The first grid shows "Hold a photo for details" once; the next session does not
// Finish         In the grid, Done opens the finish screen ("1 of 5 gone through"), Keep going returns to the grid;
//                marking every tile does not open it by itself; back with marks asks first
// Review         "Review the N first" shows only the trash marks as tiles; a tap rescues one; a hold opens details
// Remembered     The grid is remembered for the next rewind

void main() {
  setUpAll(initOverviewStore);

  late RewindLibrary library;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = RewindLibrary(
      days: {
        815: rewindDay815(),
        // 3 January 2021: thirty photos, so the grid has to scroll to the card the deck was on.
        103: {
          2021: [
            for (var i = 1; i <= 30; i++)
              assetJson('b$i', localDateTime: '2021-01-03T${(i % 24).toString().padLeft(2, '0')}:00:00.000Z'),
          ],
        },
      },
    );
    await setPrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<RewindTestRouter> open(
    WidgetTester tester, {
    bool reduceMotion = false,
    int monthDay = 815,
    dynamic directory,
  }) async {
    listenToPlatform(tester);
    final container = rewindContainer(library: library, directory: directory ?? tempDirectory());
    return pumpRewind(
      tester,
      container,
      reduceMotion: reduceMotion,
      first: LibraryCleanupRewindRoute(monthDay: monthDay),
      requests: () => library.routes.length,
    );
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(Key(key)));
    await settle(tester);
  }

  Future<void> toGrid(WidgetTester tester) async {
    await tapKey(tester, 'cleanup-session-menu');
    await tapKey(tester, 'cleanup-menu-grid');
  }

  Future<void> toSwipe(WidgetTester tester) async {
    await tapKey(tester, 'cleanup-session-menu');
    await tapKey(tester, 'cleanup-menu-swipe');
  }

  LibraryCleanupMark? markOf(String id) {
    for (final mark in LibraryCleanupMark.values) {
      if (find.byKey(Key('cleanup-grid-mark-$id-${mark.name}')).evaluate().isNotEmpty) {
        return mark;
      }
    }
    return null;
  }

  String? badge(WidgetTester tester) {
    final finder = find.byKey(const Key('cleanup-session-badge-count'));
    return finder.evaluate().isEmpty ? null : tester.widget<Text>(finder).data;
  }

  Finder tile(String id) => find.byKey(Key('cleanup-grid-tile-$id'));

  testWidgets('year sections newest first, each with its line and "Keep all remaining"', (tester) async {
    await open(tester);
    await toGrid(tester);

    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(const Key('cleanup-grid-year-2022'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('cleanup-grid-year-2020'))).dy),
    );
    expect(textOf(tester, 'cleanup-grid-year-meta-2022'), '4 years ago · Lisbon · 2 photos');
    expect(textOf(tester, 'cleanup-grid-year-meta-2020'), '6 years ago · Porto · 3 photos');
    expect(find.byKey(const Key('cleanup-grid-keep-rest-2022')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-grid-keep-rest-2020')), findsOneWidget);
    for (final id in ['p1', 'p2', 'q1', 'q2', 'q3']) {
      expect(tile(id), findsOneWidget);
    }
  });

  testWidgets('a tap cycles none → keep → favourite → trash → none', (tester) async {
    await open(tester);
    await toGrid(tester);

    final marks = <LibraryCleanupMark?>[];
    final badges = <String?>[];
    for (var i = 0; i < 4; i++) {
      await tester.tap(tile('q2'));
      await settle(tester);
      marks.add(markOf('q2'));
      badges.add(badge(tester));
    }
    expect(marks, [LibraryCleanupMark.keep, LibraryCleanupMark.favorite, LibraryCleanupMark.trash, null]);
    expect(badges, ['1', '1', '1', null]);
    expect(library.commits, isEmpty);
  });

  testWidgets('"Keep all remaining" keeps every untouched photo of that year only', (tester) async {
    await open(tester);
    await toGrid(tester);
    await tester.tap(tile('q1'));
    await tester.tap(tile('q1'));
    await tester.tap(tile('q1'));
    await settle(tester);
    expect(markOf('q1'), LibraryCleanupMark.trash);

    await tapKey(tester, 'cleanup-grid-keep-rest-2020');
    expect([markOf('q1'), markOf('q2'), markOf('q3')], [
      LibraryCleanupMark.trash,
      LibraryCleanupMark.keep,
      LibraryCleanupMark.keep,
    ]);
    expect([markOf('p1'), markOf('p2')], [null, null]);
    expect(find.byKey(const Key('cleanup-grid-year-reviewed-2020')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-grid-keep-rest-2020')), findsNothing);
    expect(find.byKey(const Key('cleanup-grid-keep-rest-2022')), findsOneWidget);
    expect(badge(tester), '3');
  });

  testWidgets('a long press opens the details sheet, and Favourite there marks the tile', (tester) async {
    await open(tester);
    await toGrid(tester);

    await tester.longPress(tile('p2'));
    await settle(tester);
    expect(find.byKey(const Key('cleanup-details-sheet')), findsOneWidget);
    expect(markOf('p2'), isNull, reason: 'holding marks nothing');
    await tapKey(tester, 'cleanup-details-favorite');

    expect(find.byKey(const Key('cleanup-details-sheet')), findsNothing);
    expect(markOf('p2'), LibraryCleanupMark.favorite);
    expect(badge(tester), '1');
  });

  testWidgets('switching keeps every mark and the position', (tester) async {
    final directory = tempDirectory();
    // Twenty-four photos decided on an earlier visit, still pending: the deck opens on b25.
    await saveDayMarks(tester, directory, 103, {
      for (var i = 1; i <= 24; i++) 'b$i': i == 3 ? LibraryCleanupMark.trash : LibraryCleanupMark.keep,
    });
    await open(tester, monthDay: 103, directory: directory);
    expect(topCardId(tester), 'b25');

    await toGrid(tester);
    expect(markOf('b3'), LibraryCleanupMark.trash);
    expect(markOf('b24'), LibraryCleanupMark.keep);
    final viewport = tester.getRect(find.byKey(const Key('cleanup-grid')));
    expect(viewport.contains(tester.getCenter(tile('b25'))), isTrue, reason: 'the grid is at the card the deck was on');
    expect(viewport.contains(tester.getCenter(tile('b1'))), isFalse, reason: 'and so scrolled past the first photos');

    await tester.tap(tile('b25'));
    await settle(tester);
    await toSwipe(tester);
    expect(topCardId(tester), 'b26', reason: 'the deck goes on at the first undecided photo');
    expect(badge(tester), '25');
  });

  testWidgets('the card flies into its tile and back; reduced motion crossfades', (tester) async {
    await open(tester);
    final card = tester.getRect(find.byKey(const Key('cleanup-card-p1')));

    await tester.tap(find.byKey(const Key('cleanup-session-menu')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('cleanup-menu-grid')));
    final flights = <Rect>[];
    var hiddenWhileFlying = false;
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      final flight = find.byKey(const Key('gallery-flight'));
      if (flight.evaluate().isNotEmpty) {
        flights.add(tester.getRect(flight));
        final opacity = tester.widget<Opacity>(
          find.descendant(of: tile('p1'), matching: find.byType(Opacity)).first,
        );
        hiddenWhileFlying = hiddenWhileFlying || opacity.opacity == 0;
      }
    }
    await settle(tester);
    expect(flights, isNotEmpty, reason: 'the card flies');
    expect(hiddenWhileFlying, isTrue, reason: 'its tile stays empty until it lands');
    expect(flights.first.width, greaterThan(flights.last.width), reason: 'it shrinks from the card into the tile');
    expect(flights.first.width, closeTo(card.width, card.width * 0.25));
    final landed = tester.getRect(tile('p1'));
    expect((flights.last.center - landed.center).distance, lessThan(12));
    expect(find.byKey(const Key('gallery-flight')), findsNothing);

    await tester.tap(find.byKey(const Key('cleanup-session-menu')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('cleanup-menu-swipe')));
    var back = false;
    for (var i = 0; i < 40 && !back; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      back = find.byKey(const Key('gallery-flight')).evaluate().isNotEmpty;
    }
    expect(back, isTrue, reason: 'the first undecided tile grows back into the card');
    await settle(tester);
  });

  testWidgets('under reduced motion nothing flies', (tester) async {
    await open(tester, reduceMotion: true);
    await tester.tap(find.byKey(const Key('cleanup-session-menu')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('cleanup-menu-grid')));
    var flew = false;
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      flew = flew || find.byKey(const Key('gallery-flight')).evaluate().isNotEmpty;
    }
    await settle(tester);
    expect(flew, isFalse);
    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);
  });

  testWidgets('the hold hint shows on the first grid only, and the grid is remembered', (tester) async {
    final router = await open(tester);
    await toGrid(tester);
    expect(find.byKey(const Key('cleanup-grid-hint')), findsOneWidget);
    expect(LibraryCleanupPrefs.fromJsonString(Store.tryGet(StoreKey.libraryCleanupPrefs)).gridHintSeen, isTrue);

    await tapKey(tester, 'cleanup-session-back');
    unawaited(router.push(LibraryCleanupRewindRoute(monthDay: 815)));
    await settle(tester);
    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget, reason: 'the grid is remembered');
    expect(find.byKey(const Key('cleanup-grid-hint')), findsNothing);
    expect(
      LibraryCleanupPrefs.fromJsonString(
        Store.tryGet(StoreKey.libraryCleanupPrefs),
      ).viewFor(LibraryCleanupQueue.rewind),
      LibraryCleanupView.grid,
    );
  });

  testWidgets('Done, Keep going and the close guard work as in the deck; the last tile opens nothing by itself', (
    tester,
  ) async {
    await open(tester);
    await toGrid(tester);
    await tester.tap(tile('p1'));
    await settle(tester);

    await tapKey(tester, 'cleanup-session-done');
    expect(textOf(tester, 'cleanup-finish-gone-through'), '1 of 5 gone through');
    await tapKey(tester, 'cleanup-finish-keep-going');
    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);

    for (final id in ['p2', 'q1', 'q2', 'q3']) {
      await tester.tap(tile(id));
    }
    await settle(tester);
    expect(find.byKey(const Key('cleanup-finish')), findsNothing, reason: 'a tap may still step the mark on');
    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);

    await tapKey(tester, 'cleanup-session-back');
    expect(find.byKey(const Key('cleanup-close-guard')), findsOneWidget);
    await tapKey(tester, 'cleanup-close-keep-going');
    expect(find.byKey(const Key('cleanup-grid')), findsOneWidget);
    expect(badge(tester), '5');
  });

  testWidgets('"Review the N first" shows the trash marks as tiles; a tap rescues, a hold opens details', (
    tester,
  ) async {
    await open(tester);
    await toGrid(tester);
    for (final id in ['p1', 'q2']) {
      for (var i = 0; i < 3; i++) {
        await tester.tap(tile(id));
      }
    }
    await settle(tester);

    await tapKey(tester, 'cleanup-session-done');
    await tapKey(tester, 'cleanup-finish-review');
    expect(find.byKey(const Key('cleanup-review-p1')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-review-q2')), findsOneWidget);
    expect(find.byKey(const Key('cleanup-grid-mark-p1-trash')), findsOneWidget, reason: 'the grid\'s trash look');

    await tester.longPress(find.byKey(const Key('cleanup-review-q2')));
    await settle(tester);
    expect(find.byKey(const Key('cleanup-details-sheet')), findsOneWidget);
    await tester.tapAt(tester.getCenter(find.byKey(const Key('cleanup-details-photo'))));
    await settle(tester);

    await tapKey(tester, 'cleanup-review-p1');
    expect(find.byKey(const Key('cleanup-review-p1')), findsNothing, reason: 'rescued');
    expect(find.byKey(const Key('cleanup-review-q2')), findsOneWidget);
    await tapKey(tester, 'cleanup-review-close');
    expect(textOf(tester, 'cleanup-finish-trash'), '1');
    expect(textOf(tester, 'cleanup-finish-kept'), '1');
  });
}
