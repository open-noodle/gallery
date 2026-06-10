import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/drift_people_collection.page.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

DriftPerson _person(String id, String name) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: name,
  isFavorite: false,
  isHidden: false,
  color: null,
);

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // .first: the page puts ValueKey(person.id) on BOTH the tile Column and its
  // CircleAvatar (drift_people_collection.page.dart:82,92), so byKey matches two widgets.
  double dxOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dx;
  double dyOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dy;

  bool isBefore(WidgetTester tester, String a, String b) {
    final dyA = dyOf(tester, a);
    final dyB = dyOf(tester, b);
    if (dyA != dyB) {
      return dyA < dyB;
    }
    return dxOf(tester, a) < dxOf(tester, b);
  }

  group('DriftPeopleCollectionPage', () {
    testWidgets('renders the sort-keyed provider order and re-queries when the setting changes', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleProvider.overrideWith(
            (ref, sortBy) async => sortBy == PeopleSortBy.photoCount
                ? [_person('zoe', 'Zoe'), _person('alice', 'Alice')]
                : [_person('alice', 'Alice'), _person('zoe', 'Zoe')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'zoe', 'alice'), isTrue);

      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('people-sort-name')));
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'alice', 'zoe'), isTrue);
      expect(SettingsRepository.instance.appConfig.people.sortBy, PeopleSortBy.name);
    });

    testWidgets('the in-page search filter preserves the provider order', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleProvider.overrideWith(
            (ref, sortBy) async => [_person('zo', 'Zora'), _person('al', 'Alora'), _person('bo', 'Bob')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.search));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'ora');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('bo')), findsNothing);
      expect(find.byKey(const ValueKey('zo')), findsWidgets);
      expect(isBefore(tester, 'zo', 'al'), isTrue);
    });
  });
}
