import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.dart';

void main() {
  test('barrel exports are resolvable', () {
    // Compile-time smoke test — if any symbol isn't exported, this file won't build.
    expect(PhotosFilterNotifier, isNotNull);
    expect(FilterSheetSnap.values, isNotEmpty);
    expect(const PersonChipId('x'), isA<ChipId>());
    expect(photosFilterProvider, isNotNull);
    expect(photosFilterSheetProvider, isNotNull);
    expect(photosFilterSuggestionsProvider, isNotNull);
    expect(photosFilterCountProvider, isNotNull);
  });
}
