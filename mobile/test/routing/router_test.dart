import 'package:auto_route/auto_route.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/gallery_permission.provider.dart';
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

  group('AppRouter page transitions', () {
    // A CustomRouteType renders its own transitionsBuilder instead of
    // delegating to the platform PageTransitionsTheme, so iOS never wraps the
    // page in the Cupertino back-gesture detector and the edge swipe-back
    // silently does nothing.
    test('Spaces uses the platform page transition so iOS keeps swipe-back', () {
      expect(effectiveRouteType('SpacesRoute'), isA<MaterialRouteType>());
    });
  });
}
