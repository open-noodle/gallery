import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/motion/pop.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/bytes_units.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The rewind in its session screen (specs/2026-10-29-mobile-library-cleanup-design.md, "Rewind", "Celebrating a
// finished day", "Trash confirmation", and the Slice 3 behaviours), on 15 August: p1, p2 (2022), q1–q3 (2020).
//
// Top bar        "Aug 15 · 1 of 5", one progress segment per year with the current year's label, Done counting marks
// Navigation     back returns to the opener; "Next day" replaces the session, so back after two Nexts is the overview
// First run      the gesture overlay shows once and counts as seen; "How it works" replays it
// Loading        the deck skeleton; an error keeps the top bar and retries
// Restore        a session killed mid-way reopens with its marks and position, and says "Restored your marks"
// Finish screen  Done mid-way: "2 of 5 gone through" and the three actions; Apply and stop and Keep the rest send what
//                Slice 1 defines; deciding the last card shows the all-decided actions
// Close guard    ‹ and Android back with marks ask Apply / Discard / Keep going; with none, they close
// Celebration    flight, ring and count-up, then haptic and confetti, then the streak, then the buttons; once only;
//                reduced motion shows the end state with the haptic; Apply and stop never celebrates
// After          "Next" opens the next day; "Back to Cleanup" shows the day's cell turning green
// Trash check    a photo in a shared space is confirmed; cancelling commits nothing and keeps the finish screen
// Open in library  opens the viewer, and back returns to the same card

void main() {
  setUpAll(initOverviewStore);

  late RewindLibrary library;
  late RewindPlatform platform;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = RewindLibrary(
      days: {
        815: rewindDay815(),
        411: {
          2021: [assetJson('a1', localDateTime: '2021-04-11T10:00:00.000Z')],
        },
        1224: {
          2019: [assetJson('x1', localDateTime: '2019-12-24T10:00:00.000Z')],
        },
      },
    );
    await setPrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<RewindTestRouter> open(
    WidgetTester tester, {
    bool reduceMotion = false,
    bool fromOverview = false,
    bool trashEnabled = true,
    dynamic directory,
  }) async {
    platform = listenToPlatform(tester);
    final container = rewindContainer(
      library: library,
      directory: directory ?? tempDirectory(),
      trashEnabled: trashEnabled,
    );
    final router = await pumpRewind(
      tester,
      container,
      reduceMotion: reduceMotion,
      first: fromOverview ? const LibraryCleanupOverviewRoute() : null,
      requests: () => library.routes.length,
    );
    if (fromOverview) {
      await tester.tap(find.byKey(const Key('cleanup-today-start')));
      await settle(tester);
    }
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

  group('top bar', () {
    testWidgets('the title, a segment per year with the current year, and a Done badge counting marks', (tester) async {
      await open(tester);
      expect(text(tester, 'cleanup-session-title'), 'Aug 15 · 1 of 5');
      expect(find.byKey(const Key('cleanup-session-progress-0')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-session-progress-1')), findsOneWidget);
      expect(text(tester, 'cleanup-session-year'), '2022 · 4 years ago');
      expect(find.byKey(const Key('cleanup-session-badge')), findsNothing);

      await keep(tester);
      await favorite(tester);
      expect(text(tester, 'cleanup-session-title'), 'Aug 15 · 3 of 5');
      expect(text(tester, 'cleanup-session-year'), '2020 · 6 years ago', reason: 'into the next year');
      expect(text(tester, 'cleanup-session-badge-count'), '2');
      expect(text(tester, 'cleanup-card-headline-q1'), '2020 · 6 years ago');
      expect(find.text('Porto · 08:00'), findsWidgets);
    });

    testWidgets('the info strip: size, "In an album", details', (tester) async {
      await open(tester);
      expect(find.byKey(const Key('cleanup-chip-album-p1')), findsOneWidget);
      expect(find.text(formatBytes(1500000)), findsWidgets);
      expect(find.text('Lisbon · 09:00'), findsWidgets);
      expect(find.byKey(const Key('cleanup-chip-details-p1')), findsOneWidget);
    });
  });

  group('navigation', () {
    testWidgets('back returns to the overview it was opened from', (tester) async {
      await open(tester, fromOverview: true);
      expect(find.byKey(const Key('cleanup-session')), findsOneWidget);
      await tapKey(tester, 'cleanup-session-back');
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    });

    testWidgets('"Next day" replaces the session: back after two Nexts lands on the overview', (tester) async {
      final router = await open(tester, fromOverview: true);
      final depth = router.stack.length;

      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-keep-rest');
      await settle(tester);
      expect(text(tester, 'cleanup-day-done-title'), 'August 15 cleaned up');
      await tapKey(tester, 'cleanup-day-done-next');
      expect(text(tester, 'cleanup-session-title'), 'Dec 24 · 1 of 1');
      expect(router.stack.length, depth);

      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-keep-rest');
      await tapKey(tester, 'cleanup-day-done-next');
      expect(text(tester, 'cleanup-session-title'), 'Apr 11 · 1 of 1');
      expect(router.stack.length, depth);

      await tapKey(tester, 'cleanup-session-back');
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    });
  });

  group('first run', () {
    testWidgets('the gesture overlay shows once, counts as seen at once, and "How it works" replays it', (
      tester,
    ) async {
      await setPrefs(overlaySeen: false);
      await open(tester);
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsOneWidget);
      expect(find.text('Nothing is deleted until you press Done'), findsOneWidget);
      expect(LibraryCleanupPrefs.fromJsonString(Store.tryGet(StoreKey.libraryCleanupPrefs)).overlaySeen, isTrue);

      await tapKey(tester, 'cleanup-gesture-overlay-ok');
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsNothing);

      await tapKey(tester, 'cleanup-session-menu');
      await tapKey(tester, 'cleanup-menu-how-it-works');
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsOneWidget);
    });

    testWidgets('a later session does not show it', (tester) async {
      await open(tester);
      expect(find.byKey(const Key('cleanup-gesture-overlay')), findsNothing);
    });
  });

  group('loading', () {
    testWidgets('the deck skeleton while loading; an error keeps the top bar and retries', (tester) async {
      library
        ..yearsFail = true
        ..hold = Completer<void>();
      platform = listenToPlatform(tester);
      final container = rewindContainer(library: library, directory: tempDirectory());
      await pumpRewind(tester, container, settle: false);
      await frames(tester, const Duration(milliseconds: 400));
      expect(find.byKey(const Key('cleanup-deck-skeleton')), findsOneWidget);
      library.hold!.complete();
      library.hold = null;
      await settle(tester);

      expect(find.byKey(const Key('cleanup-session-error')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-session-back')), findsOneWidget);
      library.yearsFail = false;
      await tapKey(tester, 'cleanup-session-retry');
      expect(topCardId(tester), 'p1');
    });
  });

  testWidgets('a session killed mid-way reopens with its marks and position, and says so', (tester) async {
    final directory = tempDirectory();
    await open(tester, directory: directory);
    await keep(tester);
    await trash(tester);
    expect(topCardId(tester), 'q1');
    // The app dies: the widgets and the providers go, the saved marks stay on the device.
    await tester.pumpWidget(const SizedBox());
    await settle(tester);

    await open(tester, directory: directory);
    expect(find.text('Restored your marks'), findsOneWidget);
    expect(topCardId(tester), 'q1');
    expect(text(tester, 'cleanup-session-badge-count'), '2');
    expect(text(tester, 'cleanup-session-title'), 'Aug 15 · 3 of 5');
  });

  group('finish screen', () {
    testWidgets('Done mid-way: how far, and Apply and stop sends the marks without completing the day', (tester) async {
      await open(tester, fromOverview: true);
      await keep(tester);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      expect(text(tester, 'cleanup-finish-gone-through'), '2 of 5 gone through');
      expect(find.byKey(const Key('cleanup-finish-apply-and-stop')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-finish-keep-rest')), findsOneWidget);
      expect(find.text('Review the 1 first'), findsOneWidget);

      await tapKey(tester, 'cleanup-finish-apply-and-stop');
      expect(library.commits, [
        {
          'queue': 'rewind',
          'trashIds': ['p2'],
          'favoriteIds': <String>[],
          'keepIds': ['p1'],
        },
      ]);
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget, reason: 'back where it was opened from');
      expect(find.text('Saved · 1 moved to trash · pick up at photo 3 any time'), findsOneWidget);
      expect(find.byKey(const Key('gallery-celebrate-day')), findsNothing, reason: 'Apply and stop never celebrates');

      // The toast's Undo restores exactly what was trashed.
      await tapKey(tester, 'cleanup-toast-undo');
      await settle(tester);
      expect(library.restored, [
        ['p2'],
      ]);
    });

    testWidgets('Keep the rest and finish day keeps every untouched photo and completes the day', (tester) async {
      await open(tester);
      await favorite(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-keep-rest');
      expect(library.commits, [
        {
          'queue': 'rewind',
          'trashIds': <String>[],
          'favoriteIds': ['p1'],
          'keepIds': ['p2', 'q1', 'q2', 'q3'],
          'completeMonthDay': 815,
        },
      ]);
      expect(find.byKey(const Key('cleanup-day-done')), findsOneWidget);
    });

    testWidgets('deciding the last card opens the all-decided finish screen', (tester) async {
      await open(tester);
      await keep(tester);
      await keep(tester);
      await trash(tester);
      await keep(tester);
      await keep(tester);
      expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);
      expect(find.byKey(const Key('cleanup-finish-gone-through')), findsNothing);
      expect(find.text('Move 1 to trash and finish'), findsOneWidget);

      // Review the pile first: a tap keeps the photo instead, and the button becomes "Finish day".
      await tapKey(tester, 'cleanup-finish-review');
      await tapKey(tester, 'cleanup-review-q1');
      expect(find.text('Finish day'), findsOneWidget);
      await tapKey(tester, 'cleanup-finish-day');
      expect(library.commits.single['trashIds'], isEmpty);
      expect(library.commits.single['completeMonthDay'], 815);
    });
  });

  group('close guard', () {
    testWidgets('‹ with marks asks; Keep going stays, Discard leaves without them', (tester) async {
      final directory = tempDirectory();
      await open(tester, fromOverview: true, directory: directory);
      await keep(tester);

      await tapKey(tester, 'cleanup-session-back');
      expect(find.text('1 photo is marked'), findsOneWidget);
      await tapKey(tester, 'cleanup-close-keep-going');
      expect(topCardId(tester), 'p2');

      await tapKey(tester, 'cleanup-session-back');
      await tapKey(tester, 'cleanup-close-discard');
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
      expect(library.commits, isEmpty);

      await tapKey(tester, 'cleanup-today-start');
      expect(topCardId(tester), 'p1', reason: 'the marks were discarded');
      expect(find.text('Restored your marks'), findsNothing);
    });

    testWidgets('Android back asks the same, and Apply and stop commits and leaves', (tester) async {
      await open(tester, fromOverview: true);
      await trash(tester);

      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.byKey(const Key('cleanup-close-guard')), findsOneWidget);
      await tapKey(tester, 'cleanup-close-apply');
      expect(library.commits.single['trashIds'], ['p1']);
      expect(library.commits.single.containsKey('completeMonthDay'), isFalse);
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    });

    testWidgets('with no marks, back closes at once', (tester) async {
      await open(tester, fromOverview: true);
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.byKey(const Key('cleanup-close-guard')), findsNothing);
      expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    });
  });

  group('celebration', () {
    Future<void> finishDay(WidgetTester tester) async {
      await keep(tester);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tester.tap(find.byKey(const Key('cleanup-finish-keep-rest')));
      // Fake time only from here, to watch the order.
      for (var i = 0; i < 6; i++) {
        await tester.pump();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
      }
    }

    bool shown(String key) => find.byKey(Key(key)).evaluate().isNotEmpty;

    testWidgets('plays once, in order: flight, ring and counts, haptic and confetti, streak, buttons', (tester) async {
      await open(tester);
      await finishDay(tester);
      expect(shown('cleanup-day-done'), isTrue);
      // The trashed photo flies from the finish screen as it goes.
      expect(shown('gallery-removal'), isTrue);
      await frames(tester, const Duration(milliseconds: 150));
      expect(
        [shown('gallery-celebrate-day'), shown('cleanup-day-done-streak'), shown('cleanup-day-done-hub')],
        [false, false, false],
      );
      expect(platform.count('HapticFeedbackType.mediumImpact'), 0);

      // The ring closes: the haptic and the confetti, together.
      var waited = Duration.zero;
      while (!shown('gallery-celebrate-day') && waited < const Duration(seconds: 2)) {
        await tester.pump(const Duration(milliseconds: 16));
        waited += const Duration(milliseconds: 16);
      }
      expect(shown('gallery-celebrate-day'), isTrue);
      expect(waited, greaterThan(const Duration(milliseconds: 150)), reason: 'after the ring has filled');
      expect(platform.count('HapticFeedbackType.mediumImpact'), 1);
      expect([shown('cleanup-day-done-streak'), shown('cleanup-day-done-hub')], [false, false]);

      await frames(tester, const Duration(milliseconds: 160));
      expect(shown('cleanup-day-done-streak'), isTrue);
      expect(shown('cleanup-day-done-hub'), isFalse, reason: 'the buttons come last');
      await frames(tester, const Duration(milliseconds: 200));
      expect(shown('cleanup-day-done-hub'), isTrue);
      expect(shown('cleanup-day-done-next'), isTrue);

      await settle(tester);
      expect(text(tester, 'cleanup-day-done-kept'), '4');
      expect(text(tester, 'cleanup-day-done-trashed'), '1');
      expect(text(tester, 'cleanup-day-done-streak'), '🔥 1-day streak');
      expect(platform.count('HapticFeedbackType.mediumImpact'), 1, reason: 'once');
    });

    testWidgets('a day finished again shows the end state and does not replay it', (tester) async {
      library.reviewed.add(815);
      await open(tester);
      await finishDay(tester);
      expect(shown('cleanup-day-done-hub'), isTrue);
      await frames(tester, const Duration(milliseconds: 900));
      expect(shown('gallery-celebrate-day'), isFalse);
      expect(platform.count('HapticFeedbackType.mediumImpact'), 0);
    });

    testWidgets('reduced motion: the end state at once, with the haptic only', (tester) async {
      await open(tester, reduceMotion: true);
      await finishDay(tester);
      expect(shown('cleanup-day-done-hub'), isTrue);
      expect(shown('cleanup-day-done-streak'), isTrue);
      expect(text(tester, 'cleanup-day-done-kept'), '4');
      await frames(tester, const Duration(milliseconds: 900));
      expect(shown('gallery-celebrate-day'), isFalse);
      expect(platform.count('HapticFeedbackType.mediumImpact'), 1);
    });
  });

  testWidgets('"Back to Cleanup" shows the day\'s cell turning green', (tester) async {
    await open(tester, fromOverview: true);
    await tapKey(tester, 'cleanup-session-done');
    await tapKey(tester, 'cleanup-finish-keep-rest');
    await tapKey(tester, 'cleanup-day-done-hub');

    expect(find.byKey(const Key('cleanup-today-card')), findsOneWidget);
    final cell = tester.widget<Container>(find.byKey(const Key('cleanup-teaser-day-815')));
    expect((cell.decoration! as BoxDecoration).color, const Color(0xFF2FBF71));
    expect(
      find.ancestor(of: find.byKey(const Key('cleanup-teaser-day-815')), matching: find.byType(GalleryPop)),
      findsOneWidget,
    );
  });

  group('trash confirmation', () {
    testWidgets('a photo in a shared space is confirmed; cancelling commits nothing and keeps the screen', (
      tester,
    ) async {
      library.inSpaces.add('p1');
      await open(tester);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-keep-rest');
      expect(
        find.text('1 photo is also in a shared space. Trashing removes it for space members too.'),
        findsOneWidget,
      );

      await tapKey(tester, 'cleanup-trash-confirm-cancel');
      expect(library.commits, isEmpty);
      expect(find.byKey(const Key('cleanup-finish')), findsOneWidget);
      expect(text(tester, 'cleanup-finish-trash'), '1');

      await tapKey(tester, 'cleanup-finish-keep-rest');
      await tapKey(tester, 'cleanup-trash-confirm-ok');
      expect(library.commits.single['trashIds'], ['p1']);
    });

    testWidgets('with the trash off, finishing asks to delete permanently', (tester) async {
      await open(tester, trashEnabled: false);
      await trash(tester);
      await tapKey(tester, 'cleanup-session-done');
      await tapKey(tester, 'cleanup-finish-keep-rest');
      expect(find.text('Permanently delete'), findsWidgets);
      await tapKey(tester, 'cleanup-trash-confirm-cancel');
      expect(library.commits, isEmpty);
    });
  });

  testWidgets('"Open in library" opens the viewer, and back returns to the same card', (tester) async {
    await open(tester);
    await keep(tester);
    await tapKey(tester, 'cleanup-deck-open');
    expect(openedInLibrary, ['p2']);
    expect(find.byKey(const Key('test-viewer')), findsOneWidget);

    await tester.pageBack();
    await settle(tester);
    expect(topCardId(tester), 'p2');
    expect(text(tester, 'cleanup-session-badge-count'), '1');
  });
}
