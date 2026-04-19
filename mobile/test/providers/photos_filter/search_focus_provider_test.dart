import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

void main() {
  test('default value is 0', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(photosFilterSearchFocusRequestProvider), 0);
  });

  test('increment persists across reads', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
    expect(container.read(photosFilterSearchFocusRequestProvider), 1);
    container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
    expect(container.read(photosFilterSearchFocusRequestProvider), 2);
  });
}
