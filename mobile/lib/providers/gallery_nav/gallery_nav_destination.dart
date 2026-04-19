import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

class GalleryNavDestination {
  final GalleryTabEnum tab;
  final String labelKey;
  final IconData idleIcon;
  final IconData activeIcon;
  final PageRouteInfo Function() routeBuilder;

  const GalleryNavDestination._({
    required this.tab,
    required this.labelKey,
    required this.idleIcon,
    required this.activeIcon,
    required this.routeBuilder,
  });

  static GalleryNavDestination forTab(GalleryTabEnum tab) {
    switch (tab) {
      case GalleryTabEnum.photos:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.photos,
          labelKey: 'nav_photos',
          idleIcon: Icons.photo_library_outlined,
          activeIcon: Icons.photo_library,
          routeBuilder: _photosRoute,
        );
      case GalleryTabEnum.albums:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.albums,
          labelKey: 'nav_albums',
          idleIcon: Icons.photo_album_outlined,
          activeIcon: Icons.photo_album,
          routeBuilder: _albumsRoute,
        );
      case GalleryTabEnum.library:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.library,
          labelKey: 'nav_library',
          idleIcon: Icons.space_dashboard_outlined,
          activeIcon: Icons.space_dashboard_rounded,
          routeBuilder: _libraryRoute,
        );
    }
  }
}

MainTimelineRoute _photosRoute() => const MainTimelineRoute();
DriftAlbumsRoute _albumsRoute() => const DriftAlbumsRoute();
DriftLibraryRoute _libraryRoute() => const DriftLibraryRoute();
