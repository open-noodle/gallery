import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';

/// Live search text for [PlacesPickerPage].
final placesPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

/// Countries from the filter suggestions, filtered by the picker query
/// (substring match, case-insensitive). Cities are NOT fetched here — only
/// when a country is expanded in the picker (see citySuggestionsProvider).
final placesPickerCountriesProvider = Provider.autoDispose<AsyncValue<List<String>>>((ref) {
  final filter = ref.watch(photosFilterDebouncedProvider);
  final suggestions = ref.watch(photosFilterSuggestionsProvider(filter));
  final query = ref.watch(placesPickerQueryProvider).trim().toLowerCase();
  return suggestions.whenData((s) {
    final countries = s.countries;
    if (query.isEmpty) return countries;
    return countries.where((c) => c.toLowerCase().contains(query)).toList();
  });
});
