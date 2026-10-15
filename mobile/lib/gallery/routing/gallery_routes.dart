import 'package:auto_route/auto_route.dart';
import 'package:immich_mobile/gallery/motion/transitions.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/routing/space_albums_duplicate_guard.dart';

// The fork's pages, re-exported so router.dart (and the router.gr.dart part generated from it) reaches
// them through its single import of this file.
export 'package:immich_mobile/gallery/cleanup/pages/cleanup_day_photos.page.dart';
export 'package:immich_mobile/gallery/cleanup/pages/cleanup_month.page.dart';
export 'package:immich_mobile/gallery/cleanup/pages/cleanup_overview.page.dart';
export 'package:immich_mobile/gallery/cleanup/pages/cleanup_queue.page.dart';
export 'package:immich_mobile/gallery/cleanup/pages/cleanup_year.page.dart';
export 'package:immich_mobile/gallery/cleanup/pages/rewind.page.dart';
export 'package:immich_mobile/pages/games/game_play.page.dart';
export 'package:immich_mobile/pages/games/game_round_review.page.dart';
export 'package:immich_mobile/pages/games/photo_guesser.page.dart';
export 'package:immich_mobile/pages/library/spaces/games/space_games.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_album_detail.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_detail.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_link_album.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_member_selection.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_members.page.dart';
export 'package:immich_mobile/pages/library/spaces/space_people.page.dart';
export 'package:immich_mobile/pages/library/spaces/spaces.page.dart';
export 'package:immich_mobile/presentation/pages/common/gallery_tab_shell.page.dart';

/// The fork's routes, spread into [AppRouter.routes] after ChangePasswordRoute. Route names must stay
/// unique within each level (test/routing/router_test.dart); the same page may appear under different
/// parents, as SpacesRoute does: once as a tab child of GalleryTabShellRoute and once as a pushed route.
List<AutoRoute> galleryRoutes(AutoRouteGuard authGuard, AutoRouteGuard duplicateGuard) => [
  CustomRoute(
    page: GalleryTabShellRoute.page,
    guards: [authGuard, duplicateGuard],
    transitionsBuilder: GalleryTransitions.shell,
    duration: GalleryTransitions.shellDuration,
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
  // No duplicateGuard, for the same reason FolderRoute omits it: this route is pushed
  // from its own page. "Play again" on a finished solo game creates the next challenge and opens
  // it, and the guard compares route NAMES (a const string with no challenge id in it), so it
  // reads that as re-opening the page you are already on and cancels the push silently.
  AutoRoute(page: GamePlayRoute.page, guards: [authGuard]),
  // No duplicateGuard: it compares route NAMES, a const string with no round index in it, so it
  // cannot tell one round's review apart from another. Today this route is only ever pushed from
  // the review list, one at a time, so the gap is latent, but a row-to-row "next round" push
  // within review is one small iteration away, and a name-based guard would cancel that silently
  // the same way it would have cancelled "Play again" above.
  AutoRoute(page: GameRoundReviewRoute.page, guards: [authGuard]),
  AutoRoute(page: SpaceGamesRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: PhotoGuesserRoute.page, guards: [authGuard, duplicateGuard]),
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
  AutoRoute(page: LibraryCleanupYearRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: LibraryCleanupMonthRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: LibraryCleanupOverviewRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: LibraryCleanupQueueRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: LibraryCleanupRewindRoute.page, guards: [authGuard, duplicateGuard]),
  AutoRoute(page: LibraryCleanupDayPhotosRoute.page, guards: [authGuard, duplicateGuard]),
];
