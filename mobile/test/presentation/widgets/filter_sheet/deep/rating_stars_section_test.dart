import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('RatingStarsSection', () {
    testWidgets('5 stars rendered regardless of suggestions', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: RatingStarsSection()));
      await tester.pumpAndSettle();

      for (var i = 1; i <= 5; i++) {
        expect(find.byKey(Key('rating-star-$i')), findsOneWidget);
      }
    });

    testWidgets('tap star 4 → setRating(4)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: RatingStarsSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(RatingStarsSection)));

      await tester.tap(find.byKey(const Key('rating-star-4')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).rating.rating, 4);
    });

    testWidgets('tap star 4 twice clears the rating', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: RatingStarsSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(RatingStarsSection)));

      await tester.tap(find.byKey(const Key('rating-star-4')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('rating-star-4')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).rating.rating, isNull);
    });

    testWidgets('filled icon on stars ≤ current rating', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: RatingStarsSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(RatingStarsSection)));
      container.read(photosFilterProvider.notifier).setRating(3);
      await tester.pumpAndSettle();

      final filled = tester.widgetList<Icon>(
        find.descendant(of: find.byType(RatingStarsSection), matching: find.byIcon(Icons.star_rounded)),
      );
      final outline = tester.widgetList<Icon>(
        find.descendant(of: find.byType(RatingStarsSection), matching: find.byIcon(Icons.star_outline_rounded)),
      );
      expect(filled, hasLength(3));
      expect(outline, hasLength(2));
    });

    testWidgets('dark theme renders 5 stars', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: RatingStarsSection()));
      await tester.pumpAndSettle();
      for (var i = 1; i <= 5; i++) {
        expect(find.byKey(Key('rating-star-$i')), findsOneWidget);
      }
    });

    testWidgets('each star meets 44pt tap target (a11y)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: RatingStarsSection()));
      await tester.pumpAndSettle();
      for (var i = 1; i <= 5; i++) {
        expectTapTargetMin(tester, find.byKey(Key('rating-star-$i')), min: 44);
      }
    });
  });
}
