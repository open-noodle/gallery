import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The deck (specs/2026-10-29-mobile-library-cleanup-design.md, "The deck" and Slice 3), in the real rewind of
// 15 August (p1, p2 from 2022; q1–q3 from 2020). Gestures go through tester.fling / tester.drag and a TestGesture, and
// the tests look at what the user sees: which photo is on top, the Done badge, the finish screen's counts.
//
// Swipe mode
//   When the top card is flung right / left / up   Then it is kept / trashed / favourited and the next is on top
//   When a short drag is released                  Then it springs back and nothing is marked
//   When the card is dragged down                  Then nothing happens
//   When a drag passes the threshold               Then the stamp shows, and one haptic fires per crossing
//   When a button is pressed                       Then the card flies off as the swipe would, with the same mark
//   When Undo is pressed                           Then the last card flies back from where it left, unmarked
//   Given a video                                  When ▶ is tapped   Then it plays on the card, which still swipes
//   Then the next three previews are requested before they are on top
//   Given a preview not decoded yet                Then its card shows the placeholder, and the preview once decoded
//   Given reduced motion                           Then a decided card fades where it was, without a throw
// Button mode
//   When the photo is swiped sideways              Then the next photo shows and nothing is marked
//   When a bar button is pressed                   Then the photo is marked and the next undecided one shows
//   When the mode is chosen in the menu            Then it is remembered for the next session

void main() {
  setUpAll(initOverviewStore);

  late RewindLibrary library;
  late RewindPlatform platform;

  setUp(() async {
    // A preview cached by an earlier test would not be asked for again.
    PaintingBinding.instance.imageCache
      ..clear()
      ..clearLiveImages();
    library = RewindLibrary();
    await setPrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<void> open(WidgetTester tester, {bool reduceMotion = false, List<Override> overrides = const []}) async {
    platform = listenToPlatform(tester);
    final container = rewindContainer(library: library, directory: tempDirectory(), overrides: overrides);
    await pumpRewind(tester, container, reduceMotion: reduceMotion, requests: () => library.routes.length);
  }

  final top = find.byKey(const Key('cleanup-deck-top'));

  String? badge(WidgetTester tester) {
    final finder = find.byKey(const Key('cleanup-session-badge-count'));
    return finder.evaluate().isEmpty ? null : tester.widget<Text>(finder).data;
  }

  /// The finish screen's kept, favourites and trash counts, then back to the deck.
  Future<List<String>> counts(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('cleanup-session-done')));
    await settle(tester);
    final result = [
      for (final key in ['kept', 'favorites', 'trash'])
        tester.widget<Text>(find.byKey(Key('cleanup-finish-$key'))).data!,
    ];
    await tester.tap(find.byKey(const Key('cleanup-finish-keep-going')));
    await settle(tester);
    return result;
  }

  group('swipe mode', () {
    testWidgets('fling right keeps, left trashes, up favourites, and the next card comes on top', (tester) async {
      await open(tester);
      expect(topCardId(tester), 'p1');

      await tester.fling(top, const Offset(160, 0), 1500);
      await settle(tester);
      expect(topCardId(tester), 'p2');
      expect(badge(tester), '1');
      expect(await counts(tester), ['1', '0', '0'], reason: 'right keeps');

      await tester.fling(top, const Offset(-160, 0), 1500);
      await settle(tester);
      expect(topCardId(tester), 'q1');
      expect(await counts(tester), ['1', '0', '1'], reason: 'left trashes');

      await tester.fling(top, const Offset(0, -160), 1500);
      await settle(tester);
      expect(topCardId(tester), 'q2');
      expect(badge(tester), '3');
      expect(await counts(tester), ['1', '1', '1'], reason: 'up favourites');

      // A short, fast flick decides by its velocity alone.
      await tester.fling(top, const Offset(-60, 0), 2500);
      await settle(tester);
      expect(topCardId(tester), 'q3');
      expect(await counts(tester), ['1', '1', '2']);
      expect(library.commits, isEmpty, reason: 'nothing is sent until Done → apply');
    });

    testWidgets('a short drag springs back with no effect, and a drag down does nothing', (tester) async {
      await open(tester);
      final home = tester.getRect(top);

      await tester.drag(top, const Offset(40, 0));
      await settle(tester);
      expect(topCardId(tester), 'p1');
      expect(badge(tester), isNull);
      expect((tester.getCenter(find.byKey(const Key('cleanup-card-p1'))) - home.center).distance, lessThan(0.5));

      await tester.drag(top, const Offset(0, 320));
      await settle(tester);
      expect(topCardId(tester), 'p1');
      expect(badge(tester), isNull);
      expect((tester.getCenter(find.byKey(const Key('cleanup-card-p1'))) - home.center).distance, lessThan(0.5));
    });

    testWidgets('the stamp shows past the threshold, and one haptic fires per crossing', (tester) async {
      await open(tester);
      final start = tester.getCenter(top);
      final gesture = await tester.startGesture(start);
      Future<void> moveTo(double dx) async {
        await gesture.moveTo(start + Offset(dx, 0));
        await tester.pump();
      }

      double keepStamp() {
        final stamp = find.byKey(const Key('cleanup-stamp-keep'));
        if (stamp.evaluate().isEmpty) {
          return 0;
        }
        return tester.widget<Opacity>(find.ancestor(of: stamp, matching: find.byType(Opacity)).first).opacity;
      }

      await moveTo(10);
      expect(keepStamp(), 0);
      expect(platform.count('HapticFeedbackType.selectionClick'), 0);

      await moveTo(130);
      expect(keepStamp(), 1, reason: 'past the threshold the stamp is fully in');
      expect(platform.count('HapticFeedbackType.selectionClick'), 1);
      await moveTo(200);
      expect(platform.count('HapticFeedbackType.selectionClick'), 1, reason: 'still past it: no second tick');

      await moveTo(40);
      await moveTo(140);
      expect(platform.count('HapticFeedbackType.selectionClick'), 2, reason: 'a second crossing ticks again');

      await gesture.up();
      await settle(tester);
      expect(topCardId(tester), 'p2', reason: 'released past the threshold: kept');
    });

    testWidgets('the buttons give the swipes\' marks, and Undo brings back the last card from where it left', (
      tester,
    ) async {
      await open(tester);

      await tester.tap(find.byKey(const Key('cleanup-deck-keep')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      // The card flies off to the right, exactly as a swipe right would.
      expect(tester.getCenter(find.byKey(const Key('cleanup-flight-p1'))).dx, greaterThan(tester.getCenter(top).dx));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-flight-p1')), findsNothing);

      await tester.tap(find.byKey(const Key('cleanup-deck-favorite')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-deck-trash')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      expect(tester.getCenter(find.byKey(const Key('cleanup-flight-q1'))).dx, lessThan(tester.getCenter(top).dx));
      await settle(tester);
      expect(topCardId(tester), 'q2');
      expect(await counts(tester), ['1', '1', '1']);

      // Undo: q1 comes back on top, flying in from the left where it went.
      final center = tester.getCenter(top).dx;
      await tester.tap(find.byKey(const Key('cleanup-deck-undo')));
      await tester.pump();
      expect(topCardId(tester), 'q1');
      await tester.pump(const Duration(milliseconds: 16));
      expect(tester.getCenter(find.byKey(const Key('cleanup-card-q1'))).dx, lessThan(center - 100));
      await settle(tester);
      expect((tester.getCenter(find.byKey(const Key('cleanup-card-q1'))).dx - center).abs(), lessThan(1));
      expect(badge(tester), '2');
      expect(await counts(tester), ['1', '1', '0']);
    });

    testWidgets('a video plays on its card when ▶ is tapped, and the card still swipes', (tester) async {
      library.days[815]![2022]!.first
        ..['type'] = 'VIDEO'
        ..['duration'] = 75.0;
      await open(tester);
      expect(find.text('1:15'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cleanup-card-play-p1')));
      await tester.pump();
      expect(find.byKey(const Key('test-video-p1')), findsOneWidget);

      await tester.fling(top, const Offset(160, 0), 1500);
      await settle(tester);
      expect(topCardId(tester), 'p2');
    });

    testWidgets('the next three previews are requested before they are on top', (tester) async {
      await open(tester);
      expect(topCardId(tester), 'p1');
      expect(
        [
          for (final id in ['p2', 'q1', 'q2', 'q3']) platform.requested(id),
        ],
        [true, true, true, false],
      );

      await tester.fling(top, const Offset(160, 0), 1500);
      await settle(tester);
      expect(platform.requested('q3'), isTrue);
    });

    testWidgets('a card shows its preview only once it has decoded; until then its placeholder', (tester) async {
      // Decodes held until the test lets them finish, by asset id.
      final decodes = <String, Completer<void>>{};
      await open(
        tester,
        overrides: [
          libraryCleanupPrecacheProvider.overrideWithValue((image, context) {
            final url = image is RemoteImageProvider ? image.url : '';
            final id = RegExp(r'/assets/([^/]+)/thumbnail').firstMatch(url)?.group(1);
            return id == null ? Future.value() : (decodes[id] ??= Completer<void>()).future;
          }),
        ],
      );
      bool preview(String id) => find.byKey(Key('cleanup-card-preview-$id')).evaluate().isNotEmpty;
      bool placeholder(String id) => find.byKey(Key('cleanup-card-placeholder-$id')).evaluate().isNotEmpty;

      expect(decodes.keys, ['p1', 'p2', 'q1', 'q2'], reason: 'the top card and the next three');
      expect([placeholder('p1'), placeholder('p2')], [true, true]);
      expect([preview('p1'), preview('p2')], [false, false]);

      decodes['p2']!.complete();
      await tester.pump();
      await tester.pump();
      expect(preview('p2'), isTrue, reason: 'the card behind shows its preview once decoded');
      expect(placeholder('p1'), isTrue, reason: 'the top card still waits for its own');

      // Thrown before q1 decoded: the next card comes up on its placeholder, never blank, and the throw did not wait.
      await tester.fling(top, const Offset(160, 0), 1500);
      await settle(tester);
      expect(topCardId(tester), 'p2');
      expect(preview('p2'), isTrue);
      expect(placeholder('q1'), isTrue);
      expect(decodes.keys, contains('q3'), reason: 'the next preview is asked for as the deck moves on');
      decodes['q1']!.complete();
      await tester.pump();
      await tester.pump();
      expect(preview('q1'), isTrue);
    });

    testWidgets('reduced motion: a decided card fades where it was, with no throw', (tester) async {
      await open(tester, reduceMotion: true);
      final home = tester.getCenter(top);

      await tester.tap(find.byKey(const Key('cleanup-deck-trash')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      final flight = find.byKey(const Key('cleanup-flight-p1'));
      expect(tester.getCenter(flight), home, reason: 'no throw');
      final opacity = tester.widget<Opacity>(find.ancestor(of: flight, matching: find.byType(Opacity)).first).opacity;
      expect(opacity, lessThan(1));
      await settle(tester);
      expect(flight, findsNothing);
      expect(topCardId(tester), 'p2');
    });
  });

  group('button mode', () {
    final pages = find.byKey(const Key('cleanup-deck-pages'));

    bool showing(WidgetTester tester, String id) {
      final page = find.byKey(Key('cleanup-page-$id'));
      if (page.evaluate().isEmpty) {
        return false;
      }
      final rect = tester.getRect(page);
      return rect.left.abs() < 1;
    }

    testWidgets('sideways swipes move between photos without marking; the bar marks and moves on', (tester) async {
      await setPrefs(mode: LibraryCleanupDeckMode.button);
      await open(tester);
      expect(find.byKey(const Key('cleanup-button-bar')), findsOneWidget);
      expect(showing(tester, 'p1'), isTrue);

      await tester.fling(pages, const Offset(-300, 0), 1200);
      await settle(tester);
      expect(showing(tester, 'p2'), isTrue);
      expect(badge(tester), isNull, reason: 'moving is not marking');

      await tester.tap(find.byKey(const Key('cleanup-bar-trash')));
      await settle(tester);
      expect(showing(tester, 'q1'), isTrue);
      expect(badge(tester), '1');

      // Back to p1, still undecided: Keep marks it and moves to the next undecided photo, q1.
      await tester.fling(pages, const Offset(300, 0), 1200);
      await settle(tester);
      await tester.fling(pages, const Offset(300, 0), 1200);
      await settle(tester);
      expect(showing(tester, 'p1'), isTrue);
      await tester.tap(find.byKey(const Key('cleanup-bar-keep')));
      await settle(tester);
      expect(showing(tester, 'q1'), isTrue);
      expect(await counts(tester), ['1', '0', '1']);

      // Undo shows the photo it took the mark from.
      await tester.tap(find.byKey(const Key('cleanup-bar-undo')));
      await settle(tester);
      expect(showing(tester, 'p1'), isTrue);
      expect(badge(tester), '1');
    });

    testWidgets('the mode chosen in the menu is remembered', (tester) async {
      await open(tester);
      await tester.tap(find.byKey(const Key('cleanup-session-menu')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-menu-mode-button')));
      await settle(tester);
      expect(find.byKey(const Key('cleanup-button-bar')), findsOneWidget);
      expect(
        LibraryCleanupPrefs.fromJsonString(Store.tryGet(StoreKey.libraryCleanupPrefs)).deckMode,
        LibraryCleanupDeckMode.button,
      );
    });
  });

  testWidgets('without the haptic setting, a crossing is silent', (tester) async {
    await Store.put(StoreKey.enableHapticFeedback, false);
    addTearDown(() => Store.put(StoreKey.enableHapticFeedback, true));
    await open(tester);
    await tester.drag(top, const Offset(200, 0));
    await settle(tester);
    expect(topCardId(tester), 'p2');
    expect(platform.haptics, isEmpty);
  });
}
