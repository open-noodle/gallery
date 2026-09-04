import 'package:auto_route/auto_route.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/debug_print.dart';

/// Args-aware duplicate guard for [SpaceAlbumsRoute].
///
/// [SpaceAlbumsRoute] is deliberately self-recursive — drilling into a folder pushes the SAME
/// route onto itself with a different `folderId` — so the plain [DuplicateGuard] (which compares
/// route NAMES only, see that class) cannot be used here: it would treat every folder tap as a
/// duplicate and silently block it (router.dart's `routes` list documents this exemption at the
/// `SpaceAlbumsRoute` entry).
///
/// That exemption reintroduces the double-tap bug [DuplicateGuard] exists for elsewhere: two
/// quick taps on space-detail's "See all" (or a folder card) before the first push's animation
/// starts stack two IDENTICAL pages, and back then traverses the duplicate. This guard closes
/// that gap by comparing the identifying fields instead of the route name: block a push whose
/// `spaceId` AND `folderId` both equal the CURRENT topmost route's, allow any push with a
/// different `folderId` (or a different `spaceId`).
///
/// Comparing `SpaceAlbumsRouteArgs` wholesale (relying on its generated `==`) would also work
/// here without any risk from the route's callback fields (`onToggle`/`onUnlink`/`onLink`):
/// auto_route_generator's code-generator (`route_info_builder.dart`, `equatableParams = ...where
/// ((p) => p is! FunctionParamConfig)`) already EXCLUDES every function-typed constructor
/// parameter from both the generated `==` and `hashCode` — precisely because closures are never
/// `identical`/`==` across rebuilds. This guard still compares `spaceId`/`folderId` directly
/// rather than via that generated `==`, matching the brief's stated requirement exactly (spaceId
/// AND folderId, nothing else — e.g. two pushes that differ only in `canEdit` are not "the same
/// destination") and staying correct even if some future auto_route regeneration ever changed
/// what the generated `==` considers.
///
/// [NavigationResolver.route] (`resolver.route`) is the pending [RouteMatch] about to be pushed —
/// `RouteMatch.args` exposes its typed args directly (auto_route 11.1.0,
/// `lib/src/matcher/route_match.dart`) — and [StackRouter.current] (`router.current`) is the
/// [RouteData] for the currently active page in THIS router, whose `.args` getter forwards to the
/// same underlying `RouteMatch.args` (`lib/src/route/route_data.dart`). Both are populated the
/// same way [DuplicateGuard] already reads `resolver.route.name`/`router.current.name`, so this
/// mirrors an established, working pattern rather than inventing a new one.
class SpaceAlbumsDuplicateGuard extends AutoRouteGuard {
  const SpaceAlbumsDuplicateGuard();

  @override
  void onNavigation(NavigationResolver resolver, StackRouter router) {
    final pendingArgs = resolver.route.args;
    final currentArgs = router.current.args;
    if (pendingArgs is SpaceAlbumsRouteArgs &&
        currentArgs is SpaceAlbumsRouteArgs &&
        pendingArgs.spaceId == currentArgs.spaceId &&
        pendingArgs.folderId == currentArgs.folderId) {
      dPrint(
        () =>
            'SpaceAlbumsDuplicateGuard: Preventing duplicate SpaceAlbumsRoute navigation '
            'for spaceId=${pendingArgs.spaceId} folderId=${pendingArgs.folderId}',
      );
      resolver.next(false);
    } else {
      resolver.next(true);
    }
  }
}
