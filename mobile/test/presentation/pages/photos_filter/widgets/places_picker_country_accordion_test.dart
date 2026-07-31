import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/places_picker_country_accordion.widget.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/places_picker.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg(List<String> countries) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, countries: countries);

List<Override> _overrideCountries(List<String> countries) => [
  photosFilterSuggestionsProvider.overrideWith((ref, filter) async => _sugg(countries)),
];

Widget _harness({required String? expandedCountry, required ValueChanged<String?> onExpand}) {
  return PlacesPickerCountryAccordion(expandedCountry: expandedCountry, onExpandCountry: onExpand);
}

void main() {
  group('PlacesPickerCountryAccordion', () {
    testWidgets('renders country rows from placesPickerCountriesProvider', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: null, onExpand: (_) {})),
        overrides: _overrideCountries(['France', 'Spain']),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-picker-country-France')), findsOneWidget);
      expect(find.byKey(const Key('places-picker-country-Spain')), findsOneWidget);
    });

    testWidgets('empty countries -> hidden (SizedBox.shrink)', (tester) async {
      await tester.pumpConsumerWidget(
        _harness(expandedCountry: null, onExpand: (_) {}),
        overrides: _overrideCountries([]),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('places-picker-country-France')), findsNothing);
    });

    testWidgets('tapping a country row selects it and calls onExpandCountry with that country', (tester) async {
      String? expanded;
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: null, onExpand: (c) => expanded = c)),
        overrides: _overrideCountries(['France', 'Spain']),
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.byType(PlacesPickerCountryAccordion)),
      );
      await tester.tap(find.byKey(const Key('places-picker-country-France')));
      await tester.pumpAndSettle();

      expect(expanded, 'France');
      expect(container.read(photosFilterProvider).location.country, 'France');
      expect(container.read(photosFilterProvider).location.city, isNull);
    });

    testWidgets('tapping an already-expanded country calls onExpandCountry(null)', (tester) async {
      String? expanded = 'France';
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: 'France', onExpand: (c) => expanded = c)),
        overrides: [..._overrideCountries(['France']), citySuggestionsProvider.overrideWith((ref, c) async => [])],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-picker-country-France')));
      await tester.pumpAndSettle();
      expect(expanded, isNull);
    });

    testWidgets('expanding a country fetches its cities only — other countries are not fetched', (tester) async {
      final fetchedFor = <String?>[];
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: 'France', onExpand: (_) {})),
        overrides: [
          ..._overrideCountries(['France', 'Spain']),
          citySuggestionsProvider.overrideWith((ref, country) async {
            fetchedFor.add(country);
            return country == 'France' ? ['Paris', 'Lyon'] : ['should-not-appear'];
          }),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-picker-city-Paris')), findsOneWidget);
      expect(find.byKey(const Key('places-picker-city-Lyon')), findsOneWidget);
      expect(fetchedFor, ['France']);
      expect(find.text('should-not-appear'), findsNothing);
    });

    testWidgets('tapping a city selects country + city via setLocation', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: 'France', onExpand: (_) {})),
        overrides: [
          ..._overrideCountries(['France']),
          citySuggestionsProvider.overrideWith((ref, country) async => ['Paris', 'Lyon']),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.byType(PlacesPickerCountryAccordion)),
      );
      await tester.tap(find.byKey(const Key('places-picker-city-Paris')));
      await tester.pumpAndSettle();

      final loc = container.read(photosFilterProvider).location;
      expect(loc.country, 'France');
      expect(loc.city, 'Paris');
    });

    testWidgets('selecting a different country replaces the prior country/city selection', (tester) async {
      String? expanded = 'France';
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: expanded, onExpand: (c) => expanded = c)),
        overrides: [
          ..._overrideCountries(['France', 'Spain']),
          citySuggestionsProvider.overrideWith((ref, country) async => country == 'France' ? ['Paris'] : []),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(
        tester.element(find.byType(PlacesPickerCountryAccordion)),
      );
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'France', city: 'Paris'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-picker-country-Spain')));
      await tester.pumpAndSettle();

      final loc = container.read(photosFilterProvider).location;
      expect(loc.country, 'Spain');
      expect(loc.city, isNull);
    });

    testWidgets('search query filters the already-loaded city list for the expanded country', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: 'France', onExpand: (_) {})),
        overrides: [
          ..._overrideCountries(['France']),
          citySuggestionsProvider.overrideWith((ref, country) async => ['Paris', 'Lyon']),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('places-picker-city-Paris')), findsOneWidget);
      expect(find.byKey(const Key('places-picker-city-Lyon')), findsOneWidget);

      final container = ProviderScope.containerOf(
        tester.element(find.byType(PlacesPickerCountryAccordion)),
      );
      container.read(placesPickerQueryProvider.notifier).state = 'par';
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-picker-city-Paris')), findsOneWidget);
      expect(find.byKey(const Key('places-picker-city-Lyon')), findsNothing);
    });

    testWidgets('per-country fetch error shows an inline retry for that country only', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedCountry: 'Italy', onExpand: (_) {})),
        overrides: [
          ..._overrideCountries(['Italy']),
          citySuggestionsProvider.overrideWith((ref, country) async => throw Exception('boom')),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-retry')), findsNothing);
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        SingleChildScrollView(child: _harness(expandedCountry: null, onExpand: (_) {})),
        overrides: _overrideCountries(['France']),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('places-picker-country-France')), findsOneWidget);
    });
  });
}
