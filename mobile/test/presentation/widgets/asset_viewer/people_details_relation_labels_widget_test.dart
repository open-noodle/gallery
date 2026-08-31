import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
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
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

// Slice 14 — mobile mirror of the web asset-viewer people-strip relation labels
// (`DetailPanelPeople.svelte`, slice 9). The label is server-derived on
// `PersonResponseDto.familyRelationLabel` (never computed client-side) — an absent field means
// no family access at all (`A12`), a present-but-null value means access is granted but no
// relationship is recorded, and a present string is the relation itself. `DriftPerson` mirrors
// that split as `hasFamilyAccess` + `familyRelationLabel`.
//
// `A12`: with no family access the strip must render exactly as it does today, so the
// "no access" test and its positive control below share the exact same person fixture
// (Lena/Oskar) — only `hasFamilyAccess`/`familyRelationLabel` differ between them.

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

DriftPerson _person(String id, String name, {bool hasFamilyAccess = false, String? familyRelationLabel}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'admin',
  name: name,
  isFavorite: false,
  isHidden: false,
  color: null,
  hasFamilyAccess: hasFamilyAccess,
  familyRelationLabel: familyRelationLabel,
);

void main() {
  late Drift db;
  late _MockUserService userService;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
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

  Future<void> pumpStrip(WidgetTester tester, List<DriftPerson> people) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-1', ownerId: 'admin');
    await tester.pumpConsumerWidget(
      PeopleDetails(asset: asset),
      overrides: [
        driftPeopleAssetProvider.overrideWith((ref, key) async => people),
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

  testWidgets('labels each face on the strip with its relationship to the viewer', (tester) async {
    final lena = _person('lena', 'Lena', hasFamilyAccess: true, familyRelationLabel: 'your sibling');
    final oskar = _person('oskar', 'Oskar', hasFamilyAccess: true, familyRelationLabel: "sibling's partner");

    await pumpStrip(tester, [lena, oskar]);

    expect(find.text('Lena'), findsOneWidget);
    expect(find.text('your sibling'), findsOneWidget);
    expect(find.text('Oskar'), findsOneWidget);
    expect(find.text("sibling's partner"), findsOneWidget);
  });

  testWidgets('shows a neutral dash for a face with no known relationship', (tester) async {
    // Access granted (hasFamilyAccess: true) but no relation recorded (familyRelationLabel:
    // null) — the server-side "present but null" case.
    final casper = _person('casper', 'Casper', hasFamilyAccess: true, familyRelationLabel: null);

    await pumpStrip(tester, [casper]);

    expect(find.text('Casper'), findsOneWidget);
    // The neutral dash — a blank line here would read as a loading state rather than "no
    // recorded relationship" (the mockup's `prel none` treatment, matching web slice 9).
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('leaves every face unlabelled when the viewer has no family access', (tester) async {
    // hasFamilyAccess: false (the default) — the server omitted familyRelationLabel entirely.
    final lena = _person('lena', 'Lena');
    final oskar = _person('oskar', 'Oskar');

    await pumpStrip(tester, [lena, oskar]);

    // The strip itself is unaffected — names still render exactly as they do today.
    expect(find.text('Lena'), findsOneWidget);
    expect(find.text('Oskar'), findsOneWidget);
    // A12: no relation line at all — not even a dash — for anyone.
    expect(find.text('your sibling'), findsNothing);
    expect(find.text("sibling's partner"), findsNothing);
    expect(find.text('—'), findsNothing);
  });

  // Positive control for the test above: same exact fixture (Lena/Oskar), only
  // hasFamilyAccess/familyRelationLabel differ. Without this, a widget that never renders
  // relation labels at all would pass the "no access" test just as easily as a correct one.
  testWidgets('labels faces for a viewer with view access', (tester) async {
    final lena = _person('lena', 'Lena', hasFamilyAccess: true, familyRelationLabel: 'your sibling');
    final oskar = _person('oskar', 'Oskar', hasFamilyAccess: true, familyRelationLabel: "sibling's partner");

    await pumpStrip(tester, [lena, oskar]);

    expect(find.text('Lena'), findsOneWidget);
    expect(find.text('your sibling'), findsOneWidget);
    expect(find.text('Oskar'), findsOneWidget);
    expect(find.text("sibling's partner"), findsOneWidget);
  });
}
