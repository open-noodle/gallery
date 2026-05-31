import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/sort_icon_button.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('SortIconButton', () {
    testWidgets('hidden while the filter is empty (sort is meaningless on the plain timeline)', (tester) async {
      await tester.pumpConsumerWidget(const SortIconButton());
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photos-filter-sort-button')), findsNothing);
    });

    testWidgets('appears once a search/filter is active', (tester) async {
      await tester.pumpConsumerWidget(const SortIconButton());
      final c = ProviderScope.containerOf(tester.element(find.byType(SortIconButton)));
      c.read(photosFilterProvider.notifier).setText('beach');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photos-filter-sort-button')), findsOneWidget);
    });

    testWidgets('tap opens the sort sheet; semantic search offers relevance; picking a value updates the filter', (
      tester,
    ) async {
      await tester.pumpConsumerWidget(const SortIconButton());
      final c = ProviderScope.containerOf(tester.element(find.byType(SortIconButton)));
      c.read(photosFilterProvider.notifier).setText('beach');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('photos-filter-sort-button')));
      await tester.pumpAndSettle();

      expect(find.text('search_sort_title'.tr()), findsOneWidget);
      // 'beach' is a semantic (context) search → relevance is on offer.
      expect(find.byKey(Key('sort-option-${SearchSortOrder.relevance.name}')), findsOneWidget);

      await tester.tap(find.byKey(Key('sort-option-${SearchSortOrder.oldest.name}')));
      await tester.pumpAndSettle();
      expect(c.read(photosFilterProvider).sort, SearchSortOrder.oldest);
    });

    testWidgets('non-semantic filter hides relevance, keeps newest/oldest', (tester) async {
      await tester.pumpConsumerWidget(const SortIconButton());
      final c = ProviderScope.containerOf(tester.element(find.byType(SortIconButton)));
      // A rating-only filter has no context → not a semantic search.
      c.read(photosFilterProvider.notifier).setRating(4);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('photos-filter-sort-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(Key('sort-option-${SearchSortOrder.relevance.name}')), findsNothing);
      expect(find.byKey(Key('sort-option-${SearchSortOrder.newest.name}')), findsOneWidget);
      expect(find.byKey(Key('sort-option-${SearchSortOrder.oldest.name}')), findsOneWidget);
    });
  });
}
