import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/browse_content.widget.dart';
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

Future<void> _pump(WidgetTester tester, {FilterSheetSnap? snap}) async {
  await tester.pumpConsumerWidget(
    const FilterSheet(),
    overrides: [
      filterSectionPrefsProvider.overrideWithValue(_FakePrefs({})),
      filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({})),
      if (snap != null) photosFilterSheetProvider.overrideWith((ref) => snap),
    ],
  );
  await tester.pumpAndSettle();
}

void main() {
  group('FilterSheet mount gate', () {
    testWidgets('hidden → empty (no DraggableScrollableSheet)', (tester) async {
      await _pump(tester); // defaults to hidden
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });

    testWidgets('browse → DraggableScrollableSheet mounted + scrim visible', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.browse);
      expect(find.byType(DraggableScrollableSheet), findsOneWidget);
      expect(find.byKey(const Key('filter-sheet-scrim')), findsOneWidget);
    });

    testWidgets('deep → DraggableScrollableSheet mounted + scrim visible', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.deep);
      expect(find.byType(DraggableScrollableSheet), findsOneWidget);
      expect(find.byKey(const Key('filter-sheet-scrim')), findsOneWidget);
    });

    testWidgets('scrim tap at browse → hidden', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.browse);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
      await tester.pumpAndSettle();

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.hidden);
    });

    testWidgets('scrim tap at deep → browse', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.deep);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      await tester.pumpAndSettle();

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    });

    testWidgets('deep → DeepContent mounted', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.deep);
      expect(find.byType(DeepContent), findsOneWidget);
    });
  });

  group('FilterSheet drag settling (#1002)', () {
    testWidgets('a drag that transiently dips through browse/dismiss extents does not '
        'change snap until the drag actually settles', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.deep);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));
      final sheetContext = tester.element(find.byType(DraggableScrollableSheet));

      // A single continuous "swipe down (half)" gesture: the live extent
      // sweeps down past the browse snap point and even dips below the
      // dismiss threshold, then springs back up to rest at deep — the
      // user's thumb never actually released down there.
      for (final extent in [0.90, 0.70, 0.55, 0.48, 0.60, 0.80, 0.94]) {
        DraggableScrollableNotification(
          extent: extent,
          minExtent: 0.3,
          maxExtent: 0.95,
          initialExtent: 0.95,
          context: sheetContext,
        ).dispatch(sheetContext);
        await tester.pump(const Duration(milliseconds: 16));
      }

      // Still mid-drag: nothing should have committed from the transient
      // pass-through extents yet.
      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(find.byType(DeepContent), findsOneWidget);

      // Let the debounce window elapse with no further motion, then let
      // any resulting animation/rebuild finish.
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      // Once the drag has settled, the snap reflects where it actually
      // came to rest (deep) — the sheet never bounced through hidden/browse.
      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(find.byType(DeepContent), findsOneWidget);
    });

    testWidgets('a drag that settles at the browse extent commits browse', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.deep);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));
      final sheetContext = tester.element(find.byType(DraggableScrollableSheet));

      for (final extent in [0.90, 0.75, 0.62]) {
        DraggableScrollableNotification(
          extent: extent,
          minExtent: 0.3,
          maxExtent: 0.95,
          initialExtent: 0.95,
          context: sheetContext,
        ).dispatch(sheetContext);
        await tester.pump(const Duration(milliseconds: 16));
      }

      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
      expect(find.byType(BrowseContent), findsOneWidget);
    });
  });
}
