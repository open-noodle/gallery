import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
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
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
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

      expect(Store.tryGet(StoreKey.peopleSortBy), PeopleSortBy.name.index);
    });

    testWidgets('initializes the selected item from Setting.peopleSortBy', (tester) async {
      await Store.put(StoreKey.peopleSortBy, PeopleSortBy.name.index);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleSortBy.name), isNot(Colors.transparent));
      expect(checkColor(tester, PeopleSortBy.photoCount), Colors.transparent);
    });

    testWidgets('an out-of-range stored value falls back to Most photos', (tester) async {
      await Store.put(StoreKey.peopleSortBy, 99);

      await pumpButton(tester);
      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();

      expect(checkColor(tester, PeopleSortBy.photoCount), isNot(Colors.transparent));
    });
  });
}
