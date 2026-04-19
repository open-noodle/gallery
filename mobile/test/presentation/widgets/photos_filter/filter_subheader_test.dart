import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

Widget _scroll(Widget sliver) => CustomScrollView(slivers: [sliver]);

void main() {
  group('PhotosFilterSubheader', () {
    testWidgets('renders nothing when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
    });

    testWidgets('renders clear-all + at least one chip when a filter is active', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('photos-filter-subheader')), findsOneWidget);
      expect(find.byKey(const Key('photos-filter-subheader-clear-all')), findsOneWidget);
      expect(find.byType(ActiveFilterChip), findsOneWidget);
    });

    testWidgets('tapping Clear all resets the filter', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).isEmpty, isFalse);

      await tester.tap(find.byKey(const Key('photos-filter-subheader-clear-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
      expect(find.byKey(const Key('photos-filter-subheader')), findsNothing);
    });

    testWidgets('clear-all label uses existing clear_all i18n key', (tester) async {
      await tester.pumpConsumerWidget(_scroll(const PhotosFilterSubheader()));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.text('clear_all'.tr()), findsOneWidget);
    });
  });
}
