import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/passkeys.dart';
import 'package:immich_mobile/providers/infrastructure/platform.provider.dart';

void main() {
  // Gallery's app has no associated domain for passkeys yet, so the build must not offer them.
  test('the Gallery build reports passkeys unsupported', () async {
    expect(galleryPasskeysEnabled, isFalse);

    final container = ProviderContainer();
    addTearDown(container.dispose);

    expect(container.read(passkeyHostApiProvider), isA<GalleryDisabledPasskeyHostApi>());
    expect(await container.read(passkeyHostApiProvider).isSupported(), isFalse);
  });
}
