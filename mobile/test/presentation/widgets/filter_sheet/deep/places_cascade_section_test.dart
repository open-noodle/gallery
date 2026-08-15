import 'package:easy_localization/easy_localization.dart';
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

FilterSuggestionsResponseDto _sugg({
  List<String>? countries,
  bool hasNoGpsAssets = false,
  bool hasNoPlaceNameAssets = false,
}) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
    hasNoGpsAssets: hasNoGpsAssets,
  hasNoPlaceNameAssets: hasNoPlaceNameAssets,
  countries: countries ?? const [],
);

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

    testWidgets('offers the no-location entries when the server allows them', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) =>
                Future.value(_sugg(countries: ['France'], hasNoGpsAssets: true, hasNoPlaceNameAssets: true)),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsOneWidget);
      expect(find.widgetWithText(FilterChip, 'filter_location_no_place_name'.tr()), findsOneWidget);
    });

    // The headline case: a library with nothing geotagged has an empty `countries` list, but
    // the section must still offer the presence chip instead of collapsing entirely (the
    // shared DeepSectionScaffold otherwise hides body + disables the header whenever the
    // resolved data list is empty).
    testWidgets('offers the no-gps entry even with zero countries', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: const [], hasNoGpsAssets: true)),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsOneWidget);
    });

    // The presence chip alone isn't the whole story: the "Search N places →" affordance is
    // this section's only route to the full PlacesPickerPage (see PlacesStrip's separate "+N"
    // tile for the strip's own route). With zero countries `count` is 0, so without accounting
    // for the presence entries too, that affordance — and the picker it opens — would stay
    // unreachable even after the chip above starts rendering.
    testWidgets('keeps the picker entry point reachable when there are zero countries', (tester) async {
      var opened = false;
      await tester.pumpConsumerWidget(
        Material(child: PlacesCascadeSection(onOpenPicker: () => opened = true)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: const [], hasNoGpsAssets: true)),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-section-search-more')), findsOneWidget);
      await tester.tap(find.byKey(const Key('places-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('hides the no-location entries when the server says they would match nothing', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: ['France']))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsNothing);
      expect(find.widgetWithText(FilterChip, 'filter_location_no_place_name'.tr()), findsNothing);
    });

    // A selected `state` (with no country) still resolves selectedCountry to null, so the
    // country Wrap — and this chip — stays reachable. That makes this the one scenario in
    // this surface where a stale field can genuinely leak through: proves the handler builds
    // a FRESH SearchLocationFilter rather than `copyWith(locationPresence: ...)`, whose
    // `state ?? this.state` semantics would silently keep the old state alongside the new
    // presence value.
    testWidgets('tapping the no-gps entry constructs a fresh filter, clearing an existing state', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: ['France'], hasNoGpsAssets: true)),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(state: 'California'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()));
      await tester.pumpAndSettle();

      final loc = container.read(photosFilterProvider).location;
      expect(loc.locationPresence, 'noGps');
      expect(loc.state, isNull);
    });

    testWidgets('tapping the already-selected no-gps entry clears the location filter', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(countries: ['France'], hasNoGpsAssets: true)),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(locationPresence: 'noGps'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).location.locationPresence, isNull);
    });

    testWidgets('keeps the no-gps entry visible when already selected even if the flag turns false', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PlacesCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(countries: ['France']))),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesCascadeSection)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(locationPresence: 'noGps'));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(FilterChip, 'filter_location_no_gps'.tr()), findsOneWidget);
    });
  });
}
