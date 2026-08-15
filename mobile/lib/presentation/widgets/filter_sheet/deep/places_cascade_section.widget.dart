import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Preview cap: the deep section's country Wrap shows at most this many
/// chips. The Wrap only renders while no country is selected — selecting one
/// swaps in [_CityCascade], whose InputChip shows the selection instead.
const int _kPreviewCap = 10;

/// PlacesCascadeSection — Deep-snap section for the Places filter dimension.
///
/// When no country is selected, renders a Wrap of country FilterChips sourced
/// from photosFilterSuggestionsProvider (capped to [_kPreviewCap]). Tapping a
/// country sets filter.location.country and swaps in a _CityCascade which
/// shows:
///   - the selected country as an InputChip (× clears it)
///   - a Wrap of city FilterChips from citySuggestionsProvider(country)
/// A body "Search N places →" row below the wrap/cascade delegates to
/// [onOpenPicker] — tapping it opens the full picker.
class PlacesCascadeSection extends ConsumerWidget {
  final VoidCallback? onOpenPicker;
  const PlacesCascadeSection({super.key, this.onOpenPicker});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(photosFilterDebouncedProvider);
    final async = ref.watch(photosFilterSuggestionsProvider(filter));
    final countriesAsync = async.whenData((s) => s.countries);
    final suggestions = async.valueOrNull;
    final selectedCountry = ref.watch(photosFilterProvider.select((f) => f.location.country));
    final selectedPresence = ref.watch(photosFilterProvider.select((f) => f.location.locationPresence));
    final count = countriesAsync.valueOrNull?.length ?? 0;

    // Same gate as each individual presence chip below (server flag OR already selected) —
    // computed once here because it also has to keep the *section itself* (and its route to
    // the full picker) from collapsing when there are zero countries. See hasExtraEntries /
    // _SearchMoreRow's gate below.
    final hasExtraEntries =
        (suggestions?.hasNoGpsAssets ?? false) ||
        (suggestions?.hasNoPlaceNameAssets ?? false) ||
        selectedPresence == 'noGps' ||
        selectedPresence == 'noPlaceName';

    return DeepSectionScaffold<String>(
      sectionId: FilterSectionId.places,
      titleKey: 'filter_sheet_deep_places_section',
      emptyCaptionKey: 'filter_sheet_deep_empty_places',
      items: countriesAsync,
      // Zero countries must not collapse the section: a fully-unlocated library is the
      // headline case for this filter, and it needs the presence chips below to still render.
      hasExtraEntries: hasExtraEntries,
      onRetry: () => ref.invalidate(photosFilterSuggestionsProvider(filter)),
      childBuilder: (countries) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selectedCountry == null)
              _CountryWrap(
                countries: countries,
                hasNoGpsAssets: suggestions?.hasNoGpsAssets ?? false,
                hasNoPlaceNameAssets: suggestions?.hasNoPlaceNameAssets ?? false,
              )
            else
              _CityCascade(country: selectedCountry),
            // Also gated on hasExtraEntries: with zero countries this is otherwise the
            // section's only route to the full PlacesPickerPage, and count alone is 0.
            if (count > 0 || hasExtraEntries) _SearchMoreRow(count: count, onOpenPicker: onOpenPicker),
          ],
        );
      },
    );
  }
}

class _SearchMoreRow extends StatelessWidget {
  final int count;
  final VoidCallback? onOpenPicker;
  const _SearchMoreRow({required this.count, this.onOpenPicker});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: InkWell(
        key: const Key('places-section-search-more'),
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          HapticFeedback.selectionClick();
          onOpenPicker?.call();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(Icons.search_rounded, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 10),
              // The translated label already ends in "→" (see filter_sheet_deep_search_n_places).
              Expanded(
                child: Text(
                  _searchMorePlacesLabel(count),
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.primary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Plural helper — nested-leaf lookup avoids `.plural()`, which reads a
/// late-initialized locale field and throws in widget tests without an
/// `EasyLocalization` ancestor. Matches the pattern in `people_section.widget.dart`.
String _searchMorePlacesLabel(int count) {
  final variant = count == 1 ? 'one' : 'other';
  return 'filter_sheet_deep_search_n_places.$variant'.tr(namedArgs: {'count': '$count'});
}

class _CountryWrap extends ConsumerWidget {
  final List<String> countries;
  final bool hasNoGpsAssets;
  final bool hasNoPlaceNameAssets;
  const _CountryWrap({required this.countries, required this.hasNoGpsAssets, required this.hasNoPlaceNameAssets});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final display = countries.take(_kPreviewCap).toList();
    final selectedPresence = ref.watch(photosFilterProvider.select((f) => f.location.locationPresence));
    // Location presence ("no GPS" / "coordinates but no name") is a member of the same
    // location group as country/city — mutually exclusive with them, ONE chip. Offered ahead
    // of the country chips, gated on the server flag OR the value already being selected (so
    // a selection made under a different filter combo stays reachable here).
    final presenceEntries = <_PresenceEntry>[
      if (hasNoGpsAssets || selectedPresence == 'noGps') const _PresenceEntry('noGps', 'filter_location_no_gps'),
      if (hasNoPlaceNameAssets || selectedPresence == 'noPlaceName')
        const _PresenceEntry('noPlaceName', 'filter_location_no_place_name'),
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final entry in presenceEntries)
          FilterChip(
            key: Key('places-presence-${entry.value}'),
            label: Text(entry.labelKey.tr()),
            selected: selectedPresence == entry.value,
            onSelected: (_) {
              HapticFeedback.selectionClick();
              // Replaces the whole location group — a fresh SearchLocationFilter, never
              // copyWith (copyWith's `x ?? this.x` can't clear a field it doesn't set).
              ref
                  .read(photosFilterProvider.notifier)
                  .setLocation(
                    selectedPresence == entry.value ? null : SearchLocationFilter(locationPresence: entry.value),
                  );
            },
          ),
        for (final country in display)
          FilterChip(
            key: Key('places-country-$country'),
            label: Text(country),
            selected: false,
            onSelected: (_) {
              HapticFeedback.selectionClick();
              ref.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: country));
            },
          ),
      ],
    );
  }
}

/// One entry of the location-presence group: `value` is the wire value sent as
/// `locationPresence` ('noGps' / 'noPlaceName'), `labelKey` the i18n key for its chip label.
class _PresenceEntry {
  final String value;
  final String labelKey;
  const _PresenceEntry(this.value, this.labelKey);
}

class _CityCascade extends ConsumerWidget {
  final String country;
  const _CityCascade({required this.country});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final citiesAsync = ref.watch(citySuggestionsProvider(country));
    final selectedCity = ref.watch(photosFilterProvider.select((f) => f.location.city));
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        InputChip(
          key: const Key('places-country-selected'),
          label: Text(country),
          selected: true,
          selectedColor: theme.colorScheme.primaryContainer,
          onDeleted: () {
            HapticFeedback.selectionClick();
            ref.read(photosFilterProvider.notifier).setLocation(null);
          },
          deleteIcon: const Icon(Icons.close_rounded, key: Key('places-country-selected-clear')),
        ),
        const SizedBox(height: 8),
        citiesAsync.when(
          data: (cities) {
            if (cities.isEmpty) return const SizedBox.shrink();
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final city in cities)
                  FilterChip(
                    key: Key('places-city-$city'),
                    label: Text(city),
                    selected: selectedCity == city,
                    onSelected: (_) {
                      HapticFeedback.selectionClick();
                      ref
                          .read(photosFilterProvider.notifier)
                          .setLocation(
                            SearchLocationFilter(country: country, city: selectedCity == city ? null : city),
                          );
                    },
                  ),
              ],
            );
          },
          loading: () => const LinearProgressIndicator(),
          error: (_, __) => TextButton.icon(
            onPressed: () => ref.invalidate(citySuggestionsProvider(country)),
            icon: const Icon(Icons.refresh_rounded),
            label: Text('filter_sheet_load_error_retry'.tr()),
          ),
        ),
      ],
    );
  }
}
