import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_sheet.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

Future<void> _pump(WidgetTester tester, {FilterSheetSnap? snap}) async {
  await tester.pumpConsumerWidget(
    const FilterSheet(),
    overrides: snap == null ? const [] : [photosFilterSheetProvider.overrideWith((ref) => snap)],
  );
  await tester.pumpAndSettle();
}

void main() {
  group('FilterSheet mount gate', () {
    testWidgets('hidden → empty (no DraggableScrollableSheet)', (tester) async {
      await _pump(tester); // defaults to hidden
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });

    testWidgets('peek → DraggableScrollableSheet mounted', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.peek);
      expect(find.byType(DraggableScrollableSheet), findsOneWidget);
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

    testWidgets('scrim tap at browse + non-empty filter → peek', (tester) async {
      await _pump(tester, snap: FilterSheetSnap.browse);
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheet)));
      container.read(photosFilterProvider.notifier).setText('paris');
      // Override can't be flipped, so reset override via a direct write.
      // Scope-override was only for initial state; at this point the notifier
      // is a real one. Move sheet back to browse explicitly.
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
      await tester.pumpAndSettle();

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.peek);
    });

    testWidgets('scrim tap at browse + empty filter → hidden', (tester) async {
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
  });
}
