import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/places_picker.provider.dart';

/// Full-screen country → city accordion for [PlacesPickerPage].
///
/// Reads [placesPickerCountriesProvider] (countries matching the current
/// search query) and renders each as an [InkWell] row; tapping a row both
/// selects the country (`setLocation(SearchLocationFilter(country: c))`,
/// replacing any prior selection) and expands it, collapsing any
/// previously-expanded country. Cities are fetched lazily — only once a
/// country is expanded — via [citySuggestionsProvider], never proactively.
///
/// The host passes [expandedCountry] + [onExpandCountry] so the page can lift
/// single-expand state (mirrors [WhenPickerYearAccordion]'s expandedYear).
class PlacesPickerCountryAccordion extends ConsumerWidget {
  final String? expandedCountry;
  final ValueChanged<String?> onExpandCountry;

  const PlacesPickerCountryAccordion({super.key, required this.expandedCountry, required this.onExpandCountry});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(placesPickerCountriesProvider);
    final selectedCountry = ref.watch(photosFilterProvider.select((f) => f.location.country));
    final selectedCity = ref.watch(photosFilterProvider.select((f) => f.location.city));
    final query = ref.watch(placesPickerQueryProvider).trim().toLowerCase();
    final expanded = expandedCountry;

    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (e, st) => const SizedBox.shrink(),
      data: (countries) {
        var display = countries;
        // Search filters countries by name, PLUS any expanded country whose
        // already-loaded cities match — without triggering a fetch for it
        // (the single-expand accordion means at most one country's cities
        // are cached at a time). No proactive fetch for un-expanded countries.
        if (expanded != null && query.isNotEmpty && !display.contains(expanded)) {
          final cachedCities = ref.watch(citySuggestionsProvider(expanded)).valueOrNull;
          final hasMatch = cachedCities?.any((c) => c.toLowerCase().contains(query)) ?? false;
          if (hasMatch) {
            display = [...display, expanded];
          }
        }
        if (display.isEmpty) return const SizedBox.shrink();
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final country in display)
              _CountryRow(
                country: country,
                selected: selectedCountry == country,
                selectedCity: selectedCountry == country ? selectedCity : null,
                expanded: expanded == country,
                onToggle: () {
                  unawaited(HapticFeedback.selectionClick());
                  ref.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: country));
                  onExpandCountry(expanded == country ? null : country);
                },
              ),
          ],
        );
      },
    );
  }
}

class _CountryRow extends StatelessWidget {
  final String country;
  final bool selected;
  final String? selectedCity;
  final bool expanded;
  final VoidCallback onToggle;

  const _CountryRow({
    required this.country,
    required this.selected,
    required this.selectedCity,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final highlighted = expanded || selected;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: Key('places-picker-country-$country'),
          onTap: onToggle,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    country,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: highlighted ? FontWeight.w600 : FontWeight.w500,
                      color: highlighted ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                if (selected)
                  Icon(
                    Icons.check_circle_rounded,
                    key: Key('places-picker-country-$country-check'),
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                const SizedBox(width: 8),
                Icon(
                  expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                  color: theme.colorScheme.outline,
                ),
              ],
            ),
          ),
        ),
        if (expanded) _CityList(country: country, selectedCity: selectedCity),
      ],
    );
  }
}

class _CityList extends ConsumerWidget {
  final String country;
  final String? selectedCity;
  const _CityList({required this.country, required this.selectedCity});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final citiesAsync = ref.watch(citySuggestionsProvider(country));
    // "Already-loaded cities" search: once a country is expanded (and its
    // cities fetched), the current picker query further narrows the city
    // list too — no extra fetch is triggered by typing.
    final query = ref.watch(placesPickerQueryProvider).trim().toLowerCase();

    return Padding(
      padding: const EdgeInsets.only(left: 16, right: 20, bottom: 8),
      child: citiesAsync.when(
        data: (cities) {
          final filtered = query.isEmpty ? cities : cities.where((c) => c.toLowerCase().contains(query)).toList();
          if (filtered.isEmpty) return const SizedBox.shrink();
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final city in filtered) _CityRow(country: country, city: city, selected: selectedCity == city),
            ],
          );
        },
        loading: () =>
            const Padding(padding: EdgeInsets.symmetric(vertical: 12, horizontal: 4), child: LinearProgressIndicator()),
        error: (_, _) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: TextButton.icon(
            onPressed: () => ref.invalidate(citySuggestionsProvider(country)),
            icon: const Icon(Icons.refresh_rounded),
            label: Text(context.t.filter_sheet_load_error_retry),
          ),
        ),
      ),
    );
  }
}

class _CityRow extends ConsumerWidget {
  final String country;
  final String city;
  final bool selected;
  const _CityRow({required this.country, required this.city, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return InkWell(
      key: Key('places-picker-city-$city'),
      onTap: () {
        unawaited(HapticFeedback.selectionClick());
        ref.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: country, city: city));
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                city,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            Icon(
              selected ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
              size: 20,
              color: selected ? theme.colorScheme.primary : theme.colorScheme.outline,
            ),
          ],
        ),
      ),
    );
  }
}
