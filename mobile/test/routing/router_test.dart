import 'package:auto_route/auto_route.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/gallery_permission.provider.dart';
import 'package:immich_mobile/routing/duplicate_guard.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/auth.service.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/services/secure_storage.service.dart';
import 'package:mocktail/mocktail.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockAuthService extends Mock implements AuthService {}

class _MockGalleryPermissionNotifier extends Mock implements GalleryPermissionNotifier {}

class _MockSecureStorageService extends Mock implements SecureStorageService {}

class _MockLocalAuthService extends Mock implements LocalAuthService {}

void main() {
  late AppRouter router;

  setUp(() {
    // The guards only stash their dependencies at construction time, so mocks
    // are enough to read the route table back.
    router = AppRouter(
      _MockApiService(),
      _MockAuthService(),
      _MockGalleryPermissionNotifier(),
      _MockSecureStorageService(),
      _MockLocalAuthService(),
    );
  });

  /// The route type auto_route actually builds the page route from: the
  /// explicitly declared [AutoRoute.type], or the router-wide default when the
  /// route does not declare one.
  RouteType effectiveRouteType(String routeName) {
    final route = router.routes.firstWhere((route) => route.name == routeName);
    return route.type ?? router.defaultRouteType;
  }

  List<AutoRouteGuard> guardsOf(String routeName) =>
      router.routes.firstWhere((route) => route.name == routeName).guards;

  group('AppRouter page transitions', () {
    // A CustomRouteType renders its own transitionsBuilder instead of
    // delegating to the platform PageTransitionsTheme, so iOS never wraps the
    // page in the Cupertino back-gesture detector and the edge swipe-back
    // silently does nothing.
    test('Spaces uses the platform page transition so iOS keeps swipe-back', () {
      expect(effectiveRouteType('SpacesRoute'), isA<MaterialRouteType>());
    });
  });

  group('AppRouter duplicate guard', () {
    // DuplicateGuard rejects any push whose route NAME matches the current top
    // route's, and a generated route name is a const string — 'GamePlayRoute',
    // with no trace of the challenge id in it. So on a route pushed from its
    // OWN page, the guard cannot tell "open a different record" from "re-open
    // the page you are already on", and cancels the push via
    // `resolver.next(false)` — which completes the push future with null rather
    // than throwing, leaving no error for the caller to surface.
    //
    // Two routes in the app are pushed from their own page and must therefore
    // stay unguarded:
    //
    //   FolderRoute   folder -> subfolder
    //   GamePlayRoute "Play again" on a finished solo game, which creates the
    //                 next challenge server-side and then opens it
    //
    // Guarding GamePlayRoute made Play again a dead button that still spent a
    // challenge per tap. The page's own widget test cannot catch that: it pumps
    // under a FakeStackRouter, which records pushes without running any guard.
    test('FolderRoute can push itself, for folder -> subfolder', () {
      expect(guardsOf('FolderRoute').whereType<DuplicateGuard>(), isEmpty);
    });

    test('GamePlayRoute can push itself, for Play again', () {
      expect(guardsOf('GamePlayRoute').whereType<DuplicateGuard>(), isEmpty);
    });

    // This assertion belongs HERE, against the real route table, and not only in the widget test
    // that checks the row pushes something: a FakeStackRouter records pushes without running any
    // guard, so the widget test passes whether or not the guard would have cancelled the push. That
    // gap is exactly how the Play again regression reached a device with a fully green suite.
    //
    // The review route opens one round from a list that can itself sit on the reveal's own back
    // stack, so a future iteration opening another round FROM the reveal is one step away — and at
    // that point a name-based guard would cancel it silently.
    test('GameRoundReviewRoute can push itself, for round-to-round review', () {
      expect(guardsOf('GameRoundReviewRoute').whereType<DuplicateGuard>(), isEmpty);
    });

    // The counterexample that keeps the two above honest: a route nothing
    // pushes from its own page still carries the guard.
    test('PhotoGuesserRoute is still guarded', () {
      expect(guardsOf('PhotoGuesserRoute').whereType<DuplicateGuard>(), isNotEmpty);
    });
  });
}
