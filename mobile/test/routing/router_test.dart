import 'package:auto_route/auto_route.dart';
import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/routing/duplicate_guard.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/routing/space_albums_duplicate_guard.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/auth.service.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/services/secure_storage.service.dart';
import 'package:mocktail/mocktail.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockAuthService extends Mock implements AuthService {}

class _MockSecureStorageService extends Mock implements SecureStorageService {}

class _MockLocalAuthService extends Mock implements LocalAuthService {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppRouter router;
  late Drift db;

  setUp(() async {
    // AuthGuard reads the access token synchronously and bounces to Login when it is missing,
    // so a real navigation test needs a seeded Store. Reading the route table alone does not.
    db = Drift(DatabaseConnection(NativeDatabase.memory()));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await Store.put(StoreKey.accessToken, 'test-token');

    // The guards only stash their dependencies at construction time, so mocks
    // are enough to read the route table back.
    router = AppRouter(_MockApiService(), _MockAuthService(), _MockSecureStorageService(), _MockLocalAuthService());
  });

  tearDown(() async => db.close());

  /// The route type auto_route actually builds the page route from: the
  /// explicitly declared [AutoRoute.type], or the router-wide default when the
  /// route does not declare one.
  RouteType effectiveRouteType(String routeName) {
    final route = router.routes.firstWhere((route) => route.name == routeName);
    return route.type ?? router.defaultRouteType;
  }

  group('AppRouter page transitions', () {
    // A CustomRouteType renders its own transitionsBuilder instead of
    // delegating to the platform PageTransitionsTheme, so iOS never wraps the
    // page in the Cupertino back-gesture detector and the edge swipe-back
    // silently does nothing.
    test('Spaces uses the platform page transition so iOS keeps swipe-back', () {
      expect(effectiveRouteType('SpacesRoute'), isA<MaterialRouteType>());
    });
  });

  group('AppRouter guards', () {
    List<AutoRouteGuard> guardsOf(String routeName) =>
        router.routes.firstWhere((route) => route.name == routeName).guards;

    // Drilling into a space album folder pushes SpaceAlbumsRoute onto SpaceAlbumsRoute with a
    // different folderId. Plain DuplicateGuard compares route NAMES only, ignoring args, so
    // carrying it on this route makes every folder tap a silent no-op — a bug that shipped once
    // and was only caught by hand on a simulator, because the page's widget tests always push
    // this route onto a fresh stack and never onto itself.
    //
    // This asserts the BEHAVIOUR rather than the route table, so it stays honest whichever way
    // the guard is fixed. SpaceAlbumsRoute now carries [SpaceAlbumsDuplicateGuard] instead of the
    // plain [DuplicateGuard]: it compares `spaceId` + `folderId` off `resolver.route.args` /
    // `router.current.args`, so a different folderId still pushes. Comparing `SpaceAlbumsRouteArgs`
    // wholesale (its generated `==`) would have been fine too here — auto_route_generator's
    // `route_info_builder.dart` filters `equatableParams` to `p is! FunctionParamConfig`, so the
    // generated `==`/`hashCode` already EXCLUDE the callback fields (`onToggle`/`onUnlink`/
    // `onLink`) — but the guard compares the two named fields directly rather than relying on
    // that generated `==`, matching exactly what's asked: same spaceId AND same folderId.
    test('pushing SpaceAlbums onto itself with a different folderId is not blocked', () async {
      await router.push(SpaceAlbumsRoute(spaceId: 'space-1', canEdit: true)).timeout(_never, onTimeout: () => null);
      await router
          .push(SpaceAlbumsRoute(spaceId: 'space-1', canEdit: true, folderId: 'trips'))
          .timeout(_never, onTimeout: () => null);

      expect(router.stack.map((route) => route.name), ['SpaceAlbumsRoute', 'SpaceAlbumsRoute']);
      expect((router.stack.last.routeData.args! as SpaceAlbumsRouteArgs).folderId, 'trips');
    });

    // The regression this guard exists for: two quick taps on "See all" (or a folder card) before
    // the push animation starts must not stack two identical pages — back would otherwise
    // traverse the duplicate. Same spaceId AND same folderId (both null here, i.e. the space
    // root) is the "identical" case; a different folderId (above) must still push.
    test('double-tapping the same SpaceAlbums destination does not push a duplicate', () async {
      await router.push(SpaceAlbumsRoute(spaceId: 'space-1', canEdit: true)).timeout(_never, onTimeout: () => null);
      await router.push(SpaceAlbumsRoute(spaceId: 'space-1', canEdit: true)).timeout(_never, onTimeout: () => null);

      expect(router.stack.map((route) => route.name), ['SpaceAlbumsRoute']);
    });

    // Same `folderId` (both null — the space root) but a DIFFERENT `spaceId`: the guard must not
    // block this. Every other test here holds spaceId fixed at 'space-1' and varies folderId, so
    // none of them would catch a mutation that dropped the `spaceId` half of the guard's
    // condition, leaving only the `folderId` comparison — this test is what pins that half down.
    test('pushing SpaceAlbums for a different space is not blocked even with the same folderId', () async {
      await router.push(SpaceAlbumsRoute(spaceId: 'space-1', canEdit: true)).timeout(_never, onTimeout: () => null);
      await router.push(SpaceAlbumsRoute(spaceId: 'space-2', canEdit: true)).timeout(_never, onTimeout: () => null);

      expect(router.stack.map((route) => route.name), ['SpaceAlbumsRoute', 'SpaceAlbumsRoute']);
      expect((router.stack.last.routeData.args! as SpaceAlbumsRouteArgs).spaceId, 'space-2');
    });

    // The sibling space routes are NOT self-recursive, so they must keep the plain guard — this
    // pins the exemption to the one route that needs args-aware duplicate detection instead of
    // letting it spread.
    test('sibling space routes keep the DuplicateGuard', () {
      for (final name in ['SpacesRoute', 'SpaceDetailRoute', 'SpaceMembersRoute', 'SpaceAlbumDetailRoute']) {
        expect(guardsOf(name).whereType<DuplicateGuard>(), hasLength(1), reason: '$name should keep DuplicateGuard');
      }
    });

    test('SpaceAlbumsRoute carries the args-aware duplicate guard instead of the plain one', () {
      expect(guardsOf('SpaceAlbumsRoute').whereType<SpaceAlbumsDuplicateGuard>(), hasLength(1));
      expect(guardsOf('SpaceAlbumsRoute').whereType<DuplicateGuard>(), isEmpty);
    });
  });
}

/// `push` completes only when the pushed route is popped, so awaiting it directly would hang.
/// The guards resolve synchronously, so the stack is already settled once the timeout elapses.
const _never = Duration(milliseconds: 50);
