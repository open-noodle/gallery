import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/places_picker.provider.dart';
import 'package:openapi/api.dart';

FilterSuggestionsResponseDto _sugg(List<String> countries) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
  countries: countries,
);

ProviderContainer _containerWith(List<String> countries) {
  return ProviderContainer(
    overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) async => _sugg(countries))],
  );
}

// placesPickerCountriesProvider is a *synchronous* derived Provider<AsyncValue<...>>
// (not a FutureProvider), so tests must first await the underlying suggestions future
// to settle before reading it — mirrors how the section widgets consume it.
Future<List<String>> _readCountries(ProviderContainer c) async {
  final filter = c.read(photosFilterDebouncedProvider);
  await c.read(photosFilterSuggestionsProvider(filter).future);
  final async = c.read(placesPickerCountriesProvider);
  return async.value!;
}

void main() {
  group('placesPickerCountriesProvider', () {
    test('empty query returns all countries', () async {
      final c = _containerWith(['France', 'Spain', 'Finland']);
      addTearDown(c.dispose);
      final result = await _readCountries(c);
      expect(result, ['France', 'Spain', 'Finland']);
    });

    test('query filters by substring, case-insensitive', () async {
      final c = _containerWith(['France', 'Spain', 'Finland']);
      addTearDown(c.dispose);
      c.read(placesPickerQueryProvider.notifier).state = 'fr';
      final result = await _readCountries(c);
      expect(result, ['France']);
    });

    test('query matches multiple countries via substring', () async {
      final c = _containerWith(['France', 'Spain', 'Finland']);
      addTearDown(c.dispose);
      c.read(placesPickerQueryProvider.notifier).state = 'in';
      final result = await _readCountries(c);
      expect(result, ['Spain', 'Finland']);
    });

    test('whitespace-only query returns full list', () async {
      final c = _containerWith(['France']);
      addTearDown(c.dispose);
      c.read(placesPickerQueryProvider.notifier).state = '   ';
      final result = await _readCountries(c);
      expect(result, ['France']);
    });

    test('non-matching query returns empty', () async {
      final c = _containerWith(['France']);
      addTearDown(c.dispose);
      c.read(placesPickerQueryProvider.notifier).state = 'zzzzz';
      final result = await _readCountries(c);
      expect(result, isEmpty);
    });
  });
}
