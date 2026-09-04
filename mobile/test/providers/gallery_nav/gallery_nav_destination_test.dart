import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

void main() {
  test('photos destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.photos);
    expect(d.labelKey, 'nav_photos');
    expect(d.idleIcon, Icons.photo_library_outlined);
    expect(d.activeIcon, Icons.photo_library);
    expect(d.routeBuilder(), isA<MainTimelineRoute>());
  });

  test('albums destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.albums);
    expect(d.labelKey, 'nav_albums');
    expect(d.idleIcon, Icons.photo_album_outlined);
    expect(d.activeIcon, Icons.photo_album);
    expect(d.routeBuilder(), isA<AlbumsRoute>());
  });

  test('library destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.library);
    expect(d.labelKey, 'nav_library');
    expect(d.idleIcon, Icons.space_dashboard_outlined);
    expect(d.activeIcon, Icons.space_dashboard_rounded);
    expect(d.routeBuilder(), isA<LibraryRoute>());
  });

  test('spaces destination carries the shared Spaces identity', () {
    final destination = GalleryNavDestination.forTab(GalleryTabEnum.spaces);

    expect(destination.tab, GalleryTabEnum.spaces);
    expect(destination.labelKey, 'spaces');
    expect(destination.idleIcon, Icons.workspaces_outlined);
    expect(destination.activeIcon, Icons.workspaces);
    expect(destination.routeBuilder(), isA<SpacesRoute>());
  });
}
