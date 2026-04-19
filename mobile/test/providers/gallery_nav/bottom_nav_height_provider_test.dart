import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';

void main() {
  test('default value is 0', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(bottomNavHeightProvider), 0);
  });

  test('accepts a height write', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(bottomNavHeightProvider.notifier).state = 64;
    expect(container.read(bottomNavHeightProvider), 64);
  });
}
