// M8: mobile album owners can't view/revoke space links. Pins that the new
// "Linked spaces" section on the album options page only renders for OWNED
// albums, and renders the fetched links (owner-only GET /albums/:id field).
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/auth/auth_state.model.dart';
import 'package:immich_mobile/presentation/pages/drift_album_options.page.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/drift_album_api_repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

class _MockRemoteAlbumService extends Mock implements RemoteAlbumService {}

class _MockUserService extends Mock implements UserService {}

class _MockDriftAlbumApiRepository extends Mock implements DriftAlbumApiRepository {}

class _MockAuthNotifier extends StateNotifier<AuthState> with Mock implements AuthNotifier {
  _MockAuthNotifier(String userId)
    : super(
        AuthState(
          deviceId: 'device-1',
          userId: userId,
          userEmail: '$userId@test.dev',
          name: userId,
          profileImagePath: '',
          isAdmin: false,
          isAuthenticated: true,
        ),
      );
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

RemoteAlbum _albumFixture(String ownerId) => RemoteAlbum(
  id: 'album-1',
  name: 'Test Album',
  ownerId: ownerId,
  description: '',
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: 3,
  ownerName: 'Owner',
  isShared: false,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pumpOptionsPage(
    WidgetTester tester, {
    required String currentUserId,
    required String albumOwnerId,
    List<api.AlbumSharedSpaceLinkResponseDto> sharedSpaceLinks = const [],
  }) async {
    final album = _albumFixture(albumOwnerId);
    final owner = _user(albumOwnerId);

    final albumService = _MockRemoteAlbumService();
    when(() => albumService.getSharedUsers(any())).thenAnswer((_) async => <UserDto>[]);

    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(owner);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

    final albumApiRepo = _MockDriftAlbumApiRepository();
    when(() => albumApiRepo.getSharedSpaceLinks(any())).thenAnswer((_) async => sharedSpaceLinks);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith((ref) => _MockAuthNotifier(currentUserId)),
          remoteAlbumServiceProvider.overrideWithValue(albumService),
          currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, owner)),
          driftAlbumApiRepositoryProvider.overrideWithValue(albumApiRepo),
        ],
        child: EasyLocalization(
          supportedLocales: const [Locale('en')],
          path: '../i18n',
          fallbackLocale: const Locale('en'),
          startLocale: const Locale('en'),
          child: MaterialApp(
            locale: const Locale('en'),
            home: DriftAlbumOptionsPage(album: album),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('owned album with links: "Linked spaces" section renders the space name', (tester) async {
    await pumpOptionsPage(
      tester,
      currentUserId: 'owner-1',
      albumOwnerId: 'owner-1',
      sharedSpaceLinks: [
        api.AlbumSharedSpaceLinkResponseDto(
          linkedById: 'owner-1',
          showInTimeline: true,
          spaceId: 'space-1',
          spaceName: 'Family Space',
        ),
      ],
    );

    expect(find.byKey(const Key('album-linked-spaces-section')), findsOneWidget);
    expect(find.text('Family Space'), findsOneWidget);
    expect(find.byKey(const Key('album-space-link-unlink-space-1')), findsOneWidget);
  });

  testWidgets('owned album with a timeline-hidden link shows the "hidden from timeline" subtitle', (tester) async {
    await pumpOptionsPage(
      tester,
      currentUserId: 'owner-1',
      albumOwnerId: 'owner-1',
      sharedSpaceLinks: [
        api.AlbumSharedSpaceLinkResponseDto(
          linkedById: 'owner-1',
          showInTimeline: false,
          spaceId: 'space-1',
          spaceName: 'Family Space',
        ),
      ],
    );

    expect(find.byKey(const Key('album-space-link-hidden-badge-space-1')), findsOneWidget);
  });

  testWidgets('owned album with NO links: section is absent (no empty header)', (tester) async {
    await pumpOptionsPage(tester, currentUserId: 'owner-1', albumOwnerId: 'owner-1', sharedSpaceLinks: const []);

    expect(find.byKey(const Key('album-linked-spaces-section')), findsNothing);
  });

  testWidgets('non-owned album: "Linked spaces" section never renders, even if links exist', (tester) async {
    await pumpOptionsPage(
      tester,
      currentUserId: 'viewer-1',
      albumOwnerId: 'owner-1',
      sharedSpaceLinks: [
        api.AlbumSharedSpaceLinkResponseDto(
          linkedById: 'owner-1',
          showInTimeline: true,
          spaceId: 'space-1',
          spaceName: 'Family Space',
        ),
      ],
    );

    expect(find.byKey(const Key('album-linked-spaces-section')), findsNothing);
    expect(find.text('Family Space'), findsNothing);
  });
}
