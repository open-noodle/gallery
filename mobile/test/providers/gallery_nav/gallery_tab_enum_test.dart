import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

void main() {
  group('GalleryTabEnum', () {
    test('enum values in canonical order', () {
      expect(GalleryTabEnum.values, [GalleryTabEnum.photos, GalleryTabEnum.albums, GalleryTabEnum.library]);
    });

    test('indices match the fork-only constants', () {
      expect(GalleryTabEnum.photos.index, kGalleryPhotosIndex);
      expect(GalleryTabEnum.albums.index, kGalleryAlbumsIndex);
      expect(GalleryTabEnum.library.index, kGalleryLibraryIndex);
      expect(kGalleryPhotosIndex, 0);
      expect(kGalleryAlbumsIndex, 1);
      expect(kGalleryLibraryIndex, 2);
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
