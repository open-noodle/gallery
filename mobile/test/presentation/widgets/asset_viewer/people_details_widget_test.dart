import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_details/people_details.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

Person _person(String id, String name, {String? spaceId}) =>
    Person(id: id, updatedAt: DateTime(2024, 1, 1), name: name, spaceId: spaceId);

void main() {
  late Drift db;
  late _MockUserService userService;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
    userService = _MockUserService();
    when(
      () => userService.tryGetMyUser(),
    ).thenReturn(UserDto(id: 'viewer', email: 'v@e', name: 'v', profileChangedAt: DateTime(2024)));
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // The strip avatar routes its thumbnail by person profile exactly like the #737 People grid:
  // a Space-shared person's id is a shared_space_person id with no row in the owner-only person
  // table, so /people/{id}/thumbnail 404s — it must resolve via the membership-gated space
  // endpoint. This is the face-tap sibling of the People-page thumbnail routing.
  String? avatarUrl(WidgetTester tester) {
    final avatar = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
    final provider = avatar.backgroundImage;
    return provider is RemoteImageProvider ? provider.url : null;
  }

  Future<void> pumpStrip(WidgetTester tester, Person person) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-1', ownerId: 'admin');
    await tester.pumpConsumerWidget(
      PeopleDetails(asset: asset),
      overrides: [
        driftPeopleAssetProvider.overrideWith((ref, key) async => [person]),
        infra.userServiceProvider.overrideWithValue(userService),
        currentUserProvider.overrideWith(
          (ref) => _StubCurrentUserNotifier(
            userService,
            UserDto(id: 'viewer', email: 'v@e', name: 'v', profileChangedAt: DateTime(2024)),
          ),
        ),
      ],
    );
    await tester.pumpAndSettle();
  }

  testWidgets('a Space person\'s strip avatar resolves via the space thumbnail endpoint', (tester) async {
    await pumpStrip(tester, _person('space-person-1', 'Alice', spaceId: 'space-1'));

    // `?c=<ms>` is upstream #29350's cache-buster, threaded through the fork's space-scoped
    // helper too; assert it is present so it cannot silently regress.
    expect(avatarUrl(tester), contains('/shared-spaces/space-1/people/space-person-1/thumbnail?c='));
  });

  testWidgets('a personal person\'s strip avatar resolves via the owner thumbnail endpoint', (tester) async {
    await pumpStrip(tester, _person('global-1', 'Bob'));

    expect(avatarUrl(tester), contains('/people/global-1/thumbnail?c='));
  });
}
