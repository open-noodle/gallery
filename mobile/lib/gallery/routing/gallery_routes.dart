import 'package:auto_route/auto_route.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/routing/space_albums_duplicate_guard.dart';

// The fork's pages, re-exported so router.dart (and the router.gr.dart part generated from it) reaches
// them through its single import of this file.
export 'package:immich_mobile/pages/library/spaces/space_album_detail.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_detail.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_link_album.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_member_selection.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_members.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_people.page.dart';
export 'package:immich_mobile/pages/library/spaces/spaces.page.dart';
export 'package:immich_mobile/presentation/pages/common/gallery_tab_shell.page.dart';
export 'package:immich_mobile/presentation/pages/photos_filter/camera_picker.page.dart';
export 'package:immich_mobile/presentation/pages/photos_filter/person_picker.page.dart';
export 'package:immich_mobile/presentation/pages/photos_filter/places_picker.page.dart';
export 'package:immich_mobile/presentation/pages/photos_filter/tags_picker.page.dart';
export 'package:immich_mobile/presentation/pages/photos_filter/when_picker.page.dart';

/// The fork's routes, spread into [AppRouter.routes] after ChangePasswordRoute. Route names must stay
/// unique within each level (test/routing/router_test.dart); the same page may appear under different
/// parents, as SpacesRoute does: once as a tab child of GalleryTabShellRoute and once as a pushed route.
List<AutoRoute> galleryRoutes(AutoRouteGuard authGuard, AutoRouteGuard duplicateGuard) => [
  AutoRoute(
    page: GalleryTabShellRoute.page,
    guards: [authGuard, duplicateGuard],
    children: [
      AutoRoute(page: MainTimelineRoute.page, guards: [authGuard, duplicateGuard]),
      AutoRoute(page: AlbumsRoute.page, guards: [authGuard, duplicateGuard]),
      // Declared but not always a tab: the `routes:` list in
      // GalleryTabShellPage picks three of these four per the user's
      // navShowSpaces preference. AlbumsRoute stays declared even when
      // Spaces occupies slot 1 — the Library tab pushes it directly.
      AutoRoute(page: SpacesRoute.page, guards: [authGuard, duplicateGuard]),
      AutoRoute(page: LibraryRoute.page, guards: [authGuard, duplicateGuard]),
    ],
  ),
  // Keep the platform page transition: a CustomRoute would render its own
  // transitionsBuilder instead of the PageTransitionsTheme, and iOS would
  // never install the Cupertino edge swipe-back gesture (#899).
  AutoRoute(page: SpacesRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: SpaceDetailRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: SpaceMembersRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: SpacePeopleRoute.page, guards: [authGuard, duplicateGuard]),
  // No duplicateGuard: this route is legitimately self-recursive — drilling into a folder
  // pushes SpaceAlbumsRoute onto SpaceAlbumsRoute with a different folderId. DuplicateGuard
  // compares route NAMES only, so it would treat every folder tap as a duplicate and block it.
  // SpaceAlbumsDuplicateGuard (space_albums_duplicate_guard.dart) is the args-aware
  // replacement: it compares `spaceId` + `folderId` off the pending/current route's args
  // directly (auto_route 11.1.0 exposes both via `resolver.route.args` / `router.current.args`),
  // so a folder tap with a different folderId still pushes while a double-tap producing an
  // IDENTICAL spaceId+folderId is blocked — closing the double-push regression this route would
  // otherwise have reintroduced by dropping duplicateGuard entirely.
  AutoRoute(page: SpaceAlbumsRoute.page, guards: [authGuard, const SpaceAlbumsDuplicateGuard()]),
  AutoRoute(page: SpaceAlbumDetailRoute.page, guards: [authGuard, duplicateGuard]),
  CustomRoute(
    page: SpaceLinkAlbumRoute.page,
    guards: [authGuard, duplicateGuard],
    transitionsBuilder: TransitionsBuilders.slideBottom,
  ),
  CustomRoute(
    page: SpaceMemberSelectionRoute.page,
    guards: [authGuard, duplicateGuard],
    transitionsBuilder: TransitionsBuilders.slideBottom,
  ),
  AutoRoute(page: AlbumsRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: PersonPickerRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: WhenPickerRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: PlacesPickerRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: TagsPickerRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: CameraPickerRoute.page, guards: [authGuard, duplicateGuard]),
];
