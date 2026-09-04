import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

void main() {
  group('GalleryTabEnum', () {
    test('carries a value per destination, including Spaces', () {
      expect(GalleryTabEnum.values, [
        GalleryTabEnum.photos,
        GalleryTabEnum.albums,
        GalleryTabEnum.spaces,
        GalleryTabEnum.library,
      ]);
    });

    test('slot constants describe positions, not enum indices', () {
      expect(kGalleryPhotosIndex, 0);
      expect(kGalleryCollectionIndex, 1);
      expect(kGalleryLibraryIndex, 2);
    });
  });

  group('galleryNavSlots', () {
    test('puts Spaces in the middle slot when enabled', () {
      expect(galleryNavSlots(showSpaces: true), [GalleryTabEnum.photos, GalleryTabEnum.spaces, GalleryTabEnum.library]);
    });

    test('puts Albums in the middle slot when disabled', () {
      expect(galleryNavSlots(showSpaces: false), [
        GalleryTabEnum.photos,
        GalleryTabEnum.albums,
        GalleryTabEnum.library,
      ]);
    });

    test('always yields exactly three slots and never both collection tabs', () {
      for (final showSpaces in [true, false]) {
        final slots = galleryNavSlots(showSpaces: showSpaces);
        expect(slots, hasLength(3));
        expect(slots.toSet(), hasLength(3), reason: 'no slot may repeat');
        expect(slots.contains(GalleryTabEnum.albums) && slots.contains(GalleryTabEnum.spaces), isFalse);
      }
    });
  });

  group('galleryTabProvider', () {
    test('default is photos', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(galleryTabProvider), GalleryTabEnum.photos);
    });

    test('setter persists', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      c.read(galleryTabProvider.notifier).state = GalleryTabEnum.library;
      expect(c.read(galleryTabProvider), GalleryTabEnum.library);
    });
  });
}
