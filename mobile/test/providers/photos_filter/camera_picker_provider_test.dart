import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/camera_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:openapi/api.dart';

FilterSuggestionsResponseDto _sugg(List<String> cameraMakes) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
  cameraMakes: cameraMakes,
);

ProviderContainer _containerWith(List<String> cameraMakes) {
  return ProviderContainer(
    overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) async => _sugg(cameraMakes))],
  );
}

// cameraPickerMakesProvider is a *synchronous* derived Provider<AsyncValue<...>>
// (not a FutureProvider), so tests must first await the underlying suggestions future
// to settle before reading it — mirrors how the section widgets consume it.
Future<List<String>> _readMakes(ProviderContainer c) async {
  final filter = c.read(photosFilterDebouncedProvider);
  await c.read(photosFilterSuggestionsProvider(filter).future);
  final async = c.read(cameraPickerMakesProvider);
  return async.value!;
}

void main() {
  group('cameraPickerMakesProvider', () {
    test('empty query returns all makes', () async {
      final c = _containerWith(['Canon', 'Sony', 'Nikon']);
      addTearDown(c.dispose);
      final result = await _readMakes(c);
      expect(result, ['Canon', 'Sony', 'Nikon']);
    });

    test('query filters by substring, case-insensitive', () async {
      final c = _containerWith(['Canon', 'Sony', 'Nikon']);
      addTearDown(c.dispose);
      c.read(cameraPickerQueryProvider.notifier).state = 'son';
      final result = await _readMakes(c);
      expect(result, ['Sony']);
    });

    test('query matches multiple makes via substring', () async {
      final c = _containerWith(['Canon', 'Sony', 'Panasonic']);
      addTearDown(c.dispose);
      c.read(cameraPickerQueryProvider.notifier).state = 'an';
      final result = await _readMakes(c);
      expect(result, ['Canon', 'Panasonic']);
    });

    test('whitespace-only query returns full list', () async {
      final c = _containerWith(['Canon']);
      addTearDown(c.dispose);
      c.read(cameraPickerQueryProvider.notifier).state = '   ';
      final result = await _readMakes(c);
      expect(result, ['Canon']);
    });

    test('non-matching query returns empty', () async {
      final c = _containerWith(['Canon']);
      addTearDown(c.dispose);
      c.read(cameraPickerQueryProvider.notifier).state = 'zzzzz';
      final result = await _readMakes(c);
      expect(result, isEmpty);
    });
  });
}
