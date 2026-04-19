import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';

void main() {
  group('FilterSheetSnap', () {
    test('has exactly three states: hidden, browse, deep', () {
      expect(FilterSheetSnap.values, [FilterSheetSnap.hidden, FilterSheetSnap.browse, FilterSheetSnap.deep]);
    });

    test('photosFilterSheetProvider defaults to hidden', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.hidden);
    });
  });
}
