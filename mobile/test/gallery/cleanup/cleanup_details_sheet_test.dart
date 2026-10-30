import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/utils/bytes_units.dart';

import 'cleanup_overview_harness.dart';
import 'cleanup_test_utils.dart';
import 'rewind_harness.dart';

// The details sheet (specs/2026-10-29-mobile-library-cleanup-design.md, "Details sheet" and Slice 4), in the real
// rewind of 15 August (p1, p2 from 2022; q1–q3 from 2020; p1 is 1.5 MB and in an album). Today is 15 August 2026.
//
// Opening
//   When ⓘ is tapped, the photo is tapped, or the info strip is dragged up   Then the sheet opens half way
//   When the sheet is dragged up                     Then it opens fully, and the photo's shrink follows the finger
//   When the sheet is dragged down                   Then it closes and nothing is marked
// Data
//   Given the server has not answered yet            Then the card's date, place and file show at once
//   When it answers                                  Then place, camera, exposure, people and albums fill in
//   Given both calls fail                            Then the card's data stays and no error shows
// Actions
//   When Keep / Favourite / Trash is chosen          Then the sheet closes, then the card is thrown with that mark
//   Given button mode, when the photo is tapped and Keep chosen   Then it is marked and the next photo shows
// Links
//   When "Open in library" is tapped, then back      Then the viewer opened, and the same card is on top
//   When "Show that day" is tapped, then back        Then that date's photos opened, and the same card is on top

void main() {
  setUpAll(initOverviewStore);

  late RewindLibrary library;

  setUp(() async {
    PaintingBinding.instance.imageCache.clear();
    library = RewindLibrary();
    library.assetInfo['p1'] = assetInfoJson(
      'p1',
      exif: {
        'city': 'Lisbon',
        'state': 'Lisboa',
        'country': 'Portugal',
        'make': 'Fujifilm',
        'model': 'X-T3',
        'lensModel': 'XF23mmF2 R WR',
        'fNumber': 2.8,
        'exposureTime': '1/250',
        'iso': 400,
        'focalLength': 23.0,
        'exifImageWidth': 6240,
        'exifImageHeight': 4160,
        'fileSizeInByte': 4200000,
      },
      people: ['Anna', '', 'Tomás'],
    );
    library.albumsOf['p1'] = [albumJson('al1', 'Summer'), albumJson('al2', 'Family')];
    await setPrefs();
  });

  Future<void> settle(WidgetTester tester) => settleCleanup(tester, requests: () => library.routes.length);

  Future<void> open(WidgetTester tester) async {
    listenToPlatform(tester);
    final container = rewindContainer(library: library, directory: tempDirectory());
    await pumpRewind(tester, container, requests: () => library.routes.length);
  }

  final top = find.byKey(const Key('cleanup-deck-top'));
  final sheet = find.byKey(const Key('cleanup-details-sheet'));
  final photo = find.byKey(const Key('cleanup-details-photo'));
  final handle = find.byKey(const Key('cleanup-details-handle'));

  double screenHeight(WidgetTester tester) => tester.view.physicalSize.height / tester.view.devicePixelRatio;
  double sheetShare(WidgetTester tester) => tester.getRect(sheet).height / screenHeight(tester);
  bool has(String row) => find.byKey(Key('cleanup-details-$row')).evaluate().isNotEmpty;

  String? badge(WidgetTester tester) {
    final finder = find.byKey(const Key('cleanup-session-badge-count'));
    return finder.evaluate().isEmpty ? null : tester.widget<Text>(finder).data;
  }

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

  group('opening', () {
    testWidgets('ⓘ, a tap on the photo and an upward drag on the info strip each open it half way', (tester) async {
      await open(tester);

      await tester.tap(find.byKey(const Key('cleanup-chip-details-p1')));
      await settle(tester);
      expect(sheet, findsOneWidget);
      expect(sheetShare(tester), closeTo(0.55, 0.02));
      await tester.tapAt(tester.getCenter(photo));
      await settle(tester);
      expect(sheet, findsNothing, reason: 'a tap on the photo above the sheet closes it');

      await tester.tap(top);
      await settle(tester);
      expect(sheetShare(tester), closeTo(0.55, 0.02));
      await tester.tapAt(tester.getCenter(photo));
      await settle(tester);

      await tester.drag(find.byKey(const Key('cleanup-card-info-p1')), const Offset(0, -80));
      await settle(tester);
      expect(sheetShare(tester), closeTo(0.55, 0.02));
      expect(badge(tester), isNull, reason: 'dragging the strip opens details, it does not favourite');
      expect(topCardId(tester), 'p1');
    });

    testWidgets('dragging up opens it fully, the photo shrinking with the finger; dragging down closes it', (
      tester,
    ) async {
      await open(tester);
      await tester.tap(find.byKey(const Key('cleanup-chip-details-p1')));
      await settle(tester);
      final photoBefore = tester.getRect(photo).height;
      final sheetBefore = tester.getRect(sheet).height;

      final gesture = await tester.startGesture(tester.getCenter(handle));
      for (var i = 0; i < 6; i++) {
        await gesture.moveBy(const Offset(0, -10));
        await tester.pump();
      }
      final moved = tester.getRect(sheet).height - sheetBefore;
      expect(moved, greaterThan(40), reason: 'the sheet follows the drag');
      expect(photoBefore - tester.getRect(photo).height, closeTo(moved, 1), reason: 'the photo shrinks as much');

      await gesture.moveBy(const Offset(0, -300));
      await tester.pump();
      await gesture.up();
      await settle(tester);
      expect(sheetShare(tester), closeTo(0.92, 0.02));
      expect(has('file'), isTrue);

      await tester.drag(handle, const Offset(0, 900));
      await settle(tester);
      expect(sheet, findsNothing);
      expect(topCardId(tester), 'p1');
      expect(badge(tester), isNull);
    });
  });

  group('data', () {
    testWidgets('the card\'s data shows at once, then the server\'s fills in', (tester) async {
      await open(tester);
      library.detailsHold = Completer<void>();
      await tester.tap(find.byKey(const Key('cleanup-chip-details-p1')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(textOf(tester, 'cleanup-details-date'), 'Monday, August 15, 2022 09:00');
      expect(textOf(tester, 'cleanup-details-subtitle'), '4 years ago · Photo 1 of 5');
      expect(textOf(tester, 'cleanup-details-place-title'), 'Lisbon');
      expect(textOf(tester, 'cleanup-details-file-title'), 'p1.jpg');
      expect(textOf(tester, 'cleanup-details-file-detail'), '100 × 100 · ${formatBytes(1500000)}');
      expect(has('camera'), isFalse);
      expect(has('people'), isFalse);
      expect(has('albums'), isFalse);

      library.detailsHold!.complete();
      await settle(tester);
      expect(library.routes, containsAll(['GET /assets/p1', 'GET /albums']));
      expect(textOf(tester, 'cleanup-details-place-title'), 'Lisbon, Lisboa, Portugal');
      expect(textOf(tester, 'cleanup-details-people-title'), 'Anna, Tomás', reason: 'named people only');
      expect(textOf(tester, 'cleanup-details-albums-title'), 'Summer · Family');

      // Fully open: the camera and the file.
      await tester.fling(handle, const Offset(0, -400), 1500);
      await settle(tester);
      expect(textOf(tester, 'cleanup-details-camera-title'), 'Fujifilm X-T3 · XF23mmF2 R WR');
      expect(textOf(tester, 'cleanup-details-camera-detail'), 'ƒ/2.8 · 1/250 s · ISO 400 · 23 mm');
      expect(textOf(tester, 'cleanup-details-file-title'), 'IMG_p1.JPG');
      expect(textOf(tester, 'cleanup-details-file-detail'), '6240 × 4160 · 26 MP · ${formatBytes(4200000)}');
    });

    testWidgets('when both calls fail the card\'s data stays and no error shows', (tester) async {
      library.detailsFail = true;
      await open(tester);
      await tester.tap(find.byKey(const Key('cleanup-chip-details-p1')));
      await settle(tester);

      expect(library.routes, containsAll(['GET /assets/p1', 'GET /albums']));
      expect(textOf(tester, 'cleanup-details-date'), 'Monday, August 15, 2022 09:00');
      expect(textOf(tester, 'cleanup-details-place-title'), 'Lisbon');
      expect(textOf(tester, 'cleanup-details-file-title'), 'p1.jpg');
      expect(has('camera'), isFalse);
      expect(has('people'), isFalse);
      expect(has('albums'), isFalse);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.textContaining('boom'), findsNothing);
    });
  });

  group('actions', () {
    testWidgets('Keep, Favourite and Trash close the sheet, then throw the card with that mark', (tester) async {
      await open(tester);

      await tester.tap(find.byKey(const Key('cleanup-chip-details-p1')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-details-trash')));
      await tester.pump();
      expect(find.byKey(const Key('cleanup-flight-p1')), findsNothing, reason: 'the sheet goes first');
      var thrown = false;
      for (var i = 0; i < 30 && !thrown; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        thrown = find.byKey(const Key('cleanup-flight-p1')).evaluate().isNotEmpty;
        if (thrown) {
          expect(sheet, findsNothing, reason: 'thrown once the sheet has gone');
        }
      }
      expect(thrown, isTrue, reason: 'the card is thrown as the Trash button throws it');
      await settle(tester);
      expect(topCardId(tester), 'p2');
      expect(await counts(tester), ['0', '0', '1']);

      await tester.tap(top);
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-details-favorite')));
      await settle(tester);
      expect(topCardId(tester), 'q1');
      expect(await counts(tester), ['0', '1', '1']);

      await tester.tap(top);
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-details-keep')));
      await settle(tester);
      expect(topCardId(tester), 'q2');
      expect(badge(tester), '3');
      expect(await counts(tester), ['1', '1', '1']);
      expect(library.commits, isEmpty, reason: 'still nothing sent until Done → apply');
    });

    testWidgets('in button mode a tap on the photo opens it, and Keep marks the photo and shows the next', (
      tester,
    ) async {
      await setPrefs(mode: LibraryCleanupDeckMode.button);
      await open(tester);

      await tester.tap(find.byKey(const Key('cleanup-page-p1')));
      await settle(tester);
      expect(sheet, findsOneWidget);
      await tester.tap(find.byKey(const Key('cleanup-details-keep')));
      await settle(tester);

      expect(sheet, findsNothing);
      expect(badge(tester), '1');
      expect(tester.getRect(find.byKey(const Key('cleanup-page-p2'))).left.abs(), lessThan(1));
    });
  });

  group('links', () {
    testWidgets('"Open in library" and "Show that day" navigate, and back returns to the same card', (tester) async {
      await open(tester);
      await tester.fling(top, const Offset(160, 0), 1500);
      await settle(tester);
      expect(topCardId(tester), 'p2');

      await tester.tap(top);
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-details-open')));
      await settle(tester);
      expect(find.byKey(const Key('test-viewer')), findsOneWidget);
      expect(openedInLibrary, ['p2']);
      await tester.pageBack();
      await settle(tester);
      expect(sheet, findsNothing);
      expect(topCardId(tester), 'p2');
      expect(badge(tester), '1');

      await tester.tap(top);
      await settle(tester);
      await tester.tap(find.byKey(const Key('cleanup-details-show-day')));
      await settle(tester);
      expect(find.byKey(const Key('test-day')), findsOneWidget);
      expect([for (final day in shownDays) (day.year, day.month, day.day)], [(2022, 8, 15)]);
      await tester.pageBack();
      await settle(tester);
      expect(topCardId(tester), 'p2');
      expect(badge(tester), '1');
      expect(library.commits, isEmpty);
    });
  });
}
