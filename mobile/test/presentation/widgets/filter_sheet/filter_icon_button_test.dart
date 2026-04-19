import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_icon_button.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

const _alice = PersonDto(id: 'a', name: 'Alice', isHidden: false, thumbnailPath: '');

void main() {
  group('FilterIconButton', () {
    testWidgets('empty filter → no active dot', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('filter-active-dot')), findsNothing);
    });

    testWidgets('non-empty filter (person) → renders active dot', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterIconButton)));
      container.read(photosFilterProvider.notifier).togglePerson(_alice);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('filter-active-dot')), findsOneWidget);
    });

    testWidgets('non-empty filter (text) → renders active dot', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterIconButton)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('filter-active-dot')), findsOneWidget);
    });

    testWidgets('non-empty filter (rating) → renders active dot', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterIconButton)));
      container.read(photosFilterProvider.notifier).setRating(4);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('filter-active-dot')), findsOneWidget);
    });

    testWidgets('tap from hidden → sheet becomes browse', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterIconButton)));
      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.hidden);

      await tester.tap(find.byType(IconButton));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    });

    testWidgets('tap from deep → browse (§7 edge)', (tester) async {
      await tester.pumpConsumerWidget(const FilterIconButton());
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(FilterIconButton)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      await tester.pumpAndSettle();

      await tester.tap(find.byType(IconButton));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    });
  });
}
