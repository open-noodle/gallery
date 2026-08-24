import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/people/people_sort_button.widget.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
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

  Future<void> pumpButton(WidgetTester tester) async {
    await tester.pumpConsumerWidget(
      const CustomScrollView(
        slivers: [
          SliverAppBar(actions: [PeopleSortButton()]),
        ],
      ),
    );
    await tester.pumpAndSettle();
  }

  Color? checkColor(WidgetTester tester, PeopleSortBy mode) {
    final icon = tester.widget<Icon>(
      find.descendant(of: find.byKey(Key('people-sort-${mode.name}')), matching: find.byType(Icon)),
    );
    return icon.color;
  }

  group('PeopleSortButton', () {
    testWidgets('defaults to Most photos and writes the Name setting when tapped', (tester) async {
      await pumpButton(tester);

      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('people-sort-photoCount')), findsOneWidget);
      expect(find.byKey(const Key('people-sort-name')), findsOneWidget);
      expect(checkColor(tester, PeopleSortBy.photoCount), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleSortBy.name), Colors.transparent);

      await tester.tap(find.byKey(const Key('people-sort-name')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.people.sortBy, PeopleSortBy.name);
    });

    testWidgets('initializes the selected item from SettingsKey.peopleSortBy', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.peopleSortBy, PeopleSortBy.name);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleSortBy.name), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleSortBy.photoCount), Colors.transparent);
    });
  });
}
