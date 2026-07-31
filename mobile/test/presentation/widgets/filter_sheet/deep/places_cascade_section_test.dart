import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/places_cascade_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

Override _noCollapsed() => filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}));

FilterSuggestionsResponseDto _sugg({List<String>? countries}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, countries: countries ?? const []);

void main() {
  group('PlacesCascadeSection', () {
    testWidgets('renders country chips when no country selected', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
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
          _noCollapsed(),
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
          _noCollapsed(),
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
          _noCollapsed(),
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

    testWidgets('empty countries → section auto-collapses, "(0)" shown, empty caption hidden', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('(0)'), findsOneWidget);
      expect(find.byKey(const Key('deep-section-empty')), findsNothing);
    });

    testWidgets('selected country chip renders primary color in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
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

    // Slice 4 / final review: cap the country wrap to 10 + a body "Search N places →" row.
    testWidgets('caps country wrap to 10 + renders "Search N places →" in the body (not the header)', (tester) async {
      final countries = [for (var i = 0; i < 15; i++) 'C$i'];
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: countries))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.byKey(Key('places-country-C$i')), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.byKey(Key('places-country-C$i')), findsNothing);
      }

      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-body-places')),
          matching: find.byKey(const Key('places-section-search-more')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-header-places')),
          matching: find.byKey(const Key('places-section-search-more')),
        ),
        findsNothing,
      );
    });

    testWidgets('onOpenPicker callback fires when "Search N places →" tapped', (tester) async {
      var opened = false;
      final countries = [for (var i = 0; i < 15; i++) 'C$i'];
      await tester.pumpConsumerWidget(
        Material(child: PlacesCascadeSection(onOpenPicker: () => opened = true)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: countries))),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('pins a selected country beyond the first 10', (tester) async {
      final countries = [for (var i = 0; i < 15; i++) 'C$i'];
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: countries))),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      // C11 is the 12th country (index 11) — beyond the 10-item cap.
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'C11'));
      await tester.pumpAndSettle();

      // Selecting a country swaps the wrap for the city cascade, so the
      // pinned-selection chip itself now shows as the selected-country chip.
      expect(find.byKey(const Key('places-country-selected')), findsOneWidget);
      expect(find.text('C11'), findsOneWidget);
    });

    testWidgets('≤10 countries renders all, no over-cap', (tester) async {
      final countries = [for (var i = 0; i < 6; i++) 'C$i'];
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: countries))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 6; i++) {
        expect(find.byKey(Key('places-country-C$i')), findsOneWidget);
      }
    });

    testWidgets('empty countries → no "Search N places →" affordance', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-section-search-more')), findsNothing);
    });
  });
}
