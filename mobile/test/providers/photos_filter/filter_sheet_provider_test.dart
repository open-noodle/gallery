import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

void main() {
  group('FilterSheetVisibility', () {
    test('has exactly two states: hidden, visible', () {
      expect(FilterSheetVisibility.values, [FilterSheetVisibility.hidden, FilterSheetVisibility.visible]);
    });

    test('photosFilterSheetProvider defaults to hidden', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
    });
  });
}
