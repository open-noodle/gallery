import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/widgets/library_collection_cards.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';

({GalleryTabEnum? lead, GalleryTabEnum trail}) _order({required bool navShowsSpaces, required bool serverHasSpaces}) {
  final container = ProviderContainer(
    overrides: [
      galleryNavSlotsProvider.overrideWith((_) => galleryNavSlots(showSpaces: navShowsSpaces)),
      serverSupportsSpacesProvider.overrideWithValue(serverHasSpaces),
    ],
  );
  addTearDown(container.dispose);
  return container.read(libraryCollectionOrderProvider);
}

void main() {
  test('Spaces in the nav: Albums leads the Library cards and Spaces trails', () {
    expect(_order(navShowsSpaces: true, serverHasSpaces: true), (
      lead: GalleryTabEnum.albums,
      trail: GalleryTabEnum.spaces,
    ));
  });

  test('Albums in the nav: Spaces leads and Albums trails', () {
    expect(_order(navShowsSpaces: false, serverHasSpaces: true), (
      lead: GalleryTabEnum.spaces,
      trail: GalleryTabEnum.albums,
    ));
  });

  test('a server without Spaces: no Spaces card, Albums trails', () {
    expect(_order(navShowsSpaces: false, serverHasSpaces: false), (lead: null, trail: GalleryTabEnum.albums));
  });
}
