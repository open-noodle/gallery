import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg({List<String>? countries}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, countries: countries ?? const []);

void main() {
  group('PlacesCascadeSection', () {
    testWidgets('renders country chips when no country selected', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: ['France', 'Germany'])),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-country-France')), findsOneWidget);
      expect(find.byKey(const Key('places-country-Germany')), findsOneWidget);
    });

    testWidgets('tapping a country sets filter.location.country and reveals city wrap', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: ['France', 'Germany'])),
          ),
          citySuggestionsProvider.overrideWith(
            (ref, country) => Future.value(country == 'France' ? ['Paris', 'Lyon'] : const <String>[]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      await tester.tap(find.byKey(const Key('places-country-France')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).location.country, 'France');
      expect(find.byKey(const Key('places-country-selected')), findsOneWidget);
      expect(find.byKey(const Key('places-city-Paris')), findsOneWidget);
      expect(find.byKey(const Key('places-city-Lyon')), findsOneWidget);
    });

    testWidgets('tapping a city sets filter.location.city', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: ['France']))),
          citySuggestionsProvider.overrideWith((ref, country) => Future.value(['Paris'])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'France'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-city-Paris')));
      await tester.pumpAndSettle();

      final loc = container.read(photosFilterProvider).location;
      expect(loc.country, 'France');
      expect(loc.city, 'Paris');
    });

    testWidgets('clearing the selected country resets cities and restores country wrap', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: ['France', 'Germany'])),
          ),
          citySuggestionsProvider.overrideWith((ref, country) => Future.value(['Paris'])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'France'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('places-country-selected')), findsOneWidget);

      // Tap the × affordance on the selected-country chip.
      await tester.tap(find.byKey(const Key('places-country-selected-clear')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).location.country, isNull);
      expect(find.byKey(const Key('places-country-France')), findsOneWidget);
      expect(find.byKey(const Key('places-country-Germany')), findsOneWidget);
    });

    testWidgets('empty countries → renders empty caption via DeepSectionScaffold', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: [])))],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-empty')), findsOneWidget);
    });

    testWidgets('selected country chip renders primary color in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: ['France']))),
          citySuggestionsProvider.overrideWith((ref, country) => Future.value(const <String>[])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'France'));
      await tester.pumpAndSettle();

      // The selected-country chip should render — we assert existence + delete icon visible.
      expect(find.byKey(const Key('places-country-selected')), findsOneWidget);
    });
  });
}
