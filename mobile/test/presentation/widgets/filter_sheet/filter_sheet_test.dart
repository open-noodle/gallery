import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
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

Future<void> _pump(WidgetTester tester, {FilterSheetVisibility? visibility}) async {
  await tester.pumpConsumerWidget(
    const FilterSheet(),
    overrides: [
      filterSectionPrefsProvider.overrideWithValue(_FakePrefs({})),
      filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({})),
      if (visibility != null) photosFilterSheetProvider.overrideWith((ref) => visibility),
    ],
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
