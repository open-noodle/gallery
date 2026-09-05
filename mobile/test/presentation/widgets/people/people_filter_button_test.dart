import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/people/people_filter_button.widget.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

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
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('PeopleFilterBy.toTypeParam', () {
    test('maps filter values onto the API type parameter', () {
      expect(PeopleFilterBy.all.toTypeParam(), isNull);
      expect(PeopleFilterBy.people.toTypeParam(), 'person');
      expect(PeopleFilterBy.pets.toTypeParam(), 'pet');
    });
  });

  Future<void> pumpButton(WidgetTester tester) async {
    await tester.pumpConsumerWidget(
      const CustomScrollView(
        slivers: [
          SliverAppBar(actions: [PeopleFilterButton()]),
        ],
      ),
    );
    await tester.pumpAndSettle();
  }

  Color? checkColor(WidgetTester tester, PeopleFilterBy mode) {
    final icon = tester.widget<Icon>(
      find.descendant(of: find.byKey(Key('people-filter-${mode.name}')), matching: find.byType(Icon)),
    );
    return icon.color;
  }

  group('PeopleFilterButton', () {
    testWidgets('defaults to All and writes the People setting when tapped', (tester) async {
      await pumpButton(tester);

      await tester.tap(find.byKey(const Key('people-filter-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('people-filter-all')), findsOneWidget);
      expect(find.byKey(const Key('people-filter-people')), findsOneWidget);
      expect(find.byKey(const Key('people-filter-pets')), findsOneWidget);
      expect(checkColor(tester, PeopleFilterBy.all), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleFilterBy.people), Colors.transparent);
      expect(checkColor(tester, PeopleFilterBy.pets), Colors.transparent);

      await tester.tap(find.byKey(const Key('people-filter-people')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.people.filterBy, PeopleFilterBy.people);
    });

    testWidgets('initializes the selected item from SettingsKey.peopleFilterBy', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.peopleFilterBy, PeopleFilterBy.pets);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-filter-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleFilterBy.pets), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleFilterBy.all), Colors.transparent);
      expect(checkColor(tester, PeopleFilterBy.people), Colors.transparent);
    });
  });
}
