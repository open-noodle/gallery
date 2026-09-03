import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

import '../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async => stored = ids;
}

Future<void> _pump(WidgetTester tester, {FilterSheetVisibility? visibility, bool accessibleNavigation = false}) async {
  await tester.pumpConsumerWidget(
    Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(accessibleNavigation: accessibleNavigation),
        child: const FilterSheet(),
      ),
    ),
    overrides: [
      filterSectionPrefsProvider.overrideWithValue(_FakePrefs({})),
      filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({})),
      if (visibility != null) photosFilterSheetProvider.overrideWith((ref) => visibility),
    ],
  );
  await tester.pumpAndSettle();
}

ProviderContainer _container(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));

/// Where the sheet's top edge currently sits, in logical pixels from the top of
/// the test surface. At the full extent this is `height * (1 - 0.95)`.
double _sheetTop(WidgetTester tester) => tester.getTopLeft(find.byType(DeepContent)).dy;

/// Screen-reader announcements the widget pushed onto the accessibility channel.
List<String> _captureAnnouncements(WidgetTester tester) {
  final announced = <String>[];
  final messenger = tester.binding.defaultBinaryMessenger;
  messenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, (message) async {
    final envelope = message! as Map<Object?, Object?>;
    if (envelope['type'] == 'announce') {
      announced.add((envelope['data']! as Map<Object?, Object?>)['message']! as String);
    }
    return null;
  });
  addTearDown(() => messenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, null));
  return announced;
}

/// Delivers the platform's "user pressed system back" message.
Future<void> _systemBack(WidgetTester tester) async {
  await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
    'flutter/navigation',
    const JSONMethodCodec().encodeMethodCall(const MethodCall('popRoute')),
    (_) {},
  );
  await tester.pumpAndSettle();
}

/// Replays a run of live drag extents as the `DraggableScrollableSheet` would,
/// one per frame, without letting the settle debounce elapse in between.
Future<void> _dragThrough(WidgetTester tester, List<double> extents) async {
  final sheetContext = tester.element(find.byType(DraggableScrollableSheet));
  for (final extent in extents) {
    DraggableScrollableNotification(
      extent: extent,
      minExtent: 0.3,
      maxExtent: 0.95,
      initialExtent: 0.95,
      context: sheetContext,
    ).dispatch(sheetContext);
    await tester.pump(const Duration(milliseconds: 16));
  }
}

void main() {
  group('FilterSheet mount gate', () {
    testWidgets('hidden → empty (no DraggableScrollableSheet)', (tester) async {
      await _pump(tester); // defaults to hidden
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });

    testWidgets('visible → DraggableScrollableSheet mounted + scrim + DeepContent', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      expect(find.byType(DraggableScrollableSheet), findsOneWidget);
      expect(find.byKey(const Key('filter-sheet-scrim')), findsOneWidget);
      expect(find.byType(DeepContent), findsOneWidget);
    });

    testWidgets('scrim tap → hidden in one tap', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
    });
  });

  group('FilterSheet has a single resting extent', () {
    testWidgets('full height is the only snap size, so a drag can never rest half-way', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final sheet = tester.widget<DraggableScrollableSheet>(find.byType(DraggableScrollableSheet));

      expect(sheet.snapSizes, [sheet.maxChildSize], reason: 'the removed half-height browse snap must not come back');
      expect(sheet.initialChildSize, sheet.maxChildSize);
      expect(sheet.snap, isTrue);
    });

    testWidgets('a drag that settles above the dismiss threshold stays open on DeepContent', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));

      // The extent the old browse snap used to sit at. Settling there must now
      // leave the sheet open — the sheet springs back to full rather than
      // resting half-way, and no intermediate state exists to commit.
      await _dragThrough(tester, [0.90, 0.75, 0.62]);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.visible);
      expect(find.byType(DeepContent), findsOneWidget);
    });

    testWidgets('a drag that settles below the dismiss threshold closes the sheet', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));

      await _dragThrough(tester, [0.90, 0.70, 0.48]);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });
  });

  // The group above asserts the sheet's *configuration* and drives the settle
  // logic with synthetic notifications. These drive real pointers through the
  // real DraggableScrollableSheet physics, which is the only way to catch a
  // half-height resting place actually coming back.
  group('FilterSheet real drag gestures', () {
    testWidgets('a partial drag down returns the sheet to full height', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = _container(tester);
      final fullTop = _sheetTop(tester);
      final height = tester.getSize(find.byType(FilterSheet)).height;
      expect(fullTop, closeTo(height * (1 - 0.95), 0.5), reason: 'precondition: sheet starts at the full extent');

      // Far enough to have landed on the old 0.62 browse snap, not far enough
      // to dismiss.
      await tester.drag(find.byType(DeepContent), Offset(0, height * 0.25));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 200));

      expect(_sheetTop(tester), closeTo(fullTop, 0.5), reason: 'must spring back to full, not rest half-way');
      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.visible);
    });

    testWidgets('holding a drag below the dismiss threshold closes the sheet', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = _container(tester);
      final height = tester.getSize(find.byType(FilterSheet)).height;

      final gesture = await tester.startGesture(tester.getCenter(find.byKey(const Key('deep-header'))));
      for (var i = 0; i < 3; i++) {
        await gesture.moveBy(Offset(0, height * 0.2));
        await tester.pump(const Duration(milliseconds: 16));
      }
      // Thumb comes to rest below the threshold: the settle debounce elapses
      // with no further motion, so the dismiss commits.
      await tester.pump(const Duration(milliseconds: 200));

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
      await gesture.up();
      await tester.pumpAndSettle();
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });
  });

  group('FilterSheet close affordances', () {
    testWidgets('system back closes the sheet', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = _container(tester);

      await _systemBack(tester);

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });

    testWidgets('a settle left in flight by the drag does not close a sheet reopened since', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = _container(tester);

      // Drag heading for a dismiss, but something else (Done / ✕ / back / a
      // second finger) closes the sheet before the debounce elapses.
      await _dragThrough(tester, [0.80, 0.45]);
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden;

      // Zero-duration pumps: the close and the reopen both have to land inside
      // the debounce window, and `pumpAndSettle` would advance past it.
      await tester.pump();
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.visible;
      await tester.pump();

      // Now let the window elapse. A settle that survived the close fires here.
      await tester.pump(const Duration(milliseconds: 300));

      expect(
        container.read(photosFilterSheetProvider),
        FilterSheetVisibility.visible,
        reason: 'the stale settle belonged to a sheet that is already gone',
      );
      expect(find.byType(DeepContent), findsOneWidget);
    });
  });

  group('FilterSheet accessibility', () {
    testWidgets('announces when the panel opens under a screen reader', (tester) async {
      await _pump(tester, accessibleNavigation: true);
      final announced = _captureAnnouncements(tester);
      final container = _container(tester);

      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.visible;
      await tester.pumpAndSettle();

      expect(announced, ['filter panel opened']);
    });

    testWidgets('stays quiet when the panel closes', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible, accessibleNavigation: true);
      final announced = _captureAnnouncements(tester);
      final container = _container(tester);

      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.hidden;
      await tester.pumpAndSettle();

      expect(announced, isEmpty);
    });

    testWidgets('stays quiet with no screen reader running', (tester) async {
      await _pump(tester);
      final announced = _captureAnnouncements(tester);
      final container = _container(tester);

      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.visible;
      await tester.pumpAndSettle();

      expect(announced, isEmpty);
    });
  });

  group('FilterSheet drag settling (#1002)', () {
    testWidgets('a drag that transiently dips below the dismiss threshold does not '
        'close the sheet until the drag actually settles', (tester) async {
      await _pump(tester, visibility: FilterSheetVisibility.visible);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));

      // A single continuous "swipe down (half)" gesture: the live extent sweeps
      // down past the dismiss threshold, then springs back up to rest at full —
      // the user's thumb never actually released down there.
      await _dragThrough(tester, [0.90, 0.70, 0.55, 0.48, 0.60, 0.80, 0.94]);

      // Still mid-drag: nothing should have committed from the transient
      // pass-through extents yet.
      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.visible);
      expect(find.byType(DeepContent), findsOneWidget);

      // Let the debounce window elapse with no further motion, then let any
      // resulting animation/rebuild finish.
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      // Once the drag has settled, the sheet reflects where it actually came to
      // rest (open) — it never bounced through hidden.
      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.visible);
      expect(find.byType(DeepContent), findsOneWidget);
    });
  });
}
